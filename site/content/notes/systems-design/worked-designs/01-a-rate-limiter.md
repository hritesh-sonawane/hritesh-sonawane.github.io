+++
title = 'A rate limiter'
description = 'A rate limiter is a promise about how many requests a key may make in any window. Choosing the algorithm, where its state lives, and what happens when that state is unreachable are the whole design.'
question = 'How do you limit request rates per tenant, across many servers, without the limiter becoming the outage?'
weight = 1
difficulty = 3
prerequisites = ['/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity', '/notes/systems-design/failure-modes/04-overload-and-backpressure', '/notes/systems-design/concurrency-and-consistency/01-races-and-check-then-act']
date = 2026-10-18
lastmod = 2026-10-18
verified = 2026-10-18
+++

## The idea in one minute

A rate limiter answers one question per request: **has this key used up its
allowance?** The answer is a promise of the form "no key gets more than L
requests in any window of W seconds, plus a burst of B". Everything else in the
design follows from how strict that promise is. A limit that protects a login
form from password guessing must hold exactly, even when the limiter's store is
down. A limit that keeps one customer from hogging a shared service can be
approximate, and should fail open rather than take the API down with it.

So the design is three decisions: **the algorithm** (token bucket, leaky bucket,
fixed window, sliding window log or counter), **where the counts live** (in each
server, in a shared store, or both), and **what happens when the store is
unreachable**. Get the third one wrong and the limiter becomes either the cause
of your outage or a control that silently switches off when attacked.

## A picture

```mermaid {title="Layered limits: cheap and local first, strict and global only where needed"}
flowchart LR
  C["<b>Client</b>"] --> E["<b>Edge</b><br/><small>per IP prefix, coarse</small>"]
  E --> G["<b>Gateway</b><br/><small>local token bucket per key</small>"]
  G <-->|"lease tokens in batches"| S[("<b>Shared store</b><br/><small>atomic scripts</small>")]
  G --> L["<b>Load shedder</b><br/><small>fair share when the service is full</small>"]
  L --> A["<b>Service</b>"]
  G -.->|"429 + Retry-After"| C
  S -.->|"unreachable"| F["<b>Fallback</b><br/><small>strict local limit</small>"]
  class C neutral
  class E,G compute
  class S memory
  class L queue
  class A io
  class F good
```

## How it really works

### Requirements

A worked example keeps the arithmetic honest. Take a public HTTP API:

- **Traffic:** 50,000 requests per second at peak, spread over 40 gateway
  nodes behind a load balancer. About 200,000 API keys belong to about 20,000
  tenants.
- **Limits:** each key gets 100 requests per second with a burst of 200; each
  tenant gets a daily quota; login and one-time-code endpoints get strict
  per-account limits; the expensive report endpoint costs more than a cheap read.
- **Latency:** the limit check may add at most 1 ms at p99.
- **Behavior on rejection:** HTTP 429 (RFC 6585) with a `Retry-After` header
  (RFC 9110), so well-behaved clients back off instead of retrying in a loop.

### Invariants

Write the promises down before choosing an algorithm.

| # | Invariant | Strictness |
| --- | --- | --- |
| I1 | A key is accepted for at most L requests in any W-second window, plus B burst | Exact for security limits, approximate (within a stated error) for fairness limits |
| I2 | One tenant's traffic never spends another tenant's allowance | Exact |
| I3 | Failure of the limiter's store never makes the whole API unavailable | Exact |
| I4 | Failure of the limiter's store never disables a security limit | Exact |
| I5 | The check adds at most 1 ms at p99 | Measured |

I3 and I4 pull against each other. The way out is to stop treating "rate limit"
as one thing: classify each limit, then choose a failure behavior per class
(below).

### The algorithms

