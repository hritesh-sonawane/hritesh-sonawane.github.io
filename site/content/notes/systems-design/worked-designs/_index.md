+++
title = 'Worked designs'
description = 'Four complete designs, each argued from its invariants: a rate limiter, a credential broker, a tamper-evident audit log, and a multi-tenant inference gateway.'
weight = 5
+++

Every earlier module took one idea and looked at it closely: invariants,
partial failure, races, consistency, error budgets. This module puts the ideas
together. Each lesson takes one system and walks the same route: requirements,
the invariants that must hold, a capacity estimate with real arithmetic, the
design, how it fails, a security review, and what changes when load grows
tenfold.

The four systems are ones security and platform teams actually build and
operate: a rate limiter, a broker that issues short-lived credentials, an
audit log that shows when it has been altered, and a gateway that shares model
capacity among tenants. By the end you should be able to defend a design the
same way, **starting from what it promises and checking every component against
those promises, not from a diagram of boxes**.
