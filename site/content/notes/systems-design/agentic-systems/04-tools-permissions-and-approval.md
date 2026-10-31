+++
title = 'Tools, permissions, and approval'
description = 'An agent can do exactly what its tools and the policy around them allow. Classify every tool by effect, decide in code before each call, and when a human must approve, bind the approval to a digest of the exact action so it cannot be reused, stretched, or swapped.'
question = 'How do you decide what an agent may do, and how do you make a human approval mean what the human saw?'
weight = 4
difficulty = 4
prerequisites = ['/notes/systems-design/agentic-systems/01-the-agent-loop', '/notes/systems-design/agentic-systems/03-durable-execution', '/notes/ai-security-engineering/securing-agents/02-identity-and-authorization', '/notes/ai-security-engineering/securing-agents/03-architectural-defenses']
date = 2026-10-30T14:20:00Z
lastmod = 2026-10-30T14:20:00Z
verified = 2026-10-30
+++

## The idea in one minute

The model never acts. It proposes a tool call, and the harness decides whether
that call runs. So an agent's authority is the union of its tools, narrowed by
whatever the policy layer allows for this user, this task, and this moment.
Designing that layer is designing what the agent can do.

Three pieces carry the design. A **tool catalog** where each tool has a narrow
purpose and a declared **effect class** (read, reversible write, external, or
irreversible). A **policy decision point**, code outside the model, that
evaluates every proposed call against the caller's permissions, the task's
allowlist, budgets, and whether untrusted content has been seen. And an
**approval path** for the actions that need a person, in which the approval is
bound to a digest of the exact action, expires, is used once, and is given by
someone other than the requester. The consequence to act on: **an approval
that is not bound to the exact arguments authorizes whatever the agent does
next**, so bind it, and keep the number of approvals low enough that people
read them.

## A picture

```mermaid {title="Every proposed call passes the policy; some also need a bound approval"}
flowchart LR
  M["<b>Model proposes</b><br/><small>tool + arguments</small>"] --> PDP{"<b>Policy decision</b><br/><small>catalog, entitlement,<br/>taint, budgets</small>"}
  PDP -->|"deny"| DN["<b>Denied</b><br/><small>reason back to model</small>"]
  PDP -->|"allow"| EX["<b>Execute</b><br/><small>idempotency key</small>"]
  PDP -->|"needs approval"| PK[("<b>Park task</b><br/><small>action digest stored</small>")]
  PK --> UI["<b>Approval screen</b><br/><small>rendered by code<br/>from real arguments</small>"]
  UI --> H["<b>Human decides</b>"]
  H --> TK["<b>Signed token</b><br/><small>digest, approver,<br/>expiry, nonce</small>"]
  TK --> V{"<b>Executor checks</b><br/><small>digest matches,<br/>unused, unexpired</small>"}
  V -->|"match"| EX
  V -->|"mismatch"| DN
  class M compute
  class PDP,V good
  class DN neutral
  class EX compute
  class PK memory
  class UI,H,TK io
```

Two checks hold the line: the policy decision before anything runs, and the
executor's comparison of the approved digest with the action it is about to
run. The model can influence what is proposed; it cannot reach either check.

## How it really works

### Tools are the agent's authority

A tool is a function the harness will run on the model's behalf. Its design
decides most of the risk before any policy is written.

- **Narrow beats general.** `issue_refund(order_id, amount)` with a per-call
  limit enforced in code is safer, easier to approve, and easier for the model
  to use correctly than `run_sql(query)` or `http_request(url, body)`.
- **Declare the effect class** of each tool and keep it in the catalog the
  policy reads, not in the tool's description.
- **Validate arguments in code** against schemas and allowlists (recipient
  domains, repository names, path roots, amount ceilings).
- **Bound results.** Results are untrusted input to the next step; cap their
  size and mark their provenance.

| Effect class | Examples | Default |
| --- | --- | --- |
| **Read** | Search, read a file, look up an order | Allow within the user's entitlements |
| **Reversible write** | Write a draft, create a branch, stage a change | Allow within the task's scope |
| **External** | Send an email, post a comment, call a partner API | Approval, or allow to a fixed allowlist of recipients |
| **Irreversible** | Pay, delete, merge to production, change permissions | Approval, with limits; some never delegated |

