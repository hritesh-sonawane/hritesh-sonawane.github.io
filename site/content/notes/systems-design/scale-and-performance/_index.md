+++
title = 'Scale and performance'
description = 'Why services get slow and how to make them fast again: queueing in pools and pipelines, caches, partitioning, load balancing against the tail, and profiling.'
weight = 6
+++

The capacity lesson in the first module estimated whether a design can carry
its load. This module is about what happens once it does: where requests wait,
which copies of the data absorb the reads, how the data and the traffic are
spread over machines, and how to find the code that is actually slow. Each
topic comes back to the same quantities, arrival rate, service time, and
variability, because they decide latency long before the hardware runs out.

The five lessons cover queueing for pools and multi-stage services, caching
and its failure modes, partitioning and rebalancing, load balancing and tail
latency under fan-out, and a profiling workflow that starts from a symptom and
ends with a measured fix. Every lesson has a short simulation whose output you
can reproduce. By the end you should be able to say, for a slow service,
**which resource requests are queueing for, what would change the queue, and
how to show the change worked**.
