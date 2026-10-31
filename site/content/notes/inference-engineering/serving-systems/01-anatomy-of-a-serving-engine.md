+++
title = 'Anatomy of a serving engine'
description = 'Every large-model serving engine has the same six parts, split across processes so that CPU work never stalls the GPU. The KV cache manager, not the model, decides how many requests run.'
question = 'What are the parts of a serving engine, which one limits capacity, and why do engines split them across processes?'
weight = 1
difficulty = 3
prerequisites = ['/notes/inference-engineering/batching-and-scheduling/01-continuous-batching']
date = 2026-10-30T04:05:00Z
lastmod = 2026-10-30T04:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

A serving engine turns a stream of HTTP requests into a stream of GPU forward
passes. Six components do the work: a **front end** (HTTP, chat template,
tokenizer), a **scheduler** that decides once per step which tokens of which
requests run, a **KV cache manager** that owns the memory every running
request needs, an **executor** that drives one or more GPUs, a **sampler**
that turns logits into token IDs, and a **detokenizer** that turns token IDs
back into text and streams it.

Two facts shape the whole design. First, the engine runs a loop: schedule,
run, sample, update, once per output token, for every request at once. Any
CPU work inside that loop is time the GPU waits. Second, admission is a
memory decision: a request can run only if the KV cache manager can give it
blocks. The consequence to act on: **keep tokenizing, detokenizing, and
network I/O out of the engine loop, and size and monitor the KV cache as the
capacity of the server**.

## A picture

```mermaid {title="The six components and the process boundaries between them"}
flowchart LR
  C["<b>Client</b>"] -->|"HTTP + JSON"| FE
  subgraph P1["Front-end process"]
    FE["<b>API server</b><br/><small>validate, chat template, tokenize</small>"]
    DT["<b>Detokenizer + stream</b><br/><small>incremental text, SSE</small>"]
  end
  subgraph P2["Engine process"]
    S["<b>Scheduler</b><br/><small>token budget, queues</small>"]
    KV[("<b>KV cache manager</b><br/><small>blocks, prefix cache</small>")]
    S <--> KV
  end
  subgraph P3["GPU worker processes"]
    EX["<b>Executor / model runner</b><br/><small>batch tensors, forward pass</small>"]
    SM["<b>Sampler</b><br/><small>logits to token IDs</small>"]
    EX --> SM
  end
  FE -->|"token IDs"| S
  S -->|"step plan"| EX
  SM -->|"new token IDs"| S
  S -->|"token IDs per request"| DT
  DT -->|"server-sent events"| C
  class C neutral
  class FE,DT io
  class S queue
  class KV memory
  class EX,SM compute
```

## How it really works

### Six components, three rates

The easiest way to understand an engine is by how often each part runs.

| Component | Owns | Runs |
| --- | --- | --- |
| Front end | Connections, validation, chat template, tokenizer | Once per request |
| Scheduler | Waiting and running queues, per-step token budget | Once per step |
| KV cache manager | The block pool, per-request block tables, prefix cache | Once per step, per request |
| Executor | Weights, KV tensors, CUDA graphs, parallel ranks | Once per step |
| Sampler | Temperature, top-k/top-p, penalties, grammar masks | Once per step, on the GPU |
| Detokenizer and stream | Per-request decode state, stop strings, SSE framing | Once per output token, per request |

A 500-token answer costs one tokenization, then 500 trips around the
schedule-run-sample-update loop, then 500 detokenize-and-send operations.
The per-token parts dominate CPU cost. The per-request parts dominate time to
first token only for very long prompts.

### The loop

Iteration-level scheduling, introduced by the Orca paper (OSDI 2022), is the
loop every current engine runs. Requests join and leave the batch at every
step instead of waiting for a whole batch to finish:

```text
while there is work:
    plan   = scheduler.schedule()        # which requests, how many tokens each
    batch  = runner.prepare(plan)        # flat token IDs, positions, block tables
    logits = model.forward(batch)        # one GPU forward pass
    tokens = sampler.sample(logits)      # one token per request that finished its prompt
    scheduler.update(tokens)             # append, check stop, free finished requests
    stream(tokens)                       # hand new token IDs to the detokenizer
```

