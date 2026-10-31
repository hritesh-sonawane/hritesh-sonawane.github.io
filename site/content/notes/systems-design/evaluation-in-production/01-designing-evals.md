+++
title = 'Designing evals'
description = 'An eval is a measuring instrument. It needs cases drawn from the traffic you serve, grading that matches what you care about, and enough cases and repeats, analyzed in pairs, to detect the change you need to see. Otherwise it reports noise with confidence.'
question = 'How do you build an eval that can actually detect the change you care about?'
weight = 1
difficulty = 3
prerequisites = ['/notes/systems-design/agentic-systems/01-the-agent-loop', '/notes/systems-design/reliability-in-production/03-safe-change']
date = 2026-10-30T15:05:00Z
lastmod = 2026-10-30T15:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

You cannot test a probabilistic component with `assert equal`. You evaluate
it: run it on a fixed set of cases, grade each output, and compare the pass
rate with a baseline. That makes an eval a **measuring instrument**, and like
any instrument it has a resolution. A 200-case eval of a system at 85% has a
95% interval of about ±5 points, so it cannot see a 3-point regression no
matter how carefully the cases were written.

Three things set the resolution: **how many cases**, **how many runs per
case** (the system is not deterministic), and **whether you compare systems on
the same cases** (paired) or not. Three more things decide whether the
measurement means anything: cases that look like real traffic, including the
cases where the right answer is to refuse; grading the end state for agents;
and labels that are themselves correct. The consequence to act on: **decide
the smallest change you need to detect before you build the eval, and size it
for that**.

## A picture

```mermaid {title="The eval loop: production failures become cases, every change is compared in pairs"}
flowchart LR
  PR["<b>Production traces</b><br/><small>failures, escalations,<br/>sampled traffic</small>"] --> DS[("<b>Eval set</b><br/><small>versioned, sliced,<br/>must-pass tagged</small>")]
  EX["<b>Expert-written</b><br/><small>edge and refusal cases</small>"] --> DS
  DS --> RA["<b>Baseline</b><br/><small>k runs per case</small>"]
  DS --> RB["<b>Candidate</b><br/><small>same cases, k runs</small>"]
  RA --> GR["<b>Graders</b><br/><small>code first,<br/>validated judge</small>"]
  RB --> GR
  GR --> G{"<b>Gate</b><br/><small>paired difference,<br/>slices, must-pass,<br/>cost and latency</small>"}
  G -->|"pass"| SH["<b>Ship</b><br/><small>canary next</small>"]
  G -->|"fail"| RD["<b>Read flipped cases</b>"]
  SH --> PR
  class PR,EX io
  class DS memory
  class RA,RB,GR compute
  class G good
  class SH,RD neutral
```

The arrow from production back to the eval set is the method: each production
failure becomes a case, so the same failure cannot ship twice.

## How it really works

### What a case is

Each case is a row: the input, the context the system needs (user,
permissions, date, retrieved documents or an environment snapshot), a way to
grade the output, tags for slicing, and its source. Cover four kinds:

- **Typical** requests, in roughly the proportions you see.
- **Edge** cases: empty, very long, wrong language, ambiguous.
- **Should-not-answer** cases: missing information, out of scope, not entitled.
  A set made only of answerable questions measures half the system.
- **Adversarial** cases, including prompt injection; they double as security
  regression tests.

Tag a small set **must-pass** (safety rules, past incidents) and gate on them
separately; an average can hide one catastrophic case. Keep a **held-out**
portion nobody tunes prompts against. Version the set, give it an owner, and
record which version every result used.

Expect the labels to be wrong sometimes. Northcutt and colleagues (2021) found
an average of 3.3% label errors across the test sets of ten widely used
machine-learning benchmarks, and the human-validated SWE-bench Verified subset
exists because some original tasks were underspecified or had tests that
rejected valid fixes. When a case fails, "the expected answer is wrong" is a
cause to check every time.

### Grading agents: the end state, and more than once

For agents, grade **what the world looks like after the run**: did the
ticket close with the right resolution, do the repository's tests pass, is the
record correct? SWE-bench grades by running tests against the final
repository. A grader that demands one sequence of tool calls punishes better
paths. Grade the path only for properties that must hold on every path, such
as "never called a forbidden tool" or "asked before paying".

Each case needs a **reset environment** (a fresh sandbox, a seeded database),
or one run's side effects leak into the next.

Agents are run several times per case, and the summary depends on what the
product needs:

| Metric | Meaning | At 80% per-run success, k = 5 |
| --- | --- | --- |
| **pass@k** (Chen et al., 2021) | At least one of k attempts succeeds | `1 − 0.2^5` = 99.97% |
| **pass^k** (Yao et al., τ-bench, 2024) | All k attempts succeed | `0.8^5` = 33% |

