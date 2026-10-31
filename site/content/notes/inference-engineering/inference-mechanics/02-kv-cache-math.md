+++
title = 'KV cache math'
description = 'The KV cache stores two vectors per layer per KV head for every token a sequence holds. Its size is exact arithmetic from the model config, and it decides how many users fit on a GPU, how context length prices out, and when KV reads outweigh weight reads.'
question = 'How much memory does each token of context cost, and how many sequences fit on a GPU?'
weight = 2
difficulty = 2
prerequisites = ['/notes/inference-engineering/inference-mechanics/01-prefill-and-decode']
date = 2026-10-30T01:10:00Z
lastmod = 2026-10-30T01:10:00Z
verified = 2026-10-30
+++

## The idea in one minute

During decode, attention needs the key and value vectors of every earlier
token. Recomputing them each step would turn generation quadratic, so the
server stores them: the **KV cache**. Its size is fixed by the architecture:

```text
KV bytes = 2 × layers × kv_heads × head_dim × bytes_per_element × tokens
```

The `2` is one key and one value. For Llama-3-8B in BF16 that is
`2 × 32 × 8 × 128 × 2 = 131,072` bytes, **128 KiB per token**. A 32k-token
conversation holds 4.3 GB, a quarter of the model's own weights.

That number drives capacity. After weights and working memory, an 80 GB GPU
serving Llama-3-8B has about 52 GB for KV: 96 sequences at 4k tokens, or 3 at
128k. The consequence to act on: **concurrency is KV budget divided by KV per
sequence, so context length is a capacity decision, not just a feature**, and
the attention design (MHA, GQA, MLA) and KV precision are the levers that move
it.

## A picture

```mermaid {title="Every term in the KV size formula, and the admission check it feeds"}
flowchart LR
  T["2<br/><small>K and V</small>"] --> X(("×"))
  L["layers"] --> X
  H["kv_heads × head_dim"] --> X
  D["bytes per element<br/><small>BF16 = 2, FP8 = 1</small>"] --> X
  N["tokens held<br/><small>prompt + output</small>"] --> X
  X --> R["<b>KV bytes</b><br/><small>per sequence</small>"]
  R --> C{"fits in HBM after<br/>weights and overhead?"}
  C -->|"yes"| OK["admit"]
  C -->|"no"| NO["queue, preempt, or<br/>shorten context"]
  class T,L,H,D,N neutral
  class X,R memory
  class C queue
  class OK good
  class NO neutral
```

## How it really works

### Reading the formula from a config

Every term comes from the model's `config.json`:

| Config key | Term | Llama-3-8B |
| --- | --- | --- |
| `num_hidden_layers` | layers | 32 |
| `num_key_value_heads` | kv_heads (equals `num_attention_heads` if absent) | 8 |
| `head_dim`, else `hidden_size / num_attention_heads` | head_dim | 4096 / 32 = 128 |
| `torch_dtype`, or the serving engine's KV dtype | bytes per element | 2 (BF16) |

Two traps. The query head count does not appear: KV size depends on **KV
heads**, which differ from query heads in any model using grouped-query
attention. And some configs set `head_dim` explicitly to a value that is not
`hidden_size / heads`; use it when present.

### Attention design is the biggest lever

- **Multi-head attention (MHA)** keeps one K and V per query head. Llama-2-7B
  has 32 of each: 512 KiB per token.
- **Multi-query attention (MQA)**, from Shazeer (2019), shares one K and V
  across all query heads.
- **Grouped-query attention (GQA)**, from Ainslie et al. (2023), shares each K
  and V across a group. Llama-3-8B has 32 query heads and 8 KV heads, a
  quarter of MHA's cache.
- **Multi-head latent attention (MLA)**, introduced in DeepSeek-V2, caches a
  compressed latent per layer (512 values in DeepSeek-V3) plus a small
  positional key (64 values), and reconstructs keys and values from it. The
  cache per token is independent of head count.

A correction worth making: Llama-2-70B is often listed as an MHA model, but
the Llama 2 paper states that its 34B and 70B variants use GQA with 8 KV heads.
Its KV per token is 320 KiB, the same as Llama-3-70B, not 2.5 MiB.

### From bytes per token to users per GPU

```text
KV budget      = usable HBM − weights − activations, graphs, workspace
max sequences  = KV budget ÷ (KV per token × tokens per sequence)
```

Engines size this at startup. vLLM, for example, takes a configured fraction
of GPU memory, profiles a forward pass at the largest batch it will schedule,
and gives what is left to the KV cache; its startup log reports the result as
a number of blocks and a maximum concurrency at the configured context length.
The program below assumes 90% of HBM usable and 4 GB per GPU of non-KV working
memory; check those against your engine's log.

