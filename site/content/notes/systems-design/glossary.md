+++
title = 'Glossary'
description = 'Short definitions of the terms this course uses, each linked to the lesson that explains it.'
weight = 100
+++

Short definitions of the terms used in this course. Each term links to the
lesson that explains it best.

## A

- **[Adaptive LIFO](/notes/systems-design/failure-modes/04-overload-and-backpressure/)**:
  FIFO while the queue is short and LIFO once it builds up, used with
  controlled-delay dropping, so the newest requests are served first under
  overload.
- **[Anti-entropy](/notes/systems-design/concurrency-and-consistency/04-replication-and-quorums/)**:
  A background process that compares replicas and copies missing data to
  repair stale ones. Dynamo used Merkle trees for the comparison.
- **[Architecture decision record (ADR)](/notes/systems-design/thinking-in-invariants/04-tradeoffs-and-decision-records/)**:
  A written record of a significant decision with its title, context,
  decision, status, consequences, reversibility, and a revisit-if measurement
  that would overturn it.
- **[At-least-once delivery](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/)**:
  A delivery guarantee in which the sender resends until acknowledged, so a
  message may arrive more than once. Consumers must deduplicate.
- **[At-most-once delivery](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/)**:
  A delivery guarantee in which the sender does not resend, so a message may
  be lost but is never duplicated.
- **[Attenuation](/notes/systems-design/worked-designs/02-a-credential-broker/)**:
  The rule that authority only shrinks along a chain of credentials. A child
  credential's scopes are a subset of its parent's and its expiry is no later.

## B

- **[Backpressure](/notes/systems-design/failure-modes/04-overload-and-backpressure/)**:
  Pushing back on senders so that overload is felt at the edge instead of in
  the middle. It appears in protocols, in queues between services, and at the
  client.
- **[Blast radius](/notes/systems-design/failure-modes/05-blast-radius-and-cells/)**:
  The fraction of customers or requests that a failure affects. Bulkheads,
  cells, shuffle sharding, and static stability each bound it.
- **[Bulkhead](/notes/systems-design/failure-modes/05-blast-radius-and-cells/)**:
  A separate pool of resources for one workload, so that it cannot exhaust
  another's. Examples are per-dependency thread pools, separate fleets per
  workload class, and per-tenant quotas.
- **[Burn rate](/notes/systems-design/reliability-in-production/01-slos-and-error-budgets/)**:
  How fast the error budget is being consumed relative to the rate that would
  use it up exactly at the end of the window. A burn rate of 1 spends the
  budget over exactly the window.

## C

- **[Canary](/notes/systems-design/reliability-in-production/03-safe-change/)**:
  A rollout that sends a small share of traffic to the new version, compares
  it with the old, and widens only if the signals agree.
- **[CAP](/notes/systems-design/thinking-in-invariants/04-tradeoffs-and-decision-records/)**:
  During a network partition, a replicated system cannot both answer every
  request and stay linearizable. It says nothing about normal operation.
- **[Cardinality](/notes/systems-design/reliability-in-production/02-observability-signals/)**:
  The number of distinct time series a metric produces. A label holding IDs
  can multiply it into millions and take down monitoring.
