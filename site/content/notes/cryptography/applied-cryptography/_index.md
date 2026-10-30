+++
title = 'Applied cryptography'
description = 'Where cryptography meets real systems: the failure classes that cause breaches, side channels and constant-time code, the migration to post-quantum algorithms, and the agility and inventory that make the next migration survivable.'
weight = 5
+++

The primitives in the earlier modules are sound. Breaches come from the seams
around them: a mode used without integrity, a comparison that exits early, a key
that outlived its system, an algorithm that was safe when it was chosen and is
not safe now. This module is about those seams. It starts from the catalogue of
real-world failures, works through the side channels that leak secrets without
breaking any math, and ends with the two migrations every long-lived system
faces: moving to post-quantum algorithms, and building the agility to move again.

By the end you should be able to look at a system and name how its cryptography
would most plausibly fail, write a comparison or a verification that does not
leak, place the system on a post-quantum timeline using Mosca's inequality, and
produce a cryptographic inventory that turns "we use crypto everywhere" into an
ordered list of work.
