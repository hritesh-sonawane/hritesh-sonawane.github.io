+++
title = 'Secrets'
description = 'How secrets are created, delivered, used, rotated, and destroyed, the systems that manage them, the key hierarchies underneath, and how to find the ones that escaped.'
weight = 3
+++

Workload identity removes many secrets, but not all of them. Databases still
take passwords, third-party APIs still issue keys, and every encrypted byte
still depends on a key somewhere. This module treats a secret as something
with a life: it is created, handed out, read, replaced, and finally destroyed,
and each of those steps is a place where it can leak or where a mistake causes
an outage.

The four lessons cover that lifecycle and zero-downtime rotation, vaults that
issue short-lived dynamic credentials, the operational side of a KMS (key
policies, grants, encryption context, and key hierarchies), and secret sprawl:
how to detect a leaked credential and why deleting it is not the fix. By the
end you should be able to look at any credential in a system and say **who can
read it, how long it lives, how it gets replaced without an outage, and how
you would know if it leaked**.
