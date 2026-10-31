+++
title = 'Retrieval over private documents'
description = 'A question-answering assistant over 20 million internal documents. The model is the easy part; the design work is in enforcing every source permission inside the search, keeping the index fresh, and making deletes and permission changes as fast as edits.'
question = 'How do you build an assistant over private documents that never answers from a document the user cannot open, and stays current as documents and permissions change?'
weight = 2
difficulty = 4
prerequisites = ['/notes/systems-design/ai-worked-designs/01-a-chat-assistant-at-scale', '/notes/application-security/authorization/01-broken-object-level-authorization', '/notes/ai-security-engineering/how-attacks-work/02-data-exfiltration-and-leakage']
date = 2026-10-30T16:10:00Z
lastmod = 2026-10-30T16:10:00Z
verified = 2026-10-30
+++

## The idea in one minute

The system answers employees' questions from 20 million internal documents
(wiki pages, tickets, shared drives, chat) and cites its sources. It looks like
a search box with a model on the end, and the model is the easy part. The hard
parts are two properties the model cannot provide. **Permissions**: a user must
never receive an answer, a snippet, a citation title, or a cached response
built from a document they cannot open. **Freshness**: the index must follow
edits, deletes, and permission changes within minutes, because a stale index
answers confidently from a superseded document.

Both are properties of the retrieval system, so they are enforced there: the
user's permissions are a filter evaluated **inside** the search, re-checked
before anything enters the model's context, and a failure to check means no
answer. The consequence to act on: if a chunk is in the context, treat it as
disclosed, because no instruction to the model makes it forget.

## A picture

```mermaid {title="Two paths: continuous ingestion with ACLs, and a query path filtered by the user's groups"}
flowchart TB
  subgraph ING["Ingestion: continuous"]
    direction LR
    SRC["<b>Source systems</b><br/><small>wiki, tickets, drive, chat</small>"] --> CON["<b>Connectors</b><br/><small>change feeds, ACLs</small>"]
    CON --> BUS[["<b>Change stream</b><br/><small>edit, delete, ACL change</small>"]]
    BUS --> PRS["<b>Parse, chunk, scan</b>"]
    PRS --> EMB["<b>Embedding model</b>"]
    EMB --> IDX[("<b>Hybrid index</b><br/><small>vectors, keywords, ACL ID</small>")]
    BUS --> ACL[("<b>ACL store</b><br/><small>users, groups, doc ACLs</small>")]
  end
  subgraph QRY["Query: per question"]
    direction LR
    U["<b>Employee</b>"] --> API["<b>Answer service</b><br/><small>identity from session</small>"]
    API --> SR["<b>Filtered search</b><br/><small>user's groups inside the index</small>"]
    SR --> RR["<b>Rerank</b><br/><small>100 to 8</small>"]
    RR --> VER["<b>Re-verify ACL</b><br/><small>fail closed</small>"]
    VER --> LLM["<b>Answer model</b><br/><small>cite or decline</small>"]
    LLM --> CHK["<b>Citation check,<br/>output sanitizer</b>"]
  end
  IDX --> SR
  ACL --> SR
  ACL --> VER
  CHK --> U
  class SRC warn
  class CON,BUS queue
  class PRS,EMB,RR,LLM,API compute
  class IDX,ACL memory
  class SR,VER,CHK good
  class U neutral
```

Every document is written by someone else, so the sources are marked as
attacker-controlled; the controls that hold are the filter, the
re-verification, and the output checks.

## How it really works

### Requirements

