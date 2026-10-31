+++
title = 'Durable execution'
description = 'A long agent task outlives the process running it. Record every completed step in a durable log, keep the orchestration deterministic so it can be replayed, and make every side effect idempotent, and a task can resume anywhere without repeating work or effects.'
question = 'How does a long agent task survive crashes, deploys, and day-long pauses without repeating its side effects?'
weight = 3
difficulty = 4
prerequisites = ['/notes/systems-design/agentic-systems/01-the-agent-loop', '/notes/systems-design/failure-modes/02-retries-and-idempotency', '/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox']
date = 2026-10-30T14:15:00Z
lastmod = 2026-10-30T14:15:00Z
verified = 2026-10-30
+++

## The idea in one minute

An agent task can run for an hour, wait a day for a human, and make a hundred
model and tool calls. In that time the process running it will be restarted by
a deploy, an autoscaler, or a crash. If progress lives in process memory, it is
lost, along with the money already spent, and restarting from the beginning
repeats every side effect.

**Durable execution** makes the log the source of truth and the process
disposable. Every completed step's result is appended to a persistent history.
To resume, any worker re-runs the orchestration code, returning recorded
results for steps already in the history, and continues at the first step
without one. Two rules make this correct: **the orchestration code must be
deterministic**, so replay takes the same path, and **every side effect must be
idempotent**, because a crash after an effect but before its result is recorded
will run that step again. The consequence to act on: at-least-once execution
plus idempotent effects is the only route to effectively-once behavior, so
every tool that changes the world needs a stable idempotency key.

## A picture

```mermaid {title="A crash, a resume on another worker, and the one gap idempotency closes"}
sequenceDiagram
  autonumber
  participant A as Worker A
  participant H as Event history
  participant T as Email API
  participant B as Worker B
  A->>H: step 1 model plan, result recorded
  A->>H: step 2 fetch orders, result recorded
  A->>T: step 3 send email, key task-42:3
  T-->>A: sent
  Note over A: crashes before recording step 3
  B->>H: load history, replay steps 1 and 2
  B->>T: step 3 send email, same key task-42:3
  rect rgb(226, 239, 216)
    T-->>B: already sent, original result returned
  end
  B->>H: step 3 recorded, continue at step 4
```

Steps 1 and 2 are not re-executed: their recorded results are returned. Step 3
runs twice because the crash fell between the effect and the record. The
idempotency key turns the second attempt into a lookup instead of a second
email.

## How it really works

### What interrupts a long task

| Interruption | Without durability | With durability |
| --- | --- | --- |
| Worker crash or deploy | Task lost; restart from zero, effects repeated | Another worker replays the history and continues |
| A tool is down for ten minutes | Step fails; task fails | The step retries with backoff; the task waits |
| Human approval takes a day | A process sleeps for a day, if it survives | The task is parked in storage; no worker is held |
| Model provider rate limit | Error surfaced to the user | The step is rescheduled |
| The user closes the browser | The stream dies with the request | The task continues; the client reconnects to its event stream |

### Two ways to persist progress

**Checkpointing** writes the agent's state (messages, pending calls, counters)
after each step; resuming loads the latest checkpoint. LangGraph's
checkpointers work this way, saving graph state per step under a thread ID, and
its `interrupt` mechanism parks a thread until a human responds. It is simple
and enough for many agents.

**Event-sourced replay** records each step's **result** in an append-only
history. Resuming re-runs the orchestration function from the start; each step
call checks the history and returns the recorded result if one exists. The
code fast-forwards through the past and continues at the first unrecorded step.
Temporal, Restate, and Azure Durable Functions use this model. Its advantage is
uniformity: timers, signals from humans, child tasks, and retries are all just
events in the same history.

| | Checkpointing | Event-sourced replay |
| --- | --- | --- |
| Stored | Latest state snapshot | Every step's result, in order |
| Resume | Load snapshot | Replay code against history |
| Constraint on code | State must be serializable | Orchestration must be deterministic |
| Timers, signals, child tasks | Built per framework | Native |
| Audit trail | Separate | The history is one |
| Cost to resume | One read | Proportional to history length |

### Determinism: what must be recorded

