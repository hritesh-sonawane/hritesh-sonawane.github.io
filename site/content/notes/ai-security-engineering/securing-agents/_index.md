+++
title = 'Securing agents'
description = 'An agent turns a fooled model into actions. This module covers the threats agents add, the identity they act under, designs that hold when the model is fooled, containment for the code they run, and the security of the tools they are given.'
weight = 4
+++

A chatbot that is fooled says something wrong. An agent that is fooled does
something wrong, may keep doing it for many steps, may remember the instruction
for next time, and may pass it on to other agents. Everything in the earlier
modules still applies; this module adds what changes once a model has tools,
memory, and autonomy.

The five lessons follow the path of an attack and the controls that meet it:
the threats specific to agents, the identity and authority an agent carries,
architectures that stay safe when the model is manipulated, sandboxes and
egress control for code the model writes, and the supply chain of tools and
MCP servers.

By the end of it you should be able to take an agent design and say **what it
can reach, under whose authority, and which deterministic control stops each
path from attacker text to a damaging action**.