With [tensor parallelism](/notes/inference-engineering/distributed-inference/01-tensor-pipeline-and-expert-parallelism/) over `N` GPUs, each GPU holds `1/N` of the KV heads for
every sequence, so the budget pools across the group. That only works while
`N` divides the KV head count: at 8 KV heads, `TP = 16` must replicate heads,
and the KV per GPU stops shrinking.

### KV is also bandwidth

The cache is read in full at every decode step. Per step:

```text
bytes = weight bytes + KV per token × (sum of context lengths in the batch)
```

For Llama-3-8B, weights are 15 GB, so KV reads equal weight reads once the
batch holds `15 GB ÷ 128 KiB ≈ 114,000` tokens in total: 28 sequences at 4k, or
3.5 at 32k. Past that point the KV cache, not the model, dominates every step.
That has a practical edge: at long context and high batch, **quantizing the KV
cache to FP8 can speed decode more than quantizing the weights**, because it
halves the larger term.

```mermaid {title="Decode bytes per step, Llama-3-8B, by batch and context"}
xychart-beta
  x-axis ["1 x 4k", "32 x 4k", "128 x 4k", "32 x 32k"]
  y-axis "GB read per decode step" 0 --> 160
  bar [15.5, 32.2, 83.7, 152.4]
```

### Worked capacity check

A product wants 32k-token contexts on Llama-3-8B, one H100 per replica:

1. KV per sequence: 128 KiB × 32,768 = 4.29 GB.
2. KV budget: 80 × 0.9 − 4 − 16.06 (all 8.03B parameters resident) ≈ 52 GB.
3. Concurrency: 52 ÷ 4.29 = **12 sequences**.
4. Step time if all 12 are at full context: (15 + 51.5) GB ÷ 3.35 TB/s ≈ 20 ms,
   about 50 tokens per second per user.

At 4k context the same GPU holds 96 sequences. The 32k feature costs roughly
8× the hardware per user at full length, which is why context limits, KV
[quantization](/notes/inference-engineering/making-it-cheaper/01-quantization/), and pricing by tokens held belong in the same conversation.

## Code

The program computes KV per token for six published configs, sequences that
fit under a stated budget, and the bytes a decode step reads.

