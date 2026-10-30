+++
title = 'Thinking in invariants'
description = 'Before any boxes and arrows: what the system promises, which states it may be in, how much load it must carry, and how to choose between designs and write the choice down.'
weight = 1
+++

Most design reviews start with a diagram. This module starts one step earlier,
with the promises the diagram is supposed to keep. A promise you can state as
an invariant can be checked by code, in tests and in production. A promise you
cannot state that way, such as "fast" or "secure", stays a matter of opinion
until it fails in production.

The four lessons build the habits the rest of the course relies on: rewriting
requirements as safety and liveness properties, modeling entities as explicit
state machines whose illegal transitions are bugs, estimating capacity with
arithmetic before choosing an architecture, and recording tradeoffs so that a
later measurement can overturn them. Afterwards you should be able to take a
vague brief and turn it into **a short list of checkable promises, a state
diagram, a capacity estimate, and a decision record** that says what would
change your mind.