- **[Causal consistency](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  A model that orders only causally related operations, so every replica shows
  them in that order. Unrelated concurrent operations may appear in different
  orders.
- **[Cell](/notes/systems-design/failure-modes/05-blast-radius-and-cells/)**:
  A complete, independent instance of a service serving a fixed subset of
  customers, selected by a thin routing layer. A fault in one cell stays in
  that cell.
- **[Circuit breaker](/notes/systems-design/failure-modes/03-circuit-breakers-and-deadlines/)**:
  A guard that watches call outcomes and, once failures pass a threshold,
  fails immediately instead of calling the dependency. It then probes to
  detect recovery.
- **[CoDel](/notes/systems-design/failure-modes/04-overload-and-backpressure/)**:
  Controlled Delay: control the time requests spend in the queue rather than
  its length, and drop when minimum queueing delay stays above a small target.
- **[Compare-and-set (CAS)](/notes/systems-design/concurrency-and-consistency/01-races-and-check-then-act/)**:
  A write that succeeds only if the value or version is still what the writer
  read. Also called optimistic concurrency control; the loser of a conflict
  retries.
- **[Consistency model](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  The contract a replicated system offers about which writes a read is
  guaranteed to see, and in what order.
- **[Control plane](/notes/systems-design/failure-modes/05-blast-radius-and-cells/)**:
  The half of a system that changes the data plane: launching instances,
  updating routing, rotating certificates, and pushing configuration. It is
  usually more complex and less available than the data plane.
- **[Coordinated omission](/notes/systems-design/reliability-in-production/02-observability-signals/)**:
  A load-testing artifact in which a generator waits for slow replies and so
  hides the tail. Open-loop generators that send on a fixed schedule avoid it.
- **[Credential broker](/notes/systems-design/worked-designs/02-a-credential-broker/)**:
  A service that checks a workload's identity and policy and returns a short-
  lived, narrowly scoped credential in place of a long-lived secret.

## D

- **[Data plane](/notes/systems-design/failure-modes/05-blast-radius-and-cells/)**:
  The half of a system that serves requests. A statically stable system keeps
  it serving when the control plane is down.
- **[Deadline](/notes/systems-design/failure-modes/03-circuit-breakers-and-deadlines/)**:
  An absolute give-up time that travels with a request, so every hop knows how
  much of the caller's patience is left and expired work can be dropped.
- **[Deadline propagation](/notes/systems-design/failure-modes/01-partial-failure-and-timeouts/)**:
  Passing the caller's remaining time budget to each downstream call, so
  timeouts at every hop fit inside the caller's own deadline.
- **[Dual-write problem](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/)**:
  Writing to a database and a broker with no shared transaction, so a crash
  between the writes leaves one without the other. Retries cannot fix it.

## E

- **[Error budget](/notes/systems-design/reliability-in-production/01-slos-and-error-budgets/)**:
  The allowance of failure implied by an SLO, equal to 1 minus the SLO. A
  written policy says what changes when it is spent.
- **[Eventual consistency](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  The weakest common model: replicas agree eventually if writes stop. Until
  they do, a replica may serve stale data, including a revoked permission.
- **[Expand and contract](/notes/systems-design/reliability-in-production/03-safe-change/)**:
  A schema migration pattern that splits a breaking change into compatible
  steps, each deployable and reversible on its own. Also called parallel
  change.

## F

- **[Feature flag](/notes/systems-design/reliability-in-production/03-safe-change/)**:
  A switch that separates deploying code from releasing behavior. Kinds
  include release, experiment, operational (kill switch), and permission
  flags.
- **[Fencing token](/notes/systems-design/concurrency-and-consistency/02-locks-leases-and-fencing/)**:
  A number that increases with every lock grant. The resource remembers the
  highest token it has seen and rejects writes carrying a lower one.

## G

- **[Goodput](/notes/systems-design/failure-modes/04-overload-and-backpressure/)**:
  Requests completed in time to be useful, as opposed to throughput, which
  counts all completed requests. Overload controls aim to keep it near
  capacity.
- **[Gray failure](/notes/systems-design/failure-modes/01-partial-failure-and-timeouts/)**:
  A component degraded in a way its failure detector does not see but its
  clients do, because health checks and real requests observe it through
  different paths.

## H

- **[Hash chain](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/)**:
  A log in which each entry's hash covers the previous hash. It detects
  tampering only by someone who did not also recompute it, so its head must be
  held by someone else.
- **[Hedged request](/notes/systems-design/failure-modes/03-circuit-breakers-and-deadlines/)**:
  A second copy of a request sent after a short delay to cut the latency tail.
  Only idempotent calls should be hedged.
- **[Hinted handoff](/notes/systems-design/concurrency-and-consistency/04-replication-and-quorums/)**:
  During a sloppy quorum, a substitute node holds a write with a hint naming
  its home replica and hands it off when that replica returns.

## I

- **[Idempotency key](/notes/systems-design/failure-modes/02-retries-and-idempotency/)**:
  A client-generated identifier, created once per logical operation, that lets
  the server recognize a repeat and return the first result. It is stored
  atomically with the effect.
- **[Inbox](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/)**:
  A table of processed message IDs, keyed uniquely and written in the same
  transaction as the effect, so a consumer discards duplicates.
- **[Inclusion proof](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/)**:
  The sibling hashes on the path from a leaf to the root of a Merkle tree,
  about log2(n) of them. The verifier recomputes the root and compares it to a
  signed tree head.
- **[Invariant](/notes/systems-design/thinking-in-invariants/01-what-a-design-promises/)**:
  A property of a design stated as something a program could evaluate against
  a state or a history. Design starts by writing them down.
- **[Isolation level](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  How much concurrent multi-statement transactions may interfere in a
  database, such as Read Committed, Snapshot Isolation, or Serializable, each
  allowing certain anomalies.

## J

- **[Jitter](/notes/systems-design/failure-modes/02-retries-and-idempotency/)**:
  Randomness added to backoff delays so clients do not retry in synchronized
  waves. It needs randomness per client.

## K

- **[KV cache](/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway/)**:
  The keys and values stored for every token of a running sequence's context.
  Its memory is the capacity constraint an inference gateway must reason
  about.

## L

- **[Last write wins (LWW)](/notes/systems-design/concurrency-and-consistency/04-replication-and-quorums/)**:
  Resolving a write conflict by timestamp. It is simple and silently discards
  the other write, and with clock skew "last" is whichever node's clock runs
  fast.
- **[Lease](/notes/systems-design/concurrency-and-consistency/02-locks-leases-and-fencing/)**:
  A lock granted for a fixed time that expires unless renewed. Expiry keeps a
  crashed holder from locking others out, but a paused holder can outlive its
  lease.
- **[Linearizability](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  Every operation appears to take effect at a single instant between its
  invocation and response, respecting real time, as if there were one copy and
  one clock.
- **[Little's law](/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity/)**:
  L = λW: in any stable system, the number of requests in flight equals
  throughput times latency. Used to size pools and sanity-check benchmarks.
- **[Liveness property](/notes/systems-design/thinking-in-invariants/01-what-a-design-promises/)**:
  A property saying that something good eventually happens. No finite
  observation proves it broken, so it is monitored with a bound.
- **[Load shedding](/notes/systems-design/failure-modes/04-overload-and-backpressure/)**:
  Rejecting excess requests early and cheaply, using a bounded queue, so the
  server spends its capacity on work that can still finish in time. Shedding
  can be by priority, age, or cost.
- **[Lost update](/notes/systems-design/concurrency-and-consistency/01-races-and-check-then-act/)**:
  A read-modify-write in which two requests read the same value and one
  overwrites the other's change.

## M

- **[M/M/1 queue](/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity/)**:
  A single-server queueing model whose mean time in system is W = S / (1 − ρ).
  It shows why latency explodes as utilization approaches 100%.
- **[Merkle tree](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/)**:
  A hash tree over every log entry that allows logarithmic inclusion and
  consistency proofs, as defined in RFC 6962 and RFC 9162.
- **[Metastable failure](/notes/systems-design/failure-modes/04-overload-and-backpressure/)**:
  A failure that persists after its trigger is gone because a sustaining
  effect, such as retries and a stale backlog, keeps load above capacity.

## O

- **[Observability signals (metrics, traces, logs)](/notes/systems-design/reliability-in-production/02-observability-signals/)**:
  Metrics say that something is wrong, traces say where, and logs say why.
  They are linked with trace IDs.

## P

- **[PACELC](/notes/systems-design/thinking-in-invariants/04-tradeoffs-and-decision-records/)**:
  An extension of CAP: during a partition choose availability or consistency,
  else choose latency or consistency. It covers the everyday cost of
  consistency across distance.
- **[Partial failure](/notes/systems-design/failure-modes/01-partial-failure-and-timeouts/)**:
  A state in which some parts of a system work while others do not, and the
  working parts cannot reliably tell which is which. A remote call can
  succeed, fail, or leave the caller not knowing.
- **[Point-in-time recovery](/notes/systems-design/reliability-in-production/04-backup-and-disaster-recovery/)**:
  Restoring a base backup and replaying archived log up to just before the
  damage, to any point within the retention window.

## Q

- **[Quorum](/notes/systems-design/concurrency-and-consistency/04-replication-and-quorums/)**:
  With N replicas, W write acknowledgments and R read replicas where R + W > N
  make every read set overlap every write set. The count holds only over a
  fixed set of N replicas.

## R

- **[Race condition](/notes/systems-design/concurrency-and-consistency/01-races-and-check-then-act/)**:
  A bug in which the outcome depends on the timing of concurrent requests,
  such as another request running between a check and the action it guards.
- **[Raft](/notes/systems-design/concurrency-and-consistency/04-replication-and-quorums/)**:
  A consensus protocol that uses terms, majority elections, and majority-
  committed log replication to make leader failover safe. Without a majority
  it stops.
- **[Read-your-writes](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  A session guarantee that a client sees its own earlier writes.
- **[Replica versus backup](/notes/systems-design/reliability-in-production/04-backup-and-disaster-recovery/)**:
  A replica is a live copy that follows the primary and also copies deletes
  and corruption. A backup is a copy from a past moment, kept where damage
  cannot reach it.
- **[Retry budget](/notes/systems-design/failure-modes/02-retries-and-idempotency/)**:
  A cap on retries as a fraction of total traffic. Google's SRE book describes
  retrying only while retries are under 10% of a client's requests.
- **[RPO and RTO](/notes/systems-design/reliability-in-production/04-backup-and-disaster-recovery/)**:
  The recovery point objective is how much data, measured as time, you can
  afford to lose. The recovery time objective is how long the service may be
  down.

## S

- **[Safety property](/notes/systems-design/thinking-in-invariants/01-what-a-design-promises/)**:
  A property saying that something bad never happens. A single bad state
  proves it broken.
- **[Saga](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/)**:
  A sequence of local transactions, each with a compensating transaction that
  semantically undoes it. Compensation is not rollback.
- **[Shuffle sharding](/notes/systems-design/failure-modes/05-blast-radius-and-cells/)**:
  Giving each customer a random small set of workers so that almost no two
  customers share the same set. It depends on clients retrying across the
  shard.
- **[Signed tree head (STH)](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/)**:
  A signed commitment to the exact first n entries of a log, published at
  regular intervals.
- **[SLI, SLO, and SLA](/notes/systems-design/reliability-in-production/01-slos-and-error-budgets/)**:
  An SLI is good events divided by valid events. An SLO is a target for that
  ratio over a window, and an SLA is a contract with consequences for missing
  a looser target.
- **[Small scope hypothesis](/notes/systems-design/thinking-in-invariants/02-state-machines-and-transitions/)**:
  The bet that most bugs have small counterexamples, so exhaustively checking
  all small instances finds most of them.
- **[Snapshot Isolation](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  An isolation level that prevents lost updates but still allows write skew.
- **[Split brain](/notes/systems-design/concurrency-and-consistency/04-replication-and-quorums/)**:
  Two leaders accepting writes for the same data at once. The writes on the
  losing side usually have to be discarded or reconciled by hand.
- **[Split view](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/)**:
  A log presenting one history to you and another to everyone else, each
  verifying on its own. Witnesses that compare signed tree heads catch it.
- **[Static stability](/notes/systems-design/failure-modes/05-blast-radius-and-cells/)**:
  The property that a system keeps serving with what it already has when the
  control plane is down. It costs capacity, for example provisioning n / (n −
  1) to survive losing a zone.

## T

- **[Tail-based sampling](/notes/systems-design/reliability-in-production/02-observability-signals/)**:
  Deciding which traces to keep after a trace completes, keeping all errors
  and slow traces. It requires buffering every span of a trace in one place.
- **[Tamper evidence](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/)**:
  The goal of making an edit to a log impossible without breaking a
  cryptographic commitment that others already hold.
- **[Thundering herd](/notes/systems-design/worked-designs/02-a-credential-broker/)**:
  Many workloads wanting credentials at once after a recovery. Serving soon-
  to-expire requests first keeps failures close to zero.
- **[Time-of-check to time-of-use (TOCTOU)](/notes/systems-design/concurrency-and-consistency/01-races-and-check-then-act/)**:
  The race in which a check and the action it guards are separate steps and
  another request runs between them. The fix is to make check and act one
  atomic step.
- **[Token bucket](/notes/systems-design/worked-designs/01-a-rate-limiter/)**:
  A limiter whose tokens refill at rate r up to capacity b and are spent one
  per request. It admits at most b + r·t in any interval of length t, allowing
  a burst after idle time.
- **[Transactional outbox](/notes/systems-design/concurrency-and-consistency/05-exactly-once-and-the-outbox/)**:
  A pattern that inserts the business row and the outgoing message in one
  database transaction. A separate relay then publishes from the outbox table
  at least once.

## U

- **[Utilization](/notes/systems-design/thinking-in-invariants/03-back-of-the-envelope-capacity/)**:
  The fraction of time a server is busy, ρ. At 50% a request takes twice its
  service time, at 90% ten times, and at 99% a hundred times.

## W

- **[Weighted fair queueing](/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway/)**:
  A scheduler that gives each request a virtual finish tag of cost divided by
  weight, running the smallest tag first, so a flooding tenant cannot starve
  others.
- **[Write skew](/notes/systems-design/concurrency-and-consistency/03-consistency-models/)**:
  An anomaly, allowed by Snapshot Isolation, in which two concurrent
  transactions each preserve an invariant and together break it.
