+++
title = 'Workload identity'
description = 'How a running process proves which software it is without holding a long-lived secret: attestation, SPIFFE, federation to cloud IAM, and mutual TLS between services.'
weight = 2
+++

Every call a service makes to a database, a queue, or a cloud API carries some
claim about who is calling. For years that claim was a static key copied into
an environment variable, and anyone who copied it became the service. This
module replaces the copied secret with an identity the platform vouches for,
issued for minutes or hours, and bound to facts about the workload that it
cannot forge.

The four lessons build the chain in order: why static credentials fail, how
attestation and SPIFFE turn platform facts into a signed identity, how that
identity is exchanged for cloud credentials through OIDC federation, and how
services authenticate each other with mutual TLS in a mesh. By the end you
should be able to look at any service and say **what proves its identity, who
issued that proof, how long it lasts, and what a thief who copies it can do**.
