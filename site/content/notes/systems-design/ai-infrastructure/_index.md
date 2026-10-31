+++
title = 'AI infrastructure'
description = 'The infrastructure under models: a training cluster, a data platform, a multi-model inference platform, and the GPU scheduler that shares them.'
weight = 13
+++

Under every model is a large, expensive, failure-prone machine. This module
designs four parts of it. A **training cluster** sized from the compute a run
needs, the network its collectives need, the storage its checkpoints need, and
the failure rate that decides how often it stops. A **data platform** that
deduplicates, records lineage, and keeps evaluation data out of training data.
An **inference platform** that serves many models in several regions. And the
**GPU scheduler** that shares all of it, where gang scheduling, preemption, and
fragmentation decide how much of the fleet does useful work.

The lessons work in arithmetic: GPU-hours, bytes per parameter, all-reduce
volume, mean time between failures, replicas per region. By the end you should
be able to size each piece and explain where its capacity goes.
