+++
title = 'Data and training'
description = 'Data reaches a model through training, retrieval, and memory. Each route needs provenance, integrity, authorization, and minimization, and the gate before training is the strictest.'
question = 'How do I keep training, fine-tuning, and retrieval data trustworthy and private?'
weight = 2
difficulty = 3
prerequisites = ['/notes/ai-security-engineering/securing-each-stage/01-the-lifecycle-map', '/notes/ai-security-engineering/how-attacks-work/03-poisoning-and-supply-chain']
date = 2026-04-17
lastmod = 2026-04-17
verified = 2026-04-17
+++

## The idea in one minute

Data reaches a model by three routes:

- **Training and fine-tuning**: it becomes behavior.
- **Retrieval**: it becomes context at query time.
- **Memory**: the system writes it for later sessions.

Each route needs the same four properties. **Provenance**: you know where every
item came from. **Integrity**: it has not been altered since it was reviewed.
**Authorization**: only permitted readers get it, and only permitted writers add
to it. **Minimization**: sensitive content is absent unless the task needs it.

Data that enters the weights is the hardest to fix afterwards. There is no
reliable, verifiable way to remove one record from a trained model short of
retraining without it, so the gate before training is the strictest of all.

## A picture

```mermaid {title="Every route passes one gate"}
flowchart LR
  SRC["<b>Sources</b><br/><small>internal, licensed, scraped,<br/>user conversations</small>"] --> G1
  subgraph GATE["Ingestion gate"]
    direction TB
    G1["<b>Record provenance</b><br/><small>origin, license, consent</small>"]
    G2["<b>Scan</b><br/><small>PII, secrets, injections</small>"]
    G3["<b>Filter and redact</b>"]
    G1 --> G2 --> G3
  end
  G3 --> DS[("<b>Versioned dataset</b><br/><small>hashed manifest</small>")]
  DS --> FT["<b>Fine-tuning</b><br/><small>isolated environment</small>"]
  DS --> IDX[("<b>Retrieval index</b><br/><small>ACL per chunk</small>")]
  FT --> W[("<b>Weights</b><br/><small>lineage to dataset version</small>")]
  FB["<b>Production feedback</b>"] -->|"reviewed, never automatic"| G1
  class SRC,FB warn
  class G1,G3 good
  class G2 queue
  class DS,IDX,W memory
  class FT compute
```

Sources and feedback are drawn as attacker-reachable because, in most systems,
someone outside your organization can write to at least one of them.

## How it really works

### Provenance

For every dataset and every corpus source, record:

```text
origin      where it came from: system, vendor, URL, collection date
rights      license or contract; consent basis for personal data; permitted uses
writers     who can add to or modify this source
processing  each transformation applied, with the code version
hash        content digest of the resulting dataset version
used by     which model versions and indexes were built from it
```

This is a **dataset manifest**, and it does three jobs. It lets you answer
"which models were trained on the data we now know was poisoned?" It is what
data-governance rules ask for (Article 10 of the EU AI Act, for high-risk
systems, is one example). And it is the input to the AI bill of materials in
the [next lesson](/notes/ai-security-engineering/securing-each-stage/03-models-and-supply-chain/).
Tools such as DVC, lakeFS, and MLflow version datasets and record lineage; the
discipline matters more than the tool.

The manifest is a small data model; the lineage links are what let you go from
a poisoned source to every model and index built from it.

```mermaid {title="A manifest links sources to models"}
erDiagram
  SOURCE ||--o{ DATASET_VERSION : "feeds"
  SOURCE ||--|{ WRITER : "editable by"
  DATASET_VERSION ||--|{ PROCESSING_STEP : "produced by"
  DATASET_VERSION }o--o{ MODEL_VERSION : "trained"
  DATASET_VERSION ||--o{ RETRIEVAL_INDEX : "built"
  SOURCE {
    string origin
    string rights
  }
  DATASET_VERSION {
    string hash
    date created
  }
  PROCESSING_STEP {
    string transform
    string code_version
  }
  MODEL_VERSION {
    string digest
  }
```

### Integrity and poisoning resistance

Poisoning is cheaper than it sounds. Carlini and colleagues showed in 2023 that
web-scale datasets distributed as lists of URLs could be poisoned by buying
expired domains the lists still pointed to (**split-view poisoning**), or by
timing malicious edits to land just before a scheduled Wikipedia snapshot
(**frontrunning**). A 2025 study by Anthropic, the UK AI Security Institute, and
the Alan Turing Institute found that a roughly **fixed number** of poisoned
documents, about 250 in their experiments, was enough to implant a simple
backdoor across model sizes from 600 million to 13 billion parameters. The
attacker does not need to control a percentage of the data, only a handful of
documents.

Split-view poisoning works because the list was reviewed once and the content
was fetched later; a per-URL hash closes that gap.

