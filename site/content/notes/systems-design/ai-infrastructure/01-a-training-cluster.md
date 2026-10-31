+++
title = 'A training cluster'
description = 'Size a training cluster in four passes: compute from 6ND and achievable utilization, memory and parallelism layout, network for collectives, storage for checkpoints. Then let the failure rate set the checkpoint interval, because at ten thousand GPUs a job stops every few hours.'
question = 'How many GPUs, how much network and storage, and how much reliability engineering does a large training run need?'
weight = 1
difficulty = 4
prerequisites = ['/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity', '/notes/systems-design/reliability-in-production/04-backup-and-disaster-recovery']
date = 2026-10-30T13:05:00Z
lastmod = 2026-10-30T13:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

A pretraining run is one program running on thousands of GPUs for weeks, in
lockstep. Every step, every GPU must finish its share and exchange gradients
before any can continue. That shape decides the design. **Compute** is set by
the arithmetic of the model and the fraction of peak the cluster actually
achieves. **Memory** forces the model to be split across GPUs, and the way it
is split decides which links carry which traffic. The **network** must move
gradient and activation traffic fast enough that GPUs do not wait.
**Storage** must absorb terabyte checkpoints in seconds.

Then reliability takes over. Failures scale with component count, so a job on
16,000 GPUs is interrupted every few hours even when each GPU fails once in
several years. The checkpoint interval, restart time, and spare capacity
decide how much of the cluster's time produces progress. The consequence to
act on: size the cluster from compute, then design the network, storage, and
operations around the job's mean time between failures.

## A picture

```mermaid {title="A rail-optimized training cluster: NVLink inside nodes, one fabric rail per GPU index"}
flowchart TB
  subgraph POD["Scalable unit"]
    direction LR
    subgraph N1["Node 1"]
      G1A["<b>GPU 0..7</b><br/><small>NVLink switch</small>"]
    end
    subgraph N2["Node 2"]
      G2A["<b>GPU 0..7</b><br/><small>NVLink switch</small>"]
    end
    subgraph N3["Node N"]
      G3A["<b>GPU 0..7</b><br/><small>NVLink switch</small>"]
    end
  end
  subgraph FAB["Backend fabric, 400 Gb/s per GPU"]
    R0["<b>Rail 0 leaf</b><br/><small>GPU 0 of every node</small>"]
    R7["<b>Rail 7 leaf</b><br/><small>GPU 7 of every node</small>"]
    SP["<b>Spine</b>"]
  end
  G1A --> R0
  G2A --> R0
  G3A --> R0
  G1A --> R7
  G2A --> R7
  G3A --> R7
  R0 --> SP
  R7 --> SP
  ST[("<b>Parallel file system</b><br/><small>checkpoints, data shards</small>")]
  POD -->|"frontend network"| ST
  HC["<b>Health and restart</b><br/><small>detect, exclude node,<br/>reload checkpoint</small>"] -.-> POD
  class G1A,G2A,G3A compute
  class R0,R7,SP io
  class ST memory
  class HC good
```

Tensor-parallel traffic stays on NVLink inside a node. Data-parallel and
pipeline traffic crosses the backend fabric, where GPU *i* of every node shares
a rail. Storage sits on a separate network.

## How it really works

### Pass 1: compute

A dense transformer's training cost is approximately **6 FLOPs per parameter
per token**: 2 for the forward pass and 4 for the backward pass (Kaplan et al.,
2020). For `N` parameters and `D` tokens:

```text
training FLOPs  ~=  6 x N x D
70e9 parameters x 15e12 tokens  ->  6.3e24 FLOPs
```

Divide by what each GPU actually delivers. **Model FLOPs utilization** (MFU),
defined in the PaLM paper (Chowdhery et al., 2022), is the model's FLOPs per
second divided by the hardware's peak. An H100 SXM's dense BF16 peak is 989
TFLOP/s per NVIDIA's datasheet. Published large runs achieve well under that:
Meta reports 38% to 43% MFU for Llama 3 405B on up to 16,384 H100s, and
ByteDance's MegaScale reports 55.2% on 12,288 GPUs for a 175B model. At 40%:

