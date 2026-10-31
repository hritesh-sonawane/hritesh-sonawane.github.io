+++
title = 'Memory and planning'
description = 'An agent remembers through its context window and through stores outside it, and plans either one step at a time or with an explicit plan. Each design has a cost and a characteristic failure: compaction forgets, memory goes stale or gets poisoned, search multiplies cost, and every extra agent adds a handoff that can lose information.'
question = 'How does an agent remember and plan over a long task, and what does each design cost and break?'
weight = 2
difficulty = 4
prerequisites = ['/notes/systems-design/agentic-systems/01-the-agent-loop', '/notes/ai-security-engineering/securing-agents/01-agent-threats']
date = 2026-10-30T14:10:00Z
lastmod = 2026-10-30T14:10:00Z
verified = 2026-10-30
+++

## The idea in one minute

An agent has two kinds of memory. **Working memory** is the context window: what
the model sees on this step. **Long-term memory** is everything outside it:
notes files, a user profile, a store of past episodes, the retrieval index. The
context window is small, expensive per token, and gets less reliable as it
fills; external memory is large and cheap but only helps if the right item is
written, kept current, and found again.

Planning is how the agent spends steps: one at a time (decide, act, observe),
against an explicit plan it maintains, or by searching several candidate paths.
Splitting work across several agents is a form of planning too, and it trades
tokens and handoff losses for wall-clock time and cleaner contexts.

The consequence to act on: **treat memory as a data system with a write path,
a read path, a retention policy, and an owner**, and treat each extra agent as
an interface that must be specified, budgeted, and traced.

## A picture

```mermaid {title="Working memory is rebuilt every step; long-term memory is written deliberately"}
flowchart LR
  subgraph W["Context window, every step"]
    direction TB
    P["<b>Stable prefix</b><br/><small>system prompt, tools</small>"]
    PIN["<b>Pinned</b><br/><small>goal, constraints,<br/>user corrections</small>"]
    S["<b>Compacted summary</b>"]
    R["<b>Recent steps</b><br/><small>verbatim</small>"]
  end
  subgraph LT["Long-term memory, outside the window"]
    direction TB
    N[("<b>Task notes</b><br/><small>plan, findings</small>")]
    U[("<b>User and project memory</b>")]
    E[("<b>Episodes</b><br/><small>searchable summaries</small>")]
  end
  R -->|"compaction"| S
  W -->|"proposed write"| G{"<b>Write gate</b><br/><small>provenance, scope,<br/>expiry, owner</small>"}
  G --> LT
  LT -->|"retrieve on demand"| W
  T["<b>Untrusted content</b><br/><small>web page, email</small>"] -.-> R
  class P,PIN,S,R io
  class N,U,E memory
  class G good
  class T warn
```

Two arrows carry most of the risk. Compaction is where facts are silently lost,
and the write gate is where untrusted text could become a memory that every
future session trusts.

## How it really works

### Three problems with a long context

A large context window does not make context management optional. Three
separate effects grow with context length:

- **Capacity.** The window is a hard limit, and the tool results of a long task
  can exceed it.
- **Cost and latency.** Every token is re-read on every step; the previous
  lesson showed total input growing quadratically with steps
  ([the agent loop](/notes/systems-design/agentic-systems/01-the-agent-loop/)).
- **Attention.** Models use information unevenly across a long context. Liu and
  colleagues ("Lost in the Middle", 2023) found accuracy on multi-document
  question answering was highest when the relevant passage was at the start or
  end of the context and dropped when it was in the middle. Stale or
  contradictory content also misleads, and the effect sets in well before the
  window is full.

So the target is the **smallest context that contains what this step needs**,
not the largest one that fits.

### Working memory: select, compress, isolate, persist

