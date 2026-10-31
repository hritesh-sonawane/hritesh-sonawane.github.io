+++
title = 'Research and training infrastructure'
description = 'The research side holds the same weights as production with more people, more code, and more connectivity. Keep weights in an enclave, give people interfaces, and treat job submission as weight access.'
question = 'How do you protect weights in the environments where researchers actually work?'
weight = 2
difficulty = 3
prerequisites = ['/notes/ai-security-engineering/frontier-model-security/01-securing-model-weights', '/notes/ai-security-engineering/securing-each-stage/02-data-and-training']
date = 2026-10-30T06:10:00Z
lastmod = 2026-10-30T06:10:00Z
verified = 2026-10-30
+++

## The idea in one minute

Production serving is the easy place to protect weights. It runs a fixed image,
has a short list of operators, and needs no internet. The research and training
environment holds the same weights, plus every intermediate checkpoint, and is
built for the opposite: many people, notebooks, fast-changing code, package
installs from the internet, shared file systems, and debugging access to
everything.

Three ideas make that environment defensible without stopping research:

- **Weights live in an enclave as files; people work outside it.** Researchers
  reach models through interfaces that run inside: sampling, evaluation, and
  fine-tuning services that return results, not bytes of weights.
- **A checkpoint is the model.** A checkpoint a few thousand steps before the
  end is nearly as capable as the final one and gets the same protection.
- **Submitting a job is weight access.** A training job runs next to the
  weights with read and write access, so the code it runs is code inside the
  enclave and must come from a reviewed, built, signed source.

## A picture

```mermaid {title="Three zones: people outside, weights inside, interfaces between"}
flowchart LR
  subgraph RW["Research workspace"]
    direction TB
    NB["<b>Notebooks, laptops</b><br/><small>internet, packages</small>"]
    REPO["<b>Code repository</b>"]
  end
  subgraph IF["Interfaces"]
    direction TB
    SAMP["<b>Sampling API</b>"]
    EVAL["<b>Eval service</b><br/><small>returns scores</small>"]
    CI["<b>CI build and sign</b><br/><small>reviewed commits</small>"]
  end
  subgraph EN["Weight enclave: no internet egress"]
    direction TB
    TRAIN["<b>Training jobs</b><br/><small>per-run identity</small>"]
    CK[("<b>Checkpoints</b><br/><small>per-run KMS key</small>")]
  end
  NB --> SAMP
  NB --> EVAL
  REPO --> CI
  CI -->|"signed image"| TRAIN
  SAMP --> TRAIN
  EVAL --> CK
  TRAIN --> CK
  NB -.-x|"no file access"| CK
  class NB warn
  class REPO,SAMP io
  class EVAL,CI good
  class TRAIN compute
  class CK memory
```

## How it really works

### Why research is the soft side

The research environment has all the properties that make security hard.
Hundreds of people need to try things quickly. Clusters live for months. Code
changes daily and pulls dependencies from public registries. Dashboards and
orchestrators are started with default settings on shared networks. Checkpoints
are copied to wherever the next experiment runs.

Public incidents show what that looks like:

- **An over-broad storage token.** In September 2023, Wiz reported that a
  Microsoft AI research repository on GitHub linked to Azure storage through a
  shared access signature (SAS) token scoped to the whole storage account with
  full control and a far-future expiry. It exposed 38 TB of data, including
  backups of two employees' workstations. The data was intended to be a set of
  open-source models.
- **Unauthenticated orchestrators.** In March 2024, Oligo Security reported
  active exploitation of Ray clusters (the "ShadowRay" campaign) through Ray's
  job submission API, which accepts jobs without authentication
  (CVE-2023-48022). The vendor disputes that this is a vulnerability: Ray's
  documentation says clusters must be run only on trusted networks. Either way,
  a reachable job API on a training cluster is remote code execution next to
  the weights.
- **Dependency confusion.** Between 25 and 30 December 2022, PyTorch nightly
  builds pulled a malicious `torchtriton` package from the public index,
  which shadowed the internal dependency of the same name and uploaded system
  information and files from machines that installed it.

The parts of such a cluster are laid out in
[a training cluster](/notes/systems-design/ai-infrastructure/01-a-training-cluster/).
None of these needed anything specific to AI. They are storage permissions,
network exposure, and supply chain, in an environment that holds the most
valuable files the organization has.

### A checkpoint is the model

