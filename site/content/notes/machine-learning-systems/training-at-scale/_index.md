+++
title = 'Training at scale'
description = 'What changes when one training run spans thousands of GPUs: feeding data, numerical stability, data, tensor, and pipeline parallelism, sharded optimizer state, and surviving failures.'
weight = 5
+++

A model that fits on one GPU trains with a loop and an optimizer. A model that
does not, trained on trillions of tokens, needs a data pipeline that keeps
every GPU busy, number formats that save memory without losing gradients, and
a way to split the model, its gradients, and its optimizer state across
thousands of devices. Then it needs to survive the hardware failing every few
hours.

This module covers each piece with the arithmetic that sizes it: loader
throughput, loss-scale behavior, all-reduce time, bytes per GPU under each
ZeRO stage, tensor and pipeline communication and bubbles, and the checkpoint
interval that maximizes useful work. Afterwards you should be able to pick a
parallelism layout for a given model and cluster and explain where its time
and memory go.
