+++
title = 'vLLM internals'
description = 'One request through the vLLM V1 engine: processes and wires, the token-budget scheduler, the paged KV cache manager, model execution, and running it in production.'
weight = 5
+++

vLLM is the most widely deployed open serving engine, and its V1 engine is a
compact example of everything in the earlier modules: continuous batching,
paged KV memory, chunked prefill, and prefix caching in one loop. This module
follows one request through that loop and then covers the settings and
signals you use to run it.

vLLM changes quickly. These lessons describe the V1 engine architecture as of
October 2026, which has been the only engine since the original one was
removed in 2025. Mechanisms are stable across releases; flag names, defaults,
and internal class names move. Where a detail is version-specific the lesson
says so. Check `vllm serve --help` and the release notes for the version you
run.
