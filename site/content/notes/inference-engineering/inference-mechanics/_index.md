+++
title = 'Inference mechanics'
description = 'What one forward pass costs: prefill and decode, the size of the KV cache, and why generating tokens is limited by memory bandwidth rather than arithmetic.'
weight = 1
+++

Every serving decision later in the course rests on three pieces of arithmetic.
A request is processed in two phases with opposite costs: **prefill** reads the
whole prompt in one parallel pass, and **decode** produces one token per pass.
Each sequence keeps a **KV cache** whose size you can compute exactly from the
model config. And a decode step moves far more bytes than it does arithmetic, so
its speed is set by memory bandwidth.

The three lessons work these out for real model configs on a real GPU
datasheet, with short Python programs that do the counting. Afterwards you
should be able to estimate time to first token, inter-token latency, KV memory
per user, and the concurrency a GPU can hold, from a `config.json` and a spec
sheet.