```text
6.3e24 / (989e12 x 0.40)   =  1.59e10 GPU-seconds  =  4.42 M GPU-hours
on 8,192 GPUs              =  22.5 days, if nothing ever fails
```

The `6ND` rule omits attention's own FLOPs, which grow with sequence length;
at long contexts add them explicitly. Llama 3 405B is a check on the rule:
6 × 405e9 × 15.6e12 ≈ 3.8e25 FLOPs, the figure Meta reports.

### Pass 2: memory and the parallelism layout

Mixed-precision training with Adam keeps about **16 bytes per parameter**:
16-bit weights and gradients (2 + 2) plus FP32 master weights and two Adam
moments (4 + 4 + 4) (Rajbhandari et al., ZeRO, 2020). For 70B parameters that
is 1.12 TB before activations, so the model cannot live on one GPU and must be
split. The standard dimensions:

| Parallelism | Splits | Communication | Where it goes |
| --- | --- | --- | --- |
| Tensor (TP) | Each layer's matrices | All-reduce of activations, every layer, forward and backward | Inside a node, on NVLink |
| Pipeline (PP) | Layers into stages | Point-to-point activations between stages | Across nodes |
| Data (DP), with sharding (ZeRO, FSDP) | The batch; optimizer state sharded | Reduce-scatter and all-gather of gradients and weights, once per step | Across nodes, overlapped with backward |
| Context or sequence | The sequence dimension | Attention exchanges | Inside a node or a small group |
| Expert (mixture of experts) | Experts across GPUs | All-to-all token routing | Across nodes, bandwidth-heavy |

The rule (Narayanan et al., 2021): **put the most frequent, largest collectives
on the fastest links**. [Tensor parallelism](/notes/inference-engineering/distributed-inference/01-tensor-pipeline-and-expert-parallelism/) communicates in every layer, so it
stays within the NVLink domain; data parallelism communicates once per step and
can cross the fabric.

### Pass 3: the network

A ring all-reduce of `S` bytes over `n` participants sends `2(n - 1)/n × S` bytes
per participant, which approaches `2S` and is bandwidth-optimal (Patarasuk and
Yuan, 2009). With TP 8 and PP 4, each GPU holds 1/32 of the model, so its
gradient shard for 70B is about 4.4 GB in BF16, and each step sends about
8.7 GB per GPU over the fabric. At 400 Gb/s per GPU that is 0.17 s, about 8% of
a 2.07 s step if it were not overlapped with the backward pass. Overlap hides
most of it, which is why the per-GPU NIC can be "only" 400 Gb/s.

Three properties matter more than the headline bandwidth:

- **Non-blocking topology.** A rail-optimized fat tree connects GPU *i* of
  every node to the same leaf switch, so the dominant traffic between
  same-index GPUs stays one hop away.
- **The slowest link sets the pace.** Collectives are synchronous: one flapping
  link or degraded NIC slows all 8,192 GPUs. Straggler detection is part of
  the network design.
- **Either fabric works with tuning.** Meta reported building two 24,576-GPU
  clusters in 2024, one on RoCE and one on InfiniBand, and training on both.

### Pass 4: storage

Storage bandwidth for training is dominated by checkpoints, not data. A
checkpoint of weights plus optimizer state is about 14 bytes per parameter
(16-bit weights, FP32 master, two moments): about 1 TB for 70B, 5.7 TB for
405B. If writing it blocks training, its duration is pure loss, multiplied by
every checkpoint in the run. Techniques that shrink the blocking time:

- **Sharded writes**: every rank writes its own shard in parallel, as PyTorch
  Distributed Checkpoint does, so aggregate bandwidth scales with the job.
- **Asynchronous checkpoints**: copy state to host memory, resume training,
  and write to storage in the background.
- **In-memory checkpoints to peers**: Gemini (Wang et al., SOSP 2023) keeps
  checkpoints in other machines' CPU memory for fast recovery, with less
  frequent writes to remote storage.