| Requirement | Decision |
| --- | --- |
| Users | 30,000 employees; 3,000 active at peak, each asking about 0.4 questions a minute |
| Corpus | 20 million documents from six source systems, about 150 million chunks; 2% change per day |
| Quality | At least 90% of answers judged correct and supported by their citations; "I could not find this" when the sources do not support an answer |
| Latency | First token under 2 s at p95; full answer under 12 s |
| Permissions | Source-system access enforced exactly; a group change takes effect within 15 minutes |
| Freshness | An edited document is searchable in its new form within 15 minutes |
| Deletion | A deleted document is unsearchable within 15 minutes, and gone from derived stores within 24 hours |
| Data | Everything stays in the company's cloud; a hosted model is allowed under a zero-retention agreement |
| Scope | The assistant only answers. It has no tools and takes no actions |

### Invariants

| # | Invariant |
| --- | --- |
| I1 | **No unauthorized derivation.** No answer, snippet, citation, title, or cached response is built from a chunk the user could not open at query time (within the 15-minute propagation bound) |
| I2 | **Fail closed.** If permission data is unavailable or older than its bound, the system returns no answer rather than an unfiltered one |
| I3 | **Deletes propagate.** A delete or permission change travels the same path, with the same deadline, as an edit |
| I4 | **Cite or decline.** Every claim in an answer cites a chunk that was in the context; code verifies each citation |
| I5 | **Provenance.** Every chunk records its source, document version, ACL, and embedding model version |

I1 has a subtle edge: titles. A citation list that shows "Q3 layoffs plan
(restricted)" leaks the existence and subject of a document even if its text
never reached the model. Citations come only from chunks that passed the
filter.

### Capacity estimate

**Queries.** 3,000 users × 0.4 per minute / 60 = **20 questions per second**.
Each question makes two model calls: a small model rewrites it into one to
three searches, and the answer model writes the reply.

**Answer call.** About 10,000 input tokens (instructions, 8 chunks of about
800 tokens with source labels, the conversation, the question), of which the
3,500-token instruction prefix is cached, and about 450 output tokens.

**Index size.** 150 million chunks × 1,024 dimensions × 4 bytes (float32) =
**614 GB** of raw vectors. Scalar [quantization](/notes/inference-engineering/making-it-cheaper/01-quantization/) to 1 byte per dimension gives
153.6 GB. An HNSW graph with 32 links per node at the bottom layer and 4-byte
IDs adds about 150 M × 32 × 4 = 19.2 GB. So about **175 GB in memory per
replica**, with float32 originals on disk to rescore the top candidates. The
keyword index over about 225 GB of chunk text (150 M × ~1.5 KB) lives on disk
with a page cache.

**Embedding.** A 335-million-parameter embedding model at about 350 tokens per
chunk needs 2 × 335 × 10⁶ × 350 ≈ 235 GFLOP per chunk. At 40% of an H100's
989 dense BF16 TFLOP/s that is about **1,700 chunks per second per GPU**.

- Steady state: 2% of 150 M = 3 million changed chunks a day, about **35 per
  second**: a fraction of one GPU.
- Bulk edits (a reorganized wiki space, a migrated drive) arrive in bursts of
  thousands per second, so the queue absorbs them and the 15-minute freshness
  target is a queue-age SLO.
- Full rebuild (a new embedding model): 150 M / 1,700 ≈ 88,000 s, about **25
  GPU-hours**. Cheap in GPU time; the expensive part is holding two 175 GB
  indexes while the new one is built and evaluated.

**Latency budget for the first token.**

| Stage | p95 budget |
| --- | --- |
| Rewrite (small model, short output) | 300 ms |
| Query embedding | 20 ms |
| Filtered hybrid search, 100 candidates | 80 ms |
| Rerank 100 to 8 (cross-encoder) | 150 ms |
| ACL re-verification of 8 chunks | 20 ms |
| Answer model TTFT, 6,500 uncached tokens | 1,000 ms |
| Network and assembly | 130 ms |
| **Total** | **1,700 ms** |

That leaves 300 ms of headroom under 2 s. The answer model's [prefill](/notes/inference-engineering/inference-mechanics/01-prefill-and-decode/) is most
of the budget, which is one reason to pass 8 chunks instead of 20.

### The design

