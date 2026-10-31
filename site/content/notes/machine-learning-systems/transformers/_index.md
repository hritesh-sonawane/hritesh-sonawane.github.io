+++
title = 'Transformers'
description = 'The model behind modern AI systems, built up from tokens: tokenization and embeddings, attention with masks, the full block with its parameter and FLOP counts, and the scaling laws that size models and datasets.'
weight = 2
+++

A decoder-only transformer turns text into **tokens**, tokens into vectors,
and runs those vectors through a stack of identical blocks. Each block mixes
information across positions with **attention** and transforms each position
with an MLP. Its parameter count and per-token FLOPs follow directly from a
handful of config values, and **scaling laws** relate those numbers to the
loss a training budget can buy.

The lessons implement byte-pair encoding, attention with causal and padding
masks, a parameter and FLOP counter for published configs, and the Chinchilla
compute-optimal arithmetic. Afterwards you should be able to estimate a model's
size, training compute, and per-token cost from its `config.json`, and explain
why production models are trained on far more tokens than the compute-optimal
rule suggests.
