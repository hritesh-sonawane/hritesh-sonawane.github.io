+++
title = 'Prefix caching'
description = 'Keys and values for a token depend only on the tokens before it, so requests that share a prefix can share its KV cache. Engines hash each full block together with everything before it and reuse the longest cached run, which removes most prefill work for system prompts and multi-turn chat when prompts put stable content first.'
question = 'How does an engine skip prefill for prompt text it has already seen, and what makes the hit rate high or zero?'
weight = 3
difficulty = 3
prerequisites = ['/notes/inference-engineering/batching-and-scheduling/02-paged-kv-memory', '/notes/inference-engineering/inference-mechanics/01-prefill-and-decode']
date = 2026-10-30T03:15:00Z
lastmod = 2026-10-30T03:15:00Z
verified = 2026-10-30
+++

## The idea in one minute

In a causal model, the key and value vectors at position `i` depend only on
tokens `0 … i`. Two prompts that start with the same 1,200 tokens produce
identical KV for those tokens. **Prefix caching** keeps KV blocks after a
request finishes and maps a later request's matching prefix onto them, so only
the new suffix is prefilled.

With paged KV, the unit of reuse is a block. Each full block gets a hash of its
tokens **chained with its parent block's hash**, so a hash identifies the whole
prefix up to that block. A new request looks up its block hashes in order and
stops at the first miss. vLLM's automatic prefix caching and SGLang's
RadixAttention (a radix tree over token sequences) both work this way in
spirit.

In the simulation below, 200 users holding six-turn chats behind a shared
system prompt need only **7% of their prompt tokens prefilled**. Put a
timestamp at the top of the prompt and the hit rate is **zero**. The
consequence to act on: **order prompts from most stable to least stable**,
size the cache for your working set, and treat a shared cache as a channel
between tenants.

## A picture

```mermaid {title="Chained block hashes: the match stops at the first miss"}
flowchart LR
  subgraph R["New request: system prompt + history + new message"]
    direction LR
    B0["block 0"] --> B1["block 1"] --> B2["block 2"] --> B3["block 3"] --> B4["tail<br/><small>partial block</small>"]
  end
  B0 -. "h0 = H(seed, tokens)" .-> M[("hash → block")]
  B1 -. "h1 = H(h0, tokens)" .-> M
  B2 -. "h2 = H(h1, tokens)" .-> M
  B3 -. "h3 = H(h2, tokens)" .-> M
  M -->|"h0, h1, h2 found"| HIT["<b>reuse 3 blocks</b><br/><small>no prefill for them</small>"]
  M -->|"h3 missing: stop"| MISS["<b>prefill block 3 + tail</b>"]
  class B0,B1,B2 memory
  class B3,B4 compute
  class M queue
  class HIT good
  class MISS compute
```

## How it really works

### Why the hash is a chain

A block's KV depends on every earlier token, so its identity must too. Hashing
the whole prefix for every block would cost time quadratic in the prompt.
Hashing `(parent hash, this block's tokens, extra keys)` costs linear time and
has the same meaning: equal hashes imply equal prefixes. It also means a miss
at block `j` implies a miss at every later block, so lookup stops there.

Extra keys go into the hash whenever identical tokens would not produce
identical KV: the LoRA adapter in use, image or audio content behind
placeholder tokens, and an optional per-request **cache salt**.

### Two rounding rules

- **Hits come in whole blocks.** With 16-token blocks, a 50-token shared prefix
  gives a 48-token hit.
- **The last prompt token is always computed.** The cache holds keys and
  values, not output logits, and the model must run on at least one position
  to produce the first new token. An identical prompt sent twice still
  recomputes its final block.

### Eviction and the working set

Cached blocks are not reserved. A block with no running request referencing it
stays in the pool as a **cached free block**: it can be reused on a hit, or
handed to a new allocation, in least-recently-used order. Prefix caching
therefore costs no capacity; it only uses memory that would otherwise be idle.
The hit rate depends on whether the **working set**, the blocks that will be
reused before eviction, fits in the free part of the pool. A busy replica with
little free KV memory evicts quickly and hits less.

