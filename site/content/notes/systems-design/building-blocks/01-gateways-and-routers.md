+++
title = 'Gateways and routers'
description = 'A gateway is the one place where identity, token limits, routing, and fallback live. Routing by cost and quality is a measured tradeoff with error terms, and fallback is a capacity plan, not a retry.'
question = 'How should a gateway decide which model serves a request, and what should it do when that model is slow or down?'
weight = 1
difficulty = 3
prerequisites = ['/notes/systems-design/how-ai-systems-differ/02-cost-latency-and-quality', '/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway', '/notes/systems-design/failure-modes/03-circuit-breakers-and-deadlines']
date = 2026-10-30T12:05:00Z
lastmod = 2026-10-30T12:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

Applications should not call models directly. They call a **gateway**, and the
gateway calls models. Every cross-cutting concern lives in that one hop:
which tenant is calling, how many tokens it may spend, which concrete model
serves the request, what happens when that model is slow, and what gets
recorded. Without it each service reimplements those decisions differently,
and nobody can see total demand.

The part of the gateway that decides which model serves a request is the
**router**. Sending easy requests to a small model and hard ones to a large
model can cut cost several-fold, but every routing policy has error terms: a
verifier that accepts a wrong answer, a classifier that sends a hard request
to the small model. **Routing is a point on a cost-quality curve that you
measure, not a free saving.** Fallback has the same character: moving traffic
to a second route only helps if that route has capacity, a tested prompt, and
the request has not yet streamed a token to the user.

## A picture

```mermaid {title="One request through a gateway: admit, route, call, fall back, record"}
flowchart LR
  APP["<b>Application</b><br/><small>logical model: 'support-fast'</small>"] --> AUTH["<b>Authenticate</b><br/><small>key to tenant, project</small>"]
  AUTH --> ADM["<b>Admit</b><br/><small>reserve input + max_tokens</small>"]
  ADM --> RT{"<b>Router</b><br/><small>allowed routes, then<br/>cost, quality, health</small>"}
  RT -->|"easy"| S["<b>Small model</b><br/><small>own pool</small>"]
  RT -->|"hard"| L["<b>Large model</b><br/><small>hosted API</small>"]
  L -.->|"breaker open or<br/>no first token by 3 s"| F["<b>Fallback route</b><br/><small>evaluated prompt,<br/>reserved capacity</small>"]
  S --> REC["<b>Usage record</b><br/><small>tenant, route, tokens,<br/>TTFT, cost</small>"]
  L --> REC
  F --> REC
  ADM -.->|"over budget: 429"| APP
  class APP neutral
  class AUTH,ADM good
  class RT queue
  class S,L,F compute
  class REC io
```

The router chooses among routes the tenant is allowed to use; the breaker and
the first-token deadline decide when a route is skipped.

## How it really works

### What the gateway owns

| Concern | Mechanism | Why it belongs here |
| --- | --- | --- |
| Identity | Gateway keys or workload identity mapped to tenant and project; provider keys exist only in the gateway | One place to revoke; nothing else holds a provider credential |
| Admission | Token buckets per tenant, charged with input tokens plus `max_tokens`, settled on completion | Limits must see all traffic to be limits |
| Routing | Logical model name to a set of concrete routes, filtered by policy, ranked by cost, quality, and health | Model choice changes without redeploying applications |
| Fallback | Breakers per route, a first-token deadline, a retry budget | Failure handling must know about every route at once |
| Records | One wide event per request | Billing, capacity planning, and incident review read the same row |
| Policy hooks | Input and output checks, content-logging rules | Every request already passes here |

The admission and fair-scheduling half of this table is worked through in
[a multi-tenant inference gateway](/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway/).
This lesson is about the other half: choosing a route and leaving it safely.

### Logical models and route tables

Application code names a **logical model** that describes the job, such as
`support-fast` or `code-review`. Gateway configuration maps it to routes:

```text
logical model: support-fast
  route small-own     pool=llama-8b-ft@v14   region=eu-west  $0.15/$0.60 per M  quality(eval v7)=0.74
  route large-api     provider-a/model@2026-06-01 region=eu   $3.00/$15.00 per M quality(eval v7)=0.99
  route large-alt     provider-b/model@2026-05   region=eu    $2.50/$10.00 per M quality(eval v7)=0.97
  policy              cascade small-own -> large-api; fallback large-api -> large-alt
  constraints         tenant.residency = eu; tenant.allowlist includes route
```

