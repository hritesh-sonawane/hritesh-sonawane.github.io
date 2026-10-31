+++
title = "Queueing and Little's law"
description = "A service is a network of queues. Little's law finds where requests are waiting, Erlang C shows why big shared pools run hotter than small ones, and Kingman's formula shows why variable work and bursty arrivals cost as much as missing capacity."
question = 'Where do requests wait inside a service, how many servers does a pool need, and why does variability matter as much as load?'
weight = 1
difficulty = 3
prerequisites = ['/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity', '/notes/systems-design/failure-modes/04-overload-and-backpressure']
date = 2026-10-30T06:05:00Z
lastmod = 2026-10-30T06:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

[Back-of-the-envelope capacity](/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity/)
introduced Little's law and the single-server queue. Real services are not one
server. A request passes through a load balancer, a worker pool, a connection
pool, a database, and perhaps an accelerator, and it can wait at each. Three
results carry most of the practical weight:

- **Little's law per stage**, with the utilization law U = X × D, finds the
  stage that saturates first and says how much concurrency each stage holds.
- **Erlang C** for c servers sharing one queue shows that pooling cuts waiting
  sharply, and that the headroom a pool needs shrinks with its size: a pool of
  1,000 can run at 97% busy with the same chance of waiting as a pool of 4 at 50%.
- **Kingman's formula** shows that waiting scales with the variability of
  arrivals and of service times, (ca² + cs²) / 2, as well as with ρ / (1 − ρ).

The consequence to act on: **find the bottleneck by arithmetic before tuning
anything, share pools where you can, and treat variability (bursts, retries,
mixed request sizes) as load**, because it fills queues the same way.

## A picture

```mermaid {title="A request waits at every stage; the stage with the highest utilization sets the limit"}
flowchart LR
  A["<b>Arrivals</b><br/><small>1,200 req/s</small>"] --> W["<b>Worker pool</b><br/><small>CPU 2 ms/req<br/>U = 7.5%</small>"]
  W --> C["<b>Connection pool</b><br/><small>3 queries/req</small>"]
  C --> D["<b>Database</b><br/><small>3 × 4 ms CPU/req<br/>U = 90%</small>"]
  W --> X["<b>Auth service</b><br/><small>30 ms held<br/>36 of 400 in use</small>"]
  D --> R["<b>Response</b>"]
  X --> R
  class A io
  class W,X compute
  class C queue
  class D warn
  class R io
```

The database is the stage to watch: at 90% busy it holds most of the queueing
delay, and a 10% rise in load or a retry storm takes it to saturation.

## How it really works

### Little's law, one stage at a time

L = λW holds for any stable system you draw a boundary around: the whole
service, one thread pool, one database, one GPU. Draw the boundary around each
stage and you get the concurrency each stage must hold. Two companion results
from operational analysis (Denning and Buzen, 1978) finish the job:

- **Utilization law**: U = X × S. A resource completing X requests per second,
  each taking S seconds of its time, is busy U of the time.
- **Forced flow law**: a stage visited V times per request sees V × X
  arrivals. Its **service demand** per request is D = V × S.

The stage with the largest demand per unit of capacity saturates first, and
the system's maximum throughput is capacity divided by that demand. For the
service in the picture:

| Resource | Demand per request | Capacity | Utilization at 1,200 req/s | Saturates at |
| --- | --- | --- | --- | --- |
| API CPU | 2 ms × 1 visit | 32 cores | 1,200 × 0.002 / 32 = 7.5% | 16,000 req/s |
| Database CPU | 4 ms × 3 queries = 12 ms | 16 cores | 1,200 × 0.012 / 16 = 90% | 1,333 req/s |
| Auth connections | 30 ms held | 400 connections | 36 in use, 9% | 13,333 req/s |

Adding API nodes does nothing for this service: the ceiling is 1,333 requests
per second at the database, and at 90% it is already on the steep part of the
queueing curve. If 10% of requests are retried once, the database sees 1,320
requests' worth of queries and runs at 99%. The fixes, in order of cost, are
fewer queries per request, cheaper queries, a cache in front (the next lesson),
and more database capacity.

