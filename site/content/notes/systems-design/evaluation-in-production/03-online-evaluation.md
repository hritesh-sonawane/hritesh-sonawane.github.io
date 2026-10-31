+++
title = 'Online evaluation'
description = 'Offline evals cannot contain what users will actually do. On live traffic, combine implicit signals, sampled judging, and controlled experiments, and protect every decision with guardrail metrics, a sample-ratio check, and a stopping rule fixed in advance.'
question = 'How do you measure quality on live traffic and decide whether a change ships?'
weight = 3
difficulty = 4
prerequisites = ['/notes/systems-design/evaluation-in-production/01-designing-evals', '/notes/systems-design/evaluation-in-production/02-model-graders', '/notes/systems-design/reliability-in-production/03-safe-change']
date = 2026-10-30T15:15:00Z
lastmod = 2026-10-30T15:15:00Z
verified = 2026-10-30
+++

## The idea in one minute

An offline eval answers "is the candidate at least as good on the cases we
thought of?". Production answers a different question: "is it better for the
people using it, on the traffic they actually send?". Online evaluation
measures that, with three kinds of evidence: **implicit signals** (retries,
rephrasing, edits, abandonment, escalation), **sampled judging** of live
outputs, and **controlled experiments** that randomize users between the
current system and the candidate.

Experiments on live traffic go wrong in well-known ways. The split is not what
you set (**sample ratio mismatch**), someone checks the dashboard daily and
stops at the first good-looking result (**peeking**), or the primary metric
improves while latency, cost, or safety quietly gets worse (missing
**guardrail metrics**). And many quality differences are too small for an A/B
test on sparse feedback to see in reasonable time; **interleaving** and paired
designs are far more sensitive where they apply. The consequence to act on:
**fix the metrics, guardrails, sample size, and stopping rule before the
experiment starts**, and check the split before reading any result.

## A picture

```mermaid {title="From offline gate to full rollout, with guardrails at every stage"}
flowchart LR
  OFF["<b>Offline gate</b><br/><small>paired eval passed</small>"] --> SH["<b>Shadow</b><br/><small>mirrored traffic,<br/>effects stubbed, judged</small>"]
  SH --> CA["<b>Canary</b><br/><small>1 to 5% of users</small>"]
  CA --> AB["<b>Experiment</b><br/><small>randomized by user,<br/>fixed size and stop rule</small>"]
  AB --> FULL["<b>Full rollout</b><br/><small>plus long-term holdout</small>"]
  GR{"<b>Guardrails</b><br/><small>SRM, latency, cost,<br/>errors, safety</small>"}
  CA --> GR
  AB --> GR
  GR -->|"breached"| RB["<b>Roll back</b>"]
  FULL -->|"failures become cases"| OFF
  class OFF,FULL neutral
  class SH,CA,AB compute
  class GR good
  class RB neutral
```

Each stage exposes more users only after the previous one held. The guardrail
check runs throughout and can stop any stage on its own.

## How it really works

### Signals on live traffic

| Signal | Example | Strength | Weakness |
| --- | --- | --- | --- |
| **Implicit behavior** | Retry, rephrase within a minute, copy the answer, edit distance on a draft before sending, abandonment, escalation to a human | Plentiful, on every session | Ambiguous: a copy may mean success or a complaint pasted elsewhere |
| **Explicit feedback** | Thumbs up or down, ratings | Direct | Sparse (often a few percent of sessions) and skewed toward unhappy users |
| **Sampled judging** | A validated judge grades 1% of outputs on the rubric | Measures quality directly, comparable with offline | Judge errors; privacy obligations for stored traffic |
| **Task outcomes** | Ticket resolved without reopening, pull request merged, refund not reversed | Closest to value | Delayed, sometimes by weeks |
| **Agent terminal states** | Share of runs ending succeeded, needs-human, budget-exhausted | Cheap, exact | Says nothing about answer quality |

Combine them. A candidate that raises thumbs-up but also raises rephrase rate
and escalations is worse, not better. Read traces every week as well:
dashboards report what you thought to measure, and transcripts show what you
did not.

