+++
title = 'Data pipelines'
description = 'Keep accelerators fed: storage reads, CPU decode, prefetch, and sharding sized against step time; shuffle quality from shard order and buffers; deterministic, resumable iteration across thousands of ranks.'
question = 'How fast must the input pipeline be, and how do you shuffle and resume a dataset that is too large to hold?'
weight = 1
difficulty = 3
prerequisites = ['/notes/systems-design/ai-infrastructure/02-a-data-platform']
date = 2026-10-30T05:05:00Z
lastmod = 2026-10-30T05:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

A GPU step takes a fixed amount of time. If the next batch is not ready when
the step ends, the GPU waits, and every other GPU in the job waits with it,
because data-parallel training is synchronous. The input pipeline is a
producer that must sustain **batch size divided by step time** samples per
second per rank, with headroom for jitter.

The pipeline has three costs: reading bytes from storage, turning them into
tensors on the CPU (decompress, decode, tokenize, pack), and copying them to the
GPU. Parallel workers and prefetching hide the first two behind the current
step. Pre-tokenizing and packing offline removes most of the second.

Two correctness properties matter as much as speed. **Shuffling**: a dataset
of trillions of tokens cannot be permuted in memory, so randomness comes from
shard order plus a bounded shuffle buffer, and a small buffer leaves strong
locality. **Determinism and resumption**: after a failure the job must restart
at exactly the sample it stopped at, on every rank, without replaying or
skipping data.

## A picture

```mermaid {title="Per-rank input pipeline: shards to a pinned-memory prefetch queue"}
flowchart LR
  S[("<b>Object store</b><br/><small>pre-tokenized shards</small>")] --> R["<b>Shard reader</b><br/><small>rank r reads shards r, r+W, ...</small>"]
  R --> W1["<b>Worker 1</b><br/><small>decode, pack</small>"]
  R --> W2["<b>Worker k</b><br/><small>decode, pack</small>"]
  W1 --> B["<b>Shuffle buffer</b><br/><small>bounded</small>"]
  W2 --> B
  B --> Q["<b>Prefetch queue</b><br/><small>pinned host memory</small>"]
  Q --> G["<b>GPU step</b><br/><small>async H2D copy</small>"]
  class S io
  class R,W1,W2 compute
  class B,Q queue
  class G compute
```

## How it really works

### Size the producer against the step

Take a step of 250 ms with a per-rank batch of 128 sequences. The rank needs
512 samples per second. If one worker spends 4 ms reading and 6 ms decoding a
sample, it produces 100 per second, so at least six workers are needed and
eight gives headroom for slow reads. The program below shows the cliff: below
the threshold GPU utilization falls linearly with worker count.

Real numbers come from measurement. Profile the loader alone (iterate it with
no model) and compare its rate to the training step rate. In PyTorch the knobs
are `num_workers`, `prefetch_factor`, `pin_memory`, and `persistent_workers` on
`DataLoader`. Pinned (page-locked) host memory lets the copy to the GPU run as
an asynchronous DMA that overlaps compute.

### Move work offline

Language-model pretraining usually tokenizes once, writes fixed-length packed
sequences to binary shards, and reads them with memory mapping or large
sequential reads. Packing concatenates documents with separator tokens so no
compute is spent on padding. Per-step CPU work then becomes almost a memory
copy, and the bottleneck moves to storage bandwidth.

Storage arithmetic: 16,384 GPUs, each consuming 128 sequences of 8,192 tokens
at 2 bytes per token every 10 seconds, read about 3.4 GB/s in aggregate. That is
modest for a parallel file system. Image and video pipelines are different:
decoding is expensive, so they need many CPU cores per GPU or GPU decoding.

### Shuffle from shards and a buffer

A full random permutation of a corpus needs random access to every sample.
Instead pipelines combine three levels:

1. Shuffle the **order of shards** each epoch with a seeded generator.
2. Assign shards to ranks so each rank reads a disjoint subset.
3. Within a rank, pass samples through a **shuffle buffer** of size *B*: fill
   it, emit a random element, insert the next one.

A buffer of size *B* can only move a sample about *B* positions. If a shard
holds one source (all code, all one language), a small buffer produces
batches dominated by that source, and loss curves show it as periodic bumps.
The fix is to write shards that are already mixed, interleave several shards
per worker, and size the buffer to cover several shards' worth of samples.

### Deterministic resumption

After a restart, each rank must know which shard and offset it was reading and
the state of its random generators. Two common designs:

- **Stateless indexing.** Derive the sample for (epoch, global step, rank) from
  a seeded permutation, so resuming needs only the step count.
- **Checkpointed iterator state.** Save shard position, buffer contents or
  seed, and generator state with the model checkpoint. PyTorch's
  `torchdata` `StatefulDataLoader` exposes `state_dict()` for this.

Changing the number of data-parallel ranks on restart changes how shards map
to ranks; stateless indexing over a global sample order handles that more
cleanly than per-rank iterator state.

### Mixtures and curricula

Pretraining data is a weighted mixture of sources. Weights are applied by
sampling sources in proportion, not by concatenating them, and they are
often changed during training (Llama 3 increased high-quality data near the
end of pretraining). The mixture schedule is part of the run's configuration
and must be checkpointed with it.

