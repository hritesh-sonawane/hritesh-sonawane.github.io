+++
title = 'A coding agent platform'
description = 'A shared platform on which engineers hand long coding tasks to agents. It is mostly not GPUs: it is a durable workflow system, a sandbox fleet, and a policy layer, with model serving as one plane among several.'
question = 'How do you build a platform that runs thousands of long coding tasks at once, survives crashes without repeating side effects, and keeps a hijacked agent from reaching anything beyond one pull request?'
weight = 3
difficulty = 5
prerequisites = ['/notes/systems-design/ai-worked-designs/01-a-chat-assistant-at-scale', '/notes/ai-security-engineering/securing-agents/04-sandboxing-and-egress', '/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox', '/notes/systems-design/worked-designs/02-a-credential-broker']
date = 2026-10-30T16:15:00Z
lastmod = 2026-10-30T16:15:00Z
verified = 2026-10-30
+++

## The idea in one minute

A coding agent takes a task ("fix the flaky test in the billing service"),
works in a copy of the repository for minutes or hours, calls a model dozens
of times, runs commands, and ends by proposing a change. A platform runs
thousands of these at once for a whole engineering organization.

The shape of the answer surprises people: **most of the platform is not model
serving**. A task spends two-thirds of its life outside a model call, running
tests, waiting on tools, or waiting for a human. So the platform is a
**durable workflow system** (a task survives any crash or deploy), a
**sandbox fleet** (model-written code runs somewhere it can do no harm), and a
**policy layer** (every proposed action is checked in code before it runs).
The model plane matters for cost, and there one number dominates: agents
resend long, growing contexts, so input outnumbers output about 70 to 1, and
the prefix-cache hit rate sets the bill. The consequence to act on: design
state, isolation, and authority first, then size the GPUs.

## A picture

```mermaid {title="The platform as planes: edge, agent, model, tool, execution, data"}
flowchart TB
  subgraph EDGE["Edge"]
    direction LR
    CL["<b>IDE, CLI, web</b>"] --> GW["<b>AI gateway</b><br/><small>identity, budgets, routes</small>"]
  end
  subgraph AGENT["Agent plane"]
    direction LR
    API["<b>Task API</b>"] --> WF["<b>Durable workflows</b><br/><small>one per task</small>"]
    WF --> WK["<b>Agent workers</b><br/><small>loop, context manager</small>"]
    WK --> POL["<b>Policy engine</b><br/><small>allow, deny, ask a human</small>"]
  end
  subgraph MODEL["Model plane"]
    direction LR
    MR["<b>Model routes</b>"] --> HO["<b>Hosted frontier</b><br/><small>planning</small>"]
    MR --> SH["<b>Self-hosted pool</b><br/><small>prefix affinity per task</small>"]
  end
  subgraph EXEC["Execution plane"]
    direction LR
    SC["<b>Sandbox controller</b><br/><small>warm pool, snapshots</small>"] --> SB["<b>Per-task sandbox</b><br/><small>model-written code</small>"]
    SB --> EG["<b>Egress proxy</b><br/><small>allowlist only</small>"]
  end
  subgraph TOOL["Tool plane"]
    direction LR
    TG["<b>Tool gateway</b><br/><small>user-scoped tokens</small>"] --> SCM["<b>Source control, CI,<br/>issues, code search</b>"]
  end
  DATA[("<b>Data</b><br/><small>workflow history, audit,<br/>artifacts, snapshots</small>")]
  CL --> API
  WK --> GW
  GW --> MR
  POL --> SC
  POL --> TG
  WF --> DATA
  class CL neutral
  class GW,POL,EG,TG good
  class API,WF,WK compute
  class MR queue
  class HO,SH compute
  class SC compute
  class SB warn
  class SCM io
  class DATA memory
```

## How it really works

### Requirements