Across replicas, a hit only happens on the replica that has the blocks.
Load balancers that hash a session or prefix to a replica (prefix-aware or
cache-aware routing) raise hit rates; round-robin across many replicas divides
them.

### What breaks the prefix

Because the chain starts at token 0, a difference at position `p` invalidates
every block from `⌊p / block_size⌋` on.

| Pattern | Effect |
| --- | --- |
| Date, time, or request ID at the top of the system prompt | no hits across requests |
| User name or profile near the top | hits only within one user |
| Retrieved documents in varying order before the instructions | hits stop at the first difference |
| Tool definitions serialized in a different order per request | hits stop where the order differs |
| History rewritten or summarized each turn | hits stop where the rewrite begins |
| Chat template that drops earlier reasoning text | the previous answer's blocks no longer match |

Order the prompt from most to least stable: fixed instructions, tool
definitions, shared documents, conversation history, then the new message and
anything volatile. Multi-turn chat is the best case: turn `n + 1` starts with
turn `n`'s prompt and its answer, and the answer's blocks were cached as they
filled during decode.

### What a hit saves

For a prompt of `P` tokens with `H` cached, prefill work falls from `P` to
`P − H` tokens, and TTFT falls with it. Decode is unchanged: the sequence
still reads its full KV every step. A request with a 30,000-token cached
document and a 50-token question pays for 50 tokens of prefill, which is why
hosted APIs price cached input tokens lower than uncached ones.

### Tenancy and side channels

A shared cache leaks a bit per probe through timing. If a request's first token
comes back unusually fast, its prefix was cached, which means someone sent it
recently. An attacker who can guess candidate prefixes can test them block by
block. Gu et al. (2025) audited hosted LLM APIs and detected cache sharing
across users at several providers by exactly this kind of timing test.

```mermaid {title="Timing probe against a shared prefix cache, and the salt that closes it"}
flowchart LR
  A["<b>Prober</b><br/><small>guesses a prefix</small>"] --> G["<b>Gateway</b>"]
  V["Victim tenant<br/><small>sent the real prefix</small>"] --> G
  G -->|"no salt"| C[("shared cache")]
  C -->|"fast TTFT = hit"| L["prober learns the<br/>prefix was sent"]
  G -->|"salt per tenant"| S["<b>separate hash chains</b><br/><small>no cross-tenant hits</small>"]
  class A warn
  class L warn
  class S good
  class C queue
  class G,V neutral
```

The defense is to put a per-tenant secret into the first block's hash. vLLM
supports this as a `cache_salt` request field: different salts produce
different chains, so tenants never share blocks, and requests within a tenant
share normally. Set the salt in the [gateway](/notes/systems-design/building-blocks/01-gateways-and-routers/) from the authenticated tenant,
never from the client. The cost is cross-tenant hits, typically the shared
system prompt.

Hash choice matters for the same reason: a collision would give one request
another's KV. Use a cryptographic hash (vLLM supports SHA-256, and its
documentation warns about non-cryptographic options in multi-tenant settings).

## Code

The program implements chained SHA-256 block hashes, the longest-prefix match,
the last-token rule, and an LRU block store, and replays 1,200 chat turns from
200 users who share a 1,200-token system prompt. Each turn's prompt is the
system prompt, the user's history (earlier messages and answers), and a new
message. Answers are cached as they would be after decode.

