+++
title = 'Distributed transactions'
description = 'Two-phase commit makes several machines commit or abort together, but a participant that has voted yes cannot decide alone. Replicating the coordinator, as Spanner does, is what removes the blocking.'
question = 'How do you commit one transaction across several machines, and what happens when the coordinator fails mid-commit?'
weight = 4
difficulty = 5
prerequisites = ['/notes/systems-design/distributed-data/01-consensus-and-raft', '/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox']
date = 2026-10-30T07:20:00Z
lastmod = 2026-10-30T07:20:00Z
verified = 2026-10-30
+++

## The idea in one minute

A distributed transaction changes data on several machines, and **atomic
commit** means either every machine commits or none does. **Two-phase commit
(2PC)** does it with a coordinator. In phase one it asks every participant to
**prepare**: make the changes durable but invisible, keep the locks, and vote.
In phase two it logs the decision and tells everyone to commit or abort.

The weak point is the moment after a participant votes yes. It has promised to
commit if asked, so it may not abort on its own, and it does not know whether
anyone voted no, so it may not commit on its own. If the coordinator crashes
then, the participant is **blocked**, holding locks, until the coordinator
returns. That is why 2PC has a bad reputation, and why the systems that use it
at scale (Spanner, CockroachDB, and others) store the coordinator's state in a
consensus group so another replica can finish the job. **Use 2PC only when the
coordinator's decision is replicated, keep transactions short because locks are
held for at least two round trips, and prefer one partition or a saga when the
invariant allows it.**

## A picture

```mermaid {title="Two-phase commit: the decision is one forced log record"}
sequenceDiagram
  autonumber
  participant C as Coordinator
  participant A as Participant A
  participant B as Participant B
  C->>A: PREPARE
  C->>B: PREPARE
  A->>A: log PREPARED (fsync), keep locks
  B->>B: log PREPARED (fsync), keep locks
  A-->>C: vote yes
  B-->>C: vote yes
  rect rgb(249, 226, 233)
    Note over A,B: in doubt: may neither commit nor abort alone
  end
  C->>C: log COMMIT (fsync): the transaction is now committed
  C->>A: COMMIT
  C->>B: COMMIT
  A-->>C: ack, release locks
  B-->>C: ack, release locks
```

Steps 3 to 9 are the window in which a coordinator crash leaves A and B
holding locks they cannot release.

## How it really works

### The protocol and its logs

2PC goes back to Jim Gray's 1978 notes and Lampson and Sturgis's work in the
1970s, and Bernstein, Hadzilacos, and Goodman's 1987 book gives the standard
treatment. Each step is defined by what is forced to disk before the next
message is sent:

| Step | Who | Forced log record | After it, the node may |
| --- | --- | --- | --- |
| Prepare | Each participant | `PREPARED` with the transaction's changes | Not abort or commit alone |
| Decide | Coordinator | `COMMIT` or `ABORT` | Tell anyone the outcome; this record **is** the outcome |
| Finish | Each participant | `COMMITTED` or `ABORTED` | Release locks |
| End | Coordinator | `END` (not forced) | Forget the transaction |

A participant that votes **no** may abort immediately, since the transaction
cannot commit without it. A participant that has not voted yet may also abort
unilaterally. Only a prepared participant is stuck.

### The blocking window

Where the coordinator crashes decides who is stuck:

| Coordinator crashes | Participants know | Outcome |
| --- | --- | --- |
| Before sending PREPARE | Nothing; nobody has voted | Any participant may abort |
| After some votes, before deciding | Prepared ones are in doubt | On recovery, no decision in the log, so abort |
| After logging COMMIT, before sending | All prepared, all in doubt | Blocked until the coordinator returns |
| After sending COMMIT to some | Some committed, others in doubt | The in-doubt ones can ask the ones that know |

**Presumed abort**, used by most implementations, says that a coordinator with
no decision record for a transaction treats it as aborted. It saves forced
writes and messages for aborts and makes recovery simple.

The **cooperative termination protocol** lets an in-doubt participant ask the
others. If anyone has committed or aborted, or has not yet voted (and so can
abort), the asker learns the outcome. If every participant is prepared and none
knows the decision, nobody can finish: the decision exists only on the
coordinator's disk.

