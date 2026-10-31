+++
title = 'Frontier model security'
description = 'Protecting the weights of highly capable models from theft, insiders, and extraction, and tying release decisions to measured capability.'
weight = 6
+++

The more capable a model is, the more its weights are worth to someone else and
the more harm a stolen copy can do without the safeguards that surround the
official deployment. This module treats the weights as the asset: where copies
live, who and what can read them, how they can leave, how much an API gives
away, how capability evaluations decide which protections are required, and how
hardware isolation keeps weights and prompts away from the people who run the
machines.

By the end of it you should be able to place a system on the RAND security
levels, inventory and narrow the paths to a model's weights, design a
two-person access broker, size an egress budget and an extraction budget, wire
a capability threshold into a release gate, and explain what an attestation
report proves before a key is released.
