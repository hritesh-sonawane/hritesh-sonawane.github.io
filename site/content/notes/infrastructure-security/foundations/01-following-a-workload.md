+++
title = 'Following a workload'
description = 'A running process is the last link in a chain of trust decisions from commit to network call. Each hop must prove something to the next, and an attacker who owns one hop inherits everything downstream of it.'
question = 'What does a running workload trust, and what does an attacker inherit at each hop?'
weight = 1
difficulty = 1
date = 2026-06-26
lastmod = 2026-10-30
verified = 2026-06-26
+++

## The idea in one minute

When a service answers a request, it is the end of a long chain. Someone wrote
code; a build system turned it into an image; a registry stored it; a scheduler
decided where to run it; a node pulled and started it; the platform gave the
process an identity; that identity unlocked secrets; the process opened network
connections; and something wrote down what happened. **Every hop trusts the hop
before it to have done its job.** Most of that trust is never written down.

The useful question at each hop is: *what must this hop prove before the next
one acts on its output, and what does an attacker get by owning it?* The answer
is rarely "just this hop". A compromised build system decides what code runs
everywhere. A compromised node holds the credentials of every pod on it. A
compromised pod that can reach the cloud metadata service holds the node's
cloud role. The consequence to act on: **find the hops that are trusted
implicitly, and make each one prove something explicit, narrow, and short-lived.**

## A picture

```mermaid {title="The trust chain of one workload, with the implicit side doors"}
flowchart LR
  SRC["<b>Source</b><br/><small>reviewed commit</small>"] --> BLD["<b>Build</b><br/><small>CI runner</small>"]
  BLD --> REG["<b>Registry</b><br/><small>image digest</small>"]
  REG --> SCH["<b>Scheduler</b><br/><small>admission</small>"]
  SCH --> NODE["<b>Node</b><br/><small>kubelet</small>"]
  NODE --> WL["<b>Workload</b><br/><small>process</small>"]
  WL --> ID["<b>Identity</b><br/><small>short-lived token</small>"]
  ID --> SEC["<b>Secrets</b>"]
  ID --> NET["<b>Network</b>"]
  WL --> LOG["<b>Logs</b>"]
  CIT["CI deploy key"] -.-> SCH
  IMDS["Metadata service<br/><small>node cloud role</small>"] -.-> WL
  KUB["Node credential<br/><small>all pods' tokens</small>"] -.-> ID
  class SRC neutral
  class BLD,REG queue
  class SCH,NODE,WL compute
  class ID good
  class SEC memory
  class NET,LOG io
  class CIT,IMDS,KUB warn
```

The solid arrows are the intended chain. The dashed arrows are where authority
leaks sideways: credentials that let one hop act as another without going
through the front door.

## How it really works

### Nine hops, nine claims

Each hop makes a claim that the next hop relies on. Write the claim down and
you know what to verify; leave it implicit and you have a hop that trusts
whatever arrives.

| Hop | What it must prove to the next | What usually stands in for proof |
| --- | --- | --- |
| **Source** | Who changed the code, and that the change was reviewed | Branch protection, signed commits, required reviews |
| **Build** | This artifact came from that commit, built by this builder, with these inputs | Build provenance (SLSA), an isolated builder, pinned dependencies |
| **Registry** | The image you pull is byte-for-byte the image that was built | Content-addressed digests (`sha256:…`), signatures checked at deploy |
| **Scheduler** | Only specs that passed policy run, and only on the intended nodes | Admission control, RBAC on the API server, node selectors and taints |
| **Node** | It is a genuine machine in this cluster, running expected software | Node bootstrap tokens, TPM or cloud instance identity, node authorization |
| **Workload** | It is the process it claims to be | Attestation by the platform: namespace, service account, image, node |
| **Identity** | The token names this workload, for this audience, for a short time | Projected service account tokens, SPIFFE SVIDs, federated cloud credentials |
| **Secrets** | The caller is entitled to this secret now | Per-identity policy in a secret store, short leases, audit |
| **Network** | The peer is who it says it is and may talk to this service | Mutual TLS with workload identities, network policy |
| **Logs** | The record is complete and nobody altered it | Write-only sinks, separate accounts, integrity protection |