Under replay, the orchestration code must make the same decisions in the same
order every time, because each recorded result is matched to a step by
position. Anything that can differ between runs must therefore be a **recorded
step** (Temporal calls these activities), never computed directly in
orchestration code.

| Source of non-determinism | Why it breaks replay | Record it as |
| --- | --- | --- |
| **Model call** | A new completion differs from the recorded one, so the path diverges | An activity; replay returns the recorded completion |
| **Tool call, network, file I/O** | Results change over time | An activity |
| **Current time** | `now()` differs on replay | The engine's workflow clock, or a recorded step |
| **Random numbers, UUIDs** | Differ on replay | A recorded side effect |
| **Prompt or config read at run time** | A deploy changes it mid-task | A version pinned and recorded at task start |
| **Completion order of parallel steps** | Races resolve differently | Engine-managed futures, with the order recorded |

Model calls are the case agents add. With temperature above zero a model
returns different text each time, and even at temperature zero, inference
servers can return different completions for the same prompt because batch
composition changes the order of floating-point operations (Thinking Machines
Lab described the mechanism in September 2025). Replay must **return the
recorded completion, not regenerate it**.

The engines detect violations. When replayed code issues a step that does not
match the history at that position, Temporal fails the task with a
non-determinism error rather than guessing. The program below shows the same
check.

### Idempotent steps

Durability guarantees a step's result is recorded *after* the step finishes.
The window between the effect and the record cannot be closed: the effect and
the history write are in different systems. So execution is **at least once**,
and every side-effecting step must be safe to run twice.

- **A stable idempotency key per step**, such as `task_id:step_number`,
  derived from the history position, not generated fresh on each attempt. A
  random UUID created inside the step is a new key on every retry and protects
  nothing, unless it was itself recorded first.
- **The backend deduplicates on the key** and returns the original result. It
  should also reject the same key with different arguments: Stripe's API, for
  example, returns an error when a key is reused with different parameters.
- **The deduplication window must cover the task's lifetime.** Stripe removes
  keys after at least 24 hours. A task that parks for three days awaiting
  approval and then retries an effect started before the pause has outlived
  that window. Record the effect's result before parking, or use
  check-then-act against the system of record.
- **Where the backend has no keys**, look up whether the effect already
  happened (search the sent folder for a message ID you set), or write the
  intent to an outbox in the same transaction as your state, as in
  [exactly-once and the outbox](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/).

> [!IMPORTANT]
> At-least-once execution plus idempotent effects gives effectively-once
> outcomes. Durable execution supplies the first half; every tool that changes
> the world must supply the second.

Some effects cannot be repeated safely or undone: a payment captured, a message
delivered. For multi-step work spanning such effects, the **saga** pattern
(Garcia-Molina and Salem, 1987) pairs each step with a compensating action
(refund, retraction, revert) and runs compensations in reverse when a later
step fails. A durable engine makes [sagas](/notes/systems-design/distributed-data/04-distributed-transactions/) practical because the compensations
themselves survive crashes.

### Two workers, one task

A worker holds a task through a lease. If the worker stalls (a long garbage
collection pause, a network partition) past the lease, the task is handed to
another worker, and now two processes believe they own it. Managed engines
handle this on the server: a worker's completion for a task it no longer owns
is rejected. A home-grown engine needs the same thing, a lease plus a
**fencing token** checked on every history append, as described in
[locks, leases, and fencing](/notes/systems-design/concurrency-and-consistency/02-locks-leases-and-fencing/).
Without it, both workers append steps and both execute effects.

### Parking for humans and timers

An approval is an interrupt. The task records "waiting for approval of action
X", releases its worker, and resumes when a signal arrives. Nothing runs while
it waits, so a thousand tasks awaiting approval cost a thousand database rows,
not a thousand processes. The wait has a durable **timer** with a defined
outcome on expiry: cancel, escalate, or take the safe alternative. If the task
holds a sandbox, snapshot and release it while parked; restore on resume.

The binding between the approval and the exact action is the subject of
[tools, permissions, and approval](/notes/systems-design/agentic-systems/04-tools-permissions-and-approval/).

### History size and replay cost

Replay reads the whole history, so resume time and storage grow with task
length. Agents make histories large because each model call records a full
completion and each tool call records its result.