| Requirement | Decision |
| --- | --- |
| Users | 5,000 engineers; 40 teams building agents on the platform |
| Load at peak | 1,200 concurrent tasks; a task lasts 20 minutes on average (1 minute to 3 hours), and may wait up to a day for a human |
| Task shape | About 40 model calls per task; each call carries about 40,000 input tokens and returns about 600 |
| Latency | Interactive steps: first token under 1.5 s. Background tasks: throughput over latency |
| Durability | No task loses progress to a crash, a node loss, or a deploy |
| Safety | Model-written code runs only in a sandbox; nothing leaves the repository without human review of the exact change |
| Identity | Every action is attributable to the engineer who started the task |
| Data | Source code stays inside the company's cloud on the self-hosted path; a hosted frontier model is allowed for planning under a zero-retention agreement |
| Tenancy | Teams isolated in budget, repositories, and execution |
| Availability | 99.9% for the platform; graceful degradation when a model provider fails |

### Invariants

| # | Invariant |
| --- | --- |
| I1 | **Delegated authority.** An agent acts with the requesting engineer's authority, narrowed to the task's repository and lifetime, never with a shared service account |
| I2 | **Containment.** Model-written code runs only in a per-task sandbox that holds no credentials and can reach only an egress allowlist |
| I3 | **Exactly-once effects.** Every step is recorded before its effect is acknowledged; replay after a crash never repeats an external effect |
| I4 | **Bounded tasks.** Steps, tokens, wall time, and spend are enforced by the harness, not requested in the prompt |
| I5 | **Human gate.** A change leaves the repository only as a pull request a human reviews; merging, publishing, and messaging outside the platform need approval |

I3 is the hardest to get right. A worker that opens a pull request and then
crashes before recording that it did will, on replay, open a second one. The
fix is the one from
[exactly-once and the outbox](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/):
record the intent with an idempotency key first, and make the tool call
idempotent on that key.

### Capacity estimate

