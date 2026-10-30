+++
title = 'How attacks work'
description = 'The four families of attack on AI systems at the level of mechanism: injection, exfiltration, poisoning and supply chain, and abuse of the model as a resource.'
weight = 2
+++

You cannot defend against something you cannot picture. This module explains
the four families of attack on AI systems at the level of mechanism: what the
attacker controls, what they write, and why it works. Every defense in the
later modules then has a clear target.

By the end of it you should be able to take any AI feature and say how text
could hijack it, how data would leave once it was hijacked, what it was built
from that someone else could have tampered with, and what it would cost if an
attacker simply used it hard.

The demonstrations are small Python programs that use only the standard library
and run offline. Attacks and the first defenses against them run against
simulated models and services inside each program, so you can see the shape of
an attack without targeting anything real.
