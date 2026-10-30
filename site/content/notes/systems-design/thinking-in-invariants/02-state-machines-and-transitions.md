+++
title = 'State machines and transitions'
description = 'Orders, tokens, and sessions all have lifecycles. Make each lifecycle an explicit state machine, reject every transition not in the table, and check the reachable states exhaustively.'
question = 'Why model entities as explicit state machines, and how do you find the illegal transitions?'
weight = 2
difficulty = 2
prerequisites = ['/notes/systems-design/thinking-in-invariants/01-what-a-design-promises']
date = 2026-09-14
lastmod = 2026-09-14
verified = 2026-09-14
+++

## The idea in one minute

Almost every entity a service stores has a lifecycle. An order is created,
authorized, captured, perhaps refunded. A password reset token is issued, then
used, expired, or revoked. A session is active, then idle, then expired or
revoked. When the lifecycle is implicit, spread across booleans and timestamps
like `is_paid`, `refunded_at`, and `cancelled`, the code can reach combinations
nobody intended: a cancelled order that is also captured, a used token that
still validates.

Make the lifecycle explicit instead. Name the states. Write the allowed
transitions as a table of (state, event) pairs, each with a guard and an effect.
Reject everything not in the table. Then, because the table is data, a program
can walk every reachable state and check the invariants in each one, and print
the shortest sequence of events that breaks one.

The consequence to act on: **an illegal transition is a bug, and often a
security hole**. Replaying a one-time code, refunding twice, and skipping a
handshake step are all transitions that should not exist. Deny them by default
and enforce the table where the state is stored.

## A picture

```mermaid {title="A payment order, with one transition that should not exist"}
flowchart LR
  C["<b>CREATED</b>"] -->|authorize| A["<b>AUTHORIZED</b>"]
  C -->|cancel| X["<b>CANCELLED</b><br/><small>terminal</small>"]
  A -->|void| V["<b>VOIDED</b><br/><small>terminal</small>"]
  A -->|"capture(total)"| P["<b>CAPTURED</b>"]
  P -->|"refund(n), partial"| P
  P -->|"refund(n), last unit"| R["<b>REFUNDED</b><br/><small>terminal</small>"]
  X -.->|"reopen (added later)"| C
  class C neutral
  class A,P compute
  class X,V,R good
  linkStyle 6 stroke-dasharray: 4 4
```

The dashed edge is the kind of change that arrives through a support tool
months after the design: harmless-looking, and it breaks the promise that a
terminal state stays terminal.

## How it really works

### Boolean soup

Consider an order stored with three flags: `authorized`, `captured`,
`cancelled`. Three booleans give eight combinations. The business has perhaps
four meaningful states. The other four are reachable whenever two code paths
set flags independently:

| authorized | captured | cancelled | Meaning |
| --- | --- | --- | --- |
| no | no | no | Created |
| yes | no | no | Authorized |
| yes | yes | no | Captured |
| no | no | yes | Cancelled |
| no | yes | no | Captured without authorization: a bug |
| yes | yes | yes | Captured and cancelled: refund owed or not? |
| yes | no | yes | Authorized then cancelled: was the hold released? |
| no | yes | yes | Nobody knows |

Three independent flags span eight combinations; only the four on the left were ever designed.

```mermaid {title="Three booleans reach eight states, and half of them are bugs"}
flowchart LR
  F["<b>authorized, captured, cancelled</b><br/><small>set by different code paths</small>"]
  subgraph D["Designed"]
    C1["Created"]
    C2["Authorized"]
    C3["Captured"]
    C4["Cancelled"]
  end
  subgraph N["Nobody designed"]
    B1["Captured without authorization"]
    B2["Captured and cancelled"]
    B3["Authorized then cancelled"]
    B4["Captured and cancelled, never authorized"]
  end
  F --> D
  F --> N
  class C1,C2,C3,C4 good
  class B1,B2,B3,B4 warn
```

Every row below the line is a question someone will eventually have to answer
during an incident. A single `state` column with an enumerated type makes those
rows unrepresentable. Fields that only make sense in some states, such as the
captured amount, then belong to those states, and the invariants relating them
become short: "refunded never exceeds captured, which never exceeds the order
total".

### The transition table

A transition table maps a (state, event) pair to a guard and an effect:

