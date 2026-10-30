+++
title = 'Systems design'
description = 'Invariants, failure modes, concurrency, and the tradeoffs behind systems that keep their promises.'
weight = 5
tone = 'ochre'
status = 'Course'
course = true
+++

A system is a set of promises: this balance never goes negative, this token is
used once, this request finishes or fails within two seconds. Design is the work
of choosing those promises and then keeping them **while requests overlap,
machines fail, and load exceeds the plan**. Security and reliability are the same
discipline seen from two sides: both ask what still holds when something goes
wrong.

The course starts from invariants and state machines, follows the ways systems
fail, works through concurrency and consistency, and ends with four complete
designs, each one argued from its invariants rather than from a diagram of boxes.
It assumes you can read Python and have built or operated a web service. It does
**not** assume a distributed-systems background.

## The path

```mermaid {title="From a promise to a working design"}
flowchart LR
  I["<b>Invariants</b><br/><small>what must hold</small>"] --> F["<b>Failure</b><br/><small>partial, slow, overloaded</small>"]
  F --> C["<b>Concurrency</b><br/><small>races, leases, consistency</small>"]
  C --> P["<b>Production</b><br/><small>SLOs, change, recovery</small>"]
  P --> W["<b>Worked designs</b><br/><small>argued end to end</small>"]
  W -.->|"incidents sharpen the invariants"| I
  class I neutral
  class F warn
  class C memory
  class P compute
  class W good
```

## How each lesson works

1. **The idea in one minute.** The claim, before the detail.
2. **A picture** of the mechanism or the failure.
3. **How it really works**, with the numbers and the named techniques.
4. **Code**: a small Python simulation using only the standard library. Failures,
   clocks, and networks are simulated so every run is reproducible.
5. **Where it breaks.** The assumption that, once violated, defeats the design.
6. **Remember this**, **Try it**, and **Check yourself**.

## What you need

- Python 3.10 or newer and a terminal. Every program runs offline.
- A notebook for capacity math. Most designs fail on arithmetic before they fail
  on architecture.
