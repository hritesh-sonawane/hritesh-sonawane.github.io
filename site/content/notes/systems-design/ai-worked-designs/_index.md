+++
title = 'Worked AI designs'
description = 'Five complete AI system designs, each argued from its invariants and sized with arithmetic: chat at scale, retrieval over private documents, a coding agent platform, a batch inference pipeline, and an evaluation platform.'
weight = 16
+++

The earlier modules took one part of an AI system at a time. This module puts
the parts together. Each lesson designs one system end to end and follows the
same route: requirements, the invariants that must hold, a capacity estimate
with the arithmetic shown, the architecture, how one request or job moves
through it, how it fails, a security review, what it costs, and the decisions
taken with the alternatives that were rejected.

The five systems cover the main shapes of AI workload: an interactive chat
service, a retrieval assistant over permissioned documents, a long-running
agent platform, an offline batch pipeline, and the evaluation platform that
gates changes to all of them. The numbers are assumptions stated up front, and
every program runs offline, so you can change the inputs and watch the
conclusions move.
