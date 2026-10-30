+++
title = 'A credential broker'
description = 'A credential broker turns a verified workload identity into a short-lived, narrowly scoped credential. Its hardest problems are not minting but revocation, audit, and staying out of the critical path when it fails.'
question = 'How do you design a service that issues short-lived scoped credentials without making it a single point of failure or a single point of compromise?'
weight = 2
difficulty = 4
prerequisites = ['/notes/systems-design/thinking-in-invariants/01-what-a-design-promises', '/notes/systems-design/failure-modes/05-blast-radius-and-cells', '/notes/systems-design/concurrency-and-consistency/02-locks-leases-and-fencing', '/notes/systems-design/worked-designs/01-a-rate-limiter']
date = 2026-10-20
lastmod = 2026-10-20
verified = 2026-10-20
+++

## The idea in one minute

Long-lived secrets in configuration files leak, get copied, and never expire. A
**credential broker** replaces them: a workload proves who it is, the broker
checks policy, and it returns a credential that names the workload, lists a few
permissions, and expires in minutes. AWS STS, Vault's dynamic secrets, and
cloud workload identity federation are all versions of this service.

Minting is the easy part. The design work is in four other places: **checking
identity** without trusting what the caller claims, **revoking** a credential
before it expires, **auditing** every decision, and **availability**. Every
workload depends on the broker, so a broker outage could become everyone's
outage. The consequence to act on: design the broker so that **running
workloads survive its absence for longer than any plausible outage**, and so
that its own compromise is the most expensive event in your threat model to
cause and the easiest to detect.

## A picture

```mermaid {title="Identity in, credential out, and the paths that do not touch the broker"}
sequenceDiagram
  participant P as Platform
  participant W as Workload
  participant B as Broker
  participant K as KMS
  participant A as Audit log
  participant R as Resource server
  P->>W: attested identity document (SVID, projected token)
  W->>B: identity + requested scopes + TTL
  B->>B: verify identity, evaluate policy
  B->>K: sign claims
  K-->>B: signature
  B->>A: record issue (before returning)
  B-->>W: credential (15 min, 2 scopes)
  W->>R: request + credential
  R->>R: verify signature offline, check exp, scope, revocation copy
  Note over W,R: the broker is not on this path
  W->>B: refresh at half-life (retry with jitter if down)
```

## How it really works

### Requirements

- **Clients:** 20,000 workloads (pods, functions, batch jobs) across one
  region, each needing credentials for an average of three audiences (object
  storage, a database proxy, an internal API).
- **Credentials:** scoped to the workload's policy, at most 15 minutes, and
  narrowable: a workload can exchange its credential for a weaker one to hand to
  a subprocess or a job.
- **Revocation:** a compromised workload's credentials stop working everywhere
  within 60 seconds.
- **Audit:** every issue, denial, and revocation is recorded with who, what,
  when, and why.
- **Availability:** a broker outage of up to 5 minutes causes no failed
  requests in running workloads.

### Invariants

| # | Invariant |
| --- | --- |
| I1 | A credential's scopes are a subset of what policy grants the verified identity; a derived credential's scopes are a subset of its parent's |
| I2 | A credential's expiry is at most the policy's maximum TTL and never later than its parent's expiry |
| I3 | No credential is returned unless its issue event has been durably recorded |
| I4 | A revoked credential, and everything derived from it, is rejected at every verifier within 60 s or has expired |
| I5 | Running workloads keep working through a broker outage of 5 minutes |
| I6 | The signing key never exists outside the KMS or HSM |

I1 and I2 are the **attenuation** rule: authority only shrinks along a chain.
I3 makes the audit log a precondition, not a side effect. I5 is **static
stability**: the system keeps doing what it was doing when a dependency
disappears, without needing to make new decisions.

### Capacity estimate

**Steady issuance.** With a 15-minute TTL and refresh at half-life, each
workload asks for a new credential every 450 s per audience:

20,000 workloads × 3 audiences / 450 s ≈ **133 issues per second**.

**Deploy surges.** Rolling 5,000 pods in 2 minutes adds 5,000 × 3 / 120 s =
**125 per second** on top. A whole-region restart, where all 60,000
credentials are wanted at once, is the case to design for: at 2,000 issues per
second it takes 30 s to recover; at 200 per second, five minutes of nothing
working.

