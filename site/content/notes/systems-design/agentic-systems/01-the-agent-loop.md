+++
title = 'The agent loop'
description = 'An agent is a loop in which the model proposes the next action and the harness decides whether it runs, what happens when it fails, and when the loop stops. Budgets, a no-progress detector, error classification, and verification turn an unbounded process into one with a known cost distribution.'
question = 'What is the agent loop, and how do you bound it, stop it, and recover it when steps fail?'
weight = 1
difficulty = 3
prerequisites = ['/notes/systems-design/failure-modes/02-retries-and-idempotency', '/notes/systems-design/failure-modes/03-circuit-breakers-and-deadlines', '/notes/ai-security-engineering/securing-agents/01-agent-threats']
date = 2026-10-30T14:05:00Z
lastmod = 2026-10-30T14:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

An agent is a loop. The harness builds a context, the model replies with either
a tool call or a final answer, the harness checks the tool call against policy
and budgets, runs it, appends the result, and goes round again. The model
supplies judgment. Everything else, including which tools exist, what is in the
context, what is allowed, what happens on failure, and **when the loop stops**,
is ordinary code you write.

A loop has no natural end, and its cost grows faster than its length, because
every step re-reads a history that gets longer. Left alone, a small share of
runs loop, wander, or overflow the context, and those runs dominate the bill.
The fix is four pieces of harness: **budgets** in tokens, money, steps, and
time; a **no-progress detector**; an **error classifier** that decides which
failures the harness retries and which the model sees; and a **verifier** that
checks a claimed success. The consequence to act on: design the loop's terminal
states and its cost tail before you design its prompt.

## A picture

```mermaid {title="One turn of the loop: the model proposes, the harness disposes"}
flowchart LR
  G["<b>Goal</b>"] --> C["<b>Build context</b><br/><small>instructions, tools,<br/>memory, history</small>"]
  C --> M["<b>Model call</b>"]
  M --> D{"<b>Reply is</b>"}
  D -->|"tool call"| P{"<b>Policy and budgets</b><br/><small>allowed? approved?<br/>budget left? looping?</small>"}
  P -->|"yes"| X["<b>Execute</b><br/><small>retry transient errors here</small>"]
  X --> K[("<b>Checkpoint</b>")]
  K --> C
  P -->|"denied"| O["<b>Observation</b><br/><small>denied: reason</small>"]
  O --> C
  D -->|"final answer"| V{"<b>Verify</b><br/><small>tests, schema, checker</small>"}
  V -->|"fails"| C
  V -->|"passes"| R["<b>Succeeded</b>"]
  P -->|"budget spent or no progress"| S["<b>Stopped</b><br/><small>state saved, reason recorded</small>"]
  class G neutral
  class C io
  class M,X compute
  class P,V good
  class K memory
  class O,R,S neutral
```

Three of the boxes are controls: the policy and budget check before every
action, the verifier after every claimed finish, and the checkpoint that makes
a stop resumable. None of them is in the prompt.

## How it really works

### Workflow or agent

In a **workflow**, your code decides the next step and the model performs each
one. In an **agent**, the model decides. The difference shows up everywhere
else:

| | Workflow | Agent |
| --- | --- | --- |
| Control flow | Written in code | Chosen by the model at run time |
| Cost and latency | Predictable per request | A distribution with a long tail |
| Testing | Step by step | End state, statistically, over many runs |
| Typical failure | A step errors | Loops, wanders, or finishes confidently and wrong |

Most production systems are **workflows with agentic steps**: a fixed outer
shape (classify, retrieve, act, report) with model-chosen control flow only
where the path cannot be known in advance. Anthropic's "Building effective
agents" catalogs the common fixed shapes (prompt chaining, routing,
parallelization, orchestrator and workers, evaluator and optimizer) and
recommends a free-running loop only when those do not fit. The rest of this
lesson is about the loop, because that is where the new failure modes are.

### The parts of the harness

- **Context builder.** Assembles each call from the stable prefix (system
  prompt, tool definitions), loaded memory, and the history. The next lesson,
  [memory and planning](/notes/systems-design/agentic-systems/02-memory-and-planning/),
  is about keeping it small.
