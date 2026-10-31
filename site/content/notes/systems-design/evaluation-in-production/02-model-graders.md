+++
title = 'Model graders'
description = 'A model can grade free-text output at scale, but it is a classifier with its own error rates and biases. Measure it against human labels, correct the pass rates it reports, remove position and length effects by design, and re-validate whenever the judge or the task changes.'
question = 'When can a model grade another model, and how do you know the grader is right?'
weight = 2
difficulty = 4
prerequisites = ['/notes/systems-design/evaluation-in-production/01-designing-evals', '/notes/ai-security-engineering/how-attacks-work/01-prompt-injection']
date = 2026-10-30T15:10:00Z
lastmod = 2026-10-30T15:10:00Z
verified = 2026-10-30
+++

## The idea in one minute

Code can check JSON, exact answers, and whether tests pass. It cannot check
whether an answer is faithful to its sources, helpful, or in the right tone.
For those, a **model grader** (an "LLM judge") reads the output against a
rubric and returns a verdict. It scales, and it is wrong in measurable ways.

Treat the judge as a **classifier** whose positive class is "pass". Like any
classifier it has a sensitivity (how often it passes good outputs) and a
specificity (how often it fails bad ones), and the pass rate it reports is not
the true pass rate. A judge with 95% sensitivity and 70% specificity reports
82% for a system that is really at 80%, and shrinks every real difference
between systems by about a third. Judges also prefer the answer in the first
slot, longer answers, and sometimes outputs from their own model family. The
consequence to act on: **never use a judge's numbers until you have measured it
against human labels on your task, and correct or design around the errors you
find.**

## A picture

```mermaid {title="Validate the judge against people before trusting its numbers"}
flowchart LR
  O["<b>Outputs</b><br/><small>sample of the eval set</small>"] --> HU["<b>Human labels</b><br/><small>two raters, adjudicated</small>"]
  O --> J["<b>Judge</b><br/><small>rubric, pinned model,<br/>verdict after reasoning</small>"]
  HU --> CM{"<b>Compare</b><br/><small>sensitivity, specificity,<br/>kappa, per slice</small>"}
  J --> CM
  CM -->|"good enough"| USE["<b>Use on full set</b><br/><small>report corrected rate</small>"]
  CM -->|"not yet"| RB["<b>Fix rubric or judge</b>"]
  RB --> J
  USE -.->|"judge or task changes"| O
  class O io
  class HU neutral
  class J compute
  class CM good
  class USE,RB neutral
```

The comparison is the control. It is repeated whenever the judge model, the
rubric, or the system being graded changes enough to shift the kinds of errors
it makes.

## How it really works

### Use a judge only where code cannot decide

| Grader | Use for | Limits |
| --- | --- | --- |
| **Code** | Schema validity, exact or numeric answers, required citations present, forbidden strings, tool-call constraints, tests | Cannot judge meaning |
| **Model judge** | Faithfulness to sources, rubric criteria on free text, pairwise preference | A classifier with errors and biases; must be validated |
| **People** | Building and validating the other two; disputes; high-stakes samples | Slow, costly, and they disagree with each other |

Mix them per criterion. An answer can be checked by code for "cites at least
one source", by a judge for "every claim is supported by a cited source", and
by people on a sample.

### Rubrics that a judge can apply

Vague rubrics produce noisy grades. "Rate helpfulness 1 to 10" invites the
judge's own taste; "Does the answer state the correct refund window from the
policy? Answer yes or no" can be checked. Practices that help:

- **One binary criterion per call**, or a short checklist with a verdict per
  item. Several numbers you can act on beat one blended score.
- **A reference** where one exists: the expected facts, the source passage,
  the policy text.
- **Reasoning before the verdict**, in a structured output (`reasoning`, then
  `verdict`), so the verdict is conditioned on the reasoning. G-Eval (Liu et
  al., 2023) combined step-by-step evaluation instructions with a form-filling
  output.
- **Quote the evidence.** Ask the judge to quote the unsupported claim; a
  verdict without a quote is easier to audit as wrong.
- **Pin the judge model and prompt version**, and record both with every grade.