| Algorithm | State per key | What it promises | Weakness |
| --- | --- | --- | --- |
| **Fixed window**: count requests in the current calendar second or minute | counter + window start | At most L per aligned window | Up to 2L in any unaligned window: L at the end of one window, L at the start of the next |
| **Sliding window log**: keep a timestamp per accepted request | up to L timestamps | Exactly L in any window | Memory grows with L; impractical for large limits |
| **Sliding window counter**: two fixed-window counters, weight the previous one by its overlap | two counters + window start | Approximately L in any window | Assumes the previous window's requests were evenly spread |
| **Token bucket**: tokens refill at rate r up to capacity b; a request spends one | token count + last refill time | At most b + r·t in any interval of length t | Allows a full burst after idle time, by design |
| **Leaky bucket as a meter**: a level drains at rate r; a request adds one if it fits | level + last update | Same as a token bucket (mirror image) | Same |
| **Leaky bucket as a queue**: requests wait and leave at a constant rate | a queue | Smooth output at rate r | Adds latency; the queue itself needs a bound |

Two of these deserve a closer look. The **token bucket** separates the
long-run rate from the burst a client may spend after being idle, which is
usually what an API wants: interactive clients are bursty and should not be
punished for it. The **generic cell rate algorithm** (GCRA), from ATM traffic
management (ITU-T I.371), is a token bucket stored as a single timestamp: the
"theoretical arrival time" of the next conforming request. One number per key
and one compare per request make it a favorite for shared-store limiters.

The **leaky bucket** name causes confusion because it describes two different
things. As a meter it is a token bucket viewed from the other side. As a queue
it is a traffic shaper: nginx's `limit_req` module describes itself as using
the leaky bucket method, and with its `burst` parameter excess requests wait in
a queue instead of being rejected. Shaping suits traffic you send (to a fragile
partner API); policing (rejecting) suits traffic you receive.

The program below runs all of them, except the queue, on the same trace.

### Capacity estimate

**State is not the problem.** A token bucket is two numbers, say 16 bytes, plus
a key of about 40 bytes. Allow 200 bytes per key for store overhead: 200,000
keys × 200 B = 40 MB. It fits in the memory of a single node.

**Operations and latency are the problem.** A purely central design makes one
store round trip per request: 50,000 atomic operations per second. A single
store shard handles tens of thousands to low hundreds of thousands of simple
operations per second depending on hardware and command; benchmark yours, but
plan for 50,000 per second to be most of one shard, with no headroom for a
traffic spike. Sharding by key spreads the load, but one hot key still lands on
one shard. And an in-region network round trip of a few hundred microseconds
is a large part of a 1 ms budget before the store does any work.

**Purely local limits are wrong by a computable amount.** If each of the 40
gateways enforces the full per-key limit on its own, a key whose traffic the
load balancer spreads evenly gets 40 × 100 = 4,000 requests per second. If each
gateway enforces L/N = 2.5 requests per second, a client that happens to be
routed unevenly gets rejected far below its limit. Neither is what I1 says.

**Leasing tokens fixes both.** Each gateway takes tokens from the shared bucket
in batches, say 10 at a time, and spends them locally. Store operations drop by
the batch size: 50,000 / 10 = 5,000 per second. The limit stays strict, because
a leased token has already been subtracted from the shared bucket. The cost is
stranded capacity: tokens leased by one gateway cannot be spent by another. With
40 gateways the worst case is 40 × 10 = 400 tokens held across the fleet, which
is a problem for a 100-per-second key but not for a 10,000-per-second one. Size
the lease per key (a small fraction of its limit, at least one) and let unspent
leases expire after a second.

The bars compare the two designs at 50,000 requests per second: leasing in
batches of 10 cuts store traffic tenfold.

```mermaid {title="Leasing tokens in batches of 10 divides store operations by 10"}
xychart-beta
  title "Store operations per second at 50,000 requests per second"
  x-axis ["One store call per request", "Lease 10 tokens per call"]
  y-axis "Store operations per second" 0 --> 55000
  bar [50000, 5000]
```

Follow one gateway's lease: every token it spends was subtracted from the shared
bucket first, and tokens it never spends simply lapse.