| From | Event | Guard | To |
| --- | --- | --- | --- |
| CREATED | authorize | payment provider approved | AUTHORIZED |
| CREATED | cancel | none | CANCELLED |
| AUTHORIZED | void | none | VOIDED |
| AUTHORIZED | capture(n) | n equals the order total | CAPTURED |
| CAPTURED | refund(n) | refunded + n ≤ captured | CAPTURED, or REFUNDED when fully refunded |

The same table drawn as a lifecycle: every edge carries its guard, and the three terminal states lead only to the end.

```mermaid {title="The transition table as a lifecycle with guards on the edges"}
stateDiagram-v2
  direction LR
  [*] --> CREATED
  CREATED --> AUTHORIZED : authorize, provider approved
  CREATED --> CANCELLED : cancel
  AUTHORIZED --> VOIDED : void
  AUTHORIZED --> CAPTURED : capture n, n equals total
  CAPTURED --> CAPTURED : refund n, running total below captured
  CAPTURED --> REFUNDED : refund n, running total reaches captured
  CANCELLED --> [*]
  VOIDED --> [*]
  REFUNDED --> [*]
```

Three rules make the table a security control rather than documentation:

1. **Deny by default.** A pair that is not in the table is rejected with an
   error, not ignored and not handled by a fallback branch. `refund` in
   CREATED is not a no-op; it is an attempted illegal transition worth logging.
2. **Guards check cumulative state, not just the request.** "This refund is no
   larger than the captured amount" is a per-request check, and two refunds pass
   it while together exceeding the capture. "Refunds so far plus this refund are
   no larger than the captured amount" is the invariant. The code below finds
   exactly that bug.
3. **Terminal states have no outgoing edges.** A used token, a voided
   authorization, and a revoked session stay that way. If the business needs
   "reopen", it creates a new entity linked to the old one, so the old history
   remains true.

David Harel's statecharts (1987) extend this with hierarchy and parallel
regions, which helps once a lifecycle has dozens of states. Most service
entities never need more than a flat table.

### Single-use and terminal states in security protocols

Many security mechanisms are state machines whose whole value is a terminal
state. OAuth 2.0 (RFC 6749, section 4.1.2) says a client must not use an
authorization code more than once, and that if a code is used more than once
the authorization server must deny the request and should revoke all tokens
previously issued from that code. In state-machine terms: ISSUED → REDEEMED is
the only legal redemption, REDEEMED is terminal, and an attempted
REDEEMED → REDEEMED is treated as evidence of theft, not as a retry.

This is the attack the rule is written for: the code leaks, two parties redeem it, and the second redemption is the alarm.

```mermaid {title="A second redemption of an authorization code is evidence of theft"}
sequenceDiagram
  autonumber
  participant C as Client
  actor A as Attacker
  participant AS as Authorization server
  Note over C,A: both hold the same code
  A->>AS: redeem code
  AS-->>A: tokens issued, code is now REDEEMED
  C->>AS: redeem code
  Note over AS: REDEEMED to REDEEMED is not in the table
  AS-->>C: denied
  AS->>AS: revoke the tokens issued from this code
```

The same shape appears throughout authentication:

| Entity | States | The transition that must not exist |
| --- | --- | --- |
| Password reset token | ISSUED → USED, EXPIRED, REVOKED | USED → USED (replay of a leaked link) |
| Authorization code | ISSUED → REDEEMED, EXPIRED | REDEEMED → REDEEMED |
| Session | ACTIVE → IDLE → ACTIVE; any → REVOKED, EXPIRED | REVOKED → ACTIVE (a cached validation that never rechecks) |
| MFA challenge | PENDING → PASSED, FAILED, EXPIRED | PENDING → PASSED without a verified factor; FAILED → PENDING without a new challenge |
| Account recovery | REQUESTED → VERIFIED → RESET | REQUESTED → RESET (skipping verification) |

The last row is a pattern worth naming: **skipping a state**. Multi-step flows
such as checkout, recovery, and onboarding often enforce order only in the
user interface. If the server accepts the final step without checking that the
entity is in the state the previous step produces, an attacker calls the final
step directly. Session lifecycles are covered in
[the lesson on sessions and cookies](/notes/application-security/authentication/02-sessions-and-cookies/),
and token mistakes in
[the lesson on tokens and JWT pitfalls](/notes/application-security/authentication/04-tokens-and-jwt-pitfalls/).

The server, not the user interface, has to hold the line: the attacker's request jumps straight to the last step.