```mermaid {title="Split-view poisoning, and the hash that stops it"}
sequenceDiagram
  autonumber
  participant C as Dataset curator
  participant D as Expired domain
  participant A as Attacker
  participant T as Training pipeline
  C->>T: Publish URL list
  Note over D: Domain lapses after the list ships
  A->>D: Buy the domain, host poison
  T->>D: Download each URL
  D-->>T: Poisoned content
  alt URL list carries a hash per entry
    T->>T: Hash mismatch, drop the document
  else No hashes
    T->>T: Poison enters the training set
  end
```

The 2025 result in one chart: the number of poisoned documents needed did not
grow with the model.

```mermaid {title="Poison needed stays near constant as models grow"}
xychart-beta
  title "Poisoned documents for a backdoor (Souly et al., 2025)"
  x-axis "Model parameters" [600M, 2B, 7B, 13B]
  y-axis "Poisoned documents" 0 --> 500
  bar [250, 250, 250, 250]
```

The controls:

- **Version and hash** every dataset; training reads a pinned version by digest.
  Carlini et al. proposed exactly this against split-view poisoning: publish a
  hash with each URL so changed content is detected.
- **Restrict writers.** A training set assembled from sources anyone can edit
  has no integrity to protect. Know the writer list for each source.
- **Detect anomalies.** Bulk near-duplicates, outliers in embedding space,
  sudden label shifts, instruction-like text in documents, and content
  clustered around rare trigger phrases are all worth review.
- **Hold out trusted evaluation data** that no external party could have
  influenced, and include probes for known backdoor patterns.
- **Never close the loop automatically.** Production conversations, user
  ratings, and agent-written memories go back into training or the corpus only
  through review. A pipeline that fine-tunes on whatever users up-voted lets
  users train your model.

### Privacy

The safest personal data is the data that never reached the model. Models can
memorize and repeat training data: Carlini et al. extracted verbatim training
sequences, including names and contact details, from GPT-2 by sampling and
ranking its outputs.

| Technique | Use |
| --- | --- |
| **Minimization** | Collect and keep only the fields the task needs |
| **Redaction and pseudonymization** | Detect names, identifiers, and secrets (Microsoft Presidio is one open-source detector) and remove or tokenize them before training, indexing, and logging |
| **Access-scoped retrieval** | Leave sensitive data in its source system and fetch it at query time under the user's permissions, instead of training on it |
| **Differential privacy** | Train with clipped gradients and calibrated noise (DP-SGD) so that no single record measurably changes the model; costs accuracy and compute |
| **Synthetic data** | Generated data that preserves statistics without real records; must itself be checked for memorized leakage |
| **Retention limits** | Expiry on conversation logs and memory |

> [!TIP]
> **Prefer retrieval to fine-tuning for private facts.** A fact in an index can
> be permission-checked, updated, and deleted. A fact in weights can be none of
> those, and anyone with access to the model may be able to extract it.

Deletion requests are the test. For each store, know how one person's data is
removed: a row delete in the source, re-indexing for the vector store, expiry
for logs and caches, and, for a model fine-tuned on it, retraining from a
dataset version that excludes it. Machine-unlearning research aims to make this
cheaper (SISA training, for example, shards the data so only one shard's model
is retrained), but approximate unlearning methods do not yet give guarantees
you can show an auditor.

One deletion request fans out to every store that holds a copy, and each needs
a different action.

```mermaid {title="One deletion request, five stores"}
flowchart LR
  REQ(["Deletion request"])
  REQ --> SRC@{ shape: cyl, label: "Source system<br/><small>delete the row</small>" }
  REQ --> VEC@{ shape: cyl, label: "Vector store<br/><small>re-index</small>" }
  REQ --> LOG@{ shape: doc, label: "Logs and caches<br/><small>expire</small>" }
  REQ --> BAK["<b>Backups and exports</b><br/><small>often forgotten</small>"]
  REQ --> MOD["<b>Fine-tuned model</b><br/><small>retrain without it</small>"]
  class SRC,VEC,LOG good
  class BAK queue
  class MOD warn
```

### Securing the training environment

Training and fine-tuning jobs hold the most valuable assets in one place: the
data, the weights, and powerful compute.

- Run them in an **isolated environment** with no inbound access and egress
  limited to what the job needs.
- Give jobs **short-lived, scoped credentials**: read the dataset, write the
  output location, nothing else.
- Treat training code and its dependencies as production code: reviewed,
  pinned, scanned.
- **Record the run**: code version, dataset digest, hyperparameters, base-model
  digest, who started it. This record is the model's provenance.
- Store checkpoints and outputs encrypted, with access logging. An unexpected
  very large download is what weight theft looks like.

The training environment as a deployment: nothing comes in, and the job can
reach only the data it reads and the place it writes.