### Little's law for streaming responses

The law applies unchanged to streams that last seconds instead of
milliseconds, and that is where it bites in model serving. Suppose a chat
service starts 40 responses per second, each streaming 600 tokens at 40 tokens
per second after a 0.5 s time to first token:

- Time in system W = 0.5 + 600 / 40 = 15.5 s.
- Concurrent streams L = 40 × 15.5 = **620**.
- Decode throughput = 620 × 40 = **24,800 tokens per second**.
- With 4,000 tokens of context per stream at 128 KiB of KV cache per token (the
  8-billion-parameter model in
  [the multi-tenant inference gateway](/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway/)),
  memory = 620 × 4,000 × 131,072 bytes ≈ **325 GB**, or seven accelerators
  with 50 GB of KV budget each, before any headroom.

Now let decode slow from 40 to 20 tokens per second under load. W becomes
30.5 s, L becomes 1,220 streams, and the KV memory needed doubles to about
640 GB. Slower service raises concurrency, which raises memory pressure, which
forces the engine to queue or preempt sequences, which slows service further.
This is the same feedback loop as the downstream slowdown in the capacity
lesson, with memory instead of threads as the resource that runs out.

### Many servers, one queue: M/M/c and Erlang C

With c identical servers taking work from one queue (M/M/c), the probability
that an arrival has to wait at all is Agner Erlang's C formula (1917). With
offered load a = λ / μ (in Erlangs, the average number of busy servers) and
ρ = a / c:

**P(wait) = C(c, a)**, and the mean wait in queue is **Wq = C(c, a) / (cμ − λ)**.

The formula has a numerically stable form through Erlang B: start with B = 1,
apply B ← aB / (k + aB) for k = 1 … c, then C = B / (1 − ρ(1 − B)). The
program below does exactly that.

Eight servers sharing one queue behave very differently from eight servers
with a queue each. From the simulation, at the same per-server utilization:

| Busy | P(wait), shared | Mean W, shared | p99 W, shared | Mean W, 8 separate queues | p99 W, separate |
| --- | --- | --- | --- | --- | --- |
| 50% | 5.7% | 20.2 ms | 92 ms | 40.1 ms | 186 ms |
| 80% | 46.1% | 25.9 ms | 103 ms | 101.5 ms | 478 ms |
| 90% | 70.7% | 38.3 ms | 141 ms | 213.1 ms | 989 ms |
| 95% | 83.5% | 57.2 ms | 216 ms | 402.0 ms | 1,864 ms |

With separate queues, a request can wait behind a long job while another
server sits idle. With one shared queue that never happens, so waiting only
starts when every server is busy. The same logic explains why load balancers
that route by outstanding requests beat random routing, covered in
[load balancing and tail latency](/notes/systems-design/scale-and-performance/04-load-balancing-and-tail-latency/).

```mermaid {title="Mean time in system, 8 servers, 20 ms service: one shared queue against eight separate ones"}
xychart-beta
  x-axis "Utilization per server" ["50%", "70%", "80%", "90%", "95%"]
  y-axis "Mean time in system (ms)" 0 --> 420
  line [20.2, 22.3, 25.9, 38.3, 57.2]
  line [40.1, 67.5, 101.5, 213.1, 402.0]
```

The lower line is the shared queue. Both lines describe the same servers and
the same traffic.

### Square-root staffing: why big pools run hot

Hold the chance of waiting fixed and ask how many servers a pool needs as load
grows. Halfin and Whitt (1981) showed that with **c ≈ a + β√a** servers,
P(wait) tends to a constant that depends only on β; β = 1 gives about 22%.
The spare capacity grows like √a, not like a, so utilization rises with scale:

| Offered load a | Servers for P(wait) ≤ 20% | Utilization | a + √a |
| --- | --- | --- | --- |
| 2 | 4 | 50% | 3 |
| 10 | 14 | 71% | 13 |
| 100 | 111 | 90% | 110 |
| 1,000 | 1,034 | 97% | 1,032 |