| Move | Mechanism | Saves | Costs |
| --- | --- | --- | --- |
| **Select** | Load tools, documents, and skills on demand; keep handles (paths, IDs) instead of contents | Prefix size | A search step when something is needed |
| **Compress** | Replace used tool results with stubs; summarize old steps (compaction) | History size | Information loss; a prompt-cache miss at each compaction |
| **Isolate** | Give bulky subtasks to a sub-agent with a fresh context; receive a short report | Parent context | Briefing effort; the sub-agent's own tokens |
| **Persist** | Write plans, findings, and decisions to files or stores outside the window | Survives compaction and restarts | A write path that must be governed |

**Clearing old tool results** is usually the largest and safest saving: once a
file has been read and acted on, its 8,000 tokens can become one line saying
what it was and where it lives. **Compaction** is the expensive move. A model
call summarizes everything but the last few steps, and the task continues from
the summary.

Order the context for the [prefix cache](/notes/inference-engineering/making-it-cheaper/03-prefix-caching/): stable content first, then
session-scoped memory, then the summary, then the recent tail. Editing
anything early in the context (reordering tools, updating a timestamp in the
system prompt) invalidates the cache for everything after it. Compaction
rewrites the middle of the context, so it costs a full uncached read once;
compact at a threshold, not continuously.

### What compaction loses

A summary keeps what the summarizer judged important at that moment. Facts
that seemed minor then and matter later are gone, and a second compaction
summarizes the summary. If a fact survives one compaction with probability
`r`, it survives `k` compactions with probability `r^k`: at `r = 0.85`, 52%
after four rounds and 38% after six. Real summarizers are not independent coin
flips, but the compounding is real, and it falls hardest on the oldest
information, which often includes the user's original constraints.

Three defenses, all cheap:

1. **Pin** the goal, hard constraints, and user corrections verbatim outside the
   summarized region. They are small and must never degrade.
2. **Write before you forget.** Have the agent record findings and decisions in
   a notes file as it goes, so compaction can drop the transcript without
   dropping the conclusion.
3. **Keep a plan artifact.** A to-do list the agent rewrites is the most useful
   single memory for a long task: it survives compaction, orients a resumed
   task, and is readable by a human.

### Long-term memory designs

| Design | Written by | Read by | Typical failure |
| --- | --- | --- | --- |
| **Task notes and plan** (a file the agent rewrites) | The agent, during the task | The agent, every step or on resume | Notes drift from reality if not updated after each change |
| **Project memory** (instruction files loaded at start) | People, or the agent with review | Every session in the project | Grows until it costs more than it helps; contradicts itself |
| **User memory** (preferences, standing corrections) | The agent, from explicit user statements | Every session for that user | Stale values; one user's facts leaking to another |
| **Episodic memory** (summaries of past tasks, retrieved by similarity) | The harness, at task end | Retrieval at task start or on demand | Retrieval misses, or retrieves a confident, outdated episode |
| **Knowledge** (documents and code via retrieval) | Ingestion pipelines | Retrieval | The usual retrieval failures, plus access control |

Two research systems shaped how these are built. Park and colleagues'
**Generative Agents** (2023) stored an append-only stream of observations and
retrieved by a weighted combination of **recency**, **importance**, and
**relevance**, then periodically wrote higher-level "reflections" back into the
stream. Packer and colleagues' **MemGPT** (2023) treated the context window
like main memory in an operating system, with the model itself calling
functions to page information between the window and external storage. Both
illustrate the same design point: memory is a pipeline of writes, scoring, and
eviction, not a bigger prompt.

### Memory failure modes