## Code

The program computes GPU busy fraction for a range of worker counts, then
measures how far a shuffle buffer moves samples from their original order.
Mean displacement for a full shuffle is about *n*/3.

```python {title="loader.py"}
"""Data-loader throughput and shuffle quality, simulated with arithmetic."""
from dataclasses import dataclass
import random


@dataclass
class Loader:
    workers: int
    read_ms: float      # storage read per sample
    decode_ms: float    # CPU decode/tokenize per sample
    step_ms: float      # GPU time per step
    batch: int

    def samples_per_s(self) -> float:
        return self.workers * 1000.0 / (self.read_ms + self.decode_ms)

    def gpu_util(self) -> float:
        need = self.batch * 1000.0 / self.step_ms
        return min(1.0, self.samples_per_s() / need)


def shuffle_buffer(stream: list[int], size: int, rng: random.Random) -> list[int]:
    buf, out = [], []
    for x in stream:
        buf.append(x)
        if len(buf) >= size:
            out.append(buf.pop(rng.randrange(len(buf))))
    rng.shuffle(buf)
    return out + buf


def mean_displacement(order: list[int]) -> float:
    return sum(abs(i - x) for i, x in enumerate(order)) / len(order)


if __name__ == "__main__":
    print("workers  samples/s  GPU busy")
    for w in (2, 4, 8, 16):
        ld = Loader(workers=w, read_ms=4.0, decode_ms=6.0, step_ms=250.0, batch=128)
        print(f"{w:7d}  {ld.samples_per_s():9.0f}  {ld.gpu_util():7.0%}")
    rng = random.Random(0)
    n = 100_000
    # Stream arrives sorted by source shard: the worst case for a buffer.
    stream = list(range(n))
    print("\nbuffer   mean displacement  (full shuffle ~ n/3 =", n // 3, ")")
    for size in (1, 1_000, 10_000, 100_000):
        print(f"{size:6d}   {mean_displacement(shuffle_buffer(stream, size, rng)):17.0f}")
```

Run it with `python3 loader.py`:

```text
workers  samples/s  GPU busy
      2        200      39%
      4        400      78%
      8        800     100%
     16       1600     100%

buffer   mean displacement  (full shuffle ~ n/3 = 33333 )
     1                   0
  1000                 732
 10000                6939
100000               33358
```

Eight workers saturate the GPU; more add nothing. A buffer of 1,000 moves the
average sample 732 positions out of 100,000, so neighbors in a shard stay
neighbors in training. Only a buffer the size of the data gives a real
shuffle, which is why mixing happens when shards are written.

## Where it breaks

- **Tail latency, not mean.** A loader that averages fast enough still stalls
  the job if one rank hits a slow object read. Synchronous training waits for
  the slowest rank. Prefetch depth must cover the tail.
- **Host memory.** Many workers each holding prefetch buffers and a shuffle
  buffer can exhaust host RAM on an 8-GPU node and invoke the OOM killer.
- **Silent duplication.** A resume bug that replays a few thousand steps of
  data does not crash; it slightly overfits that data. Log a hash of sample IDs
  per step to catch it.
- **The simulation** treats per-sample costs as constant. Real loaders contend
  for CPU, page cache, and network.

## Remember this

- Required rate per rank is batch size divided by step time; measure the loader alone.
- Pre-tokenize and pack offline so per-step CPU work is a copy.
- Shuffle quality comes from shard mixing; a buffer only moves samples by its size.
- Data position and RNG state are part of the checkpoint.
- Synchronous training waits for the slowest rank's loader.

## Try it

1. Set `decode_ms` to 30 (image decoding) and find the worker count for full utilization.
2. Change the stream so it is 10 interleaved sorted shards and compare displacement with buffer 1,000.
3. Add a lognormal read time and report the 99th-percentile wait per step for prefetch depth 1 and 4.

## Check yourself

1. Why does one slow loader slow the whole job?

   {{< details summary="Show answer" >}}
   Data-parallel training synchronizes gradients every step, so every rank
   waits for the slowest rank to finish its forward and backward pass, and that
   rank cannot start until its batch arrives.
   {{< /details >}}

2. What does a shuffle buffer of size *B* guarantee, and what does it not?

   {{< details summary="Show answer" >}}
   It randomizes order locally: a sample can move roughly *B* positions. It
   does not mix samples from far-apart parts of the stream, so shard-level
   structure survives unless shards are mixed when written.
   {{< /details >}}

3. Why is stateless indexing easier to resume when the world size changes?

   {{< details summary="Show answer" >}}
   The sample for each global step is a function of the seed and step, so the
   new set of ranks can recompute their share. Per-rank iterator state is tied
   to the old rank-to-shard mapping.
   {{< /details >}}

## Sources

- PyTorch documentation, "torch.utils.data" (DataLoader, pinned memory, workers). https://pytorch.org/docs/stable/data.html
- Llama Team, Meta. "The Llama 3 Herd of Models." arXiv:2407.21783, July 2024 (data mix and annealing). https://arxiv.org/abs/2407.21783
- Shoeybi et al. "Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism." arXiv:1909.08053, 2019. https://arxiv.org/abs/1909.08053
