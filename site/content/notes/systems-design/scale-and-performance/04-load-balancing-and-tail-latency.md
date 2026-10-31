+++
title = 'Load balancing and tail latency'
description = 'When a request waits on many servers, the slowest one sets its latency. Load balancers that look at outstanding work keep a slow server from poisoning the tail, two random choices get most of the benefit, and hedged requests cut the remaining tail for a few percent of extra load.'
question = 'How should requests be spread over servers so that one slow server does not set everyone’s latency, and how do you cut the tail that remains?'
weight = 4
difficulty = 4
prerequisites = ['/notes/systems-design/scale-and-performance/01-queueing-and-littles-law', '/notes/systems-design/failure-modes/02-retries-and-idempotency']
date = 2026-10-30T06:20:00Z
lastmod = 2026-10-30T06:20:00Z
verified = 2026-10-30
+++

## The idea in one minute

A load balancer decides which server each request waits on. Policies that
ignore load, round robin and random, give a slow server its full share of
traffic, and its queue becomes everyone's tail. Policies that look at
**outstanding requests** steer work away from it. Asking just **two random
servers** and taking the less loaded one gets almost all the benefit of
checking every server, and it degrades gracefully when the load information is
stale, where "always pick the least loaded" makes every balancer pile onto the
same server.

Fan-out makes the tail matter more. A request that waits for 100 leaves is as
slow as the slowest of them, so a 1-in-100 leaf stall is in most user requests.
Dean and Barroso's remedy in "The Tail at Scale" is to stop waiting on the
straggler: **hedge** by sending a second copy after a short delay, or **tie**
two copies so that whichever starts first cancels the other. A hedge after the
95th-percentile latency costs about 5% more leaf calls.

The consequence to act on: **balance on outstanding work, not on turns, give
every hedge and retry a budget, and set leaf latency targets from the fan-out**,
because a leaf's p99 is not the user's p99.

## A picture

```mermaid {title="Power of two choices: sample two backends, send to the one with less outstanding work"}
flowchart LR
  R["<b>Request</b>"] --> LB["<b>Balancer</b><br/><small>pick 2 at random</small>"]
  LB --> A["<b>Backend 4</b><br/><small>3 outstanding</small>"]
  LB --> B["<b>Backend 0</b><br/><small>slow, 11 outstanding</small>"]
  A --> D{"<b>Fewer<br/>outstanding?</b>"}
  B --> D
  D -->|"backend 4"| S["<b>Send</b><br/><small>slow backend skipped</small>"]
  class R io
  class LB,A compute
  class B warn
  class D,S good
```

A slow backend accumulates outstanding requests, so it loses most comparisons
and receives roughly what it can serve. No health check had to notice it.

## How it really works

### Where the tail comes from

"The Tail at Scale" lists the ordinary causes of latency variability on
shared machines: contention for CPU, memory bandwidth, and network with other
tenants; background daemons and maintenance jobs; garbage collection and log
compaction; queueing at every layer; and power and thermal throttling. None of
these is a bug, and none goes away at scale. The paper's argument is that
large services must be **tail-tolerant**, as they are fault-tolerant, rather
than hoping to remove every source.

The fan-out arithmetic is in
[back-of-the-envelope capacity](/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity/):
with n independent leaves, P(user request fast) = qⁿ when each leaf is fast
with probability q. Turn it around to set a leaf target: for 99% of user
requests to see no slow leaf, each leaf needs q = 0.99^(1/n).

| Leaves per request | Leaf percentile that must meet the user's p99 target |
| --- | --- |
| 1 | p99 |
| 10 | p99.9 |
| 100 | p99.99 |
| 1,000 | p99.999 |

A p99.99 is hard to even measure: it takes about a million samples to see a
hundred events beyond it. This is why fan-out services reduce fan-out, make
leaves tail-tolerant, or stop waiting for stragglers, instead of tuning every
leaf.

### Balancing policies