| Failure | What happens | Design response |
| --- | --- | --- |
| **Staleness** | "The user prefers vendor A" outlives the switch to vendor B | Records carry `created`, `expires`, and `supersedes`; newer facts on the same key replace older ones |
| **Contradiction** | Two retrieved memories disagree; the model picks one | Key memories by subject so writes update rather than append; surface conflicts instead of retrieving both silently |
| **Retrieval miss** | The fact exists but is not retrieved | Evaluate memory retrieval like any retrieval: recall@k on a labeled set |
| **Distraction** | Many loosely related memories crowd the context | Retrieve few, with a relevance floor; prefer none to marginal ones |
| **Summary drift** | Repeated compaction loses or distorts early facts | Pin, write notes before compaction, compact rarely |
| **Poisoning** | Injected text causes a memory write that persists into every future session | Gate writes by provenance: deny or queue for review any write derived from untrusted content; see [agent threats](/notes/ai-security-engineering/securing-agents/01-agent-threats/) |
| **Cross-tenant or cross-user leakage** | A similarity search returns another user's memory | Scope keys by tenant and user; apply the filter inside the index query, before ranking, not after top-k |
| **Undeletable memory** | A user asks to be forgotten; derived summaries still contain them | Every memory records its sources so deletion can cascade to derived records |

A memory record that supports these responses looks like a row, not a string:

```text
id, tenant, user, scope (task | project | user), key, value,
source (message ID, document ID, tool call), provenance (trusted | untrusted),
created, expires, supersedes, written_by (agent version)
```

> [!WARNING]
> Whatever can write memory can influence every later session. A memory write
> derived from a web page or an email is a persistent injection channel unless
> the write path checks provenance.

### Planning: step by step, explicit, or search

| Strategy | How it works | Cost | Breaks when |
| --- | --- | --- | --- |
| **Step by step** (ReAct) | Decide one action from the latest observation | One model call per step | Long tasks: no global view, drifts, repeats |
| **Explicit plan** (plan and execute) | Write a plan, execute items, revise on surprises | A planning call plus revisions | The plan is followed after reality changed; revise on failed steps, new facts, and at fixed intervals |
| **Reflection** (Reflexion) | After a failure, write a lesson and retry with it in context | One extra call per attempt, plus retries | Wrong lessons persist; the lesson store is another memory to govern |
| **Search** (sample several candidates, tree search) | Generate `b` alternatives per step, score them, expand the best | Roughly `b` times per step; a full tree is `b^d` | No reliable scorer: search amplifies a bad evaluator |

Search pays off only when there is a cheap, reliable way to tell a good
candidate from a bad one, such as running tests on several candidate patches.
Shinn and colleagues' Reflexion (2023) and Yao and colleagues' Tree of Thoughts
(2023) both report gains on tasks with clear success signals; neither result
transfers to tasks where the only judge is the same model.

### Multiple agents, and what coordination costs

Splitting work across agents is justified in a few situations: **independent
subtasks** that can run in parallel, **context isolation** for bulky
exploration, **privilege separation** (the agent that reads untrusted content
has no write tools), **independent verification**, and an **organizational
boundary**. Outside those, a multi-agent design is a single agent with more
cost and more failure modes.

Anthropic's account of its multi-agent research system (June 2025) gives the
best public numbers: agents used about 4 times the tokens of chat interactions
and the multi-agent system about 15 times; a lead agent with parallel
sub-agents outperformed a single agent by 90.2% on their internal research
evaluation; and token usage alone explained 80% of the performance variance on
the BrowseComp benchmark. Read the last number carefully: much of the gain came
from spending more tokens, which a multi-agent design makes possible in
parallel.

Tokens do not always multiply, though. Splitting can **reduce** total tokens
when it avoids one very long context, because the history term is quadratic.
Take work that would be 120 steps for one agent, with the prefix and per-step
history from the previous lesson:

```text
one agent, 120 steps          120 × 12,000 + 1,500 × 120 × 119 / 2   = 12,150,000 input tokens
8 workers × 15 steps each     8 × (15 × 12,000 + 1,500 × 15 × 14 / 2) =  2,700,000
orchestrator, 10 steps        10 × 12,000 + 2,500 × 10 × 9 / 2       =    232,500
                                                              total     2,932,500
wall clock at 10 s per step   one agent: 1,200 s; orchestrator + one worker: 250 s
```