- **Tool layer.** Each tool has a schema, an effect class (read, reversible
  write, external, irreversible), and a timeout. Tool results are bounded in
  size: a first page and a handle, never an unbounded dump.
- **Policy layer.** Code between proposal and execution. It validates
  arguments, checks permissions, requires approval for some effect classes, and
  enforces budgets. It is the subject of
  [tools, permissions, and approval](/notes/systems-design/agentic-systems/04-tools-permissions-and-approval/).
- **Executor and checkpointer.** Run the action, record the result durably, and
  make the task resumable; see
  [durable execution](/notes/systems-design/agentic-systems/03-durable-execution/).
- **Stop logic.** Budgets, the no-progress detector, cancellation, and the
  verifier. The model saying "done" is one input to it, not the decision.

The loop pattern goes back to ReAct (Yao et al., 2022), which interleaved
reasoning traces with actions and fed each observation back to the model.
Production harnesses differ from the paper mainly in what surrounds the model
call, not in the loop.

### What a run costs, and why the tail matters

Each step re-sends the whole context. With a prefix of `P` tokens and `h`
tokens of history added per step, step `n` (counting from zero) reads
`P + h·n` tokens, so a run of `N` steps reads

```text
input(N) = N·P + h·N(N−1)/2
```

The second term is quadratic. With `P = 12,000` and `h = 1,500`:

| Steps | Prefix tokens | History tokens | Total input | Last context |
| --- | --- | --- | --- | --- |
| 10 | 120,000 | 67,500 | 187,500 | 25,500 |
| 30 | 360,000 | 652,500 | 1,012,500 | 55,500 |
| 50 | 600,000 | 1,837,500 | 2,437,500 | 85,500 |
| 126 | 1,512,000 | 11,812,500 | 13,324,500 | 199,500 |

At illustrative prices of $3 per million input tokens and $15 per million
output tokens, with 600 output tokens per step, a 30-step run costs about $3.31
and a 126-step run about $41: twelve times the cost for four times the steps.
Output is under 2% of the tokens. This is why [prefix caching](/notes/inference-engineering/making-it-cheaper/03-prefix-caching/) matters more for
agents than for chat. Anthropic's prompt-caching documentation, for example,
prices cache reads at a tenth of the base input rate (as of October 2026), and
an append-only context keeps most of each step's input cacheable.

Two consequences for budgets:

- **Budget in tokens or money first, steps second.** Because cost per step
  grows, a token budget binds at a different step count for every task shape.
  A 2,000,000-token budget with the numbers above stops a run at about 45
  steps; a step budget of 50 would allow 2.4 million.
- **Plan for the distribution, not the median.** Report the median, the 95th
  percentile, and the cap. The cap is not hypothetical: some runs will reach
  it, and their cost is part of the price of the feature.

### Budgets, and who enforces them

| Budget | Typical form | Why it exists |
| --- | --- | --- |
| Tokens or spend per task | 2 M input tokens, $5 | Bounds the quadratic tail |
| Steps per task | 50 to 200 | Backstop when tokens are cheap (cached) |
| Wall-clock per task | 30 minutes of active time | Bounds sandboxes, locks, and users' patience |
| Calls per tool | 20 searches, 5 emails | Bounds the blast radius of one bad plan |
| Fan-out | 8 parallel sub-agents, depth 2 | Stops a worker from spawning workers without limit |
| Concurrency per tenant | 50 running tasks | Protects the shared model pool; see [overload and backpressure](/notes/systems-design/failure-modes/04-overload-and-backpressure/) |

Budgets live in the harness and are checked **before** each model call and each
tool call, against counters persisted with the task. A budget in the system
prompt ("you have 20 steps") helps the model plan but enforces nothing. When a
budget is reached, the task ends in a **defined state** with its progress
saved and a reason recorded, not with an exception.

Wall-clock budgets need care. A step is one model call (time to first token
plus decode; 600 output tokens at 50 to 100 tokens per second is 6 to 12
seconds) plus tool time, so thirty steps is several minutes of active time.
Time parked waiting for a human approval should not count against the active
budget; it gets its own timeout with its own outcome.

### Terminal states