```mermaid {title="Skipping a state: the server must check where the entity is"}
flowchart LR
  B("User in browser")
  X("Attacker")
  R["<b>1. Request</b><br/><small>REQUESTED</small>"]
  V["<b>2. Verify</b><br/><small>VERIFIED</small>"]
  G@{ shape: diam, label: "State is VERIFIED?" }
  P["<b>3. Reset</b><br/><small>RESET</small>"]
  N["<b>Reject and log</b>"]
  B --> R --> V --> G
  X -->|"calls step 3 directly"| G
  G -->|yes| P
  G -->|no| N
  class G,N good
  class R,V,P neutral
```

Protocol implementations have the same failure. In 2015, Beurdouche and
colleagues tested TLS libraries against the protocol's composite state machine
and found implementations that accepted messages out of order or allowed
required messages to be skipped; the FREAK attack exploited one such flaw, and
the SKIP-TLS family exploited others. In the same year, de Ruiter and Poll used
automated state learning to infer the state machines of TLS implementations and
found unexpected extra states and paths. Both papers reached the same lesson:
the specification described a state machine, and the code implemented a
different, larger one.

### Enforcing the table where the state lives

A table in application memory is not enough when two requests for the same
entity run at once. Both read CAPTURED, both decide a refund is allowed, and
both write. Make the transition a conditional write:

```sql {title="a transition as compare-and-set"}
UPDATE orders
   SET state = 'VOIDED', voided_at = now()
 WHERE id = $1
   AND state = 'AUTHORIZED';
-- 1 row updated: the transition happened.
-- 0 rows updated: the order was not AUTHORIZED; reject and report.
```

Two void requests race on the same order; the conditional write lets exactly one of them through.

```mermaid {title="A compare-and-set lets only one of two racing transitions through"}
sequenceDiagram
  autonumber
  participant R1 as Request 1
  participant R2 as Request 2
  participant DB as orders table
  Note over DB: order 42 is AUTHORIZED
  par both arrive together
    R1->>DB: set VOIDED where state is AUTHORIZED
  and
    R2->>DB: set VOIDED where state is AUTHORIZED
  end
  DB-->>R1: 1 row updated, the transition happened
  DB-->>R2: 0 rows updated
  R2->>R2: reject and report
```

The `WHERE state = ...` clause makes the guard and the write one atomic step.
For guards on amounts, such as cumulative refunds, put the arithmetic in the
same statement or lock the row inside a transaction. Recording every
transition in an append-only history table, with who triggered it and why,
turns "how did this order get here?" from archaeology into a query. Races of
this kind are the subject of
[the lesson on races and check-then-act](/notes/systems-design/concurrency-and-consistency/01-races-and-check-then-act/).

### Checking every reachable state

Because the table is data, a program can explore it. Start from the initial
state, apply every event with every argument the guard allows, and record each
new state. Continue until no new states appear. This is **explicit-state model
checking**, the technique behind TLC, the model checker for TLA+. Breadth-first
order has a useful property: the first time a bad state is found, the path to
it is a shortest one, which makes the counterexample easy to read.

Real data makes the state space infinite, so the checker bounds it: an order
total of 3 units instead of any amount. Daniel Jackson calls the bet behind
this the **small scope hypothesis**: most bugs have small counterexamples, so
exhaustively checking all small instances finds most of them. The refund bug
below needs only an order of 3 units and two refunds.

Breadth-first search from CREATED finds exactly these eight states for a 3-unit order with the good table; each row down is one more event.

```mermaid {title="Every reachable state of the good table for a 3-unit order"}
flowchart TB
  C["CREATED"] -->|authorize| A["AUTHORIZED"]
  C -->|cancel| X["CANCELLED"]
  A -->|void| V["VOIDED"]
  A -->|"capture(3)"| P0["CAPTURED<br/><small>refunded 0</small>"]
  P0 -->|"refund(1)"| P1["CAPTURED<br/><small>refunded 1</small>"]
  P0 -->|"refund(2)"| P2["CAPTURED<br/><small>refunded 2</small>"]
  P0 -->|"refund(3)"| R["REFUNDED<br/><small>refunded 3</small>"]
  P1 -->|"refund(1)"| P2
  P1 -->|"refund(2)"| R
  P2 -->|"refund(1)"| R
  class C neutral
  class A,P0,P1,P2 compute
  class X,V,R good
```

Four checks are worth running on every table:

