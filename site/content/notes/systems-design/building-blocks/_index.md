+++
title = 'Building blocks'
description = 'The shared components every AI platform ends up with: a gateway and router in front of models, caches, queues with batch lanes, and an evaluation service.'
weight = 12
+++

Once more than one application calls a model, the same four components appear
whatever the product. A **gateway and router** decides which model serves each
request and what happens when that model is slow or down. **Caches** avoid
paying twice for the same work, and some of them can return a wrong answer
while doing it. **Queues and batch lanes** decide who waits when demand exceeds
the GPUs. An **evaluation service** says whether a change made the system
better or worse.

Each lesson treats one component as a design problem with numbers: routing
cost and quality, cache hit and false-hit rates, queue waits under priority and
preemption, and the statistics an evaluation gate needs. By the end you should
be able to specify these components for a platform and say where each one
fails.