```mermaid {title="A prepared participant's states: only a message can move it forward"}
stateDiagram-v2
  direction LR
  [*] --> Working
  Working --> Aborted: votes no, or not yet voted and asked
  Working --> Prepared: logs PREPARED, votes yes
  Prepared --> Committed: COMMIT from coordinator or a peer
  Prepared --> Aborted: ABORT from coordinator or a peer
  Prepared --> Prepared: timeout, nobody knows, locks still held
  Committed --> [*]
  Aborted --> [*]
```

### Why three-phase commit did not fix it

Skeen's three-phase commit (1981) adds a pre-commit phase so that participants
can always decide among themselves if the coordinator fails. It is
non-blocking only if failures can be detected reliably and the network does
not partition. In a partition, one side can decide commit and the other
abort. Real networks partition, and timeouts cannot tell a crashed node from a
slow one, so 3PC sees little use.

### The real fix: make the coordinator a replicated state machine

The blocking comes from the decision living on one machine. Put it in a
consensus group and any replica can finish the protocol. Gray and Lamport's
**Paxos Commit** (2006) formalizes this, and production systems do a simpler
version of it:

- **Spanner** (Corbett et al., 2012) shards data into Paxos groups. A
  transaction's participants are groups, not machines, and one of them acts
  as coordinator. Every 2PC log record, `PREPARED` and the decision, is a
  Paxos write, so a leader failure inside any group is handled by an election
  and the protocol continues.
- **CockroachDB** writes a transaction record into the Raft group of the
  transaction's first key and lays down write intents in other ranges. A
  reader that encounters an intent looks up the transaction record to see
  whether it committed. Its parallel-commit protocol avoids one consensus
  round trip by treating a transaction as committed once its record and all
  its writes are durably replicated.

The price is latency: every forced log write is now a consensus commit, a
round trip to a majority plus fsync, as in the [Raft lesson](/notes/systems-design/distributed-data/01-consensus-and-raft/).

### Snapshot isolation without a coordinator process: Percolator

Google's **Percolator** (Peng and Dabek, 2010) built cross-row transactions on
Bigtable, which offers only single-row atomicity. A central **timestamp oracle**
hands out monotonically increasing timestamps. The client acts as
coordinator: it picks one written cell as the **primary**, writes locks on all
cells (prewrite), then commits by replacing the primary's lock with a write
record at a commit timestamp. The primary is the single point of truth: a
transaction is committed exactly when its primary is. Secondary locks are
cleaned up lazily, and a reader that finds a stale lock checks the primary to
decide whether to roll it forward or back. TiDB's transaction model follows
Percolator.

### Ordering across machines: TrueTime and commit wait

External consistency (strict serializability) needs commit timestamps that
respect real time: if T1 commits before T2 starts, T1's timestamp must be
smaller. Spanner gets this from **TrueTime**, an API that returns an interval
`[earliest, latest]` guaranteed to contain the true time, built on GPS and
atomic clocks in each data center. The paper reports an uncertainty bound ε
that is typically between about 1 and 7 ms. A transaction picks a commit
timestamp no earlier than `latest`, then **waits** until `earliest` has passed
that timestamp before releasing locks and acknowledging. Commit wait costs
about 2ε per transaction, and it overlaps with the Paxos round trip. Systems
without such clocks use a timestamp oracle (Percolator, TiDB) or hybrid
logical clocks with an uncertainty window (CockroachDB), trading a central
service or occasional read restarts for not needing special hardware.

### What a distributed commit costs

With round-trip time R between coordinator and participants and fsync time f:

```text
client sees commit after   ≈  R (prepare + votes) + f (participant) + f (coordinator decision)
locks held at least        ≈  that  +  R / 2 (decision reaches participants)
with replicated logs       each f becomes a consensus write: R_majority + f
```

| Deployment | R | Client latency | Locks held |
| --- | --- | --- | --- |
| One zone | 0.5 ms | about 2.5 ms | about 3 ms |
| Across zones | 2 ms | about 4 ms | about 5 ms |
| Across regions | 70 ms | about 72 ms | about 107 ms |

