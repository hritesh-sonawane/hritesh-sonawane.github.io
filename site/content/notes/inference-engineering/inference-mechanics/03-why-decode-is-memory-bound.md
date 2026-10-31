+++
title = 'Why decode is memory-bound'
description = 'A decode step reads every weight and every cached key and value to produce one token per sequence. Batching amortizes the weight reads across users, but each sequence brings its own KV cache, so decode stays memory-bound and throughput saturates long before the tensor cores are busy.'
question = 'Why does generating tokens leave the GPU idle, and how far can batching fix it?'
weight = 3
difficulty = 3
prerequisites = ['/notes/inference-engineering/inference-mechanics/02-kv-cache-math']
date = 2026-10-30T01:15:00Z
lastmod = 2026-10-30T01:15:00Z
verified = 2026-10-30
+++

## The idea in one minute

A kernel is **memory-bound** when it spends longer waiting for bytes than
doing arithmetic on them. The test is **arithmetic intensity**, FLOPs per byte
moved, against the GPU's ridge point: 295 FLOPs per byte for an H100 in BF16.
A decode step for one sequence does about 1 FLOP per byte. It is 300 times
below the ridge.

Batching helps the weight matmuls. Every sequence in the batch reuses the same
weights, so intensity rises roughly with batch size, and at batch 128 the step
produces 60 times as many tokens for about twice the time. Attention does not
benefit. Each sequence reads **its own** KV cache, and each cached element is
used by only the handful of query heads that share it: 4 FLOPs per byte for
Llama-3-8B at any batch size. As batch and context grow, attention's share of
the step grows until it dominates, and throughput flattens.

The consequence to act on: **decode throughput is bought with bytes, not
FLOPs**. Batch as much as memory allows, shrink the bytes ([quantized](/notes/inference-engineering/making-it-cheaper/01-quantization/) weights and
KV, GQA or MLA), or produce more tokens per read ([speculative decoding](/notes/inference-engineering/making-it-cheaper/02-speculative-decoding/)).
Faster arithmetic alone does almost nothing.

## A picture

```mermaid {title="One decode step: shared weight reads, private KV reads"}
flowchart LR
  subgraph HBM["HBM, read every step"]
    W["<b>Weights</b><br/><small>15 GB, shared</small>"]
    K1["KV seq 1"]
    K2["KV seq 2"]
    KB["KV seq B"]
  end
  W -->|"one read, B rows"| M["<b>Weight matmuls</b><br/><small>intensity ≈ B</small>"]
  K1 --> A["<b>Attention</b><br/><small>intensity ≈ group size</small>"]
  K2 --> A
  KB --> A
  M --> O["B new tokens"]
  A --> O
  class W,K1,K2,KB memory
  class M,A compute
  class O neutral
```

## How it really works

### Arithmetic intensity and the roofline

For a matmul of an `M × K` activation with a `K × N` weight in BF16:

```text
FLOPs = 2 · M · K · N
bytes = 2 · (K · N + M · K + M · N)          weights + input + output
intensity ≈ M  when M is much smaller than K and N
```

In decode `M` is the batch size. The roofline model of Williams, Waterman, and
Patterson says attainable throughput is `min(peak FLOP/s, intensity ×
bandwidth)`. At batch 1 that is about 3.35 TFLOP/s of a 989 TFLOP/s GPU. A
4096 × 14336 MLP projection crosses the ridge only near batch 300.

### Why attention does not batch

Per cached token per layer, attention reads one key and one value vector per
KV head (`2 × 128 × 2 = 512` bytes per head). Each of the `G` query heads in the
group does a dot product with the key and a weighted add of the value: 4 FLOPs
per element pair, `4 · G · head_dim` per head. So:

```text
attention intensity ≈ G FLOPs per byte       G = query heads ÷ KV heads
```

For Llama-3-8B, `G = 4`. MHA models sit at 1, MQA at the full head count. The
batch size does not appear, because sequence 2 cannot reuse sequence 1's keys.
This is the deeper reason GQA, MQA, and MLA exist: they raise attention's
intensity as well as shrinking its memory.

### The step-time model

```text
t_step ≈ max(weight FLOPs / peak, weight bytes / BW)
       + max(attn FLOPs / peak, KV bytes / BW)
throughput = B / t_step                      tokens per second, all users
per-user rate = 1 / t_step
```