The assumption doing the work is that the subtasks are truly independent, so
each worker needs only a brief, not the whole history. When they are not, each
worker re-discovers context the parent already had, and the savings vanish.

The costs that do not show up in token counts are coordination failures. Cemri
and colleagues ("Why Do Multi-Agent LLM Systems Fail?", 2025) analyzed traces
from several open multi-agent frameworks and grouped 14 failure modes into
three categories: specification and system design problems, inter-agent
misalignment (agents ignoring or misreading each other), and weak task
verification. Reliability also compounds: if each of 8 workers independently
succeeds 90% of the time, all 8 succeed only `0.9^8 = 43%` of the time, so the
orchestrator must be designed to proceed with partial results and report gaps.

```mermaid {title="Orchestrator and workers: briefs out, bounded reports back"}
sequenceDiagram
  autonumber
  participant O as Orchestrator
  participant W1 as Worker 1
  participant W2 as Worker 2
  participant B as Shared task board
  O->>B: write plan, one item per worker
  par fan-out, budget per worker
    O->>W1: brief: goal, known facts, scope, budget, output format
    O->>W2: brief: goal, known facts, scope, budget, output format
  end
  W1->>B: findings, evidence, what was not verified
  W2-->>O: budget exhausted, partial result
  rect rgb(226, 239, 216)
    Note over O: synthesize, mark gaps, verify claims before acting
  end
  O->>B: final report with sources and open items
```

What makes this work is the **interface**: a brief that states the goal, what
is already known, the scope and what is out of scope, the tools and budget,
and the exact output format; and a report that contains the answer, the
evidence, and what was *not* verified. Shared artifacts (a task board, files
in per-worker directories) coordinate more reliably than agents messaging each
other. Budgets apply per worker and to the whole tree, and one trace spans
every agent so a wrong answer can be traced to the step that introduced it.

## Code

The program simulates a 150-step task that meets 40 facts, 8 of them hard
constraints, and asks at the end which ones the agent still has. Three
strategies: a sliding window that drops the oldest turns, compaction that
summarizes all but the last 10 steps when history passes 100,000 tokens, and
compaction plus pinned constraints plus a notes file the agent writes to.
Summaries are modeled as keeping each fact with probability 0.85.

