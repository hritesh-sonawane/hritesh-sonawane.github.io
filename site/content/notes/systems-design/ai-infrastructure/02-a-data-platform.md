+++
title = 'A data platform'
description = 'A training data platform turns raw sources into datasets a model can be traced back to. Exact and near-duplicate removal, contamination checks against evaluation sets, and content-addressed manifests are what make a dataset reproducible and its evaluations honest.'
question = 'How do you build training datasets that are deduplicated, free of evaluation data, and traceable from any model back to its sources?'
weight = 2
difficulty = 4
prerequisites = ['/notes/systems-design/ai-infrastructure/01-a-training-cluster', '/notes/ai-security-engineering/securing-each-stage/02-data-and-training']
date = 2026-10-30T13:10:00Z
lastmod = 2026-10-30T13:10:00Z
verified = 2026-10-30
+++

## The idea in one minute

The data platform is where training data comes from: web crawls, licensed
corpora, code, documents, conversation logs, synthetic data. It decides what a
model learns, and three properties decide whether you can trust what you
learned about the model afterwards.

**Deduplication**: repeated documents waste compute, raise memorization of the
repeated text, and skew the data mixture; exact hashing removes copies, and
MinHash with locality-sensitive hashing removes near copies without comparing
every pair. **Contamination control**: if evaluation questions appear in
training data, benchmark scores measure recall, not capability, so training
data is checked against every evaluation set before use. **Lineage**: every
dataset is an immutable, content-addressed manifest of the documents in it and
the filters that produced it, so a model can name exactly what it was trained
on, and a deletion request can be traced to every dataset and model it touches.

The consequence to act on: treat datasets as versioned build artifacts with a
pipeline, a manifest, and an owner, not as directories that people copy.

## A picture

```mermaid {title="From raw sources to a training dataset with a manifest"}
flowchart LR
  SRC["<b>Sources</b><br/><small>crawl, licensed, code,<br/>logs, synthetic</small>"] --> RAW[("<b>Raw zone</b><br/><small>immutable, with origin<br/>and license metadata</small>")]
  RAW --> CLEAN["<b>Extract and filter</b><br/><small>language, quality,<br/>PII, opt-outs</small>"]
  CLEAN --> EXACT["<b>Exact dedup</b><br/><small>hash of normalized text</small>"]
  EXACT --> NEAR["<b>Near dedup</b><br/><small>MinHash + LSH</small>"]
  NEAR --> CONT{"<b>Contamination check</b><br/><small>n-gram overlap with<br/>every eval set</small>"}
  EVAL[("<b>Eval registry</b><br/><small>benchmarks, internal suites,<br/>canary strings</small>")] --> CONT
  CONT -->|"clean"| MAN[("<b>Dataset manifest</b><br/><small>document hashes,<br/>filter versions, id</small>")]
  CONT -->|"overlap"| DROP["<b>Quarantine</b>"]
  MAN --> TRAIN["<b>Training run</b><br/><small>records the dataset id</small>"]
  class SRC neutral
  class RAW,EVAL,MAN memory
  class CLEAN,EXACT,NEAR compute
  class CONT good
  class DROP queue
  class TRAIN io
```

Each stage is a versioned job, and its output is a set of document hashes, so
the manifest records both what is in the dataset and how it was produced.

## How it really works

### Zones and immutability

Organize storage in zones: **raw** (exactly as acquired, with source, time,
and license), **processed** (extracted text and filter decisions), and
**datasets** (immutable manifests that a training run references). Nothing
in raw is edited in place; a re-crawl is a new snapshot. Processing jobs are
code, versioned, and deterministic for a given input and configuration, so a
dataset can be rebuilt. At web scale that means columnar files in object
storage processed by a distributed engine (Spark, Ray Data, or similar), with
the document hash as the join key everywhere.

### Exact deduplication

Normalize (Unicode normalization, case, whitespace, boilerplate), hash, keep
the first occurrence. It is cheap and removes mirrors and reposts. It misses
anything changed by a single character: a page with a different date header,
a license file with a different year. Exact dedup is also applied at
sub-document level: Lee et al. (2022) removed repeated substrings of at least
50 tokens with suffix arrays and found that deduplicated training data reduced
verbatim memorization and produced models that matched or beat those trained
on the original data, with fewer training steps.

### Near-duplicate detection with MinHash and LSH