| Check | What a failure means |
| --- | --- |
| Invariants hold in every reachable state | A safety bug, with a shortest trace |
| No transition leaves a terminal state | Replay, reopen, or resurrection |
| Every declared state is reachable | A missing transition or a dead state that hides a mistake |
| Every non-terminal state has a way out | A stuck entity: a liveness bug |

## Code

The order machine above, as a table of guards and effects, with a buggy
variant containing two plausible edits: a refund rule rewritten to compare
each request with the captured amount, and a "reopen" event for cancelled
orders. The checker explores every reachable (state, captured, refunded)
combination, stops at the first bad state on each path, and prints the shortest
trace for each kind of violation.

```python {title="orders.py"}
"""orders.py: a payment order as an explicit state machine, checked exhaustively.

The transition table is data. A breadth-first search walks every reachable
(state, captured, refunded) combination, checks invariants in each, and prints
the shortest event sequence that breaks one. Standard library only; offline.
"""

from __future__ import annotations

from collections import deque
from typing import Callable, NamedTuple

TOTAL = 3  # order amount in whole units; small so the search stays exhaustive


class S(NamedTuple):
    state: str
    captured: int = 0
    refunded: int = 0


Guard = Callable[[S, int], bool]
Apply = Callable[[S, int], S]
# (from_state, event) -> (guard, effect); n is the event's amount argument
Table = dict[tuple[str, str], tuple[Guard, Apply]]

ALWAYS: Guard = lambda s, n: True
TERMINAL = {"CANCELLED", "VOIDED", "REFUNDED"}

GOOD: Table = {
    ("CREATED", "authorize"): (ALWAYS, lambda s, n: s._replace(state="AUTHORIZED")),
    ("CREATED", "cancel"): (ALWAYS, lambda s, n: s._replace(state="CANCELLED")),
    ("AUTHORIZED", "void"): (ALWAYS, lambda s, n: s._replace(state="VOIDED")),
    ("AUTHORIZED", "capture"): (
        lambda s, n: n == TOTAL,
        lambda s, n: s._replace(state="CAPTURED", captured=n)),
    ("CAPTURED", "refund"): (
        lambda s, n: s.refunded + n <= s.captured,  # cumulative, not per request
        lambda s, n: s._replace(
            state="REFUNDED" if s.refunded + n == s.captured else "CAPTURED",
            refunded=s.refunded + n)),
}

# Two plausible edits. A rewrite of the refund rule compares each request to the
# captured amount instead of the running total (and forgets the move to
# REFUNDED); support tooling adds a "reopen" event for cancelled orders.
BUGGY: Table = dict(GOOD)
BUGGY[("CAPTURED", "refund")] = (
    lambda s, n: n <= s.captured,
    lambda s, n: s._replace(refunded=s.refunded + n))
BUGGY[("CANCELLED", "reopen")] = (ALWAYS, lambda s, n: s._replace(state="CREATED"))

EVENTS = ["authorize", "cancel", "void", "capture", "refund", "reopen"]
WITH_AMOUNT = {"capture", "refund"}


def moves(table: Table, s: S):
    """Every (label, next state) the table allows from s."""
    for event in EVENTS:
        rule = table.get((s.state, event))
        if rule is None:
            continue  # illegal transitions are simply not in the table
        for n in (range(1, TOTAL + 1) if event in WITH_AMOUNT else [0]):
            if rule[0](s, n):
                yield (f"{event}({n})" if event in WITH_AMOUNT else event), rule[1](s, n)


def invariants(prev: S | None, s: S) -> list[str]:
    bad = []
    if not 0 <= s.refunded <= s.captured <= TOTAL:
        bad.append(f"money: refunded {s.refunded} > captured {s.captured}"
                   if s.refunded > s.captured else f"money out of range: {s}")
    if prev is not None and prev.state in TERMINAL and s != prev:
        bad.append(f"terminal: left {prev.state} for {s.state}")
    return bad


def explore(table: Table, limit: int = 10_000):
    """BFS from the initial state. Returns reachable states, parents, violations."""
    start = S("CREATED")
    parent: dict[S, tuple[S, str] | None] = {start: None}
    violations: list[tuple[S, str, str]] = []  # (state before, event, message)
    queue = deque([start])
    while queue and len(parent) < limit:
        s = queue.popleft()
        for label, nxt in moves(table, s):
            broken = invariants(s, nxt)
            violations += [(s, label, msg) for msg in broken]
            if not broken and nxt not in parent:  # do not explore past a bad state
                parent[nxt] = (s, label)
                queue.append(nxt)
    return parent, violations


def trace(parent, s: S) -> str:
    steps = []
    while parent[s] is not None:
        s, label = parent[s]
        steps.append(label)
    return " -> ".join(reversed(steps)) or "(start)"


def report(name: str, table: Table) -> None:
    parent, violations = explore(table)
    states = {s.state for s in parent}
    declared = {f for f, _ in table} | TERMINAL
    stuck = {s.state for s in parent
             if s.state not in TERMINAL and not any(moves(table, s))}
    print(f"{name}: {len(parent)} reachable states, {len(violations)} violations")
    print(f"  states reached: {', '.join(sorted(states))}")
    if declared - states:
        print(f"  declared but unreachable: {', '.join(sorted(declared - states))}")
    if stuck:
        print(f"  non-terminal with no way out: {', '.join(sorted(stuck))}")
    shown = set()
    for before, label, msg in violations:
        kind = msg.split(":")[0]
        if kind not in shown:  # BFS order: the first of each kind is the shortest
            shown.add(kind)
            print(f"  VIOLATION {msg}")
            print(f"    shortest trace: {trace(parent, before)} -> {label}")


if __name__ == "__main__":
    report("good table", GOOD)
    print()
    report("buggy table", BUGGY)
```