**Tasks and calls.** 1,200 concurrent tasks lasting 20 minutes means, by
[Little's law](/notes/systems-design/scale-and-performance/01-queueing-and-littles-law/), 1,200 / 1,200 s = **1 new task per second**. At 40 calls per
task that is **40 model calls per second**. At about 10 s per call, 400 calls
are in flight: **a third of tasks are in a model call at any moment**. The
other two-thirds are running commands, waiting on tools, or paused.

**Tokens.** 40 calls/s × 40,000 = **1.6 million input tokens per second**, of
which 85% are a cached prefix (the conversation so far), leaving 240,000
uncached. Output is 40 × 600 = **24,000 tokens per second**. Input outweighs
output **67 to 1**: the model plane is a [prefill](/notes/inference-engineering/inference-mechanics/01-prefill-and-decode/)-and-cache problem.

**Model split.** Chosen per call site by evaluation: 30% of calls (planning,
hard reasoning) go to a hosted frontier model, 50% (routine steps, tool use)
to a self-hosted 70B-class model, 20% to small models (routing, compaction,
classification).

**Self-hosted pool.** The same model and node as in
[a chat assistant at scale](/notes/systems-design/ai-worked-designs/01-a-chat-assistant-at-scale/):
FP8, TP=8, 20 KiB of KV per token per GPU, 63 GB of KV room per GPU. Agent
contexts are long, so memory caps the batch:

- 63 × 10⁹ / (40,300 tokens × 20 KiB) ≈ **76 sequences per node**.
- At a batch of 64, one decode step reads 8.8 GB of weights plus 64 × 40,300 ×
  20 KiB = 52.8 GB of KV per GPU: 31 ms at 60% of 3.35 TB/s, so **about 2,090
  output tokens per second per node**. Long contexts make decode slow because
  the KV cache, not the weights, is most of what each step reads.
- Prefill: 20 calls/s × 6,000 uncached tokens = 120,000 tokens/s, at about
  44,850 per node.
- Busy time: 120,000 / 44,850 + 12,000 / 2,088 = 2.7 + 5.7 = **8.4
  node-equivalents**; at a 60% target plus a spare, **16 nodes**.

There is a second constraint. About 750 tasks use this pool, and each holds a
40,000-token prefix that the next step wants warm. Keeping all of them in HBM
needs 750 × 40,300 × 20 KiB per GPU / 63 GB ≈ **10 nodes' worth of KV**. Tool
calls of 10 to 60 seconds are long enough for a busy engine to evict a prefix,
so the engine spills idle prefixes to host memory, and the router sends every
step of a task back to the replica that holds them.

**Sandboxes.** Assume 40% of tasks have a running sandbox (the rest are paused
to a snapshot while waiting): 480 sandboxes at 2 vCPU and 4 GB each, about
960 vCPU and 1.9 TB of memory. A cold sandbox takes about 30 s (boot, image,
clone), so the platform keeps a warm pool. With 1 task per second, claims in a
30 s refill window are Poisson with mean 30; the 99.9th percentile is **48**,
so 48 warm sandboxes cover the refill gap almost always.

**Storage.** Workflow history: a few events per step, about 40 steps per task,
a few KB per event, for up to 86,400 tasks a day at the peak rate: tens of GB
a day. Sandbox snapshots
of 1 to 2 GB for paused tasks: about a terabyte in object storage at peak,
deleted when tasks end.

### The planes

**Edge.** Engineers start tasks from an IDE extension, a CLI, or a web
console. Single sign-on gives a user token; the **AI gateway** attributes
every model call to user, team, and task, enforces token budgets, and emits
usage events. Provider keys live only in the [gateway](/notes/systems-design/building-blocks/01-gateways-and-routers/). The token-budget and
fair-scheduling mechanics are those of
[a multi-tenant inference gateway](/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway/).

**Agent plane.**

- **Task API**: create, stream events, approve, cancel. Each task has an owner,
  a repository, and budgets for steps, tokens, wall time, and spend (I4).
- **Durable workflows**: one workflow per task in a durable execution engine
  (Temporal is one example; the mechanism is in
  [durable execution](/notes/systems-design/agentic-systems/03-durable-execution/)). Each model call and each tool call is a recorded
  activity; the workflow's state is rebuilt from history on any worker, so a
  deploy or crash costs a few seconds, and a task can wait a day for a human
  without holding a process.
- **Agent workers**: stateless processes that run the loop: build the context,
  call the model through the gateway, propose an action. Context management
  lives here: clearing old tool output, compacting history into a summary, and
  starting sub-tasks with fresh contexts.
- **Policy engine**: every proposed action is checked in code: is this tool
  allowed for this task, are the arguments in bounds (paths inside the
  repository, no force-push), has the task read untrusted content, does this
  action need approval. The answer is allow, deny, or ask a human, as in
  [tools, permissions, and approval](/notes/systems-design/agentic-systems/04-tools-permissions-and-approval/).

**Model plane.** Routes are named by purpose: `plan-large` (hosted, with a
second provider as fallback), `agent-default` (self-hosted, overflowing to the
hosted route within budget), `fast-small`. The self-hosted router uses prefix
affinity keyed on task ID, queue depth, and KV utilization.

**Execution plane.** One sandbox per task, isolated with a user-space kernel
(gVisor) or a microVM (Firecracker), on dedicated nodes. Only the task's
repository is mounted. There are **no credentials inside**: when the sandbox
fetches from the source host or the internal package mirror, the egress proxy
adds credentials on the way out, and every other destination is denied. A
waiting task's sandbox is snapshotted and stopped; it restores in seconds on
any node. The isolation options are compared in
[sandboxes and microVMs](/notes/infrastructure-security/isolation/03-sandboxes-and-microvms/).

**Tool plane.** Agents reach source control, CI, the issue tracker, and code
search through a **tool gateway** that only knows approved tool servers. Each
call carries a token minted for this user, this repository, and a few minutes,
by a broker like the one in
[a credential broker](/notes/systems-design/worked-designs/02-a-credential-broker/) (I1).

**Data.** A relational store holds workflow history, tasks, approvals, and the
audit trail; object storage holds artifacts and snapshots; a stream and a
column store hold usage events and traces. The audit trail records, for each
action, the user, the task, the policy decision, and which untrusted inputs
the task had read; it can be made tamper-evident as in
[a tamper-evident audit log](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/).

### The life of one task

```mermaid {title="A task: every step recorded, code runs in the sandbox, the pull request needs approval"}
sequenceDiagram
  autonumber
  participant U as Engineer
  participant W as Workflow and worker
  participant M as Model plane
  participant P as Policy engine
  participant S as Sandbox
  participant T as Tool gateway
  U->>W: "fix the flaky test in billing"
  W->>S: claim warm sandbox, clone repository
  loop until done or budget reached
    W->>M: model call, same replica as last step
    M-->>W: proposed action
    W->>P: check action
    alt edit files, run tests
      P-->>W: allow
      W->>S: execute
      S-->>W: output, trimmed
    else open pull request
      P-->>W: ask a human
      W->>U: exact diff and target branch
      U-->>W: approve
      W->>T: create PR, idempotency key, user-scoped token
    end
    W->>W: record step in workflow history
  end
  W-->>U: result, trace link
```

```mermaid {title="Task states: waiting never holds a process or a running sandbox"}
stateDiagram-v2
  [*] --> Queued
  Queued --> Running: worker and warm sandbox claimed
  Running --> Running: model call, tool call, recorded
  Running --> WaitingTool: long CI run
  Running --> WaitingHuman: approval needed
  WaitingTool --> Running: result arrives
  WaitingHuman --> Running: approved, sandbox restored
  WaitingHuman --> Cancelled: rejected or expired
  Running --> Done: change proposed
  Running --> Stopped: budget or no-progress limit
  Running --> Running: worker crash, replay from history
  Done --> [*]: sandbox destroyed
  Stopped --> [*]: sandbox destroyed, state saved
  Cancelled --> [*]
```

### Failure modes

| Failure | What happens |
| --- | --- |
| Agent worker crashes or is redeployed | The workflow resumes on another worker from history; tool calls carry idempotency keys, so no effect repeats (I3) |
| Hosted provider slow or down | The circuit breaker opens on slow first tokens; `plan-large` fails over to the second provider, whose prompt was evaluated separately |
| Self-hosted pool saturated | Queue wait rises; background tasks are shed first; `agent-default` overflows to the hosted route within the team's budget |
| A GPU or node fails | The replica is replaced; tasks pinned to it lose their cached prefix and pay one slow step |
| Sandbox node lost | Tasks restore from their last snapshot elsewhere and replay the steps since |
| A tool is down | The activity retries with backoff; after the retry budget, the agent is told the tool is unavailable |
| An agent loops | A no-progress detector (same action, same result, three times) or the step budget stops the task in a saved state with a reason |
| A bad prompt or model release | The canary's task success rate drops; rollback is a routing change |
| Database primary fails | A replica is promoted; workflows pause for seconds and continue |

### Security review

The question for any agent is whether one context holds **private data,
untrusted content, and an outbound channel** at once.

| Item | In this design |
| --- | --- |
| Untrusted sources | Repository files, issues and their comments, dependency source and READMEs, CI logs, web pages if search is enabled |
| Sinks | Sandbox commands, file edits, pull requests, PR and issue comments, outbound network |
| The trifecta | The agent reads private code and untrusted text in the same context, so the outbound channels are closed: egress only to the allowlist, no credentials in the sandbox, comments and PRs only to the task's repository, and every PR reviewed by a human |
| Identity | Tokens per user, per repository, valid for minutes (I1) |
| Isolation | One sandbox per task; teams never share a sandbox, a prefix cache, or a snapshot store prefix |
| Supply chain | Packages only from the internal mirror; tool servers from an approved, pinned catalog |
| Blast radius of a hijacked agent | It can damage its own sandbox and propose a pull request to one repository, which a human reviews. It cannot reach other repositories, production secrets, or the internet |
| Detection | Alerts on egress denials, on first-time tool use after reading untrusted content, and on unusual approval rates |

Two holes to close that the table does not make obvious:

- **CI is an exit.** A PR that edits the CI configuration can make CI, which
  does hold secrets, do what the sandbox could not. Treat agent PRs like
  contributions from a fork: CI runs without secrets until a human approves,
  and changes to CI files need a code owner's review.
- **Approval fatigue.** Asking a human about every file edit trains people to
  click "approve". Gate only actions that leave the repository or cannot be
  undone, and show the exact diff and target.

The layered treatment of the same platform, attack by attack, is in
[securing an agent platform](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/),
and the tool-side controls are in
[MCP and tool security](/notes/ai-security-engineering/securing-agents/05-mcp-and-tool-security/).

### Cost

The program below produces this breakdown for the stated load, at assumed
prices ($3 per million input tokens, $0.30 per million cached, $15 per million
output on the hosted route; $3.50 per GPU-hour; $0.10 per sandbox-hour) and
10 peak-equivalent hours a day:

| Component | Per day |
| --- | --- |
| Hosted frontier route (30% of calls) | about $16,000 |
| GPUs: 16 self-hosted nodes plus 8 small-model GPUs | about $11,400 |
| Sandboxes, active plus warm | about $530 |
| **Total, per task** | **about $28,000, $0.78 per task over 36,000 tasks** |

Levers, in order of effect:

1. **Prefix-cache hit rate.** From 85% to 60% makes a hosted call 1.7 times as
   expensive and the self-hosted prefill 2.7 times as large. Keep contexts
   append-only, route by task, never put timestamps at the top of a prompt.
2. **The model split.** Each call site moved from the hosted route to the
   self-hosted pool, where evaluation shows quality holds, moves cost from per
   token to capacity already paid for.
3. **Context discipline.** Clearing stale tool output and compacting history
   cut average input per call.
4. **Batch what can wait.** Nightly maintenance tasks run on spare capacity.

Report cost **per completed task**, by team and workload. A task that costs
$0.78 and saves an engineer half an hour is easy to justify; the same task at
$8 because caching broke is a bug to find within the hour.

### Decisions and alternatives rejected

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Task state | Durable workflow engine, every step an activity | Queue plus ad hoc checkpoints: every team reinvents replay and gets I3 wrong. In-process loops: lose progress on every deploy |
| Code execution | Per-task sandbox, gVisor or microVM, no credentials | Plain containers on shared nodes: one kernel bug from every tenant's code. Running commands on the worker: no isolation at all |
| Credentials | Injected at the egress proxy and tool gateway, per user | A token in the sandbox: anything the model runs can read it. A shared service account: every task gets everyone's authority |
| Approval | Only for actions that leave the repository | Approve every step: users stop reading. Approve nothing: a hijacked agent merges |
| Routing | Prefix affinity by task ID | Least-loaded: even load, but most steps miss their 40,000-token prefix |
| Self-hosted pool | Yes, for `agent-default`, once volume was steady | Hosted only: simpler, and right at small scale; at this volume it costs more, and code leaves the boundary |
| Budgets | Enforced by the harness | "Do not take more than 40 steps" in the prompt: a request, not a limit |

### What changes at 10x

At 12,000 concurrent tasks:

- **Sandboxes dominate the fleet** by node count: thousands of active sandboxes
  and a warm pool sized per region and per image, with image pre-pulls.
- **The workflow store shards** by task ID; history retention and archival
  become a cost line of their own.
- **A KV tier for agent prefixes.** Idle task prefixes reach hundreds of
  millions of tokens; offloading to host memory and to a shared cache tier,
  with the router choosing between fetch and recompute, becomes worth its
  complexity.
- **Regions and cells** for blast radius, with each team pinned to a cell.

### Rollout

Each stage is useful alone:

1. The gateway in front of hosted models: keys, budgets, usage events.
2. [Tracing](/notes/systems-design/observability/02-tracing-and-profiling/) and an evaluation suite for the first workload.
3. Durable workflows and the policy engine, hosted models only, for one team.
4. Sandboxes with the egress proxy; coding tasks become possible.
5. The tool gateway and an approved tool catalog.
6. The self-hosted pool for `agent-default`, once usage shows steady volume.
7. Quotas, showback, and self-service as teams multiply.

## Code

The capacity and cost model for this design. Everything except the warm-pool
size is arithmetic; the warm pool uses a Poisson quantile.

```python {title="agent_platform.py"}
"""agent_platform.py: capacity and daily cost of a coding-agent platform.

Arithmetic, not a simulation, except for the Poisson quantile used to size the
warm sandbox pool. Prices and efficiency factors are assumptions; replace them
with your own measured figures. Standard library only.
"""

from __future__ import annotations

import math

# ---- workload at peak ----
CONCURRENT_TASKS = 1_200
TASK_MINUTES = 20
CALLS_PER_TASK = 40
CALL_SECONDS = 10
TOK_IN, TOK_OUT = 40_000, 600          # per model call
CACHE_HIT = 0.85                       # share of input served from the prefix cache
SHARE_HOSTED, SHARE_SELF = 0.30, 0.50  # the rest go to small models
PEAK_HOURS = 10                        # peak-equivalent hours per day

# ---- hosted frontier route, assumed list prices in $ per million tokens ----
PRICE_IN, PRICE_CACHED, PRICE_OUT = 3.00, 0.30, 15.00

# ---- self-hosted large model: 70B-class dense, FP8, one 8-GPU node per replica ----
KV_PER_TOKEN_GPU = 20 * 1024           # bytes per token per GPU at TP=8
WEIGHTS_GPU, KV_ROOM_GPU = 8.8e9, 63e9
HBM_BW, DECODE_EFF = 3.35e12, 0.6
PREFILL_NODE = 44_850                  # tok/s per node at 40% of dense FP8 peak
GPU_HOUR = 3.50
SMALL_MODEL_GPUS = 8

# ---- sandboxes ----
COLD_START_S = 30                      # boot, image, clone
SANDBOX_ACTIVE = 0.4                   # share of tasks whose sandbox is running, not paused
SANDBOX_HOUR = 0.10                    # $ per active sandbox-hour (2 vCPU, 4 GB)


def poisson_quantile(mean: float, q: float) -> int:
    k, p, cdf = 0, math.exp(-mean), math.exp(-mean)
    while cdf < q:
        k += 1
        p *= mean / k
        cdf += p
    return k


def main() -> None:
    tasks_per_s = CONCURRENT_TASKS / (TASK_MINUTES * 60)
    calls_s = tasks_per_s * CALLS_PER_TASK
    in_flight = calls_s * CALL_SECONDS
    print(f"tasks/s {tasks_per_s:.2f}   model calls/s {calls_s:.0f}   calls in flight {in_flight:.0f}"
          f" ({in_flight / CONCURRENT_TASKS:.0%} of tasks)")
    print(f"input {calls_s * TOK_IN / 1e6:.2f} M tok/s (uncached {calls_s * TOK_IN * (1 - CACHE_HIT) / 1e6:.2f} M)"
          f"   output {calls_s * TOK_OUT:,.0f} tok/s   in:out {TOK_IN / TOK_OUT:.0f}:1\n")

    def hosted_call(hit: float) -> float:
        return (TOK_IN * (1 - hit) * PRICE_IN + TOK_IN * hit * PRICE_CACHED + TOK_OUT * PRICE_OUT) / 1e6

    hosted_day = calls_s * SHARE_HOSTED * hosted_call(CACHE_HIT) * 3600 * PEAK_HOURS
    print(f"hosted route      ${hosted_call(CACHE_HIT):.4f} per call          ${hosted_day:>9,.0f} / day")

    # self-hosted: prefill time + decode time per node, then memory for concurrency
    self_calls = calls_s * SHARE_SELF
    prefill_s = self_calls * TOK_IN * (1 - CACHE_HIT)
    out_s = self_calls * TOK_OUT
    ctx = TOK_IN + TOK_OUT / 2
    seqs_mem = int(KV_ROOM_GPU / (ctx * KV_PER_TOKEN_GPU))
    batch = min(64, seqs_mem)
    step = (WEIGHTS_GPU + batch * ctx * KV_PER_TOKEN_GPU) / HBM_BW / DECODE_EFF
    decode_node = batch / step
    busy = prefill_s / PREFILL_NODE + out_s / decode_node
    nodes = math.ceil(busy / 0.6) + 1
    warm_tasks = CONCURRENT_TASKS * SHARE_SELF / (SHARE_HOSTED + SHARE_SELF)
    warm_nodes = math.ceil(warm_tasks * ctx * KV_PER_TOKEN_GPU / KV_ROOM_GPU)
    print(f"self-hosted       {seqs_mem} sequences of {ctx:,.0f} tokens fit per node; batch {batch}"
          f" -> step {step * 1e3:.0f} ms, {decode_node:,.0f} out tok/s per node")
    print(f"                  prefill {prefill_s:,.0f} tok/s + decode {out_s:,.0f} tok/s"
          f" = {busy:.1f} node-equivalents -> {nodes} nodes")
    print(f"                  keeping {warm_tasks:,.0f} task prefixes in HBM would need {warm_nodes} nodes")
    gpu_day = (nodes * 8 + SMALL_MODEL_GPUS) * GPU_HOUR * 24
    print(f"all GPUs          {nodes * 8 + SMALL_MODEL_GPUS} GPUs                     ${gpu_day:>9,.0f} / day")

    warm = poisson_quantile(tasks_per_s * COLD_START_S, 0.999)
    active = CONCURRENT_TASKS * SANDBOX_ACTIVE
    sandbox_day = (active + warm) * SANDBOX_HOUR * PEAK_HOURS
    print(f"sandboxes         {active:.0f} active + {warm} warm (99.9th pct of claims"
          f" in {COLD_START_S} s)  ${sandbox_day:>9,.0f} / day")

    total = hosted_day + gpu_day + sandbox_day
    tasks_day = tasks_per_s * 3600 * PEAK_HOURS
    print(f"\ntotal ${total:,.0f} / day over {tasks_day:,.0f} tasks = ${total / tasks_day:.2f} per task")
    low = hosted_call(0.60)
    print(f"cache hit 85% -> 60%: hosted call ${low:.4f} (x{low / hosted_call(CACHE_HIT):.2f}),"
          f" self-hosted prefill x{0.40 / (1 - CACHE_HIT):.1f}")


if __name__ == "__main__":
    main()
```

Run it with `python3 agent_platform.py`:

```text
tasks/s 1.00   model calls/s 40   calls in flight 400 (33% of tasks)
input 1.60 M tok/s (uncached 0.24 M)   output 24,000 tok/s   in:out 67:1

hosted route      $0.0372 per call          $   16,070 / day
self-hosted       76 sequences of 40,300 tokens fit per node; batch 64 -> step 31 ms, 2,088 out tok/s per node
                  prefill 120,000 tok/s + decode 12,000 tok/s = 8.4 node-equivalents -> 16 nodes
                  keeping 750 task prefixes in HBM would need 10 nodes
all GPUs          136 GPUs                     $   11,424 / day
sandboxes         480 active + 48 warm (99.9th pct of claims in 30 s)  $      528 / day

total $28,022 / day over 36,000 tasks = $0.78 per task
cache hit 85% -> 60%: hosted call $0.0642 (x1.73), self-hosted prefill x2.7
```

Two lines matter most. The self-hosted pool is sized by **prefill and long
contexts**, not output: at 40,000 tokens of context only 76 sequences fit per
node, and each decode step reads 53 GB of KV per GPU. And the **cache hit
rate** is the biggest single sensitivity: losing 25 points of hit rate costs
more than the whole sandbox fleet.

## Where it breaks

- **The efficiency factors are assumptions.** Measured [goodput](/notes/inference-engineering/production-inference/01-latency-slos-and-goodput/) at the SLO,
  with your prompts and your engine, replaces the roofline numbers before any
  hardware is ordered.
- **Averages hide the long tail of tasks.** A few three-hour tasks with
  150,000-token contexts take memory out of proportion to their count; give
  them their own pool or a hard context limit with compaction.
- **Prices change.** Hosted list prices and discounts move; cached-input
  pricing differs by provider, and some charge extra to write the cache, which
  the model ignores.
- **The Poisson model assumes independent arrivals.** The morning ramp and a
  team launching 500 tasks from a script are not Poisson; per-team concurrency
  limits keep bursts within what the warm pool can absorb.
- **A contained agent can still write a bad pull request.** Containment bounds
  what an agent can reach; review quality bounds what reaches production.

## Remember this

- An agent platform is mostly durable state, sandboxes, and policy; model
  serving is one plane.
- Input outweighs output about 70 to 1; [prefix caching](/notes/inference-engineering/making-it-cheaper/03-prefix-caching/) and task-affine routing
  set the cost.
- Record each step before acknowledging its effect, and key every external
  effect, so replay never repeats it.
- Agents act with the requesting user's narrowed, short-lived authority; the
  sandbox holds no credentials.
- Treat agent pull requests like untrusted contributions, including in CI.

## Try it

1. In `agent_platform.py`, set `SHARE_HOSTED = 0.10` and `SHARE_SELF = 0.70`.
   How do the GPU count and the cost per task change?
2. Set `CACHE_HIT = 0.60`. Which line grows most?
3. Set `TOK_IN = 80_000`. How many sequences fit per node, and what happens to
   decode throughput?
4. Add a browser-using research agent as a fourth workload. Which planes
   change, and what does the trifecta analysis say about it?

## Check yourself

1. Why is prefix affinity worth more than load balance in this design?

   {{< details summary="Show answer" >}}
   Each step resends a context of about 40,000 tokens, 85% of it identical to
   the last step. On the replica holding that prefix, a step prefills about
   6,000 tokens; anywhere else it prefills 40,000. That difference is larger
   than any imbalance between replicas, so steps go back to the replica that
   holds their prefix, with a load bound as a guard.
   {{< /details >}}

2. Which part of the design guarantees that a deploy does not lose an
   hour-long task, and which guarantees it does not open two pull requests?

   {{< details summary="Show answer" >}}
   The durable workflow engine: the task's state is rebuilt from recorded
   history on any worker. The idempotency key on the PR creation call: replay
   re-issues the call with the same key, and the tool returns the existing PR
   instead of creating a second one.
   {{< /details >}}

3. What limits the damage of a hijacked coding agent here?

   {{< details summary="Show answer" >}}
   The sandbox holds no credentials and can reach only the allowlist; the tool
   tokens are scoped to one user, one repository, and minutes; the only way out
   of the repository is a pull request a human reviews, and CI does not run
   with secrets for it until approved. The worst case is a bad PR to one
   repository.
   {{< /details >}}

4. Why does a 40,000-token context make decode slow even on a large GPU?

   {{< details summary="Show answer" >}}
   Each decode step reads the weights once and every sequence's whole KV cache.
   At 64 sequences of 40,300 tokens, the KV cache is 52.8 GB per GPU against
   8.8 GB of weights, so the step is dominated by KV reads and takes about
   31 ms, giving about 2,090 output tokens per second per node.
   {{< /details >}}

5. Why are budgets enforced by the harness rather than stated in the prompt?

   {{< details summary="Show answer" >}}
   A prompt is a request the model may ignore, especially after reading
   injected text. A harness counts steps, tokens, time, and spend in code and
   stops the task when a limit is reached, whatever the model says.
   {{< /details >}}

## Sources

- J. D. C. Little, A Proof for the Queuing Formula L = λW, Operations Research 9(3), 1961.
- W. Kwon et al., [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180), ACM SOSP, 2023.
- A. Agache et al., [Firecracker: Lightweight Virtualization for Serverless Applications](https://www.usenix.org/conference/nsdi20/presentation/agache), USENIX NSDI, 2020.
- The gVisor Authors, [gVisor documentation](https://gvisor.dev/docs/).
- Temporal Technologies, [Temporal documentation: workflows and activities](https://docs.temporal.io/).
- C. E. Jimenez et al., [SWE-bench: Can Language Models Resolve Real-World GitHub Issues?](https://arxiv.org/abs/2310.06770), ICLR, 2024.
- S. Willison, [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), June 2025.
- GitHub, [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) (secrets and workflows triggered from forks).
- Model Context Protocol, [Specification](https://modelcontextprotocol.io/specification).
