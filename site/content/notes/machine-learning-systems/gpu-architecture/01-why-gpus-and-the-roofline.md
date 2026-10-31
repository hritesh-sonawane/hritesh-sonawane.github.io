+++
title = 'Why GPUs, and the roofline'
description = "A GPU spends its transistors on arithmetic and memory bandwidth instead of single-thread latency. The roofline model turns a kernel's FLOPs and bytes into a ceiling on its speed and says which resource is the limit."
question = 'Why do neural networks run on GPUs, and how do you tell whether a kernel is limited by arithmetic or by memory?'
weight = 1
difficulty = 2
prerequisites = []
date = 2026-10-30T03:05:00Z
lastmod = 2026-10-30T03:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

A CPU core is built to finish one instruction stream fast: large caches, branch
prediction, out-of-order execution. A GPU is built to finish a huge number of
independent operations per second, and accepts that each one takes a long time.
Neural networks are mostly matrix multiplications and elementwise operations
over millions of values, which is the second kind of work.

Speed then comes down to two numbers on the spec sheet: **peak FLOP/s** and
**peak memory bandwidth**. The **roofline model** (Williams, Waterman, and
Patterson, 2009) combines them. A kernel's **arithmetic intensity** is its
FLOPs divided by the bytes it moves to and from DRAM. Its attainable
throughput is

`attainable = min(peak FLOP/s, intensity × bandwidth)`

The intensity where the two terms meet is the **ridge point**. On an H100 SXM
in dense BF16 it is about 989 TFLOP/s ÷ 3.35 TB/s ≈ 295 FLOP/byte (NVIDIA
datasheet, as of October 2026). Anything below the ridge is memory-bound, and
buying more FLOPs does nothing for it.

## A picture

```mermaid {title="Roofline: a slanted memory roof meets a flat compute roof at the ridge"}
flowchart LR
  K["<b>Kernel</b><br/><small>FLOPs, bytes</small>"] --> I["<b>Intensity</b><br/><small>FLOPs ÷ bytes</small>"]
  I --> Q{"below ridge<br/><small>295 FLOP/B</small>"}
  Q -->|yes| M["<b>Memory-bound</b><br/><small>time = bytes ÷ 3.35 TB/s</small>"]
  Q -->|no| C["<b>Compute-bound</b><br/><small>time = FLOPs ÷ 989 TFLOP/s</small>"]
  M --> F1["fix: move fewer bytes"]
  C --> F2["fix: cheaper FLOPs"]
  class K,I neutral
  class Q queue
  class M memory
  class C compute
  class F1,F2 good
```

## How it really works

### Where the transistors go

A modern CPU core devotes most of its area to making one thread fast: deep
caches, branch predictors, reorder buffers. That is the right choice when the
next instruction depends on the last. A GPU instead replicates many simple
cores and hides memory latency by **switching between threads** rather than by
caching. The H100 SXM has 132 streaming multiprocessors (SMs), each able to
hold 2,048 resident threads, so about 270,000 threads can be in flight at once
(NVIDIA Hopper architecture whitepaper; CUDA Programming Guide, compute
capability 9.0).

The trade shows up in the numbers. Per chip, a recent server CPU delivers on
the order of a few TFLOP/s of FP32 and a few hundred GB/s of DRAM bandwidth.
An H100 SXM delivers 989 TFLOP/s of dense BF16 on tensor cores and 3.35 TB/s
of HBM3 bandwidth. The GPU wins only when the work has enough independent
operations to keep that machinery fed.

### Why neural networks fit

A transformer layer is dominated by matrix multiplications. For an `M × K` by
`K × N` product, the FLOPs are `2MNK` (one multiply and one add per term), and
the minimum bytes are the three matrices, `2(MK + KN + MN)` in BF16. When all
three dimensions are large, FLOPs grow as the cube and bytes as the square, so
intensity grows with size. Large matmuls clear the ridge; that is the work the
tensor cores were built for.

Everything else in the layer, such as adding a bias, normalization, an
activation function, or a residual add, does a handful of FLOPs per element
and moves every element at least twice. Its intensity is below 1 FLOP/byte.
Those operations sit far down the slanted part of the roof.

### Reading the roofline