Two things stand out. First, the right-hand column is mostly **mechanisms that
were added later**: none of them is on by default everywhere. Second, the claims
compound. Admission control that checks image signatures is only as good as
the builder that signed them; a workload token is only as good as the node that
requested it.

Here are the same hops as real components; notice that most of them sit inside
two boundaries, the cluster and the cloud account, that trust each other.

```mermaid {title="The nine hops mapped onto a typical GitHub, Kubernetes and AWS deployment"}
flowchart TB
  n_repo["Source"]
  n_ci["Build"]
  n_reg["Registry"]
  subgraph g_cluster["Cluster"]
    n_api["Scheduler"]
    n_node["Node"]
    n_pod["Workload"]
    n_net["Network"]
  end
  subgraph g_acct["Cloud account"]
    n_iam["Identity"]
    n_sm["Secrets"]
    n_trail["Logs"]
  end
  n_repo --> n_ci
  n_ci --> n_reg
  n_reg --> n_api
  n_api --> n_node
  n_node --> n_pod
  n_pod --> n_net
  n_pod --> n_iam
  n_iam --> n_sm
  n_iam --> n_trail
```

### Authority flows downstream

An attacker who owns a hop gets two things: whatever credentials sit on that hop,
and the ability to decide what some later hop does. The second part is the one
people miss.

- **Owning the build** means choosing the code that runs in production. The
  SolarWinds compromise disclosed in December 2020 is the canonical case:
  attackers altered the build process, so the vendor's own signed updates
  carried the backdoor. Signing proved the build system produced the artifact,
  which was true.
- **Owning the registry** means swapping what a tag points at. Tags such as
  `:latest` or `:v3` are mutable pointers; only a digest names fixed bytes. A
  deployment that pulls by tag trusts the registry to never move the pointer.
- **Owning the scheduler**, or any credential with broad rights on the
  Kubernetes API, means running any image, on any node, with any mounted secret.
  In most clusters that is equivalent to owning everything the cluster can reach.
- **Owning a node** means owning every workload scheduled on it: their memory,
  their file systems, and the tokens mounted into them.

The registry case is the easiest to see: follow where each deployment's arrow
lands after someone with push rights moves the tag.

```mermaid {title="A tag is a pointer the registry can move, a digest is not"}
flowchart LR
  ATK(["Stolen push credential"])
  D1["<b>Deployment</b><br/><small>image: orders:v3</small>"] --> TAG["tag v3"]
  D2["<b>Deployment</b><br/><small>image: orders@sha256:a1f…</small>"] --> A["sha256:a1f…<br/><small>built from the reviewed commit</small>"]
  TAG -.->|"before"| A
  TAG -->|"after"| B["sha256:9c2…<br/><small>pushed by the attacker</small>"]
  ATK -->|"moves the tag"| TAG
  class D1 neutral
  class D2,A good
  class TAG queue
  class B warn
```

This is why a compromise rarely stays at the hop where it started. The question
"what does an attacker inherit?" is a **reachability question**, and the code in
this lesson computes it.

### Where implicit trust hides

Three places hold more authority than their position in the chain suggests.

**CI tokens.** A CI pipeline usually needs to push images and often to deploy.
The traditional way was a long-lived secret in the CI system's settings: a cloud
access key, a registry password, a kubeconfig. Every job that runs in that
pipeline, including jobs triggered by a pull request or a compromised
third-party action, can read it. In early 2021, Codecov disclosed that its Bash
Uploader script, which many projects ran inside CI, had been modified to send
the CI environment, with whatever secrets it contained, to an attacker's server.
The fix is to stop storing deploy credentials in CI at all: platforms such as
GitHub Actions issue a short-lived OIDC token per job, naming the repository,
branch, and workflow, which a cloud provider can exchange for a role scoped to
exactly that pipeline. The module on workload identity covers this in
[federated workload identity](/notes/infrastructure-security/workload-identity/03-federated-workload-identity/),
and [CI/CD and build provenance](/notes/infrastructure-security/delivery-and-operations/01-ci-cd-and-build-provenance/)
covers the build hop itself.