The scheduler does not need separate [prefill and decode](/notes/inference-engineering/inference-mechanics/01-prefill-and-decode/) phases. A request
with 3,000 prompt tokens not yet computed gets as many as the step's budget
allows; a request that is generating gets exactly one. [Chunked prefill](/notes/inference-engineering/batching-and-scheduling/03-chunked-prefill-and-priority/) is the
same operation with a cap (Sarathi-Serve, OSDI 2024, measured why mixing them
helps: decode leaves compute idle, prefill fills it).

```mermaid {title="One engine step, with the front end in its own process"}
sequenceDiagram
  autonumber
  participant F as Front end
  participant S as Scheduler + KV manager
  participant G as GPU workers
  F->>S: new request (token IDs)
  S->>S: schedule: running first, then admit waiting
  S->>G: step plan (tokens per request, block tables)
  G->>G: forward pass, sample
  G-->>S: one token ID per finished-prompt request
  S->>S: append, check stop, free finished
  S-->>F: new token IDs per request
  F->>F: detokenize, stream SSE (overlaps the next step)
```

### Why the front end is a separate process

Engines written in Python run their loop under the global interpreter lock.
If the HTTP server, the tokenizer, and the engine loop share one interpreter,
every millisecond spent tokenizing a 100,000-token document is a millisecond
in which no step is scheduled and the GPU idles. vLLM's V1 rewrite (announced
January 2025) moved the API server and the engine core into separate
processes connected by ZeroMQ for this reason, and TGI put its whole router
(HTTP, validation, tokenization, batching) in Rust, outside Python entirely.

Do the arithmetic for a modest server. At 64 streams and a 14 ms step, the
engine produces about 4,600 tokens per second. If detokenizing, encoding JSON,
and writing one SSE frame costs 40 µs per token, that is 0.18 CPU seconds per
second. Spread across the loop, it adds 2.6 ms to every 14 ms step: an 18%
slowdown for everyone, before a single prompt is tokenized. In a separate
process, it costs a core and nothing else.

The engine process still has its own CPU work: scheduling, block accounting,
and building input metadata. At large batch sizes this can be a few
milliseconds per step. The fix is to overlap it with the GPU: schedule step
N+1 while step N runs. vLLM calls this **async scheduling**. It needs
care, because the tokens from step N do not exist yet when step N+1 is
planned (see [the vLLM scheduler](/notes/inference-engineering/vllm-internals/02-the-scheduler/)).

### Capacity belongs to the KV cache manager

Each running request holds keys and values for every token of its context in
every layer. That memory, not compute, usually bounds how many requests run
at once.

Take a model shaped like Llama 3.1 70B: 80 layers, 8 KV heads, head dimension
128, 16-bit values.

```text
KV per token = 2 (K and V) × 80 layers × 8 heads × 128 × 2 bytes = 327,680 B = 320 KiB
```

Served with [tensor parallelism](/notes/inference-engineering/distributed-inference/01-tensor-pipeline-and-expert-parallelism/) across four 80 GB GPUs, each GPU holds a
quarter of the KV heads, so 80 KiB per token, and a quarter of the weights,
about 35 GB. With 90% of memory given to the engine (72 GB) and roughly 5 GB
for activations, CUDA graphs, and the runtime:

```text
KV budget per GPU ≈ 72 − 35 − 5 = 32 GB
tokens in cache  ≈ 32 × 10^9 / 81,920 ≈ 390,000
```

At 4,000 tokens of context per request that is about 97 concurrent requests;
at 32,000 it is 12. Every admission decision is "are there blocks for this
request's next tokens?", which is why the KV manager, not the scheduler,
effectively owns capacity. [PagedAttention](/notes/inference-engineering/batching-and-scheduling/02-paged-kv-memory/) (Kwon et al., SOSP 2023) made this
memory allocatable in fixed-size blocks, which removed most fragmentation and
let requests share blocks for a common prefix.

### The executor and parallel ranks