The bars spell out that tradeoff: 60,000 credentials divided by the broker's
issue rate is how long the region waits.

```mermaid {title="Restart recovery time falls as broker issue rate rises"}
xychart-beta
  title "Time to reissue 60,000 credentials after a region restart"
  x-axis "Broker issue rate per second" [200, 500, 1000, 2000]
  y-axis "Seconds until every workload has one" 0 --> 320
  bar [300, 120, 60, 30]
```

**Signing.** An Ed25519 or ECDSA P-256 signature costs on the order of tens of
microseconds on a modern core, so signing locally is never the bottleneck. A
remote KMS call per credential is different: it adds a network round trip and
counts against the KMS's request quota, so check that quota against the
restart case, not the steady state.

**Audit volume.** 133 issues per second × 86,400 s = 11.5 million events per
day. At about 1 KB per event that is 11.5 GB per day before denials and
revocations.

**Revocation list.** A revoked credential only needs to stay on the list until
it would have expired. With a 15-minute TTL, the list holds 15 minutes of
revocations, which is tiny. **Short TTLs are what make revocation lists cheap.**

### The design

**1. Verify identity from the platform, not from the caller.** The broker
accepts only identity documents the platform signs after attesting the
workload: a SPIFFE SVID issued by SPIRE, a Kubernetes projected service account
token checked against the cluster's issuer, or a cloud instance identity
document. The workload's own claim of "I am billing-api" is worth nothing. The
attestation chain is covered in
[attestation and SPIFFE](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/).

**2. Evaluate policy, deny by default.** Policy maps an identity to the scopes
it may request and a maximum TTL. Keep it in version control, require review
for changes, and evaluate it with an engine such as OPA or Cedar so rules can be
unit tested. The broker serves the **last known good** policy if the policy
store is unreachable; a missing policy store must not mean "allow everything"
or "deny everything".

**3. Mint, with attenuation built in.** The credential carries subject, scopes,
issue time, expiry, a unique ID (`jti`), and the chain of parent IDs. The broker
clamps the TTL to the policy maximum (AWS STS does the same: `AssumeRole`
accepts a requested duration but caps it at the role's maximum session
duration). For **down-scoping**, a workload presents its credential and asks for
fewer scopes; the broker checks that every requested scope is covered by a
parent scope and sets the child's expiry to no later than the parent's. AWS
session policies and Google Cloud's Credential Access Boundaries implement the
same rule: the effective permission is the intersection of the parent's and the
requested.

Follow authority down the chain from the program below: each step can only
narrow scopes and shorten expiry, and a step that tries to widen is refused.

```mermaid {title="Attenuation: authority only shrinks from policy to parent to child"}
flowchart LR
  P@{ shape: doc, label: "<b>Policy: billing-api</b><br/><small>s3:read:invoices/*, kms:decrypt, max 900 s</small>" }
  C1["<b>c1</b><br/><small>both scopes, asked 3600 s, exp 900</small>"]
  C2["<b>c2, child of c1</b><br/><small>s3:read:invoices/2026-10/*, exp 320</small>"]
  X["<b>c2 asks for kms:decrypt</b><br/><small>not covered by c2</small>"]
  D["<b>Denied</b><br/><small>escalation, audited</small>"]
  P -->|"subset, TTL clamped"| C1
  C1 -->|"narrower scope, exp no later"| C2
  C2 --> X
  X --> D
  class P neutral
  class C1,C2 good
  class X warn
  class D io
```

**4. Sign with a key the broker cannot leak.** The signing key lives in a KMS
or HSM (I6). To avoid a KMS call per credential, a common pattern is a
**delegated signing key**: the broker generates a short-lived key pair in
memory, has the KMS-held root certify it for an hour, and signs credentials
locally. That trades a little exposure (an hour-long key in memory) for
latency and independence from KMS availability. Verifiers fetch the public keys
from a published key set and cache them, with overlap during rotation.