Rubrics also drift as you read outputs. Shankar and colleagues ("Who Validates
the Validators?", 2024) observed that people refine their criteria while
grading, so the rubric and the human labels should be developed together
before the judge is validated, not after.

### Measuring a judge against people

Label a calibration sample by hand (a few hundred outputs, stratified so the
failure class is well represented), run the judge on the same sample, and
compute:

| Measure | What it tells you |
| --- | --- |
| **Sensitivity** (true pass rate) | Share of good outputs the judge passes |
| **Specificity** (true fail rate) | Share of bad outputs the judge fails; usually the weaker number |
| **Raw agreement** | Share of matching verdicts; misleading when one class dominates |
| **Cohen's kappa** | Agreement beyond chance; 0 is chance, 1 is perfect |
| **Human-human agreement** | The ceiling: a judge cannot be validated beyond what people agree on |

Raw agreement flatters a lenient judge. If 80% of outputs are good, a judge
that passes everything agrees 80% of the time and has a kappa of 0. Look at
specificity first: a judge that misses failures is a judge that hides
regressions.

For reference, Zheng and colleagues (2023) found that a strong judge agreed
with human preferences on MT-Bench comparisons at over 80%, about the level at
which human raters agreed with each other. That is a statement about that task
and that judge, not a property of judges in general.

### Correcting the pass rate

If a judge with sensitivity `se` and specificity `sp` reports a pass rate
`p_obs`, the true rate `p` satisfies `p_obs = se·p + (1 − sp)(1 − p)`.
Solving gives the Rogan-Gladen estimator, from epidemiology's problem of
imperfect screening tests:

```text
p = (p_obs + sp − 1) / (se + sp − 1)
```

Two consequences follow:

- **Differences shrink.** The judge reports `(se + sp − 1)` times the true
  difference between two systems. At `se = 0.95`, `sp = 0.70` that factor is
  0.65: a real 10-point improvement shows as 6.5 points, and an eval sized for
  10 points is now underpowered.
- **The correction inherits calibration uncertainty.** `se` and `sp` are
  estimated from a finite sample, and `sp` comes from the smaller failure
  class. Report the corrected rate with an interval that includes this
  uncertainty, or at least state the calibration sample size.

The correction assumes the judge's error rates are the same for the systems
being compared. That fails when a candidate changes style (longer, more
hedged, more citations) in ways the judge reacts to, which is why the
calibration sample should include outputs from the candidate, not just the
baseline.

### Known biases and their design responses

| Bias | Evidence | Response |
| --- | --- | --- |
| **Position**: prefers the first (or second) answer in a pairwise comparison | Zheng et al. 2023; Wang et al., "Large Language Models are not Fair Evaluators", 2023 | Judge both orders; count a flipped verdict as a tie; report the inconsistency rate |
| **Verbosity**: prefers longer answers | Zheng et al. 2023; length-controlled AlpacaEval (Dubois et al., 2024) regresses out length | Rubrics on content, not effort; compare at matched length; control for length in analysis |
| **Self-preference**: rates its own model's outputs higher | Panickssery et al., 2024, linked it to the judge recognizing its own generations | Use a judge from a different model family, or a panel |
| **Weak domain skill**: cannot verify math, code, or specialist facts it cannot solve | Zheng et al. 2023 on math grading | Give the reference answer; use code or experts for those criteria |
| **Injection**: the graded output contains instructions to the judge | Optimization-based attacks on judges have been demonstrated (Shi et al., 2024) | Treat graded text as data: delimit it, instruct the judge to ignore instructions in it, and add adversarial cases to the calibration set |

A **panel** of smaller judges from different families can match or beat one
large judge at lower cost and with less self-preference; Verga and colleagues
(2024) reported this for their PoLL panel. Panels also give a free agreement
signal: cases where judges disagree are the ones to send to people.

### Pairwise or pointwise

Pointwise grading (pass or fail against a rubric) gives absolute rates you can
track over time. **Pairwise** grading (which of two answers is better) is
often more reliable for subtle quality differences, and preferences across
many pairs can be turned into ratings with a Bradley-Terry model, as Chatbot
Arena does (Chiang et al., 2024). Pairwise grading costs two judge calls per
comparison once you judge both orders, and it says nothing about whether
either answer is acceptable.

### Cost and operations

A judge call is a model call. Judging a 2,000-case eval with three criteria,
five runs per case, and both orders for pairwise is 60,000 calls per eval run.
Budget it like inference, cache verdicts by (judge version, rubric version,
output hash), and route routine criteria to a smaller judge once it is
validated. When the judge's provider updates the model behind a name, your
grades can shift overnight: pin versions and re-run the calibration set on any
change.

## Code

The program simulates a judge with sensitivity 0.95 and specificity 0.70. It
measures the judge on a 300-output human-labeled calibration set, uses the
estimated rates to correct the pass rates the judge reports for two systems,
and then shows a pairwise judge with a first-slot bias comparing two systems of
equal quality, with and without judging both orders.

```python {title="judge.py"}
"""judge.py: measuring a model grader against human labels, correcting its
pass rate, and removing position bias from pairwise judgments.

The judge is simulated with fixed error rates and a fixed position bias; real
judges vary by case, which is why the calibration set must be refreshed.
Standard library only; runs offline.
"""

from __future__ import annotations

import math
import random

SENS, SPEC = 0.95, 0.70     # judge says "pass" on 95% of true passes, "fail" on 70% of true fails


def judge(truth: bool, rng: random.Random) -> bool:
    return rng.random() < SENS if truth else rng.random() > SPEC


def kappa(pairs: list[tuple[bool, bool]]) -> tuple[float, float]:
    n = len(pairs)
    agree = sum(h == j for h, j in pairs) / n
    ph = sum(h for h, _ in pairs) / n
    pj = sum(j for _, j in pairs) / n
    chance = ph * pj + (1 - ph) * (1 - pj)
    return agree, (agree - chance) / (1 - chance)


def corrected(observed: float, sens: float, spec: float) -> float:
    """Rogan-Gladen: true rate from an imperfect classifier's rate."""
    return min(1.0, max(0.0, (observed + spec - 1) / (sens + spec - 1)))


def pairwise(rng: random.Random, n: int, first_bias: float, swap: bool) -> tuple[float, float]:
    """Two systems of equal quality. Returns (A's win share, inconsistency rate)."""
    def prefers_first(q1: float, q2: float) -> bool:
        return rng.random() < 1 / (1 + math.exp(-(q1 - q2 + first_bias)))

    wins = inconsistent = 0.0
    for _ in range(n):
        qa, qb = rng.gauss(0, 1), rng.gauss(0, 1)   # per-case quality, same distribution
        a_first = prefers_first(qa, qb)            # A shown first
        if not swap:
            wins += a_first
            continue
        b_first = prefers_first(qb, qa)            # same pair, B shown first
        if a_first and not b_first:
            wins += 1
        elif a_first == b_first:                   # verdict flipped with order: a tie
            wins += 0.5
            inconsistent += 1
    return wins / n, inconsistent / n


def main() -> None:
    rng = random.Random(21)
    print(f"judge: sensitivity {SENS:.2f}, specificity {SPEC:.2f}\n")

    calib = [(t, judge(t, rng)) for t in (rng.random() < 0.8 for _ in range(300))]
    agree, k = kappa(calib)
    tp = sum(h and j for h, j in calib)
    tn = sum((not h) and (not j) for h, j in calib)
    sens = tp / sum(h for h, _ in calib)
    spec = tn / sum(not h for h, _ in calib)
    print("calibration set, 300 human-labeled outputs:")
    print(f"  raw agreement {agree:.0%}   Cohen's kappa {k:.2f}")
    print(f"  estimated sensitivity {sens:.2f}   specificity {spec:.2f}\n")

    print(f"{'system':<8}{'true':>7}{'judge says':>12}{'corrected':>11}")
    for name, true_rate in (("A", 0.80), ("B", 0.70)):
        outs = [rng.random() < true_rate for _ in range(5_000)]
        obs = sum(judge(t, rng) for t in outs) / len(outs)
        print(f"{name:<8}{true_rate:>7.0%}{obs:>12.1%}{corrected(obs, sens, spec):>11.1%}")
    print(f"  a judge shrinks every true gap by sens + spec - 1 = {SENS + SPEC - 1:.2f}\n")

    print("pairwise, two systems of equal quality, judge favors the first slot:")
    for swap in (False, True):
        share, inc = pairwise(random.Random(4), 4_000, first_bias=0.6, swap=swap)
        label = "both orders, flip = tie" if swap else "A always shown first"
        flips = f"{inc:.0%}" if swap else "not measured"
        print(f"  {label:<26} A wins {share:.1%}   order-inconsistent {flips}")


if __name__ == "__main__":
    main()
```

Run it with `python3 judge.py`:

```text
judge: sensitivity 0.95, specificity 0.70

calibration set, 300 human-labeled outputs:
  raw agreement 90%   Cohen's kappa 0.66
  estimated sensitivity 0.96   specificity 0.67

system     true  judge says  corrected
A           80%       82.2%      78.8%
B           70%       75.2%      67.7%
  a judge shrinks every true gap by sens + spec - 1 = 0.65

pairwise, two systems of equal quality, judge favors the first slot:
  A always shown first       A wins 61.4%   order-inconsistent not measured
  both orders, flip = tie    A wins 48.8%   order-inconsistent 40%
```

Raw agreement is 90%, which sounds fine; kappa is 0.66, and specificity is the
weak point, since the judge passes a third of the bad outputs. On the two
systems, the judge reports a 7-point gap for a true 10-point gap, and
overstates both rates. The corrected estimates are close to the truth but not
exact, because the specificity behind the correction came from only about 60
failing outputs in the calibration set. In the pairwise test, two equal systems
look like a 61-39 win for whichever is shown first. Judging both orders and
counting flips as ties brings it back to about 50%, and the 40% inconsistency
rate is itself a finding: on those cases the judge cannot tell the answers
apart.

## Where it breaks

- **Fixed error rates are a simplification.** Real judges err more on some
  slices (long answers, other languages, specialist topics). Compute
  sensitivity and specificity per slice when slices matter to the gate.
- **The human labels are not ground truth either.** Raters disagree; adjudicate
  disagreements and report human-human agreement alongside the judge's.
- **Optimizing against the judge breaks it.** When prompts or models are tuned
  to raise the judge's score, the system learns what the judge rewards. Keep a
  human-graded holdout and check that the judge and people still agree on the
  tuned system.
- **Correction cannot recover information the judge does not have.** If the
  judge cannot verify a calculation, no estimator fixes its verdicts on that
  criterion; move the criterion to code or to people.
- **Judges are attack surface.** Any output that reaches a judge can try to
  instruct it. In an online setting, users control part of what is judged; see
  [prompt injection](/notes/ai-security-engineering/how-attacks-work/01-prompt-injection/).

## Remember this

- A judge is a classifier: measure its sensitivity and specificity against people on your task.
- Raw agreement flatters lenient judges; look at specificity and kappa.
- Reported differences shrink by (sensitivity + specificity − 1); correct the rate or size the eval for it.
- Judge both orders in pairwise comparisons, control for length, and avoid self-grading.
- Pin judge and rubric versions, and re-validate whenever either, or the graded system, changes.
- Treat graded text as untrusted data.

## Try it

1. Run `judge.py`. Increase the calibration set to 1,000. How much closer do
   the corrected rates get, and why does specificity improve the most?
2. Make the judge's specificity depend on output length (lower for long
   outputs), and give system B longer outputs. What happens to the correction?