At small batch the first term is flat at 4.5 ms and throughput grows almost
linearly with `B`. The KV term grows linearly with `B × context` and never
becomes compute-bound. Throughput approaches `BW ÷ (KV bytes per token ×
context)` tokens per second: about 25,000 at 1k context and 3,100 at 8k for
this model, a ceiling no batch size passes.

```mermaid {title="Decode throughput vs batch, Llama-3-8B on one H100 (roofline)"}
xychart-beta
  x-axis "Batch size" ["1", "8", "32", "64", "128", "256"]
  y-axis "Tokens per second, all users" 0 --> 18000
  line [221, 1666, 5553, 9085, 13321, 17371]
  line [208, 1136, 2171, 2561, 2813, 2958]
```

The upper line is 1k context per sequence, the lower 8k. Long context does not
just cost memory; it caps throughput.

### Batching is a latency trade

Throughput rises with batch, but each user's rate falls because every step gets
longer. At 1k context, batch 128 gives 13,300 tokens per second in total and 104
per user; batch 256 gives 17,400 in total but 68 per user. An ITL objective
therefore sets a maximum batch, and memory sets another. Operators choose the
smaller. This is the throughput-latency trade that every scheduler in the next
module negotiates.

### Measuring it in production

- **MFU** (model FLOPs utilization): achieved FLOP/s ÷ peak. Decode MFU in the
  single digits is normal and not a bug.
- **Memory bandwidth utilization**: bytes the step must read ÷ step time ÷ peak
  bandwidth. This is the honest efficiency metric for decode; well-tuned kernels
  get a large fraction of peak at batch sizes where the weights dominate.
- **"GPU utilization" from `nvidia-smi`** reports the fraction of time any
  kernel was running, not how busy the tensor cores or memory system were. A
  memory-bound decode loop can show 100% while using under 1% of peak FLOPs.
- **The clock test.** Lowering SM clocks (`nvidia-smi --lock-gpu-clocks`)
  barely slows a memory-bound kernel and slows a compute-bound one roughly in
  proportion. It is a coarse but tool-free classifier.

### The levers, sorted by which term they shrink

| Lever | Weight term | KV term | Notes |
| --- | --- | --- | --- |
| Larger batch | amortized | grows | bounded by memory and ITL |
| Weight quantization (INT4, FP8) | 2–4× fewer bytes | none | biggest win when weights dominate |
| KV quantization (FP8) | none | 2× fewer bytes | biggest win at long context |
| GQA, MQA, MLA | none | fewer bytes, higher intensity | architecture choice, not a serving flag |
| Speculative decoding | k tokens per read | k tokens per read | wins when compute is spare |
| Tensor parallelism | split across GPUs | split across GPUs | adds communication |
| Faster HBM (H200, B200) | faster | faster | bandwidth, not FLOPs, is what you buy |

## Code

The program models one decode step for Llama-3-8B on an H100, separating the
shared weight matmuls from per-sequence attention. It assumes the two phases
do not overlap and kernels reach peak, so treat the times as lower bounds.