Training writes checkpoints at a fixed interval so that a failure loses little
work. A run that checkpoints every 2,000 steps for 120,000 steps produces 60
of them; with optimizer state each one is roughly seven times the size of the
final weights (sizing is in
[storage and checkpoints](/notes/infrastructure-security/securing-gpu-clusters/03-storage-and-checkpoints/)).
Most are deleted, but late checkpoints are kept for evaluation, comparisons,
and restarts, and each one is nearly the final model.

Protect checkpoints by **capability, not by name**. The capability evaluations
in [lesson 5](/notes/ai-security-engineering/frontier-model-security/05-capability-evaluations-and-release-gates/)
run on checkpoints during training precisely so that the protection level can
rise before the run ends. Once an evaluation shows a checkpoint may have crossed
a threshold, that checkpoint and every later one needs the higher level, and so
does any copy already made.

### The enclave and its interfaces

The design that reconciles research speed with weight security is to separate
where weights live from where people work, and connect them with narrow
interfaces.

| Zone | Holds | People access | Network |
| --- | --- | --- | --- |
| **Research workspace** | Code, notebooks, small models, results | Everyone on the team | Internet, package mirrors |
| **Interfaces** | Services that run against weights and return results | Through authenticated APIs, with quotas | Reachable from the workspace only |
| **Weight enclave** | Weights, checkpoints, training jobs | No interactive access by default; break-glass only | No internet; egress to artifact stores only |

Interfaces cover most of what researchers need:

- **Sampling**: generate from any checkpoint by name, with logging. Return text
  and limited log-probabilities, not raw logits or activations, unless a reviewed
  research need justifies more (see
  [extraction and distillation](/notes/ai-security-engineering/frontier-model-security/04-extraction-and-distillation/)).
- **Evaluation**: submit an eval suite against a checkpoint; get scores and
  transcripts back.
- **Fine-tuning and interpretability**: run inside the enclave as reviewed jobs;
  export only results, plots, or small derived artifacts with a size limit.

Interactive access to a host inside the enclave is the exception: requested,
approved by two people, time-bound, and recorded, as the
[next lesson](/notes/ai-security-engineering/frontier-model-security/03-insider-risk-and-model-access/)
describes.

### Job submission is weight access

A training job runs inside the enclave with read access to checkpoints and write
access to wherever it saves results. If a researcher can submit arbitrary code,
that researcher can make a job copy weights to any destination the job can
reach. So the job path needs the same controls as any production deployment:

- **Jobs run images, not code uploads.** CI builds an image from a reviewed
  commit, records provenance, and signs it; the cluster admits only signed
  images ([CI/CD and build provenance](/notes/infrastructure-security/delivery-and-operations/01-ci-cd-and-build-provenance/),
  [signing and admission](/notes/infrastructure-security/delivery-and-operations/02-signing-and-admission/)).
- **Each run has its own identity** with access only to its own checkpoint
  prefix and its own KMS key.
- **Jobs have no internet egress.** Packages come from an internal mirror at
  build time; datasets are staged in advance. Outbound traffic goes only to the
  artifact store, and outputs leaving the enclave have size limits.
- **Orchestrator APIs are private and authenticated.** Ray dashboards and job
  APIs, Jupyter servers, MLflow, and TensorBoard bind to private interfaces
  behind an authenticating proxy, never to a cluster-wide or public address.
  [Schedulers and fabrics](/notes/infrastructure-security/securing-gpu-clusters/02-schedulers-and-fabrics/)
  covers the cluster side.

Review is what keeps this from being theater. A reviewer who approves a training
change should be able to see that it adds a new output destination or reads a
checkpoint it did not read before. Flag those diffs automatically.

### The data side

Training data flows in the opposite direction: into the enclave. Its risks
(poisoning, provenance, privacy) are covered in
[data and training](/notes/ai-security-engineering/securing-each-stage/02-data-and-training/).
The infrastructure point here is that the data path should be one-way: staged
into the enclave by a pipeline identity, never pulled by a job from the
internet at run time.

## Code

Before any policy can be enforced, someone has to find the copies. This program
models an inventory of one run's weights across environments and checks each
copy against the rules for its tier: inside an approved environment, encrypted
with a managed key, no internet egress, and a short list of readers.

