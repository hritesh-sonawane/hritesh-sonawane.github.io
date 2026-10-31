+++
title = 'Securing GPU clusters'
description = "Tenant isolation on shared GPUs, schedulers and RDMA fabrics that were built for trusted users, and the checkpoint stores that hold a training run's most valuable files."
weight = 6
+++

GPU clusters were designed for speed among trusted users: shared devices,
kernel-bypass networking, collective libraries with no authentication, and
parallel file systems that believe what clients say. Running several tenants,
or one very valuable model, on that hardware means adding the boundaries it
left out. This module covers how GPUs are shared and what each sharing mode
isolates, how schedulers and InfiniBand and NVLink fabrics separate tenants,
and how checkpoints are stored, encrypted, and verified before a restore runs
them.

By the end of it you should be able to choose a GPU sharing mode for a given
tenant, test for leftover data between tenants, write the procedure for moving
a node between tenants, and size and verify a training checkpoint.