Run it with `python3 orders.py`:

```text
good table: 8 reachable states, 0 violations
  states reached: AUTHORIZED, CANCELLED, CAPTURED, CREATED, REFUNDED, VOIDED

buggy table: 8 reachable states, 7 violations
  states reached: AUTHORIZED, CANCELLED, CAPTURED, CREATED, VOIDED
  declared but unreachable: REFUNDED
  VIOLATION terminal: left CANCELLED for CREATED
    shortest trace: cancel -> reopen
  VIOLATION money: refunded 4 > captured 3
    shortest trace: authorize -> capture(3) -> refund(1) -> refund(3)
```

The good table has eight reachable states: the four simple ones plus CAPTURED
with 0, 1, or 2 units refunded and REFUNDED with all 3. The buggy table
produces three findings from one run:

- **The shortest double refund is four events long**: authorize, capture all
  3 units, refund 1, refund 3. Each refund individually passes "no more than
  captured"; together they pay out 4 units on a 3-unit order. An attacker who
  finds this does not need a race or a clever payload, only two requests.
- **Cancel then reopen** leaves a terminal state. Whether that is exploitable
  depends on what CANCELLED released: a reserved item, a promotional code, a
  hold on funds. The checker cannot know; it can only report that the promise
  is broken.
- **REFUNDED is declared but unreachable.** The rewritten refund rule forgot
  to move the order to REFUNDED, so fully refunded orders stay in CAPTURED and
  remain refundable. A dead state in the report is often the clue to a missing
  transition.

The shortest double refund, event by event: each refund passes the per-request guard, and the last state breaks the money invariant.

```mermaid {title="The shortest counterexample: four events refund 4 units of a 3-unit order"}
flowchart LR
  S0["CREATED"] -->|authorize| S1["AUTHORIZED"]
  S1 -->|"capture(3)"| S2["CAPTURED<br/><small>refunded 0</small>"]
  S2 -->|"refund(1)<br/>1 ≤ 3 passes"| S3["CAPTURED<br/><small>refunded 1</small>"]
  S3 -->|"refund(3)<br/>3 ≤ 3 passes"| S4["<b>Money invariant broken</b><br/><small>refunded 4, captured 3</small>"]
  class S0,S1 neutral
  class S2,S3 compute
  class S4 warn
```

## Where it breaks

- **The model drifts from the code.** A checker over a table that the
  production code does not use proves nothing about production. Either drive
  the service from the same table, or generate both from one definition, or
  test the service against the table.
- **Small scope is a bet, not a proof.** A bug that needs an order of 1,000
  units with 17 partial refunds is outside a search bounded at 3. Integer
  overflow and rounding bugs in particular hide at large values.
- **Concurrency is not modeled.** The search applies one event at a time. Two
  refunds processed concurrently against a stale read can break the invariant
  even with the correct guard, unless the write is a compare-and-set or runs
  under a lock.
- **External effects are not transitions.** Moving an order to CAPTURED and
  charging the card are two actions in two systems. If the process crashes
  between them, the state machine and the payment provider disagree. The
  outbox pattern in
  [the lesson on exactly-once and the outbox](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/)
  addresses this.