The executor owns the GPUs. With tensor parallelism across N GPUs there are N
worker processes, each with its own CUDA context, its own shard of the
weights, and its own share of the KV cache. They run in lockstep: one
scheduler makes one decision per step and broadcasts it to every rank; the
ranks exchange activations with NCCL all-reduces inside the forward pass; all
ranks sample the same tokens and one of them reports back.

Two executor techniques matter for latency:

- **CUDA graphs.** A decode step for a large model is a thousand or more
  small kernel launches. Recording them once and replaying the recording
  removes per-launch CPU overhead, at the cost of fixed shapes, so engines
  record a ladder of batch sizes and pad up to the next one.
- **Flat batches.** Instead of padding every request to the longest, the
  runner concatenates all scheduled tokens into one long sequence and gives
  attention kernels the offsets and block tables to find each request's
  context.

### The sampler and the detokenizer

Sampling runs on the GPU, vectorized across the batch, with per-row
parameters: each request can have its own temperature, top-p, penalties, and,
for structured output, a mask of tokens its grammar allows. Building those
masks is CPU work, so engines compute them while the forward pass runs.

Detokenization is stateful per request. A token can be half of a multi-byte
UTF-8 character, and a stop string can span several tokens, so the
detokenizer must hold back text until it is safe to send. The third lesson of
this module, [streaming APIs](/notes/inference-engineering/serving-systems/03-streaming-apis/), builds one.

### Failure and lifecycle

A process split creates failure modes a single process does not have:

- **Cancellation must cross the boundary.** When a client disconnects, the
  front end must tell the engine to abort the request, or the engine keeps
  generating, and holding KV blocks, for nobody.
- **The engine and its workers fail together.** If a GPU worker dies
  mid-step, the step cannot complete; engines treat this as fatal for the
  whole engine and fail in-flight requests. Recovery is a process restart,
  driven by a health check.
- **Startup is slow.** Loading weights, profiling memory, compiling, and
  capturing CUDA graphs can take minutes. Readiness must reflect that.

## Code

The program models a server with 64 decode streams and a 14 ms GPU step.
Front-end work (tokenizing arriving prompts at 1.5 µs per token, plus 40 µs
per output token for detokenize, JSON, and SSE) either runs inside the engine
loop or in another process; the engine's own 1.5 ms of CPU work per step
either runs between steps or overlaps the next one. The times are assumptions
chosen to be plausible, not measurements of any engine.

```python {title="engine_loop.py"}
"""engine_loop.py: what CPU work in the engine loop does to inter-token latency.

Simulates one GPU serving decode streams. Each engine step has GPU time and
engine CPU time (schedule + update). Front-end work (tokenizing new prompts,
detokenizing and framing every output token) either runs inside the engine
loop or in a separate process. Times are illustrative assumptions, not
measurements. Standard library only; runs offline.
"""

from __future__ import annotations

import random
import statistics
from dataclasses import dataclass

STEPS = 5_000
STREAMS = 64                 # concurrent decode streams (one token each per step)
GPU_MS = 14.0                # forward pass for the batch
SCHED_MS = 1.5               # schedule() + update_from_output() on the engine CPU
TOKENIZE_US_PER_TOKEN = 1.5  # fast tokenizer, per prompt token
OUTPUT_US_PER_TOKEN = 40.0   # detokenize + JSON + SSE write, per output token
ARRIVALS_PER_STEP = 0.35     # new requests per step


@dataclass
class Result:
    name: str
    itl: list[float]
    gpu_busy: float


def prompt_len(rng: random.Random) -> int:
    """Mostly 500-4,000 tokens, with 2% very long documents."""
    if rng.random() < 0.02:
        return rng.randint(60_000, 120_000)
    return int(rng.lognormvariate(7.3, 0.6))


def simulate(mode: str, seed: int = 7) -> Result:
    rng = random.Random(seed)
    itl, wall_total, gpu_total = [], 0.0, 0.0
    for _ in range(STEPS):
        arrivals = sum(1 for _ in range(3) if rng.random() < ARRIVALS_PER_STEP / 3)
        tok_ms = sum(prompt_len(rng) for _ in range(arrivals)) * TOKENIZE_US_PER_TOKEN / 1000
        out_ms = STREAMS * OUTPUT_US_PER_TOKEN / 1000
        if mode == "one loop":
            wall = GPU_MS + SCHED_MS + tok_ms + out_ms   # everything is serial
        elif mode == "split, sync":
            wall = GPU_MS + SCHED_MS                     # front end elsewhere
        else:  # "split, async"
            wall = max(GPU_MS, SCHED_MS)                 # schedule N+1 during N
        itl.append(wall)
        wall_total += wall
        gpu_total += GPU_MS
    return Result(mode, itl, gpu_total / wall_total)


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))]


def main() -> None:
    print(f"{STREAMS} streams, GPU step {GPU_MS} ms, engine CPU {SCHED_MS} ms per step")
    print("inter-token latency (ms) per design:\n")
    print(f"{'design':<14}{'p50 ms':>8}{'p99 ms':>8}{'max ms':>8}{'GPU busy':>10}{'tok/s':>8}")
    for mode in ("one loop", "split, sync", "split, async"):
        r = simulate(mode)
        tps = STREAMS * 1000 / statistics.mean(r.itl)
        print(f"{r.name:<14}{pct(r.itl, .5):>8.1f}{pct(r.itl, .99):>8.1f}"
              f"{max(r.itl):>8.1f}{r.gpu_busy:>10.0%}{tps:>8.0f}")
    out_cores = STREAMS * (1000 / GPU_MS) * OUTPUT_US_PER_TOKEN / 1e6
    print(f"\nfront-end CPU for output alone: {out_cores:.2f} cores "
          f"({STREAMS * 1000 / GPU_MS:.0f} tokens/s x {OUTPUT_US_PER_TOKEN:.0f} us)")


if __name__ == "__main__":
    main()
```