Sampled judging stores user content. Decide retention, redaction, and access
for the sample before turning it on, and keep the judge validated on live
traffic, not only on the offline set
([model graders](/notes/systems-design/evaluation-in-production/02-model-graders/)).

### Why sparse feedback makes A/B tests slow

Suppose 5% of conversations leave feedback and 4% of that feedback is negative.
To detect a relative 10% change in the negative rate (4.0% to 3.6%) with 80%
power:

```text
n per arm = (1.96 + 0.84)² × 2 × 0.04 × 0.96 / 0.004²  ≈ 37,600 rated conversations
at a 5% feedback rate                                 ≈ 750,000 conversations per arm
```

That is weeks of traffic for many products, for one comparison. Three ways to
need less:

- **Denser metrics.** Rephrase rate or judge-sampled quality is observed on far
  more sessions than thumbs.
- **Variance reduction.** CUPED (Deng et al., 2013) adjusts each user's metric
  by their pre-experiment value of the same metric; if the correlation is `ρ`,
  variance falls by a factor of `1 − ρ²`, so `ρ = 0.5` saves a quarter of the
  sample.
- **Paired designs.** Show both systems to the same user on the same query
  (interleaving for ranked results, side-by-side for answers) so user and
  query variance cancel, as paired offline evals do.

### Designing the experiment

- **Randomize by user**, not by request. Conversations carry memory and users
  learn the system's behavior, so per-request randomization lets one arm
  affect the other. Analyze at the same unit, or the error bars are too
  narrow, the same clustering point as in
  [designing evals](/notes/systems-design/evaluation-in-production/01-designing-evals/).