The Model Context Protocol lets a server annotate tools with hints such as
`readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. The
specification says these are hints and should not be trusted from untrusted
servers. Use them to pre-fill your catalog, then set the effect class yourself;
[MCP and tool security](/notes/ai-security-engineering/securing-agents/05-mcp-and-tool-security/)
covers vetting and pinning servers.

### Whose permissions

An agent acting for a user should never be able to do more than that user, nor
more than the agent's own role allows, nor more than this task needs. The
effective permission is the **intersection** of the three. In practice the
harness exchanges the user's credential for a short-lived, down-scoped token
for each tool (OAuth 2.0 token exchange, RFC 8693, is the standard mechanism),
so the tool backend enforces the intersection even if the harness is wrong.
[Identity and authorization](/notes/ai-security-engineering/securing-agents/02-identity-and-authorization/)
covers the credential design.

### The policy decision point

The policy is a function evaluated before every call:

```text
decide(tool, args, principal_chain, task_type, session_taint, budgets)
  -> allow | deny(reason) | needs_approval(action_digest)
```

Design properties that matter at scale:

- **Deny by default.** A tool not in the task type's allowlist is denied, which
  is what makes adding a tool a reviewed change.
- **Outside the agent's reach.** The agent has no write access to policies, the
  catalog, approval settings, or its own instructions. An enforcement point the
  agent can modify is not one.
- **Fast and local.** It runs on every step of every task, so it must take
  milliseconds: policy compiled into the harness or a sidecar, not a remote
  call with its own failure modes. If it cannot be evaluated, the answer is
  deny.
- **Taint-aware.** Once untrusted content has entered the session, external and
  irreversible calls need approval even if they would otherwise be allowed;
  this is the "rule of two" from
  [architectural defenses](/notes/ai-security-engineering/securing-agents/03-architectural-defenses/),
  and the full rule is spelled out in
  [securing an agent platform](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/).
- **Versioned and tested.** Policies live in version control with tests for
  what they must allow and what they must deny, and the policy version is
  recorded with every decision.

### What an approval must bind

A human approval is a credential. If it says only "approved", the agent can
change the recipient, the amount, or the attachment after the human looked and
still run with approval. The fix is the one payment systems already use: EU
rules for strong customer authentication require **dynamic linking**, where
the authentication code is specific to the amount and the payee, and any change
to either invalidates it (Commission Delegated Regulation (EU) 2018/389,
Article 5). For agents, bind the approval to a **digest of a canonical form**
of everything that determines the effect:

| Bound field | Why |
| --- | --- |
| Tool name and every argument | The action itself |
| **Resolved references**: content hashes of attached files, IDs instead of "latest" | Stops time-of-check to time-of-use swaps, where the referenced thing changes after approval |
| Task ID and requesting principal | An approval for one task or user cannot be used in another |
| Policy version | An approval granted under one policy is not valid under another |
| Expiry | Old approvals do not linger |
| Nonce, consumed on use | One approval, one execution |

Canonicalization matters: sort keys, fix number and string encodings, and
resolve references before hashing, so harmless reordering does not void an
approval and meaningful changes always do. The token is signed by the approval
service, which holds the key; the executor verifies the signature, the expiry,
the nonce, and that the digest of the action it is about to run equals the
digest in the token.

The surrounding rules make the screen honest:

- **Render from the real arguments**, in code, never a model-written summary.
- **Show provenance**: "proposed after reading web page X".
- **Approver is a human other than the requester**, through a channel the agent
  cannot reach or message. OpenID's Client-Initiated Backchannel Authentication
  (CIBA) is one standard way to ask a user on a separate device, and it carries
  a `binding_message` so the user can match the prompt to the request.
- **Consume atomically with execution.** Mark the nonce used in the same
  transaction that records the intent to execute, and pass the step's
  idempotency key to the tool, so a crash between approval and effect neither
  loses the approval nor runs the action twice
  ([durable execution](/notes/systems-design/agentic-systems/03-durable-execution/)).

```mermaid {title="An approval is issued for a digest and consumed by the executor"}
sequenceDiagram
  autonumber
  participant A as Agent harness
  participant P as Policy
  participant S as Approval service
  actor H as Reviewer
  participant X as Executor
  A->>P: send_email to finance with q3.csv
  P-->>A: needs approval, digest d1
  A->>S: park task, request approval for d1
  S->>H: screen rendered from arguments and file hash
  H-->>S: approve
  S-->>A: token signed over d1, expiry, nonce
  A->>X: execute action with token
  rect rgb(226, 239, 216)
    Note over X: recompute digest of the action, compare with d1, consume nonce
  end
  X-->>A: executed once, audit record written