Run it with `python3 engine_loop.py`:

```text
64 streams, GPU step 14.0 ms, engine CPU 1.5 ms per step
inter-token latency (ms) per design:

design          p50 ms  p99 ms  max ms  GPU busy   tok/s
one loop          18.1    27.6   193.8       71%    3239
split, sync       15.5    15.5    15.5       90%    4129
split, async      14.0    14.0    14.0      100%    4571

front-end CPU for output alone: 0.18 cores (4571 tokens/s x 40 us)
```

The single loop loses 29% of the GPU, and its worst step is 194 ms: one
100,000-token document being tokenized while 64 streams wait. Moving the
front end out costs less than a fifth of a core here. Overlapping the
engine's own CPU work recovers the last 10%.

## Where it breaks

- **The model is idealized.** Real async scheduling does not reach exactly
  100%: there is still synchronization at the end of each step, and some
  features (structured output, some [speculative decoding](/notes/inference-engineering/making-it-cheaper/02-speculative-decoding/) methods) give back
  part of the overlap.
- **A separate process moves the bottleneck, it does not remove it.** One API
  server process can saturate on JSON, tokenization, and image decoding
  before the GPU is full. Engines answer with several front-end processes per
  engine; you must give them cores.
- **CPU starvation looks like a GPU problem.** An engine loop that is
  descheduled by the operating system because the container has too few
  cores shows up as low GPU utilization and high inter-token latency. Check
  CPU limits, not node size.
- **The KV budget is a startup decision.** Engines size the cache once from a
  memory profile. Another process growing on the same GPU later, or a
  workspace buffer reaching a new peak, causes out-of-memory errors that the
  engine did not plan for.
- **Process boundaries add a serialization cost** on every request and every
  step's output. Engines minimize it (compact binary encodings, sending only
  what changed), but it is never zero.

## Remember this

- Six parts: front end, scheduler, KV cache manager, executor, sampler, detokenizer.
- The loop runs once per output token for every request; CPU work in it is GPU idle time.
- Admission is a memory decision: the KV cache manager effectively owns capacity.
- Front end, engine, and GPU workers are separate processes so that each can run without waiting for the others.
- Tensor-parallel ranks run in lockstep behind one scheduler; a dead rank takes down the engine.
- Cancellation must propagate from the client connection to the scheduler, or memory leaks into abandoned work.

## Try it

