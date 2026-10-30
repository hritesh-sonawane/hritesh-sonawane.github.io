+++
title = 'Foundations'
description = 'A running workload sits at the end of a chain of trust decisions, and an attacker reasons about that chain as a graph of identities, roles, and resources. This module maps the chain, the graph, and the cloud IAM rules that draw most of its edges.'
weight = 1
+++

Before any single control makes sense, you need a map. The first lesson follows
one workload from a commit to a running process and asks, at each hop, what
that hop must prove and what an attacker inherits by owning it. The second
turns that map into a graph and treats attack paths, lateral movement, and
privilege escalation as questions about reachability. The third covers the
cloud IAM model that defines most of the graph's edges: principals, roles,
trust policies, and the order in which AWS evaluates a request.

By the end of the module you should be able to take a deployment you know and
say **which hops it trusts implicitly, which paths lead from a compromised pod
to the data that matters, and which single permission would cut them**.
