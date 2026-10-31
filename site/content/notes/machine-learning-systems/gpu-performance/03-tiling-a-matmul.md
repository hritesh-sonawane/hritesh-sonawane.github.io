+++
title = 'Tiling a matmul'
description = 'A naive matmul reads each input element N times from memory. Tiling through shared memory and registers cuts that to N divided by the tile size, which is what moves a matmul from memory-bound to compute-bound.'
question = 'How does a matmul kernel turn a memory-bound loop into one that keeps tensor cores busy?'
weight = 3
difficulty = 4
prerequisites = ['/notes/machine-learning-systems/gpu-performance/02-coalescing-and-occupancy', '/notes/machine-learning-systems/gpu-architecture/04-tensor-cores-and-number-formats']
date = 2026-10-30T04:15:00Z
lastmod = 2026-10-30T04:15:00Z
verified = 2026-10-30
+++

## The idea in one minute

`C = A × B` for `N × N` matrices does `2N³` FLOPs on `3N²` elements. In
principle that is plenty of reuse: each element of `A` is used `N` times. A
naive kernel, one thread per output reading a row of `A` and a column of `B`
from global memory, throws the reuse away and reads `2N³` elements.

**Tiling** recovers it. A block computes a `T × T` tile of `C`. It walks along
`K` in steps, loading a `T × T` tile of `A` and of `B` into shared memory each
step, and every thread reuses those tiles `T` times from fast memory. Each
input element is now read from global memory `N / T` times instead of `N`.
Arithmetic intensity rises by a factor of `T`. With large enough tiles, the
kernel crosses the ridge and becomes compute-bound.

## A picture

```mermaid {title="One block computes a C tile by streaming A and B tiles along K"}
flowchart LR
  A["<b>A strip</b><br/><small>T rows × N</small>"] -->|"T×T tile per step"| S["<b>Shared memory</b><br/><small>A tile + B tile</small>"]
  B["<b>B strip</b><br/><small>N × T columns</small>"] -->|"T×T tile per step"| S
  S -->|"reused T times"| R["<b>Registers</b><br/><small>accumulators for C tile</small>"]
  R -->|"after N/T steps"| C["<b>C tile</b><br/><small>written once</small>"]
  class A,B memory
  class S memory
  class R compute
  class C io
```

## How it really works

### Counting traffic

For square `N × N` matrices with square tiles of side `T`:

- There are `(N/T)²` output tiles. Each reads a `T × N` strip of `A` and an
  `N × T` strip of `B`: `2TN` elements.
- Total reads: `(N/T)² × 2TN = 2N³ / T` elements. Writes: `N²`.
- Intensity in BF16: `2N³ FLOPs / (2 bytes × 2N³/T) = T / 2` FLOP per byte,
  ignoring the writes.

So a 128 × 128 tile gives about 64 FLOP/byte against HBM, and the ridge on
H100 is about 295. One level of tiling is not enough on its own; real kernels
tile at several levels and lean on L2.

### The levels of tiling

High-performance kernels (CUTLASS, cuBLAS, Triton-generated code) tile three or
four times:

1. **Block tile** in shared memory, such as 128 × 256 × 64. Larger and
   rectangular tiles raise reuse per byte loaded.
2. **Warp tile**: each warp owns a sub-tile of the block's output.
3. **Thread or instruction tile**: each thread (or tensor-core instruction)
   holds a fragment of accumulators in registers, so operands loaded from shared
   memory are reused across several multiply-adds.
4. **L2 and cluster reuse**: tiles are launched in an order (often a "swizzled"
   or grouped order) so that neighboring blocks share `A` rows and `B` columns
   while those are still in L2. On Hopper, thread block clusters can multicast a
   tile from HBM to several SMs.

The block-tile counts are from HBM's point of view if nothing hits L2. With a
good launch order, much of the repeated strip traffic is served by the 50 MB
L2, and HBM traffic approaches the minimum `3N²` elements.

### Pipelining