3. Change `first_bias` to 0.2 and 1.2. How does the inconsistency rate move,
   and what does it tell you about the judge?
4. Write a binary rubric for "every claim is supported by the cited sources".
   Grade 20 outputs yourself, then compare with a colleague. What is your
   human-human agreement?
5. Estimate the monthly judge cost for an eval you run: cases × criteria ×
   runs × orders × runs per month × price per call.

## Check yourself

1. A judge agrees with humans 90% of the time. Why might it still be unusable?

   {{< details summary="Show answer" >}}
   If most outputs are good, a lenient judge reaches high raw agreement while
   missing many failures. Its specificity, and agreement beyond chance (kappa),
   decide whether it can detect regressions.
   {{< /details >}}

2. Why does an imperfect judge make an eval less sensitive?

   {{< details summary="Show answer" >}}
   The reported pass rate is a mixture of true passes and misjudged failures,
   so any true difference between systems is scaled by (sensitivity +
   specificity − 1). A smaller observed difference needs more cases to detect.
   {{< /details >}}

3. How do you remove position bias from pairwise judging?

   {{< details summary="Show answer" >}}
   Judge each pair in both orders. If the verdict follows the slot rather than
   the content, count it as a tie. Report the share of order-inconsistent
   verdicts; it measures how often the judge cannot distinguish the answers.
   {{< /details >}}