```python {title="prefix_cache.py"}
"""prefix_cache.py: block-level prefix caching with chained hashes and LRU eviction.

Each full 16-token block is identified by H(parent hash, block tokens, salt).
A request reuses the longest run of cached blocks from its start and computes
the rest. Traffic: multi-turn chats behind a shared 1,200-token system prompt.
Standard library only; runs offline.
"""

from __future__ import annotations

import hashlib
import random
from collections import OrderedDict

BLOCK = 16


def block_hashes(tokens: list[int], salt: str = "") -> list[bytes]:
    out, parent = [], hashlib.sha256(salt.encode()).digest()
    for i in range(0, len(tokens) - len(tokens) % BLOCK, BLOCK):
        parent = hashlib.sha256(parent + repr(tokens[i:i + BLOCK]).encode()).digest()
        out.append(parent)
    return out


class PrefixCache:
    def __init__(self, capacity_blocks: int) -> None:
        self.cap = capacity_blocks
        self.blocks: OrderedDict[bytes, None] = OrderedDict()   # LRU order

    def serve(self, tokens: list[int], answer: list[int], salt: str = "") -> int:
        """Returns prompt tokens computed. Caches every full block of prompt and
        answer, as an engine does when generated tokens fill a block."""
        hashes = block_hashes(tokens, salt)
        # Never hit the last token: the model must run on it to produce logits.
        usable = (len(tokens) - 1) // BLOCK
        hit = 0
        for h in hashes[:usable]:
            if h not in self.blocks:
                break                     # chained hashes: a miss ends the match
            self.blocks.move_to_end(h)
            hit += 1
        for h in block_hashes(tokens + answer, salt)[hit:]:
            self.blocks[h] = None
            if len(self.blocks) > self.cap:
                self.blocks.popitem(last=False)
        return len(tokens) - hit * BLOCK


def traffic(seed: int, volatile_header: bool, users: int = 200, turns: int = 6):
    """Yields (user, prompt, answer). Each turn's prompt = system + history + new message."""
    rng = random.Random(seed)
    system = [rng.randrange(50_000) for _ in range(1200)]
    history = {u: [] for u in range(users)}
    order = [u for u in range(users) for _ in range(turns)]
    rng.shuffle(order)
    for clock, u in enumerate(order):
        header = [clock % 997, clock // 997] if volatile_header else []  # e.g. a timestamp
        msg = [rng.randrange(50_000) for _ in range(rng.randint(20, 200))]
        prompt = header + system + history[u] + msg
        answer = [rng.randrange(50_000) for _ in range(rng.randint(50, 400))]
        history[u] += msg + answer
        yield u, prompt, answer


def run(capacity: int, volatile: bool = False, salted: bool = False) -> tuple[float, int, int]:
    cache, total, computed = PrefixCache(capacity), 0, 0
    for u, prompt, answer in traffic(1, volatile):
        total += len(prompt)
        computed += cache.serve(prompt, answer, salt=f"user-{u}" if salted else "")
    return 1 - computed / total, total, computed


def main() -> None:
    kib = 128  # Llama-3-8B KV per token
    print(f"{'scenario':<44}{'cache':>9}{'hit rate':>10}{'prefill tokens':>16}")
    for name, cap, vol, salt in (
            ("no cache", 0, False, False),
            ("shared system prompt, stable prefix", 20_000, False, False),
            ("same, cache 4x smaller", 5_000, False, False),
            ("same, cache too small for the sessions", 1_000, False, False),
            ("timestamp placed before the system prompt", 20_000, True, False),
            ("per-user salt (no cross-user sharing)", 20_000, False, True)):
        rate, total, computed = run(cap, vol, salt)
        gib = cap * BLOCK * kib / 2**20
        print(f"{name:<44}{gib:>6.1f}GiB{100 * rate:>9.1f}%{computed:>10,} of {total / 1e6:.1f}M")


if __name__ == "__main__":
    main()
```

Run it with `python3 prefix_cache.py`:

```text
scenario                                        cache  hit rate  prefill tokens
no cache                                       0.0GiB      0.0% 2,581,118 of 2.6M
shared system prompt, stable prefix           39.1GiB     92.8%   187,102 of 2.6M
same, cache 4x smaller                         9.8GiB     67.8%   831,582 of 2.6M
same, cache too small for the sessions         2.0GiB     58.0% 1,083,470 of 2.6M
timestamp placed before the system prompt     39.1GiB      0.0% 2,583,518 of 2.6M
per-user salt (no cross-user sharing)         39.1GiB     56.5% 1,123,214 of 2.6M
```

