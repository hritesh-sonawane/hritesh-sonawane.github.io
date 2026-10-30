+++
title = 'Securing each stage'
description = 'An AI application passes through seven stages, from design to operation. Each has controls that are cheap there and expensive anywhere else.'
weight = 3
+++

An AI application passes through seven stages: **design, data, model, build,
deploy, runtime, and operate**. Each attack from the [previous module](/notes/ai-security-engineering/how-attacks-work/) has one
stage where it is cheapest to stop, and each stage has controls that are cheap
there and expensive anywhere else. This module walks the lifecycle in order,
one lesson per stage, after a first lesson that maps the whole of it.

By the end you should be able to take any threat in a threat model, name the
stage where it is cheapest to stop, place a **deterministic control** there,
and say who owns it. You should also be able to tell which of your controls
only make attacks rarer and which actually make them impossible.

Agents add enough new surface (identity, sandboxes, tool protocols) that they
get their own module after this one: [Securing agents](/notes/ai-security-engineering/securing-agents/).