```python {title="decode_roofline.py"}
"""decode_roofline.py: why decode is memory-bound, and what batching does about it.

Roofline model of one decode step for Llama-3-8B (BF16) on an H100 SXM. The
weight matmuls are shared by every sequence in the batch; attention reads each
sequence's own KV cache. Standard library only; runs offline.
"""

from __future__ import annotations

PEAK_FLOPS = 989e12        # dense BF16, H100 SXM datasheet
BANDWIDTH = 3.35e12        # HBM3 bytes/s
LAYERS, D, HEADS, KV_HEADS, HEAD_DIM, D_FF, VOCAB = 32, 4096, 32, 8, 128, 14336, 128256
BYTES = 2


def gemm_intensity(rows: int, k: int, n: int) -> float:
    """FLOPs per byte for (rows x k) @ (k x n) in BF16, counting inputs and output."""
    flops = 2 * rows * k * n
    nbytes = BYTES * (k * n + rows * k + rows * n)
    return flops / nbytes


def step(batch: int, context: int) -> dict[str, float]:
    kv = KV_HEADS * HEAD_DIM
    weights = LAYERS * (D * (2 * D + 2 * kv) + 3 * D * D_FF) + VOCAB * D
    w_flops = 2 * weights * batch
    w_bytes = weights * BYTES
    # Attention: each cached K and V element is read once and used by the
    # HEADS / KV_HEADS query heads that share it (GQA group), 2 FLOPs each.
    a_bytes = 2 * LAYERS * kv * BYTES * context * batch
    a_flops = 4 * LAYERS * HEADS * HEAD_DIM * context * batch
    t_w = max(w_flops / PEAK_FLOPS, w_bytes / BANDWIDTH)
    t_a = max(a_flops / PEAK_FLOPS, a_bytes / BANDWIDTH)
    t = t_w + t_a  # simplification: the two phases do not overlap
    return {"t": t, "tok_s": batch / t, "attn_share": t_a / t,
            "intensity": (w_flops + a_flops) / (w_bytes + a_bytes),
            "mfu": (w_flops + a_flops) / t / PEAK_FLOPS, "kv_gb": a_bytes / 1e9}


def main() -> None:
    ridge = PEAK_FLOPS / BANDWIDTH
    print(f"ridge point: {ridge:.0f} FLOP/byte\n")
    print("one MLP up-projection (4096 x 14336) with B rows")
    for b in (1, 8, 64, 256, 1024):
        i = gemm_intensity(b, D, D_FF)
        print(f"  B={b:>4}: {i:7.1f} FLOP/byte -> {'compute' if i > ridge else 'memory'}-bound")
    print(f"  attention over a cached token: {HEADS // KV_HEADS} FLOP/byte at any batch"
          " (each sequence has its own KV)\n")

    for ctx in (1024, 8192):
        print(f"decode step, context {ctx} tokens per sequence")
        print(f"{'batch':>6}{'step ms':>9}{'tok/s':>9}{'per user':>10}{'attn %':>8}"
              f"{'FLOP/B':>8}{'MFU %':>7}{'KV GB':>7}")
        for b in (1, 8, 32, 64, 128, 256):
            r = step(b, ctx)
            print(f"{b:>6}{r['t'] * 1e3:>9.2f}{r['tok_s']:>9.0f}{1 / r['t']:>10.0f}"
                  f"{100 * r['attn_share']:>8.0f}{r['intensity']:>8.1f}{100 * r['mfu']:>7.1f}"
                  f"{r['kv_gb']:>7.0f}" + ("" if r["kv_gb"] < 52 else "  over budget"))
        print()


if __name__ == "__main__":
    main()
```

Run it with `python3 decode_roofline.py`:

```text
ridge point: 295 FLOP/byte

one MLP up-projection (4096 x 14336) with B rows
  B=   1:     1.0 FLOP/byte -> memory-bound
  B=   8:     8.0 FLOP/byte -> memory-bound
  B=  64:    62.7 FLOP/byte -> memory-bound
  B= 256:   237.0 FLOP/byte -> memory-bound
  B=1024:   774.9 FLOP/byte -> compute-bound
  attention over a cached token: 4 FLOP/byte at any batch (each sequence has its own KV)

decode step, context 1024 tokens per sequence
 batch  step ms    tok/s  per user  attn %  FLOP/B  MFU %  KV GB
     1     4.52      221       221       1     1.0    0.3      0
     8     4.80     1666       208       7     7.7    2.6      1
    32     5.76     5553       174      22    25.8    8.7      4
    64     7.04     9085       142      36    42.2   14.3      9
   128     9.61    13321       104      53    61.8   20.9     17
   256    14.74    17371        68      70    80.6   27.3     34

decode step, context 8192 tokens per sequence
 batch  step ms    tok/s  per user  attn %  FLOP/B  MFU %  KV GB
     1     4.80      208       208       7     1.2    0.4      1
     8     7.04     1136       142      36     6.5    2.2      9
    32    14.74     2171        68      70    12.5    4.2     34
    64    24.99     2561        40      82    14.8    5.0     69  over budget
   128    45.51     2813        22      90    16.2    5.5    137  over budget
   256    86.53     2958        12      95    17.0    5.8    275  over budget
```

The first table shows the weight matmuls crossing the ridge only past batch
256. In the step tables, MFU never reaches 30%, and at 8k context it stalls
near 6% because attention takes 70 to 95% of the step. Batch 64 and above at
8k does not even fit on one 80 GB GPU; about 48 sequences do, so the real
ceiling there is between 2,200 and 2,600 tokens per second.