The Jaccard similarity of two documents is the overlap of their shingle sets
(here, word 5-grams) divided by the union. Comparing every pair is quadratic:
a billion documents is 5 × 10^17 pairs. MinHash (Broder, 1997) gives each
document a signature of `k` minimum hash values, one per hash function; the
probability that two documents agree in one position equals their Jaccard
similarity. **Locality-sensitive hashing** splits the signature into `b` bands
of `r` rows and treats two documents as candidates if any band matches
exactly. The probability that a pair with similarity `s` becomes a candidate
is:

```text
P(candidate)  =  1 - (1 - s^r)^b
```

That is an S-curve whose midpoint sits near `(1/b)^(1/r)`. Choosing `b` and `r`
chooses the similarity at which documents are treated as duplicates; only
candidates are compared precisely. FineWeb, for example, used 112 hash
functions in 14 bands of 8 over word 5-grams, per crawl snapshot (Penedo et al.,
2024). The tradeoff is direct: a lower threshold removes more near copies and
more legitimately similar documents (templates, forms, code with shared
boilerplate).

### Contamination control

A benchmark question in the training data turns a measurement into a lookup.
The standard check is **n-gram overlap**: GPT-3's authors flagged training
documents sharing a 13-gram with an evaluation item (Brown et al., 2020), and
later model reports describe similar n-gram analyses. Design rules:

- **Check against every evaluation set**, public and internal, held in an
  evaluation registry the data platform can read.
- **Decontaminate before training, and report afterwards**: remove overlapping
  documents, then report scores on contaminated and clean subsets of each
  benchmark separately.
- **Mark evaluation data with canary strings.** BIG-bench embeds a unique
  string in its files so it can be detected in corpora (Srivastava et al.,
  2022). Do the same for internal suites.
- **Do not trust exact n-grams alone.** Paraphrased, translated, or reformatted
  evaluation items evade n-gram matching. For high-value internal suites, add
  embedding-similarity checks and keep a held-out set that is never published
  or logged in a place a crawler can reach.

Contamination flows the other way too: production traces turned into
evaluation cases must not also feed fine-tuning sets. That is a lineage
question.

### Lineage and the manifest

A **dataset manifest** lists the hash of every document in the dataset, the
versions of every job and filter that produced it, and the IDs of its input
snapshots. Its own hash is the **dataset ID**. Training runs record the dataset
ID, checkpoint metadata records the training run, and model registry entries
record the checkpoint. That chain answers the questions that otherwise have no
answer:

| Question | Answered by |
| --- | --- |
| What exactly was this model trained on? | Model -> run -> dataset ID -> manifest |
| Was eval suite v7 contaminated? | The contamination job's version and report in the manifest |
| A source must be deleted. Which models are affected? | Reverse index from document hash to dataset IDs to runs |
| Can this dataset be rebuilt? | Input snapshots plus job versions in the manifest |

Records like Datasheets for Datasets (Gebru et al., 2018) describe the
human-readable side: motivation, composition, collection process, and
licensing. The Data Provenance Initiative's audit (Longpre et al., 2023) found
license information widely missing or wrong in popular fine-tuning
collections, which is a reason to capture license and origin at acquisition,
in the raw zone.

### Deletion and retention