```text
200-step task
  model completions      200 × ~3 KB    =   ~0.6 MB
  tool results           200 × ~30 KB   =   ~6 MB  (file reads, search pages)
  total history                         ≈   6.6 MB per task
  10,000 concurrent tasks               ≈   66 GB of live history
```

Engines impose limits. Temporal's documentation, as of October 2026, sets a
hard limit of 51,200 events or 50 MB per workflow history, with warnings at
10,240 events or 10 MB, and caps individual payloads at a few megabytes. Two
techniques keep agent histories small:

- **Store large results by reference.** Put the tool output in a blob store
  under a content hash and record the hash. Replay fetches it only if the code
  needs it.
- **Start a fresh history.** At a natural boundary (after compaction, between
  phases), carry the current state into a new run with an empty history.
  Temporal calls this continue-as-new; with checkpointing, it is a new
  snapshot.

### Versioning tasks that are already running

A task started yesterday is mid-way through yesterday's orchestration code and
prompt. A deploy that changes the order or number of steps breaks replay of
every in-flight task. Options, in order of preference:

1. **Let old tasks finish on old workers.** Route by a version recorded at task
   start; keep old workers until their tasks drain.
2. **Branch on a recorded version marker.** Temporal's patching API records
   which code path a task took, so new tasks take the new path and replaying
   tasks take the old one.
3. **Migrate explicitly**, for long-lived tasks: stop, transform state, restart
   from a checkpoint.

Prompts deserve the same treatment as code. Changing the system prompt under a
half-finished task invalidates its prompt cache and can contradict the plan the
model already wrote. Record the prompt version with the task, as you would any
deployable artifact (see [safe change](/notes/systems-design/reliability-in-production/03-safe-change/)).

### Streaming without coupling

Users want to watch a task run. Decouple the task from the connection: the
worker appends events (tokens, tool calls, status) to a per-task stream, and
clients subscribe with a cursor. A dropped connection resumes from the cursor,
and the same stream feeds the UI, the trace, and the audit log.

### Choosing the machinery

| Situation | Use |
| --- | --- |
| Seconds to minutes; losing a task is tolerable | In-memory loop with a session store |
| Minutes to hours; approvals; must resume | Framework checkpointing on a database |
| Hours to days; many timers and signals; strict guarantees; many task types | A durable execution engine |

The layers combine: the agent framework defines the loop, and each model or
tool call becomes an activity of the engine.

## Code

The program runs 20,000 six-step tasks (three model calls, a read, a file
write, an email) on workers that crash with probability 0.03 at each of two
points per step: before the effect, and after the effect but before the
result is recorded. The crash rate is exaggerated so the counts are visible.
Three strategies: progress in memory (restart from zero), a journal (replay
recorded steps), and a journal with idempotency keys passed to the email
backend. The last part replays an old history against code whose step order
changed in a deploy.