Lock hold time is what limits throughput on contended rows: a row updated by
every transaction can commit at most once per lock hold time, about nine times
a second when participants are in different regions. That is the same
arithmetic as a single-row hot spot in one database, multiplied by the network.

### When not to use one

Many invariants do not need atomic commit across machines:

- **Put the data on one partition.** If the invariant is "a tenant's quota
  and usage agree", key both by tenant and use a local transaction.
- **Use a saga** when a step can be compensated and intermediate states are
  acceptable, as in the
  [outbox lesson](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/).
- **Use an outbox and idempotent consumers** when the requirement is "the
  change and its announcement happen together", not "two databases change
  together".
- **Use a database that already runs 2PC over consensus** (Spanner,
  CockroachDB, TiDB, YugabyteDB, FoundationDB) when the invariant really spans
  partitions, rather than building 2PC over XA between independent systems.

In AI platforms, the cases that genuinely need atomic commit tend to be small
and critical: allocating a scarce GPU reservation and recording the charge,
promoting a model version and moving the alias that serves it, granting a
dataset permission and writing its audit record. Each can usually be kept on
one partition or made a single write to a transactional store.

## Code

The program simulates a coordinator and three participants, with forced log
writes costing 1 ms and messages taking a quarter of a millisecond. Crashes
are injected at the points in the table above, and the coordinator (or a
standby that shares its replicated log) comes back after 30 s or 1.5 s. It
prints when each participant released its locks.

