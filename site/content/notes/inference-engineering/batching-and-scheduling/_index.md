+++
title = 'Batching and scheduling'
description = 'How a serving engine packs many requests into each GPU step: continuous batching, paged KV memory, chunked prefill, priorities, and preemption.'
weight = 2
+++

Decode is memory-bound, so the only way to use a GPU well is to serve many
sequences per weight read. This module covers how engines do that without
making anyone wait for a batch to fill or a long prompt to finish.

The three lessons build a scheduler in layers. Continuous batching decides at
every step who runs, so finished sequences leave and new ones join at once.
Paged KV memory allocates the cache in small blocks on demand, so memory holds
real tokens rather than reservations. Chunked prefill and a per-step token
budget let long prompts share steps with streaming users, and priorities and
preemption decide who yields when memory runs out. Each lesson simulates the
mechanism in Python using the cost model from the previous module.