pass@k fits a system where something checks candidates and keeps a good one.
pass^k fits a customer-facing agent, where every conversation must work. The
same agent looks excellent on one and poor on the other.

### Where the variance comes from

A pass rate varies between runs for three reasons:

1. **Which cases you have.** Cases differ in difficulty; a different sample of
   200 would give a different rate. This is usually the largest term.
2. **Sampling in the model.** At temperature above zero, the same case passes
   on some runs and fails on others.
3. **Infrastructure.** Even at temperature zero, inference servers can return
   different outputs for the same input because batch composition changes the
   order of floating-point operations (Thinking Machines Lab, 2025).

Evan Miller's "Adding Error Bars to Evals" (2024) works through the
consequences, and three recommendations follow directly:

- **Report an interval**, not just a rate. For a rate `p` on `n` independent
  cases, the standard error is `√(p(1−p)/n)`; at `p = 0.85`, `n = 500` that is
  1.6 points, so the 95% interval is about ±3.1.
- **Cluster by case.** Five runs of 200 cases are not 1,000 independent
  observations: runs of the same case are correlated. Compute the standard
  error from per-case means, or the interval is too narrow. The same applies
  to many questions drawn from one document.
- **Compare in pairs.** Run both systems on the same cases and analyze the
  per-case difference. Case difficulty cancels, which removes the largest
  variance term.

### Statistical power: sizing for the change you care about

Before building the eval, write down the **minimum detectable effect**: the
smallest regression that would matter. Then size for it. For an unpaired
comparison of two pass rates near `p`, with 5% significance and 80% power,

```text
n per arm ≈ (1.96 + 0.84)² × 2p(1−p) / δ²
p = 0.85, δ = 0.03:   7.84 × 0.255 / 0.0009 ≈ 2,221 cases per arm
```

