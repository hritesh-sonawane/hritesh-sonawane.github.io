+++
title = 'GPU scheduling'
description = 'A GPU scheduler must start multi-node jobs all at once, keep whole nodes free for them, reclaim capacity by preemption without wasting work, and report utilization honestly. Gang scheduling, bin packing, and quotas with borrowing do most of the work.'
question = 'How does a scheduler share a GPU fleet among jobs of very different sizes without deadlock, fragmentation, or idle GPUs?'
weight = 4
difficulty = 4
prerequisites = ['/notes/systems-design/ai-infrastructure/01-a-training-cluster', '/notes/systems-design/building-blocks/03-queues-and-batch-lanes']
date = 2026-10-30T13:20:00Z
lastmod = 2026-10-30T13:20:00Z
verified = 2026-10-30
+++

## The idea in one minute

A GPU fleet runs jobs that differ by orders of magnitude: a one-GPU notebook,
an eight-GPU fine-tune on one node, a 512-GPU training job across 64 nodes, and
inference pools that must never be starved. Four problems follow.

**Gangs**: a distributed job is useless until all of its workers run, so
allocating some of them early only idles GPUs and can deadlock two jobs that
each hold part of what they need. **Fragmentation**: free GPUs scattered one or
two per node cannot host a job that needs whole nodes, so jobs wait while GPUs
sit idle. **Sharing**: teams need guaranteed quota and the ability to borrow
idle capacity, which means preemption, and preemption throws away work.
**Measurement**: "GPU utilization" from a device counter says little about
useful work.

The consequence to act on: admit multi-GPU jobs as gangs, pack small jobs onto
few nodes to keep whole nodes free, express sharing as quotas with borrowing
and checkpoint-aware preemption, and report utilization as a product of
allocation, stall, and model FLOPs utilization.

## A picture

```mermaid {title="Pod-by-pod allocation deadlocks two gangs; gang admission does not"}
flowchart LR
  subgraph POD["Pod by pod"]
    direction TB
    A1["<b>Job A</b><br/><small>3 of 4 nodes</small>"]
    B1["<b>Job B</b><br/><small>3 of 4 nodes</small>"]
    D["<b>Deadlock</b><br/><small>48 GPUs held, none running</small>"]
    A1 --> D
    B1 --> D
  end
  subgraph GANG["As gangs"]
    direction TB
    A2["<b>Job A</b><br/><small>admitted with 4 nodes</small>"]
    B2["<b>Job B</b><br/><small>waits whole, holds nothing</small>"]
    A2 -->|"A ends"| B2
  end
  class A1,B1 queue
  class D warn
  class A2 good
  class B2 queue
```

Two 32-GPU jobs on 48 free GPUs: allocating pods as they arrive leaves both
jobs incomplete forever. Admitting each job only when all its pods fit lets one
run and the other wait without holding capacity.

## How it really works

### The shape of the work

| Job shape | Needs | Placement constraint |
| --- | --- | --- |
| Fractional | Part of one GPU | A partition (such as MIG) or a shared GPU |
| Single GPU | One device | Any node with a free GPU |
| Multi-GPU, one node | 2 to 8 GPUs with NVLink between them | The same node, often the same NVLink domain |
| Multi-node gang | Whole nodes, all at once | Free whole nodes, ideally under the same leaf switch |
| Inference pool | Replicas of a fixed size, always on | Reserved capacity, spread across failure domains |