1. Run `engine_loop.py`. Raise `OUTPUT_US_PER_TOKEN` to 150 (a slow JSON
   library plus per-token logging). What happens to the single-loop design
   and to the front-end core estimate?
2. Change `STREAMS` to 256 and `GPU_MS` to 30. Does the relative cost of the
   single loop go up or down? Why?
3. Redo the KV arithmetic for an 8B model (32 layers, 8 KV heads, head
   dimension 128) on one 80 GB GPU with FP8 KV cache. How many 8,000-token
   requests fit?
4. On a machine running any serving engine with tensor parallelism, list its
   processes and threads (`ps -eLf`). Which process would you profile for a
   time-to-first-token problem, and which for an inter-token latency problem?

## Check yourself

1. Why does an engine written in Python put its HTTP server in a different process from its scheduler?

   {{< details summary="Show answer" >}}
   The global interpreter lock lets only one thread run Python at a time. In
   one process, tokenizing a long prompt or formatting thousands of output
   events stops the engine loop, so the GPU waits. Separate processes each get
   their own interpreter, so front-end work runs in parallel with scheduling
   and execution.
   {{< /details >}}

2. Which component effectively decides how many requests run at once, and why?

   {{< details summary="Show answer" >}}
   The KV cache manager. Each running request needs KV memory for its whole
   context in every layer, and the scheduler can only admit or continue a
   request if the manager can give it blocks for its next tokens. Compute
   rarely runs out first.
   {{< /details >}}

3. In a four-way tensor-parallel deployment, how do the four GPUs know what to compute each step?

   {{< details summary="Show answer" >}}
   One scheduler makes the decision and the executor broadcasts the same step
   plan to all four worker processes. Each computes its shard of the forward
   pass, the ranks combine partial results with all-reduces, all sample the
   same tokens, and one rank reports them back.
   {{< /details >}}

4. A client disconnects halfway through a 2,000-token answer. What must happen, and what goes wrong if it does not?

   {{< details summary="Show answer" >}}
   The front end must notice the closed connection and send an abort to the
   engine, which removes the request at the next step and frees its KV blocks.
   Without that, the engine keeps generating tokens nobody reads and keeps
   memory that could admit waiting requests.
   {{< /details >}}

5. Why do engines record CUDA graphs for a ladder of batch sizes instead of one?

   {{< details summary="Show answer" >}}
   A recorded graph replays fixed shapes. Batch size changes every step, so
   the engine records several sizes and pads each step up to the next recorded
   size. Larger steps, such as big prefill chunks, run without a graph because
   launch overhead is a small share of their time.
   {{< /details >}}

## Sources

- G.-I. Yu, J. S. Jeong, G.-W. Kim, S. Kim, B.-G. Chun, [Orca: A Distributed Serving System for Transformer-Based Generative Models](https://www.usenix.org/conference/osdi22/presentation/yu), USENIX OSDI, 2022.
- W. Kwon, Z. Li, S. Zhuang, Y. Sheng, L. Zheng, C. H. Yu, J. E. Gonzalez, H. Zhang, I. Stoica, [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180), ACM SOSP, 2023.
- A. Agrawal, N. Kedia, A. Panwar, J. Mohan, N. Kwatra, B. S. Gulavani, A. Tumanov, R. Ramjee, [Taming Throughput-Latency Tradeoff in LLM Inference with Sarathi-Serve](https://arxiv.org/abs/2403.02310), USENIX OSDI, 2024.
- vLLM team, [vLLM V1: A Major Upgrade to vLLM's Core Architecture](https://blog.vllm.ai/2025/01/27/v1-alpha-release.html), January 2025.
- vLLM documentation, [Architecture overview](https://docs.vllm.ai/en/latest/design/arch_overview.html), accessed October 2026.
- Hugging Face, [Text Generation Inference architecture](https://huggingface.co/docs/text-generation-inference/en/architecture), accessed October 2026.
- A. Grattafiori et al. (Llama Team, Meta), [The Llama 3 Herd of Models](https://arxiv.org/abs/2407.21783), July 2024 (Table 3: layer and head counts used in the KV arithmetic).
