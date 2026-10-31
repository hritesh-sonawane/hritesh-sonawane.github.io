+++
title = 'How AI systems differ'
description = 'What changes when a model sits in the request path, and how to size an AI workload in tokens, seconds, and dollars before drawing any boxes.'
weight = 9
+++

A model is slow, metered by the token, probabilistic, stateless, and steerable
by whatever text it reads. Each of those properties breaks an assumption that
ordinary service design relies on, and each one needs an explicit answer in the
design.

The first lesson names the five properties and what each changes: streaming and
long timeouts, token budgets, evaluation instead of unit tests, a context
builder that carries all state, and a permission boundary outside the model.
The second turns them into numbers: the ten inputs that size any AI workload,
the latency budget of a single call, and the levers that trade cost against
quality. Afterwards you should be able to estimate the tokens per second, GPUs
or spend, and per-request cost of a design from a handful of requirements, and
say which of the three moves first when one changes.
