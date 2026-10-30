+++
title = 'How systems fail'
description = 'Distributed systems rarely fail cleanly. This module covers partial failure, retries, circuit breakers, overload, and blast radius, and the controls that keep one fault from becoming an outage.'
weight = 2
+++

On one machine, a call either returns or the process crashes. Across a network
a call can succeed, fail, or simply never come back, and the caller cannot tell
which. Most outages are not one broken component. They are healthy components
reacting badly to a slow one: retrying too hard, queueing work nobody is waiting
for, or sharing a fate they did not need to share.

The five lessons follow a failure as it spreads: partial failure and the
timeouts that detect it, retries and the idempotency that makes them safe,
circuit breakers and deadlines that stop waiting on a lost cause, overload and
the backpressure that keeps goodput up, and the cells and shuffle shards that
keep a bad tenant or a bad deploy contained. Each lesson simulates the failure
in a short Python program so you can see the numbers move. By the end you
should be able to look at a call graph and say **what happens to every caller
when one dependency gets slow, and which control bounds the damage**.