```python {title="weight_inventory.py"}
"""weight_inventory.py: find every copy of a model's weights and check it against policy.

A training run leaves weights in many places. This program models an inventory
of copies (checkpoints, eval snapshots, notebook scratch, serving caches) and
checks each one against the rules for its sensitivity tier. The inventory is
invented; a real one comes from storage APIs and access logs.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Copy:
    path: str
    kind: str                      # checkpoint, eval, scratch, serving
    step: int
    encrypted_with: str | None     # KMS key id, or None
    readers: frozenset[str]        # principals with read access
    internet_egress: bool          # can the environment holding it reach the internet?
    environment: str               # weights-enclave, research, eval, serving


@dataclass
class Policy:
    """Rules for the frontier tier. Every copy is a copy of the crown jewel."""
    allowed_envs: set[str] = field(default_factory=lambda: {"weights-enclave", "serving"})
    max_readers: int = 5
    forbidden_readers: set[str] = field(default_factory=lambda: {"group:all-research", "allUsers"})


def check(c: Copy, p: Policy) -> list[str]:
    issues = []
    if c.environment not in p.allowed_envs:
        issues.append(f"lives in '{c.environment}', outside the weight enclave")
    if c.encrypted_with is None:
        issues.append("not encrypted with a managed key")
    if c.internet_egress:
        issues.append("environment has internet egress")
    broad = c.readers & p.forbidden_readers
    if broad:
        issues.append(f"broad reader {sorted(broad)[0]}")
    elif len(c.readers) > p.max_readers:
        issues.append(f"{len(c.readers)} readers > {p.max_readers}")
    return issues


INVENTORY = [
    Copy("enclave://run42/ckpt/step-120000", "checkpoint", 120000, "kms/weights-run42",
         frozenset({"svc:trainer-run42", "svc:ckpt-export"}), False, "weights-enclave"),
    Copy("enclave://run42/ckpt/step-118000", "checkpoint", 118000, "kms/weights-run42",
         frozenset({"svc:trainer-run42"}), False, "weights-enclave"),
    Copy("gs://research-evals/run42/step-115000", "eval", 115000, "kms/research",
         frozenset({"svc:eval-runner", "group:all-research"}), False, "eval"),
    Copy("/home/alice/scratch/run42-step-110000", "scratch", 110000, None,
         frozenset({"user:alice"}), True, "research"),
    Copy("serving://pool-a/cache/run42-final", "serving", 120000, "kms/serving",
         frozenset({"svc:inference-pool-a"}), False, "serving"),
    Copy("s3://legacy-exports/run42-step-90000", "checkpoint", 90000, "kms/legacy",
         frozenset({f"user:eng{i}" for i in range(23)}), False, "research"),
]


if __name__ == "__main__":
    policy = Policy()
    readers: set[str] = set()
    clean = 0
    for c in sorted(INVENTORY, key=lambda c: -c.step):
        readers |= c.readers
        issues = check(c, policy)
        clean += not issues
        status = "ok" if not issues else "VIOLATION"
        print(f"{status:<10}{c.kind:<11}step {c.step:>6}  {c.path}")
        for i in issues:
            print(f"            - {i}")
    print(f"\n{len(INVENTORY)} copies, {clean} compliant; "
          f"{len(readers)} distinct principals can read some copy of run42")
    humans = sorted(r for r in readers if r.startswith(("user:", "group:")))
    print(f"human or group principals: {len(humans)} (first: {', '.join(humans[:3])})")
```

Run it with `python3 weight_inventory.py`:

```text
ok        checkpoint step 120000  enclave://run42/ckpt/step-120000
ok        serving    step 120000  serving://pool-a/cache/run42-final
ok        checkpoint step 118000  enclave://run42/ckpt/step-118000
VIOLATION eval       step 115000  gs://research-evals/run42/step-115000
            - lives in 'eval', outside the weight enclave
            - broad reader group:all-research
VIOLATION scratch    step 110000  /home/alice/scratch/run42-step-110000
            - lives in 'research', outside the weight enclave
            - not encrypted with a managed key
            - environment has internet egress
VIOLATION checkpoint step  90000  s3://legacy-exports/run42-step-90000
            - lives in 'research', outside the weight enclave
            - 23 readers > 5

6 copies, 3 compliant; 29 distinct principals can read some copy of run42
human or group principals: 25 (first: group:all-research, user:alice, user:eng0)
```

Three of six copies violate policy, and the violations are the realistic ones:
an eval snapshot readable by every researcher, a scratch copy on a workstation
with internet access, and a legacy export with 23 individual readers. Only five
principals can read the compliant copies; 29 can read some copy of the same
model. The second number is the one an attacker cares about.

## Where it breaks

- **Interfaces are paths too.** An [eval service](/notes/systems-design/building-blocks/04-evaluation-services/) that returns full logits, a
  sampling API with no quota, or a fine-tuning job that can export an adapter
  of arbitrary size leaks capability through the front door. Size limits and
  output review apply to interfaces as much as to egress.