Two consequences:

- **A small fleet needs proportionally more headroom.** A two-instance service
  at 70% busy and a 200-instance service at 70% busy are not equally safe.
- **Every split costs capacity.** Dividing one pool of 100 Erlangs into ten
  pools of 10 (per tenant, per model, per region) takes the server count from
  111 to 140 for the same waiting target. That is the price of the isolation
  in [blast radius and cells](/notes/systems-design/failure-modes/05-blast-radius-and-cells/),
  and it is often worth paying. Know the number when you decide. For
  accelerators, where one server costs as much as a small team, the price of
  per-model pools is usually the largest line in the capacity plan.

### Variability: Kingman's formula

The capacity lesson gave the Pollaczek–Khinchine formula for random arrivals
and general service times. John Kingman's heavy-traffic approximation (1961)
extends it to general arrivals too (G/G/1):

**Wq ≈ S × ρ / (1 − ρ) × (ca² + cs²) / 2**

where ca and cs are the coefficients of variation (standard deviation over
mean) of the gaps between arrivals and of service times. Poisson arrivals and
exponential service both have a CV of 1, and the formula reduces to M/M/1. It
is exact for Poisson arrivals and a good approximation as ρ approaches 1.
From the simulation at 80% busy and a 20 ms mean service time:

| ca | cs | Simulated mean wait | Kingman |
| --- | --- | --- | --- |
| 1 | 0 | 40.3 ms | 40.0 ms |
| 1 | 1 | 79.4 ms | 80.0 ms |
| 1 | 2 | 200.1 ms | 200.0 ms |
| 1 | 4 | 670.2 ms | 680.0 ms |
| 0 | 1 | 34.2 ms | 40.0 ms |
| 2 | 1 | 199.0 ms | 200.0 ms |

Arrival burstiness and service variability enter symmetrically. Bursts come
from retries, cron jobs, batch clients, and synchronized timers; doubling ca
from 1 to 2 costs as much as doubling cs.

Service variability is usually a mix of request classes. Take an endpoint
where 95% of requests take 5 ms and 5% take 200 ms:

- Mean S = 0.95 × 5 + 0.05 × 200 = 14.75 ms.
- E[S²] = 0.95 × 25 + 0.05 × 40,000 = 2,023.75 ms², so the standard
  deviation is √(2,023.75 − 14.75²) ≈ 42.5 ms and cs ≈ 2.9.
- (1 + cs²) / 2 ≈ 4.7. At 80% busy the mean wait is 4 × 14.75 × 4.7 ≈ 275 ms.

A 5 ms request waits 275 ms on average because it queues behind the slow 5%.
Separating the classes into their own pools removes that, at the cost of the
pooling benefit above. Large language model requests are an extreme case:
output length varies by orders of magnitude, which is why serving engines
schedule per decoding step rather than per request.

### Batching servers

Accelerators break one assumption of these models: service time per request
is not fixed, because one decoding step serves the whole batch, and a step
with 64 sequences takes only somewhat longer than a step with 8. Throughput
rises with batch size until memory or compute runs out. With continuous
batching, a new request waits at most one step for admission if there is
memory for its KV cache, so the queue that matters is the one for memory, and
its size comes from Little's law, as in the streaming example above.

### Open and closed systems

A **closed** system has a fixed population: N clients, each sending a request,
waiting for the answer, thinking for Z seconds, and sending again. Its
throughput is bounded by X = N / (R + Z), so when the server slows down, the
clients send less. An **open** system has arrivals that do not depend on
responses: users on the internet, upstream services, timers. When an open
system's server slows, the arrivals keep coming and the queue grows.

Schroeder, Wierman, and Harchol-Balter (2006) showed that the same server can
have very different response times under open and closed load, even at the
same mean throughput. The practical trap is a load test with 100 closed-loop
clients and zero think time: it cannot offer more than 100 / R requests per
second, so as the server slows, the test backs off and the tail looks
better than production. [Observability signals](/notes/systems-design/reliability-in-production/02-observability-signals/)
covers the measurement side of this, coordinated omission.

