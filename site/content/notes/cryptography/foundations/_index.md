+++
title = 'Foundations'
description = 'The habits every later module depends on: name the security property first, trust only real randomness, know what a hash does and does not promise, and leave primitive design to specialists.'
weight = 1
+++

Most cryptographic failures are not clever breaks of strong ciphers. They are
systems that encrypted when they needed to authenticate, drew keys from a
generator built for simulations, used a hash where a keyed MAC belonged, or
invented a scheme that a first-year student could unpick. This module is about
avoiding those mistakes before any specific algorithm enters the picture.

The four lessons start from the security properties and the threat assumptions
behind them, then cover the two primitives everything else rests on, randomness
and hash functions, and end with why the right move is almost always a
well-reviewed library and what that library still leaves to you. By the end you
should be able to look at a design and say **which property it needs, what the
attacker is assumed to see and control, and which part of it is homemade**.