```

### Approvals are a queue

Approvals are work for people, and they behave like any queue. Size them like
one:

```text
20,000 tasks per day, 6% need approval, 1.2 approvals each   = 1,440 approvals per day
peak hour at 3 × the average hourly rate                     = 180 approvals per hour
60 seconds of real review each                               = 3 reviewers fully busy at peak
for a short wait, keep reviewers below ~70% utilization      = 4 to 5 reviewers on shift
```

[Little's law](/notes/systems-design/scale-and-performance/01-queueing-and-littles-law/) gives the other side: tasks parked = approval arrival rate ×
waiting time. At 180 per hour and a 20-minute median wait, about 60 tasks are
parked at any moment, each holding a checkpoint and perhaps a sandbox
snapshot.

The failure mode is **approval fatigue**. When prompts are frequent, people
approve without reading, and an approval rate near 100% with a median decision
time of a few seconds means the control has gone, even though it still appears
in every diagram. Watch three numbers per action class: approval rate, time to
decision, and approvals per reviewer per hour. Reduce volume by changing the
design rather than asking people to try harder:

- **Prefer reversibility.** A draft, a branch, or a staged change reviewed once
  as a whole replaces many small approvals.
- **Tighten tools.** An allowlist of recipients turns "approve every email" into
  "approve emails to new recipients".
- **Approve plans, not keystrokes**, where the plan's steps are bound: approve
  "refund these three orders for these amounts", producing three bound
  digests, not "refunds are fine".

Every approval request needs a timeout with a defined outcome (cancel,
escalate, or the safe alternative), and a refusal goes back to the model as an
observation, like any denial.

### The audit record

Every decision, not just every execution, is a row:

```text
time, task_id, step, tool, args_digest, args (or a reference, if sensitive),
principal chain (user, agent, delegations), policy_version, decision, reason,
taint, approval: approver, token nonce, rendered screen hash, decision time,
execution result, idempotency key
```

With this, "why did the agent do that?" has an answer that does not depend on
anyone's memory, and the approval metrics above come from a query. The
tamper-evidence of such a log is its own design, covered in
[a tamper-evident audit log](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/).

## Code

The program has two parts. A policy function classifies proposed calls by
effect class and limit. An approval service issues HMAC-signed tokens over a
canonical digest that includes the content hash of the attachment and the
policy version, and the executor accepts a call only if the token is genuine,
unexpired, unused, and matches the action exactly. The clock and services are
simulated.

```python {title="approval.py"}
"""approval.py: an action policy and approvals bound to the exact action.

The policy is code: it classifies each proposed tool call by effect and either
allows it, denies it, or requires an approval. An approval is an HMAC-signed
token over a canonical digest of the action (tool, arguments, task, requester,
policy version, and the content hash of anything referenced). The executor
runs a call only if a valid, unexpired, unused token matches it exactly.
Simulated clock and services; standard library only; runs offline.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass, field

POLICY_VERSION = "2026-10-30.1"
TOOLS = {   # effect class per tool; anything not listed is denied
    "read_file": "read",
    "search_tickets": "read",
    "write_draft": "reversible",
    "send_email": "external",
    "issue_refund": "irreversible",
}
APPROVAL_TTL = 900          # seconds an approval stays valid
SIGNING_KEY = secrets.token_bytes(32)   # held by the approval service only
FILES = {"q3.csv": b"region,revenue\nwest,410\neast,385\n"}


def decide(tool: str, args: dict) -> str:
    effect = TOOLS.get(tool)
    if effect is None:
        return "deny: unknown tool"
    if tool == "issue_refund" and args.get("amount", 0) > 500:
        return "deny: over the per-call limit"
    if effect in ("read", "reversible"):
        return "allow"
    return "needs approval"


def digest(action: dict) -> str:
    """Canonical form: sorted keys, no whitespace, references resolved to hashes."""
    resolved = dict(action)
    if "attachment" in action["args"]:
        name = action["args"]["attachment"]
        resolved["attachment_sha256"] = hashlib.sha256(FILES[name]).hexdigest()
    resolved["policy"] = POLICY_VERSION
    blob = json.dumps(resolved, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


@dataclass
class ApprovalService:
    used: set[str] = field(default_factory=set)

    def approve(self, action: dict, approver: str, now: int) -> dict:
        if approver == action["requester"] or approver.startswith("agent:"):
            raise PermissionError("approver must be a human other than the requester")
        body = {"digest": digest(action), "approver": approver,
                "expires": now + APPROVAL_TTL, "nonce": secrets.token_hex(8)}
        mac = hmac.new(SIGNING_KEY, json.dumps(body, sort_keys=True).encode(),
                       hashlib.sha256).hexdigest()
        return {**body, "mac": mac}

    def consume(self, token: dict, action: dict, now: int) -> str:
        body = {k: token[k] for k in ("digest", "approver", "expires", "nonce")}
        mac = hmac.new(SIGNING_KEY, json.dumps(body, sort_keys=True).encode(),
                       hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mac, token["mac"]):
            return "reject: bad signature"
        if now > token["expires"]:
            return "reject: approval expired"
        if token["nonce"] in self.used:
            return "reject: approval already used"
        if token["digest"] != digest(action):
            return "reject: action differs from what was approved"
        self.used.add(token["nonce"])          # single use, consumed atomically
        return "execute"


def main() -> None:
    print("policy decisions:")
    for tool, args in [("read_file", {"path": "q3.csv"}),
                       ("write_draft", {"to": "finance@example.com"}),
                       ("send_email", {"to": "finance@example.com"}),
                       ("issue_refund", {"order": "A-17", "amount": 900}),
                       ("run_shell", {"cmd": "curl ..."})]:
        print(f"  {tool:<14}{decide(tool, args)}")

    svc = ApprovalService()
    act = {"tool": "send_email", "task": "t-42", "requester": "agent:reports",
           "args": {"to": "finance@example.com", "subject": "Q3 summary",
                    "attachment": "q3.csv"}}
    print("\nexecutor decisions for send_email:")
    tok = svc.approve(act, "user:dana", now=1_000)
    same_but_reordered = json.loads(json.dumps(act, sort_keys=True))
    print(f"  1. the approved call (keys reordered)  {svc.consume(tok, same_but_reordered, 1_060)}")
    print(f"  2. the same token again                {svc.consume(tok, act, 1_070)}")

    tok = svc.approve(act, "user:dana", now=2_000)
    changed = {**act, "args": {**act["args"], "to": "finance@exarnple.com"}}
    print(f"  3. recipient changed after approval    {svc.consume(tok, changed, 2_030)}")

    tok = svc.approve(act, "user:dana", now=3_000)
    FILES["q3.csv"] += b"note,see attached instructions\n"   # edited after approval
    print(f"  4. attachment edited after approval    {svc.consume(tok, act, 3_030)}")

    tok = svc.approve(act, "user:dana", now=4_000)
    print(f"  5. used 20 minutes later               {svc.consume(tok, act, 5_200)}")

    tok = svc.approve(act, "user:dana", now=6_000)
    forged = {**tok, "digest": digest(changed)}
    print(f"  6. digest swapped in the token         {svc.consume(forged, changed, 6_010)}")
    try:
        svc.approve(act, "agent:reports", now=7_000)
    except PermissionError as e:
        print(f"  7. agent approves its own call         refused: {e}")


if __name__ == "__main__":
    main()
```

Run it with `python3 approval.py`:

```text
policy decisions:
  read_file     allow
  write_draft   allow
  send_email    needs approval
  issue_refund  deny: over the per-call limit
  run_shell     deny: unknown tool

executor decisions for send_email:
  1. the approved call (keys reordered)  execute
  2. the same token again                reject: approval already used
  3. recipient changed after approval    reject: action differs from what was approved
  4. attachment edited after approval    reject: action differs from what was approved
  5. used 20 minutes later               reject: approval expired
  6. digest swapped in the token         reject: bad signature
  7. agent approves its own call         refused: approver must be a human other than the requester
```

Case 1 shows canonicalization doing its job: the same action with its keys in
a different order produces the same digest and executes. Case 3 is the
look-alike domain (`exarnple`), a change a tired reviewer might miss but a
digest cannot. Case 4 is the time-of-use swap: nothing in the arguments
changed, only the file they point to, and the approval is void because the
digest included the file's content hash. Case 6 shows why the token is signed:
editing the digest inside the token to match a different action breaks the
signature.

## Where it breaks

- **Binding does not make the human right.** A reviewer who approves a
  well-formed, malicious action has authorized it, and a hijacked agent can
  make an action look reasonable. Provenance on the screen, rare prompts, and
  the rule of two are what improve the decision; binding only ensures the
  decision applies to what was shown.
- **Canonicalization bugs cut both ways.** If two encodings of a meaningful
  difference hash the same, binding fails open; if harmless differences change
  the hash, every approval is voided and people learn to retry blindly. Test
  the canonical form like a parser.
- **References are hard to resolve completely.** A file hash binds the file,
  but not the web page the email links to or the state of the database a query
  will touch. Bind what you can resolve, and say on the screen what is not
  bound.
- **The policy is only as good as the catalog.** A tool misclassified as
  "read" bypasses every approval rule. Effect classes need review when a tool
  changes, and tools whose effect depends on their arguments (`http_request`)
  should be split or classified by their worst case.
- **The demo keeps state in memory.** A real approval service persists used
  nonces durably and consumes them in the same transaction as recording the
  intent to execute; otherwise a crash can replay a token.

## Remember this

- The model proposes; code decides. An agent's authority is its tools, narrowed by policy.
- Give every tool a narrow purpose and an effect class you set yourself.
- Effective permission is user ∩ agent ∩ task, enforced by scoped tokens at the backend too.
- Bind an approval to a digest of the exact action, resolved references, task, and policy version; make it expire and single-use.
- Approvals are a queue staffed by people; measure approval rate and decision time, and redesign to ask less.
- Log every decision with the policy version and the approval that allowed it.

## Try it

1. Run `approval.py`. Remove `attachment_sha256` from the digest. Which case
   now executes, and what would the reviewer have approved?
2. Add an `amount` argument to `issue_refund` approvals and show that a token
   approved for 120 cannot execute a refund of 1,200.
3. Persist `used` nonces to a file and simulate a crash after `consume` but
   before execution. Then make consumption and "intent recorded" a single
   write. What does the second version guarantee that the first does not?
4. Recompute the reviewer staffing for 100,000 tasks per day with 2% needing
   approval and 90 seconds per review. What design change would halve it?
5. For an agent you run, list its tools with effect classes. Which one is
   classified by its best case rather than its worst?

## Check yourself

1. Why is "approved: yes" on a task not enough?

   {{< details summary="Show answer" >}}
   It authorizes whatever the agent runs next. The agent, or text that has
   steered it, can change recipients, amounts, or attachments after the
   human looked. An approval must be bound to a digest of the exact action so
   any change voids it.
   {{< /details >}}

2. Why include the content hash of a referenced file in the digest?

   {{< details summary="Show answer" >}}
   The arguments name the file, not its contents. If the file changes between
   approval and execution, the arguments are identical but the effect is not.
   Hashing the resolved content closes that time-of-check to time-of-use gap.
   {{< /details >}}

3. Why must the policy decision point be outside the agent's writable state?

   {{< details summary="Show answer" >}}
   An agent that can edit its policy, catalog, or approval settings can be
   induced to switch them off, after which every other control is moot. Past
   vulnerabilities in coding assistants worked exactly this way, through
   writable workspace settings.
   {{< /details >}}

4. The approval rate for an action class is 99.7% and the median decision time
   is 3 seconds. What do you conclude and do?

   {{< details summary="Show answer" >}}
   Nobody is reading; the control exists on paper only. Reduce volume by
   design: allowlist routine cases, move to reversible drafts reviewed as a
   whole, or approve bound plans, so the remaining prompts are rare enough to
   be read.
   {{< /details >}}

5. How do approvals and idempotency keys work together under crashes?

   {{< details summary="Show answer" >}}
   The approval's nonce is consumed in the same durable write that records the
   intent to execute, and the step's idempotency key goes to the tool. A crash
   before the write leaves the approval unused; a crash after it resumes
   execution with the same key, so the action happens once and the approval
   cannot be replayed.
   {{< /details >}}

## Sources

- Model Context Protocol, [Specification: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), including tool annotations, June 2025.
- M. Jones et al., [RFC 8693: OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693), IETF, January 2020.
- T. Lodderstedt, J. Richer, B. Campbell, [RFC 9396: OAuth 2.0 Rich Authorization Requests](https://www.rfc-editor.org/rfc/rfc9396), IETF, May 2023.
- OpenID Foundation, [OpenID Connect Client-Initiated Backchannel Authentication Flow, Core 1.0](https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html), 2021.
- European Commission, [Commission Delegated Regulation (EU) 2018/389](https://eur-lex.europa.eu/eli/reg_del/2018/389/oj), regulatory technical standards for strong customer authentication, Article 5 (dynamic linking).
- J. H. Saltzer, M. D. Schroeder, "The Protection of Information in Computer Systems", *Proceedings of the IEEE* 63(9), 1975 (least privilege, complete mediation).
- OWASP GenAI Security Project, [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/), December 2025.
- E. Debenedetti et al., [Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) (CaMeL), 2025.