```python {title="twopc.py"}
"""twopc.py: two-phase commit, coordinator failure, and who is left holding locks.

A coordinator commits one transaction across three participants. Crashes are
injected at named points. Participants log PREPARED before voting yes and then
hold their locks until they learn the outcome. The program prints each
participant's outcome and lock-hold time, with and without the cooperative
termination protocol, and with the coordinator's decision replicated so a
standby can take over. Discrete-event simulation; standard library only.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, field

FSYNC_MS = 1.0
PARTICIPANTS = ("P1", "P2", "P3")


@dataclass
class Participant:
    name: str
    vote_yes: bool = True
    state: str = "working"  # working -> prepared -> committed | aborted
    released_at: float | None = None


@dataclass
class Sim:
    one_way_ms: float
    crash_at: str | None = None  # 'after-prepare' | 'after-decision-logged' | 'after-first-commit'
    recover_ms: float = 30_000.0  # when the coordinator (or its standby) is back
    termination: bool = False  # participants ask each other when in doubt
    votes_no: tuple[str, ...] = ()
    now: float = 0.0
    events: list = field(default_factory=list)
    seq: int = 0
    coord_log: list[str] = field(default_factory=list)
    coord_up: bool = True
    votes: dict[str, bool] = field(default_factory=dict)
    client_told: tuple[float, str] | None = None
    deciding: bool = False

    def __post_init__(self) -> None:
        self.parts = {n: Participant(n, n not in self.votes_no) for n in PARTICIPANTS}

    def at(self, delay: float, fn, *args) -> None:
        self.seq += 1
        heapq.heappush(self.events, (self.now + delay, self.seq, fn, args))

    def send(self, fn, *args) -> None:
        self.at(self.one_way_ms, fn, *args)

    def run(self) -> None:
        self.coord_log.append("begin")
        for p in PARTICIPANTS:
            self.send(self.on_prepare, p)
        if self.crash_at == "after-prepare":
            self.crash()
        while self.events:
            self.now, _, fn, args = heapq.heappop(self.events)
            fn(*args)

    # ---- coordinator ------------------------------------------------------
    def crash(self) -> None:
        self.coord_up = False
        self.at(self.recover_ms - self.now, self.recover)

    def recover(self) -> None:
        """Read the log. A logged decision is resent; no decision means abort (presumed abort)."""
        self.coord_up = True
        decision = "commit" if "commit" in self.coord_log else "abort"
        if decision == "abort" and "abort" not in self.coord_log:
            self.coord_log.append("abort")
        for p in PARTICIPANTS:
            self.send(self.on_decision, p, decision)

    def on_vote(self, p: str, yes: bool) -> None:
        if not self.coord_up or self.deciding:
            return
        self.votes[p] = yes
        if not yes or len(self.votes) == len(PARTICIPANTS):
            self.deciding = True
            self.at(FSYNC_MS, self.decide, "commit" if all(self.votes.values()) else "abort")

    def decide(self, decision: str) -> None:
        if not self.coord_up:
            return
        self.coord_log.append(decision)  # forced to disk: this line IS the outcome
        self.client_told = (self.now, decision)
        if self.crash_at == "after-decision-logged":
            return self.crash()
        for i, p in enumerate(PARTICIPANTS):
            self.send(self.on_decision, p, decision)
            if self.crash_at == "after-first-commit" and i == 0:
                return self.crash()

    # ---- participants -----------------------------------------------------
    def on_prepare(self, p: str) -> None:
        part = self.parts[p]
        if part.state != "working":
            return
        if not part.vote_yes:
            self.finish(part, "aborted")  # a no vote may abort unilaterally
            return self.send(self.on_vote, p, False)
        self.at(FSYNC_MS, self.prepared, p)

    def prepared(self, p: str) -> None:
        part = self.parts[p]
        if part.state != "working":
            return
        part.state = "prepared"  # logged: from here on it may NOT decide alone
        self.send(self.on_vote, p, True)
        if self.termination:
            self.at(200, self.in_doubt, p)

    def in_doubt(self, p: str) -> None:
        if self.parts[p].state != "prepared":
            return
        for q in PARTICIPANTS:
            if q != p:
                self.send(self.on_status_request, q, p)
        self.at(200, self.in_doubt, p)  # ask again later if nobody knew

    def on_status_request(self, q: str, asker: str) -> None:
        part = self.parts[q]
        if part.state == "working":
            self.finish(part, "aborted")  # never voted, so it may abort, and tells the asker
        if part.state in ("committed", "aborted"):
            self.send(self.on_decision, asker, "commit" if part.state == "committed" else "abort")

    def on_decision(self, p: str, decision: str) -> None:
        part = self.parts[p]
        if part.state in ("committed", "aborted"):
            return
        self.finish(part, "committed" if decision == "commit" else "aborted")

    def finish(self, part: Participant, state: str) -> None:
        part.state, part.released_at = state, self.now  # locks released here


def report(label: str, sim: Sim) -> None:
    sim.run()
    outcomes = {p.state for p in sim.parts.values()}
    told = f"client told {sim.client_told[1]} at {sim.client_told[0]:.1f} ms" if sim.client_told else "client never told"
    holds = "  ".join(f"{p.name} {p.state:<9} {p.released_at:>7.1f}" for p in sim.parts.values())
    atomic = "atomic" if len(outcomes) == 1 else "NOT ATOMIC"
    print(f"{label}\n    {holds}\n    {atomic}; {told}")


def main() -> None:
    print("locks held until (ms), one-way delay 0.25 ms, fsync 1 ms, coordinator back at 30 s\n")
    d = 0.25
    report("1. no failure", Sim(d))
    report("2. P3 votes no", Sim(d, votes_no=("P3",)))
    report("3. coordinator crashes after sending PREPARE", Sim(d, crash_at="after-prepare"))
    report("4. crash after sending COMMIT to P1 only, no termination protocol",
           Sim(d, crash_at="after-first-commit"))
    report("5. same crash, participants ask each other",
           Sim(d, crash_at="after-first-commit", termination=True))
    report("6. crash after logging COMMIT, before sending any; participants ask each other",
           Sim(d, crash_at="after-decision-logged", termination=True))
    report("7. same crash, decision log replicated, standby takes over at 1.5 s",
           Sim(d, crash_at="after-decision-logged", termination=True, recover_ms=1_500))

    print("\nfailure-free commit: when the client hears 'commit', and how long locks are held")
    for name, rtt in (("same zone", 0.5), ("across zones", 2.0), ("across regions", 70.0)):
        sim = Sim(rtt / 2)
        sim.run()
        hold = max(p.released_at for p in sim.parts.values())
        print(f"  RTT {rtt:>5.1f} ms ({name:<14}) client told at {sim.client_told[0]:6.1f} ms, "
              f"locks held for {hold:6.1f} ms after the transaction's last write")


if __name__ == "__main__":
    main()
```