```mermaid {title="A lease is subtracted up front, spent locally, and expires if unused"}
stateDiagram-v2
  [*] --> Requested: local bucket empty
  Requested --> Leased: store subtracts a batch atomically
  Requested --> Denied: shared bucket empty
  Leased --> Spending
  Spending --> Spending: admit one request, spend one token locally
  Spending --> Exhausted: last leased token spent
  Spending --> Expired: unspent after 1 s, stranded tokens lapse
  Exhausted --> Requested
  Expired --> [*]
  Denied --> [*]: 429 and Retry-After
```

### The design

**Layer the limits.** Coarse per-IP-prefix limits at the edge absorb floods
before they cost anything. Per-key token buckets at the gateway enforce the
contract. A load shedder in front of the service handles the case per-key
limits cannot: thousands of tenants each within their limit, together more than
the service can take. Overload and fair shedding are covered in
[Overload and backpressure](/notes/systems-design/failure-modes/04-overload-and-backpressure/);
the limiter is the per-tenant contract, not the capacity guard.

Here is the same layering as a deployment: one edge, a fleet of 40 gateways
that share one store, and the shedder in front of the service.

```mermaid {title="One region: edge, 40 gateways sharing a store, shedder, service"}
flowchart TB
  n_clients["Clients"]
  subgraph g_region["Region"]
    n_edge["Edge per IP prefix"]
    subgraph g_fleet["Gateway fleet of 40"]
      n_gw1["Gateway 1"]
      n_gw40["Gateway 40"]
    end
    n_store["Shared store"]
    n_shed["Load shedder"]
    n_api["Service"]
  end
  n_clients --> n_edge
  n_edge --> n_gw1
  n_edge --> n_gw40
  n_gw1 --> n_store
  n_gw1 --> n_shed
  n_gw40 --> n_shed
  n_shed --> n_api
```

**Make the shared check atomic.** "Read the count, compare, write the new
count" from two gateways at once is the classic check-then-act race described in
[Races and check-then-act](/notes/systems-design/concurrency-and-consistency/01-races-and-check-then-act/):
both read 1 remaining token, both admit. The store must do the
read-modify-write as one operation. For a fixed window that can be a single
atomic increment with an expiry, the pattern the Redis `INCR` documentation
gives. For a token bucket or GCRA it is a short server-side script; Redis runs
a script without interleaving other commands, so the refill, compare, and
decrement are atomic. Take the time from one clock, preferably the store's, or
the refill arithmetic inherits every gateway's clock skew.

The top half is the race; the bottom half is the fix, where the store runs the
whole check as one step so the second gateway sees the first one's decrement.

```mermaid {title="Read-then-write spends one token twice; one atomic script does not"}
sequenceDiagram
  autonumber
  participant G1 as Gateway 1
  participant S as Shared store
  participant G2 as Gateway 2
  rect rgb(249, 226, 233)
    Note over G1,G2: Read, compare, write as separate steps
    G1->>S: GET bucket
    G2->>S: GET bucket
    S-->>G1: 1 token left
    S-->>G2: 1 token left
    G1->>S: SET bucket 0
    G2->>S: SET bucket 0
    Note over G1,G2: both admit, one token spent twice
  end
  rect rgb(226, 239, 216)
    Note over G1,G2: One server-side script, no interleaving
    G1->>S: run script: refill, compare, decrement
    S-->>G1: allowed, 0 left
    G2->>S: run script: refill, compare, decrement
    S-->>G2: denied, send 429
  end
```

**Key on the right identity.** Per key for authenticated traffic, nested under
per tenant, so a tenant with 50 keys cannot multiply its allowance by 50
(I2). Charge by cost, not by request: the report endpoint spends 20 tokens, a
cached read spends one. The same idea, with model tokens as the unit, drives
[the inference gateway](/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway/).

**Choose failure behavior per class of limit.**

| Limit class | Example | Store unreachable |
| --- | --- | --- |
| Security | login attempts per account, OTP checks, password reset | Fall back to a strict local limit (fail closed if none) |
| Contract | 100 requests per second per key | Fall back to local buckets at L/N, or at L if brief overshoot is acceptable |
| Billing quota | 1 million calls per day per tenant | Fail open, count locally, reconcile later |
| Capacity | the shared database can take 8,000 queries per second | Not a rate limit; a load shedder that needs no shared store |