```python {title="durable.py"}
"""durable.py: crashes during an agent task, with and without a journal and
idempotency keys.

A six-step task (three model calls, a read, a file write, an email) runs on a
worker that crashes with probability CRASH at each of two points per step:
before the effect, or after the effect but before its result is recorded.
A crashed task is resumed by another worker. Standard library only.
"""

from __future__ import annotations

import random
from collections import Counter

STEPS = [("plan", "model"), ("fetch orders", "read"), ("analyze", "model"),
         ("write report", "write"), ("email finance", "email"), ("summarize", "model")]
CRASH = 0.03          # per crash point, per step attempt
TASKS = 20_000


class Crash(Exception):
    pass


class NonDeterminism(Exception):
    pass


class Mailer:
    """The email backend. With a key it deduplicates; without one it cannot."""

    def __init__(self) -> None:
        self.delivered: Counter[str] = Counter()
        self.seen: set[str] = set()

    def send(self, task: int, key: str | None) -> None:
        if key is not None:
            if key in self.seen:
                return                       # duplicate request: already sent
            self.seen.add(key)
        self.delivered[f"task-{task}"] += 1


def attempt(task: int, steps: list[tuple[str, str]], journal: list[tuple[str, str]],
            keys: bool, mailer: Mailer, rng: random.Random, stats: Counter) -> None:
    for i, (name, kind) in enumerate(steps):
        if i < len(journal):                 # replay: return the recorded result
            if journal[i][0] != name:
                raise NonDeterminism(f"step {i}: history has {journal[i][0]!r},"
                                     f" code now runs {name!r}")
            continue
        if rng.random() < CRASH:
            raise Crash                      # before the effect: harmless
        if kind == "model":
            stats["model calls"] += 1
        elif kind == "email":
            mailer.send(task, f"{task}:{i}" if keys else None)
        if rng.random() < CRASH:
            raise Crash                      # effect done, result not recorded
        journal.append((name, f"result {i}"))


def run(strategy: str) -> Counter:
    rng, mailer, stats = random.Random(5), Mailer(), Counter()
    for task in range(TASKS):
        journal: list[tuple[str, str]] = []
        while True:
            if strategy == "in-memory state":
                journal = []                 # progress died with the process
            try:
                attempt(task, STEPS, journal, strategy.endswith("keys"), mailer, rng, stats)
                break
            except Crash:
                stats["crashes"] += 1
    stats["duplicate emails"] = sum(n - 1 for n in mailer.delivered.values())
    return stats


def main() -> None:
    ideal = TASKS * sum(k == "model" for _, k in STEPS)
    print(f"{TASKS:,} tasks, crash probability {CRASH} at each of 2 points per step\n")
    print(f"{'strategy':<24}{'crashes':>9}{'model calls':>13}{'extra':>8}{'duplicate emails':>18}")
    for strategy in ("in-memory state", "journal", "journal + keys"):
        s = run(strategy)
        extra = s["model calls"] - ideal
        print(f"{strategy:<24}{s['crashes']:>9,}{s['model calls']:>13,}"
              f"{100 * extra / ideal:>7.1f}%{s['duplicate emails']:>18,}")

    print("\nreplaying an old history after a deploy reordered two steps:")
    journal = [("plan", "result 0"), ("fetch orders", "result 1"), ("analyze", "result 2")]
    new_code = [STEPS[0], STEPS[2], STEPS[1]] + STEPS[3:]
    try:
        attempt(0, new_code, journal, True, Mailer(), random.Random(0), Counter())
    except NonDeterminism as e:
        print(f"  NonDeterminism: {e}")


if __name__ == "__main__":
    main()
```

Run it with `python3 durable.py`:

```text
20,000 tasks, crash probability 0.03 at each of 2 points per step

strategy                  crashes  model calls   extra  duplicate emails
in-memory state             8,805       73,294   22.2%             1,894
journal                     7,518       61,839    3.1%               618
journal + keys              7,518       61,839    3.1%                 0

replaying an old history after a deploy reordered two steps:
  NonDeterminism: step 1: history has 'fetch orders', code now runs 'analyze'
```

With progress in memory, every crash restarts the task, so 22% of model calls
are repeated work and 1,894 customers get a second email. The journal cuts the
repeated model calls to 3.1%, exactly the crashes that fell between an effect
and its record, but those same crashes still send 618 duplicate emails:
durability alone does not prevent repeated effects. Adding idempotency keys
leaves the crash count and the repeated calls unchanged and removes every
duplicate, because the backend recognizes the second attempt. The last line is
the replay safety check: a deploy that swapped two steps is caught at the first
mismatched position instead of silently feeding one step's result to another.

## Where it breaks

- **Idempotency is a property of the backend, not the engine.** The engine can
  pass a key; only the receiving system can deduplicate. Third-party APIs
  without keys need check-then-act or an outbox, and some effects (a phone
  call, a printed check) have no lookup at all.
- **Dedupe windows expire.** A key honored for 24 hours does not protect a task
  that resumes after a week. Match the window to the longest pause, or record
  effects before parking.
- **Replay determinism is easy to break quietly.** Iterating a dict built from
  tool output, reading an environment variable, or calling `time.time()` in
  orchestration code works until the first replay after a change. Engines
  detect some violations; code review and replay tests against recorded
  histories catch the rest.
- **The program's crash model is simple.** It has one worker at a time, no
  lease expiry, and an in-memory journal that never fails. Real systems also
  lose history writes, stall past leases, and run two workers at once, which
  is what fencing tokens are for.
