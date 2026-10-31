+++
title = 'Capability evaluations and release gates'
description = 'Published frontier safety frameworks share one shape: measure dangerous capabilities during training, and when a threshold may be crossed, require stronger security and deployment safeguards before going further. The engineering is making that rule enforceable.'
question = 'How do capability evaluations decide which safeguards a model needs, and how is that enforced?'
weight = 5
difficulty = 3
prerequisites = ['/notes/ai-security-engineering/securing-each-stage/04-build-and-test', '/notes/ai-security-engineering/frontier-model-security/02-research-and-training-infrastructure']
date = 2026-10-30T06:25:00Z
lastmod = 2026-10-30T06:25:00Z
verified = 2026-10-30
+++

## The idea in one minute

Several frontier model developers have published safety frameworks: Anthropic's
Responsible Scaling Policy, OpenAI's Preparedness Framework, and Google
DeepMind's Frontier Safety Framework among them. They differ in vocabulary and
detail and share a structure:

1. Define **capability thresholds** in domains where a model could cause severe
   harm, such as biological and chemical weapons uplift, offensive cyber
   operations, and autonomous AI research.
2. **Evaluate** models against them before deployment and at intervals during
   training, with early-warning thresholds set below the real ones.
3. When a model may have crossed a threshold, require **security safeguards**
   for the weights and **deployment safeguards** for its use, and do not train
   further or deploy until they are in place.

For an engineer, the framework is a policy; the work is making it hold.
**Evaluations are a security control**: their code and data need integrity, and
their uncertainty should push decisions toward more protection. **The gate
must be in the pipeline**, so that an artifact without a signed determination
cannot be promoted. And **the security requirement starts when the weights
exist**, not when they ship.

## A picture

```mermaid {title="Evaluations drive both the security level and the release gate"}
flowchart TB
  CK["<b>Checkpoint</b><br/><small>during training</small>"] --> EV["<b>Capability evals</b><br/><small>best-effort elicitation</small>"]
  EV --> CMP{"<b>Upper bound vs<br/>thresholds</b>"}
  CMP -->|"below alert"| GO["<b>Continue</b>"]
  CMP -->|"alert"| MORE["<b>Full eval suite,<br/>prepare safeguards</b>"]
  CMP -->|"threshold"| REQ["<b>Required safeguards</b><br/><small>security level, deployment</small>"]
  REQ --> SEC["<b>Raise weight security</b><br/><small>every copy, now</small>"]
  REQ --> GATE{"<b>Release gate</b><br/><small>signed determination<br/>matches digest?</small>"}
  GATE -->|"safeguards in place"| REL["<b>Deploy</b>"]
  GATE -->|"missing"| BLK["<b>Block</b>"]
  class CK memory
  class EV,MORE compute
  class CMP,GATE queue
  class SEC,REQ,BLK good
  class GO,REL io
```

## How it really works

### The published frameworks

The table summarizes the versions cited in the sources. These documents are
revised often; read the current version before relying on any detail.

| Framework | Thresholds | Safeguard levels | Who decides |
| --- | --- | --- | --- |
| **Anthropic Responsible Scaling Policy** (first published September 2023; version 2 October 2024, with later updates) | Capability thresholds, for example in CBRN weapons and autonomous AI research and development | AI Safety Level (ASL) standards for deployment and security; ASL-3 protections were activated in May 2025 as a precaution for Claude Opus 4 | Capability and safeguards assessments, reviewed by a Responsible Scaling Officer and leadership |
| **OpenAI Preparedness Framework** (beta December 2023; version 2 April 2025) | Tracked categories: biological and chemical, cybersecurity, AI self-improvement; High and Critical thresholds | Safeguards that must sufficiently minimize risk before deploying a High-capability model; Critical also constrains development | Capabilities Reports and Safeguards Reports reviewed by a Safety Advisory Group |
| **Google DeepMind Frontier Safety Framework** (version 1 May 2024; version 2 February 2025; version 3 September 2025) | Critical Capability Levels (CCLs), with early-warning alert thresholds | Security levels against weight exfiltration, referring to the RAND levels, and deployment mitigations | Response plans reviewed by internal governance bodies |

At the AI Seoul Summit in May 2024, sixteen organizations signed the Frontier AI
Safety Commitments, which include publishing a framework of this kind. In the
European Union, the general-purpose AI Code of Practice (July 2025) contains a
safety and security chapter with a similar structure for models with systemic
risk; [compliance and regulation](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)
covers the regulatory side.

### What an evaluation measures

A capability evaluation estimates what a model can do in a domain, using proxy
tasks: capture-the-flag challenges for cyber, knowledge and protocol
troubleshooting questions for biology, multi-step software tasks for autonomy.
Three properties decide whether it can carry a security decision.