The data path itself is modest. A 16M-token step every 2 s is 7.7M tokens per
second, about 31 MB/s of tokenized data at 4 bytes per token. Its requirement
is not bandwidth but **deterministic resume**: the data loader's position goes
into the checkpoint, so a restart neither repeats nor skips data.

### Failures set the economics

Meta's Llama 3 paper is the clearest public record. In a 54-day snapshot of
405B pretraining on up to 16,384 H100s there were 466 job interruptions: 47
planned and 419 unexpected. About 78% of the unexpected ones were attributed to
confirmed or suspected hardware issues, with faulty GPUs and GPU HBM3 memory
the two largest categories. Despite that, automation kept effective training
time above 90%.

Failure counts scale with component count. Spread over GPUs, 419 interruptions
in 54 days on 16,384 GPUs is about one per GPU every 5.8 years. A job's mean
time between failures (MTBF) is that divided by the number of GPUs it spans:
about 49 hours at 1,024 GPUs and 3 hours at 16,384.

The checkpoint interval trades checkpoint overhead against lost work. Young's
approximation (1974), refined by Daly (2006), gives the optimum:

```text
interval  ~=  sqrt(2 x checkpoint cost x MTBF)
time lost ~=  checkpoint cost / interval  +  (interval / 2 + restart time) / MTBF
```

The second line shows the three levers: make checkpoints cheaper (async,
sharded), make restarts faster (spare nodes already up, cached images, fast
reload), and raise MTBF (burn-in, proactive replacement of degrading parts).

### The operations loop

- **Pre-flight**: burn-in and diagnostics (NVIDIA DCGM diagnostics, collective
  bandwidth tests) before a node joins the job.
- **Detection**: hangs detected by collective timeouts and heartbeats; slow
  nodes by per-rank step time; numerical faults by loss spikes and NaN checks.
  Silent data corruption, where a processor computes wrong results without an
  error, is real at fleet scale (Dixit et al., 2021).
- **Exclusion**: a suspect node is drained and replaced by a **hot spare** so
  the restart does not wait for repair.
- **Restart**: automatic, from the latest checkpoint, with the same data
  position.
- **Power**: at 700 W per H100 SXM, 8,192 GPUs draw 5.7 MW before CPUs,
  network, and cooling, and synchronous training swings that load in step.
  The facility is part of the design.

## Code

The program sizes a 70B-parameter run on 15T tokens: compute at 40% MFU,
memory and all-reduce volume for TP 8 and PP 4, checkpoint size and write
time, and goodput under the Llama 3 interruption rate for several cluster
sizes and two operating regimes (a blocking 60 s checkpoint with a 30-minute
restart, and an asynchronous 5 s checkpoint with a 10-minute restart).

