+++
title = 'Distributed data'
description = 'How replicated state agrees, how storage engines turn writes into files, how logs carry data between systems, and what it costs to commit one transaction across many machines.'
weight = 7
+++

The concurrency module showed what a read may return when replicas lag and
what quorums do and do not promise. This module goes one layer down, into the
machinery that data systems are built from. It covers the consensus protocol
behind most control planes, the storage engines under most databases, the
partitioned log that connects services and pipelines, and the protocols that
commit one transaction across several machines.

Each lesson runs a small simulation of the mechanism: a Raft cluster through a
partition, an LSM-tree counting its own write amplification, a consumer that
crashes between processing and committing offsets, and a two-phase commit
whose coordinator dies at the worst moment. Afterward you should be able to
read a database's or broker's durability settings and say **what a crash, a
partition, or a slow disk will cost, in lost writes, blocked locks, or bytes
written per byte stored**.