> [!IMPORTANT]
> Before tuning a slow service, compute U = X × D for every resource it uses.
> The one with the highest utilization is the bottleneck, and nothing else you
> change will raise the ceiling.

## Code

The program simulates three things and compares each with its formula: eight
servers with one shared queue against eight with separate queues; one server
at 80% busy with different arrival and service variability; and the server
count that keeps P(wait) under 20% as offered load grows. Variable service
times with a CV above 1 come from a two-phase hyperexponential distribution
(most requests short, a few long), and a CV of 0 means every request takes
exactly 20 ms.

```python {title="queues.py"}
"""queues.py: M/M/c against Erlang C, pooled versus split queues, and Kingman's formula.

Three experiments, all simulated with seeded random numbers:
  1. Eight servers sharing one queue (M/M/8), simulated and compared with Erlang C,
     next to the same eight servers each with its own queue and random assignment.
  2. One server at 80% busy with more or less variable arrivals and service,
     simulated and compared with Kingman's approximation.
  3. How many servers a pool needs to keep P(wait) under 20% as load grows.
Standard library only; runs offline in a few seconds.
"""

from __future__ import annotations

import heapq
import math
import random

N = 400_000  # requests per simulated row
WARMUP = 40_000


def erlang_c(c: int, a: float) -> float:
    """P(an arrival waits) for c servers and offered load a = lambda / mu (Erlangs)."""
    b = 1.0  # Erlang B by the stable recursion B(k) = a B(k-1) / (k + a B(k-1))
    for k in range(1, c + 1):
        b = a * b / (k + a * b)
    rho = a / c
    return b / (1 - rho * (1 - b))


def pct(xs: list[float], p: float) -> float:
    return sorted(xs)[int(p * len(xs))]


def pooled_run(c: int, lam: float, mu: float, seed: int) -> tuple[float, float, float]:
    rng = random.Random(seed)
    free = [0.0] * c
    t, waited, soj = 0.0, 0, []
    for i in range(N):
        t += rng.expovariate(lam)
        start = max(t, heapq.heappop(free))
        done = start + rng.expovariate(mu)
        heapq.heappush(free, done)
        if i >= WARMUP:
            waited += start > t
            soj.append(done - t)
    n = len(soj)
    return waited / n, sum(soj) / n, pct(soj, 0.99)


def split_run(c: int, lam: float, mu: float, seed: int) -> tuple[float, float, float]:
    """c separate queues; each arrival picks one at random (c independent M/M/1s)."""
    rng = random.Random(seed)
    free = [0.0] * c
    t, waited, soj = 0.0, 0, []
    for i in range(N):
        t += rng.expovariate(lam)
        k = rng.randrange(c)
        start = max(t, free[k])
        free[k] = start + rng.expovariate(mu)
        if i >= WARMUP:
            waited += start > t
            soj.append(free[k] - t)
    n = len(soj)
    return waited / n, sum(soj) / n, pct(soj, 0.99)


def draw(rng: random.Random, mean: float, cv: float) -> float:
    """A positive sample with the given mean and coefficient of variation (0, 1, or > 1)."""
    if cv == 0:
        return mean
    if cv == 1:
        return rng.expovariate(1 / mean)
    # cv > 1: a two-phase hyperexponential with balanced means. Most samples are
    # short, a few are long, like cache hits mixed with misses.
    p = 0.5 * (1 + math.sqrt((cv * cv - 1) / (cv * cv + 1)))
    if rng.random() < p:
        return rng.expovariate(2 * p / mean)
    return rng.expovariate(2 * (1 - p) / mean)


def gg1_wait(rho: float, s: float, ca: float, cs: float, seed: int) -> float:
    """Mean wait in queue for one FIFO server (Lindley's recursion)."""
    rng = random.Random(seed)
    t = free = 0.0
    total, n = 0.0, 0
    for i in range(N * 5):
        t += draw(rng, s / rho, ca)
        start = max(t, free)
        free = start + draw(rng, s, cs)
        if i >= WARMUP:
            total += start - t
            n += 1
    return total / n


def main() -> None:
    c, s = 8, 0.020  # eight workers, 20 ms mean service time
    mu = 1 / s
    print(f"1. {c} servers, {s * 1000:.0f} ms mean service (exponential), Poisson arrivals")
    print("       |       one shared queue (M/M/8)              | 8 queues, random pick")
    print("  busy | P(wait) Erlang C | mean W  formula   p99 W  | P(wait)  mean W    p99 W")
    for i, rho in enumerate([0.50, 0.70, 0.80, 0.90, 0.95]):
        lam = rho * c * mu
        pw = erlang_c(c, lam / mu)
        w_formula = pw / (c * mu - lam) + s
        p_sim, w_sim, p99 = pooled_run(c, lam, mu, seed=10 + i)
        q_sim, w_split, p99_split = split_run(c, lam, mu, seed=20 + i)
        print(f"  {rho:4.0%} |  {p_sim:5.1%}   {pw:5.1%}  | "
              f"{w_sim * 1e3:5.1f}   {w_formula * 1e3:5.1f}  {p99 * 1e3:6.1f} ms | "
              f"{q_sim:5.1%}  {w_split * 1e3:6.1f}  {p99_split * 1e3:6.1f} ms")

    print("\n2. One server at 80% busy, 20 ms mean service: mean wait in queue")
    print("   ca = CV of gaps between arrivals, cs = CV of service times")
    print("   ca    cs  | simulated  Kingman  | Kingman = S * rho/(1-rho) * (ca^2+cs^2)/2")
    rho = 0.8
    for i, (ca, cs) in enumerate([(1, 0), (1, 1), (1, 2), (1, 4), (0, 1), (2, 1)]):
        sim = gg1_wait(rho, s, ca, cs, seed=30 + i)
        king = s * rho / (1 - rho) * (ca * ca + cs * cs) / 2
        print(f"  {ca:3.0f}  {cs:4.0f}  | {sim * 1e3:7.1f} ms  {king * 1e3:5.1f} ms")

    print("\n3. Servers needed so that at most 20% of requests wait (Erlang C)")
    print("   offered load a | servers  utilization  a + sqrt(a)")
    for a in [2, 10, 100, 1000]:
        k = math.floor(a) + 1
        while erlang_c(k, a) > 0.20:
            k += 1
        print(f"   {a:>14} | {k:>7}  {a / k:>10.0%}  {a + math.sqrt(a):>11.0f}")


if __name__ == "__main__":
    main()
```

