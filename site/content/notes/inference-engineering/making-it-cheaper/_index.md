+++
title = 'Making it cheaper'
description = 'Three ways to get more tokens from the same GPU: store fewer bits, verify several guessed tokens per weight read, and skip prefill work already done.'
weight = 3
+++

Once batching and paging have packed the GPU, the remaining costs are bytes
read per token and work repeated across requests. This module covers the three
techniques that cut them in most production deployments.

Quantization stores weights, activations, or the KV cache in 8 or 4 bits, which
cuts the bytes every decode step reads and, with the right kernels, doubles
tensor-core throughput. Speculative decoding has a cheap drafter guess several
tokens and verifies them in one pass of the full model, with output provably
identical to the model's own. Prefix caching keeps the KV of shared prompt
prefixes so system prompts and conversation history are computed once. Each
lesson works out when the technique pays and when it does not, with a program
that measures the error, the speedup, or the hit rate.
