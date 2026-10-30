+++
title = 'Isolation'
description = 'What actually separates one workload from another, from kernel namespaces to microVMs to the network, and why most isolation boundaries are configuration that defaults to open.'
weight = 4
+++

A running workload shares a machine, a kernel, an orchestrator, and a network
with many others. Isolation is the set of boundaries that decides what an
attacker who lands inside one workload can reach: the next process, the host,
the cluster's control plane, the database three hops away. Almost none of these
boundaries are on by default, and most are configuration rather than hardware,
so the gap between "isolated" and "shares everything" is usually a few settings.

This module works outward from the narrowest boundary to the widest. It starts
with what a container actually is at the kernel level and why it is not a
security boundary by default, moves up to the Kubernetes security model and the
grants that quietly confer cluster-admin, then to stronger sandboxes and
microVMs for untrusted code, and finally to network segmentation and zero trust
so that a single compromise reaches as little as possible. By the end you should
be able to look at a workload and say what its blast radius is, and which setting
would shrink it.