```python {title="kv_math.py"}
"""kv_math.py: KV cache bytes per token, per sequence, and how many sequences fit.

KV bytes = 2 (K and V) x layers x kv_heads x head_dim x bytes per element x tokens.
Configs are copied from the published model configs; the GPU budget is an
assumption stated below. Standard library only; runs offline.
"""

from __future__ import annotations

from dataclasses import dataclass

GB = 1e9
GiB = 2**30


@dataclass(frozen=True)
class Model:
    name: str
    params: float      # total parameters
    layers: int
    kv_heads: int
    head_dim: int
    attention: str
    latent: int = 0    # MLA: compressed KV width stored per layer per token

    def kv_bytes_per_token(self, dtype_bytes: int = 2) -> int:
        if self.latent:
            return self.layers * self.latent * dtype_bytes
        return 2 * self.layers * self.kv_heads * self.head_dim * dtype_bytes


MODELS = [
    Model("Llama-2-7B", 6.74e9, 32, 32, 128, "MHA"),
    Model("Llama-3-8B", 8.03e9, 32, 8, 128, "GQA-8"),
    Model("Qwen2.5-7B", 7.62e9, 28, 4, 128, "GQA-4"),
    Model("Llama-2-70B", 69.0e9, 80, 8, 128, "GQA-8"),
    Model("Llama-3-70B", 70.6e9, 80, 8, 128, "GQA-8"),
    # DeepSeek-V3: MLA caches a 512-wide latent plus a 64-wide RoPE key per layer.
    Model("DeepSeek-V3", 671e9, 61, 0, 0, "MLA", latent=512 + 64),
]


def concurrency(m: Model, gpus: int, hbm: float, context: int, dtype_bytes: int,
                reserve: float = 0.10, overhead: float = 4 * GB) -> tuple[float, int]:
    """KV budget across `gpus` and the number of `context`-token sequences it holds.

    reserve: fraction of HBM the engine leaves untouched; overhead: activations,
    CUDA graphs and workspace per GPU. Both are assumptions, not measurements.
    """
    budget = gpus * (hbm * (1 - reserve) - overhead) - m.params * 2
    per_seq = m.kv_bytes_per_token(dtype_bytes) * context
    return budget, max(0, int(budget // per_seq))


def main() -> None:
    print(f"{'model':<13}{'attn':<7}{'KV/token':>10}{'4k seq':>10}{'32k seq':>10}{'128k seq':>10}")
    for m in MODELS:
        b = m.kv_bytes_per_token()
        print(f"{m.name:<13}{m.attention:<7}{b / 1024:>7.0f} KiB"
              + "".join(f"{b * n / GB:>8.2f} GB" for n in (4096, 32768, 131072)))

    print("\nSequences that fit, BF16 weights, 90% of HBM usable, 4 GB/GPU overhead")
    plans = [("Llama-3-8B", 1), ("Llama-2-7B", 1), ("Llama-3-70B", 4), ("Llama-3-70B", 8)]
    print(f"{'model':<13}{'GPUs':>5}{'KV budget':>11}" + "".join(
        f"{c // 1024:>6}k" for c in (4096, 8192, 32768, 131072)) + "   (BF16 KV)")
    for name, gpus in plans:
        m = next(x for x in MODELS if x.name == name)
        cells = [concurrency(m, gpus, 80 * GB, c, 2) for c in (4096, 8192, 32768, 131072)]
        print(f"{name:<13}{gpus:>5}{cells[0][0] / GB:>8.0f} GB" + "".join(
            f"{n:>7}" for _, n in cells))
    m = next(x for x in MODELS if x.name == "Llama-3-8B")
    cells = [concurrency(m, 1, 80 * GB, c, 1) for c in (4096, 8192, 32768, 131072)]
    print(f"{'Llama-3-8B':<13}{1:>5}{cells[0][0] / GB:>8.0f} GB" + "".join(
        f"{n:>7}" for _, n in cells) + "   (FP8 KV)")

    print("\nDecode bytes per step, Llama-3-8B, batch x context = tokens resident")
    weights = 15.0 * GB  # matmul weights actually streamed per step (see lesson 1)
    for batch, ctx in ((1, 4096), (32, 4096), (32, 32768), (128, 4096)):
        kv = m.kv_bytes_per_token() * batch * ctx
        print(f"  batch {batch:>3} x {ctx:>5}: weights {weights / GB:5.1f} GB + KV {kv / GB:6.1f} GB"
              f"  -> KV is {100 * kv / (kv + weights):3.0f}% of bytes")
    cross = weights / m.kv_bytes_per_token()
    print(f"  KV reads equal weight reads at batch x context = {cross:,.0f} tokens")


if __name__ == "__main__":
    main()
```

Run it with `python3 kv_math.py`:

```text
model        attn     KV/token    4k seq   32k seq  128k seq
Llama-2-7B   MHA        512 KiB    2.15 GB   17.18 GB   68.72 GB
Llama-3-8B   GQA-8      128 KiB    0.54 GB    4.29 GB   17.18 GB
Qwen2.5-7B   GQA-4       56 KiB    0.23 GB    1.88 GB    7.52 GB
Llama-2-70B  GQA-8      320 KiB    1.34 GB   10.74 GB   42.95 GB
Llama-3-70B  GQA-8      320 KiB    1.34 GB   10.74 GB   42.95 GB
DeepSeek-V3  MLA         69 KiB    0.29 GB    2.30 GB    9.21 GB

Sequences that fit, BF16 weights, 90% of HBM usable, 4 GB/GPU overhead
model         GPUs  KV budget     4k     8k    32k   128k   (BF16 KV)
Llama-3-8B       1      52 GB     96     48     12      3
Llama-2-7B       1      55 GB     25     12      3      0
Llama-3-70B      4     131 GB     97     48     12      3
Llama-3-70B      8     403 GB    300    150     37      9
Llama-3-8B       1      52 GB    193     96     24      6   (FP8 KV)

Decode bytes per step, Llama-3-8B, batch x context = tokens resident
  batch   1 x  4096: weights  15.0 GB + KV    0.5 GB  -> KV is   3% of bytes
  batch  32 x  4096: weights  15.0 GB + KV   17.2 GB  -> KV is  53% of bytes
  batch  32 x 32768: weights  15.0 GB + KV  137.4 GB  -> KV is  90% of bytes
  batch 128 x  4096: weights  15.0 GB + KV   68.7 GB  -> KV is  82% of bytes
  KV reads equal weight reads at batch x context = 114,441 tokens
```

Llama-2-7B, the only MHA model in the table, fits a quarter as many sequences
as Llama-3-8B despite being smaller. FP8 KV doubles every concurrency figure.
DeepSeek-V3 is far larger than Llama-3-70B yet caches less per token than
Llama-3-8B; its weights do not fit on these GPUs at all, so it appears only in
the first table.