Real clusters are dominated by small jobs in count and by large jobs in
GPU-hours. Studies of production clusters (Jeon et al., 2019, on Microsoft's
Philly; Weng et al., 2022, on Alibaba's PAI) report heavy-tailed job sizes and
durations, low utilization of GPUs allocated to small jobs, and queueing delays
caused by locality constraints for distributed jobs.

### Gang scheduling

Ousterhout (1982) named **coscheduling**: running the parts of a parallel job
at the same time. For GPU jobs it means **all-or-nothing admission**: a job's
pods are placed only if all of them fit at once. Without it, a scheduler that
places pods individually lets two jobs each acquire part of their gang and
wait forever for the rest, with every GPU they hold idle.

Mechanisms, as of October 2026:

- **Slurm** allocates a job's whole node set at once by design.
- **Kueue** on Kubernetes admits a workload as a unit when its quota allows,
  and can wait for all pods to be ready, evicting and requeueing a workload
  whose pods cannot all start.
- **Volcano** uses a `PodGroup` with a minimum member count.
- Upstream Kubernetes has been adding native gang scheduling through a
  workload-level API; check the current release notes for its maturity.

Gang admission also needs **gang preemption**: evicting one worker of a
distributed job stops all of them, so a preemptor should take whole gangs, not
strand half of one.

### Fragmentation and placement

A cluster can have hundreds of free GPUs and still be unable to start an
eight-GPU job, because no single node has eight free. Placement policy decides
how often that happens:

- **Spread** (prefer the emptiest node) balances load and failure impact but
  scatters small jobs across every node, leaving no whole node free.
  Kubernetes' default `LeastAllocated` scoring behaves this way.
- **Pack** (prefer the fullest node that fits, best fit) concentrates small jobs
  on few nodes and keeps whole nodes free for gangs. Kubernetes offers it as the
  `MostAllocated` scoring strategy.

For GPU fleets that run gangs, pack. Beyond nodes, the same logic applies to
**topology**: an eight-node gang placed under one leaf switch communicates
better than one spread across the spine, so schedulers that know the network
topology (Slurm's topology plugin, topology-aware schedulers on Kubernetes)
pack gangs into network domains too. Weng et al. (2023) formalize fragmentation
for GPU-sharing workloads and schedule to minimize its expected growth.

### Queue order, backfill, and starvation

Strict FIFO wastes capacity: a large job at the head waits for whole nodes,
and everything behind it waits too. **Backfill** lets smaller jobs behind it run
if they fit. Unrestricted backfill starves the large job, because small jobs
keep consuming nodes as they free. **EASY backfilling** (Mu'alem and Feitelson,
2001) reserves a start time for the head job and only backfills jobs that will
finish before it, which requires runtime estimates; Slurm's backfill scheduler
works this way. A cruder rule, used in the program below, stops backfilling once
the head job has waited a set time.

### Quotas, borrowing, and fairness

Teams want guarantees; a cluster wants to be full. Quotas with **borrowing**
deliver both:

- Each team (in Kueue, a `ClusterQueue` in a cohort) has a **nominal quota** it
  is guaranteed.
- Idle quota can be **borrowed** by others in the cohort, up to a borrowing
  limit.
- When the owner needs its quota back, borrowed workloads are **preempted**.
- Priority orders work within and across queues: production inference above
  training above experiments.

When jobs need several resources (GPUs, CPU, memory, network), **dominant
resource fairness** (Ghodsi et al., 2011) equalizes each user's largest share
across resource types and avoids rewarding users who hoard the resource
others need.

### Preemption costs work

A preempted training job loses everything since its last checkpoint, plus its
restart time, multiplied by every GPU in the gang. A 512-GPU job that
checkpoints every 30 minutes, preempted at a random time, loses on average 15
minutes × 512 GPUs, or 128 GPU-hours, plus restart. So:

- **Signal before killing.** Send a termination signal with a grace period long
  enough to write a checkpoint, and have jobs checkpoint on that signal.
- **Prefer cheap victims.** Jobs that checkpointed recently, small jobs, and
  elastic jobs lose least.
- **Shrink instead of kill.** Elastic jobs can lose workers and continue with
  fewer; Pollux (Qiao et al., 2021) adapts each job's resources and batch size
  to cluster load.
- **Rate-limit preemption** so the same workload is not evicted repeatedly.

### Utilization, honestly

"GPU utilization" means three different things:

| Measure | Definition | What it hides |
| --- | --- | --- |
| Allocation | Fraction of GPUs assigned to some job | Allocated GPUs waiting on data, checkpoints, or restarts |
| Device activity | Fraction of time a kernel is running (what `nvidia-smi` reports) | A kernel using 5% of the streaming multiprocessors counts as busy |
| Model FLOPs utilization | Useful model FLOPs divided by peak | Nothing about the job: it is the end-to-end efficiency |

DCGM's profiling metrics (streaming multiprocessor activity and occupancy,
tensor pipe activity) sit between the second and third rows and are the right
signals for spotting jobs that hold GPUs without using them. Useful work is a
product of factors:

```text
useful fraction  =  allocated  x  not stalled  x  MFU
                 =    0.85     x      0.90     x  0.40   =  0.31
```

The levers are not equal: at these values, raising MFU by five points is worth
about twice as much as raising allocation by five points, because MFU
multiplies a larger base.

## Code

The program demonstrates gang deadlock, then simulates a week on 64 nodes × 8
GPUs at 85% offered load with a mixed job stream, comparing spread and pack
placement under the same backfill rule. Finally it multiplies out the
utilization stack.

```python {title="gpusched.py"}
"""gpusched.py: gang scheduling, fragmentation, and utilization math.

1. Two 32-GPU jobs on 48 free GPUs, scheduled pod by pod versus as gangs.
2. A week on 64 nodes x 8 GPUs with a mixed job stream. Jobs under 8 GPUs
   must fit on one node; jobs of 8 or more need whole free nodes.
   Placement either spreads small jobs onto the emptiest node or packs them
   onto the fullest node that fits. Backfill runs anything that fits, unless
   the head of the queue has waited 60 minutes, which blocks backfill.
3. Where the GPU-hours go: allocated x busy x model FLOPs utilization.
Simulated cluster; standard library only.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

NODES, PER = 64, 8
MINUTES = 7 * 24 * 60
SIZES = [(1, .30), (2, .15), (4, .20), (8, .17), (16, .10), (32, .06), (64, .02)]


def gang_demo() -> None:
    free = [8] * 6  # 48 GPUs
    print("1. two jobs, each 4 pods x 8 GPUs, on 6 free nodes")
    held = {"A": 0, "B": 0}
    nodes = list(range(6))
    for i, job in enumerate(["A", "B"] * 4):  # pods arrive interleaved
        if nodes:
            free[nodes.pop(0)] = 0
            held[job] += 1
    print(f"   pod by pod: A holds {held['A']} of 4 pods, B holds {held['B']} of 4;"
          f" {sum(free)} GPUs free, so both wait forever: deadlock with {48 - sum(free)} GPUs held and idle")
    print("   as gangs:   A is admitted with 4 nodes; B waits whole, holding nothing,"
          " and starts when A ends")


@dataclass
class Job:
    size: int
    dur: int
    arrive: int
    start: int = -1


def week(policy: str, seed: int = 9) -> dict:
    rng = random.Random(seed)
    mean_gpu_min = sum(s * p for s, p in SIZES) * 300  # mean duration ~300 min
    lam = 0.85 * NODES * PER / mean_gpu_min             # offered load: 85% of the cluster
    free = [PER] * NODES
    running: list[tuple[int, Job, list[tuple[int, int]]]] = []
    queue: list[Job] = []
    done: list[Job] = []
    alloc_sum = frag_sum = 0
    for t in range(MINUTES):
        # arrivals
        while rng.random() < lam / (1 + lam):  # geometric count with mean ~lam
            r, acc = rng.random(), 0.0
            for s, p in SIZES:
                acc += p
                if r <= acc:
                    break
            queue.append(Job(s, rng.randint(60, 540), t))
        # completions
        still = []
        for end, j, places in running:
            if end <= t:
                for n, g in places:
                    free[n] += g
                done.append(j)
            else:
                still.append((end, j, places))
        running = still

        def place(j: Job) -> list[tuple[int, int]] | None:
            if j.size >= PER:
                whole = [n for n in range(NODES) if free[n] == PER]
                k = j.size // PER
                return [(n, PER) for n in whole[:k]] if len(whole) >= k else None
            fits = [n for n in range(NODES) if free[n] >= j.size]
            if not fits:
                return None
            key = (lambda n: -free[n]) if policy == "spread" else (lambda n: free[n])
            return [(min(fits, key=key), j.size)]

        blocked = bool(queue) and t - queue[0].arrive > 60
        remaining = []
        for idx, j in enumerate(queue):
            if blocked and idx > 0:
                remaining.append(j)
                continue
            p = place(j)
            if p is None:
                remaining.append(j)
                continue
            for n, g in p:
                free[n] -= g
            j.start = t
            running.append((t + j.dur, j, p))
        queue = remaining
        alloc_sum += NODES * PER - sum(free)
        if any(j.size >= PER for j in queue):
            frag_sum += sum(f for f in free if f < PER)  # free GPUs no waiting big job can use
    big = sorted(j.start - j.arrive for j in done if j.size >= PER)
    small = sorted(j.start - j.arrive for j in done if j.size < PER)
    pct = lambda xs, q: xs[min(len(xs) - 1, int(q * len(xs)))]
    return {"alloc": alloc_sum / (MINUTES * NODES * PER), "frag": frag_sum / MINUTES,
            "small": (sum(small) / len(small), pct(small, .95)), "big": (sum(big) / len(big), pct(big, .95)),
            "n": len(done)}


def main() -> None:
    gang_demo()
    print(f"\n2. one week, {NODES} nodes x {PER} GPUs, offered load 85%")
    print(f"   {'placement':<9}{'allocated':>10}{'stranded GPUs':>15}{'small wait mean/p95':>22}{'large wait mean/p95':>22}")
    for pol in ("spread", "pack"):
        s = week(pol)
        print(f"   {pol:<9}{s['alloc']:>10.0%}{s['frag']:>15.1f}"
              f"{'%5.0f / %4d min' % s['small']:>22}{'%5.0f / %4d min' % s['big']:>22}")
    print("\n3. where 1,000 GPU-hours go (illustrative factors)")
    hours = 1000.0
    for label, f in (("allocated to a job", 0.85), ("job is not stalled (data, ckpt, restart)", 0.90),
                     ("model FLOPs utilization while running", 0.40)):
        hours *= f
        print(f"   x {f:.2f} {label:<42} -> {hours:6.0f} GPU-hours")
    print(f"   useful fraction {hours/1000:.0%}: raising MFU 0.40 -> 0.45 is worth"
          f" {1000*0.85*0.90*0.05:.0f} GPU-hours; raising allocation 0.85 -> 0.90 is worth {1000*0.05*0.90*0.40:.0f}")


if __name__ == "__main__":
    main()
```

Run it with `python3 gpusched.py`:

```text
1. two jobs, each 4 pods x 8 GPUs, on 6 free nodes
   pod by pod: A holds 3 of 4 pods, B holds 3 of 4; 0 GPUs free, so both wait forever: deadlock with 48 GPUs held and idle
   as gangs:   A is admitted with 4 nodes; B waits whole, holding nothing, and starts when A ends

2. one week, 64 nodes x 8 GPUs, offered load 85%
   placement allocated  stranded GPUs   small wait mean/p95   large wait mean/p95
   spread          76%           94.2        272 /  583 min        297 /  599 min
   pack            79%            4.1          4 /   27 min         10 /   72 min

3. where 1,000 GPU-hours go (illustrative factors)
   x 0.85 allocated to a job                         ->    850 GPU-hours
   x 0.90 job is not stalled (data, ckpt, restart)   ->    765 GPU-hours
   x 0.40 model FLOPs utilization while running      ->    306 GPU-hours
   useful fraction 31%: raising MFU 0.40 -> 0.45 is worth 38 GPU-hours; raising allocation 0.85 -> 0.90 is worth 18
```

**Spread** placement leaves on average 94 GPUs stranded: free, but on nodes
with other jobs, while a whole-node job waits. Allocation is 76% against an
offered 85%, so the queue grows all week, and both small and large jobs wait
four to five hours on average. **Pack** placement strands about 4 GPUs, allocates
79%, and keeps waits to minutes. Same hardware, same jobs; the difference is
which node each small job lands on.

## Where it breaks

- **Packing concentrates failure.** Many small jobs on one node all fail when
  it does. For inference replicas, spread across failure domains instead; pack
  only within the training and batch pools.
- **Backfill needs honest runtimes.** EASY backfilling depends on runtime
  estimates, which users routinely overstate or omit. Time limits enforced by
  the scheduler make estimates honest.
- **Quotas encode politics.** Nominal quotas, borrowing limits, and priorities
  are organizational decisions. The scheduler enforces them; it cannot make
  them fair.
- **Allocation is the easy number.** A cluster at 95% allocation can still be
  at 20% useful work. Report all three factors.
- **The simulation is small and simple.** It has no topology, no preemption,
  no failures, and uniform job durations. It shows why placement policy
  matters for gangs, not the waits a real cluster would see.

## Remember this

- Admit distributed jobs as gangs: all pods or none, and preempt whole gangs.
- Pack small jobs onto few nodes so whole nodes stay free for gangs; spread only where failure isolation matters.
- Backfill with reservations, or large jobs starve.
- Quotas with borrowing keep the cluster full; preemption reclaims them and costs the work since the last checkpoint.
- Useful work = allocation × not stalled × MFU; a device-busy counter is not utilization.

## Try it

1. In `gpusched.py`, remove the 60-minute backfill block. What happens to the
   wait of large jobs under `pack`?
2. Raise offered load from 85% to 95%. At which load does `pack` stop keeping
   up?
3. Add topology: nodes in groups of 8 under one leaf switch, and require
   32-GPU and 64-GPU jobs to be placed within one or two groups. How much does
   their wait grow?
4. A 1,024-GPU job checkpoints every 20 minutes and takes 10 minutes to restart.
   How many GPU-hours does one preemption cost on average?

## Check yourself

1. Why can two distributed jobs deadlock under pod-by-pod scheduling?

   {{< details summary="Show answer" >}}
   Each job's pods are placed as capacity appears, so both jobs can acquire
   part of what they need. Neither can start until it has all its pods, and
   neither releases the GPUs it holds, so both wait forever while those GPUs
   idle. Gang admission places a job only when all of its pods fit.
   {{< /details >}}

2. Why does spreading small jobs across nodes hurt a fleet that runs gangs?

   {{< details summary="Show answer" >}}
   It leaves a few free GPUs on many nodes and no node entirely free. Jobs that
   need whole nodes cannot start, even though the cluster's total free GPU
   count is large. Packing keeps whole nodes free.
   {{< /details >}}

3. What does unrestricted backfill do to large jobs, and what fixes it?

   {{< details summary="Show answer" >}}
   Small jobs keep starting on freed nodes, so the large job at the head never
   finds enough whole nodes free and starves. Reserving a start time for the
   head job and backfilling only jobs that finish before it (EASY backfilling),
   or blocking backfill after a wait limit, fixes it.
   {{< /details >}}

4. A cluster reports 90% GPU utilization from device counters. Why might its
   useful work still be low?

   {{< details summary="Show answer" >}}
   The counter reports the fraction of time any kernel is running, not how much
   of the GPU it uses. Jobs can also be allocated while stalled on data or
   checkpoints. Useful work is allocation × not stalled × MFU, and MFU of 30% to
   50% is typical for large training jobs.
   {{< /details >}}

## Sources

- J. K. Ousterhout, Scheduling Techniques for Concurrent Systems, International Conference on Distributed Computing Systems, 1982.
- A. W. Mu'alem, D. G. Feitelson, [Utilization, Predictability, Workloads, and User Runtime Estimates in Scheduling the IBM SP2 with Backfilling](https://doi.org/10.1109/71.932708), IEEE Transactions on Parallel and Distributed Systems, 2001.
- A. Ghodsi et al., [Dominant Resource Fairness: Fair Allocation of Multiple Resource Types](https://www.usenix.org/conference/nsdi11/dominant-resource-fairness-fair-allocation-multiple-resource-types), USENIX NSDI, 2011.
- M. Jeon et al., [Analysis of Large-Scale Multi-Tenant GPU Clusters for DNN Training Workloads](https://www.usenix.org/conference/atc19/presentation/jeon), USENIX ATC, 2019.
- Q. Weng et al., [MLaaS in the Wild: Workload Analysis and Scheduling in Large-Scale Heterogeneous GPU Clusters](https://www.usenix.org/conference/nsdi22/presentation/weng), USENIX NSDI, 2022.
- Q. Weng et al., [Beware of Fragmentation: Scheduling GPU-Sharing Workloads with Fragmentation Gradient Descent](https://www.usenix.org/conference/atc23/presentation/weng), USENIX ATC, 2023.
- A. Qiao et al., [Pollux: Co-adaptive Cluster Scheduling for Goodput-Optimized Deep Learning](https://www.usenix.org/conference/osdi21/presentation/qiao), USENIX OSDI, 2021.
- Kubernetes SIGs, [Kueue documentation](https://kueue.sigs.k8s.io/docs/), read October 2026.
- Kubernetes, [Resource bin packing](https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/), documentation, read October 2026.
- SchedMD, [Slurm scheduling configuration guide](https://slurm.schedmd.com/sched_config.html), read October 2026.
- NVIDIA, [DCGM documentation: profiling metrics](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/feature-overview.html), read October 2026.