Follow the exchange: the job proves which pipeline it is, and the cloud hands
back credentials only for that pipeline's role.

```mermaid {title="A per-job OIDC token replaces the deploy key stored in CI"}
sequenceDiagram
  autonumber
  participant J as CI job
  participant P as GitHub OIDC provider
  participant S as AWS STS
  participant R as Registry and cluster
  J->>P: Request a token for audience sts.amazonaws.com
  P-->>J: Signed token naming repository, branch, workflow
  J->>S: AssumeRoleWithWebIdentity with the token
  Note over S: Trust policy checks issuer, audience and subject
  S-->>J: Short-lived credentials for this pipeline's role
  J->>R: Push the image and deploy
  Note over J,R: No long-lived secret is left in CI settings to steal
```

**Node credentials.** The kubelet on each node holds a credential for the
Kubernetes API so it can fetch the pod specs, secrets, and tokens its pods need.
Without restriction, that credential could read every secret in the cluster.
Kubernetes addresses this with the **Node authorizer** and the
**NodeRestriction** admission plugin: together they limit a kubelet to reading
objects related to pods bound to its own node and to modifying its own Node
object. Even with both enabled, a node still holds the tokens of every pod
scheduled on it, which is why escaping a container onto the node is such a
valuable step.

The authorizer answers one question per request; the dashed arrow leads to what
it cannot touch.

```mermaid {title="The Node authorizer limits what a kubelet asks for, not what its node already holds"}
flowchart LR
  K("kubelet on node A")
  API("API server")
  Z@{ shape: diam, label: "Bound to a pod on node A?" }
  OK["Specs, secrets, tokens<br/><small>for node A's pods</small>"]
  NO["Denied<br/><small>objects for node B's pods</small>"]
  LOCAL["Already on node A's disk<br/><small>tokens of every pod there</small>"]
  K -->|"node credential"| API
  API --> Z
  Z -->|yes| OK
  Z -->|no| NO
  K -.-> LOCAL
  class OK memory
  class NO good
  class LOCAL warn
```

**Metadata services.** Every major cloud exposes an instance metadata endpoint
at a link-local address (`169.254.169.254`) that hands out the credentials of
the role attached to the machine. Any process on the machine that can make an
HTTP request can ask for them, including a container, unless something blocks
it. The 2019 Capital One breach, as described in the US Department of Justice
complaint, combined a misconfigured web application firewall with this endpoint
to obtain role credentials and read storage buckets. AWS introduced IMDSv2 in
November 2019: a session token must first be fetched with a `PUT` request, and
a low IP hop limit on the response (configurable per instance) stops it from crossing an extra
network hop such as a container bridge. Google Cloud and Azure require a request
header (`Metadata-Flavor: Google`, `Metadata: true`) that a naive request
forger cannot add. None of these help if the attacker can run code inside the
pod; for that, block the metadata address from pods with network policy and
give pods their own identity instead of the node's.

Compare the host's request with the container's: the same endpoint, but only
one of them gets a reply.

```mermaid {title="IMDSv2: a PUT for a token, with a hop limit that stops at the container bridge"}
sequenceDiagram
  autonumber
  participant H as Process on the host
  participant C as Process in a container
  participant M as Metadata service 169.254.169.254
  H->>M: PUT /latest/api/token
  M-->>H: Session token, sent with a low IP hop limit
  H->>M: GET role credentials with the token header
  M-->>H: Credentials of the node's role
  C->>M: PUT /latest/api/token
  Note over C,M: The reply needs one more hop across the bridge and is dropped
  C->>M: Plain GET without a token, the shape a forged request has
  M-->>C: Refused when IMDSv2 is required
  Note over C: Code running in the pod can still try, so block the address with network policy
```