Run it with `python3 queues.py` (about six seconds):

```text
1. 8 servers, 20 ms mean service (exponential), Poisson arrivals
       |       one shared queue (M/M/8)              | 8 queues, random pick
  busy | P(wait) Erlang C | mean W  formula   p99 W  | P(wait)  mean W    p99 W
   50% |   5.7%    5.9%  |  20.2    20.3    92.1 ms | 50.0%    40.1   186.1 ms
   70% |  27.3%   27.1%  |  22.3    22.3    95.9 ms | 70.2%    67.5   317.8 ms
   80% |  46.1%   45.8%  |  25.9    25.7   103.4 ms | 80.1%   101.5   478.4 ms
   90% |  70.7%   70.2%  |  38.3    37.5   140.7 ms | 90.3%   213.1   988.5 ms
   95% |  83.5%   84.4%  |  57.2    62.2   215.6 ms | 94.7%   402.0  1864.2 ms

2. One server at 80% busy, 20 ms mean service: mean wait in queue
   ca = CV of gaps between arrivals, cs = CV of service times
   ca    cs  | simulated  Kingman  | Kingman = S * rho/(1-rho) * (ca^2+cs^2)/2
    1     0  |    40.3 ms   40.0 ms
    1     1  |    79.4 ms   80.0 ms
    1     2  |   200.1 ms  200.0 ms
    1     4  |   670.2 ms  680.0 ms
    0     1  |    34.2 ms   40.0 ms
    2     1  |   199.0 ms  200.0 ms

3. Servers needed so that at most 20% of requests wait (Erlang C)
   offered load a | servers  utilization  a + sqrt(a)
                2 |       4         50%            3
               10 |      14         71%           13
              100 |     111         90%          110
             1000 |    1034         97%         1032
```