The model makes three simplifying assumptions, and you should know them before
using it:

1. Compute and data movement overlap perfectly, so time is the larger of the
   two, not the sum.
2. "Bytes" means DRAM traffic. If caches capture reuse, real traffic is lower
   than a naive count, and intensity is higher.
3. The roofs are peaks. Real kernels reach perhaps 60–80% of peak FLOP/s on
   large matmuls and 80–90% of peak bandwidth on streaming kernels.

The model's value is in the direction it points. If a kernel is memory-bound,
the fix is fewer bytes: fuse operations, use lower precision, reuse data from
on-chip memory. If it is compute-bound, the fix is cheaper FLOPs: tensor cores,
lower precision, or less work. Spending effort on the wrong side is the most
common mistake in GPU performance work.

### The ridge keeps moving right

Each generation has raised FLOP/s faster than bandwidth. The A100 SXM 80 GB
lists 312 TFLOP/s dense BF16 and 2.04 TB/s, a ridge near 153 FLOP/byte. The
H100 SXM's ridge is near 295. FP8 doubles the H100 FLOP figure to 1,979
TFLOP/s dense, and the ridge for FP8 work doubles with it, to about 590.
More kernels become memory-bound with every generation, which is why so much of
modern kernel work is about moving fewer bytes.

> [!NOTE]
> Datasheets often quote tensor-core throughput "with sparsity", which is twice
> the dense figure and applies only to 2:4 structured-sparse weights. Use the
> dense figure for rooflines unless your weights are actually 2:4 sparse.

### Matmul shape decides the side

The batch dimension `M` matters most in inference. A decode step multiplies a
few token vectors (`M` = batch) by large weight matrices. With `M = 1`, the
intensity is about 1 FLOP/byte: every weight byte is read to do one
multiply-add. Raising `M` reuses each weight across more rows, and intensity
grows roughly in proportion to `M` until it reaches the ridge. That is the
whole argument behind batching in serving, worked through in
[why decode is memory-bound](/notes/inference-engineering/inference-mechanics/03-why-decode-is-memory-bound/).

## Code

The program places five kernels on the H100 SXM roofline: an elementwise add,
and matmuls with `K = N = 8192` and growing `M`.

```python {title="roofline.py"}
"""Roofline calculator: where does a kernel sit on an H100 SXM?"""
from dataclasses import dataclass

PEAK_TFLOPS = 989.0   # H100 SXM, dense BF16 tensor core (datasheet)
PEAK_TBPS = 3.35      # H100 SXM, HBM3


@dataclass
class Kernel:
    name: str
    flops: float
    bytes_moved: float

    @property
    def intensity(self) -> float:
        return self.flops / self.bytes_moved


def attainable_tflops(intensity: float) -> float:
    return min(PEAK_TFLOPS, intensity * PEAK_TBPS)


def matmul(m: int, n: int, k: int, elem: int = 2) -> Kernel:
    return Kernel(f"matmul {m}x{k} @ {k}x{n}", 2 * m * n * k,
                  elem * (m * k + k * n + m * n))


def elementwise(n: int, elem: int = 2) -> Kernel:
    return Kernel(f"add {n:,} elems", n, 3 * elem * n)


if __name__ == "__main__":
    ridge = PEAK_TFLOPS / PEAK_TBPS
    print(f"ridge point: {ridge:.0f} FLOP/byte")
    kernels = [elementwise(1 << 24), matmul(1, 8192, 8192),
               matmul(64, 8192, 8192), matmul(256, 8192, 8192),
               matmul(4096, 8192, 8192)]
    print(f"{'kernel':28} {'FLOP/B':>8} {'TFLOP/s':>8} {'bound':>8} {'time us':>9}")
    for k in kernels:
        t = attainable_tflops(k.intensity)
        bound = "memory" if k.intensity < ridge else "compute"
        time_us = k.flops / (t * 1e12) * 1e6
        print(f"{k.name:28} {k.intensity:8.1f} {t:8.1f} {bound:>8} {time_us:9.1f}")
```