> [!IMPORTANT]
> A pod's effective authority is not what its own service account allows. It is
> the union of everything it can reach without asking: its own token, the node's
> cloud role through the metadata service, and anything on a shared volume.

### Identity is the pivot

In the chain above, one hop does most of the work: **identity**. Secrets,
network access, and cloud API calls all hinge on "who is this workload?" If the
answer is a static key in an environment variable, every hop that can read the
environment holds that identity forever. If the answer is a short-lived token
that the platform issues after checking which pod, service account, and node is
asking, then stealing it buys minutes, not months, and it says exactly which
workload it was stolen from.

Place each credential from this lesson by how long it lives and how much it
unlocks; the hardening work is moving points toward the bottom left.

```mermaid {title="What a stolen credential is worth: lifetime against scope"}
quadrantChart
  title Value of a stolen credential
  x-axis Short-lived --> Long-lived
  y-axis Narrow scope --> Broad scope
  quadrant-1 Steal this first
  quadrant-2 Broad but brief
  quadrant-3 Minutes for one workload
  quadrant-4 Narrow but forever
  Deploy key in CI settings: [0.9, 0.85]
  Node role via metadata: [0.3, 0.8]
  Static key in env var: [0.85, 0.3]
  Projected SA token: [0.15, 0.2]
  Per-job OIDC token: [0.1, 0.35]
```

This is why the course spends a whole module on
[workload identity](/notes/infrastructure-security/workload-identity/01-why-static-credentials-fail/)
before it reaches secrets. Most secrets exist only because a workload had no
better way to prove who it is.

### Logs are part of the chain

Logs are the last hop and the one most often left out of threat models. They
must prove that the record is complete. An attacker who can delete or edit
logs does not gain access to anything new, but turns every other hop's
compromise into one you cannot investigate. Cloud audit logs (AWS CloudTrail,
Google Cloud Audit Logs, Azure Activity Log) and the Kubernetes audit log should
be shipped to a separate account or project that production identities can
write to but not delete from. The detection side is covered in
[audit logs and detection](/notes/infrastructure-security/delivery-and-operations/03-audit-logs-and-detection/).

## Code

The program models the chain as data. Each hop lists the credentials it holds,
the later hops whose behavior it decides, and any credentials it can reach
implicitly. A breadth-first walk from a compromised hop collects everything the
attacker inherits. It then applies three controls and walks again:

1. CI uses a per-job OIDC token instead of a stored deploy key with cluster rights.
2. Admission verifies image signatures, so the registry can no longer decide what runs.
3. Pods cannot reach the instance metadata service.