What to read from it:

- **Erlang C matches the simulation** within sampling noise up to 90%. At 95%
  the simulated mean is about 8% below the formula; near saturation the queue
  is strongly correlated over time and runs converge slowly, as the capacity
  lesson's single-server run also showed.
- **Separate queues wait as if they were alone.** Their P(wait) equals the
  utilization, exactly as for M/M/1, and their p99 at 90% busy is seven times
  the shared queue's.
- **Kingman is exact for Poisson arrivals** (ca = 1) and approximate otherwise.
  With perfectly regular arrivals (ca = 0) it overestimates the wait by about
  17% here, a typical error for an approximation built for heavy traffic.
- **The utilization column in part 3 climbs** from 50% to 97% for the same
  waiting target, and a + √a tracks the exact answer closely.

## Where it breaks

- **Identical, independent servers are an assumption.** M/M/c assumes every
  server is equally fast and that service times are independent. A degraded
  replica, a cold cache on a new instance, or a noisy neighbor breaks both,
  and the shared-queue advantage shrinks when the queue's dispatcher cannot see
  which server is slow.
- **Nobody waits forever.** Erlang C assumes every caller waits until served.
  Real clients time out and retry, which removes load from the queue and then
  adds it back as new arrivals. Models with abandonment (Erlang A) fit
  overloaded systems better; [overload and backpressure](/notes/systems-design/failure-modes/04-overload-and-backpressure/)
  covers what to do about it.
- **Kingman is an approximation for heavy traffic.** It is accurate near
  saturation and can be off by tens of percent at moderate load or for very
  regular arrivals. Use it to rank options and to reason about variability,
  and use a simulation or a measurement for the final number.
- **Service time depends on load.** Garbage collection, lock contention, and
  cache thrashing make service slower as utilization rises, and accelerators
  get faster per request as batches grow. Fixed-S models get both wrong at the
  extremes.
- **Steady state, again.** Every formula here is a long-run average. A
  five-minute spike can produce a queue the formulas never predict, and
  utilization averaged over a minute hides seconds at 100%.

## Remember this

- Draw a boundary around each stage: L = λW gives its concurrency, U = X × D
  its utilization; the highest U is the bottleneck.
- Slower service means more concurrency: for long streams, Little's law turns
  a decode slowdown into a memory shortage.
- One shared queue beats separate queues; P(wait) for c servers comes from
  Erlang C.
- Spare capacity for a fixed waiting target grows like √a, so big pools run
  hotter and every split costs servers.
- Kingman: waiting scales with (ca² + cs²) / 2; bursts and mixed request sizes
  are load.
- Closed-loop load tests back off when the server slows; production traffic
  usually does not.

## Try it

1. Run `queues.py`. Change part 1 to 64 servers at the same utilizations. How
   much does the shared queue's p99 at 95% improve, and does the split-queue
   column change at all?
2. Add a "join the shortest queue" policy to `split_run`: send each arrival to
   the queue with the fewest waiting requests. Where does it land between
   random assignment and one shared queue?
3. In `gg1_wait`, model the mixed endpoint from the lesson (95% at 5 ms, 5% at
   200 ms) at 80% busy and compare the simulated wait with the 275 ms estimate.
   Then split the two classes onto separate servers sized to the same total
   capacity and measure each class's wait.
4. For a service you run, list every resource a request uses, with visits and
   service time per visit. Compute U = X × D for each at peak traffic and name
   the bottleneck. Does it match where on-call engineers usually look first?

## Check yourself

1. A service handles 2,000 requests per second. Each request makes 5 cache
   lookups at 0.2 ms of cache-server CPU each, and 1 database query at 6 ms of
   database CPU. The cache cluster has 8 cores and the database 16. Which
   saturates first, and at what request rate?

   {{< details summary="Show answer" >}}
   Cache demand is 5 × 0.2 = 1 ms per request: 2,000 × 0.001 / 8 = 25% busy,
   saturating at 8,000 requests per second. Database demand is 6 ms: 2,000 ×
   0.006 / 16 = 75% busy, saturating at 16 / 0.006 ≈ 2,667 requests per
   second. The database is the bottleneck.
   {{< /details >}}