- **Productivity pressure makes shadow copies.** If the enclave is slow to use,
  people copy checkpoints out to work faster. The inventory catches copies
  after the fact; only a usable interface prevents them.
- **Allowed outputs are an exfiltration channel.** A job allowed to write
  results to the artifact store can write weights there too, split into
  "results". Watch artifact sizes and types, not just destinations.
- **Deleted is not gone.** Object versioning, snapshots, and backups keep copies
  of checkpoints that were "deleted". The inventory must include versions, and
  deletion must reach them; destroying a per-run key (crypto-shredding) is the
  reliable way.
- **The inventory is only as good as its sources.** The program reads a
  hand-written list. Real inventories come from storage APIs and access logs,
  and miss anything stored where you are not looking: laptops, personal cloud
  accounts, chat attachments.

## Remember this

- The research environment holds the same weights with more people, code, and
  network.
- Weights live in an enclave; people use sampling, eval, and fine-tuning
  interfaces.
- Late checkpoints are the model; protect them by measured capability.
- Submitting a job is weight access: signed images, per-run identity, no
  internet.
- Orchestrators and dashboards are remote code execution if reachable.
- Count every copy, including versions and backups.

## Try it

1. Run `weight_inventory.py`. Add a copy for a checkpoint attached to a chat
   message or ticket. What fields would you need to detect it at all?
2. Add a check that flags any copy whose step is within 10% of the latest step
   but which is outside the enclave, as more severe than older copies.
3. For a cluster you use, list every orchestrator, dashboard, or notebook server
   and the address it listens on. Which are reachable without authentication?
4. Take one training job you ran recently. Could it have written to a
   destination outside your organization? How would you have known?

## Check yourself

1. Why is "submitting a training job" a weight-access privilege?

   {{< details summary="Show answer" >}}
   The job runs inside the environment that holds the weights, with read access
   to checkpoints and write access to its outputs. Whatever code the job runs
   can copy weights to any destination the job can reach. So controlling who
   can submit what code, and where jobs can write, is controlling access to
   the weights.
   {{< /details >}}

2. A researcher needs to debug a strange behavior in the step-118000
   checkpoint. What should they get?

   {{< details summary="Show answer" >}}
   Access through an interface: a sampling or eval service that runs the
   checkpoint inside the enclave and returns text, scores, or bounded
   diagnostics. If they need something the interfaces cannot provide, a
   reviewed job inside the enclave, or time-bound, two-person-approved
   interactive access with recording. Not a copy of the checkpoint on their
   workstation.
   {{< /details >}}

3. What did the September 2023 storage token exposure and the ShadowRay
   campaign have in common?

   {{< details summary="Show answer" >}}
   Neither was an AI-specific attack. One was an over-broad, long-lived storage
   credential; the other was an orchestrator API reachable without
   authentication. Both happened in research or training infrastructure, where
   default settings and broad access are common and where the most valuable
   files live.
   {{< /details >}}

4. Why protect checkpoints by capability rather than by name or stage?

   {{< details summary="Show answer" >}}
   Because "intermediate" says nothing about how capable a checkpoint is. A
   checkpoint near the end of a run is nearly the final model. Capability
   evaluations during training decide when the protection level must rise, and
   that decision applies to the checkpoint evaluated, every later one, and any
   copies already made.
   {{< /details >}}

## Sources

- Nevo et al., [Securing AI Model Weights](https://www.rand.org/pubs/research_reports/RRA2849-1.html), RAND, 2024.
- Wiz Research, [38TB of data accidentally exposed by Microsoft AI researchers](https://www.wiz.io/blog/38-terabytes-of-private-data-accidentally-exposed-by-microsoft-ai-researchers), September 2023.
- Oligo Security, [ShadowRay: First known attack campaign targeting AI workloads actively exploited in the wild](https://www.oligo.security/blog/shadowray-attack-ai-workloads-actively-exploited-in-the-wild), March 2024.
- NIST National Vulnerability Database, [CVE-2023-48022](https://nvd.nist.gov/vuln/detail/CVE-2023-48022).
- Ray documentation, [Security](https://docs.ray.io/en/latest/ray-security/index.html).
- PyTorch, [Compromised PyTorch-nightly dependency chain between December 25th and December 30th, 2022](https://pytorch.org/blog/compromised-nightly-dependency/), December 2022.
- NIST, [SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final), July 2024.