```python {title="trust_chain.py"}
"""trust_chain.py: what an attacker inherits from each hop of a workload's trust chain.

Each hop holds some credentials and decides what some later hop will do. Owning
a hop means owning what it holds plus everything it decides, transitively.
Standard library only; the platform is simulated.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Hop:
    name: str
    proves: str  # what this hop should prove before the next hop trusts it
    holds: frozenset[str]  # credentials or data present at this hop
    decides: tuple[str, ...]  # hops whose code, placement or config this hop determines
    implicit: tuple[str, ...] = field(default=())  # reachable without asking anyone


def chain(hardened: bool) -> dict[str, Hop]:
    """The same pipeline, with or without three common controls applied."""
    ci_holds = {"ci-oidc-token"} if hardened else {"ci-oidc-token", "static-deploy-key"}
    # The builder signs what it builds, so it decides what runs either way.
    ci_decides = ("registry", "workload") if hardened else ("registry", "scheduler")
    reg_decides = () if hardened else ("workload",)  # signatures checked at admission
    wl_implicit = () if hardened else ("node-cloud-role",)  # IMDS reachable from pods
    hops = [
        Hop("source", "who changed the code, and was it reviewed",
            frozenset({"repo-write"}), ("build",)),
        Hop("build", "this artifact came from that commit",
            frozenset(ci_holds), ci_decides),
        Hop("registry", "the digest you pull is the digest that was built",
            frozenset({"registry-push"}), reg_decides),
        Hop("scheduler", "only admitted specs run, on the intended nodes",
            frozenset({"cluster-admin"}), ("node", "workload", "secrets")),
        Hop("node", "it is a genuine machine in this cluster",
            frozenset({"kubelet-cred", "node-cloud-role"}), ("workload",)),
        Hop("workload", "it is the process it claims to be",
            frozenset({"workload-token"}), ("identity",), wl_implicit),
        Hop("identity", "the token names this workload, for this audience, briefly",
            frozenset({"cloud-session:orders"}), ("secrets", "network")),
        Hop("secrets", "the caller is entitled to this secret now",
            frozenset({"db-password", "payment-api-key"}), ()),
        Hop("network", "the peer is who it says and may talk to us",
            frozenset({"east-west-reach"}), ()),
        Hop("logs", "records are complete and unaltered",
            frozenset({"log-delete"}), ()),
    ]
    return {h.name: h for h in hops}


def inherited(hops: dict[str, Hop], start: str) -> tuple[list[str], set[str]]:
    """Breadth-first over 'decides' edges and implicit credentials."""
    seen, queue, creds = [start], [start], set()
    while queue:
        hop = hops[queue.pop(0)]
        creds |= hop.holds
        creds |= set(hop.implicit)  # a stolen credential, not control of its hop
        for name in hop.decides:
            if name not in seen:
                seen.append(name)
                queue.append(name)
    return seen, creds


SENSITIVE = {"db-password", "payment-api-key", "node-cloud-role",
             "cluster-admin", "static-deploy-key", "log-delete"}


def report(hops: dict[str, Hop], title: str) -> dict[str, int]:
    print(title)
    print(f"  {'owned':<10} {'hops':>4} {'creds':>5}  sensitive credentials inherited")
    sizes = {}
    for name in hops:
        reached, creds = inherited(hops, name)
        hot = sorted(creds & SENSITIVE)
        sizes[name] = len(creds)
        print(f"  {name:<10} {len(reached):>4} {len(creds):>5}  {', '.join(hot) or '-'}")
    return sizes


def show_proofs(hops: dict[str, Hop]) -> None:
    print("what each hop must prove")
    for h in hops.values():
        print(f"  {h.name:<10} {h.proves}")
    print()


if __name__ == "__main__":
    show_proofs(chain(hardened=False))
    before = report(chain(hardened=False), "as deployed")
    print()
    after = report(chain(hardened=True), "with three controls")
    print()
    shrank = [n for n in before if after[n] < before[n]]
    print("blast radius shrank for:", ", ".join(shrank))
    for name in ("build", "registry", "workload"):
        _, creds = inherited(chain(hardened=True), name)
        print(f"hardened {name:<8} still reaches payment-api-key: {'payment-api-key' in creds}")
```

Run it with `python3 trust_chain.py`:

```text
what each hop must prove
  source     who changed the code, and was it reviewed
  build      this artifact came from that commit
  registry   the digest you pull is the digest that was built
  scheduler  only admitted specs run, on the intended nodes
  node       it is a genuine machine in this cluster
  workload   it is the process it claims to be
  identity   the token names this workload, for this audience, briefly
  secrets    the caller is entitled to this secret now
  network    the peer is who it says and may talk to us
  logs       records are complete and unaltered

as deployed
  owned      hops creds  sensitive credentials inherited
  source        9    12  cluster-admin, db-password, node-cloud-role, payment-api-key, static-deploy-key
  build         8    11  cluster-admin, db-password, node-cloud-role, payment-api-key, static-deploy-key
  registry      5     7  db-password, node-cloud-role, payment-api-key
  scheduler     6     8  cluster-admin, db-password, node-cloud-role, payment-api-key
  node          5     7  db-password, node-cloud-role, payment-api-key
  workload      4     6  db-password, node-cloud-role, payment-api-key
  identity      3     4  db-password, payment-api-key
  secrets       1     2  db-password, payment-api-key
  network       1     1  -
  logs          1     1  log-delete

with three controls
  owned      hops creds  sensitive credentials inherited
  source        7     8  db-password, payment-api-key
  build         6     7  db-password, payment-api-key
  registry      1     1  -
  scheduler     6     8  cluster-admin, db-password, node-cloud-role, payment-api-key
  node          5     7  db-password, node-cloud-role, payment-api-key
  workload      4     5  db-password, payment-api-key
  identity      3     4  db-password, payment-api-key
  secrets       1     2  db-password, payment-api-key
  network       1     1  -
  logs          1     1  log-delete

blast radius shrank for: source, build, registry, workload
hardened build    still reaches payment-api-key: True
hardened registry still reaches payment-api-key: False
hardened workload still reaches payment-api-key: True
```

Read the two tables side by side. Removing the stored deploy key takes
`cluster-admin` out of reach from source and build. Signature checks at
admission reduce the registry to a hop that holds only its own push credential.
Blocking the metadata service takes the node's cloud role away from the
workload. Three hops do not change at all: owning the scheduler or a node is
still owning almost everything, and **a compromised build still reaches the
payment key**, because the builder signs whatever it builds. Signing moves trust
onto the builder; it does not remove it.

The same numbers as a chart: bars are the credential counts as deployed, the
line is the count with the three controls. Where the line meets the bar, the
controls changed nothing.

```mermaid {title="Credentials inherited per owned hop, before and after three controls"}
xychart-beta
  title "Credentials inherited, from trust_chain.py"
  x-axis [source, build, registry, scheduler, node, workload, identity, secrets, network, logs]
  y-axis "Credentials" 0 --> 12
  bar [12, 11, 7, 8, 7, 6, 4, 2, 1, 1]
  line [8, 7, 1, 8, 7, 5, 4, 2, 1, 1]
```

## Where it breaks

- **The model is only as good as its edges.** The program finds what follows
  from the edges you wrote down. The edges that cause incidents are the ones
  nobody wrote down: a debug sidecar with a broad role, a shared volume, a
  forgotten access key. Building the model is mostly the work of discovering
  those.
- **"Decides" is coarser than reality.** Owning a node decides the pods on that
  node, not every workload. Owning the scheduler might be limited by admission
  policy the attacker cannot bypass. A real analysis splits hops into instances
  (this node, that namespace) and adds conditions; the next lesson does that
  with a graph.
- **Controls have preconditions.** Signature verification at admission only
  helps if every path into the cluster goes through admission, including
  `kubectl debug`, static pods, and nodes that run containers outside the
  scheduler. Blocking metadata only helps if every pod network path is covered.
- **The workload's own entitlement remains.** The last line of the output is
  the point: no amount of chain hardening changes what the workload itself is
  allowed to read. If the orders service can read the payment key, an attacker
  in the orders service can read it too. That is least privilege, covered in
  [cloud IAM fundamentals](/notes/infrastructure-security/foundations/03-cloud-iam-fundamentals/).
- **Logs cannot prevent anything.** The logs hop has no downstream edges because
  it decides nothing. Its value is that every other row in the table becomes
  investigable, which this model does not measure.

## Remember this

- A running process is the end of a chain: source, build, registry, scheduler,
  node, workload, identity, secrets, network, logs.
- For every hop, write down what it must prove to the next one.
- An attacker inherits a hop's credentials **and** every later hop it decides.
- Implicit trust hides in CI secrets, node credentials, and metadata services.
- Signing moves trust to the builder; short-lived identity limits what a stolen
  credential is worth.
- Hardening the chain does not reduce what the workload itself is allowed to do.

## Try it

1. Run `trust_chain.py`. Add a hop for a third-party GitHub Action that runs in
   the build job. What does it decide, and what does it inherit as deployed?