```text
$ python3 roofline.py
ridge point: 295 FLOP/byte
kernel                         FLOP/B  TFLOP/s    bound   time us
add 16,777,216 elems              0.2      0.6   memory      30.0
matmul 1x8192 @ 8192x8192         1.0      3.3   memory      40.1
matmul 64x8192 @ 8192x8192       63.0    211.1   memory      40.7
matmul 256x8192 @ 8192x8192     240.9    807.2   memory      42.6
matmul 4096x8192 @ 8192x8192   2048.0    989.0  compute     555.9
```

Three things stand out. The elementwise add and the `M = 1` matmul are hundreds
of times below the ridge. The matmuls with `M` from 1 to 256 all take about
40 µs: they read the same 134 MB of weights, and the extra arithmetic is free
until the ridge. Only at `M = 4096` does compute set the time.

## Where it breaks

- **Caches change the byte count.** The model uses DRAM bytes. A kernel that
  re-reads data hitting the 50 MB L2 has less real traffic than the program
  counts. Hierarchical rooflines (one roof per memory level) handle this.
- **Peaks are not reachable.** Clock throttling under power limits, imperfect
  overlap, and tail effects when the grid does not divide evenly over SMs all
  cut below the roof.
- **Latency-bound kernels sit below both roofs.** A kernel with too little
  parallelism, or one that waits on dependent loads, uses neither resource
  fully. The roofline says it could be faster, not why it is not.
- **Small kernels are dominated by launch overhead.** A kernel that takes a
  few microseconds is limited by fixed costs the model ignores.

## Remember this

- Arithmetic intensity is FLOPs per DRAM byte; compare it with the ridge point.
- H100 SXM dense BF16: 989 TFLOP/s, 3.35 TB/s, ridge about 295 FLOP/byte (as of October 2026).
- Below the ridge, move fewer bytes. Above it, make FLOPs cheaper.
- Large matmuls clear the ridge; elementwise operations and small-batch decode do not.
- Each generation moves the ridge right, so more work becomes memory-bound.

## Try it

1. Change the constants to the A100 SXM (312 TFLOP/s, 2.04 TB/s). Which matmul
   changes from memory-bound to compute-bound?
2. Add an FP8 matmul with `elem = 1` and a peak of 1,979 TFLOP/s. How does the
   `M` needed to reach the ridge change?
3. Model a softmax over a 4096 × 4096 matrix at about 5 FLOPs per element. How
   far below the ridge is it?

## Check yourself

1. A kernel does 10 GFLOP and moves 1 GB on an H100 SXM. What bounds it, and
   what is its best-case time?
   {{< details summary="Show answer" >}}
   Intensity is 10 FLOP/byte, far below the ridge of about 295, so it is
   memory-bound. Best case is 1 GB ÷ 3.35 TB/s ≈ 0.30 ms. The arithmetic alone
   would take about 10 µs.
   {{< /details >}}

2. Why does doubling peak FLOP/s without changing bandwidth not speed up a
   batch-1 decode step?
   {{< details summary="Show answer" >}}
   Batch-1 decode has an intensity near 1 FLOP/byte. Its time is the bytes
   divided by bandwidth. The compute roof is far above it, so raising that roof
   changes nothing.
   {{< /details >}}

3. Why does a matmul's intensity rise as its dimensions grow?
   {{< details summary="Show answer" >}}
   FLOPs scale as `2MNK` while the minimum bytes scale as `MK + KN + MN`. For a
   cube of side `n`, that is `2n³` FLOPs over `6n²` bytes in BF16, so intensity
   grows linearly with `n`.
   {{< /details >}}

## Sources

- Samuel Williams, Andrew Waterman, David Patterson, "Roofline: An Insightful
  Visual Performance Model for Multicore Architectures", *Communications of the
  ACM* 52(4), 2009. <https://doi.org/10.1145/1498765.1498785>
- NVIDIA, *H100 Tensor Core GPU datasheet* and *NVIDIA H100 Tensor Core GPU
  Architecture* whitepaper, 2022. <https://www.nvidia.com/en-us/data-center/h100/>
- NVIDIA, *A100 Tensor Core GPU datasheet*, 2021. <https://www.nvidia.com/en-us/data-center/a100/>
- NVIDIA, *CUDA C++ Programming Guide*, "Compute capabilities".
  <https://docs.nvidia.com/cuda/cuda-c-programming-guide/>