```python {title="memory.py"}
"""memory.py: what three context strategies remember at the end of a long task.

A 150-step task meets 40 facts along the way; 8 of them are hard constraints
(user corrections, limits). At the end, the agent needs all of them. Summaries
are modeled as lossy: each compaction keeps each unpinned fact with
probability KEEP. Real summarizers are not independent coin flips; the
compounding is the point. Standard library only; runs offline.
"""

from __future__ import annotations

import random

STEPS, FACTS, CONSTRAINTS = 150, 40, 8
PREFIX, PER_STEP = 12_000, 1_500   # tokens
WINDOW = 128_000                   # usable context budget for history
COMPACT_AT = 100_000               # compaction threshold
SUMMARY = 6_000                    # tokens a summary occupies
KEEP = 0.85                        # chance a fact survives one compaction
NOTE_P = 0.9                       # chance the agent writes a key fact to notes
TRIALS = 500


def simulate(strategy: str, rng: random.Random) -> tuple[int, int, float, int]:
    arrive = sorted(rng.sample(range(STEPS), FACTS))
    is_constraint = set(rng.sample(range(FACTS), CONSTRAINTS))
    verbatim: list[tuple[int, int]] = []    # (step, fact id or -1) in recent history
    summary: set[int] = set()               # facts carried by the summary
    pinned: set[int] = set()                # constraints kept verbatim, never summarized
    notes: set[int] = set()                 # facts written to a notes file
    total_tokens, compactions = 0, 0
    for step in range(STEPS):
        fact = arrive.index(step) if step in arrive else -1
        verbatim.append((step, fact))
        if fact >= 0 and strategy == "compact + pin + notes":
            if fact in is_constraint:
                pinned.add(fact)
            elif rng.random() < NOTE_P:
                notes.add(fact)
        history = PER_STEP * len(verbatim)
        extra = (SUMMARY if summary or compactions else 0) + 200 * (len(pinned) + len(notes))
        if strategy == "sliding window":
            while history > WINDOW:          # oldest turns fall out
                verbatim.pop(0)
                history -= PER_STEP
        elif history + extra > COMPACT_AT:   # summarize all but the last 10 steps
            old, verbatim = verbatim[:-10], verbatim[-10:]
            summary = {f for f in summary if rng.random() < KEEP}
            summary |= {f for _, f in old if f >= 0 and rng.random() < KEEP}
            compactions += 1
            history = PER_STEP * len(verbatim)
        total_tokens += PREFIX + history + extra
    known = {f for _, f in verbatim if f >= 0} | summary | pinned | notes
    facts = len(known)
    constraints = len(known & is_constraint)
    return facts, constraints, total_tokens / STEPS, compactions


def main() -> None:
    print(f"{STEPS}-step task, {FACTS} facts of which {CONSTRAINTS} are constraints;"
          f" {TRIALS} trials each\n")
    print(f"{'strategy':<24}{'facts kept':>11}{'constraints':>13}"
          f"{'tokens/step':>13}{'compactions':>13}")
    for strategy in ("sliding window", "compact", "compact + pin + notes"):
        rng = random.Random(11)
        runs = [simulate(strategy, rng) for _ in range(TRIALS)]
        f = sum(r[0] for r in runs) / TRIALS
        c = sum(r[1] for r in runs) / TRIALS
        t = sum(r[2] for r in runs) / TRIALS
        k = sum(r[3] for r in runs) / TRIALS
        print(f"{strategy:<24}{f:>8.1f}/{FACTS}{c:>10.1f}/{CONSTRAINTS}"
              f"{t:>13,.0f}{k:>13.1f}")
    print("\nsurvival of a fact first summarized in round 1, by later rounds:")
    print("  " + "  ".join(f"after {k}: {KEEP ** k:.2f}" for k in range(1, 7)))


if __name__ == "__main__":
    main()
```

Run it with `python3 memory.py`:

```text
150-step task, 40 facts of which 8 are constraints; 500 trials each

strategy                 facts kept  constraints  tokens/step  compactions
sliding window              22.6/40       4.5/8      103,800          0.0
compact                     33.7/40       6.7/8       64,260          2.0
compact + pin + notes       39.5/40       8.0/8       66,986          2.0

survival of a fact first summarized in round 1, by later rounds:
  after 1: 0.85  after 2: 0.72  after 3: 0.61  after 4: 0.52  after 5: 0.44  after 6: 0.38
```

The sliding window is the most expensive per step and still forgets nearly
half the facts, because it drops whole turns in arrival order and keeps the
context near its limit. Compaction cuts tokens per step by about 40% but loses about
one fact in six and, worse, almost one constraint in six. Pinning the 8
constraints and writing key facts to notes costs about 4% more tokens per step
than plain compaction and keeps every constraint. The facts it still loses are
the ones the agent never wrote down: the notes file is only as good as the
agent's judgment about what matters.

## Where it breaks

- **Notes and pins depend on the model's judgment.** The agent decides what is
  a constraint and what is worth writing down. A constraint stated casually
  ("oh, and never email the vendor directly") may never be pinned. Explicit
  user corrections can be detected and pinned by the harness rather than left
  to the model.
- **The survival model is too kind.** Real summaries can also distort facts,
  merging two numbers or inverting a condition, which is worse than losing
  them. Test compaction prompts by asking questions about the summarized
  history, like any other eval.
- **External memory has its own eval problem.** A memory store that is never
  measured for recall and staleness degrades silently. Treat it as a retrieval
  system with a labeled test set.