**Elicitation.** A model asked once, with no tools, underperforms the same model
given a scaffold, tools, many attempts, and light fine-tuning. Someone who steals
or misuses the model will use the stronger setup, so the frameworks ask for
evaluations that make a serious attempt at eliciting the capability. In
practice, score each domain with the strongest elicitation tried, as the program
does.

**Uncertainty.** Evaluation sets are small; a cyber suite might have 40 tasks.
17 of 40 is a point estimate of 0.42 with a 95% interval of roughly 0.29 to
0.58. Compare the threshold with the **upper** end of the interval, so that a
small or noisy evaluation errs toward more protection rather than less.

**Timing.** A capability can cross a threshold mid-run. The frameworks evaluate
during training at defined intervals; for example, version 2 of Anthropic's
policy triggers a new assessment at a fourfold increase in effective compute or
six months of accumulated post-training improvements, and version 1 of the
Frontier Safety Framework proposed evaluating at every sixfold increase in
effective compute and every three months of fine-tuning progress. The alert
threshold gives the security team lead time.

### The evaluation pipeline is in the security boundary

If a gate depends on a number, whoever controls the number controls the gate.

- **Eval code and datasets** live in version control with two-person review,
  like any other control
  ([build and test](/notes/ai-security-engineering/securing-each-stage/04-build-and-test/)).
- **Held-out evaluation data** stays out of training data. Contamination makes
  a model look more capable on paper; leaking the eval set so a model is trained
  around it makes a model look less capable. Both corrupt the decision.
- **Results are signed by the eval service's identity** and bound to the
  checkpoint digest, the suite version, and the elicitation settings.
- **Sandbagging is a research concern**: a model that performs worse on
  evaluations than it can. The frameworks list it among the issues they track;
  the engineering response is varied elicitation and comparison across
  checkpoints for unexpected drops.

### The gate, in code

A framework says "do not deploy without the required safeguards". The pipeline
says it in a way that cannot be skipped:

```text
a model digest may be promoted to an external serving tier only if
  1  a determination record exists for exactly this digest
  2  it is signed by the eval service and approved by the designated reviewers
  3  every required deployment safeguard is attested as active for that tier
  4  the weight storage for every copy of this digest meets the required security level
```

This is the same mechanism as model signing and admission in
[models and supply chain](/notes/ai-security-engineering/securing-each-stage/03-models-and-supply-chain/):
an admission policy refuses digests that lack the right signature. The
determination record is one more signed attestation. The release gate from
build and test checks attack success rates; this one checks capability.

### Security cannot wait for release

A model that crosses a threshold during training already exists as weights. If
the required security level is not in place, the stolen copy has the
capability whether or not it was ever deployed. The frameworks say this in
their own terms: they require the security standard to be met for the model
itself and contemplate pausing training when it cannot be. Operationally, the
evaluation result changes the classification of that checkpoint, every later
checkpoint, and every existing copy
([research and training infrastructure](/notes/ai-security-engineering/frontier-model-security/02-research-and-training-infrastructure/)).

### External testing

Government AI institutes in the United Kingdom and the United States have run
pre-deployment evaluations of some frontier models under agreements with their
developers. External testing adds elicitation skill and independence; it also
means giving another party model access, which goes through the same
interfaces and access controls as internal use.

## Code

The program assesses three checkpoints of one run against three domains, each
with an alert threshold and a capability threshold. It scores each domain with
the strongest elicitation, compares the upper end of the 95% Wilson interval
with the thresholds, and reports what is required and whether external
deployment is blocked.