| Policy | Chooses | Strength | Weakness |
| --- | --- | --- | --- |
| Round robin | Next backend in turn | No state, even request counts | Ignores load; a slow backend gets a full share |
| Random | Uniformly at random | No state | Same, plus random clumping |
| Weighted round robin | In turn, by configured weight | Handles known capacity differences | Weights go stale when backends degrade |
| Least outstanding | Fewest requests in flight, over all backends | Best with fresh, complete information | Herds when information is stale or shared by many balancers |
| **Power of two choices** | Less loaded of two random backends | Nearly as good, robust to staleness, O(1) | Still needs a load signal |
| Latency-weighted (EWMA) | Lowest recent latency, often combined with outstanding count | Reacts to slow backends directly | Can oscillate; a backend that fails fast looks fast |
| Consistent hash | Hash of a key | Affinity for caches and sessions | Ignores load unless bounded |

As of October 2026, Envoy's default policy is round robin; its least-request
policy uses power of two choices by default (a choice count of 2) when
backends have equal weights. Check what your proxy, mesh, or client library
actually does; defaults differ between products and versions.

### Why two choices are enough

Throw n balls into n bins at random and the fullest bin holds about
ln n / ln ln n balls. Let each ball look at two random bins and go to the
emptier one, and the fullest holds about ln ln n / ln 2: an exponential
improvement from one extra look (Azar, Broder, Karlin, and Upfal, 1994).

The queueing version is the **supermarket model** (Vvedenskaya, Dobrushin,
and Karpelevich, 1996; Mitzenmacher, 1996). With many servers, exponential
service, and each server at load λ, the fraction of servers holding at least i
requests is λⁱ under random assignment and λ^(2ⁱ − 1) with two choices. At
λ = 0.9:

| Requests at a server | Random: λⁱ | Two choices: λ^(2ⁱ − 1) |
| --- | --- | --- |
| at least 1 | 90% | 90% |
| at least 2 | 81% | 73% |
| at least 3 | 73% | 48% |
| at least 5 | 59% | 3.8% |

Long queues become doubly exponentially rare. More choices help a little more;
the big step is from one to two.

### Stale information and herding

Load information is never current. A balancer sees its own outstanding
counts, or reports from backends that are milliseconds to seconds old. With
stale data, "send to the least loaded" is dangerous: every request in the
staleness window goes to the backend that looked emptiest, and it is flooded
before the next report. Mitzenmacher (2000) analyzed exactly this and found
that choosing the best of two random servers degrades gracefully as
information ages, while choosing the best of all servers can be worse than
random. The simulation below shows the effect at 20 ms staleness: least
outstanding's median rises from 7.2 ms to 22.1 ms, and two choices' from 7.7
ms to 9.7 ms.

The same herding happens with many independent balancers that each see a
different, partial view, which is the normal case for client-side balancing
and sidecar proxies.

### The slow backend

The most common balancing incident is a backend that is slow but healthy by
every check: a bad disk, a noisy neighbor, a garbage-collection spiral, a
thermal throttle. Huang and colleagues (2017) call this **gray failure**:
the failure detector and the clients disagree about whether the backend works.
From the simulation, ten backends with one five times slower, at 70% of fleet
capacity, where requests queued for more than 1 s time out:

| Policy | p50 | p99 | p99.9 | Timed out | Share sent to slow backend |
| --- | --- | --- | --- | --- | --- |
| Round robin | 8.0 ms | 1,057 ms | 1,170 ms | 6.85% | 10.0% |
| Random | 9.8 ms | 1,054 ms | 1,170 ms | 6.86% | 10.0% |
| Least outstanding | 7.2 ms | 60 ms | 165 ms | 0.00% | 2.6% |
| Least outstanding, 20 ms stale | 22.1 ms | 193 ms | 557 ms | 0.00% | 2.6% |
| Two choices | 7.7 ms | 71 ms | 179 ms | 0.00% | 3.0% |
| Two choices, 20 ms stale | 9.7 ms | 102 ms | 228 ms | 0.00% | 3.0% |