The local fallback is what reconciles I3 with I4: the API stays up, and a
password-guessing attacker still meets a limit, merely a per-gateway one.

Read the table as a decision a gateway makes on every request whose store call
times out: the class of the limit picks the fallback.

```mermaid {title="When the store does not answer, the limit's class decides the fallback"}
flowchart TB
  R@{ shape: diam, label: "Store answers within the deadline?" }
  R -->|yes| SH["<b>Shared atomic check</b>"]
  R -->|"no, or timeout"| C@{ shape: diam, label: "Which class of limit?" }
  C -->|security| SEC["<b>Strict local limit</b><br/><small>fail closed if none</small>"]
  C -->|contract| CON["<b>Local bucket at L/N</b><br/><small>or L if brief overshoot is fine</small>"]
  C -->|billing| BIL["<b>Fail open</b><br/><small>count locally, reconcile later</small>"]
  C -->|capacity| CAP["<b>Load shedder</b><br/><small>needs no shared store</small>"]
  class SH,SEC good
  class CON compute
  class BIL warn
  class CAP queue
```

**Tell clients what happened.** Return 429 with `Retry-After`. The IETF
HTTP API working group has a draft defining `RateLimit` header fields so
clients can see their remaining allowance before they hit it (an
Internet-Draft as of October 2026). Clients that retry without delay turn a
rate limit into load, so document the expected backoff and add jitter in your
own SDKs.

### Failure modes

- **Store slow, not down.** A store at 50 ms latency is worse than a dead one,
  because every request waits. Put a deadline of a few milliseconds on the
  limiter call and treat a timeout as unreachable.
- **Hot key.** One tenant at 30,000 requests per second saturates one shard.
  Split its bucket into k sub-buckets on different shards, each with L/k, or
  give that tenant sticky routing so its limit can be enforced locally.
- **Key cardinality attack.** An attacker who controls the key (random API
  keys, random IPv6 addresses) creates millions of buckets. Reject unknown API
  keys before the limiter, set a TTL on every bucket, and limit IPv6 by /64
  prefix, not by address.
- **Retry storm after rejection.** Clients that ignore `Retry-After` multiply
  the load they were limited for. The edge layer must be able to absorb them
  cheaply.
- **Clock skew.** A gateway whose clock jumps forward refills buckets early.
  Using the store's clock, or a monotonic clock for local buckets, avoids it.

### Security review

- **Who is the caller?** Behind proxies, the client IP comes from
  `X-Forwarded-For`, which the client can set. Take the address added by the
  last proxy you trust, not the leftmost value.
- **Credential stuffing spreads across IPs.** A botnet trying one password per
  account from 100,000 addresses never trips a per-IP limit. Login limits need
  a per-account dimension as well, plus global signals such as the failure rate
  across all accounts. NIST SP 800-63B requires verifiers to limit consecutive
  failed authentication attempts on an account.
- **Per-account limits enable lockout.** A strict per-account limit lets anyone
  lock a victim out by failing on purpose. Slow down rather than lock, and
  allow trusted devices through.
- **The limiter is an attack surface.** It holds state per key, runs on every
  request, and sits in front of authentication. Bound its memory, its latency,
  and the work an unauthenticated request can cause.
- **Limits leak a little.** `RateLimit` headers reveal policy and remaining
  quota. That is usually fine for authenticated clients; consider omitting them
  on unauthenticated endpoints.

### What changes at 10x

At 500,000 requests per second across several regions:

- **Per-region budgets.** A global per-key limit enforced by a cross-region
  store adds tens of milliseconds. Instead, split each key's limit across
  regions in proportion to recent use and rebalance every few seconds. The limit
  becomes approximate across regions and exact within one.
- **Bigger leases.** With a batch of 20, store operations are 500,000 / 20 =
  25,000 per second, spread across shards. The lease size becomes a per-key
  setting derived from the key's limit.
