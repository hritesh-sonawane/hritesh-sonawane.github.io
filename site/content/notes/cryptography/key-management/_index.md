+++
title = 'Key management'
description = 'Algorithms are rarely what fails; keys are. This module covers the key lifecycle, envelope encryption and KMS, HSMs and key ceremonies, and rotation and revocation.'
weight = 4
+++

A cipher with a 256-bit key is only as strong as the weakest place that key has
ever been: the laptop it was generated on, the config file it was pasted into,
the backup nobody remembered, the engineer who left with a copy. Most of the
real risk in cryptography lives here, in where keys come from, who can use
them, how long they live, and whether anyone can prove they are gone.

The four lessons follow a key from birth to destruction: the lifecycle states
and cryptoperiods that govern it, the envelope pattern and KMS APIs that keep
it out of application memory, the HSMs and quorum ceremonies that protect the
keys at the top of the hierarchy, and the rotation and revocation work that
retires it. By the end you should be able to look at a system and say **which
keys it has, who owns each one, what state each is in, and what you would do
in the hour after one of them leaks**.
