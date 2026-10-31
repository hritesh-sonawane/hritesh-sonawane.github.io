+++
title = 'Production inference'
description = 'Running inference as a service: latency SLOs and goodput, capacity plans that hold at peak, autoscaling when a replica takes minutes to start, and sharing a fleet among tenants without one starving the rest.'
weight = 7
+++

A serving engine that is fast on a benchmark still has to meet a latency
objective for real traffic, at the busiest five minutes of the day, through a
zone failure, while several tenants compete for the same GPUs. This module is
about those production questions.

The four lessons define latency objectives for streamed generation and the
goodput metric that ties them to capacity, build a capacity plan from measured
traffic and measured per-replica capacity, model autoscaling when a new
replica needs minutes to load its weights, and schedule a shared replica so
that one tenant's flood does not become every tenant's outage. Afterwards you
should be able to write an SLO for a model service, size the fleet for it,
and say what the fleet does when demand exceeds that size.