- **Hot tenants get their own cells.** The tenants who need 10x limits are few;
  give them dedicated capacity rather than redesigning for them.
- **The limiter needs its own SLO.** At this scale it is a tier-0 dependency,
  with its own error budget and on-call, as in
  [SLOs and error budgets](/notes/systems-design/reliability-in-production/01-slos-and-error-budgets/).

## Code

The program feeds one bursty trace to four limiters, all set to 10 requests per
second. The trace has a steady phase, 30 requests packed around a window
boundary at t = 3 s, and a two-second overload at 20 requests per second. It
counts what each algorithm accepts and the worst number accepted in **any**
one-second interval, aligned or not, which is what I1 is about.

```python {title="ratelimit.py"}
"""ratelimit.py: four rate limiters on the same bursty trace.

Limit: 10 requests per second per key. Time is integer milliseconds so every
run is identical. Standard library only; offline; no real traffic.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

LIMIT = 10        # requests per window
WINDOW = 1000     # window length in ms


class FixedWindow:
    def __init__(self) -> None:
        self.start, self.count = 0, 0

    def allow(self, t: int) -> bool:
        start = t - t % WINDOW
        if start != self.start:
            self.start, self.count = start, 0
        if self.count < LIMIT:
            self.count += 1
            return True
        return False


class SlidingLog:
    """Exact: remember every accepted timestamp in the last window."""

    def __init__(self) -> None:
        self.log: deque[int] = deque()

    def allow(self, t: int) -> bool:
        while self.log and self.log[0] <= t - WINDOW:
            self.log.popleft()
        if len(self.log) < LIMIT:
            self.log.append(t)
            return True
        return False


class SlidingCounter:
    """Two counters; weight the previous window by how much of it still overlaps."""

    def __init__(self) -> None:
        self.start, self.curr, self.prev = 0, 0, 0

    def allow(self, t: int) -> bool:
        start = t - t % WINDOW
        if start != self.start:
            self.prev = self.curr if start == self.start + WINDOW else 0
            self.start, self.curr = start, 0
        elapsed = t - start
        # estimate = prev * (W - elapsed) / W + curr, compared in integers
        if self.prev * (WINDOW - elapsed) + self.curr * WINDOW < LIMIT * WINDOW:
            self.curr += 1
            return True
        return False


class TokenBucket:
    """Refill 10 tokens/s up to a burst of 10. Tokens kept in thousandths."""

    def __init__(self, rate: int = LIMIT, burst: int = LIMIT) -> None:
        self.rate, self.cap = rate, burst * 1000
        self.tokens, self.last = self.cap, 0

    def allow(self, t: int) -> bool:
        self.tokens = min(self.cap, self.tokens + (t - self.last) * self.rate)
        self.last = t
        if self.tokens >= 1000:
            self.tokens -= 1000
            return True
        return False


def bursty_trace() -> list[tuple[int, str]]:
    trace = [(t, "steady") for t in range(0, 2000, 200)]          # 5 req/s
    trace += [(2900 + 6 * i, "edge") for i in range(15)]           # end of window 2
    trace += [(3000 + 6 * i, "edge") for i in range(15)]           # start of window 3
    trace += [(t, "overload") for t in range(4000, 6000, 50)]      # 20 req/s
    return trace


def worst_second(accepted: list[int]) -> int:
    """Most accepted requests in any 1000 ms interval, aligned or not."""
    best, lo = 0, 0
    for hi, t in enumerate(accepted):
        while accepted[lo] <= t - WINDOW:
            lo += 1
        best = max(best, hi - lo + 1)
    return best


@dataclass
class Result:
    accepted: list[int] = field(default_factory=list)
    by_phase: dict[str, int] = field(default_factory=dict)


def run(limiter, trace: list[tuple[int, str]]) -> Result:
    res = Result()
    for t, phase in trace:
        res.by_phase.setdefault(phase, 0)
        if limiter.allow(t):
            res.accepted.append(t)
            res.by_phase[phase] += 1
    return res


def main() -> None:
    trace = bursty_trace()
    offered = {p: sum(1 for _, q in trace if q == p) for p in ("steady", "edge", "overload")}
    print(f"offered: {len(trace)} requests  " + "  ".join(f"{p}={n}" for p, n in offered.items()))
    print(f"limit:   {LIMIT} per {WINDOW} ms\n")
    print(f"{'algorithm':<16}{'steady':>7}{'edge':>6}{'overload':>9}{'total':>7}{'worst 1s':>10}{'state':>12}")
    for name, lim, state in [
        ("fixed window", FixedWindow(), "2 ints"),
        ("sliding log", SlidingLog(), "<=10 stamps"),
        ("sliding counter", SlidingCounter(), "3 ints"),
        ("token bucket", TokenBucket(), "2 ints"),
    ]:
        r = run(lim, trace)
        p = r.by_phase
        print(f"{name:<16}{p['steady']:>7}{p['edge']:>6}{p['overload']:>9}"
              f"{len(r.accepted):>7}{worst_second(r.accepted):>10}{state:>12}")

    print("\ntoken bucket, burst=20 rate=10 (same long-run rate, bigger burst):")
    r = run(TokenBucket(burst=20), trace)
    print(f"  edge accepted {r.by_phase['edge']}, worst 1s {worst_second(r.accepted)}")


if __name__ == "__main__":
    main()
```