**Connectors read change feeds, not crawls.** Each source exposes created,
updated, deleted, and permission-changed events (webhooks, change APIs, audit
feeds). A connector turns each into a change event with the document ID, the
version, the content if any, and the access-control list. A nightly
reconciliation compares source and index to catch missed events. Deletes and
ACL changes are first-class events (I3), not side effects of the next crawl.

**ACLs by reference.** Most documents share an ACL with many others (a wiki
space, a drive folder). The ACL store holds each distinct ACL once, as a list
of principals, and every chunk carries the **ACL ID** and the expanded list of
principals allowed to read it. A permission change on a folder is then one ACL
update plus a payload update on the affected chunks, not a re-embed.

**Parse, chunk, scan.** Split by document structure, attaching the heading
path, source URL, author, updated time, ACL ID, and version to every chunk.
Scan for secrets (keys, tokens) and for text that reads as instructions to a
model. Matches are quarantined for review rather than indexed: the index is a
sink for anything any employee, or in ticket and chat sources any customer, can
write.

**Filtered hybrid search.** The query carries the user's principals (user ID
plus group IDs, resolved from the identity store with a cache TTL under the
15-minute bound) as a filter evaluated inside the index. Dense and keyword
results are merged with reciprocal rank fusion (Cormack, Clarke, and Büttcher,
SIGIR 2009). The program below shows why the filter cannot be applied
afterwards: for a user who can read 2% of the corpus, filtering the global top
100 recovers under a third of the right chunks.

Filtered approximate search is its own problem (the unfiltered index is
covered in [embeddings and ANN search](/notes/systems-design/retrieval/01-embeddings-and-ann-search/)). A graph index built over all
vectors can strand the search in regions the user cannot read. Engines handle
it by checking the filter during graph traversal, by falling back to an exact
scan when the allowed set is small, or by building filter-aware graphs (ACORN,
SIGMOD 2024; Filtered-DiskANN, WWW 2023). Whichever the engine does, measure
recall per selectivity bucket, not on average.

**Re-verify, then assemble.** Before the 8 reranked chunks enter the context,
the answer service checks each document's current ACL against the user in the
ACL store. This catches a permission change that has not reached the index
payload yet. If the ACL store does not answer within its deadline, the request
fails closed (I2).

**Answer, then check.** The answer model receives instructions, the chunks
with labels, and the question; it must cite a label for each claim or say it
could not find the answer. Code then confirms that each cited label was in the
context (I4), and the output sanitizer removes links and images that point
outside an allowlist, which closes the rendering exit.