2. Model the effect of the Node authorizer: split `node` into `node-a` and
   `node-b`, each deciding only its own workloads. How does the scheduler row
   compare with the node rows?
3. Add a `debug-sidecar` that shares the workload's network namespace and has its
   own role with `secretsmanager:GetSecretValue` on `*`. Where does it appear in
   the "as deployed" table?
4. For a service you run, fill in the nine-hop table from this lesson with what
   each hop actually proves today. Mark each row "explicit", "implicit", or "nothing".

## Check yourself

1. Why does signing images at build time not protect against a compromised build
   system?

   {{< details summary="Show answer" >}}
   The signature proves that the build system produced the image. If the build
   system itself is compromised, it signs the attacker's image just as it signs
   legitimate ones, and admission accepts it. Signing protects the hops after
   the builder (registry, transport, deployment), not the builder. Protecting
   the builder takes isolation, provenance that records inputs, and
   reproducibility.
   {{< /details >}}

2. A pod's service account has read access to one queue. Why might the pod
   still be able to read every S3 bucket in the account?

   {{< details summary="Show answer" >}}
   If the pod can reach the instance metadata service, it can obtain the
   credentials of the role attached to the node. That role is often broad,
   because it serves every pod on the node and the node's own needs. The pod's
   effective authority is the union of everything reachable, not just its own
   service account.
   {{< /details >}}

3. What do the Node authorizer and NodeRestriction admission plugin limit, and
   what do they not?

   {{< details summary="Show answer" >}}
   They limit a kubelet's API credential to objects related to pods bound to its
   own node, and to modifying its own Node object, so a stolen kubelet
   credential cannot read every secret in the cluster. They do not change the
   fact that the node already holds the tokens and secrets of every pod running
   on it.
   {{< /details >}}

4. Why is a per-job OIDC token better than a stored deploy key in CI?

   {{< details summary="Show answer" >}}
   The OIDC token is issued per job, expires within minutes, and names the
   repository, branch, and workflow, so the cloud side can grant a role only to
   that exact pipeline. A stored key is readable by every job, lives until
   someone rotates it, and says nothing about which pipeline used it. Stealing
   the token buys a short window for one pipeline's role; stealing the key buys
   everything the key can do, indefinitely.
   {{< /details >}}

5. Why include logs in the trust chain if they grant no access?

   {{< details summary="Show answer" >}}
   Because every other hop's compromise is only investigable if the record is
   complete. An attacker who can delete or edit logs turns a detectable
   incident into an unbounded one. Logs must prove completeness and integrity,
   which usually means a separate account that production identities can write
   to but not modify.
   {{< /details >}}

## Sources

- SLSA, [Supply-chain Levels for Software Artifacts, specification v1.0](https://slsa.dev/spec/v1.0/), April 2023.
- Kubernetes documentation, [Using Node Authorization](https://kubernetes.io/docs/reference/access-authn-authz/node/).
- Kubernetes documentation, [Admission control: NodeRestriction](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#noderestriction).
- Kubernetes documentation, [Service account tokens](https://kubernetes.io/docs/concepts/security/service-accounts/).
- Amazon Web Services, [Use the Instance Metadata Service to access instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html), Amazon EC2 User Guide.
- C. MacCárthaigh, [Add defense in depth against open firewalls, reverse proxies, and SSRF vulnerabilities with enhancements to the EC2 Instance Metadata Service](https://aws.amazon.com/blogs/security/defense-in-depth-open-firewalls-reverse-proxies-ssrf-vulnerabilities-ec2-instance-metadata-service/), AWS Security Blog, November 2019.
- GitHub documentation, [About security hardening with OpenID Connect](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect).
- Codecov, [Bash Uploader security update](https://about.codecov.io/security-update/), April 2021.
- United States v. Paige A. Thompson, criminal complaint, US District Court, Western District of Washington, July 2019.
- Google Cloud documentation, [About VM metadata](https://cloud.google.com/compute/docs/metadata/overview).