## Where it breaks

- **The formula counts only full-attention layers.** Sliding-window layers
  (Mistral 7B v0.1, Gemma 2 and 3) cap their cache at the window, and hybrid
  models with state-space or linear-attention layers keep a fixed-size state
  instead. Count each layer type separately.
- **Allocation granularity wastes some memory.** Engines allocate KV in blocks
  (16 tokens by default in vLLM), so a sequence holds up to one partial block
  per layer group. The next module covers how paging keeps that waste small.
- **Overhead is an assumption.** Activation memory grows with the batch token
  budget, CUDA graphs take memory, and other processes on the GPU take more.
  Read the engine's startup log rather than trusting the 4 GB in the program.
- **Average context is not peak context.** A sequence's KV grows as it
  generates. Admission based on current length can later force preemption
  when sequences grow.
- **MLA saves memory, not all bandwidth.** Reconstructing keys and values from
  the latent costs compute, and kernels must be built for it.

## Remember this

- KV bytes = 2 × layers × kv_heads × head_dim × bytes × tokens.
- Llama-3-8B: 128 KiB per token in BF16; Llama-3-70B and Llama-2-70B: 320 KiB.
- Concurrency = KV budget ÷ KV per sequence; long context divides it directly.
- GQA, MQA, and MLA shrink the cache by sharing or compressing keys and values.
- Once a batch holds more tokens than weight bytes ÷ KV per token, KV reads
  dominate decode.

## Try it

1. Add Mistral-7B v0.1 with its 4,096-token sliding window. How does its KV per
   sequence change at 32k context?
2. Change the KV dtype to FP8 for Llama-3-70B on 8 GPUs. How many 128k
   sequences fit now?
3. Start any vLLM model with `--max-model-len 8192` and read the reported KV
   cache size and maximum concurrency. How close is the program's estimate,
   and which assumption is off?
4. For your heaviest workload, compute batch × average context. Are you above
   or below the point where KV reads exceed weight reads?

## Check yourself

1. Why does Llama-3-8B (32 query heads) cache a quarter as much per token as
   Llama-2-7B (32 query heads)?

   {{< details summary="Show answer" >}}
   KV size depends on KV heads, not query heads. Llama-3-8B uses grouped-query
   attention with 8 KV heads shared by groups of 4 query heads; Llama-2-7B uses
   multi-head attention with 32 KV heads.
   {{< /details >}}

2. Compute the KV cache for one 16,384-token Llama-3-70B sequence in BF16.

   {{< details summary="Show answer" >}}
   2 × 80 × 8 × 128 × 2 = 327,680 bytes per token. Times 16,384 tokens is
   about 5.37 GB.
   {{< /details >}}

3. A replica holds 96 sequences at 4k context. Product doubles the context
   limit to 8k and traffic is unchanged. What happens to capacity?

   {{< details summary="Show answer" >}}
   For sequences that use the extra context, KV per sequence doubles, so the
   replica holds about 48 of them. Each step also reads more KV, so ITL rises.
   Capacity per GPU roughly halves for long requests.
   {{< /details >}}

4. When does FP8 KV cache help decode speed more than FP8 weights?

   {{< details summary="Show answer" >}}
   When the KV bytes read per step exceed the weight bytes, which happens at
   large batch × context. Halving the larger term saves more time.
   {{< /details >}}

## Sources

- N. Shazeer, [Fast Transformer Decoding: One Write-Head is All You Need](https://arxiv.org/abs/1911.02150), 2019.
- J. Ainslie, J. Lee-Thorp, M. de Jong, Y. Zemlyanskiy, F. Lebrón, S. Sanghai, [GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints](https://arxiv.org/abs/2305.13245), EMNLP 2023.
- H. Touvron et al., [Llama 2: Open Foundation and Fine-Tuned Chat Models](https://arxiv.org/abs/2307.09288), Meta, July 2023 (GQA in the 34B and 70B models).
- A. Grattafiori et al., [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783), Meta, July 2024.
- DeepSeek-AI, [DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model](https://arxiv.org/abs/2405.04434), May 2024 (multi-head latent attention).
- DeepSeek-AI, [DeepSeek-V3 Technical Report](https://arxiv.org/abs/2412.19437), December 2024.
- W. Kwon et al., [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180), SOSP 2023.
- vLLM project, [Optimization and tuning](https://docs.vllm.ai/en/latest/configuration/optimization.html), vLLM documentation (memory sizing and preemption), accessed October 2026.