**Hard questions.** Multi-part questions ("compare this year's travel policy
with last year's") go to a retrieval loop in which the model may issue up to
three further searches, each with the same filter. A classifier decides; the
loop roughly triples cost and latency, so it is not the default.

### One question, end to end

```mermaid {title="A question: identity from the session, filter in the index, verify before the context"}
sequenceDiagram
  autonumber
  participant U as Employee
  participant A as Answer service
  participant I as Identity and ACL store
  participant X as Hybrid index
  participant M as Answer model
  U->>A: question (session cookie)
  A->>I: principals for this user
  I-->>A: user ID, 214 groups
  A->>A: rewrite into searches (small model)
  A->>X: search with filter: principals in chunk ACL
  X-->>A: 100 candidates, all readable
  A->>A: rerank to 8
  A->>I: current ACL for these 8 documents
  I-->>A: 7 allowed, 1 revoked a minute ago
  A->>M: instructions, 7 labeled chunks, question
  M-->>A: answer with labels
  A->>A: every label in context? strip external links
  A-->>U: answer, citations to 7 readable documents
```

### Permission designs compared

| Design | How | Tradeoff |
| --- | --- | --- |
| **Filter in the index** (chosen) | Each chunk stores its allowed principals; the query filters on the user's principals during search | One index; correct recall at every selectivity if the engine handles filters well; payload updates on ACL change |
| **Post-filter** (rejected) | Search everything, drop what the user cannot read | Simple, and wrong: recall collapses for users with narrow access, and any bug leaks |
| **Index per user** (rejected) | 30,000 indexes | Storage multiplied by the overlap; impossible at 175 GB each |
| **Partition per large group** (partial) | Separate collections for a few company-wide spaces | Useful for the biggest, most-shared spaces; still needs the filter for everything else |
| **Check at read time only** (second line) | Ask the ACL store about each candidate | Exact and current, but too slow for 100 candidates; used for the final 8 |

### Failure modes

| Failure | Behavior |
| --- | --- |
| Nothing relevant retrieved | The answer says so and suggests where to look; it does not improvise |
| Index lags a source | Queue age per source is an SLO; past 15 minutes, a banner names the source, and answers show document dates |
| A connector breaks | That source is marked degraded; others continue; reconciliation catches up after repair |
| ACL store unavailable | Fail closed: no answer (I2). It gets its own availability target and replicas, because it gates the whole product |
| Missed delete event | Nightly reconciliation finds documents present in the index but absent at the source and removes them |
| Answer model slow | First-token deadline, then the fallback route (a self-hosted model) with its own evaluated prompt |
| Embedding model upgrade | Build a second index in parallel, compare recall on the labeled set, switch reads, drop the old one |
| A document carries injected instructions | Ingestion scan and quarantine; the answer path has no tools and sanitized output, so the worst outcome is a wrong answer, not an action |

### Security review

- **The connectors are the most privileged component.** To index everything,
  they read everything. Their credentials are read-only, scoped per source,
  short-lived where the source allows, and held in the ingestion plane, which
  the query plane cannot reach. A compromised connector is a full-corpus
  breach; treat it like the crown jewels.
- **Embeddings are as sensitive as text.** Text can be substantially
  reconstructed from its embedding (Morris et al., EMNLP 2023), so the vector
  store gets the same access control and encryption as the documents.
- **Poisoning.** Any employee can write a wiki page that will be retrieved for
  everyone who can read it. Known-author and curated sources rank above open
  ones; a document can be removed with all its chunks within minutes; see
  [poisoning and supply chain](/notes/ai-security-engineering/how-attacks-work/03-poisoning-and-supply-chain/).
- **Injection through documents.** Retrieved text is untrusted input to the
  model. With no tools and sanitized output, injection can mislead but cannot
  act or exfiltrate through links; see
  [prompt injection](/notes/ai-security-engineering/how-attacks-work/01-prompt-injection/).
- **Caches.** No [semantic cache](/notes/systems-design/building-blocks/02-caches/) shared across users. An exact answer cache is
  keyed by the question and the user's ACL set, so two users share an entry
  only when they could read exactly the same chunks.
- **The object-level check.** "Open the cited document" links go through the
  source system, which applies its own permission check. The assistant never
  serves document content directly; the failure class is
  [broken object-level authorization](/notes/application-security/authorization/01-broken-object-level-authorization/).
- **Audit.** Each answer records the user, the chunk IDs shown, their ACL IDs,
  and the versions, so an investigation can answer "who could have seen this
  document through the assistant".

Keeping the assistant tool-less is a security decision. An assistant that can
only answer can be wrong, but it cannot be made to act. Adding "and let it file
tickets" moves the design into agent territory, and the trifecta of private
data, untrusted content, and an outbound channel has to be analyzed again.

### Cost

Answer calls: 20 per second × (6,500 × $3 + 3,500 × $0.30 + 450 × $15) per
million tokens = 20 × $0.0273 ≈ **$0.55 per second**, at assumed hosted prices.
Over 8 peak-equivalent hours, that is about $15,700 a day for 576,000
questions.

| Component | Per day |
| --- | --- |
| Answer model calls | about $15,700 |
| Small models (rewrite, rerank, embed) on about 6 shared GPUs at $3.50/hour | about $500 |
| Index: 3 replicas × 175 GB in memory, plus disk | a few hundred dollars |
| **Per question** | **about $0.03** |

The answer call is about 95% of the bill. Levers: pass fewer, better chunks
(8 instead of 20 cuts input roughly in half); keep the instruction prefix
stable so it stays cached; route simple factual questions to the self-hosted
model where evaluation shows it suffices; cap answer length.

### Evaluation

| Layer | Metric | Gate |
| --- | --- | --- |
| Retrieval | Recall@8 on 500 labeled question-document pairs, per selectivity bucket | No regression in any bucket |
| Answer | Correctness and support by a validated judge; citation accuracy by code | At least 90%, no regression |
| Declining | Unanswerable questions correctly declined | At least 95% |
| Permissions | A fixed suite of "user A asks about a document only B can read", including titles and caches | 100%, always |
| Freshness | Edit, delete, and ACL-change probes injected at each source, timed to unsearchable | Under 15 minutes |

The permission suite is a must-pass gate on every change to connectors, the
index, or query code.

### Decisions and alternatives rejected

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Permission enforcement | Filter inside the index, re-verify the final 8 | Post-filter (recall collapse, leak on bugs); instructing the model to withhold (not a control) |
| Change detection | Change feeds plus nightly reconciliation | Periodic full crawl: misses the 15-minute target and makes deletes slow |
| Search | Hybrid dense plus keyword with rank fusion | Dense only: weak on identifiers, error codes, and names that employees actually search for |
| Vector storage | int8 in memory, float32 on disk for rescoring | float32 in memory: 614 GB per replica. Product quantization: smaller, but more recall loss to measure |
| Answer model | Hosted, zero retention, with a self-hosted fallback | Self-hosted only: possible, but faithfulness to sources is the quality bar and was better on the hosted model in evaluation |
| Tools | None | "File a ticket" and similar: changes the threat model; a separate design |

### What changes at 10x

At 200 questions per second and 1.5 billion chunks:

- **The index shards.** 1.75 TB of quantized vectors per replica means
  sharding by source or by document ID, with a scatter-gather search and a
  merge. Filters have to be pushed to every shard.
- **ACL expansion gets expensive.** Users in thousands of groups produce large
  filter clauses on every shard; precompute per-user principal sets and keep
  hot ones cached.
- **Answer caching becomes worthwhile** for popular questions within the same
  ACL set, keyed as above.
- **Freshness needs per-source queues** so one source's bulk migration does
  not delay another source's deletes.

## Code

The program builds a synthetic corpus of 20,000 chunks with random embeddings,
each chunk in one of 200 access groups with skewed sizes. For users who can
read 50%, 10%, 2%, and 0.5% of the corpus, it compares exact filtered search
with post-filtering the global top 100, and counts how many of the global
top 8 the user was not allowed to see.

```python {title="acl_search.py"}
"""acl_search.py: why permission filtering belongs inside the search.

A synthetic corpus of 20,000 chunks with random 32-dimensional embeddings; each
chunk belongs to one access group. Users are members of groups that together
cover a given share of the corpus. For each query we compare:

  - pre-filter (exact): nearest neighbors among the chunks the user may read;
  - post-filter: the global top 100, then drop what the user may not read;
  - no filter: the global top 8, which is what leaks.

Brute-force search stands in for an ANN index. Standard library only.
"""

from __future__ import annotations

import math
import random

DIM, N_CHUNKS, N_GROUPS, K, CANDIDATES = 32, 20_000, 200, 8, 100


def unit(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def build(rng: random.Random) -> tuple[list[list[float]], list[int]]:
    vecs = [unit([rng.gauss(0, 1) for _ in range(DIM)]) for _ in range(N_CHUNKS)]
    # group sizes are skewed: a few big shared spaces, many small team spaces
    weights = [1 / (g + 1) for g in range(N_GROUPS)]
    groups = rng.choices(range(N_GROUPS), weights=weights, k=N_CHUNKS)
    return vecs, groups


def groups_covering(groups: list[int], share: float, rng: random.Random) -> set[int]:
    """Pick random groups (not the largest ones) until they cover `share` of chunks."""
    size = [0] * N_GROUPS
    for g in groups:
        size[g] += 1
    order = list(range(5, N_GROUPS))
    rng.shuffle(order)
    member, covered = set(), 0
    for g in order:
        if covered >= share * N_CHUNKS:
            break
        member.add(g)
        covered += size[g]
    return member


def top(vecs, ids, q, k):
    scored = sorted(ids, key=lambda i: -sum(a * b for a, b in zip(vecs[i], q)))
    return scored[:k]


def main() -> None:
    rng = random.Random(7)
    vecs, groups = build(rng)
    everything = range(N_CHUNKS)
    print(f"{N_CHUNKS:,} chunks, {N_GROUPS} groups; top {K} answers, post-filter over top {CANDIDATES}\n")
    print(f"{'user can read':>14}{'post-filter recall':>20}{'results returned':>18}{'forbidden in top 8':>20}")
    for share in (0.50, 0.10, 0.02, 0.005):
        member = groups_covering(groups, share, rng)
        allowed = [i for i in everything if groups[i] in member]
        recall = returned = leaked = 0.0
        queries = 20
        for _ in range(queries):
            target = rng.choice(allowed)                     # a question the user's docs can answer
            q = unit([x + rng.gauss(0, 0.6) for x in vecs[target]])
            exact = set(top(vecs, allowed, q, K))
            global_top = top(vecs, everything, q, CANDIDATES)
            post = [i for i in global_top if groups[i] in member][:K]
            recall += len(exact & set(post)) / K
            returned += len(post)
            leaked += sum(groups[i] not in member for i in global_top[:K])
        print(f"{len(allowed) / N_CHUNKS:>14.1%}{recall / queries:>20.0%}"
              f"{returned / queries:>18.1f}{leaked / queries:>20.1f}")


if __name__ == "__main__":
    main()
```

Run it with `python3 acl_search.py`:

```text
20,000 chunks, 200 groups; top 8 answers, post-filter over top 100

 user can read  post-filter recall  results returned  forbidden in top 8
         50.1%                100%               8.0                 4.0
         10.1%                 99%               8.0                 7.0
          2.2%                 31%               2.5                 7.7
          0.5%                 11%               0.9                 7.9
```

For a user who can read half the corpus, post-filtering looks fine. For a user
who can read 2.2%, it returns 2.5 chunks on average instead of 8 and finds 31%
of the right ones; at 0.5% it usually returns nothing, and the assistant
declines a question that the user's own documents answer. Selective users are
common: new joiners, contractors, and anyone in a small team. The last column
is the leak an unfiltered search would cause: almost all of the global top 8
belong to documents the narrow user cannot read.

```mermaid {title="Post-filter recall by how much of the corpus the user can read"}
xychart-beta
  title "Recall of post-filtering the global top 100"
  x-axis "Share of corpus readable" ["50%", "10%", "2.2%", "0.5%"]
  y-axis "Right chunks found (%)" 0 --> 100
  bar [100, 99, 31, 11]
```

## Where it breaks

- **The filter is only as fresh as its inputs.** Group membership cached for
  15 minutes means a removed user can read for up to 15 minutes; if the
  requirement is tighter, the cache TTL and the re-verification step must
  tighten too.
- **ACL models do not all flatten.** Some sources have deny rules, inherited
  permissions with exceptions, or link-sharing ("anyone with the link").
  Flattening those to an allow list must be done conservatively: when in
  doubt, exclude.
- **The simulation uses exact search.** It shows what post-filtering loses,
  not how a particular ANN engine behaves under filters; that has to be
  measured per engine and per selectivity.
- **Random vectors are not real embeddings.** Real queries cluster, and real
  ACLs correlate with topic (a team's documents are about the team's work),
  which can make post-filtering worse or better than shown.
- **A correct filter does not make answers correct.** Faithfulness, stale
  documents, and contradictions between sources are quality problems the
  evaluation suite has to catch.

## Remember this

- In private-document retrieval, permissions and freshness are the hard
  parts, not the model.
- Filter by the user's principals inside the search, re-verify the final
  chunks, and fail closed.
- Post-filtering fails quietly for users with narrow access.
- Deletes and permission changes are change events with the same deadline as
  edits.
- Connectors read everything and embeddings leak text: protect both like the
  documents themselves.

## Try it

1. Change `CANDIDATES` to 1,000 in `acl_search.py`. How far does post-filter
   recall recover at 2% and 0.5%, and what would that cost per query on 150
   million chunks?
2. Make ACLs correlate with topic: give each group its own region of the
   vector space. Does post-filtering get better or worse?
3. A user is removed from a group at 10:00. Trace when they stop receiving
   answers built from that group's documents, step by step through the cache
   TTL, the index payload update, and the re-verification.
4. Write the test that proves a citation list never shows the title of a
   document the user cannot open.

## Check yourself

1. Why is "the model was told not to reveal restricted documents" not a
   permission control?

   {{< details summary="Show answer" >}}
   Once a chunk is in the context, the model can reproduce, paraphrase, or
   summarize it, and instructions can be overridden by the question or by
   injected text. Permissions must be enforced before the context is built, in
   code that does not depend on the model's behavior.
   {{< /details >}}

2. What should the system do when the ACL store is unavailable, and why?

   {{< details summary="Show answer" >}}
   Fail closed: return no answer. An unfiltered answer could disclose
   documents the user cannot read, which is worse than unavailability. Because
   this makes the ACL store a dependency of every query, it gets its own
   replicas and availability target.
   {{< /details >}}

3. Why does post-filtering lose recall for some users but not others?

   {{< details summary="Show answer" >}}
   Post-filtering keeps only what the user can read from a fixed number of
   global candidates. If the user can read half the corpus, about half the
   candidates survive. If they can read 1%, about one in a hundred survives,
   so the top 100 yields roughly one chunk, and the right ones are usually not
   among them.
   {{< /details >}}

4. Why is an embedding model upgrade done by building a second index?

   {{< details summary="Show answer" >}}
   Vectors from different models are not comparable, so the old and new
   embeddings cannot be mixed in one index. Building the new index alongside
   the old one lets you measure recall on the labeled set before switching, and
   switch back if it regresses.
   {{< /details >}}

5. Why are the connectors treated as the most sensitive component?

   {{< details summary="Show answer" >}}
   They hold credentials that can read every document in every source, which
   the query path never needs. A compromised connector exposes the whole
   corpus regardless of any per-user filter, so its credentials are read-only,
   scoped per source, and isolated from the query plane.
   {{< /details >}}

## Sources

- G. V. Cormack, C. L. A. Clarke, S. Büttcher, Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods, ACM SIGIR, 2009.
- L. Patel et al., [ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data](https://arxiv.org/abs/2403.04871), ACM SIGMOD, 2024.
- S. Gollapudi et al., Filtered-DiskANN: Graph Algorithms for Approximate Nearest Neighbor Search with Filters, ACM Web Conference (WWW), 2023.
- Y. A. Malkov, D. A. Yashunin, [Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs](https://arxiv.org/abs/1603.09320), IEEE TPAMI, 2018.
- J. X. Morris et al., [Text Embeddings Reveal (Almost) As Much As Text](https://arxiv.org/abs/2310.06816), EMNLP, 2023.
- P. Lewis et al., [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401), NeurIPS, 2020.
- OWASP, [Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) (LLM08: Vector and Embedding Weaknesses).