4. Why should the calibration sample include candidate outputs, not only
   baseline outputs?

   {{< details summary="Show answer" >}}
   The correction assumes the judge errs at the same rates on both systems. A
   candidate that changes length, style, or structure can change those rates,
   so the judge must be validated on the kind of output it will grade.
   {{< /details >}}

5. When should a criterion move from a judge to code or people?

   {{< details summary="Show answer" >}}
   When the judge cannot verify it (math, code behavior, specialist facts it
   cannot solve), when calibration shows poor specificity that rubric changes
   do not fix, or when the stakes require a human decision.
   {{< /details >}}

## Sources

- L. Zheng et al., [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685), NeurIPS 2023 Datasets and Benchmarks.
- P. Wang et al., [Large Language Models are not Fair Evaluators](https://arxiv.org/abs/2305.17926), 2023.
- A. Panickssery, S. R. Bowman, S. Feng, [LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076), NeurIPS 2024.
- Y. Dubois et al., [Length-Controlled AlpacaEval: A Simple Way to Debias Automatic Evaluators](https://arxiv.org/abs/2404.04475), 2024.
- P. Verga et al., [Replacing Judges with Juries: Evaluating LLM Generations with a Panel of Diverse Models](https://arxiv.org/abs/2404.18796), 2024.
- Y. Liu et al., [G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment](https://arxiv.org/abs/2303.16634), EMNLP 2023.
- S. Shankar et al., [Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences](https://arxiv.org/abs/2404.12272), UIST 2024.
- J. Shi et al., [Optimization-based Prompt Injection Attack to LLM-as-a-Judge](https://arxiv.org/abs/2403.17710), 2024.
- W.-L. Chiang et al., [Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference](https://arxiv.org/abs/2403.04132), ICML 2024.
- W. J. Rogan, B. Gladen, "Estimating prevalence from the results of a screening test", *American Journal of Epidemiology* 107(1), 1978.
- J. Cohen, "A coefficient of agreement for nominal scales", *Educational and Psychological Measurement* 20(1), 1960.
