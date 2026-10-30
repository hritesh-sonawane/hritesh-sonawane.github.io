+++
title = 'Public-key cryptography'
description = 'Key exchange, signatures, certificates, and the TLS handshake that combines them: how two parties who share nothing end up with keys they can trust.'
weight = 3
+++

Symmetric cryptography assumes the two ends already share a key. Public-key
cryptography is how they get one, and how anyone can check who signed
something without holding a secret. It is also where the most expensive
mistakes live: an exchange nobody authenticated, a nonce used twice, a
certificate checked against the wrong name, a client that skipped verification
to make an error go away.

The four lessons build up one connection. Key exchange gives two strangers a
shared secret; signatures prove who holds a private key; certificates and PKI
bind keys to names; and the TLS 1.3 handshake puts all three together with a
transcript hash and a key schedule. By the end you should be able to read a
handshake or a certificate chain and say **which check stops which attacker,
and what happens when someone turns that check off**.