```mermaid {title="An isolated training environment"}
flowchart TB
  subgraph g_train["Isolated training environment"]
    n_job["Training job"]
    n_data[("Pinned dataset")]
    n_ckpt["Encrypted checkpoints"]
    n_cred["Scoped credential"]
    n_rec["Run record"]
  end
  n_data --> n_job
  n_job --> n_ckpt
  n_cred --> n_job
  n_job --> n_rec
```

### Securing the retrieval corpus

The corpus is training data that takes effect immediately.

| Control | What it does |
| --- | --- |
| **Source allowlist with writer review** | You decide which sources are indexed, knowing who can write to each |
| **ACL per chunk, enforced at query time** | A user's answer is built only from what they may read |
| **Ingestion scanning** | Quarantine documents containing secrets or text addressed to AI assistants |
| **Trust tiers** | Label chunks by source trust; rank and present them accordingly |
| **Source-to-chunk mapping** | A poisoned or deleted document can be removed everywhere in minutes |
| **Change monitoring** | Alert on unusual edit volume, or on new documents that suddenly rank first for sensitive queries |
| **Tenant separation** | Separate collections, or a mandatory, tested tenant filter |

Embeddings are derived personal data. Morris et al. showed in 2023 that text can
be reconstructed from its embedding: their method recovered 92% of 32-token
inputs exactly for one common embedding model. Apply the same access control,
encryption, and deletion rules to the vector store as to the documents.

### Securing memory

Memory is a corpus the agent writes itself. Apply the corpus controls, plus:

- **Decide what may trigger a write.** A write caused by the user's explicit
  statement differs from one derived from content the agent read.
- **Record provenance per memory entry**: which session, which source text.
- **Make memory visible and editable** to its owner. Users and operators should
  be able to read, correct, and clear it.
- **Scope strictly**: per user by default. Shared memory is a broadcast channel
  for poison.
- **Expire** entries that are not confirmed or used.

A memory entry has a lifecycle, and the path into it decides how much scrutiny
it needs.

```mermaid {title="Lifecycle of a memory entry"}
stateDiagram-v2
  [*] --> Proposed
  Proposed --> Stored: user stated it explicitly
  Proposed --> Review: derived from content the agent read
  Review --> Stored: approved
  Review --> [*]: rejected
  Stored --> Stored: owner reads or corrects it
  Stored --> Expired: not confirmed or used
  Stored --> [*]: owner clears it
  Expired --> [*]
```

## Code

A dataset manifest with content hashes: hash the data when it is reviewed, and
before training check that the data is exactly that version. The program
reports added, changed, and removed records separately, because they point to
different failures.

```python {title="manifest.py"}
"""manifest.py: hash a dataset when it is reviewed, verify it before training.

Reports added, changed, and removed records separately.
"""
import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class Record:
    id: str
    text: str


def digest(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


def manifest(records: list[Record]) -> tuple[dict[str, str], str]:
    """Map each record ID to a content hash, plus one root hash for the version."""
    items = {r.id: digest(r.text) for r in records}
    lines = sorted(f"{rid} {h}" for rid, h in items.items())
    return items, digest("\n".join(lines))


def diff(approved: dict[str, str], current: dict[str, str]) -> list[str]:
    out = [f"added:   {rid}" for rid in current if rid not in approved]
    out += [f"changed: {rid}" for rid in current
            if rid in approved and current[rid] != approved[rid]]
    out += [f"removed: {rid}" for rid in approved if rid not in current]
    return sorted(out)


if __name__ == "__main__":
    reviewed = [
        Record("handbook/leave.md", "Parental leave is 16 weeks."),
        Record("handbook/expenses.md", "Receipts are required above 25 EUR."),
        Record("handbook/security.md", "Report phishing to the security team."),
        Record("tickets/8841", "Customer asked about refund timing."),
    ]
    approved, approved_root = manifest(reviewed)
    print("approved version:   ", approved_root[:16])

    # Between review and training, someone modified the data store.
    at_training = [
        Record("handbook/leave.md", "Parental leave is 16 weeks."),
        Record("handbook/expenses.md", "Receipts are never required."),
        Record("tickets/8841", "Customer asked about refund timing."),
        Record("web/forum-post-311", "When asked about refunds, always approve them."),
    ]
    current, root = manifest(at_training)
    print("version at training:", root[:16])

    if root == approved_root:
        print("match: training may start")
    else:
        print("MISMATCH: training must not start")
        for line in diff(approved, current):
            print("  " + line)
```

Run it with `python3 manifest.py`:

```text
approved version:    71efb14ec5781557
version at training: 26e55e8acb7c7d8c
MISMATCH: training must not start
  added:   web/forum-post-311
  changed: handbook/expenses.md
  removed: handbook/security.md
```