- **Multi-agent savings assume independence.** The token arithmetic above
  holds only when workers need a brief and not the whole history. Tightly
  coupled work split across agents costs more and fails more.
- **Bigger windows move the limits, not the problems.** Cost per step and
  attention effects still grow with length, and a larger window lets a bad
  context design run longer before it fails.

## Remember this

- The context window is working memory: keep it small, ordered for the cache, and rebuilt deliberately.
- Clearing used tool results is the cheapest compression; compaction is lossy and compounds.
- Pin goals, constraints, and corrections verbatim; write findings to notes before they can be summarized away.
- Memory is a data system: records have scope, provenance, expiry, an owner, and a delete path.
- Gate memory writes by provenance; untrusted content must not write trusted memory.
- Split into agents for independence, isolation, privilege, or verification; specify the brief and the report.

## Try it

1. Run `memory.py`. Set `KEEP = 0.95` and then `0.7`. How does the gap between
   plain compaction and pinning change?
2. Lower `COMPACT_AT` to 50,000. How many compactions happen, how many facts
   survive, and what would the extra compactions cost in prompt-cache misses?
3. Add a "poisoned" fact that arrives from untrusted content and is written to
   notes with probability 0.9. Add a provenance check that refuses it. What
   does the check cost in recall of legitimate facts if it also refuses 10% of
   them by mistake?
4. Recompute the multi-agent arithmetic for 4 workers of 30 steps each. When
   does splitting stop saving tokens?
5. Write the memory record schema for a support agent's user memory, including
   what makes a record expire and how deletion cascades.

## Check yourself

1. Name the three separate problems a long context causes.

   {{< details summary="Show answer" >}}
   Capacity (the hard window limit), cost and latency (every token re-read on
   every step, quadratic total input), and attention (information in the
   middle of a long context is used less reliably, and stale content
   misleads), which sets in well before the window is full.
   {{< /details >}}

2. Why should compaction happen at a threshold rather than every few steps?

   {{< details summary="Show answer" >}}
   Each compaction rewrites the middle of the context, so the next step's input
   misses the prompt cache, and each round compounds information loss. Fewer,
   well-placed compactions keep cache hits high and losses low.
   {{< /details >}}

3. A similarity search over user memories returns another tenant's record.
   Where is the bug?

   {{< details summary="Show answer" >}}
   The tenant scope was not applied inside the index query. Filtering after
   top-k retrieval both leaks candidates into application code and can return
   too few results; the tenant and user filter must be part of the query so
   other tenants' records are never candidates.
   {{< /details >}}

4. When can splitting work across agents reduce total tokens?

   {{< details summary="Show answer" >}}
   When the subtasks are independent enough that each worker needs only a short
   brief. Total input grows quadratically with the length of one context, so
   several short contexts can cost less than one long one. If workers need the
   parent's full history, the advantage disappears.
   {{< /details >}}

5. Why does tree search help on coding tasks but often not on open-ended
   writing?

   {{< details summary="Show answer" >}}
   Search needs a reliable scorer to choose among candidates. Running tests
   gives coding tasks one; for open-ended writing the scorer is usually another
   model call with its own biases, so search amplifies the scorer's errors at
   several times the cost.
   {{< /details >}}

## Sources

- N. F. Liu et al., [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172), *Transactions of the ACL*, 2024.
- J. S. Park et al., [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442), UIST 2023.
- C. Packer et al., [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560), 2023.
- S. Yao et al., [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629), ICLR 2023.
- N. Shinn et al., [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366), NeurIPS 2023.
- S. Yao et al., [Tree of Thoughts: Deliberate Problem Solving with Large Language Models](https://arxiv.org/abs/2305.10601), NeurIPS 2023.
- J. Hadfield et al., [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), Anthropic, June 2025.
- M. Cemri et al., [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657), 2025.
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), September 2025.