Run it with `python3 ratelimit.py`:

```text
offered: 80 requests  steady=10  edge=30  overload=40
limit:   10 per 1000 ms

algorithm        steady  edge overload  total  worst 1s       state
fixed window         10    20       20     50        20      2 ints
sliding log          10    10       20     40        10 <=10 stamps
sliding counter      10    11       20     41        11      3 ints
token bucket         10    11       29     50        19      2 ints

token bucket, burst=20 rate=10 (same long-run rate, bigger burst):
  edge accepted 21, worst 1s 21
```

Read the "worst 1s" column. The **fixed window** lets 20 requests through in
the 200 ms around the boundary: 10 at the end of one window, 10 at the start
of the next, twice the stated limit. The **sliding log** is exact and never
exceeds 10, but stores a timestamp per accepted request. The **sliding counter**
uses three integers and overshoots by one on this trace, because its estimate
assumes the previous window's 10 requests were spread evenly when in fact they
all arrived in its last 100 ms. The **token bucket** accepts 19 in the worst
second during overload: a full bucket of 10 at the start plus refills. That is
not a bug; it is the b + r·t promise, and the final line shows how the burst
parameter controls it. Pick the algorithm whose promise matches the invariant
you wrote down, then state that promise in your API documentation.

The bars are the "worst 1s" column from the run; the line is the stated limit
of 10. Only the sliding log stays on it.

```mermaid {title="Worst one-second count per algorithm against a limit of 10"}
xychart-beta
  title "Most requests accepted in any one-second interval"
  x-axis ["Fixed window", "Sliding log", "Sliding counter", "Token bucket b=10", "Token bucket b=20"]
  y-axis "Accepted in the worst second" 0 --> 25
  bar [20, 10, 11, 19, 21]
  line [10, 10, 10, 10, 10]
```

## Where it breaks

- **A limit is not a capacity plan.** The sum of all tenants' limits is almost
  always larger than the service's capacity. Per-key limits protect tenants from
  each other only while the service has room; beyond that you need load
  shedding.
- **Rate is not cost.** Ten requests per second of cached reads and ten per
  second of full-table exports are different loads. Cost-weighted tokens help,
  but only if you can estimate cost before doing the work.
- **Distributed abuse is under every per-key limit.** A limiter bounds each key,
  not the attacker. Abuse spread across many accounts or addresses needs
  detection on aggregate signals.
- **The simulation is one process with a perfect clock.** It shows what each
  algorithm promises, not how a fleet behaves. In a fleet, accuracy also
  depends on how load is spread, on lease sizes, and on store latency.

## Remember this

- Write the limit as an invariant ("at most L in any window W, plus burst B")
  and choose the algorithm whose promise matches it.
- Fixed windows admit up to 2L across a boundary; token buckets admit b + r·t
  by design.