- **Time-based transitions need a clock.** Expiry is an event that nobody
  sends. It needs a sweeper job or a check at read time, and either one
  depends on clocks that can be skewed across machines.
- **State explosion.** Each extra field multiplies the state space. Real
  checkers use symmetry reduction, abstraction, and careful bounds; past a
  certain size, a TLA+ or Alloy model is a better tool than a hand-written
  search.

## Remember this

- Give each entity one explicit state field; booleans multiply into states
  nobody designed.
- A transition table with guards is the specification; anything not in it is
  rejected.
- Guards check cumulative state, not just the current request.
- Terminal states have no outgoing edges; single-use credentials depend on it.
- Enforce transitions where the state is stored, with a conditional write.
- Exhaustive search over small instances finds shortest counterexamples cheaply.

## Try it

1. Run `orders.py`. Fix the buggy refund rule so the money invariant holds but
   leave the missing move to REFUNDED. Which finding remains, and is it still a
   security problem?
2. Add partial capture: `capture(n)` from AUTHORIZED allows any `n` up to the
   total and moves to CAPTURED. What new invariant do you need, and does the
   good refund guard still hold?
3. Model a password reset token with states ISSUED, USED, EXPIRED, REVOKED and
   a buggy `use` rule that only checks that the token is not EXPIRED. Have the
   checker print the replay trace.
4. Pick an entity in a system you work on whose state is stored as several
   flags or timestamps. List every combination and mark which ones are
   reachable today.

## Check yourself

1. Why is "deny by default" essential to a transition table?

   {{< details summary="Show answer" >}}
   The table is only a specification if everything outside it is rejected. If
   unlisted (state, event) pairs fall through to a default branch or are
   silently ignored, the real state machine is larger than the documented one,
   which is exactly how out-of-order and skipped-step bugs arise.
   {{< /details >}}

2. What is wrong with the guard "refund amount ≤ captured amount"?

   {{< details summary="Show answer" >}}
   It checks each request in isolation. Several refunds can each pass while
   their sum exceeds the capture. The guard must be cumulative: refunded so far
   plus this refund must not exceed the captured amount.
   {{< /details >}}

3. RFC 6749 says a reused authorization code should cause previously issued
   tokens to be revoked. Why not simply reject the second use?

   {{< details summary="Show answer" >}}
   A second redemption means two parties hold the code, and one of them is
   probably an attacker. The server cannot tell which one redeemed first, so the
   tokens already issued may be in the attacker's hands. Revoking them treats
   the illegal transition as evidence of compromise rather than a harmless
   retry.
   {{< /details >}}

4. Why does breadth-first search give the shortest counterexample?

   {{< details summary="Show answer" >}}
   BFS visits states in order of their distance from the initial state, so the
   first time it reaches a bad state, no shorter path to any bad state of that
   kind exists. Short traces are easier to understand and turn directly into
   regression tests.
   {{< /details >}}

5. Two requests try to void the same order at the same time. How does a
   conditional write keep the transition legal?

   {{< details summary="Show answer" >}}
   `UPDATE ... SET state = 'VOIDED' WHERE id = $1 AND state = 'AUTHORIZED'`
   checks and changes the state in one atomic step. The first request updates
   one row; the second finds the state is no longer AUTHORIZED, updates zero
   rows, and is rejected.
   {{< /details >}}

## Sources

- D. Harel, "Statecharts: A Visual Formalism for Complex Systems", *Science of
  Computer Programming* 8(3), 1987.
- D. Hardt (ed.), [RFC 6749: The OAuth 2.0 Authorization Framework](https://www.rfc-editor.org/rfc/rfc6749),
  IETF, October 2012. Section 4.1.2.
- B. Beurdouche, K. Bhargavan, A. Delignat-Lavaud, C. Fournet, M. Kohlweiss,
  A. Pironti, P.-Y. Strub, J. K. Zinzindohoue, "A Messy State of the Union:
  Taming the Composite State Machines of TLS", IEEE Symposium on Security and
  Privacy, 2015.
- J. de Ruiter and E. Poll, "Protocol State Fuzzing of TLS Implementations",
  USENIX Security Symposium, 2015.
- L. Lamport, *Specifying Systems: The TLA+ Language and Tools for Hardware and
  Software Engineers*, Addison-Wesley, 2002.
- D. Jackson, *Software Abstractions: Logic, Language, and Analysis*, MIT
  Press, 2006 (revised 2012).