A loop needs more outcomes than success and failure. Name them, because each
has a different owner and a different message to the user.

```mermaid {title="Task states: every way out of the loop is a named state"}
stateDiagram-v2
  [*] --> Running
  Running --> WaitingApproval: action needs a human
  WaitingApproval --> Running: approved or refused
  WaitingApproval --> Cancelled: approval timed out
  Running --> Succeeded: verifier passes
  Running --> NeedsHuman: no progress after a nudge
  Running --> BudgetExhausted: tokens, spend, steps, or time
  Running --> Failed: unrecoverable error
  Running --> Cancelled: user or operator cancels
  Succeeded --> [*]
  NeedsHuman --> [*]
  BudgetExhausted --> [*]
  Failed --> [*]
  Cancelled --> [*]
```

`BudgetExhausted` and `NeedsHuman` keep the checkpoint so a person can extend
the budget or redirect the task. `Cancelled` must propagate: abort the
in-flight model stream and tool calls, as described in
[circuit breakers and deadlines](/notes/systems-design/failure-modes/03-circuit-breakers-and-deadlines/),
or the cancelled task keeps spending.

### Error recovery: which errors the model should see

The key decision is **who handles each failure**. Errors the harness can fix
mechanically should never cost a model step; errors that need a different plan
must reach the model as an observation it can act on.

| Failure | Handled by | How |
| --- | --- | --- |
| Transient tool error (timeout, `429`, `503`) | Harness | Retry with backoff and jitter, within a retry budget, with an idempotency key so a retry cannot repeat an effect ([retries and idempotency](/notes/systems-design/failure-modes/02-retries-and-idempotency/)) |
| Model provider error or overload | Harness | Retry, then fall back to another route; a fallback model is a different model and must pass the same eval |
| Malformed tool call (does not parse, fails schema) | Harness, then model | Validate before executing; send the validation error back once; count repairs, since a rising repair rate signals a regression |
| Permanent tool error (`404`, permission denied) | Model | A structured error: what failed, why, and what it may try instead |
| Policy denial | Model | An observation, `denied: external email needs approval`, not an exception; repeated denials feed the no-progress detector |
| No progress | Harness | Nudge once, then stop as `NeedsHuman` |
| Claimed success | Harness | Run the verifier; feed a failure back as an observation |

Two rules make this work. First, **retry at one layer**: if the tool client,
the harness, and the model all retry, one outage multiplies the load. Second,
**error text is a prompt**. "Error 500" teaches the model nothing;
"`search_orders` failed: date range exceeds 90 days; narrow the range" lets it
recover in one step.

### Detecting no progress

Models get stuck in recognizable ways, and each has a cheap signature the
harness can compute without asking a model:

- **Repetition.** The same tool with the same arguments (compare a hash of the
  canonical call) three times in a window.
- **Cycles.** A-B-A-B: open a file, edit, revert, edit.
- **No new information.** The hash of recent observations stops changing; the
  model keeps re-reading what it already has.
- **No movement on the objective.** For tasks with a measurable target (failing
  tests, open checklist items), the count has not improved in `M` steps.