Run it with `python3 twopc.py`:

```text
locks held until (ms), one-way delay 0.25 ms, fsync 1 ms, coordinator back at 30 s

1. no failure
    P1 committed     2.8  P2 committed     2.8  P3 committed     2.8
    atomic; client told commit at 2.5 ms
2. P3 votes no
    P1 aborted       1.8  P2 aborted       1.8  P3 aborted       0.2
    atomic; client told abort at 1.5 ms
3. coordinator crashes after sending PREPARE
    P1 aborted   30000.2  P2 aborted   30000.2  P3 aborted   30000.2
    atomic; client never told
4. crash after sending COMMIT to P1 only, no termination protocol
    P1 committed     2.8  P2 committed 30000.2  P3 committed 30000.2
    atomic; client told commit at 2.5 ms
5. same crash, participants ask each other
    P1 committed     2.8  P2 committed   201.8  P3 committed   201.8
    atomic; client told commit at 2.5 ms
6. crash after logging COMMIT, before sending any; participants ask each other
    P1 committed 30000.2  P2 committed 30000.2  P3 committed 30000.2
    atomic; client told commit at 2.5 ms
7. same crash, decision log replicated, standby takes over at 1.5 s
    P1 committed  1500.2  P2 committed  1500.2  P3 committed  1500.2
    atomic; client told commit at 2.5 ms

failure-free commit: when the client hears 'commit', and how long locks are held
  RTT   0.5 ms (same zone     ) client told at    2.5 ms, locks held for    2.8 ms after the transaction's last write
  RTT   2.0 ms (across zones  ) client told at    4.0 ms, locks held for    5.0 ms after the transaction's last write
  RTT  70.0 ms (across regions) client told at   72.0 ms, locks held for  107.0 ms after the transaction's last write
```

What it shows:

- **Atomicity always holds; availability does not.** Every scenario ends with
  all three participants agreeing. What changes is how long they hold locks:
  under 3 ms without failures and 30 seconds when the coordinator crashes in
  the wrong place.
- **A crash before the decision aborts.** In scenario 3 the participants
  voted yes, but the coordinator never logged a decision, so on recovery it
  presumes abort. They still held locks for the full 30 seconds.
- **Peers help only if one of them knows.** In scenario 5, P2 and P3 ask P1,
  which received COMMIT, and finish at about 200 ms. In scenario 6 nobody
  received the decision, so asking each other changes nothing; the client was
  told "commit" at 2.5 ms, yet nobody could apply it for 30 seconds.
- **Replicating the decision bounds the blocking.** In scenario 7 the same
  crash costs 1.5 s, the failover time of the consensus group that holds the
  coordinator's log.
- **Distance multiplies lock time.** Across regions, the client waits 72 ms
  and locks are held for 107 ms after the last write.

## Where it breaks

- **Heterogeneous 2PC (XA) inherits every participant's weakest recovery.**
  A database, a message broker, and a legacy system coordinated by an
  application-server transaction manager block whenever that manager's disk
  is unavailable, and in-doubt transactions often need manual resolution.
- **Locks held across the network hurt everyone.** A long transaction, or one
  that waits on a user or a model call between prepare and commit, holds locks
  that block unrelated requests. Never do slow work inside a distributed
  transaction.
- **Isolation is a separate question.** 2PC gives atomicity. Whether
  concurrent transactions see each other's partial effects depends on the
  locking or multiversion scheme, as in the
  [consistency models lesson](/notes/systems-design/concurrency-and-consistency/03-consistency-models/).
- **Clock assumptions are load-bearing.** TrueTime's guarantee depends on its
  uncertainty bound being right. Hybrid-clock systems rely on a configured
  maximum offset, and nodes whose clocks drift past it must stop serving.
- **What the simulation leaves out.** One transaction, no concurrency or
  deadlocks, no participant crashes, no network loss, and a recovery that is
  a timer. It shows the blocking window and the lock-hold arithmetic.

## Remember this