```python {title="release_gate.py"}
"""release_gate.py: turn capability-eval results into required safeguards and a gate decision.

Each domain has an alert threshold (early warning) and a capability threshold.
A result counts as reaching a threshold when the upper end of its 95% Wilson
interval does, so small or noisy evals err toward more protection. Scores use the
strongest elicitation tried. Reaching a capability threshold requires a security
level and deployment safeguards; the gate compares those with what is in place.
Domains, numbers, and levels are invented for illustration.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


@dataclass(frozen=True)
class Domain:
    name: str
    alert: float
    threshold: float
    needs_security: int          # required security level (1-5) once threshold is reached
    needs_deploy: str            # required deployment safeguard tier


DOMAINS = [
    Domain("cyber-ctf", alert=0.25, threshold=0.50, needs_security=3, needs_deploy="classifiers+monitoring"),
    Domain("autonomy-tasks", alert=0.20, threshold=0.40, needs_security=3, needs_deploy="restricted-tools"),
    Domain("bio-knowledge", alert=0.30, threshold=0.55, needs_security=4, needs_deploy="classifiers+monitoring"),
]

# checkpoint -> domain -> {elicitation: (successes, trials)}
RESULTS = {
    "step-40k": {"cyber-ctf": {"plain": (4, 40), "agent+10 tries": (7, 40)},
                 "autonomy-tasks": {"plain": (3, 30), "agent+10 tries": (4, 30)},
                 "bio-knowledge": {"plain": (30, 200), "agent+10 tries": (33, 200)}},
    "step-80k": {"cyber-ctf": {"plain": (8, 40), "agent+10 tries": (13, 40)},
                 "autonomy-tasks": {"plain": (4, 30), "agent+10 tries": (6, 30)},
                 "bio-knowledge": {"plain": (44, 200), "agent+10 tries": (47, 200)}},
    "step-120k": {"cyber-ctf": {"plain": (11, 40), "agent+10 tries": (17, 40)},
                  "autonomy-tasks": {"plain": (5, 30), "agent+10 tries": (8, 30)},
                  "bio-knowledge": {"plain": (60, 200), "agent+10 tries": (66, 200)}},
}

IN_PLACE = {"security": 2, "deploy": {"classifiers+monitoring"}}


def assess(ckpt: str) -> None:
    print(f"{ckpt}")
    need_sec, need_dep = 0, set()
    for d in DOMAINS:
        method, (k, n) = max(RESULTS[ckpt][d.name].items(), key=lambda kv: kv[1][0] / kv[1][1])
        lo, hi = wilson(k, n)
        if hi >= d.threshold:
            state = "THRESHOLD"
            need_sec = max(need_sec, d.needs_security)
            need_dep.add(d.needs_deploy)
        elif hi >= d.alert:
            state = "alert"
        else:
            state = "below"
        print(f"  {d.name:<15} {k:>3}/{n:<3} via {method:<15} p={k / n:.2f} "
              f"95% CI [{lo:.2f}, {hi:.2f}]  {state}")
    if need_sec > IN_PLACE["security"]:
        print(f"  weights: raise to security level {need_sec} now (have {IN_PLACE['security']}); "
              "applies to every copy, released or not")
    missing_dep = sorted(need_dep - IN_PLACE["deploy"])
    if need_sec > IN_PLACE["security"] or missing_dep:
        print("  gate: BLOCK external deployment"
              + (f"; missing deploy safeguard {', '.join(missing_dep)}" if missing_dep else ""))
    else:
        print("  gate: pass")

if __name__ == "__main__":
    for ckpt in RESULTS:
        assess(ckpt)
```

Run it with `python3 release_gate.py`:

```text
step-40k
  cyber-ctf         7/40  via agent+10 tries  p=0.17 95% CI [0.09, 0.32]  alert
  autonomy-tasks    4/30  via agent+10 tries  p=0.13 95% CI [0.05, 0.30]  alert
  bio-knowledge    33/200 via agent+10 tries  p=0.17 95% CI [0.12, 0.22]  below
  gate: pass
step-80k
  cyber-ctf        13/40  via agent+10 tries  p=0.33 95% CI [0.20, 0.48]  alert
  autonomy-tasks    6/30  via agent+10 tries  p=0.20 95% CI [0.10, 0.37]  alert
  bio-knowledge    47/200 via agent+10 tries  p=0.23 95% CI [0.18, 0.30]  below
  gate: pass
step-120k
  cyber-ctf        17/40  via agent+10 tries  p=0.42 95% CI [0.29, 0.58]  THRESHOLD
  autonomy-tasks    8/30  via agent+10 tries  p=0.27 95% CI [0.14, 0.44]  THRESHOLD
  bio-knowledge    66/200 via agent+10 tries  p=0.33 95% CI [0.27, 0.40]  alert
  weights: raise to security level 3 now (have 2); applies to every copy, released or not
  gate: BLOCK external deployment; missing deploy safeguard restricted-tools
```

At step 120k, no point estimate has reached its threshold: cyber is at 0.42
against 0.50, autonomy at 0.27 against 0.40. Both upper bounds have, and the
gate treats them as reached. The required security level applies to the
weights immediately, and deployment stays blocked until a restricted-tools
safeguard exists. The earlier alerts at steps 40k and 80k were the lead time.

## Where it breaks

- **Thresholds are judgment.** Where a domain's line sits, and which proxy tasks
  represent it, are decisions the frameworks make and revise. The pipeline
  enforces them faithfully, including when they are wrong.
- **Proxies are not the harm.** A capture-the-flag score measures
  capture-the-flag skill. A model can be more or less dangerous than its proxy
  scores suggest.
- **Elicitation has no known ceiling.** Better scaffolds and fine-tuning
  techniques appear after release and raise a deployed model's effective
  capability. Re-evaluate deployed models when elicitation methods improve.