The response is graduated. The first detection injects an observation ("you
have called `read_file(report.csv)` three times with the same result; change
approach or stop and report"), which often unsticks the model. The second
detection stops the task as `NeedsHuman`. Stopping on the first detection
throws away recoverable runs; never stopping lets doom loops run to the budget.

### Verification is part of the loop

An agent that cannot check its own work drifts and declares victory early.
Whenever possible give it a **signal that does not depend on the model's
opinion**: tests that pass or fail, a compiler, a schema validator, a query
that confirms the record changed. The harness runs that check when the model
claims to be done and, if it fails, feeds the failure back instead of ending.
SWE-bench grades coding agents this way, by running the repository's tests
against the final state. When no mechanical check exists, a second model call
with a specific rubric is weaker but better than accepting the claim;
[model graders](/notes/systems-design/evaluation-in-production/02-model-graders/)
covers how far to trust it.

> [!IMPORTANT]
> The model saying "done" is a claim. The harness decides whether the task
> succeeded, and the decision should rest on something the model did not
> write.

### What changes at scale

- **The tail sets capacity.** Concurrency equals arrival rate times duration
  ([Little's law](/notes/systems-design/scale-and-performance/01-queueing-and-littles-law/)). If 95% of tasks take 2 minutes and 5% take 25, the long 5%
  hold about 40% of the sandbox-minutes and model concurrency
  (`0.05 × 25 / (0.95 × 2 + 0.05 × 25) = 1.25 / 3.15`).
- **Per-tenant fairness.** One tenant's runaway tasks share the model pool with
  everyone; per-tenant concurrency and token-rate limits belong at the agent
  layer as well as at the [gateway](/notes/systems-design/building-blocks/01-gateways-and-routers/).
- **A global off switch.** A bad prompt or tool release can make every task
  misbehave at once. Operators need to pause one agent type, one tenant, or all
  tasks, with tasks parked rather than killed.
- **Stop reasons are metrics.** The share of runs ending in each terminal state,
  per agent version, is one of the best regression signals you have. A release
  that moves 3% of runs from `Succeeded` to `BudgetExhausted` is a regression
  even if the offline pass rate held.

## Code

The program runs 10,000 simulated tasks through two harnesses. The "model" is a
random process: each step it makes progress, hits a transient or validation
error, falls into a doom loop (on about 1.5% of steps), or claims to be done
early. The naive harness has no budgets beyond the context window, no detector,
no harness-side retry, and accepts claims of success. The bounded harness has a
2 M input-token budget, a 50-step backstop, a nudge-then-stop detector,
harness retries for transient errors, and a verifier.

```python {title="agent_loop.py"}
"""agent_loop.py: what budgets, a no-progress detector, harness retries, and a
verification step do to the outcome and cost distribution of an agent loop.

The "model" is a random process, not an LLM: each step it makes progress, hits
a tool error, gets stuck repeating itself, or claims to be done. The numbers
are illustrative; the shape of the tails is the point. Standard library only.
"""

from __future__ import annotations

import random
import statistics
from collections import Counter
from dataclasses import dataclass

PREFIX = 12_000          # system prompt + tool definitions, tokens
PER_STEP = 1_500         # history added per step (call + result), tokens
OUTPUT = 600             # output tokens per step
WINDOW = 200_000         # context window, tokens
PRICE_IN, PRICE_OUT = 3.0, 15.0   # illustrative $ per million tokens


@dataclass
class Harness:
    name: str
    max_steps: int            # step budget
    max_tokens: int           # total input-token budget
    detector: bool            # stop or nudge on repeated identical calls
    harness_retry: bool       # retry transient tool errors without a model step
    verify: bool              # check "done" claims against a test


NAIVE = Harness("naive", 10_000, 10**12, False, False, False)
BOUNDED = Harness("bounded", 50, 2_000_000, True, True, True)


def context_tokens(step: int) -> int:
    return PREFIX + PER_STEP * step


def run_task(h: Harness, rng: random.Random) -> tuple[str, int, int]:
    """Returns (terminal state, model steps, total input tokens)."""
    need = max(3, round(rng.lognormvariate(2.3, 0.6)))  # productive steps; median ~10
    done = 0
    step = 0
    tokens = 0
    stuck = False
    repeats = 0
    nudged = False
    while True:
        if step >= h.max_steps:
            return "budget: steps", step, tokens
        if tokens + context_tokens(step) > h.max_tokens:
            return "budget: tokens", step, tokens
        if context_tokens(step) > WINDOW:
            return "context overflow", step, tokens
        tokens += context_tokens(step)
        step += 1
        if stuck:                              # the same call, same arguments
            repeats += 1
            if h.detector and repeats >= 3:
                if nudged:
                    return "stopped: no progress", step, tokens
                nudged = True                  # tell the model it is looping
                repeats = 0
                stuck = rng.random() < 0.5     # half the time the nudge works
            continue
        r = rng.random()
        if r < 0.015:                          # enters a doom loop
            stuck, repeats = True, 1
        elif r < 0.095:                        # transient tool error (e.g. 503)
            if h.harness_retry and rng.random() < 0.9:
                done += 1                      # retried by code, step not wasted
            # otherwise the error goes back to the model as an observation
        elif r < 0.135:                        # validation error: bad arguments
            pass                               # model reads the error, retries
        elif r < 0.165 and done >= need // 2:  # premature "I'm done"
            if not h.verify:
                return "false success", step, tokens
            # verification fails; the failure is fed back, the loop continues
        else:
            done += 1
        if done >= need:
            return "succeeded", step, tokens


def pct(xs: list[int], q: float) -> int:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def main() -> None:
    n = 10_000
    for h in (NAIVE, BOUNDED):
        rng = random.Random(7)
        results = [run_task(h, rng) for _ in range(n)]
        states = Counter(s for s, _, _ in results)
        steps = [k for _, k, _ in results]
        toks = [t for _, _, t in results]
        cost = [(t * PRICE_IN + k * OUTPUT * PRICE_OUT) / 1e6 for _, k, t in results]
        print(f"== {h.name} harness, {n} tasks")
        for s, c in sorted(states.items(), key=lambda kv: -kv[1]):
            print(f"  {s:<22}{c:>6}  {100 * c / n:5.1f}%")
        print(f"  steps          p50 {pct(steps, .5):>4}  p95 {pct(steps, .95):>4}"
              f"  max {max(steps):>4}")
        print(f"  input tokens   p50 {pct(toks, .5):>9,}  p95 {pct(toks, .95):>9,}"
              f"  max {max(toks):>10,}")
        print(f"  cost per task  mean ${statistics.mean(cost):.2f}"
              f"  p95 ${sorted(cost)[int(.95 * n)]:.2f}  max ${max(cost):.2f}")
        print(f"  total spend    ${sum(cost):,.0f}\n")
    k = 30
    print(f"input tokens for one {k}-step task: "
          f"{k * PREFIX + PER_STEP * k * (k - 1) // 2:,} "
          f"(prefix {k * PREFIX:,} + history {PER_STEP * k * (k - 1) // 2:,})")


if __name__ == "__main__":
    main()
```

Run it with `python3 agent_loop.py`:

```text
== naive harness, 10000 tasks
  succeeded               6661   66.6%
  context overflow        1712   17.1%
  false success           1627   16.3%
  steps          p50   12  p95  126  max  126
  input tokens   p50   243,000  p95 13,324,500  max 13,324,500
  cost per task  mean $7.81  p95 $41.11  max $41.11
  total spend    $78,146

== bounded harness, 10000 tasks
  succeeded               9030   90.3%
  stopped: no progress     911    9.1%
  budget: tokens            59    0.6%
  steps          p50   11  p95   28  max   44
  input tokens   p50   214,500  p95   903,000  max  1,947,000
  cost per task  mean $1.02  p95 $2.96  max $6.24
  total spend    $10,232

input tokens for one 30-step task: 1,012,500 (prefix 360,000 + history 652,500)
```

Read the naive harness first. Its success rate looks like 83% if you count
every run that *claimed* success, but 16% of all runs were false claims, so the
real rate is 67%. Another 17% looped until the context overflowed at 126 steps,
and each of those cost about $41. They are why the naive mean cost is $7.81
when the median run costs well under a dollar: the tail is the bill.

The bounded harness converts both failure modes into something better. False
successes become more work, because the verifier sends the run back, and
transient errors no longer cost model steps. Doom loops are caught by the
detector: the nudge rescues half, and the rest stop as `NeedsHuman` after a few
steps instead of 126. The token budget, not the step budget, is the one that
binds (no run reached 50 steps; the largest used 44), which is the quadratic
cost showing through. Total spend falls from about $78,000 to $10,000 for more
real successes.

## Where it breaks

- **The simulation is a cartoon.** Real models do not fail as independent coin
  flips per step; they fail in correlated ways tied to task type, prompt, and
  model version. The shape (a thin, expensive tail) is general; the
  percentages are not.
- **Detectors have false positives.** Legitimate polling ("check the build
  status") looks like repetition. Exempt tools that are expected to repeat, or
  key the detector on unchanged *results* as well as unchanged calls.
- **Budgets truncate useful work.** A cap set from last quarter's tasks cuts off
  this quarter's harder ones. Track the share of runs ending in
  `BudgetExhausted` per task type and review it, rather than raising the cap
  globally.
- **Verifiers can be gamed.** An agent that can edit the tests can make them
  pass. The verifier and its inputs must be outside what the agent can write,
  which is the same rule the security course applies to approval settings in
  [architectural defenses](/notes/ai-security-engineering/securing-agents/03-architectural-defenses/).
- **Nothing here stops a fooled agent.** Budgets bound cost and loops; they do
  not stop a well-formed, in-budget action that was induced by injected text.
  That needs the policy layer and the designs in
  [agent threats](/notes/ai-security-engineering/securing-agents/01-agent-threats/).

## Remember this

- An agent is a model plus a harness; the harness decides what runs and when the loop ends.
- Input tokens grow quadratically with steps; budget in tokens or money, with steps as a backstop.
- Every exit is a named terminal state with saved progress and a recorded reason.
- The harness retries transient errors; the model sees errors that need a new plan, written to be actionable.
- Detect no progress with cheap signatures; nudge once, then stop.
- A claimed success is checked by something the model did not write.

## Try it

1. Run `agent_loop.py`. Set `verify=False` in `BOUNDED`. How many runs become
   false successes, and what happens to the mean cost?
2. Change the detector to stop on the first detection instead of nudging. How
   many tasks that would have succeeded are lost?
3. Raise `max_tokens` to 10 M. Which budget binds now, and how does the 95th
   percentile cost change?
4. Add prefix caching to the cost model: price 85% of each step's input at a
   tenth of `PRICE_IN`. Recompute the cost of a 30-step run and of the naive
   harness's 126-step runs.
5. For an agent you know, list every terminal state it can end in today. Which
   ones are distinguishable in its logs?

## Check yourself

1. Why does a token budget bind at different step counts for different tasks,
   and why is that preferable to a step budget alone?

   {{< details summary="Show answer" >}}
   Each step re-reads the full context, so cost per step grows with history
   size, prefix size, and tool-result size, all of which vary by task. A token
   or money budget bounds what you actually pay for regardless of shape; a step
   budget allows very different costs for the same count and is kept only as
   a backstop for cheap, cached steps.
   {{< /details >}}

2. A tool returns `503`. Should the model see it?

   {{< details summary="Show answer" >}}
   Usually not. A transient error is retried by the harness with backoff,
   within a retry budget and with an idempotency key, without spending a model
   step. Only if retries are exhausted does the model see a structured error,
   so it can choose another approach or stop.
   {{< /details >}}

3. Why nudge before stopping when the detector fires?

   {{< details summary="Show answer" >}}
   Many loops come from the model not noticing it is repeating itself. Telling
   it, in an observation, often breaks the loop at the cost of one step.
   Stopping immediately discards those recoverable runs; never stopping lets
   the rest run to the budget.
   {{< /details >}}

4. In the naive harness, why is the mean cost about ten times the median?

   {{< details summary="Show answer" >}}
   Because cost grows quadratically with steps and a minority of runs loop to
   the context limit. Those runs cost tens of dollars each and dominate the
   mean. Bounding the tail, not shaving the median, is what changes the bill.
   {{< /details >}}

5. What makes a verifier trustworthy?

   {{< details summary="Show answer" >}}
   Its verdict does not depend on the model's own opinion, and the agent cannot
   modify it or its inputs: tests, compilers, schema checks, or queries against
   the system of record, run by the harness from outside the agent's writable
   workspace.
   {{< /details >}}

## Sources

- E. Schluntz, B. Zhang, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), Anthropic, December 2024.
- S. Yao et al., [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629), ICLR 2023.
- C. E. Jimenez et al., [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770), ICLR 2024.
- Anthropic, [Prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching), Claude API documentation (pricing multipliers as of October 2026).
- B. Beyer, C. Jones, J. Petoff, N. R. Murphy (eds.), *Site Reliability Engineering*, O'Reilly, 2016: [Handling Overload](https://sre.google/sre-book/handling-overload/) (retry budgets, retrying at one layer).
- J. D. C. Little, "A Proof for the Queuing Formula: L = λW", *Operations Research* 9(3), 1961.