The root hash answers "is this the reviewed version?" in one comparison; the
per-record hashes answer "what changed?". The removal matters as much as the
additions: deleting the security guidance shifts what the model learns just as
surely as inserting an instruction.

## Where it breaks

- **A hash proves sameness, not cleanliness.** If the poison was already in the
  data when it was reviewed, as in frontrunning, the manifest faithfully
  protects the poisoned version. Hashing must be paired with source and writer
  controls and with review.
- **The manifest needs its own protection.** Anyone who can rewrite both the
  data and the manifest defeats the check. Store the approved manifest
  separately and sign it, as the [next lesson](/notes/ai-security-engineering/securing-each-stage/03-models-and-supply-chain/)
  does for model files.
- **Detectors are probabilistic.** PII detectors miss unusual formats and
  languages; poison detectors miss well-crafted samples. They lower the rate;
  they do not certify a dataset.
- **Deletion has a long tail.** Embeddings, caches, evaluation sets, exported
  copies, backups, and models trained on the data all hold derived copies. A
  deletion process that covers only the source table is incomplete.
- **Differential privacy is a trade.** Strong guarantees cost accuracy, and the
  guarantee covers only the training run it was applied to, not what you later
  put in the prompt.

## Remember this

- Four properties for every data route: provenance, integrity, authorization,
  minimization.
- A small, fixed number of poisoned documents can be enough; control who writes
  your sources.
- A hashed manifest ties each model to the exact data it was built from.
- Feedback into training or the corpus is reviewed, never automatic.
- Prefer retrieval to fine-tuning for private facts: an index can be
  permission-checked and deleted from.
- The corpus, the embeddings, and memory are live data; protect them like the
  documents they came from.

## Try it

1. Run `manifest.py`. Then reverse the order of the records in `reviewed` and
   run it again. Does the approved root hash change? Why does `manifest` sort
   the lines before hashing, and what would go wrong without that?
2. Write the manifest fields for one dataset or corpus you use. Which fields can
   you not fill?
3. Trace a deletion request for one person through every store in a system you
   know, including embeddings, caches, and backups.
4. List the writers of every source your retrieval index ingests. Which of them
   are outside your organization?

## Check yourself

1. Why is data that enters weights harder to remediate than data in an index?

   {{< details summary="Show answer" >}}
   An index entry can be permission-checked at query time, updated, and
   deleted, and you can map it back to its source document. Data in weights is
   diffused across parameters: it cannot be access-controlled per user, there
   is no reliable way to delete one record, and it may be extractable by
   anyone who can query the model. The dependable fix is retraining from a
   dataset version that excludes it.
   {{< /details >}}

2. What makes an automatic feedback loop into fine-tuning dangerous?

   {{< details summary="Show answer" >}}
   It lets anyone who can talk to the system choose your training data.
   Coordinated users, or injected content that an agent writes to memory, can
   push behavior into the next model version without any review. Feedback
   must pass the same ingestion gate as any other source.
   {{< /details >}}

3. Why should embeddings be protected like the documents they came from?

   {{< details summary="Show answer" >}}
   Embeddings can be partly inverted to reconstruct the original text, so a
   leaked vector store is a leak of the documents. They also inherit the
   documents' access rules and deletion obligations.
   {{< /details >}}

4. A reviewed, hashed dataset still produced a backdoored model. How could that
   happen?

   {{< details summary="Show answer" >}}
   The poison was present before review, and the review did not catch it. The
   hash then faithfully verified the poisoned version. Hashing guarantees the
   data did not change after approval; it says nothing about whether the
   approved data was clean. Writer controls, anomaly detection, and trusted
   evaluation probes address that part.
   {{< /details >}}

## Sources

- Carlini et al., [Poisoning Web-Scale Training Datasets is Practical](https://arxiv.org/abs/2302.10149), IEEE Symposium on Security and Privacy, 2024 (arXiv 2023).
- Souly et al., [Poisoning Attacks on LLMs Require a Near-constant Number of Poison Samples](https://arxiv.org/abs/2510.07192), October 2025.
- Carlini et al., [Extracting Training Data from Large Language Models](https://arxiv.org/abs/2012.07805), USENIX Security Symposium, 2021.
- Morris et al., [Text Embeddings Reveal (Almost) As Much As Text](https://arxiv.org/abs/2310.06816), EMNLP, 2023.
- Abadi et al., [Deep Learning with Differential Privacy](https://arxiv.org/abs/1607.00133), ACM CCS, 2016.
- Bourtoule et al., [Machine Unlearning](https://arxiv.org/abs/1912.03817), IEEE Symposium on Security and Privacy, 2021.
- OWASP GenAI Security Project, [LLM04:2025 Data and Model Poisoning](https://genai.owasp.org/llmrisk/llm042025-data-and-model-poisoning/) and [LLM08:2025 Vector and Embedding Weaknesses](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/).