- 2PC makes several machines commit or abort together; the coordinator's logged decision is the outcome.
- A prepared participant cannot decide alone; a coordinator crash leaves it holding locks.
- Presumed abort: no decision record means abort.
- Peers can resolve the doubt only if one of them has learned the outcome.
- Replicating the coordinator's log through consensus turns blocking into a failover delay.
- Locks are held for at least two round trips; across regions that limits hot rows to a few commits per second.

## Try it

1. Run `twopc.py`. Add a scenario where P2 crashes after voting yes and
   recovers 5 s later. What must it read from its log, and whom must it ask?
2. Add a timeout on the coordinator for missing votes: if a vote has not
   arrived after 100 ms, abort. Which scenario's lock time does it shorten,
   and is it safe?
3. Change the one-way delay to 35 ms and compute how many conflicting
   transactions per second one hot row could commit.
4. Find a place in a system you know where two databases are updated "together".
   Could the data live on one partition, or could an outbox replace the joint
   update?

## Check yourself

1. Why can a participant that has voted yes not abort after a timeout?

   {{< details summary="Show answer" >}}
   Its yes vote promised that it would commit if told to. The coordinator may
   already have logged COMMIT and told other participants, who may have
   committed. Aborting alone could leave the transaction committed on some
   machines and aborted on this one, which breaks atomicity.
   {{< /details >}}

2. What does presumed abort let a recovering coordinator do?

   {{< details summary="Show answer" >}}
   Treat any transaction with no decision record in its log as aborted. The
   coordinator never logged COMMIT, so nobody can have been told to commit,
   and aborting is safe. It also means aborts need no forced log write and no
   acknowledgments.
   {{< /details >}}

3. All participants are prepared and the coordinator is down. Why can the
   cooperative termination protocol not finish the transaction?

   {{< details summary="Show answer" >}}
   Every participant is in the same in-doubt state, so asking each other gives
   no new information. The coordinator may have logged COMMIT, and the client
   may have been told, so aborting is unsafe; or it may not have, so committing
   is unsafe. Only the coordinator's log can tell.
   {{< /details >}}

4. How does Spanner avoid blocking when a coordinator fails?

   {{< details summary="Show answer" >}}
   The coordinator and every participant are Paxos groups, not single
   machines. The PREPARED records and the commit decision are Paxos writes
   replicated to a majority of each group. If a group's leader fails, another
   replica is elected with the same log and continues the protocol.
   {{< /details >}}

5. Why does commit wait make Spanner's timestamps respect real time?

   {{< details summary="Show answer" >}}
   The commit timestamp is chosen at or after the latest possible current
   time, and the transaction is not acknowledged until the earliest possible
   current time has passed that timestamp. Any transaction that starts after
   the acknowledgment therefore starts, in true time, after the timestamp, and
   gets a larger one.
   {{< /details >}}

## Sources

- J. Gray, "Notes on Data Base Operating Systems", in *Operating Systems: An Advanced Course*, Springer, 1978.
- P. Bernstein, V. Hadzilacos, N. Goodman, [Concurrency Control and Recovery in Database Systems](https://www.microsoft.com/en-us/research/people/philbe/book/), Addison-Wesley, 1987, chapter 7.
- C. Mohan, B. Lindsay, R. Obermarck, "Transaction Management in the R* Distributed Database Management System", *ACM TODS* 11(4), 1986 (presumed abort and presumed commit).
- D. Skeen, "Nonblocking Commit Protocols", *SIGMOD*, 1981.
- J. Gray, L. Lamport, "Consensus on Transaction Commit", *ACM TODS* 31(1), 2006.
- J. Corbett et al., [Spanner: Google's Globally-Distributed Database](https://research.google/pubs/pub39966/), *OSDI*, 2012.
- D. Peng, F. Dabek, [Large-scale Incremental Processing Using Distributed Transactions and Notifications](https://research.google/pubs/pub36726/), *OSDI*, 2010.
- R. Taft et al., "CockroachDB: The Resilient Geo-Distributed SQL Database", *SIGMOD*, 2020.
- M. Kleppmann, *Designing Data-Intensive Applications*, O'Reilly, 2017, chapter 9.