With a stable prefix and enough cache, 92.8% of prompt tokens are hits:
the system prompt is computed once, and each turn reuses the previous turn's
prompt and answer. A smaller cache evicts sessions between turns and keeps
mostly the shared system prompt. Two numbers in the last rows are the lesson's
warnings: a timestamp before the system prompt takes the hit rate to zero, and
per-user salts give up the shared system prompt (56.5% instead of 92.8%) in
exchange for isolation. A per-tenant salt, shared by all of a tenant's users,
keeps most of the benefit.

## Where it breaks

- **Hit rate is a property of prompts, not the engine.** Templates that inject
  volatile content early defeat it silently. Measure hit rate (vLLM exposes
  prefix-cache query and hit counters) per route.
- **Busy replicas evict.** When the KV pool is full of running sequences,
  cached blocks are reclaimed quickly. The simulation's fixed capacity hides
  that this capacity shrinks under load.
- **Routing decides hits in a fleet.** A prefix cached on one replica does
  nothing for a request routed to another.
- **Some requests cannot use it.** Requests that ask for prompt log
  probabilities need a real pass over every prompt token, and models with
  non-causal attention layers cannot share prefixes at all.
- **Isolation costs hits.** Salting by tenant removes cross-tenant sharing; that
  is the point, and it should be the default for multi-tenant services.

## Remember this

- KV at position i depends only on tokens 0 to i, so shared prefixes share KV.
- Block hashes chain the parent hash, so equal hashes mean equal prefixes and a
  miss ends the match.
- Hits come in whole blocks, and the last prompt token is always recomputed.
- Put stable content first; anything volatile at the top zeroes the hit rate.
- A shared cache is a timing channel; salt by tenant at the gateway.

## Try it

1. Move the timestamp from before the system prompt to just before the new
   message. What is the hit rate now?
2. Change the salt from per user to per tenant, with 10 tenants of 20 users.
   How close does the hit rate get to the unsalted case?
3. Route the 200 users across 4 replicas round-robin per turn, each with a
   quarter of the cache, then by hashing the user ID. Compare hit rates.
4. On a vLLM server, send the same 2,000-token prompt twice and compare TTFT and
   the prompt-tokens-cached counter.

## Check yourself

1. Why must a block's hash include its parent's hash, not just its own tokens?

   {{< details summary="Show answer" >}}
   A block's keys and values depend on every earlier token. Two blocks with the
   same 16 tokens after different prefixes have different KV. Chaining makes
   the hash identify the whole prefix while staying linear to compute.
   {{< /details >}}

2. An identical 64-token prompt is sent twice with 16-token blocks. How many
   tokens hit the second time?

   {{< details summary="Show answer" >}}
   48. The last token must be computed to produce logits, so the usable hit is
   at most 63 tokens, rounded down to whole blocks: three blocks.
   {{< /details >}}

3. A team adds "Current time: …" at the top of its system prompt and prefill
   cost triples. Why?

   {{< details summary="Show answer" >}}
   The first block now differs on every request, so its hash differs, and the
   chained hashes of every later block differ too. No request matches any
   cached block.
   {{< /details >}}

4. How can a shared prefix cache leak information between tenants, and what
   closes it?

   {{< details summary="Show answer" >}}
   A fast first token reveals a cache hit, so a prober can test whether
   someone else recently sent a guessed prefix. A per-tenant salt in the first
   block's hash, set by the gateway, gives each tenant its own hash chains so
   cross-tenant hits cannot happen.
   {{< /details >}}

## Sources

- W. Kwon et al., [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180), SOSP 2023.
- L. Zheng et al., [SGLang: Efficient Execution of Structured Language Model Programs](https://arxiv.org/abs/2312.07104), NeurIPS 2024 (RadixAttention).
- vLLM project, [Automatic prefix caching](https://docs.vllm.ai/en/latest/design/prefix_caching.html), vLLM design documentation (block hashing, `cache_salt`, hash algorithms), accessed October 2026.
- C. Gu, X. L. Li, R. Kuditipudi, P. Liang, T. Hashimoto, [Auditing Prompt Caching in Language Model APIs](https://arxiv.org/abs/2502.07776), February 2025.
- R. Pope et al., [Efficiently Scaling Transformer Inference](https://arxiv.org/abs/2211.05102), MLSys 2023.
