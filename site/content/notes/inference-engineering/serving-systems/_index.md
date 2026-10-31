+++
title = 'Serving systems'
description = 'What a serving engine is made of, how the main open engines differ in mechanism, and how tokens get from the engine to a client.'
weight = 4
+++

Every large-model serving engine has the same parts: a front end that turns
HTTP into token IDs, a scheduler that decides what runs each step, a KV cache
manager that owns memory, an executor that drives the GPUs, a sampler, and a
detokenizer that streams text back. The engines differ in the policies inside
those parts and in where they draw process boundaries.

The three lessons take the engine apart, compare vLLM, SGLang, TensorRT-LLM,
TGI, and llama.cpp by mechanism, and follow the stream from sampled token to
server-sent event. Afterwards you should be able to say which component limits
a given workload, choose an engine with a benchmark you trust, and build a
streaming API that handles cancellation, stop strings, and errors correctly.