- **One primary metric** (an overall evaluation criterion, in Kohavi's terms),
  chosen in advance, plus a few secondary metrics for diagnosis.
- **Guardrail metrics** that must not get worse, whatever the primary metric
  does: p95 latency and time to first token, cost per conversation, error and
  timeout rates, refusal rate, judge-sampled safety-violation rate, tool-denial
  and approval rates for agents, and escalations. A guardrail breach stops the
  rollout even if the primary metric improves.
- **A fixed sample size or a sequential test.** Decide in advance when you
  will look and what you will conclude.
- **Long enough to cover cycles and novelty.** Weekly patterns and novelty
  effects (users trying a new behavior once) distort short tests; a small
  long-term holdout on the old system catches slow effects.

### Check the split first

A **sample ratio mismatch** (SRM) is a split that differs from the design by
more than chance, for example 50.6% to 49.4% on 100,000 users when 50/50 was
intended. Its p-value under a chi-square test is about 0.00015. SRM means
something in the assignment or logging differs between arms (one arm crashes
more and loses sessions, a bot filter treats arms differently, a redirect
drops users), so every metric is suspect. Fabijan and colleagues (2019)
describe SRM as one of the most common causes of invalid experiments in
practice. Check SRM automatically and refuse to show results when it fires.

### Peeking

A fixed-horizon test is valid only if you look once, at the planned end. If
you check a dashboard every day and stop at the first `p < 0.05`, the false
positive rate rises well above 5%: the program below gets about 24% over 20
daily looks with no real difference at all. Johari and colleagues (2017)
describe the problem and **always-valid** p-values for sequential testing,
which let you monitor continuously and stop early without inflating errors.
Use a sequential method if people will look, or fix the horizon and enforce
it. Guardrails are different: they are safety checks and may stop an
experiment at any time.

### Interleaving, where it applies

For anything that produces a **ranked list** (retrieval results, search,
recommendations, suggested actions), **interleaving** compares two rankers
inside the same result list. Team-draft interleaving (Radlinski, Kurup, and
Joachims, 2008) alternates picks from the two rankings like captains choosing
teams, shows the merged list, and credits each click to the ranker that
contributed that result. Each query becomes a paired comparison by the same
user on the same query. Chapelle and colleagues (2012) validated interleaving
at scale against A/B tests on a commercial search engine and found it agreed
with A/B outcomes while needing far fewer queries.

```mermaid {title="Team-draft interleaving: one list, two teams, clicks credited per team"}
sequenceDiagram
  autonumber
  participant A as Ranker A
  participant B as Ranker B
  participant M as Interleaver
  actor U as User
  M->>A: coin flip, A picks first: top unused result
  M->>B: B picks its top unused result
  M->>A: next round, order flipped at random
  M->>U: merged list, teams hidden
  U-->>M: clicks on results 2 and 4
  rect rgb(226, 239, 216)
    Note over M: credit each click to the team that placed it, the query goes to the team with more clicks
  end
```

Generated answers are not ranked lists, so interleaving does not apply
directly. The analog is a **side-by-side** comparison: show two responses and
let the user pick, which is paired by construction but changes the product
experience and is best used sparingly. For a retrieval-augmented system,
interleave the retriever's results where users see them, and evaluate the
generator with sampled judging.

### Shadow and canary for agents

A **shadow** deployment runs the candidate on mirrored traffic without showing
its output. For pure text it is a cheap way to collect judge-graded outputs on
real inputs before any user sees them. For agents, every tool with an effect
must be stubbed or pointed at a sandbox, or the shadow sends real emails; the
shadow then measures planning and tool choice, not outcomes. A **canary**
exposes a small share of users with automatic rollback on guardrails, as in
[safe change](/notes/systems-design/reliability-in-production/03-safe-change/).

## Code

The program simulates three things. An A/A test (no real difference) on a 4%
thumbs-down rate, run for 20 days, checked once at the end or daily with
early stopping. A sample-ratio check on two splits. And two rankers, A
slightly better than B, compared by an A/B test on clicks per query and by
team-draft interleaving, with simulated users whose engagement varies widely.

```python {title="online.py"}
"""online.py: three hazards and one tool of online evaluation.

1. Peeking: checking an A/A test every day and stopping at the first p < 0.05.
2. Sample ratio mismatch: a chi-square check that the split is what you set.
3. Interleaving versus A/B for two rankers that differ slightly, with clicks
   simulated by a position-based model (users examine rank r with
   probability u/r, u varying by user, and click a relevant result they examine).
Simulated users; standard library only; runs offline.
"""

from __future__ import annotations

import math
import random
import statistics

Z = 1.96


def peeking(rng: random.Random, days: int = 20, per_day: int = 2_000,
            trials: int = 1_000) -> tuple[float, float]:
    """A/A test on a 4% thumbs-down rate. Returns (false positive rate when
    checking once at the end, when checking daily and stopping early)."""
    end = peek = 0
    for _ in range(trials):
        xa = xb = n = 0
        stopped = False
        for _ in range(days):
            n += per_day
            xa += sum(rng.random() < 0.04 for _ in range(per_day))
            xb += sum(rng.random() < 0.04 for _ in range(per_day))
            p = (xa + xb) / (2 * n)
            z = (xa - xb) / n / math.sqrt(2 * p * (1 - p) / n)
            if abs(z) > Z and not stopped:
                stopped = True
        peek += stopped
        end += abs(z) > Z
    return end / trials, peek / trials


def srm_p(n_a: int, n_b: int) -> float:
    """Chi-square goodness of fit against a 50/50 split, 1 degree of freedom."""
    e = (n_a + n_b) / 2
    chi2 = (n_a - e) ** 2 / e + (n_b - e) ** 2 / e
    return math.erfc(math.sqrt(chi2 / 2))


def ranking(rel: list[float], noise: float, rng: random.Random) -> list[int]:
    return sorted(range(len(rel)), key=lambda d: -(rel[d] + rng.gauss(0, noise)))


def clicks(shown: list[int], rel: list[float], user: float,
           rng: random.Random) -> list[bool]:
    return [rng.random() < user / (r + 1) and rng.random() < rel[d]
            for r, d in enumerate(shown)]


def user(rng: random.Random) -> float:
    """How much this user engages: varies a lot between users, as in practice."""
    return min(1.0, rng.lognormvariate(-1.5, 1.5))


def query(rng: random.Random) -> list[float]:
    k = rng.choice((1, 3, 10))        # some queries have many good results, some none
    return [rng.random() ** k for _ in range(10)]


def ab_detects(n: int, rng: random.Random) -> bool:
    a = [sum(clicks(ranking(q, 0.25, rng)[:5], q, user(rng), rng))
         for q in (query(rng) for _ in range(n))]
    b = [sum(clicks(ranking(q, 0.35, rng)[:5], q, user(rng), rng))
         for q in (query(rng) for _ in range(n))]
    se = math.sqrt(statistics.variance(a) / n + statistics.variance(b) / n)
    return (statistics.mean(a) - statistics.mean(b)) / se > Z


def interleave_detects(n: int, rng: random.Random) -> bool:
    wins_a = wins_b = 0
    for _ in range(n):
        q = query(rng)
        ra, rb = ranking(q, 0.25, rng), ranking(q, 0.35, rng)
        shown: list[int] = []
        team: list[str] = []
        while len(shown) < 5:                       # team-draft interleaving
            order = ("A", "B") if rng.random() < 0.5 else ("B", "A")
            for t in order:
                if len(shown) == 5:
                    break
                src = ra if t == "A" else rb
                d = next(d for d in src if d not in shown)
                shown.append(d)
                team.append(t)
        c = clicks(shown, q, user(rng), rng)
        ca = sum(ci for ci, t in zip(c, team) if t == "A")
        cb = sum(ci for ci, t in zip(c, team) if t == "B")
        wins_a += ca > cb
        wins_b += cb > ca
    return (wins_a - wins_b) / math.sqrt(max(1, wins_a + wins_b)) > Z


def main() -> None:
    rng = random.Random(8)
    end, peek = peeking(rng)
    print("1. A/A test, 20 days, 2,000 users per arm per day, 1,000 repetitions")
    print(f"   false positives, one look at the end      {end:.1%}")
    print(f"   false positives, stop at first daily p<.05 {peek:.1%}\n")

    print("2. sample ratio mismatch, intended 50/50")
    for a, b in ((50_150, 49_850), (50_600, 49_400)):
        print(f"   {a:,} vs {b:,}   p = {srm_p(a, b):.2g}")

    print("\n3. ranker A is slightly better than B; share of 100 experiments that detect it")
    print(f"   {'n queries':>10}{'A/B, n per arm':>17}{'interleaved, n total':>23}")
    for n in (500, 2_000, 8_000):
        ab = sum(ab_detects(n, rng) for _ in range(100)) / 100
        il = sum(interleave_detects(n, rng) for _ in range(100)) / 100
        print(f"   {n:>10,}{ab:>17.0%}{il:>23.0%}")


if __name__ == "__main__":
    main()
```

Run it with `python3 online.py`:

```text
1. A/A test, 20 days, 2,000 users per arm per day, 1,000 repetitions
   false positives, one look at the end      3.6%
   false positives, stop at first daily p<.05 23.6%

2. sample ratio mismatch, intended 50/50
   50,150 vs 49,850   p = 0.34
   50,600 vs 49,400   p = 0.00015

3. ranker A is slightly better than B; share of 100 experiments that detect it
    n queries   A/B, n per arm   interleaved, n total
          500               7%                    12%
        2,000              28%                    46%
        8,000              75%                    92%
```

Checking an A/A test daily and stopping at the first significant result
produces a "winner" in about a quarter of experiments where nothing changed;
one look at the end stays near the nominal 5%. A 50.15/49.85 split is
ordinary noise, and a 50.6/49.4 split is a bug to find before reading any
metric. For the rankers, interleaving with `n` queries in total is more
sensitive than an A/B test with `n` queries in each arm, so it reaches a given
power with well under half the traffic. In this model the gain is modest,
because the simulated users are less varied than real ones; the published
production comparisons report much larger reductions.

## Where it breaks

- **Implicit signals are proxies.** Users rephrase because they are exploring,
  not only because the answer was wrong. Validate each proxy against judged or
  labeled outcomes before using it as a primary metric.
- **Interleaving measures preference within a list.** It says which ranker's
  results get clicked, not whether the final answer improved, and it cannot
  evaluate changes to the generator, latency, or cost.
- **Agents interfere across arms.** Shared memory, shared caches, shared tool
  rate limits, and humans who review both arms' approvals can leak one arm's
  behavior into the other. Partition what you can, and treat leaks as a
  reason to trust results less.
- **Guardrails need their own power.** A safety-violation rate of 0.1% needs a
  very large sample to show a doubling. For rare, severe failures, rely on
  must-pass offline cases, red-teaming, and per-incident review rather than
  experiment statistics.
- **The simulation is clean.** It has no bots, no logging loss, no novelty
  effects, and no seasonal traffic, which are the usual reasons real
  experiments mislead.

## Remember this

- Offline evals gate; online evaluation tells you whether users are better off.
- Combine implicit signals, sampled judging, outcomes, and terminal states; read traces weekly.
- Randomize and analyze by user; fix the primary metric, guardrails, size, and stopping rule in advance.
- Check sample ratio mismatch before reading any result.
- Do not peek at fixed-horizon tests; use sequential methods if people will look.
- Use paired designs (interleaving, side-by-side) where they apply; they need far less traffic.

## Try it

1. Run `online.py`. Change the A/A test to check every 5 days instead of
   daily. How much does the false positive rate fall?
2. Make ranker B identical to A (`noise = 0.25`) and confirm interleaving
   reports a winner about 2.5% of the time in each direction.
3. Add CUPED to the A/B part: give each simulated user a pre-period click count
   correlated with their engagement, and adjust. How many queries does it save?
4. Compute the sample size to detect a change in rephrase rate from 12% to 11%
   per conversation. Compare it with the thumbs-down example.
5. For an agent you run, list the guardrail metrics you would require before
   raising its traffic share, and the value of each that would trigger
   rollback.

## Check yourself

1. Why randomize by user rather than by request in a conversational product?

   {{< details summary="Show answer" >}}
   Conversations carry memory and users adapt to behavior they have seen, so
   requests from the same user are not independent and one arm can influence
   the other. Randomizing and analyzing by user keeps the arms separate and
   the error bars honest.
   {{< /details >}}

2. What does a sample ratio mismatch tell you, and what do you do?

   {{< details summary="Show answer" >}}
   Assignment or logging differs between arms beyond chance, so users or
   events are being lost or added unevenly and every metric may be biased.
   Do not interpret results; find and fix the cause, then rerun.
   {{< /details >}}

3. Why does stopping at the first significant daily result inflate false
   positives?

   {{< details summary="Show answer" >}}
   Each look is another chance for noise to cross the threshold, and stopping
   on the first crossing keeps those chance results. Over many looks the
   probability of at least one crossing is far above 5%. Sequential tests with
   always-valid p-values correct for continuous monitoring.
   {{< /details >}}

4. Why is interleaving more sensitive than an A/B test for rankers?

   {{< details summary="Show answer" >}}
   Each query is a paired comparison: the same user, the same query, both
   rankers in one list. Variation between users and queries, which dominates
   A/B variance, cancels out.
   {{< /details >}}

5. A candidate improves the primary metric but raises p95 latency past its
   guardrail. Does it ship?

   {{< details summary="Show answer" >}}
   No. Guardrail metrics are constraints, not trade-offs to negotiate after the
   fact. Fix the latency, or make an explicit, recorded decision to change the
   guardrail, then rerun.
   {{< /details >}}

## Sources

- R. Kohavi, D. Tang, Y. Xu, *Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing*, Cambridge University Press, 2020.
- A. Fabijan et al., "Diagnosing Sample Ratio Mismatch in Online Controlled Experiments: A Taxonomy and Rules of Thumb for Practitioners", KDD 2019.
- A. Deng, Y. Xu, R. Kohavi, T. Walker, "Improving the Sensitivity of Online Controlled Experiments by Utilizing Pre-Experiment Data", WSDM 2013.
- R. Johari, P. Koomen, L. Pekelis, D. Walsh, "Peeking at A/B Tests: Why it matters, and what to do about it", KDD 2017.
- F. Radlinski, M. Kurup, T. Joachims, "How does clickthrough data reflect retrieval quality?", CIKM 2008.
- O. Chapelle, T. Joachims, F. Radlinski, Y. Yue, "Large-scale validation and analysis of interleaved search evaluation", *ACM Transactions on Information Systems* 30(1), 2012.
- J. Parks, J. Aurisset, M. Ramm, [Innovating Faster on Personalization Algorithms at Netflix Using Interleaving](https://netflixtechblog.com/interleaving-in-online-experiments-at-netflix-a04ee392ec55), Netflix Technology Blog, November 2017.