For a paired comparison with one run per case, only the cases that **flip**
carry information (McNemar's test). If 5.5% of cases go from pass to fail and
2.5% from fail to pass (a 3-point net drop, 8% discordant):

```text
n ≈ (1.96 + 0.84)² × (p10 + p01) / (p10 − p01)²
  = 7.84 × 0.08 / 0.0009 ≈ 697 cases
```

Pairing helps most when the two systems agree on most cases, which is the usual
situation for a prompt or model change. Repeats help by averaging out the
sampling noise within each case, which makes the per-case difference sharper.

> [!IMPORTANT]
> An eval that cannot detect the regression you care about is not a gate. Size
> it from the minimum detectable effect, use paired comparisons, and report
> intervals clustered by case.

### The release gate

A gate is a short list of conditions, all of which must hold:

1. The paired difference against production is not worse than the agreed
   margin, judged by its interval, overall **and on each slice** the business
   cares about (a 97% overall can hide 80% on handwritten documents).
2. Every must-pass case passes.
3. Cost and latency percentiles stay inside budget, and so does the share of
   agent runs ending in each terminal state.

Then read the cases that flipped. A change that fixes ten cases and breaks
eight is not an improvement until you know what the eight are. Run the gate on
every change that can alter behavior: prompts, model versions, tool
descriptions, retrieval parameters, routing rules. A scheduled re-run against
production catches silent drift from provider-side changes.

### Contamination

If eval cases leak into training data, or prompts are tuned against them until
they pass, the eval measures memory. Oren and colleagues (2024) showed
contamination of public benchmarks can be detected statistically from a model's
preference for the canonical ordering of a test set. For your own evals, the
defenses are procedural: keep the held-out set out of prompt-tuning loops and
out of anything sent to a provider that trains on inputs, and refresh it from
production.

## Code

The program builds a population of 20,000 cases with varied difficulty. System
A passes 85% on average; candidate B got worse on one case in five, for a true
drop of 2.9 points. Each simulated experiment samples `n` cases and tests the
difference three ways: unpaired with one run per case, paired with one run,
and paired with five runs. The second part checks how often a nominal 95%
interval actually contains the true pass rate when 200 cases are each run 5
times.

```python {title="eval_power.py"}
"""eval_power.py: can an eval detect a 3-point regression, and is its error bar honest?

A population of 20,000 cases with varied difficulty. System A passes 85% on
average; system B is a candidate that got worse on one case in five, for a
true drop of about 3 points. Each simulated experiment samples n cases, runs
each system k times per case, and tests the difference. Standard library only.
"""

from __future__ import annotations

import math
import random
import statistics

Z = 1.96
EXPERIMENTS = 300


def population(rng: random.Random, size: int = 20_000) -> tuple[list[float], list[float]]:
    a = [rng.betavariate(3.4, 0.6) for _ in range(size)]          # mean ~0.85
    b = [max(0.0, p - 0.15) if rng.random() < 0.2 else p for p in a]
    return a, b


def run(p: float, k: int, rng: random.Random) -> float:
    return sum(rng.random() < p for _ in range(k)) / k


def power(a: list[float], b: list[float], n: int, k: int, paired: bool,
          rng: random.Random) -> float:
    hits = 0
    for _ in range(EXPERIMENTS):
        idx = rng.sample(range(len(a)), n)
        ra = [run(a[i], k, rng) for i in idx]
        if paired:
            rb = [run(b[i], k, rng) for i in idx]            # same cases
        else:
            other = rng.sample(range(len(a)), n)               # fresh cases
            rb = [run(b[i], k, rng) for i in other]
        if paired:
            d = [y - x for x, y in zip(ra, rb)]
            se = statistics.stdev(d) / math.sqrt(n)
            z = statistics.mean(d) / se
        else:
            se = math.sqrt(statistics.variance(ra) / n + statistics.variance(rb) / n)
            z = (statistics.mean(rb) - statistics.mean(ra)) / se
        hits += z < -Z
    return hits / EXPERIMENTS


def coverage(a: list[float], n: int, k: int, rng: random.Random) -> tuple[float, float]:
    """Share of 95% intervals that contain the true pass rate: naive vs clustered."""
    truth = statistics.mean(a)
    naive = clustered = 0
    for _ in range(EXPERIMENTS):
        idx = rng.sample(range(len(a)), n)
        per_case = [run(a[i], k, rng) for i in idx]
        m = statistics.mean(per_case)
        se_naive = math.sqrt(m * (1 - m) / (n * k))         # treats n*k runs as independent
        se_clust = statistics.stdev(per_case) / math.sqrt(n)  # one cluster per case
        naive += abs(m - truth) <= Z * se_naive
        clustered += abs(m - truth) <= Z * se_clust
    return naive / EXPERIMENTS, clustered / EXPERIMENTS


def main() -> None:
    rng = random.Random(3)
    a, b = population(rng)
    print(f"true pass rates: A {statistics.mean(a):.3f}, B {statistics.mean(b):.3f},"
          f" drop {100 * (statistics.mean(a) - statistics.mean(b)):.1f} points\n")
    print("power to detect the drop (one-sided z, alpha 0.025), "
          f"{EXPERIMENTS} experiments per cell")
    print(f"{'cases':>7}{'unpaired k=1':>14}{'paired k=1':>12}{'paired k=5':>12}")
    for n in (100, 300, 1000, 2000):
        row = [power(a, b, n, 1, False, rng), power(a, b, n, 1, True, rng),
               power(a, b, n, 5, True, rng)]
        print(f"{n:>7}{row[0]:>14.0%}{row[1]:>12.0%}{row[2]:>12.0%}")

    print("\n95% interval coverage for A's pass rate, 200 cases x 5 runs each:")
    nv, cl = coverage(a, 200, 5, rng)
    print(f"  naive binomial on 1,000 runs  {nv:.0%}")
    print(f"  clustered by case             {cl:.0%}")

    pa = statistics.mean(a)
    unpaired_n = (Z + 0.84) ** 2 * 2 * pa * (1 - pa) / 0.03 ** 2
    print(f"\nformula, unpaired, 80% power for 3 points at {pa:.2f}: "
          f"{unpaired_n:,.0f} cases per arm")


if __name__ == "__main__":
    main()
```

Run it with `python3 eval_power.py`:

```text
true pass rates: A 0.850, B 0.821, drop 2.9 points

power to detect the drop (one-sided z, alpha 0.025), 300 experiments per cell
  cases  unpaired k=1  paired k=1  paired k=5
    100            8%         10%         26%
    300           21%         21%         59%
   1000           43%         50%         99%
   2000           72%         79%        100%

95% interval coverage for A's pass rate, 200 cases x 5 runs each:
  naive binomial on 1,000 runs  85%
  clustered by case             94%

formula, unpaired, 80% power for 3 points at 0.85: 2,221 cases per arm
```

With 300 cases and one run each, the eval detects a real 3-point regression
about one time in five, whether paired or not. With one run per case,
sampling noise inside each case is as large as the difference between cases,
so pairing has little to cancel. Five runs per case, paired, detect it 59% of
the time at 300 cases and 99% at 1,000. Per run spent, the trade is roughly
even: five runs on 300 cases (1,500 runs per system, 59%) sits between one run
on 1,000 cases (50%) and one run on 2,000 (79%). But it needs 300 labeled
cases instead of 1,500, and labeled cases are the expensive part.

The coverage check is the clustering point: treating 1,000 runs as independent
gives an interval that contains the truth 85% of the time, not 95%. Computing
the error from per-case means restores it.

## Where it breaks

- **The simulation's systems differ in one clean way.** Real regressions
  concentrate in slices, and a regression confined to 3% of traffic needs a
  slice large enough to see it. Size slices too, not just the total.
- **Power does not fix validity.** A well-powered eval on unrepresentative
  cases measures the wrong thing precisely. Refresh cases from production and
  check their mix against traffic.
- **Grading error is not in this model.** A judge with its own error rate adds
  noise and shrinks differences;
  [model graders](/notes/systems-design/evaluation-in-production/02-model-graders/)
  shows how much.
- **Repeated testing inflates false alarms.** Running the gate on twenty
  changes a week at 5% significance yields about one false failure a week.
  Read the flipped cases before blocking, and fix the margin in advance.
- **Offline cannot contain what you did not imagine.** New user behavior shows
  up first in production, which is why
  [online evaluation](/notes/systems-design/evaluation-in-production/03-online-evaluation/)
  exists.

## Remember this

- An eval is an instrument with a resolution; size it for the minimum detectable effect.
- Include should-not-answer and adversarial cases, tag must-pass cases, and keep a held-out set.
- Grade agents on the end state in a reset environment; choose pass@k or pass^k by what the product needs.
- Compare systems in pairs on the same cases, with several runs per case.
- Cluster error bars by case; repeated runs are not independent cases.
- Gate on slices, must-pass cases, and cost and latency, then read what flipped.

## Try it

1. Run `eval_power.py`. Change the regression so it affects 5% of cases by 0.6
   instead of 20% by 0.15 (the same mean drop). How does power change at 300
   cases?
2. Add a "paired, k = 3" column. Where is the best trade between cases and
   runs if a labeled case costs 20 times as much as a run?
3. Use the paired formula to size an eval that must detect a 2-point drop when
   6% of cases are discordant.
4. Compute pass^k for k = 1 to 8 for an agent at 90% per-run success. At what
   k does it fall below 50%?
5. For an eval you own, write down its minimum detectable effect today. Is
   that smaller than the regressions you care about?

## Check yourself

1. Why do five runs of 200 cases not give the precision of 1,000 cases?

   {{< details summary="Show answer" >}}
   Runs of the same case are correlated: a hard case tends to fail on every
   run. The effective sample size is closer to 200 than 1,000 for the
   case-difficulty component of variance, so the standard error must be
   computed from per-case means (clustered by case).
   {{< /details >}}

2. Why does pairing reduce the number of cases needed?

   {{< details summary="Show answer" >}}
   Comparing both systems on the same cases cancels case difficulty, the
   largest source of variance. Only cases whose outcome differs between the
   systems carry information, and when the systems mostly agree, far fewer
   cases are needed to see a given net difference.
   {{< /details >}}

3. When is pass^k the right metric rather than pass@k?

   {{< details summary="Show answer" >}}
   When every attempt is seen by a user or has effects, as with a
   customer-facing agent: reliability across attempts matters. pass@k fits
   settings where a verifier can pick a good attempt from several.
   {{< /details >}}

4. A candidate scores 97% overall and 82% on one important slice. What does
   the gate do?

   {{< details summary="Show answer" >}}
   It blocks. The gate applies per slice because an overall average can hide a
   failing group; the slice result, judged by its interval against its own
   threshold, decides.
   {{< /details >}}

5. Why grade an agent on its end state rather than its tool-call sequence?

   {{< details summary="Show answer" >}}
   Many paths reach a correct outcome, and a sequence-matching grader penalizes
   better or different solutions. Grade the final state, and check the path
   only for invariants every path must satisfy, such as never calling a
   forbidden tool.
   {{< /details >}}

## Sources

- E. Miller, [Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations](https://arxiv.org/abs/2411.00640), November 2024.
- M. Chen et al., [Evaluating Large Language Models Trained on Code](https://arxiv.org/abs/2107.03374), 2021 (pass@k).
- S. Yao et al., [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045), 2024 (pass^k).
- C. E. Jimenez et al., [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770), ICLR 2024.
- OpenAI, [Introducing SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/), August 2024.
- C. G. Northcutt, A. Athalye, J. Mueller, [Pervasive Label Errors in Test Sets Destabilize Machine Learning Benchmarks](https://arxiv.org/abs/2103.14749), NeurIPS Datasets and Benchmarks, 2021.
- Y. Oren et al., [Proving Test Set Contamination in Black Box Language Models](https://arxiv.org/abs/2310.17623), ICLR 2024.
- H. He and Thinking Machines Lab, [Defeating Nondeterminism in LLM Inference](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), September 2025.
- Q. McNemar, "Note on the sampling error of the difference between correlated proportions or percentages", *Psychometrika* 12(2), 1947.
