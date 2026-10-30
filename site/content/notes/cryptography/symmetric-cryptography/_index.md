+++
title = 'Symmetric cryptography'
description = 'The shared-key primitives that do most of the work in real systems: block ciphers and their modes, authenticated encryption, MACs, and key derivation.'
weight = 2
+++

Almost every byte of data protected in transit or at rest is protected by a
symmetric key. Public-key cryptography sets up the key; a symmetric cipher and
a MAC do the bulk work. This module starts at the raw block cipher, shows why a
cipher on its own is not encryption you can use, and builds up to
**authenticated encryption**, the only interface most engineers should touch.
Then it covers MACs, where a hash used naively breaks, and key derivation,
which turns one secret into many keys, each with one job.

Python's standard library has HMAC and the hash functions but no AES, so some
programs here build small, clearly labeled toy ciphers to show the mechanism.
By the end you should be able to read a design and say **which key protects
what, whether integrity is covered, and what happens if a nonce repeats**.
