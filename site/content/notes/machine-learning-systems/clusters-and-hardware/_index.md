+++
title = 'Clusters and hardware'
description = 'How GPUs are wired together, how collectives move data across that wiring, how one GPU is shared, and how to compare accelerators from their datasheets.'
weight = 6
+++

A training or serving job that spans more than one GPU runs at the speed of the
slowest link it depends on. This module covers the links inside a server and
between servers, the collective algorithms that move gradients and activations
across them, the three ways to share one GPU between workloads, and how to read
accelerator specifications without taking the marketing numbers at face value.

Afterwards you can predict the bottleneck link for a given placement, estimate
how long an all-reduce takes, choose between time-slicing, MPS, and MIG, and
compare accelerators on the metric that matters for your workload.