- Shared-store checks must be atomic: one increment or one script, never
  read-then-write.
- Leasing tokens in batches keeps a global limit strict and divides store load
  by the batch size.
- Decide fail-open or fail-closed per class of limit; a strict local fallback
  keeps security limits alive when the store is down.

## Try it

1. Add GCRA to `ratelimit.py`: store one theoretical arrival time per key,
   emission interval 100 ms, burst tolerance 900 ms. Confirm it accepts exactly
   what the token bucket accepts.
2. Simulate four gateways, each with its own local `TokenBucket` at the full
   limit, and route the trace round-robin. Measure the worst one-second count.
   Then give each gateway a quarter of the limit and route 70 percent of
   traffic to one gateway. What breaks now?
3. Implement leasing: a shared bucket hands out batches of 3 tokens, gateways
   spend locally, unspent leases expire after 1 s. Measure store operations and
   the worst one-second count.
4. For an API you know, list every limit it enforces and put each in one of the
   four classes in the failure table. Which ones fail the wrong way today?

## Check yourself

1. Why does a fixed-window limiter of 10 per second admit 20 requests in a
   200 ms interval?

   {{< details summary="Show answer" >}}
   Its counter resets at each window boundary. A client can send 10 requests
   just before the boundary and 10 just after; each window sees only 10, but any
   one-second interval spanning the boundary contains 20.
   {{< /details >}}

2. Two gateways each run `tokens = GET key; if tokens > 0: SET key tokens-1`.
   What goes wrong, and what is the fix?

   {{< details summary="Show answer" >}}
   Both can read the same value and both admit, so one token is spent twice.
   The fix is to make the read, compare, and write one atomic operation in the
   store: an atomic increment for counters, or a server-side script that the
   store runs without interleaving other commands.
   {{< /details >}}

3. How does leasing tokens keep a limit strict while reducing store load?

   {{< details summary="Show answer" >}}
   A gateway subtracts a batch of tokens from the shared bucket in one
   operation and then spends them locally. Every token admitted was already
   removed from the shared count, so the fleet can never admit more than the
   bucket allowed. Store operations fall by the batch size. The price is tokens
   stranded on gateways that do not need them.
   {{< /details >}}

4. The limiter's store goes down. What should happen to the login-attempt limit
   and to the daily billing quota?

   {{< details summary="Show answer" >}}
   The login limit is a security control, so it falls back to a strict local
   limit per gateway (or fails closed); otherwise an attacker gets unlimited
   guesses exactly when the store is unavailable. The billing quota can fail
   open, counting locally and reconciling later, because a short overshoot costs
   money, not security.
   {{< /details >}}

5. Why is a per-IP limit not enough for a login endpoint?

   {{< details summary="Show answer" >}}
   Credential stuffing comes from many addresses, each trying few attempts, so
   no single address crosses the limit. A per-account limit catches guessing
   against one account; aggregate failure rates catch campaigns across many.
   {{< /details >}}

## Sources

- M. Nottingham, R. Fielding, [RFC 6585: Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585) (429 Too Many Requests), IETF, April 2012.
- R. Fielding, M. Nottingham, J. Reschke (eds.), [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) (`Retry-After`, section 10.2.3), IETF, June 2022.
- IETF HTTPAPI Working Group, [RateLimit header fields for HTTP](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/), Internet-Draft.
- ITU-T, Recommendation I.371, Traffic control and congestion control in B-ISDN (defines the generic cell rate algorithm).
- Redis, [INCR command documentation](https://redis.io/docs/latest/commands/incr/) (rate limiter patterns) and [Scripting with Lua](https://redis.io/docs/latest/develop/interact/programmability/eval-intro/) (atomic script execution).
- nginx, [Module ngx_http_limit_req_module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
- Envoy proxy, [Local rate limit filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/local_rate_limit_filter) and [Global rate limiting](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/global_rate_limiting).
- NIST, [SP 800-63B: Digital Identity Guidelines, Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html).
- P. Tarjan, [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters), Stripe engineering blog, 2017.