**5. Audit before returning.** The broker writes the issue event to a durable
local queue before it returns the credential, and a shipper forwards the queue
to the central log. If the local queue is full, the broker stops issuing: an
unaudited credential violates I3. Log the `jti` and claims, **never the
credential itself**. The log should be tamper-evident, which is the subject of
[the next lesson](/notes/systems-design/worked-designs/03-a-tamper-evident-audit-log/).

**6. Revoke by publishing, verify offline.** Resource servers verify the
signature, expiry, and scope locally, without calling the broker, which keeps
the broker off the request path. Revocation is the price: a resource server
learns about revocations by pulling a list (or receiving a push) every 30–60 s.
Revoke by `jti` and by chain, so revoking a parent kills its children; Vault's
token hierarchy does the same, revoking child tokens with their parent. For
broad incidents, revoke by subject and issue time ("everything for billing-api
issued before 10:42"). The alternative, a live introspection call per request
in the style of RFC 7662, gives instant revocation but puts the broker back on
the critical path.

**7. Refresh early, keep the old one.** Clients refresh at half the TTL, retry
with exponential backoff and jitter, and keep using the current credential
until it actually expires. With a 15-minute TTL that gives 7.5 minutes of
tolerance, more than the 5 minutes I5 requires. Kubernetes follows the same
pattern for projected service account tokens, which the kubelet refreshes well
before expiry.

Steps 5 to 7 together give a credential this lifecycle. Note the two ways out
of Active besides expiry, and the state where a revoked credential still works.

```mermaid {title="A credential's life: audited before issue, refreshed early, revoked by list"}
stateDiagram-v2
  [*] --> Requested
  Requested --> Denied: identity, policy, or audit queue fails
  Requested --> Audited: issue event in durable queue
  Audited --> Active: returned to workload
  Active --> Refreshing: half the TTL elapsed
  Refreshing --> Refreshing: broker down, retry with jitter
  Refreshing --> Active: replacement issued
  Refreshing --> Expired: outage outlasts remaining TTL
  Active --> Expired: exp reached
  state "Revoked, verifiers not yet updated" as Pending
  Active --> Pending: jti or a parent revoked
  Pending --> Rejected: next pull, within 60 s
  Denied --> [*]
  Expired --> [*]
  Rejected --> [*]
```

**8. Deploy per region or per cell.** A broker in each region, with no
cross-region dependency on the issue path, limits a broker failure to one
region, as in
[blast radius and cells](/notes/systems-design/failure-modes/05-blast-radius-and-cells/).

Here is one region's deployment. Only the central audit log sits outside it,
and the queue in front of it means the broker does not wait on it.

```mermaid {title="One region's broker: everything on the issue path stays in the region"}
flowchart TB
  subgraph g_region["Region A"]
    subgraph g_cluster["Cluster"]
      n_platform["Platform attestation"]
      n_workload["Workload"]
    end
    n_broker["Broker"]
    n_policy["Policy last known good"]
    n_kms["KMS or HSM"]
    n_queue["Audit queue"]
    n_rs["Resource server"]
    n_feed["Revocation feed"]
  end
  n_audit["Central audit log"]
  n_platform --> n_workload
  n_workload --> n_broker
  n_broker --> n_policy
  n_broker --> n_kms
  n_broker --> n_queue
  n_queue --> n_audit
  n_workload --> n_rs
  n_broker --> n_feed
  n_feed --> n_rs
```

### Failure modes

| Failure | Effect | Design response |
| --- | --- | --- |
| Broker down | No new credentials | Refresh at half-life; workloads ride on cached credentials (I5) |
| Broker returns after an outage | Every client refreshes at once | Jittered retries; admit expiring credentials first; rate limit per workload |
| KMS unavailable | Cannot sign | Delegated signing key keeps working until it expires |
| Policy store unavailable | Cannot evaluate changed policy | Serve last known good, versioned; alert |
| Audit queue full | Cannot record | Stop issuing (fail closed); workloads ride on cached credentials |
| Revocation feed stale | Revoked credentials accepted | Alert on feed age at verifiers; fail closed past a maximum age |
| Clock skew at a verifier | Valid credentials rejected or expired ones accepted | Small leeway (seconds), NTP monitoring |

The **thundering herd** after recovery deserves its own test. If 60,000
credentials are wanted at once and the broker serves 2,000 per second, a
priority queue that serves soon-to-expire requests first keeps the number of
workloads that actually fail close to zero.

### Security review

The broker is a **tier-0 asset**: whoever controls it can mint any credential.
Review it as such.

- **Identity spoofing.** If node attestation is weak, compromising one node
  yields every identity that may run on that node. Scope node-level identities
  narrowly and prefer hardware-backed attestation where it exists.
- **Policy as the attack path.** An attacker who can merge a policy change can
  grant themselves anything. Require two-person review, alert on changes that
  widen scopes, and make the broker unable to grant scopes that administer the
  broker itself.
- **Stolen credentials.** Short TTLs bound the window; proof-of-possession
  binding closes it. RFC 8705 binds a token to a client TLS certificate and RFC
  9449 (DPoP) binds it to a key the client proves it holds, so a copied token is
  useless without the key.
- **Audience confusion.** A credential for the storage service must not be
  accepted by the payments API. Put the audience in the credential and have
  every verifier check it; the delegation patterns are covered in
  [identity and authorization for agents](/notes/ai-security-engineering/securing-agents/02-identity-and-authorization/).
- **Revocation latency is an attacker's window.** With a 60 s pull interval and
  15-minute TTL, a stolen credential works for up to 60 s after you revoke it.
  State that number in your incident runbook.
- **Error messages.** Denials should be logged in detail and returned vaguely,
  so a caller cannot map the policy by probing.

### What changes at 10x

At 200,000 workloads, steady issuance is 200,000 × 3 / 450 ≈ 1,333 per second
and audit volume is about 115 GB per day.

- **Cells by namespace or team**, each with its own broker fleet and
  revocation feed, so one team's restart storm does not starve another.
- **Delegated signing keys become mandatory**: one KMS call per credential at
  1,333 per second, and many times that during a restart, is a quota and
  latency problem.
- **Push revocation** over a streaming channel instead of polling, to keep
  revocation latency low without 200,000 clients polling.
- **Tiered audit storage**: recent events hot and searchable, older events in
  cheaper immutable storage with the tamper-evidence preserved.

## Code

Two programs. The first is the broker: identity verification, policy, minting,
down-scoping, chain revocation, a resource server with a revocation list it
pulls every 60 s, and an audit log.

```python {title="broker.py"}
"""broker.py: a credential broker in miniature.

Identity in, policy check, mint a short-lived scoped credential, down-scope it,
revoke it, and audit every decision. Simulated clock; standard library only.
HMAC stands in for real signatures (a broker would sign with a KMS-held key).
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass, field

PLATFORM_KEY = b"platform attestation key (simulated)"
BROKER_KEY = b"broker signing key (simulated)"
POLICY = {  # workload -> (allowed scopes, max TTL seconds)
    "billing-api": ({"s3:read:invoices/*", "kms:decrypt:invoice-key"}, 900),
}


def sign(key: bytes, body: dict) -> str:
    return hmac.new(key, json.dumps(body, sort_keys=True).encode(), hashlib.sha256).hexdigest()


def covers(have: str, want: str) -> bool:
    """'s3:read:invoices/*' covers 's3:read:invoices/2026-10/*' and 's3:read:invoices/a'."""
    if have.endswith("*"):
        return want.startswith(have[:-1])
    return have == want


@dataclass
class Credential:
    body: dict
    sig: str


@dataclass
class Broker:
    audit: list[str] = field(default_factory=list)
    revoked: dict[str, int] = field(default_factory=dict)  # jti -> time revoked
    serial: int = 0

    def _mint(self, now: int, sub: str, scopes: set[str], exp: int, chain: list[str]) -> Credential:
        self.serial += 1
        jti = f"c{self.serial}"
        body = {"jti": jti, "sub": sub, "scopes": sorted(scopes), "iat": now, "exp": exp,
                "chain": chain + [jti]}
        self.audit.append(f"t={now:<4} MINT   {jti} sub={sub} exp={exp} scopes={sorted(scopes)}")
        return Credential(body, sign(BROKER_KEY, body))

    def issue(self, now: int, identity: dict, id_sig: str, want: set[str], ttl: int) -> Credential:
        sub = identity.get("workload", "?")
        if not hmac.compare_digest(sign(PLATFORM_KEY, identity), id_sig) or identity["exp"] <= now:
            self.audit.append(f"t={now:<4} DENY   identity for {sub}: bad signature or expired")
            raise PermissionError("identity not verified")
        allowed, max_ttl = POLICY.get(sub, (set(), 0))
        extra = {w for w in want if not any(covers(a, w) for a in allowed)}
        if extra:
            self.audit.append(f"t={now:<4} DENY   {sub} asked beyond policy: {sorted(extra)}")
            raise PermissionError(f"not permitted: {sorted(extra)}")
        return self._mint(now, sub, want, now + min(ttl, max_ttl), [])

    def downscope(self, now: int, parent: Credential, want: set[str], ttl: int) -> Credential:
        p = parent.body
        if not hmac.compare_digest(sign(BROKER_KEY, p), parent.sig) or p["exp"] <= now \
                or any(j in self.revoked for j in p["chain"]):
            self.audit.append(f"t={now:<4} DENY   downscope of {p['jti']}: invalid parent")
            raise PermissionError("invalid parent")
        extra = {w for w in want if not any(covers(h, w) for h in p["scopes"])}
        if extra:
            self.audit.append(f"t={now:<4} DENY   {p['jti']} tried to widen: {sorted(extra)}")
            raise PermissionError(f"escalation: {sorted(extra)}")
        return self._mint(now, p["sub"], want, min(p["exp"], now + ttl), p["chain"])

    def revoke(self, now: int, jti: str, reason: str) -> None:
        self.revoked[jti] = now
        self.audit.append(f"t={now:<4} REVOKE {jti} ({reason})")


@dataclass
class ResourceServer:
    """Verifies offline; its copy of the revocation list is pulled every 60 s."""
    broker: Broker
    pull_every: int = 60

    def check(self, now: int, cred: Credential, action: str) -> str:
        pulled_at = now - now % self.pull_every          # last scheduled pull
        cached = {j for j, t in self.broker.revoked.items() if t <= pulled_at}
        b = cred.body
        if not hmac.compare_digest(sign(BROKER_KEY, b), cred.sig):
            return "DENY bad signature"
        if b["exp"] <= now:
            return "DENY expired"
        if any(j in cached for j in b["chain"]):
            return "DENY revoked"
        if not any(covers(s, action) for s in b["scopes"]):
            return "DENY out of scope"
        return "ALLOW"


def main() -> None:
    broker = Broker()
    rs = ResourceServer(broker)
    ident = {"workload": "billing-api", "node": "n-17", "exp": 3600}
    good_sig = sign(PLATFORM_KEY, ident)

    def attempt(label: str, fn) -> object:
        try:
            out = fn()
            print(f"{label:<44} ok   {out.body['jti']} exp={out.body['exp']}")
            return out
        except PermissionError as e:
            print(f"{label:<44} FAIL {e}")
            return None

    print("-- issue and down-scope")
    parent = attempt("t=0   issue read+decrypt, ask ttl 3600",
                     lambda: broker.issue(0, ident, good_sig, {"s3:read:invoices/*", "kms:decrypt:invoice-key"}, 3600))
    attempt("t=5   issue with forged identity", lambda: broker.issue(5, {**ident, "workload": "admin"}, good_sig, {"s3:read:invoices/*"}, 60))
    attempt("t=10  issue s3:write (not in policy)", lambda: broker.issue(10, ident, good_sig, {"s3:write:invoices/*"}, 60))
    child = attempt("t=20  downscope to one month, ttl 300",
                    lambda: broker.downscope(20, parent, {"s3:read:invoices/2026-10/*"}, 300))
    attempt("t=30  child asks for kms:decrypt", lambda: broker.downscope(30, child, {"kms:decrypt:invoice-key"}, 60))

    print("\n-- resource server checks (revocation list pulled every 60 s)")
    for now, cred, name, action in [
        (40, child, "child", "s3:read:invoices/2026-10/a.pdf"),
        (40, child, "child", "s3:read:invoices/2026-09/b.pdf"),
        (50, parent, "parent", "kms:decrypt:invoice-key"),
    ]:
        print(f"t={now:<4} {name:<6} {action:<32} {rs.check(now, cred, action)}")
    broker.revoke(100, parent.body["jti"], "node n-17 reported compromised")
    for now, cred, name in [(110, child, "child"), (110, parent, "parent"),
                            (125, child, "child"), (125, parent, "parent")]:
        print(f"t={now:<4} {name:<6} {'s3:read:invoices/2026-10/a.pdf':<32} "
              f"{rs.check(now, cred, 's3:read:invoices/2026-10/a.pdf')}")
    attempt("t=130 downscope from revoked parent", lambda: broker.downscope(130, parent, {"s3:read:invoices/x"}, 60))

    print("\n-- audit log")
    for line in broker.audit:
        print(line)


if __name__ == "__main__":
    main()
```

Run it with `python3 broker.py`:

```text
-- issue and down-scope
t=0   issue read+decrypt, ask ttl 3600       ok   c1 exp=900
t=5   issue with forged identity             FAIL identity not verified
t=10  issue s3:write (not in policy)         FAIL not permitted: ['s3:write:invoices/*']
t=20  downscope to one month, ttl 300        ok   c2 exp=320
t=30  child asks for kms:decrypt             FAIL escalation: ['kms:decrypt:invoice-key']

-- resource server checks (revocation list pulled every 60 s)
t=40   child  s3:read:invoices/2026-10/a.pdf   ALLOW
t=40   child  s3:read:invoices/2026-09/b.pdf   DENY out of scope
t=50   parent kms:decrypt:invoice-key          ALLOW
t=110  child  s3:read:invoices/2026-10/a.pdf   ALLOW
t=110  parent s3:read:invoices/2026-10/a.pdf   ALLOW
t=125  child  s3:read:invoices/2026-10/a.pdf   DENY revoked
t=125  parent s3:read:invoices/2026-10/a.pdf   DENY revoked
t=130 downscope from revoked parent          FAIL invalid parent

-- audit log
t=0    MINT   c1 sub=billing-api exp=900 scopes=['kms:decrypt:invoice-key', 's3:read:invoices/*']
t=5    DENY   identity for admin: bad signature or expired
t=10   DENY   billing-api asked beyond policy: ['s3:write:invoices/*']
t=20   MINT   c2 sub=billing-api exp=320 scopes=['s3:read:invoices/2026-10/*']
t=30   DENY   c2 tried to widen: ['kms:decrypt:invoice-key']
t=100  REVOKE c1 (node n-17 reported compromised)
t=130  DENY   downscope of c1: invalid parent
```

Three things to notice. The broker clamped a requested TTL of 3,600 s to the
policy's 900 s, and the child's expiry is bounded by its own TTL request of
300 s (I2). The child's attempt to regain `kms:decrypt` failed, because
attenuation is checked against the parent, not the policy (I1). And at t = 110,
10 s after revocation, both credentials were **still accepted**: the resource
server's copy of the revocation list was last pulled at t = 60. They were
rejected at t = 125, after the pull at t = 120. That 60 s window is the
revocation latency I4 allows, made visible.

The same run as a timeline of messages: the resource server is acting on a
list copied at t = 60 until its next pull at t = 120.

```mermaid {title="Revocation reaches a verifier at its next pull, not when it is issued"}
sequenceDiagram
  autonumber
  participant W as Workload
  participant B as Broker
  participant R as Resource server
  R->>B: t=60 pull revocation list
  B-->>R: nothing revoked
  B->>B: t=100 revoke c1, node n-17 compromised
  W->>R: t=110 request with c2, child of c1
  R-->>W: ALLOW, list copy is from t=60
  R->>B: t=120 pull revocation list
  B-->>R: c1 revoked
  W->>R: t=125 request with c2
  R-->>W: DENY revoked, chain contains c1
  Note over B,R: exposure after revoking is up to one pull interval
```

The second program asks whether the broker is a hard dependency. A workload
calls a service every 10 s; the broker is down from t = 1,700 for varying
lengths of time.

```python {title="outage.py"}
"""outage.py: is the credential broker a hard dependency?

A workload calls a downstream service every 10 s for 100 minutes. Each call
needs a valid credential (TTL 900 s) from the broker. The broker is down from
t=1700 for a varying length of time. Three client strategies are compared.
Simulated clock; standard library only.
"""

from __future__ import annotations

TTL = 900
CALL_EVERY = 10
END = 6000
OUTAGE_START = 1700


def simulate(strategy: str, outage: int) -> tuple[int, int]:
    """Return (failed calls, broker requests)."""
    exp, issued, failed, requests = -1, -1, 0, 0

    def broker_up(t: int) -> bool:
        return not (OUTAGE_START <= t < OUTAGE_START + outage)

    for t in range(0, END, CALL_EVERY):
        if strategy == "per call":
            want = True
        elif strategy == "at expiry":
            want = t >= exp
        else:  # "at half-life": refresh early, keep the old one if the broker is down
            want = t >= exp or t - issued >= TTL // 2
        if want:
            requests += 1
            if broker_up(t):
                issued, exp = t, t + TTL
            elif strategy == "per call":
                exp = -1                      # nothing cached to fall back on
        if t >= exp:
            failed += 1
    return failed, requests


def main() -> None:
    calls = END // CALL_EVERY
    print(f"{calls} calls, credential TTL {TTL} s, outage starts at t={OUTAGE_START}\n")
    strategies = ["per call", "at expiry", "at half-life"]
    print(f"{'outage':>8}  " + "".join(f"{s:>16}" for s in strategies))
    for outage in (60, 300, 600, 900, 1800):
        row = [simulate(s, outage)[0] for s in strategies]
        print(f"{outage:>6} s  " + "".join(f"{n:>9} failed" for n in row))
    print("\nbroker requests with no outage:")
    for s in strategies:
        print(f"  {s:<13} {simulate(s, 0)[1]:>4}")


if __name__ == "__main__":
    main()
```

Run it with `python3 outage.py`:

```text
600 calls, credential TTL 900 s, outage starts at t=1700

  outage          per call       at expiry    at half-life
    60 s          6 failed        0 failed        0 failed
   300 s         30 failed       20 failed        0 failed
   600 s         60 failed       50 failed        5 failed
   900 s         90 failed       80 failed       35 failed
  1800 s        180 failed      170 failed      125 failed

broker requests with no outage:
  per call       600
  at expiry        7
  at half-life    14
```

Fetching a credential **per call** fails every call during the outage and
sends 600 requests to the broker in 100 minutes. Refreshing **at expiry** is
cheap (7 requests) but fragile: an outage that happens to cover the expiry time
fails calls even though the outage is shorter than the TTL. Refreshing **at
half-life** doubles broker load to 14 requests and survives any outage shorter
than half the TTL, 450 s here, with no failures; in the 600 s case it fails only
the last 5 calls. That is static stability: the cheapest insurance is a refresh
policy, not more broker replicas.

Plotted from the table, the three lines are, from top to bottom, per call, at
expiry, and at half-life. Only the bottom line stays at zero through a 300 s
outage.

```mermaid {title="Failed calls by outage length: refreshing at half-life absorbs short outages"}
xychart-beta
  title "Failed calls out of 600, by broker outage length"
  x-axis "Broker outage in seconds" [60, 300, 600, 900, 1800]
  y-axis "Failed calls" 0 --> 200
  line [6, 30, 60, 90, 180]
  line [0, 20, 50, 80, 170]
  line [0, 0, 5, 35, 125]
```

## Where it breaks

- **Static stability ends at the TTL.** An outage longer than the remaining
  credential lifetime still fails requests. Longer TTLs buy outage tolerance
  and cost revocation exposure; you are choosing a point on that tradeoff, not
  escaping it.
- **Offline verification means revocation is eventually consistent.** Within
  the pull interval, a revoked credential works. If that window is
  unacceptable for some resource, that resource must call introspection and
  accept the broker on its critical path.
- **The broker cannot fix a bad policy.** It enforces what policy says. A
  policy granting `s3:*` to every workload is enforced faithfully.
- **The simulation trusts its own pieces.** HMAC stands in for asymmetric
  signatures, the platform's attestation is a shared key, and the clock is
  perfect. A real broker's security rests on attestation quality, key custody,
  and verifier correctness, none of which a simulation proves.

## Remember this

- Identity comes from the platform's attestation, never from the caller's claim.
- Authority only shrinks: child scopes are a subset and child expiry is no later
  than the parent's.
- Audit before returning; if the audit path is down, stop issuing.
- Short TTLs make revocation lists small; offline verification makes
  revocation eventually consistent, so state the window.
- Refresh at half-life and keep the old credential: that, not replicas, is what
  makes a broker outage survivable.

## Try it

1. In `broker.py`, add revocation by subject and time ("everything for
   billing-api issued before t = 50") and show that a credential minted at
   t = 60 still works.
2. Change the resource server's pull interval to 10 s and to 300 s. For each,
   what is the worst-case window between revocation and rejection?
3. In `outage.py`, add 1,000 workloads with random start times (seeded) and a
   broker that serves 20 requests per tick after the outage ends. Compare
   first-come service with soonest-expiring-first. How many calls fail in each?
4. Write the policy for one real workload you know in the form
   identity → scopes, max TTL. Which scopes could be narrowed to a resource
   prefix?

## Check yourself

1. Why must the broker check down-scoping requests against the parent
   credential rather than against policy?

   {{< details summary="Show answer" >}}
   Policy describes what the workload may hold; the parent describes what this
   chain actually holds. A child checked against policy could regain scopes the
   parent deliberately dropped, which would let a subprocess holding a narrow
   credential climb back to the workload's full authority.
   {{< /details >}}

2. Why do short TTLs make revocation lists cheap?

   {{< details summary="Show answer" >}}
   A revoked credential only needs to be listed until it would have expired
   anyway. With a 15-minute TTL, the list only ever contains the last 15 minutes
   of revocations, so it stays small enough to push to every verifier.
   {{< /details >}}

3. A resource server verifies credentials offline. What does that buy, and
   what does it cost?

   {{< details summary="Show answer" >}}
   It keeps the broker off the request path: requests keep working when the
   broker is slow or down, and the broker's load scales with issuance rather
   than with request rate. The cost is that revocation is only as fresh as the
   resource server's copy of the revocation list.
   {{< /details >}}

4. The audit queue is full. Should the broker keep issuing credentials?

   {{< details summary="Show answer" >}}
   No. Unaudited credentials violate the invariant that every issue is
   recorded, and an attacker who can fill the queue would otherwise get
   unrecorded credentials. Because workloads refresh early and keep their
   current credentials, stopping issuance briefly does not stop them working.
   {{< /details >}}

5. Why does refreshing at half-life survive outages that refreshing at expiry
   does not?

   {{< details summary="Show answer" >}}
   Refreshing at expiry leaves no margin: if the broker is down at that moment,
   the credential is already invalid. Refreshing at half-life starts trying
   while the current credential still has half its lifetime left, so any outage
   shorter than that margin is absorbed by retries.
   {{< /details >}}

## Sources

- M. Jones et al., [RFC 8693: OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693), IETF, January 2020.
- J. Richer (ed.), [RFC 7662: OAuth 2.0 Token Introspection](https://www.rfc-editor.org/rfc/rfc7662), IETF, October 2015.
- B. Campbell, J. Bradley, N. Sakimura, T. Lodderstedt, [RFC 8705: OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://www.rfc-editor.org/rfc/rfc8705), IETF, February 2020.
- D. Fett et al., [RFC 9449: OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449), IETF, September 2023.
- AWS, [AssumeRole API reference](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html) and [Session policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_session).
- Google Cloud, [Restrict a credential's Cloud Storage permissions with Credential Access Boundaries](https://cloud.google.com/iam/docs/downscoping-short-lived-credentials).
- HashiCorp, [Vault tokens: token hierarchies and orphan tokens](https://developer.hashicorp.com/vault/docs/concepts/tokens) and [Lease, renew, and revoke](https://developer.hashicorp.com/vault/docs/concepts/lease).
- SPIFFE project, [SPIFFE concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/).
- Kubernetes, [Configure service accounts for pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/) (projected service account tokens).
- B. Weiss, M. Furr, [Static stability using Availability Zones](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/), Amazon Builders' Library.
