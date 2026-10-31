+++
title = 'Distributed inference'
description = 'Serving one model across many GPUs: how tensor, pipeline, and expert parallelism split the work and what each costs in communication, when to split prefill from decode, and how mixture-of-experts models are served.'
weight = 6
+++

A model that does not fit on one GPU, or that needs more bandwidth than one GPU
has, must be split. Each way of splitting it moves different data over
different links at a different rate, and the choice is mostly arithmetic:
bytes per step, the bandwidth and latency of the link they cross, and the
time the GPUs spend reading weights in the meantime.

The three lessons work through that arithmetic. The first prices tensor,
pipeline, and expert parallelism per decode step and per prefill. The second
splits prefill and decode onto separate pools and asks when moving the KV
cache between them pays for itself. The third covers mixture-of-experts
serving: routing, the all-to-all exchange, and the load imbalance that sets
the step time. Afterwards you should be able to pick a layout for a model and
a cluster on paper, and say which link will limit it.
