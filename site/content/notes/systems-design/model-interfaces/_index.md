+++
title = 'Model interfaces'
description = 'The contract between your code and a model: tokens and context as a budget, structured output and tool calls as a protocol, and prompts as versioned, tested artifacts.'
weight = 10
+++

Everything a model does for you passes through a narrow interface: a sequence of
tokens in, a sequence of tokens out. This module treats that interface the way
you would treat any other API contract, with its units, its failure modes, and
its versioning.

The first lesson works out what a token is, what a context window costs in
memory, time, and money, and why prompt order decides how much of it is cached.
The second covers getting machine-readable output: how constrained decoding
masks tokens so the output always matches a schema, what it cannot guarantee,
and how a tool call travels from the model's proposal through your validation
to an effect. The third treats prompts as code: content-addressed versions,
regression suites with paired statistics, and release gates. Afterwards you
should be able to budget a context window, design a tool interface the model
cannot misuse into a bad effect, and block a prompt change that quietly breaks
one slice of traffic.