Three details matter. Every route **pins a version**: a floating alias means
the provider can change behavior under you. Every route carries a **quality
number from your own evaluation set**, not from a public leaderboard. And
constraints (residency, the tenant's contract, data-handling terms) **filter
routes before ranking**, so cost can never outrank a rule. Changing a route
table is a behavior change and goes through the same evaluation gate as a
prompt or model change.

### Routing by cost and quality

There are three families of router, and they fail differently.

| Strategy | How it decides | Main error |
| --- | --- | --- |
| By call site | The application declares the tier each call needs | Coarse: one tier for every request at that site |
| Cascade | Call the small model, check the answer, escalate if the check fails | False accepts cap quality; escalations pay twice and wait twice |
| Predictive | A cheap classifier predicts, before any call, which model is enough | Misroutes in both directions; it is another model to evaluate |

The cascade is easiest to reason about with algebra. Let the small model cost
`c_s`, the verifier `c_v`, and the large model `c_L`. Let the verifier reject a
fraction `r` of small answers. Then:

```text
expected cost      = c_s + c_v + r x c_L
expected quality   = P(small right and accepted) + r x q_L
quality lost       = P(small wrong and accepted)      <- false accepts
latency, escalated = full small generation + verify + large TTFT
```

The last line is what designers forget. A cascade cannot start the large model
until the small answer is complete and checked, so escalated requests pay the
small model's whole generation time before the large model begins. A
predictive router decides before any generation, so its added latency is one
classifier call, but nothing checks its mistakes.

Published routers report large savings on their benchmarks: FrugalGPT (Chen,
Zaharia, and Zou, 2023) used cascades with a learned scorer, and RouteLLM (Ong
et al., 2024) trained routers on preference data between a strong and a weak
model. Treat those numbers as existence proofs. The saving on your traffic
depends on your difficulty distribution and on how good your verifier is,
which only your evaluation set can tell you.

> [!IMPORTANT]
> A router is a classifier, and its errors land in production. Measure its
> false-accept and misroute rates on labeled cases, and gate router changes
> exactly like model changes.

### Fallback is a capacity plan

When a route errors or misses its first-token deadline, the gateway can move
the request elsewhere. Four rules keep that from making things worse:

1. **Only before the first token.** Once text has streamed to the user, a
   retry produces a different answer spliced onto the old one. After the first
   token, the only honest options are finishing or failing.
2. **Only onto capacity that exists.** A provider outage moves *everyone's*
   traffic to the same alternatives at once. The fallback route needs quota or
   reserved capacity sized for that, or one outage becomes two.
3. **Only with an evaluated prompt.** A fallback model is a different model.
   Its prompt variant sits in the evaluation suite, or the fallback path ships
   untested.
4. **Only within a retry budget.** Retries may add a bounded fraction of
   traffic, around 10%, and happen at one layer. The mechanics are in
   [retries and idempotency](/notes/systems-design/failure-modes/02-retries-and-idempotency/).

Tool calls that write need idempotency keys, because a timed-out request may
have executed its side effect before the gateway gave up on it.

### Health: slow is down

A route that returns every request successfully at 20 s time to first token
(TTFT) is down for an interactive product. So the breaker for a model route
counts **slow first tokens as failures**, alongside errors and 429s. Three
timers cover a stream:

- **First-token deadline**, a few seconds: if nothing has arrived, the request
  is probably queued upstream, and switching is still invisible to the user.
- **Stall timer** between tokens: catches a stream that starts and then hangs.
- **Total deadline**, propagated downstream so that a cancelled request stops
  consuming GPU time or provider billing.

Breaker states and tuning are covered in
[circuit breakers and deadlines](/notes/systems-design/failure-modes/03-circuit-breakers-and-deadlines/).

### Hedging the first token

Dean and Barroso's hedged requests ("The Tail at Scale", 2013) send a second
copy of a request after the first has waited longer than, say, its 95th
percentile, and use whichever answers first. For model calls the second copy is
not free: both copies are billed for input tokens, and both consume [prefill](/notes/inference-engineering/inference-mechanics/01-prefill-and-decode/)
compute until one is cancelled. Hedging is worth it for short, interactive
prompts with a heavy TTFT tail. It is a poor trade for long prompts, where the
duplicated prefill is most of the cost, and it needs prompt cancellation of the
loser.

### Routing inside a self-hosted pool

When a route points at your own GPUs, the gateway (or an endpoint picker behind
it) must also choose a replica. Round-robin is wrong for language models:
requests differ a thousandfold in cost, and replicas differ in which prefixes
they hold in cache. The Kubernetes Gateway API Inference Extension standardizes
an `InferencePool` of model-server pods and an endpoint picker that scores
replicas on queue depth, KV-cache utilization, prefix affinity, and loaded
adapters. Replica selection is covered in more depth in
[an inference platform](/notes/systems-design/ai-infrastructure/03-an-inference-platform/).

### The one record

Every request emits one wide event: tenant, project, logical model, route
chosen and why (`cascade-accepted`, `escalated`, `fallback:deadline`), input,
cached, and output tokens, TTFT, total time, finish reason, cost. Counting
escalations and fallbacks per route is how you notice that a router has drifted
or that a primary has been browning out for an hour.

## Code

The program compares four policies on 20,000 simulated requests of random
difficulty: always large, always small, a cascade with an imperfect verifier,
and a predictive router. Then it replays a brown-out of the primary route
through a breaker that counts slow first tokens as failures.

```python {title="router.py"}
"""router.py: route by cost and quality, then fall back safely.

Part 1 compares four routing policies on 20,000 simulated requests:
always the large model, always the small model, a cascade (small first,
escalate when a verifier rejects), and a router that predicts difficulty
before calling anything. Part 2 replays a brown-out of the primary route
and shows a breaker that counts slow first tokens as failures.
Simulated models; standard library only.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

N = 20_000
IN_TOK, OUT_TOK = 1_500, 300


@dataclass(frozen=True)
class Model:
    name: str
    in_price: float   # dollars per million input tokens
    out_price: float  # dollars per million output tokens
    skill: float      # solves requests with difficulty below roughly this
    ttft: float       # seconds to first token, typical

    def cost(self) -> float:
        return (IN_TOK * self.in_price + OUT_TOK * self.out_price) / 1e6

    def solves(self, rng: random.Random, difficulty: float) -> bool:
        # A soft threshold: near the edge of its skill a model is a coin flip.
        margin = self.skill - difficulty
        p = 1 / (1 + 2.718281828 ** (-margin / 0.05))
        return rng.random() < p


SMALL = Model("small", 0.15, 0.60, 0.55, 0.25)
LARGE = Model("large", 3.00, 15.00, 0.92, 0.90)


def verifier(rng: random.Random, correct: bool) -> bool:
    """Accept or reject an answer. Imperfect: misses 10% of wrong answers
    (false accept) and rejects 8% of right ones (false reject)."""
    if correct:
        return rng.random() > 0.08
    return rng.random() < 0.10


def predicted_hard(rng: random.Random, difficulty: float) -> bool:
    """A cheap classifier that sees a noisy view of difficulty."""
    return difficulty + rng.gauss(0, 0.10) > 0.50


def run(policy: str, seed: int = 1) -> tuple[float, float, float, float]:
    rng = random.Random(seed)
    cost = correct = escalated = 0.0
    lat: list[float] = []
    for _ in range(N):
        d = rng.betavariate(2, 3)  # most requests are easy
        if policy == "always large":
            ok, c, t = LARGE.solves(rng, d), LARGE.cost(), LARGE.ttft
        elif policy == "always small":
            ok, c, t = SMALL.solves(rng, d), SMALL.cost(), SMALL.ttft
        elif policy == "cascade":
            ok_s = SMALL.solves(rng, d)
            c, t = SMALL.cost() + 0.0002, SMALL.ttft + 0.4  # verifier call
            if verifier(rng, ok_s):
                ok = ok_s
            else:
                escalated += 1
                ok = LARGE.solves(rng, d)
                c += LARGE.cost()
                t += 3.0 + LARGE.ttft  # the small answer was generated in full first
        elif policy == "predictive router":
            c, t = 0.00002, 0.02
            if predicted_hard(rng, d):
                escalated += 1
                ok, c, t = LARGE.solves(rng, d), c + LARGE.cost(), t + LARGE.ttft
            else:
                ok, c, t = SMALL.solves(rng, d), c + SMALL.cost(), t + SMALL.ttft
        else:
            raise ValueError(policy)
        cost += c
        correct += ok
        lat.append(t)
    lat.sort()
    return cost / N * 1000, correct / N, escalated / N, lat[int(0.95 * N)]


def brown_out() -> None:
    """Primary TTFT degrades from t=4 to t=15. Breaker: 3 slow-or-failed
    results open it for 5 s; then one probe (half-open)."""
    ttft = [0.4, 0.5, 0.4, 9, 12, 14, 13, 11, 10, 9, 8, 7, 6, 5, 4, 0.5, 0.4, 0.4, 0.5, 0.4]
    state, fails, opened, slow = "closed", 0, -99, 3.0
    waited = 0.0
    print("\nbrown-out replay: breaker counts TTFT > 3 s as a failure")
    print(" t  primary TTFT  breaker     served by   user waited")
    for t, x in enumerate(ttft, start=1):
        if state == "open" and t - opened >= 5:
            state = "half-open"
        if state == "open":
            route, w = "fallback", 0.9
        else:
            if x > slow:
                fails += 1
                route, w = "fallback", slow + 0.9  # deadline hit, then rerouted
                if state == "half-open" or fails >= 3:
                    state, opened = "open", t
            else:
                route, w, fails, state = "primary", x, 0, "closed"
        waited += w
        print(f"{t:2d}  {x:10.1f} s  {state:<10}  {route:<10}  {w:5.1f} s")
    print(f"total user wait {waited:.1f} s over {len(ttft)} requests;"
          f" without a breaker or deadline it would be {sum(ttft):.1f} s")


def main() -> None:
    print(f"{N:,} requests, {IN_TOK} input + {OUT_TOK} output tokens each")
    print(f"small ${SMALL.cost()*1000:.2f} per 1k requests, large ${LARGE.cost()*1000:.2f} per 1k\n")
    print(f"{'policy':<19}{'$ per 1k req':>13}{'quality':>9}{'to large':>10}{'p95 TTFT':>10}")
    for p in ("always large", "always small", "cascade", "predictive router"):
        c, q, e, l95 = run(p)
        print(f"{p:<19}{c:>13.2f}{q:>9.1%}{e:>10.1%}{l95:>9.2f}s")
    brown_out()


if __name__ == "__main__":
    main()
```

Run it with `python3 router.py`:

```text
20,000 requests, 1500 input + 300 output tokens each
small $0.40 per 1k requests, large $9.00 per 1k

policy              $ per 1k req  quality  to large  p95 TTFT
always large                9.00    99.2%      0.0%     0.90s
always small                0.40    73.8%      0.0%     0.25s
cascade                     3.23    96.8%     29.2%     4.55s
predictive router           3.20    94.7%     32.2%     0.92s

brown-out replay: breaker counts TTFT > 3 s as a failure
 t  primary TTFT  breaker     served by   user waited
 1         0.4 s  closed      primary       0.4 s
 2         0.5 s  closed      primary       0.5 s
 3         0.4 s  closed      primary       0.4 s
 4         9.0 s  closed      fallback      3.9 s
 5        12.0 s  closed      fallback      3.9 s
 6        14.0 s  open        fallback      3.9 s
 7        13.0 s  open        fallback      0.9 s
 8        11.0 s  open        fallback      0.9 s
 9        10.0 s  open        fallback      0.9 s
10         9.0 s  open        fallback      0.9 s
11         8.0 s  open        fallback      3.9 s
12         7.0 s  open        fallback      0.9 s
13         6.0 s  open        fallback      0.9 s
14         5.0 s  open        fallback      0.9 s
15         4.0 s  open        fallback      0.9 s
16         0.5 s  closed      primary       0.5 s
17         0.4 s  closed      primary       0.4 s
18         0.4 s  closed      primary       0.4 s
19         0.5 s  closed      primary       0.5 s
20         0.4 s  closed      primary       0.4 s
total user wait 26.3 s over 20 requests; without a breaker or deadline it would be 111.5 s
```

The **cascade** cuts cost by about 64% against always-large and keeps most of
the quality, but not all: its 96.8% is the large model's 99.2% minus the wrong
small answers the verifier accepted. Its p95 TTFT is 4.6 s, five times the
large model's, because escalated requests wait for a whole small answer before
the large model starts. The **predictive router** costs the same, keeps TTFT
near the large model's, and loses more quality, since nothing checks its
misroutes. Neither is "the right router"; they are two points on the
cost-quality-latency surface, and which one you want depends on whether the
call site is interactive.

In the brown-out, only three requests pay the 3 s first-token deadline before
the breaker opens (t = 4 to 6), and one more pays it when the half-open probe
at t = 11 fails. Total user wait drops from 111.5 s to 26.3 s. That only works
because the fallback route had capacity; the program assumes it did.

## Where it breaks

- **Quality numbers age.** A route's quality score is from one evaluation run
  against one model version. Provider updates, prompt changes, and traffic
  drift invalidate it. Re-run the evaluation on a schedule and on every change.
- **Verifiers share blind spots.** A verifier that is itself a model tends to
  accept the same plausible wrong answers the small model produces. The
  program's verifier errors are independent of the answer; real ones are not.
- **Fallback hides outages from capacity planning.** If the fallback absorbs a
  primary that is down 5% of the time, the fallback's quota is now production
  capacity. Size and pay for it as such.
- **Residency and contracts narrow the route set.** A tenant pinned to one
  region may have no fallback at all. The design must say what that tenant
  sees during an outage, not discover it during one.
- **The simulation is not a model.** Difficulty, skill, and verifier error are
  invented distributions. The program shows the shape of the tradeoff and the
  cascade's latency penalty, not what your router will achieve.

## Remember this

- One gateway in front of every model: identity, admission, routing, fallback, one usage record.
- Routes pin versions, carry your own quality numbers, and are filtered by policy before they are ranked by cost.
- A cascade's quality loss is its verifier's false accepts; its latency cost is a full small generation on every escalation.
- Fall back only before the first token, only onto reserved capacity, only with an evaluated prompt.
- Count slow first tokens as failures in the route's breaker.

## Try it

1. In `router.py`, make the verifier perfect (no false accepts or rejects).
   How close does the cascade get to always-large quality, and what does it
   cost?
2. Change the cascade so escalated requests stream the small answer to the
   user and then replace it. Which rule from the fallback section does that
   break, and what would the user see?
3. Add a third route that is cheaper than `large` but slightly worse, and a
   policy that uses it as the escalation target for medium-difficulty
   requests. Plot cost against quality for the five policies.
4. Write the route table for a tenant whose data must stay in one region, with
   one provider available there. What is its fallback, and what is its
   degraded mode?

## Check yourself

1. Why is a router change gated like a model change?

   {{< details summary="Show answer" >}}
   It changes which model answers which request, so it changes behavior. A
   new threshold or classifier can send a slice of hard requests to a model
   that fails them, which shows up only as lower quality on that slice. The
   evaluation suite, with slices, is what detects it.
   {{< /details >}}

2. A cascade's verifier accepts 10% of wrong small-model answers. What does
   that do to quality, and why can escalation not fix it?

   {{< details summary="Show answer" >}}
   Every accepted wrong answer is returned to the user, so quality is bounded
   above by one minus the rate of wrong-and-accepted answers. Escalation only
   happens on rejection, so those requests never reach the large model.
   Improving the verifier or lowering its acceptance threshold is the fix, at
   the cost of more escalations.
   {{< /details >}}

3. Why should fallback happen only before the first token?

   {{< details summary="Show answer" >}}
   After text has streamed, the user has seen part of one answer. A second
   model will not continue it consistently, and replaying the request would
   duplicate output and cost. Before the first token, switching is invisible.
   {{< /details >}}

4. Why must a model route's breaker count slow first tokens as failures?

   {{< details summary="Show answer" >}}
   A provider in a brown-out often returns every request successfully but
   with very long time to first token. Counting only errors would keep the
   breaker closed while every interactive user waits. Treating a deadline miss
   as a failure opens the breaker and sends traffic to the fallback quickly.
   {{< /details >}}

5. When is hedging a model call a poor trade?

   {{< details summary="Show answer" >}}
   When prompts are long. Both copies pay for input tokens and both run
   prefill until one is cancelled, so the duplicated work is most of the cost.
   Hedging suits short interactive prompts with a heavy first-token tail, and
   requires cancelling the losing copy.
   {{< /details >}}

## Sources

- J. Dean, L. A. Barroso, [The Tail at Scale](https://research.google/pubs/the-tail-at-scale/), Communications of the ACM, February 2013.
- L. Chen, M. Zaharia, J. Zou, [FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance](https://arxiv.org/abs/2305.05176), 2023.
- I. Ong et al., [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665), 2024.
- Kubernetes SIG Network, [Gateway API Inference Extension](https://gateway-api-inference-extension.sigs.k8s.io/), documentation, read October 2026.
- WHATWG, [HTML Living Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html).
- M. Nottingham, R. Fielding, [RFC 6585: Additional HTTP Status Codes](https://www.rfc-editor.org/rfc/rfc6585) (429 Too Many Requests), IETF, April 2012.