```python {title="cluster.py"}
"""cluster.py: size a pretraining run, its network, storage, and failure budget.

Compute: training FLOPs ~ 6 x parameters x tokens. Network: ring all-reduce
of each data-parallel shard's gradients. Storage: checkpoint size and the
bandwidth it needs. Failures: job MTBF scaled from a published interruption
rate, and the Young/Daly checkpoint interval. Arithmetic only; standard library.
"""

from __future__ import annotations

import math

# --- the run ---
PARAMS = 70e9
TOKENS = 15e12
GLOBAL_BATCH_TOKENS = 16e6
PEAK_FLOPS = 989e12      # H100 SXM, dense BF16, per NVIDIA datasheet
MFU = 0.40               # model FLOPs utilization actually achieved
GPUS = 8192
TP, PP = 8, 4            # tensor parallel inside a node, pipeline across 4 nodes
NIC_GBPS = 400           # one 400 Gb/s NIC per GPU, rail-optimized
# --- failures: 419 unexpected interruptions in 54 days on 16,384 GPUs ---
FAIL_PER_GPU_DAY = 419 / (54 * 16384)


def compute() -> float:
    flops = 6 * PARAMS * TOKENS
    gpu_s = flops / (PEAK_FLOPS * MFU)
    days = gpu_s / GPUS / 86400
    step_s = 6 * PARAMS * GLOBAL_BATCH_TOKENS / (GPUS * PEAK_FLOPS * MFU)
    print("compute")
    print(f"  6ND = 6 x {PARAMS/1e9:.0f}e9 x {TOKENS/1e12:.0f}e12 = {flops:.2e} FLOPs")
    print(f"  at {MFU:.0%} MFU of {PEAK_FLOPS/1e12:.0f} TFLOP/s: {gpu_s/3600/1e6:.2f} M GPU-hours"
          f" = {days:.1f} days on {GPUS:,} GPUs, if nothing ever fails")
    print(f"  one step of {GLOBAL_BATCH_TOKENS/1e6:.0f} M tokens: {step_s:.2f} s")
    return step_s


def memory_and_network(step_s: float) -> None:
    states = 16 * PARAMS  # fp16/bf16 weights+grads, fp32 master, Adam m and v
    model_par = TP * PP
    dp = GPUS // model_par
    shard_params = PARAMS / model_par
    grad_bytes = 2 * shard_params
    ring = 2 * (dp - 1) / dp * grad_bytes
    t_ring = ring / (NIC_GBPS / 8 * 1e9)
    print("\nmemory and network")
    print(f"  training state at 16 bytes/param: {states/1e12:.2f} TB -> must be sharded"
          f" over at least {math.ceil(states/80e9)} x 80 GB GPUs before activations")
    print(f"  TP {TP} x PP {PP} = {model_par} GPUs per replica, {dp} data-parallel replicas")
    print(f"  per-GPU gradient shard {grad_bytes/1e9:.2f} GB; ring all-reduce sends {ring/1e9:.2f} GB per GPU")
    print(f"  at {NIC_GBPS} Gb/s that is {t_ring:.2f} s per step, {t_ring/step_s:.0%} of a"
          f" {step_s:.2f} s step unless overlapped with the backward pass")


def storage(step_s: float) -> float:
    ckpt = 14 * PARAMS  # bf16 weights + fp32 master + Adam m, v
    tok_s = GLOBAL_BATCH_TOKENS / step_s
    print("\nstorage")
    print(f"  checkpoint (weights + optimizer, 14 bytes/param): {ckpt/1e12:.2f} TB")
    for bw in (20, 100, 500):
        print(f"    written at {bw:>3} GB/s aggregate: {ckpt/(bw*1e9):5.0f} s")
    print(f"  training data read rate: {tok_s/1e6:.1f} M tokens/s x 4 bytes = {tok_s*4/1e6:.0f} MB/s")
    return ckpt


def young_daly(delta: float, mtbf: float) -> float:
    return math.sqrt(2 * delta * mtbf)


def failures() -> None:
    print("\nfailures (rate scaled from 419 interruptions / 54 days / 16,384 GPUs)")
    print(f"  per GPU: one interruption every {1/FAIL_PER_GPU_DAY/365:.1f} years")
    print(f"  {'GPUs':>7} {'job MTBF':>9} {'ckpt cost':>10} {'restart':>8} {'interval':>9} {'goodput':>8}")
    for n in (1024, 4096, 8192, 16384, 32768):
        mtbf = 86400 / (FAIL_PER_GPU_DAY * n)
        for delta, restart in ((60, 1800), (5, 600)):
            tau = young_daly(delta, mtbf)
            # lost fraction: checkpoint overhead + expected rework + restart per failure
            waste = delta / tau + (tau / 2 + restart) / mtbf
            print(f"  {n:>7,} {mtbf/3600:>8.1f}h {delta:>9}s {restart/60:>6.0f}m {tau/60:>7.0f}m {1-waste:>8.1%}")


if __name__ == "__main__":
    s = compute()
    memory_and_network(s)
    storage(s)
    failures()
```

Run it with `python3 cluster.py`:

```text
compute
  6ND = 6 x 70e9 x 15e12 = 6.30e+24 FLOPs
  at 40% MFU of 989 TFLOP/s: 4.42 M GPU-hours = 22.5 days on 8,192 GPUs, if nothing ever fails
  one step of 16 M tokens: 2.07 s

memory and network
  training state at 16 bytes/param: 1.12 TB -> must be sharded over at least 14 x 80 GB GPUs before activations
  TP 8 x PP 4 = 32 GPUs per replica, 256 data-parallel replicas
  per-GPU gradient shard 4.38 GB; ring all-reduce sends 8.72 GB per GPU
  at 400 Gb/s that is 0.17 s per step, 8% of a 2.07 s step unless overlapped with the backward pass

storage
  checkpoint (weights + optimizer, 14 bytes/param): 0.98 TB
    written at  20 GB/s aggregate:    49 s
    written at 100 GB/s aggregate:    10 s
    written at 500 GB/s aggregate:     2 s
  training data read rate: 7.7 M tokens/s x 4 bytes = 31 MB/s

failures (rate scaled from 419 interruptions / 54 days / 16,384 GPUs)
  per GPU: one interruption every 5.8 years
     GPUs  job MTBF  ckpt cost  restart  interval  goodput
    1,024     49.5h        60s     30m      77m    96.4%
    1,024     49.5h         5s     10m      22m    98.9%
    4,096     12.4h        60s     30m      39m    90.8%
    4,096     12.4h         5s     10m      11m    97.2%
    8,192      6.2h        60s     30m      27m    84.6%
    8,192      6.2h         5s     10m       8m    95.2%
   16,384      3.1h        60s     30m      19m    73.5%
   16,384      3.1h         5s     10m       6m    91.6%
   32,768      1.5h        60s     30m      14m    53.0%
   32,768      1.5h         5s     10m       4m    85.0%
```

The failure table is the part to study. At 1,024 GPUs, even slow checkpoints
and restarts lose under 4%. At 16,384 GPUs the same operations lose 26% of the
cluster, while async checkpoints and 10-minute restarts lose about 8%, in line
with the "above 90%" Meta reports. At 32,768 GPUs the slow regime wastes almost
half the cluster. **The larger the job, the more of its efficiency comes from
operations rather than from hardware.**

## Where it breaks

- **MFU is measured, not chosen.** It depends on model shape, sequence length,
  parallelism layout, kernel quality, and network health. Plan with a
  conservative figure and measure early on a small slice of the cluster.
- **Failure rates are fleet-specific.** New fleets show early-life failures;
  aging ones degrade. The Llama 3 rate is one data point from one operator;
  derive your own from your own interruption log.
- **The Young/Daly formula assumes independent, memoryless failures.** Real
  failures cluster (a bad rack, a firmware rollout, a cooling event), and
  restarts themselves can fail.
- **Overlap is assumed, not guaranteed.** The 8% all-reduce figure becomes real
  step time if the framework cannot overlap communication, or if a single slow
  link stretches every collective.
- **The program is arithmetic.** It ignores attention FLOPs, activation memory,
  pipeline bubbles, and restart failures. It shows how the terms scale.

## Remember this

- Training FLOPs ≈ 6 × parameters × tokens; divide by peak × MFU for GPU-seconds.
- About 16 bytes per parameter of training state forces sharding; put tensor parallelism on NVLink and data parallelism on the fabric.
- Checkpoint bandwidth, not data loading, sizes training storage.
- Job MTBF falls linearly with GPU count: thousands of GPUs means interruptions every few hours.
- Interval ≈ √(2 × checkpoint cost × MTBF); goodput comes from cheap checkpoints and fast restarts.

## Try it

1. In `cluster.py`, set `PARAMS = 405e9` and `TOKENS = 15.6e12`, and `GPUS =
   16384`. How many days does the ideal run take at 40% MFU, and how large is
   a checkpoint?
2. Change `NIC_GBPS` to 100. What fraction of a step is the all-reduce now, and
   what does that imply about overlap?