The slow backend can serve 2.2% of the fleet's capacity. Round robin sends it
10%, three times what it can handle, so about 69% of its requests time out and
the whole service loses 6.9% of its traffic while the fleet is 70% busy. The
load-aware policies send it close to its capacity share without anyone
noticing it is slow.

Two refinements matter in production:

- **Outlier detection** ejects a backend whose error rate or latency stands
  out from its peers for a while (Envoy's outlier detection is an example),
  covering the cases a load signal cannot.
- **Failing fast attracts traffic.** A backend that returns errors in a
  millisecond has few outstanding requests and wins every comparison, so it
  receives more traffic and fails more of it. Count errors as a penalty in the
  balancing decision, as [overload and backpressure](/notes/systems-design/failure-modes/04-overload-and-backpressure/)
  notes.

### Subsetting

With thousands of clients and thousands of backends, a full mesh of
connections costs memory and health-check traffic on every node. The Google
SRE book describes **deterministic subsetting**: each client connects to a
fixed-size subset of backends, chosen so that every backend gets about the
same number of clients. Small subsets cost pooling and give two-choice
selection fewer options, and if subsets are chosen badly, backends receive
uneven load. Choose the subset size from the arithmetic, not from the
connection limit alone.

### Hedged and tied requests

**Hedged requests** send the same read to a second replica if the first has not
answered after a delay d, use whichever reply arrives first, and cancel the
other. If d is the 95th-percentile latency for that request class, about 5% of
requests send a second copy. The paper reports a Google benchmark that reads
1,000 keys spread over 100 servers: hedging after 10 ms cut the 99.9th
percentile from 1,800 ms to 74 ms while sending 2% more requests.

**Tied requests** remove the delay. The client enqueues the request on two
servers at once, each tagged with the other's identity. When one starts
executing it, it tells the other to cancel. Most of the time the duplicate is
cancelled while still in the queue, so the extra work is small, and the request
waits only in the shorter of two queues. Because both servers might start at
once if both are idle, the paper suggests a small delay between the two sends.

```mermaid {title="A hedged read: the second copy wins and the first is cancelled"}
sequenceDiagram
  autonumber
  participant C as Client
  participant A as Replica A
  participant B as Replica B
  C->>A: read k
  Note over C: no reply by the p95 delay
  C->>B: read k (hedge)
  B-->>C: value
  rect rgb(226, 239, 216)
    C->>A: cancel
  end
  Note over A: was stalled in GC
```

Rules for hedging that is safe at scale:

- **Hedge only idempotent operations.** A hedged write is a duplicated write
  unless it carries an idempotency key; see
  [retries and idempotency](/notes/systems-design/failure-modes/02-retries-and-idempotency/).
- **Give hedges a budget.** If every replica is slow at once, every request
  hedges and the load doubles exactly when capacity is short. Cap hedges and
  retries together, for example at 5 to 10% of requests, the same way retry
  budgets work. gRPC's retry design (gRFC A6) supports a hedging policy with a
  maximum number of attempts and a delay, and its retry throttling stops both
  hedges and retries when too many fail.
- **Cancel the loser.** Without cancellation the duplicate still consumes a
  server.
- **Hedging needs independent slowness.** If the slowness comes from the
  request itself, a huge key or an expensive query, every replica is slow and
  the hedge only adds load.

"The Tail at Scale" also describes techniques beyond hedging: splitting data
into many small partitions so that a slow machine's load can be moved quickly,
replicating hot items more widely, putting slow machines on probation until
they recover, and returning **good-enough** results when a few leaves of a
search are late.

### Balancing model servers

Requests to a language model differ in cost by orders of magnitude: a short
classification prompt and a 100,000-token document summary are both "one
request". Balancing by request count is therefore a poor proxy. Signals that
fit better are queue depth, outstanding tokens, and KV cache utilization
reported by the engine, combined with prefix affinity so that requests reach
a replica that already holds their prefix, as described in
[partitioning and sharding](/notes/systems-design/scale-and-performance/03-partitioning-and-sharding/).
The Kubernetes [Gateway](/notes/systems-design/building-blocks/01-gateways-and-routers/) API Inference Extension defines an endpoint-picker
component for this kind of model-aware routing. Hedging a generation is
expensive because the duplicate holds an accelerator and KV memory for the
whole response; where it is used at all, it makes most sense before the first
token, cancelling the slower copy as soon as one starts streaming.

> [!IMPORTANT]
> A load balancer that does not look at outstanding work turns one slow
> backend into a fleet-wide tail. Prefer least-request with two random
> choices, add outlier detection, and penalize errors so a fast-failing
> backend does not attract traffic.

## Code

Part 1 simulates ten backends with four workers each and a 10 ms mean service
time; backend 0 is five times slower but never fails a health check. Poisson
traffic arrives at 70% of the fleet's capacity, and a request that would
queue for more than 1 s is dropped as timed out. Six policies choose a backend
for each request; the "stale" variants see outstanding counts refreshed every
20 ms. Part 2 models a request that fans out to 100 leaves, each usually taking
a few milliseconds but stalling 1% of the time, and compares no hedging with
hedging after the leaf p95 and after 10 ms.

```python {title="balancing.py"}
"""balancing.py: load-balancing policies with one slow backend, and hedged fan-out.

Part 1: 10 backends, each with 4 workers and a 10 ms mean service time, take
Poisson traffic at 70% of fleet capacity. Backend 0 is degraded (5x slower)
but still passes health checks. Six policies pick a backend per request; a
request that would queue for more than 1 s is dropped as timed out.
Part 2: a request fans out to 100 leaves and waits for all of them. Each leaf
call usually takes a few milliseconds but stalls 1% of the time. Hedging
sends a second copy to another replica if the first has not answered by a
delay, and takes whichever answers first.
Standard library only; seeded; runs offline in about fifteen seconds.
"""

from __future__ import annotations

import heapq
import random

BACKENDS, WORKERS, SERVICE = 10, 4, 0.010
SLOW_FACTOR = 5.0
LOAD = 0.70
REQUESTS = 300_000
STALE = 0.020  # load reports refreshed every 20 ms in the "stale" policies
TIMEOUT = 1.0  # a request still queued after 1 s is dropped: its client gave up


class Backend:
    def __init__(self, mean: float) -> None:
        self.mean = mean
        self.free = [0.0] * WORKERS  # heap: when each worker is next free
        self.done: list[float] = []  # heap: completion times of accepted requests

    def outstanding(self, now: float) -> int:
        while self.done and self.done[0] <= now:
            heapq.heappop(self.done)
        return len(self.done)

    def submit(self, now: float, rng: random.Random) -> float | None:
        if self.free[0] - now > TIMEOUT:
            return None  # would wait past the deadline: dropped without using a worker
        start = max(now, heapq.heappop(self.free))
        finish = start + rng.expovariate(1 / self.mean)
        heapq.heappush(self.free, finish)
        heapq.heappush(self.done, finish)
        return finish - now


def run(policy: str, seed: int = 3) -> tuple[float, float, float, float, float]:
    rng = random.Random(seed)
    fleet = [Backend(SERVICE * (SLOW_FACTOR if i == 0 else 1)) for i in range(BACKENDS)]
    # Capacity: 9 healthy backends at 400/s plus the slow one at 80/s.
    capacity = sum(WORKERS / b.mean for b in fleet)
    lam = LOAD * capacity
    t, rr, latencies, to_slow, timeouts = 0.0, 0, [], 0, 0
    snapshot, next_refresh = [0] * BACKENDS, 0.0
    for _ in range(REQUESTS):
        t += rng.expovariate(lam)
        if t >= next_refresh:
            snapshot = [b.outstanding(t) for b in fleet]
            next_refresh = t + STALE
        if policy == "round robin":
            k, rr = rr, (rr + 1) % BACKENDS
        elif policy == "random":
            k = rng.randrange(BACKENDS)
        elif policy == "least outstanding":
            k = min(range(BACKENDS), key=lambda i: (fleet[i].outstanding(t), rng.random()))
        elif policy == "least outstanding, stale":
            k = min(range(BACKENDS), key=lambda i: (snapshot[i], rng.random()))
        elif policy == "two choices":
            a, b = rng.sample(range(BACKENDS), 2)
            k = a if fleet[a].outstanding(t) <= fleet[b].outstanding(t) else b
        else:  # "two choices, stale"
            a, b = rng.sample(range(BACKENDS), 2)
            k = a if snapshot[a] <= snapshot[b] else b
        to_slow += k == 0
        latency = fleet[k].submit(t, rng)
        if latency is None:
            timeouts += 1
        else:
            latencies.append(latency)
    latencies.sort()
    q = lambda p: latencies[int(p * len(latencies))] * 1000
    return q(0.50), q(0.99), q(0.999), timeouts / REQUESTS, to_slow / REQUESTS


def leaf(rng: random.Random) -> float:
    """One leaf call in ms: lognormal around 4 ms, plus a 1% chance of a 50-150 ms stall."""
    base = rng.lognormvariate(1.3, 0.4)
    return base + (rng.uniform(50, 150) if rng.random() < 0.01 else 0.0)


def fanout(hedge_at: float | None, trials: int = 20_000, width: int = 100) -> tuple[float, float, float]:
    rng = random.Random(11)
    totals, extra = [], 0
    for _ in range(trials):
        slowest = 0.0
        for _ in range(width):
            first = leaf(rng)
            if hedge_at is not None and first > hedge_at:
                extra += 1  # a second copy goes to another replica at hedge_at
                first = min(first, hedge_at + leaf(rng))
            slowest = max(slowest, first)
        totals.append(slowest)
    totals.sort()
    return totals[len(totals) // 2], totals[int(0.99 * len(totals))], extra / (trials * width)


def main() -> None:
    print(f"Part 1: {BACKENDS} backends x {WORKERS} workers, {SERVICE * 1e3:.0f} ms mean; "
          f"backend 0 is {SLOW_FACTOR:.0f}x slower; load {LOAD:.0%} of capacity")
    print(f"{'policy':<27}{'p50':>8}{'p99':>9}{'p99.9':>9}{'timed out':>11}   sent to slow backend")
    for policy in ["round robin", "random", "least outstanding", "least outstanding, stale",
                   "two choices", "two choices, stale"]:
        p50, p99, p999, lost, share = run(policy)
        print(f"{policy:<27}{p50:>6.1f}ms{p99:>7.0f}ms{p999:>7.0f}ms{lost:>11.2%}   {share:6.1%}")
    print("(percentiles are over completed requests; the slow backend's share of capacity is "
          f"{(WORKERS / (SERVICE * SLOW_FACTOR)) / (9 * WORKERS / SERVICE + WORKERS / (SERVICE * SLOW_FACTOR)):.1%})")

    rng = random.Random(5)
    one = sorted(leaf(rng) for _ in range(200_000))
    p95, p99 = one[int(0.95 * len(one))], one[int(0.99 * len(one))]
    print(f"\nPart 2: one leaf call: p50 {one[len(one) // 2]:.1f} ms, p95 {p95:.1f} ms, "
          f"p99 {p99:.1f} ms; a request waits for 100 leaves")
    print(f"{'policy':<28}{'request p50':>12}{'request p99':>13}{'extra leaf calls':>18}")
    for name, at in [("no hedging", None), (f"hedge after p95 ({p95:.1f} ms)", p95),
                     (f"hedge after 10 ms", 10.0)]:
        m, t99, extra = fanout(at)
        print(f"{name:<28}{m:>10.1f}ms{t99:>11.1f}ms{extra:>17.1%}")


if __name__ == "__main__":
    main()
```

Run it with `python3 balancing.py`:

```text
Part 1: 10 backends x 4 workers, 10 ms mean; backend 0 is 5x slower; load 70% of capacity
policy                          p50      p99    p99.9  timed out   sent to slow backend
round robin                   8.0ms   1057ms   1170ms      6.85%    10.0%
random                        9.8ms   1054ms   1170ms      6.86%    10.0%
least outstanding             7.2ms     60ms    165ms      0.00%     2.6%
least outstanding, stale     22.1ms    193ms    557ms      0.00%     2.6%
two choices                   7.7ms     71ms    179ms      0.00%     3.0%
two choices, stale            9.7ms    102ms    228ms      0.00%     3.0%
(percentiles are over completed requests; the slow backend's share of capacity is 2.2%)

Part 2: one leaf call: p50 3.7 ms, p95 7.4 ms, p99 57.8 ms; a request waits for 100 leaves
policy                       request p50  request p99  extra leaf calls
no hedging                        84.7ms      153.3ms             0.0%
hedge after p95 (7.4 ms)          11.0ms       22.4ms             5.0%
hedge after 10 ms                 13.2ms       25.6ms             1.6%
```

What to read from it:

- **Load-blind policies fail on one bad backend.** Round robin and random lose
  6.9% of requests and push the p99 past one second with 30% of the fleet idle.
- **Two choices are close to the best policy with fresh data** (71 ms against
  60 ms at p99) and much better with stale data (102 ms against 193 ms, and a
  median of 9.7 ms against 22.1 ms).
- **Fan-out moves the leaf tail into the median.** With 100 leaves and a 1%
  stall, the median request takes 85 ms although the median leaf takes 3.7 ms.
- **Hedging is cheap at the leaf and large at the request.** Hedging after the
  leaf p95 cuts the request p99 from 153 ms to 22 ms for 5% more leaf calls;
  waiting until 10 ms costs 1.6% and gives 26 ms.

## Where it breaks

- **One balancer with perfect counts is a best case.** Real fleets have many
  balancers, each with a partial view. The stale rows are closer to reality
  than the fresh ones.
- **Extra load is free in the hedging model.** Part 2 draws each hedge from an
  independent, unloaded replica. Real hedges add 2 to 5% load, which raises
  everyone's queueing a little, and their benefit depends on slowness being
  independent across replicas.
- **Exponential service at identical backends.** The supermarket-model results
  and the simulation assume interchangeable requests. With very variable
  request costs, such as model inference, request counts mislead and the load
  signal must measure work.
- **Load-aware balancing can hide a sick backend.** Routing around a slow
  machine keeps the service healthy and leaves the machine broken. Alert on
  the balancer's skew and on outlier ejections, and fix or replace the host.
- **Timeouts are the last line, not the fix.** The round-robin rows look
  bounded only because requests were dropped at 1 s; without a deadline the
  slow backend's queue grows without limit.

## Remember this

- With n leaves, each leaf needs a 0.99^(1/n) percentile within the user's
  p99 target: p99.99 for 100 leaves.
- Round robin and random give a slow but healthy backend its full share; its
  queue becomes the fleet's tail.
- Two random choices on outstanding requests get most of the benefit of
  checking all backends, and tolerate stale data.
- Choosing the single least loaded backend with stale data causes herding.
- Hedge after about the p95, cancel the loser, keep a budget, and hedge only
  idempotent reads.
- Penalize errors so that a backend failing fast does not attract traffic.

## Try it

1. Run `balancing.py`. Make backends 0 and 1 slow. Which policies still have
   no timeouts, and what share of traffic does each slow backend receive?
2. Raise `STALE` to 100 ms. How do least outstanding and two choices compare
   now? Add a "three choices, stale" policy and see where it lands.
3. Make backend 0 fail fast instead of slowly: it returns an error in 1 ms for
   half of its requests. Which policy sends it the most traffic, and how would
   you change the selection rule?
4. In `fanout`, make 0.5% of requests slow on every replica (a slow key, not a
   slow machine). How much does hedging help those requests, and how much extra
   load does it add?
5. Find your proxy's or client library's default balancing policy and its
   outlier-detection settings. Would it route around a backend that is five
   times slower but returns no errors?

## Check yourself

1. A search request fans out to 50 index shards and waits for all of them.
   What per-shard percentile must meet the latency target for 99% of user
   requests to meet it?

   {{< details summary="Show answer" >}}
   q = 0.99^(1/50) ≈ 0.9998, so each shard must meet the target at about its
   p99.98. Equivalently, each shard can miss it on only about 1 call in 5,000.
   {{< /details >}}

2. Why does round robin hurt the p99 when one backend is slow but passes
   health checks?

   {{< details summary="Show answer" >}}
   Round robin sends every backend the same share regardless of its speed. The
   slow backend receives more than it can serve, so its queue grows until
   requests time out, and every request routed to it is in the tail. Load-aware
   policies see its outstanding count rise and send it less.
   {{< /details >}}

3. Why is choosing the less loaded of two random backends more robust than
   choosing the least loaded of all, when the load reports are a few
   milliseconds old?

   {{< details summary="Show answer" >}}
   With stale data, the least-loaded-of-all rule sends every request in the
   staleness window to the same backend, which is flooded before its report
   updates. Two random choices spread requests across many backends while
   still avoiding the busiest ones, so no single backend receives the whole
   burst.
   {{< /details >}}

4. A team adds hedging after 20 ms to every call. During an incident where a
   shared database slows all replicas to 200 ms, what happens and what should
   have limited it?

   {{< details summary="Show answer" >}}
   Every call exceeds 20 ms, so every call hedges, doubling load on a database
   that is already the bottleneck and slowing it further. A hedge budget (a cap
   on the fraction of requests that may hedge, shared with retries) and
   throttling when most attempts are slow would have kept the extra load to a
   few percent.
   {{< /details >}}

5. How do tied requests avoid both the delay of hedging and the cost of
   always sending two copies?

   {{< details summary="Show answer" >}}
   Both copies are enqueued at once, each tagged with the other server's
   identity. Whichever server starts the request first tells the other to
   cancel its copy, which is usually still waiting in the queue. The request
   waits only in the shorter queue, and the duplicate rarely consumes any
   service time.
   {{< /details >}}

## Sources

- J. Dean, L. A. Barroso, [The Tail at Scale](https://cacm.acm.org/research/the-tail-at-scale/),
  *Communications of the ACM* 56(2), February 2013.
- Y. Azar, A. Z. Broder, A. R. Karlin, E. Upfal, "Balanced Allocations", ACM
  STOC, 1994; *SIAM Journal on Computing* 29(1), 1999.
- N. D. Vvedenskaya, R. L. Dobrushin, F. I. Karpelevich, "Queueing System with
  Selection of the Shortest of Two Queues: An Asymptotic Approach", *Problems
  of Information Transmission* 32(1), 1996.
- M. Mitzenmacher, "The Power of Two Choices in Randomized Load Balancing",
  *IEEE Transactions on Parallel and Distributed Systems* 12(10), 2001.
- M. Mitzenmacher, "How Useful Is Old Information?", *IEEE Transactions on
  Parallel and Distributed Systems* 11(1), 2000.
- P. Huang et al., "Gray Failure: The Achilles' Heel of Cloud-Scale Systems",
  HotOS, 2017.
- B. Beyer, C. Jones, J. Petoff, N. R. Murphy (eds.), *Site Reliability
  Engineering*, O'Reilly, 2016: [Load Balancing in the
  Datacenter](https://sre.google/sre-book/load-balancing-datacenter/).
- Envoy documentation, [Supported load
  balancers](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/load_balancers)
  and [Outlier detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier).
- gRPC, [A6: gRPC Retry Design](https://github.com/grpc/proposal/blob/master/A6-client-retries.md)
  (retries, hedging, and retry throttling).
- Kubernetes SIGs, [Gateway API Inference Extension](https://gateway-api-inference-extension.sigs.k8s.io/).
- A. Vulimiri et al., "Low Latency via Redundancy", ACM CoNEXT, 2013.