## Where it breaks

- **Peak numbers flatter the model.** Real kernels lose bandwidth to launch
  overhead, small tiles, and synchronization, especially at batch 1. Use the
  model for shape, a profiler for constants.
- **Phases overlap in practice.** Fused kernels and CUDA graphs hide some of
  the gaps the sum assumes, and add others (sampling, CPU scheduling).
- **Prefill in the same step changes everything.** A mixed batch with prefill
  tokens is compute-heavy, which is why [chunked prefill](/notes/inference-engineering/batching-and-scheduling/03-chunked-prefill-and-priority/) can fill decode's idle
  tensor cores, covered in the next module.
- **Mixture-of-experts shifts the picture.** Weight bytes per step depend on how
  many experts the batch touches, so a larger batch can increase weight reads.
- **Very large batches do become compute-bound** for the weight term, and then
  FP8 tensor-core throughput matters again.

## Remember this

- Intensity = FLOPs ÷ bytes; below the ridge (295 for H100 BF16), memory binds.
- Weight matmuls in decode have intensity about equal to the batch size.
- Attention intensity is about the GQA group size, independent of batch.
- Throughput saturates at bandwidth ÷ (KV bytes per token × context).
- Bigger batches raise throughput and lower per-user speed; an ITL target caps
  the batch.
- Low MFU in decode is expected; measure bandwidth utilization instead.

## Try it

1. Set `KV_HEADS = 32` (an MHA model of the same size). How do the attention
   share and the saturation throughput at 8k change?
2. Halve the KV bytes (FP8 KV) and rerun. Which batch sizes gain most?
3. Swap in H200 bandwidth (4.8 TB/s, same FLOPs). Which numbers move and which
   do not?
4. Given an ITL objective of 25 ms at 1k context, what is the largest batch the
   model allows, and what throughput does it give?

## Check yourself

1. Why does batching raise the intensity of the weight matmuls but not of
   attention?

   {{< details summary="Show answer" >}}
   All sequences multiply by the same weights, so one read of each weight
   serves B rows. Each sequence attends over its own cached keys and values,
   so there is nothing to share across the batch; only the query heads within
   one GQA group reuse a cached element.
   {{< /details >}}

2. What is attention's arithmetic intensity in decode for a model with 64
   query heads and 8 KV heads?

   {{< details summary="Show answer" >}}
   About 8 FLOPs per byte, the group size of 64 ÷ 8, regardless of batch size or
   context length.
   {{< /details >}}

3. A dashboard shows 100% GPU utilization during decode. Is the GPU saturated?

   {{< details summary="Show answer" >}}
   Not necessarily. That metric reports the fraction of time a kernel was
   running. A memory-bound decode loop runs kernels continuously while using a
   few percent of peak FLOPs. Check bandwidth utilization or MFU.
   {{< /details >}}

4. Why does throughput flatten at long context even when memory is available
   for more sequences?

   {{< details summary="Show answer" >}}
   Each added sequence adds its whole KV cache to every step's reads. Once KV
   reads dominate, step time grows in proportion to batch size, so tokens per
   second stops rising. The ceiling is bandwidth ÷ (KV bytes per token ×
   context).
   {{< /details >}}

## Sources

- S. Williams, A. Waterman, D. Patterson, "Roofline: An Insightful Visual Performance Model for Multicore Architectures", *Communications of the ACM* 52(4), 2009.
- R. Pope et al., [Efficiently Scaling Transformer Inference](https://arxiv.org/abs/2211.05102), MLSys 2023.
- J. Ainslie et al., [GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints](https://arxiv.org/abs/2305.13245), EMNLP 2023.
- T. Dao, D. Haziza, F. Massa, G. Sizov, [Flash-Decoding for long-context inference](https://crfm.stanford.edu/2023/10/12/flashdecoding.html), Stanford CRFM, October 2023.
- NVIDIA, [H100 Tensor Core GPU datasheet](https://www.nvidia.com/en-us/data-center/h100/) and [H200](https://www.nvidia.com/en-us/data-center/h200/) product page (4.8 TB/s HBM3e).
- NVIDIA, [nvidia-smi documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html) (definition of utilization.gpu).