A tile loop that loads, synchronizes, computes, and repeats leaves the tensor
cores idle during each load. Production kernels **double- or multi-buffer**:
while computing on stage `k`, they asynchronously load stage `k+1` (with
`cp.async` on Ampere or the TMA on Hopper). On Hopper, kernels are often
**warp-specialized**: some warps only issue TMA loads, others only issue
`wgmma`, synchronized with shared-memory barriers.

```mermaid {title="Multi-stage pipeline: load the next tile while computing this one"}
sequenceDiagram
  autonumber
  participant P as Producer warps (TMA)
  participant SM as Shared memory stages
  participant C as Consumer warps (wgmma)
  P->>SM: load tile k into stage 0
  P->>SM: load tile k+1 into stage 1
  C->>SM: wait stage 0 ready
  C->>C: MMA on tile k
  P->>SM: load tile k+2 into stage 0
  C->>SM: wait stage 1 ready
  C->>C: MMA on tile k+1
```

### Shared memory sets the ceiling

Bigger tiles mean more reuse but more shared memory and registers per block.
Two BF16 tiles of 128 × 128 take 64 KB; with three pipeline stages, that is
192 KB, nearly the H100's 228 KB. This is the main reason tile shapes are a
search problem and libraries ship many kernel variants per shape.

## Code

The program first checks that a tiled loop produces the same result as the
naive one on a 32 × 32 case, counting element loads, then counts HBM traffic
for an 8192 × 8192 BF16 matmul at several tile sizes on H100 bandwidth.

```python {title="tiled_matmul.py"}
"""Count global-memory traffic for naive vs tiled matmul C = A @ B (N x N).

Each output tile of T x T loads a T-wide strip of A and of B through shared
memory, so every element of A and B is read N / T times instead of N times.
We also check the tiled result is numerically identical on a small case.
"""
import random

ELEM = 2  # bytes, BF16


def traffic(n: int, tile: int) -> int:
    reads = 2 * n * n * (n // tile)       # A and B, each re-read n/tile times
    writes = n * n
    return (reads + writes) * ELEM


def tiled_matmul(a, b, n, t):
    c = [[0.0] * n for _ in range(n)]
    loads = 0
    for bi in range(0, n, t):
        for bj in range(0, n, t):
            for bk in range(0, n, t):           # one shared-memory tile pair
                loads += 2 * t * t
                for i in range(bi, bi + t):
                    for j in range(bj, bj + t):
                        c[i][j] += sum(a[i][k] * b[k][j] for k in range(bk, bk + t))
    return c, loads


if __name__ == "__main__":
    random.seed(1)
    n = 32
    a = [[random.random() for _ in range(n)] for _ in range(n)]
    b = [[random.random() for _ in range(n)] for _ in range(n)]
    ref = [[sum(a[i][k] * b[k][j] for k in range(n)) for j in range(n)] for i in range(n)]
    for t in (1, 4, 16):
        c, loads = tiled_matmul(a, b, n, t)
        err = max(abs(c[i][j] - ref[i][j]) for i in range(n) for j in range(n))
        print(f"n={n} tile={t:>2}: element loads={loads:>7,}  max error={err:.1e}")

    n = 8192
    flops = 2 * n ** 3
    print(f"\nN={n} BF16, {flops / 1e12:.1f} TFLOP")
    print(f"{'tile':>5} {'traffic GB':>11} {'FLOP/B':>8} {'HBM time ms':>12} {'compute ms':>11}")
    for t in (1, 16, 32, 64, 128, 256):
        tb = traffic(n, t)
        print(f"{t:>5} {tb / 1e9:11.1f} {flops / tb:8.1f} {tb / 3.35e12 * 1e3:12.2f} "
              f"{flops / 989e12 * 1e3:11.2f}")
    for t in (64, 128):
        smem = 2 * t * t * ELEM
        print(f"tile {t}: A+B tiles need {smem // 1024} KiB shared memory per block")
```

