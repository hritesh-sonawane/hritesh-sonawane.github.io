+++
title = 'Glossary'
description = 'Short definitions of the terms this course uses, each linked to the lesson that explains it.'
weight = 100
+++

Short definitions of the terms used in this course. Where a lesson explains a
term in depth, the term links to it.

## A

- **[Admission controller](/notes/infrastructure-security/isolation/02-the-kubernetes-security-model/)**:
  A Kubernetes component that inspects, and may mutate or reject, an object
  after authentication and authorization but before it is stored. Cluster-wide
  policy lives here.
- **[Attestation](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  Identifying a caller through a channel it does not control, then looking up
  facts about it from an authority out of its reach. A claim such as an
  environment variable is not attestation.
- **[Audience](/notes/infrastructure-security/workload-identity/03-federated-workload-identity/)**:
  The token claim (`aud`) naming which relying party a token was minted for.
  It stops replay at another service but does not distinguish one repository
  from another.
- **[AWS IAM Access Analyzer](/notes/infrastructure-security/foundations/03-cloud-iam-fundamentals/)**:
  An AWS service that reports resources shared outside a zone of trust and
  roles, keys, or permissions that have gone unused. It can also generate
  policies from CloudTrail history and run checks in CI.
## B

- **[Blast radius](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  How much data a single leaked or misused key exposes. A key hierarchy
  shrinks it, since a leaked DEK exposes one object and a per-tenant KEK
  exposes one tenant.
- **[Build provenance](/notes/infrastructure-security/delivery-and-operations/01-ci-cd-and-build-provenance/)**:
  A signed record of how an artifact was built: which source, builder, and
  inputs produced it. It attests to what the builder did, not to whether the
  builder was honest.
## C

- **[Canary token](/notes/infrastructure-security/secrets/04-secret-sprawl-and-detection/)**:
  A credential or record that no legitimate process ever uses, placed where an
  intruder would look. Any use is unauthorized, so the alert has very high
  signal. Also called a honeytoken.
- **[Capability (Linux)](/notes/infrastructure-security/isolation/01-containers-from-the-kernel-up/)**:
  One of about forty pieces into which the kernel splits the all-or-nothing
  power of root, such as `CAP_NET_BIND_SERVICE` or `CAP_SYS_ADMIN`. Container
  runtimes drop most by default, and adding them back removes a wall.
- **[cgroup](/notes/infrastructure-security/isolation/01-containers-from-the-kernel-up/)**:
  A Linux control group that caps what a process can use: CPU, memory, process
  count, and I/O. It addresses availability, not confidentiality.
- **[CloudTrail](/notes/infrastructure-security/delivery-and-operations/03-audit-logs-and-detection/)**:
  The AWS audit log. Management events cover control-plane calls and data
  events cover object-level calls; a trail keeps events beyond the 90-day
  event history.
- **[Confused deputy](/notes/infrastructure-security/foundations/03-cloud-iam-fundamentals/)**:
  A vendor tricked into using one customer's role on behalf of another
  customer. Requiring a per-customer `sts:ExternalId` in the role's trust
  policy prevents it.
- **[Cosign](/notes/infrastructure-security/delivery-and-operations/02-signing-and-admission/)**:
  The Sigstore tool that signs and verifies container images, using a stored
  key, a KMS key, a hardware token, or keyless mode.
- **[Crypto-shredding](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  Destroying a key-encryption key so that all data wrapped under it becomes
  unrecoverable. It deletes data spread across backups you cannot edit.
## D

- **[Data encryption key (DEK)](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  A key that encrypts one object, file, or session locally. It is stored
  wrapped next to the data and is in plaintext only in memory.
- **[Detection engineering](/notes/infrastructure-security/delivery-and-operations/03-audit-logs-and-detection/)**:
  Treating a detection as code with an owner, version, tests, and runbook. It
  starts from a written hypothesis about attacker behavior.
- **[DSSE](/notes/infrastructure-security/delivery-and-operations/01-ci-cd-and-build-provenance/)**:
  Dead Simple Signing Envelope, the in-toto envelope holding a payload type,
  the base64 payload, and signatures. It signs the type and bytes together, so
  a signature cannot be replayed as another payload type.
- **[Dynamic secret](/notes/infrastructure-security/secrets/02-vaults-and-dynamic-secrets/)**:
  A credential a secrets engine generates on demand, with a lease, instead of
  storing it. The vault revokes it at the target when the lease ends.
## E

- **[East-west traffic](/notes/infrastructure-security/isolation/04-network-segmentation-and-zero-trust/)**:
  Traffic between internal hosts. On a flat network it is unrestricted, which
  is what lateral movement relies on.
- **[Egress control](/notes/infrastructure-security/isolation/04-network-segmentation-and-zero-trust/)**:
  Restricting outbound traffic, typically default-deny with an allowlist of
  destinations enforced at a proxy. It is where a breach becomes a data
  breach.
- **[Encryption context](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  Non-secret key-value pairs supplied with a KMS call. AWS KMS binds them to
  the ciphertext as additional authenticated data, and they also feed key
  policy conditions and the audit log.
- **[Envelope encryption](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  Encrypting bulk data locally with a data key and storing only that key
  wrapped under a KMS key. Every decrypt then needs a call to the KMS.
- **[etcd](/notes/infrastructure-security/isolation/02-the-kubernetes-security-model/)**:
  The store for all Kubernetes cluster state, including Secret objects.
  Secrets are base64-encoded, not encrypted, unless encryption at rest is
  enabled.
## F

- **[Federated workload identity](/notes/infrastructure-security/workload-identity/03-federated-workload-identity/)**:
  A setup in which a platform's issuer signs short-lived tokens describing a
  workload and a cloud exchanges them for cloud credentials. It has five
  parts: issuer, token, provider registration, trust conditions, and exchange
  endpoint.
- **[Fulcio](/notes/infrastructure-security/delivery-and-operations/02-signing-and-admission/)**:
  The Sigstore certificate authority that issues ten-minute code-signing
  certificates. It validates an OIDC token and puts the signer's identity in
  the certificate.
## G

- **[Grant](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  A delegation attached to an AWS KMS key, naming a grantee, allowed
  operations, and optional encryption-context constraints. Grants do not
  appear in the key policy, so reviews that read only the policy miss them.
- **[gVisor](/notes/infrastructure-security/isolation/03-sandboxes-and-microvms/)**:
  A sandbox that handles the workload's syscalls in Sentry, a kernel written
  in Go that runs in user space. It trades compatibility and per-syscall
  overhead for a narrower host interface.
## H

- **[Hermetic build](/notes/infrastructure-security/delivery-and-operations/01-ci-cd-and-build-provenance/)**:
  A build that declares all inputs up front, fetches them by digest, and runs
  without network access, so the output depends only on those inputs.
## I

- **[Identity-aware proxy](/notes/infrastructure-security/isolation/04-network-segmentation-and-zero-trust/)**:
  A proxy in front of a resource that checks policy for this identity,
  resource, and device state before forwarding. The resource is not reachable
  directly.
- **[Identity-based authorization](/notes/infrastructure-security/workload-identity/04-mutual-tls-between-services/)**:
  Writing access policy in terms of the verified peer workload identity rather
  than IP addresses. It survives rescheduling and address reuse.
- **[IMDSv2](/notes/infrastructure-security/foundations/01-following-a-workload/)**:
  The AWS instance metadata version that requires a session token fetched with
  a `PUT` request, with a low hop limit that keeps responses from crossing a
  container bridge. It does not help against code running inside the pod.
- **[IRSA](/notes/infrastructure-security/workload-identity/03-federated-workload-identity/)**:
  IAM Roles for Service Accounts. The cluster's issuer is registered as an IAM
  OIDC provider, and the role's trust policy requires a matching `sub` and
  `aud`.
## K

- **[Key policy](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  The single policy on every AWS KMS key, which is the primary authority. IAM
  policies grant access only if the key policy delegates to the account.
- **[Key-encryption key (KEK)](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)**:
  A KMS key that wraps the data keys below it. Rotating it does not require
  re-encrypting the data.
- **[Kyverno](/notes/infrastructure-security/delivery-and-operations/02-signing-and-admission/)**:
  A Kubernetes policy engine that verifies image signatures and attestations
  through `verifyImages` rules. It mutates tags to digests by default.
## L

- **[Lateral movement](/notes/infrastructure-security/foundations/02-threat-modeling-infrastructure/)**:
  Reaching another system at a similar privilege level. In cloud
  infrastructure it is the same graph search as privilege escalation.
- **[Lease](/notes/infrastructure-security/secrets/02-vaults-and-dynamic-secrets/)**:
  Metadata on a dynamic secret: an ID, a duration, and a renewable flag.
  Renewal cannot go past the role's `max_ttl`.
- **[Least privilege](/notes/infrastructure-security/foundations/03-cloud-iam-fundamentals/)**:
  Giving each program and user the least set of privileges its job needs. In
  practice: start narrow, observe with CloudTrail, tighten, and guard with
  ceilings.
- **[Linux Security Module](/notes/infrastructure-security/isolation/01-containers-from-the-kernel-up/)**:
  A mandatory-access-control layer the kernel consults after the standard
  checks. AppArmor confines by path-based profile and SELinux by labels.
## M

- **[Microsegmentation](/notes/infrastructure-security/isolation/04-network-segmentation-and-zero-trust/)**:
  Shrinking a network zone to a single workload, so the policy names which
  peers may reach it. In Kubernetes it is a NetworkPolicy.
- **[MicroVM](/notes/infrastructure-security/isolation/03-sandboxes-and-microvms/)**:
  A lightweight virtual machine with its own guest kernel behind a hardware
  boundary. Firecracker and Kata Containers are examples.
- **[Minimum cut](/notes/infrastructure-security/foundations/02-threat-modeling-infrastructure/)**:
  The smallest set of graph edges whose removal disconnects an entry point
  from a crown jewel. By the max-flow min-cut theorem it equals the number of
  edge-disjoint paths.
- **[Mutual TLS (mTLS)](/notes/infrastructure-security/workload-identity/04-mutual-tls-between-services/)**:
  TLS in which both sides present certificates, so the server learns which
  workload is calling. It authenticates the caller but is not authorization.
## N

- **[Namespace (Linux)](/notes/infrastructure-security/isolation/01-containers-from-the-kernel-up/)**:
  A kernel mechanism giving a process its own instance of a global resource,
  such as the filesystem tree, process IDs, or network stack. It makes a
  container look like a separate machine without limiting what it can do.
- **[NetworkPolicy](/notes/infrastructure-security/isolation/02-the-kubernetes-security-model/)**:
  A Kubernetes resource restricting pod traffic. With none selecting a pod,
  all ingress and egress is allowed.
- **[Node attestation](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  Proving which machine a SPIRE agent runs on, using cloud instance identity,
  a projected token, a TPM, or a join token.
- **[Node authorizer](/notes/infrastructure-security/foundations/01-following-a-workload/)**:
  The Kubernetes authorizer that, with the NodeRestriction admission plugin,
  limits a kubelet to objects related to pods on its own node.
## P

- **[Permissions boundary](/notes/infrastructure-security/foundations/03-cloud-iam-fundamentals/)**:
  An IAM policy that sets a ceiling on what a user's or role's identity
  policies can grant. It grants nothing by itself.
- **[Pod Security Admission](/notes/infrastructure-security/isolation/02-the-kubernetes-security-model/)**:
  The built-in admission controller that enforces the Pod Security Standards
  (privileged, baseline, restricted) per namespace by label. It replaced
  PodSecurityPolicy.
- **[Projected service account token](/notes/infrastructure-security/workload-identity/01-why-static-credentials-fail/)**:
  A signed, expiring JWT that the kubelet mounts into a pod and refreshes
  before expiry. It names the pod's service account and carries an audience.
- **[Push protection](/notes/infrastructure-security/secrets/04-secret-sprawl-and-detection/)**:
  Scanning the commits in a push and rejecting it if they contain a supported
  secret. Client-side hooks can be skipped, so rely on the server-side check.
## R

- **[RBAC](/notes/infrastructure-security/isolation/02-the-kubernetes-security-model/)**:
  The default Kubernetes authorizer. Roles list verbs on resources and
  bindings tie them to subjects; it is additive and allow-only, with no deny
  rules.
- **[Rekor](/notes/infrastructure-security/delivery-and-operations/02-signing-and-admission/)**:
  The Sigstore transparency log, an append-only Merkle tree. It gives each
  entry an integrated time and an inclusion proof, which lets verifiers check
  a signature was made within the certificate's window.
- **[Response wrapping](/notes/infrastructure-security/secrets/02-vaults-and-dynamic-secrets/)**:
  Vault storing a response in a single-use location and returning only a
  short-lived wrapping token. If someone else unwraps it first, the legitimate
  unwrap fails, which is an alarm.
## S

- **[Sandbox](/notes/infrastructure-security/isolation/03-sandboxes-and-microvms/)**:
  A boundary stronger than a plain container for running untrusted code. The
  lesson compares gVisor, microVMs, and WebAssembly by attack surface and
  cost.
- **[Seccomp](/notes/infrastructure-security/isolation/01-containers-from-the-kernel-up/)**:
  A filter on the system-call interface itself. Together with capabilities it
  forms two independent locks on the same doors.
- **[Secret scanning](/notes/infrastructure-security/secrets/04-secret-sprawl-and-detection/)**:
  Searching repositories and other stores for credentials using provider
  patterns, entropy, and keyword context. It detects but does not prevent.
- **[Secret sprawl](/notes/infrastructure-security/secrets/04-secret-sprawl-and-detection/)**:
  The spread of copies of a secret into source, history, CI, images, chat,
  laptops, and state files. Every copy outlives the moment it was needed.
- **[Secret zero](/notes/infrastructure-security/secrets/01-the-secret-lifecycle/)**:
  The regress in which the credential used to fetch secrets is itself a secret
  that had to be delivered. Platform attestation, single-use delivery, or a
  human ceremony end it.
- **[Secrets engine](/notes/infrastructure-security/secrets/02-vaults-and-dynamic-secrets/)**:
  A Vault backend mounted at a path, such as key-value, database, cloud
  credentials, PKI, or transit. Dynamic engines generate credentials instead
  of storing them.
- **[Selector](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  A fact a SPIRE attestor discovers about a workload, such as
  `k8s:ns:payments` or `unix:uid:1001`. Registration entries match on
  selectors.
- **[Service control policy (SCP)](/notes/infrastructure-security/foundations/03-cloud-iam-fundamentals/)**:
  An AWS Organizations policy that sets a ceiling on every principal in member
  accounts. Explicit denies there cannot be granted past by account
  administrators.
- **[Service mesh](/notes/infrastructure-security/workload-identity/04-mutual-tls-between-services/)**:
  Infrastructure, such as Istio or Linkerd, that handles mTLS, certificate
  rotation, and identity policy through proxies so applications need not.
- **[Sigma](/notes/infrastructure-security/delivery-and-operations/03-audit-logs-and-detection/)**:
  A vendor-neutral YAML format for detection rules that tooling converts into
  a specific SIEM's query language.
- **[SLSA](/notes/infrastructure-security/delivery-and-operations/01-ci-cd-and-build-provenance/)**:
  Supply-chain Levels for Software Artifacts. Its v1.0 Build track has levels
  L0 to L3, which describe the build platform and what its provenance can be
  trusted for.
- **[SPIFFE ID](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  A URI of the form `spiffe://<trust domain>/<path>` that names software, not
  a machine or person. All replicas of a service share one.
- **[SPIRE](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  A SPIFFE implementation made of a server, which is the CA and registry, and
  an agent on every node that attests workloads and serves the Workload API.
- **[Static credential](/notes/infrastructure-security/workload-identity/01-why-static-credentials-fail/)**:
  A credential that authenticates by possession alone, has no built-in expiry,
  and is shared. The alternative is short-lived credentials issued on demand.
- **[SVID](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  The signed document carrying a SPIFFE ID, either an X.509-SVID for mutual
  TLS or a JWT-SVID, which is a bearer token.
## T

- **[Threat model graph](/notes/infrastructure-security/foundations/02-threat-modeling-infrastructure/)**:
  A graph of compute, identities, roles, and resources joined by edges such as
  runs as, can assume, and can read. Attackers think in graphs, so defenders
  search it for paths to crown jewels.
- **[Transparency log](/notes/infrastructure-security/delivery-and-operations/02-signing-and-admission/)**:
  An append-only log such as Rekor, built on a Merkle tree. Consistency proofs
  show a later tree contains an earlier one unchanged.
- **[Trust bundle](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  The CA certificates or public keys for a trust domain, against which relying
  parties validate SVIDs. Trust domains can federate by exchanging bundles.
- **[Trust domain](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  The root of trust in a SPIFFE ID, usually one per organization or
  environment.
- **[Trust policy](/notes/infrastructure-security/foundations/03-cloud-iam-fundamentals/)**:
  The resource-based policy on an IAM role saying who may become it. A
  principal of an account root means this account decides.
## U

- **[User namespace](/notes/infrastructure-security/isolation/01-containers-from-the-kernel-up/)**:
  A namespace mapping container user IDs to different IDs on the host, so UID
  0 inside can be unprivileged outside. Rootless containers build on it.
## W

- **[WebAssembly](/notes/infrastructure-security/isolation/03-sandboxes-and-microvms/)**:
  A sandbox with no ambient authority: a module can call only functions the
  host imports. It suits untrusted logic, not arbitrary Linux workloads.
- **[Workload API](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)**:
  The SPIFFE interface on a Unix socket where a workload asks its local agent
  for an identity without sending credentials.
## Z

- **[Zero trust](/notes/infrastructure-security/isolation/04-network-segmentation-and-zero-trust/)**:
  An architecture with no implicit trust from network location; each access is
  authenticated and authorized per session by identity and policy. NIST SP
  800-207 gives the definition.
