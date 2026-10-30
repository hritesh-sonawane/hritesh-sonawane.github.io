+++
title = 'Concurrency and consistency'
description = 'What still holds when requests overlap, replicas lag, and processes pause: races, locks and fencing, consistency models, replication, and delivering effects exactly once.'
weight = 3
+++

Most invariants are easy to keep with one request at a time and no failures.
This module is about keeping them when two requests arrive in the same
millisecond, when a lock holder freezes for twenty seconds, when a replica is
behind, and when a process crashes between two writes. These are reliability
bugs, and they are also security bugs: double spends, reused coupons, and
revoked users who keep access are all concurrency failures.

The five lessons start inside one database, with races and the atomic
operations that close them, then move outward to distributed locks and fencing
tokens, the consistency models that say what a read may return, replication and
quorums, and finally exactly-once effects through the transactional outbox. By
the end you should be able to point at any check in a design and say **which
component serializes it, what a stale read would allow, and what happens if the
process dies halfway through**.