```text
$ python3 tiled_matmul.py
n=32 tile= 1: element loads= 65,536  max error=3.6e-15
n=32 tile= 4: element loads= 16,384  max error=1.8e-15
n=32 tile=16: element loads=  4,096  max error=1.8e-15

N=8192 BF16, 1.1 TFLOP
 tile  traffic GB   FLOP/B  HBM time ms  compute ms
    1      2199.2      0.5       656.46        1.11
   16       137.6      8.0        41.07        1.11
   32        68.9     16.0        20.55        1.11
   64        34.5     31.9        10.30        1.11
  128        17.3     63.5         5.17        1.11
  256         8.7    126.0         2.60        1.11
tile 64: A+B tiles need 16 KiB shared memory per block
tile 128: A+B tiles need 64 KiB shared memory per block
```

The naive kernel would move 2.2 TB and take 656 ms if every read went to HBM.
At tile 256 the traffic is 8.7 GB and the HBM time is 2.6 ms, still above the
1.1 ms of compute. The rest of the gap is closed by L2 reuse and rectangular
tiles. In practice cuBLAS runs this shape at a large fraction of peak.

## Where it breaks

- **The traffic model ignores caches.** A naive kernel is not really 600 times
  slower, because L1 and L2 catch much of the reuse. The model shows why
  explicit tiling is needed to make reuse reliable, not the exact naive time.
- **Small or skinny shapes.** When `M` is small (decode), there is little reuse
  to recover; tiling does not change that the kernel is memory-bound. Split-K
  and stream-K schedules help keep all SMs busy in those shapes.
- **Edge tiles.** When dimensions are not multiples of the tile, edge blocks do
  partial work; padding or predicated loads are needed.
- **Numerical order changes.** Tiling changes the order of additions, so
  results differ from a naive loop in the last bits (the program shows errors
  of about 10⁻¹⁵ in Python floats).

## Remember this

- A naive matmul reads each input element `N` times; tiling cuts that to `N / T`.
- Intensity against HBM rises with tile size, about `T / 2` FLOP/byte in BF16 for square tiles.
- Real kernels tile at block, warp, and register level and order blocks for L2 reuse.
- Multi-stage pipelines overlap loads with tensor-core work.
- Shared memory and registers limit tile size; that is why libraries autotune.

## Try it

1. Add a `traffic_rect(n, tm, tn)` for rectangular `tm × tn` tiles and compare
   128 × 256 with 181 × 181 (similar area).
2. Compute the intensity of a decode matmul (`M = 8, N = K = 8192`) with
   `T = 128`. Does tiling help?
3. With three stages of 128 × 64 BF16 tiles for `A` and 64 × 256 for `B`, how
   much shared memory does a block need?

## Check yourself

1. Why does tiling raise arithmetic intensity without changing the FLOP count?
   {{< details summary="Show answer" >}}
   It changes how often each input byte is fetched from slow memory. The same
   multiply-adds happen, but each loaded element is reused `T` times from shared
   memory or registers, so DRAM bytes fall by a factor of `T`.
   {{< /details >}}

2. What does a second pipeline stage buy?
   {{< details summary="Show answer" >}}
   The load of the next tile overlaps with computation on the current one, so
   tensor cores are not idle waiting on memory. It costs another tile's worth of
   shared memory.
   {{< /details >}}

3. Why is launch order of blocks part of matmul performance?
   {{< details summary="Show answer" >}}
   Blocks computing neighboring output tiles read the same rows of `A` or
   columns of `B`. If they run at about the same time, the second read hits L2
   instead of HBM.
   {{< /details >}}

## Sources

- NVIDIA, *CUDA C++ Programming Guide*, "Shared memory" (matrix multiplication
  example) and "Asynchronous data copies".
  <https://docs.nvidia.com/cuda/cuda-c-programming-guide/>
- NVIDIA, *CUTLASS documentation*, "Efficient GEMM in CUDA".
  <https://github.com/NVIDIA/cutlass/blob/main/media/docs/efficient_gemm.md>
- NVIDIA, *NVIDIA H100 Tensor Core GPU Architecture* whitepaper (TMA, thread
  block clusters), 2022. <https://resources.nvidia.com/en-us-tensor-core>
- Muhammad Osama et al., "Stream-K: Work-centric Parallel Decomposition for
  Dense Matrix-Matrix Multiplication on the GPU", 2023.
  <https://arxiv.org/abs/2301.03598>