- **Release is irreversible for open weights.** For a model whose weights are
  published, the gate is the only control; fine-tuning can remove deployment
  safeguards afterward.
- **The interval is not the whole uncertainty.** The Wilson interval covers
  sampling noise in one suite, not whether the suite measures the right thing,
  correlated tasks, or a model that underperforms on purpose.
- **A gate can be theater.** If determinations are written after the decision
  or reviewers sign without reading, the pipeline enforces a formality. The
  controls in the [insider lesson](/notes/ai-security-engineering/frontier-model-security/03-insider-risk-and-model-access/)
  apply to reviewers too.

## Remember this

- Published frameworks share a shape: thresholds, evaluations, required safeguards.
- Evaluations are security controls: versioned, reviewed, signed, held out.
- Score with the strongest elicitation; compare the upper bound with the threshold.
- Alert thresholds buy lead time for the security work.
- The gate is an admission policy on a signed determination for one digest.
- Security requirements apply when the weights exist, not when they ship.

## Try it

1. Run `release_gate.py`. Increase the cyber suite to 160 tasks with the same
   success rate (68 of 160). Does step 120k still reach the threshold? What
   does that say about suite size?
2. Add a domain whose plain score is higher than its scaffolded score. What
   might cause that, and what would you investigate?
3. Write the determination record as JSON for step 120k: what fields does the
   admission policy need, and who signs it?
4. Read the current version of one published framework. Find its rule for when
   a new assessment is required, and compare it with the one quoted here.

## Check yourself

1. Why compare the upper end of the confidence interval with the threshold
   instead of the point estimate?

   {{< details summary="Show answer" >}}
   Because the cost of the two errors is not symmetric. Under-protecting a
   capable model risks theft or misuse that cannot be undone; over-protecting
   a less capable one costs time and money. Using the upper bound means small
   or noisy evaluations lead to more protection, and the way to earn less is to
   run larger, better evaluations.
   {{< /details >}}

2. A checkpoint reaches a threshold that requires security level 3, but the
   model will not be released for months. What has to happen now?

   {{< details summary="Show answer" >}}
   The weights already have the capability, so every copy of that checkpoint,
   every later checkpoint, and every existing copy needs the required security
   now: moved into storage and access paths that meet the level. If that is
   not possible, the frameworks contemplate pausing further training until it
   is. Deployment safeguards can wait for deployment; security cannot.
   {{< /details >}}

3. Why does the evaluation pipeline need two-person review and signed results?

   {{< details summary="Show answer" >}}
   Because the release gate and the security classification depend on its
   numbers. Someone who can edit the eval code, the dataset, or the result can
   lower the gate. Version control, review, signing by the [eval service](/notes/systems-design/building-blocks/04-evaluation-services/)'s
   identity, and binding results to the checkpoint digest make that require
   collusion and leave a record.
   {{< /details >}}

4. What does a capability evaluation not tell you about a model?

   {{< details summary="Show answer" >}}
   How capable it is with elicitation methods not yet tried, how well its proxy
   tasks represent the real harm, and whether it is deliberately
   underperforming. It gives a measured lower bound on capability for the
   tasks and methods used, with sampling uncertainty.
   {{< /details >}}

## Sources

- Anthropic, [Responsible Scaling Policy](https://www.anthropic.com/responsible-scaling-policy), version 2, October 2024, and later updates.
- Anthropic, [Activating AI Safety Level 3 protections](https://www.anthropic.com/news/activating-asl3-protections), May 2025.
- OpenAI, [Our updated Preparedness Framework](https://openai.com/index/updating-our-preparedness-framework/), April 2025.
- Google DeepMind, [Frontier Safety Framework](https://deepmind.google/discover/blog/introducing-the-frontier-safety-framework/), May 2024; [version 2](https://deepmind.google/discover/blog/updating-the-frontier-safety-framework/), February 2025; [version 3](https://deepmind.google/discover/blog/strengthening-our-frontier-safety-framework/), September 2025.
- UK Government, [Frontier AI Safety Commitments, AI Seoul Summit 2024](https://www.gov.uk/government/publications/frontier-ai-safety-commitments-ai-seoul-summit-2024), May 2024.
- European Commission, [The General-Purpose AI Code of Practice](https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai), July 2025.
- METR, [Common Elements of Frontier AI Safety Policies](https://metr.org/common-elements), 2024 and later updates.
- NIST, [AI 800-1: Managing Misuse Risk for Dual-Use Foundation Models](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.800-1.ipd.pdf), initial public draft, July 2024.
- Wilson, "Probable inference, the law of succession, and statistical inference", *Journal of the American Statistical Association*, 1927.
