+++
title = 'Inference engineering'
description = 'How large models are served: prefill and decode, KV cache memory, batching, quantization, serving engines, vLLM internals, and running inference in production.'
weight = 7
tone = 'teal'
group = 'systems'
status = 'Course'
course = true
+++

Serving a large model is a memory and scheduling problem before it is a model
problem. Each generated token reads the full weights and the growing KV cache,
so throughput, latency, and cost are set by how the server packs requests into
GPU memory and time.

The course starts from the arithmetic of a single forward pass, builds up
batching and paged KV memory, follows a request through a serving engine and
through vLLM, and ends with distributed and production concerns: parallelism,
disaggregation, SLOs, capacity, and fairness. It assumes you can read Python and
know what a transformer is at the level of "layers of attention and MLPs".

## What you need

- Python 3.10 or newer. Every program runs offline and simulates the GPU with
  arithmetic; nothing needs a GPU.