3. Find the restart time at which a 16,384-GPU job with 5 s checkpoints drops
   below 85% goodput.
4. Halve the failure rate (better burn-in). How much does that buy at 32,768
   GPUs compared with halving restart time?

## Check yourself

1. Where does the factor 6 in 6ND come from?

   {{< details summary="Show answer" >}}
   Each parameter takes part in one multiply-add (2 FLOPs) per token in the
   forward pass, and the backward pass costs about twice the forward pass
   (gradients with respect to activations and to weights), giving 2 + 4 = 6.
   {{< /details >}}

2. Why does tensor parallelism stay inside a node?

   {{< details summary="Show answer" >}}
   It needs an all-reduce of activations in every layer, forward and backward,
   which is far more frequent communication than data parallelism's once per
   step. Only NVLink inside a node has the bandwidth and latency for that.
   {{< /details >}}

3. Each GPU fails once every 5.8 years. Why does a 16,384-GPU job fail every
   few hours?

   {{< details summary="Show answer" >}}
   The job stops if any one of its components fails, so failure rates add.
   16,384 GPUs each failing at 1/(5.8 years) give a combined rate of about one
   failure every 3 hours.
   {{< /details >}}

4. What does the Young/Daly interval balance?

   {{< details summary="Show answer" >}}
   Checkpointing often costs time on every checkpoint; checkpointing rarely
   loses more work per failure (on average half an interval). The square-root
   formula minimizes their sum given the checkpoint cost and the MTBF.
   {{< /details >}}

5. Why is a hot spare node worth its idle cost in a large job?

   {{< details summary="Show answer" >}}
   Restart time is paid on every failure, and failures come every few hours.
   A spare already burned in and running lets the job restart immediately
   instead of waiting for diagnosis and repair, which can be worth far more
   than one node's share of the cluster.
   {{< /details >}}

## Sources

- J. Kaplan et al., [Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361), 2020.
- A. Chowdhery et al., [PaLM: Scaling Language Modeling with Pathways](https://arxiv.org/abs/2204.02311) (definition of MFU), 2022.
- A. Grattafiori et al. (Llama team, Meta), [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783), 2024 (interruptions, MFU, effective training time).
- Z. Jiang et al., [MegaScale: Scaling Large Language Model Training to More Than 10,000 GPUs](https://arxiv.org/abs/2402.15627), USENIX NSDI, 2024.
- S. Rajbhandari et al., [ZeRO: Memory Optimizations Toward Training Trillion Parameter Models](https://arxiv.org/abs/1910.02054), SC, 2020.
- D. Narayanan et al., [Efficient Large-Scale Language Model Training on GPU Clusters Using Megatron-LM](https://arxiv.org/abs/2104.04473), SC, 2021.
- P. Patarasuk, X. Yuan, Bandwidth optimal all-reduce algorithms for clusters of workstations, Journal of Parallel and Distributed Computing, 2009.
- J. W. Young, [A first order approximation to the optimum checkpoint interval](https://doi.org/10.1145/361147.361115), Communications of the ACM, 1974.
- J. T. Daly, [A higher order estimate of the optimum checkpoint interval for restart dumps](https://doi.org/10.1016/j.future.2004.11.016), Future Generation Computer Systems, 2006.
- Z. Wang et al., [GEMINI: Fast Failure Recovery in Distributed Training with In-Memory Checkpoints](https://dl.acm.org/doi/10.1145/3600006.3613145), ACM SOSP, 2023.
- H. D. Dixit et al., [Silent Data Corruptions at Scale](https://arxiv.org/abs/2102.11245), 2021.
- Meta Engineering, [Building Meta's GenAI Infrastructure](https://engineering.fb.com/2024/03/12/data-center-engineering/building-metas-genai-infrastructure/), March 2024.
- NVIDIA, [H100 Tensor Core GPU datasheet](https://www.nvidia.com/en-us/data-center/h100/), read October 2026.
- PyTorch, [Distributed Checkpoint](https://pytorch.org/docs/stable/distributed.checkpoint.html), documentation, read October 2026.