A deletion request (a user's right to erasure, a revoked license, an opt-out)
removes documents from raw and processed zones and produces new dataset
versions without them. Models already trained on the old version are not
changed by deleting data; whether they must be retrained or the data's
influence otherwise addressed is a legal and policy decision. The platform's
job is to make the impact computable through lineage.

### Security of the pipeline

The data pipeline is an attack surface: poisoned documents can be planted in
crawled sources, and anyone who can write to processed zones can change what a
model learns. Raw and processed zones need write controls, every job writes
with its own identity, and the manifest's hashes make tampering detectable.
Poisoning and supply-chain controls are covered in
[poisoning and supply chain](/notes/ai-security-engineering/how-attacks-work/03-poisoning-and-supply-chain/).

## Code

The program builds a synthetic corpus of 546 documents: 400 originals, 60 exact
copies with changed case and punctuation, 80 near copies with 2% or 5% of
words edited, and 6 pages that embed an evaluation item. It runs exact dedup,
MinHash LSH at two settings, a 13-gram contamination check, and builds a
manifest.

```python {title="dataplat.py"}
"""dataplat.py: exact and near-duplicate removal, contamination checks, lineage.

1. Exact dedup by content hash after normalization.
2. Near-duplicate detection with MinHash over word 5-gram shingles and
   locality-sensitive hashing (b bands of r rows).
3. Contamination: drop training documents sharing any 13-gram with an
   evaluation set.
4. A manifest: every surviving document by hash, plus the hash of the
   manifest itself, so a model can name exactly what it was trained on.
Synthetic corpus; standard library only.
"""

from __future__ import annotations

import hashlib
import random
import re

WORDS = ("data model train cluster token batch shard index query cache gpu node "
         "network storage replica region policy tenant route budget queue latency "
         "error retry metric trace schema lineage window vector graph label").split()


def norm(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def corpus(rng: random.Random) -> tuple[list[str], list[str], list[tuple[str, str, str]], list[str]]:
    base = [" ".join(rng.choice(WORDS) for _ in range(rng.randint(80, 160))) for _ in range(400)]
    docs = list(base)
    pairs = []                                # (original, near copy, edit rate) ground truth
    for d in rng.sample(base, 60):            # exact copies, different case/punctuation
        docs.append(d.upper().replace(" ", ",  "))
    for rate, picks in ((0.02, rng.sample(base, 40)), (0.05, rng.sample(base, 40))):
        for d in picks:                       # near copies: edit 2% or 5% of the words
            w = d.split()
            for i in rng.sample(range(len(w)), max(1, round(len(w) * rate))):
                w[i] = rng.choice(WORDS)
            docs.append(" ".join(w))
            pairs.append((d, docs[-1], f"{rate:.0%}"))
    evals = [" ".join(rng.choice(WORDS) for _ in range(40)) for _ in range(30)]
    leaks: list[str] = []
    for e in rng.sample(evals, 6):            # 6 eval items leaked into crawled pages
        host = rng.choice(base).split()
        cut = rng.randint(0, len(host))
        docs.append(" ".join(host[:cut] + e.split() + host[cut:]))
        leaks.append(docs[-1])
    rng.shuffle(docs)
    return docs, evals, pairs, leaks


def h64(s: str, seed: int) -> int:
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8, salt=seed.to_bytes(16, "little")).digest(), "big")


def minhash(words: list[str], k: int = 128, n: int = 5) -> list[int]:
    shingles = {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}
    return [min(h64(s, seed) for s in shingles) for seed in range(k)]


def jaccard_est(a: list[int], b: list[int]) -> float:
    return sum(x == y for x, y in zip(a, b)) / len(a)


def lsh_pairs(sigs: list[list[int]], b: int, r: int) -> set[tuple[int, int]]:
    cand: set[tuple[int, int]] = set()
    for band in range(b):
        buckets: dict[tuple, list[int]] = {}
        for i, s in enumerate(sigs):
            buckets.setdefault(tuple(s[band * r:(band + 1) * r]), []).append(i)
        for ids in buckets.values():
            for x in range(len(ids)):
                for y in range(x + 1, len(ids)):
                    cand.add((ids[x], ids[y]))
    return cand


def main() -> None:
    rng = random.Random(5)
    docs, evals, pairs, leaks = corpus(rng)
    print(f"corpus: {len(docs)} documents; eval set: {len(evals)} items")

    # 1. exact
    seen: dict[str, int] = {}
    keep = []
    for i, d in enumerate(docs):
        k = hashlib.sha256(" ".join(norm(d)).encode()).hexdigest()
        if k not in seen:
            seen[k] = i
            keep.append(i)
    print(f"1. exact dedup after normalization: removed {len(docs)-len(keep)}, kept {len(keep)}")

    # 2. near-duplicates
    sigs = {i: minhash(norm(docs[i])) for i in keep}
    pos = {d: i for i, d in enumerate(docs)}
    kset = set(keep)
    pairs = [(a, c, r) for a, c, r in pairs if a != c and pos[a] in kset and pos[c] in kset]
    total = {rate: sum(r == rate for *_, r in pairs) for rate in ("2%", "5%")}
    n_pairs = len(keep) * (len(keep) - 1) // 2
    print("2. MinHash (128 hashes, word 5-grams) + LSH; P(candidate) = 1 - (1 - s^r)^b")
    print("   true Jaccard of the planted near copies: "
          + ", ".join(f"{rate} edits ~{sum(jaccard_est(sigs[pos[a]], sigs[pos[c]]) for a, c, r in pairs if r == rate)/total[rate]:.2f}"
                      for rate in ("2%", "5%")))
    near_keep = keep
    for b, r, th in ((16, 8, 0.7), (32, 4, 0.5)):
        curve = "  ".join(f"s={x:.1f}:{1-(1-x**r)**b:.2f}" for x in (0.3, 0.5, 0.7, 0.9))
        ids = list(keep)
        cand = lsh_pairs([sigs[i] for i in ids], b, r)
        flagged = {(ids[x], ids[y]) for x, y in cand if jaccard_est(sigs[ids[x]], sigs[ids[y]]) >= th}
        drop = {max(p) for p in flagged}
        found = {rate: sum((min(pos[a], pos[c]), max(pos[a], pos[c])) in flagged for a, c, rr in pairs if rr == rate)
                 for rate in ("2%", "5%")}
        print(f"   b={b:<2} r={r} keep-if J<{th}:  {curve}")
        print(f"     {len(cand)} candidate pairs (of {n_pairs:,}); caught {found['2%']}/{total['2%']} at 2% edits,"
              f" {found['5%']}/{total['5%']} at 5%; removed {len(drop)}")
        if b == 32:
            near_keep = [i for i in keep if i not in drop]

    # 3. contamination
    def grams(words: list[str], n: int = 13) -> set[str]:
        return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}
    eval_grams: set[str] = set()
    for e in evals:
        eval_grams |= grams(norm(e))
    contaminated = [i for i in near_keep if grams(norm(docs[i])) & eval_grams]
    clean = [i for i in near_keep if i not in set(contaminated)]
    print(f"3. 13-gram overlap with the eval set: {len(contaminated)} documents removed, {len(clean)} kept")
    leak_ids = {pos[d] for d in leaks}
    by_dedup = len(leak_ids - set(near_keep))
    print(f"   of {len(leaks)} planted leaks: {by_dedup} already dropped as near copies of their host page,"
          f" {len(leak_ids & set(contaminated))} caught by 13-grams, {len(leak_ids & set(clean))} survived")

    # 4. lineage manifest
    lines = sorted(hashlib.sha256(docs[i].encode()).hexdigest() for i in clean)
    manifest = hashlib.sha256("\n".join(lines).encode()).hexdigest()
    print(f"4. manifest: {len(lines)} document hashes; dataset id sha256:{manifest[:16]}...")
    removed = [i for i in range(len(docs)) if i not in set(clean)]
    print(f"   removing one document changes the id: sha256:"
          f"{hashlib.sha256(chr(10).join(lines[1:]).encode()).hexdigest()[:16]}...")
    print(f"   kept {len(clean)/len(docs):.0%} of the input; {len(removed)} documents dropped in total")


if __name__ == "__main__":
    main()
```

Run it with `python3 dataplat.py`:

```text
corpus: 546 documents; eval set: 30 items
1. exact dedup after normalization: removed 60, kept 486
2. MinHash (128 hashes, word 5-grams) + LSH; P(candidate) = 1 - (1 - s^r)^b
   true Jaccard of the planted near copies: 2% edits ~0.84, 5% edits ~0.62
   b=16 r=8 keep-if J<0.7:  s=0.3:0.00  s=0.5:0.06  s=0.7:0.61  s=0.9:1.00
     52 candidate pairs (of 117,855); caught 36/37 at 2% edits, 2/35 at 5%; removed 43
   b=32 r=4 keep-if J<0.5:  s=0.3:0.23  s=0.5:0.87  s=0.7:1.00  s=0.9:1.00
     91 candidate pairs (of 117,855); caught 37/37 at 2% edits, 35/35 at 5%; removed 86
3. 13-gram overlap with the eval set: 2 documents removed, 398 kept
   of 6 planted leaks: 4 already dropped as near copies of their host page, 2 caught by 13-grams, 0 survived
4. manifest: 398 document hashes; dataset id sha256:1619cb3a1a52a80d...
   removing one document changes the id: sha256:5f46a2c85335db81...
   kept 73% of the input; 148 documents dropped in total
```

Exact dedup removes all 60 copies, because normalization strips the case and
punctuation changes. The LSH comparison checks under 100 candidate pairs
instead of 117,855. The setting matters: with 16 bands of 8 rows, whose curve
is steep around 0.7, it catches nearly all 2%-edited copies (true Jaccard
about 0.84) but only 2 of 35 copies at 5% edits (about 0.62). With 32 bands of
4 rows and a 0.5 cut, it catches all of them. Four of the six leaked pages were
removed as near copies of the pages they were pasted into; the 13-gram check
caught the other two, so the contamination check has to run regardless of
what dedup happens to remove. Removing one document changes the dataset ID,
which is the point of a content-addressed manifest.

## Where it breaks

- **Thresholds are corpus-specific.** Code, legal text, and forms are full of
  legitimate near duplicates. A threshold tuned on web text over-removes them.
- **Dedup changes the mixture.** Removing duplicates shifts the proportion of
  sources and domains; the mixture should be rebalanced deliberately, not left
  to whatever dedup removed.
- **N-gram checks miss paraphrase.** Contamination by paraphrase, translation,
  or synthetic data generated by a model that saw the benchmark is not caught
  by exact n-grams.
- **Lineage only covers what passed through the platform.** Data copied
  around it, such as a notebook that downloads a dataset directly, breaks the
  chain. Training jobs should only accept dataset IDs.
- **The corpus is synthetic.** Random word sequences have near-zero background
  similarity, which makes dedup look cleaner than it is on real text.

## Remember this

- Datasets are immutable, content-addressed manifests; training runs reference dataset IDs.
- Exact dedup is cheap; near dedup needs MinHash and LSH, and P(candidate) = 1 − (1 − s^r)^b sets its threshold.
- Check training data against every evaluation set with n-gram overlap, and report clean and contaminated subsets.
- Mark evaluation data with canary strings and keep a held-out set that never leaves controlled storage.
- Lineage turns a deletion request into a computable list of affected datasets and models.

## Try it

1. In `dataplat.py`, change the shingle size from 5 to 3 words. What happens to
   the true Jaccard of the near copies and to the number of candidate pairs?
2. Find `b` and `r` with `b × r = 128` whose curve is near 0.5 at `s = 0.6`.
3. Paraphrase one leaked evaluation item by swapping every fifth word before
   pasting it. Does the 13-gram check still catch it?
4. Write the lineage query that lists every model trained on a given document
   hash, assuming tables for manifests, runs, and model registry entries.

## Check yourself

1. Why does MinHash make near-duplicate detection tractable?

   {{< details summary="Show answer" >}}
   The probability that two MinHash values agree equals the documents' Jaccard
   similarity, so a short signature estimates similarity. LSH bands let
   similar documents collide in hash buckets, so only candidate pairs are
   compared, instead of every pair in a quadratic search.
   {{< /details >}}

2. What does 1 − (1 − s^r)^b describe, and what happens if you increase r?

   {{< details summary="Show answer" >}}
   The probability that two documents with similarity s share at least one of
   b bands of r rows and become candidates. Increasing r makes each band
   harder to match, moving the curve's threshold toward higher similarity and
   making it steeper; increasing b moves it lower.
   {{< /details >}}

3. Why is a benchmark score unreliable if the benchmark is in the training
   data?

   {{< details summary="Show answer" >}}
   The model may have memorized the answers, so the score measures recall of
   seen items rather than the capability the benchmark is meant to test. That
   is why scores are reported separately on contaminated and clean subsets.
   {{< /details >}}

4. A user's documents must be deleted. What does lineage let you answer?

   {{< details summary="Show answer" >}}
   Which dataset versions contained those document hashes, which training runs
   used those datasets, and which models came from those runs. Deleting the
   source and building new dataset versions is mechanical; what to do about
   already trained models is a policy decision that needs that list.
   {{< /details >}}

## Sources

- A. Z. Broder, [On the resemblance and containment of documents](https://doi.org/10.1109/SEQUEN.1997.666900), Compression and Complexity of Sequences, 1997.
- J. Leskovec, A. Rajaraman, J. D. Ullman, [Mining of Massive Datasets](http://www.mmds.org/), chapter 3, Cambridge University Press.
- K. Lee et al., [Deduplicating Training Data Makes Language Models Better](https://arxiv.org/abs/2107.06499), ACL, 2022.
- G. Penedo et al., [The FineWeb Datasets: Decanting the Web for the Finest Text Data at Scale](https://arxiv.org/abs/2406.17557), 2024.
- T. Brown et al., [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165) (13-gram contamination analysis), 2020.
- A. Srivastava et al., [Beyond the Imitation Game](https://arxiv.org/abs/2206.04615) (BIG-bench canary string), 2022.
- T. Gebru et al., [Datasheets for Datasets](https://arxiv.org/abs/1803.09010), 2018.
- S. Longpre et al., [The Data Provenance Initiative: A Large Scale Audit of Dataset Licensing and Attribution in AI](https://arxiv.org/abs/2310.16787), 2023.