2. Eight workers sharing one queue at 90% busy wait far less than eight
   workers with a queue each at 90% busy. Why, when the total capacity is the
   same?

   {{< details summary="Show answer" >}}
   With separate queues, a request can be stuck behind a long job on one
   worker while another worker is idle; capacity is wasted whenever any queue
   is empty and another is not. A shared queue only makes a request wait when
   all eight workers are busy, which at 90% happens about 70% of the time
   rather than for every request that lands on a busy worker, and the wait
   ends as soon as any of the eight finishes.
   {{< /details >}}

3. A team proposes splitting one pool of 100 busy servers' worth of load into
   ten per-tenant pools. Roughly how many extra servers does that cost at the
   same chance of waiting, and why?

   {{< details summary="Show answer" >}}
   By square-root staffing, one pool needs about 100 + √100 = 110 servers and
   each pool of 10 needs about 10 + √10 ≈ 13, so ten pools need about 130
   (the exact Erlang C figures are 111 and 140). The spare capacity needed to
   absorb randomness grows with the square root of the load, so many small
   pools need more of it in total than one large pool.
   {{< /details >}}

4. A model server streams responses with a mean of 15 s per request. Under
   load, decoding slows by a third. What happens to concurrency and to KV cache
   memory, at the same arrival rate?

   {{< details summary="Show answer" >}}
   Streams last about 1.5 times as long (15 s at two-thirds of the speed is
   22.5 s), so by Little's law the number of concurrent streams rises by 1.5
   times, and so does the [KV cache memory](/notes/inference-engineering/inference-mechanics/02-kv-cache-math/) they hold. If memory was already the
   limit, the engine must queue or preempt requests, which slows service
   further.
   {{< /details >}}

5. Why can a load test with 200 closed-loop clients show a healthy p99 for a
   service that falls over in production at the same average request rate?

   {{< details summary="Show answer" >}}
   Closed-loop clients only send a new request after the previous one returns,
   so when the server slows, they send less and the queue cannot grow beyond
   200. Production arrivals are mostly open: they keep coming whatever the
   response time, so a slowdown builds a queue and the tail grows. The test
   also has lower arrival variability than real traffic.
   {{< /details >}}

## Sources

- J. D. C. Little, "A Proof for the Queuing Formula: L = λW", *Operations
  Research* 9(3), 1961.
- P. J. Denning, J. P. Buzen, "The Operational Analysis of Queueing Network
  Models", *ACM Computing Surveys* 10(3), September 1978.
- A. K. Erlang, "Solution of Some Problems in the Theory of Probabilities of
  Significance in Automatic Telephone Exchanges", *Elektroteknikeren* 13, 1917.
- J. F. C. Kingman, "The Single Server Queue in Heavy Traffic", *Mathematical
  Proceedings of the Cambridge Philosophical Society* 57(4), 1961.
- S. Halfin, W. Whitt, "Heavy-Traffic Limits for Queues with Many Exponential
  Servers", *Operations Research* 29(3), 1981.
- B. Schroeder, A. Wierman, M. Harchol-Balter, [Open Versus Closed: A
  Cautionary Tale](https://www.usenix.org/conference/nsdi-06/open-versus-closed-cautionary-tale),
  USENIX NSDI, 2006.
- M. Harchol-Balter, *Performance Modeling and Design of Computer Systems:
  Queueing Theory in Action*, Cambridge University Press, 2013.
- E. D. Lazowska, J. Zahorjan, G. S. Graham, K. C. Sevcik, *Quantitative System
  Performance*, Prentice Hall, 1984.
- G.-I. Yu et al., [Orca: A Distributed Serving System for Transformer-Based
  Generative Models](https://www.usenix.org/conference/osdi22/presentation/yu),
  USENIX OSDI, 2022.