- **Durability preserves bad tasks too.** A task stuck in a loop survives
  crashes just as well. Budgets and the off switch from
  [the agent loop](/notes/systems-design/agentic-systems/01-the-agent-loop/)
  must be durable state as well.

## Remember this

- The log is the truth; the process is disposable.
- Checkpointing is enough for many agents; event-sourced replay for long tasks with timers, signals, and strict guarantees.
- Orchestration code is deterministic; model calls, tool calls, time, and randomness are recorded steps.
- Execution is at least once; a stable per-step idempotency key makes effects happen once.
- Keep histories small by storing large results by reference, and start fresh histories at boundaries.
- Record code and prompt versions with each task, and keep old workers until old tasks drain.

## Try it

1. Run `durable.py`. Move all crashes to the "before the effect" point (set the
   second `CRASH` check to never fire). What happens to the duplicate emails in
   the journal strategy, and why?
2. Generate the idempotency key with `secrets.token_hex(8)` inside the step
   instead of `f"{task}:{i}"`. Predict the duplicate count, then run it.
3. Give `Mailer` a dedupe window: keys are forgotten after `W` attempts across
   all tasks. How small can `W` be before duplicates return?
4. Add a compensation for "write report" (delete it) and make "email finance"
   fail permanently 1% of the time. Implement the saga that undoes the report
   when the email cannot be sent.
5. For an agent you run, list every tool with an effect. For each, write the
   idempotency key it receives and how the backend deduplicates, or write
   "none".

## Check yourself

1. Why must a model call be a recorded step under replay?

   {{< details summary="Show answer" >}}
   Replay must take the same path as the original run. A new model call
   returns a different completion (sampling, and batch-dependent numerics even
   at temperature zero), so the code would diverge from the history. The
   recorded completion is returned instead.
   {{< /details >}}

2. What does an idempotency key protect against that durable execution does
   not?

   {{< details summary="Show answer" >}}
   A crash after the effect happened but before its result was recorded. The
   engine then runs the step again; without a key the effect repeats. With a
   stable key the backend recognizes the retry and returns the original
   result.
   {{< /details >}}

3. Why is a random UUID generated inside the step a poor idempotency key?

   {{< details summary="Show answer" >}}
   Each attempt generates a new UUID, so the backend sees two unrelated
   requests. The key must be stable across attempts: derived from the task and
   step position, or generated once and recorded in the history before the
   effect.
   {{< /details >}}

4. You deploy code that inserts a new step in the middle of a workflow. What
   happens to tasks already running, and what should you do?

   {{< details summary="Show answer" >}}
   Their histories no longer line up with the code, so replay fails (or worse,
   silently mismatches results). Either keep old workers running for tasks
   started on the old version, or branch on a recorded version marker so
   replaying tasks take the old path and new tasks the new one.
   {{< /details >}}

5. Why store large tool results by reference rather than in the history?

   {{< details summary="Show answer" >}}
   Replay reads the entire history, and engines cap history and payload size.
   Large results recorded inline slow every resume and can hit those limits. A
   content hash in the history keeps replay fast and fetches the blob only if
   the code needs it.
   {{< /details >}}

## Sources

- Temporal Technologies, [Temporal documentation](https://docs.temporal.io/): workflow determinism, activities and timeouts, event history limits, continue-as-new, and versioning (as of October 2026).
- Microsoft, [Orchestrator function code constraints](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-code-constraints), Azure Durable Functions documentation.
- Restate, [Restate documentation](https://docs.restate.dev/).
- LangChain, [LangGraph persistence](https://langchain-ai.github.io/langgraph/concepts/persistence/), documentation.
- Stripe, [Idempotent requests](https://docs.stripe.com/api/idempotent_requests), API reference.
- H. Garcia-Molina, K. Salem, "Sagas", *Proceedings of ACM SIGMOD*, 1987.
- H. He and Thinking Machines Lab, [Defeating Nondeterminism in LLM Inference](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), September 2025.
- M. Kleppmann, *Designing Data-Intensive Applications*, O'Reilly, 2017 (chapter 8, fencing tokens; chapter 11, event logs).
