+++
title = 'Agentic systems'
description = 'An agent is a model choosing its own next step in a loop. This module covers what the system around that loop must guarantee: bounds, memory, durability, and control over what the agent may do.'
weight = 14
+++

Once the model picks the next step, a request becomes a long-running, stateful,
variable-cost process that can change things in the world. The model supplies
judgment; the harness around it decides how long it runs, what it remembers,
whether it survives a crash, and which actions it may take.

The four lessons cover the loop and how it stops, memory and planning and what
they cost, durable execution for tasks that outlive a process, and the policy
and approval layer between a proposed action and its effect. Afterwards you can
size an agent's cost distribution, choose a memory design and name its failure
modes, make a task resumable without repeating side effects, and bind a human
approval to the exact action it authorizes.
