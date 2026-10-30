+++
title = 'Glossary'
description = 'Short definitions of the terms this course uses, each linked to the lesson that explains it.'
weight = 100
+++

Short definitions of the terms used in this course. Where a lesson explains a
term in depth, the term links to it.

## A

- **[Abuse case](/notes/application-security/foundations/02-threat-modeling-an-api/)**:
  What an adversary does with the same features a legitimate use case
  describes. Abuse cases are written as attacker goals against the business.
- **[Algorithm confusion](/notes/application-security/authentication/04-tokens-and-jwt-pitfalls/)**:
  A JWT attack in which the token header switches an RS256 verifier to HS256,
  so the public key is used as an HMAC secret. The fix is for the verifier to
  decide the algorithm in advance.
- **[Allowlist](/notes/application-security/untrusted-input/01-injection-and-parameterization/)**:
  A list of exactly the values or forms that are accepted, with everything else
  rejected. It is the safer choice over a blocklist of known-bad input.
- **[Argon2id](/notes/application-security/authentication/01-storing-credentials/)**:
  A memory-hard password hashing function (RFC 9106) and the lesson's first
  choice for storing passwords.

## B

- **[bcrypt](/notes/application-security/authentication/01-storing-credentials/)**:
  A password hashing function with a logarithmic work factor. It uses only
  4 KiB of state and, in most implementations, only the first 72 bytes of
  input.
- **[BOLA (broken object level authorization)](/notes/application-security/authorization/01-broken-object-level-authorization/)**:
  The server never asks whether this caller may act on this object, so changing
  an identifier returns someone else's data. Older literature calls it IDOR.

## C

- **[Confused deputy](/notes/application-security/foundations/01-the-request-is-a-trust-boundary/)**:
  A program that uses its own authority on a target the attacker chose. The
  defense is to check the requester's authority, not the deputy's.
- **[Content Security Policy (CSP)](/notes/application-security/untrusted-input/02-xss-and-output-encoding/)**:
  A response header that limits which scripts a page may run. The current
  recommendation is a strict CSP based on nonces or hashes.
- **[Credential stuffing](/notes/application-security/authentication/01-storing-credentials/)**:
  Trying passwords leaked from other breaches against your sign-in. Screening
  new passwords against breach lists and rate limiting are the defenses.
- **[CSRF (cross-site request forgery)](/notes/application-security/authentication/02-sessions-and-cookies/)**:
  A page on another site causes the victim's browser to send a state-changing
  request with the victim's cookie. SameSite helps but is not a complete
  defense.
- **[CWE](/notes/application-security/foundations/03-the-vulnerability-classes-that-matter/)**:
  The Common Weakness Enumeration, a catalog of weakness types with stable
  numeric IDs. It is not a ranking.

## D

- **[DAST](/notes/application-security/building-it-secure/02-adversarial-testing/)**:
  Dynamic application security testing, which scans a running application from
  the outside.
- **[Decompression bomb](/notes/application-security/untrusted-input/05-files-and-paths/)**:
  A small archive that expands to gigabytes. Cap the number of entries and
  count the bytes actually written.
- **[Deny by default](/notes/application-security/authorization/04-centralizing-policy/)**:
  If no rule permits a request, it is denied. The same idea applies to routes
  that must declare their access rule.
- **[Deny-overrides](/notes/application-security/authorization/04-centralizing-policy/)**:
  A combining algorithm in which any matching deny rule wins over any permit.
- **[Dependency confusion](/notes/application-security/building-it-secure/03-dependencies-and-supply-chain/)**:
  Publishing a public package with the same name as an internal one and a
  higher version, so the resolver installs the attacker's package.
- **[DNS rebinding](/notes/application-security/untrusted-input/03-server-side-request-forgery/)**:
  A hostname that resolves to a public address when checked and to an internal
  one when used. It is a check-then-act race.

## E

- **[Egress proxy](/notes/application-security/untrusted-input/03-server-side-request-forgery/)**:
  A proxy in an isolated network segment through which a URL fetcher makes its
  requests, so the network itself refuses internal targets.

## F

- **[Fail closed](/notes/application-security/authorization/03-tenant-isolation/)**:
  When information needed for a decision is missing, such as the tenant,
  refuse the request instead of widening access.
- **[Fuzzing](/notes/application-security/building-it-secure/02-adversarial-testing/)**:
  Searching for failures by running a target on generated input at scale,
  guided by code coverage. It is paired with sanitizers.

## G

- **[Gadget chain](/notes/application-security/untrusted-input/04-parsers-and-deserialization/)**:
  A sequence of ordinary library classes whose deserialization hooks call each
  other until one does something powerful.

## H

- **[HttpOnly](/notes/application-security/authentication/02-sessions-and-cookies/)**:
  A cookie attribute that hides the cookie from JavaScript. It is not an XSS
  defense.

## I

- **[ID token](/notes/application-security/authentication/03-oauth-and-openid-connect/)**:
  The signed OpenID Connect token that tells the client who signed in. Its
  audience is the client, and it is not an API bearer token.
- **[IDOR (insecure direct object reference)](/notes/application-security/authorization/01-broken-object-level-authorization/)**:
  The older name for broken object level authorization.
- **[IMDSv2](/notes/application-security/untrusted-input/03-server-side-request-forgery/)**:
  The session-oriented version of the AWS instance metadata service, which
  first requires a PUT to obtain a token. It is defense in depth against SSRF
  and protects nothing if IMDSv1 stays enabled.
- **[Injection](/notes/application-security/untrusted-input/01-injection-and-parameterization/)**:
  What happens when an application builds a string for an interpreter by
  pasting in user input. The root cause is code and data sharing one channel.

## J

- **[JWT (JSON Web Token)](/notes/application-security/authentication/04-tokens-and-jwt-pitfalls/)**:
  A signed set of claims that a service can verify without calling the issuer.
  It is signed, not encrypted.

## K

- **[k-anonymity range query](/notes/application-security/authentication/01-storing-credentials/)**:
  A breach-list lookup that sends only the first five hex characters of the
  password's SHA-1 hash, so the service never learns the password.
- **[kid](/notes/application-security/authentication/04-tokens-and-jwt-pitfalls/)**:
  The JWT header field naming which key to use. Resolving it into a file path
  or query is an attack; pin each kid to one algorithm and key.

## L

- **[Lockfile](/notes/application-security/building-it-secure/03-dependencies-and-supply-chain/)**:
  A record of the exact artifacts to install, with hash pins, so installs are
  repeatable and anything whose hash differs is refused.

## M

- **[Mass assignment](/notes/application-security/untrusted-input/04-parsers-and-deserialization/)**:
  Binding a parsed body to a model so the caller sets fields it should not
  touch, such as `is_admin`. Copy only an allowlist of fields.
- **[Memory hardness](/notes/application-security/authentication/01-storing-credentials/)**:
  A property of password hashing functions that makes each guess require a lot
  of memory, which limits GPU attacks.

## N

- **[Negative test](/notes/application-security/building-it-secure/02-adversarial-testing/)**:
  A test asserting that a specific bad request is refused, such as Bob reading
  Alice's invoice.
- **[nonce (OpenID Connect)](/notes/application-security/authentication/03-oauth-and-openid-connect/)**:
  A random value the client sends in the authentication request and checks in
  the ID token, binding the token to that request.

## O

- **[OAuth 2.0](/notes/application-security/authentication/03-oauth-and-openid-connect/)**:
  A framework that lets a user grant an application limited access to their
  data at another service without giving it their password.
- **[OpenID Connect](/notes/application-security/authentication/03-oauth-and-openid-connect/)**:
  An identity layer on top of OAuth 2.0 that adds a signed ID token.
- **[OWASP Top 10](/notes/application-security/foundations/03-the-vulnerability-classes-that-matter/)**:
  A ranking of risk categories for web applications. It is an awareness
  document, not a syllabus or a compliance target.
- **[Output encoding](/notes/application-security/untrusted-input/02-xss-and-output-encoding/)**:
  The separate channel for HTML: encode untrusted text for the specific
  context (text, attribute, URL, JavaScript, CSS) where it is placed.

## P

- **[Parameterized query](/notes/application-security/untrusted-input/01-injection-and-parameterization/)**:
  A query that sends the SQL text and the values in different fields of the
  protocol. Parameters protect values, not identifiers or keywords.
- **[Parser differential](/notes/application-security/untrusted-input/04-parsers-and-deserialization/)**:
  Two components parsing the same input differently, as with duplicate JSON
  keys or HTTP message framing.
- **[Passkey](/notes/application-security/authentication/05-mfa-and-passkeys/)**:
  A WebAuthn credential. The browser writes the page's origin into what the
  authenticator signs, so a fake site has nothing to replay.
- **[Path traversal](/notes/application-security/untrusted-input/05-files-and-paths/)**:
  User input choosing a file system path, as with `../` sequences (CWE-22).
  Resolve the final path and check containment instead of filtering `../`.
- **[PDP (policy decision point)](/notes/application-security/authorization/04-centralizing-policy/)**:
  The component that holds the rules and answers an authorization question
  with permit or deny.
- **[PEP (policy enforcement point)](/notes/application-security/authorization/04-centralizing-policy/)**:
  The component where a request is handled that asks the PDP for a decision
  and enforces it.
- **[Pepper](/notes/application-security/authentication/01-storing-credentials/)**:
  A secret key shared by all users and stored outside the database. It is
  defense in depth, not a replacement for a slow hash.
- **[PKCE](/notes/application-security/authentication/03-oauth-and-openid-connect/)**:
  Proof Key for Code Exchange. A per-flow code verifier and challenge make a
  stolen authorization code useless to anyone but the client that started the
  flow.
- **[Property-based testing](/notes/application-security/building-it-secure/02-adversarial-testing/)**:
  Stating a rule that must hold for all inputs and letting a generator search
  for a counterexample. In Python the standard library is Hypothesis.

## R

- **[RBAC (role-based access control)](/notes/application-security/authorization/02-rbac-abac-and-relationships/)**:
  Permissions are granted to roles and roles to users. It is easy to audit and
  blind to individual objects.
- **[ReBAC (relationship-based access control)](/notes/application-security/authorization/02-rbac-abac-and-relationships/)**:
  Permissions derived from a graph of relationships, such as membership in a
  group that can view a folder.
- **[Role explosion](/notes/application-security/authorization/02-rbac-abac-and-relationships/)**:
  A growing number of narrowly scoped roles, a sign that access depends on
  dimensions roles cannot express.
- **[Row-level security](/notes/application-security/authorization/03-tenant-isolation/)**:
  A PostgreSQL feature that attaches a predicate to a table so the database
  adds it to every query. It serves as a second wall for tenant isolation.

## S

- **[Salt](/notes/application-security/authentication/01-storing-credentials/)**:
  A random per-password value stored with the hash, so equal passwords produce
  different records and precomputed tables are useless.
- **[SameSite](/notes/application-security/authentication/02-sessions-and-cookies/)**:
  A cookie attribute that withholds the cookie on some cross-site requests. It
  is site-wide, not origin-wide, and Lax allows top-level GET requests.
- **[SAST](/notes/application-security/building-it-secure/02-adversarial-testing/)**:
  Static application security testing, which scans source code.
- **[SBOM (software bill of materials)](/notes/application-security/building-it-secure/03-dependencies-and-supply-chain/)**:
  An inventory of what you ship, such as in CycloneDX or SPDX format, used to
  answer "are we affected?".
- **[Secure by design](/notes/application-security/building-it-secure/01-secure-defaults/)**:
  CISA's 2023 guidance that vendors take ownership of customer security
  outcomes and ship secure-by-default products.
- **[Secure default](/notes/application-security/building-it-secure/01-secure-defaults/)**:
  A default that gives the safe behavior to a developer who forgets, while
  unsafe behavior requires an explicit, greppable, reviewable request.
- **[Session fixation](/notes/application-security/authentication/02-sessions-and-cookies/)**:
  The attacker plants a session ID that survives authentication. Issue a fresh
  ID whenever privilege changes.
- **[Session identifier](/notes/application-security/authentication/02-sessions-and-cookies/)**:
  The value in a cookie that, after login, acts as the credential. It must be
  unguessable and issued by the server.
- **[SSRF (server-side request forgery)](/notes/application-security/untrusted-input/03-server-side-request-forgery/)**:
  The user influences where a server-side request goes. Decide by IP address,
  after resolution, at connection time, on every hop.
- **[STRIDE](/notes/application-security/foundations/02-threat-modeling-an-api/)**:
  A checklist of six threat types: spoofing, tampering, repudiation,
  information disclosure, denial of service, and elevation of privilege.
- **[Synchronizer token](/notes/application-security/authentication/02-sessions-and-cookies/)**:
  An unpredictable per-session value placed in each form and checked on the
  server as a CSRF defense.

## T

- **[Taint analysis](/notes/application-security/building-it-secure/04-security-code-review/)**:
  Tracing data forward from sources to sinks, with declared sanitizers, to
  report paths a reviewer then confirms or dismisses.
- **[Tenant](/notes/application-security/authorization/03-tenant-isolation/)**:
  A customer organization served from one codebase and usually shared
  infrastructure. The tenant must come from the verified identity, not the
  request.
- **[Threat modeling](/notes/application-security/foundations/02-threat-modeling-an-api/)**:
  Answering four questions: what are we working on, what can go wrong, what
  will we do about it, and did we do a good enough job.
- **[TOTP](/notes/application-security/authentication/05-mfa-and-passkeys/)**:
  Time-based one-time passwords (RFC 6238): HOTP with the time step as the
  counter. A user can still type the code into a phishing page.
- **[Trust boundary](/notes/application-security/foundations/01-the-request-is-a-trust-boundary/)**:
  A line where the level of trust changes. Every field of an HTTP request is
  attacker-controlled and can only make claims.
- **[Trusted Types](/notes/application-security/untrusted-input/02-xss-and-output-encoding/)**:
  A browser feature that refuses plain strings at injection sinks such as
  `innerHTML`, accepting only typed objects from a named policy.
- **[Typosquatting](/notes/application-security/building-it-secure/03-dependencies-and-supply-chain/)**:
  Publishing a package whose name is one keystroke away from a popular one.

## W

- **[WebAuthn](/notes/application-security/authentication/05-mfa-and-passkeys/)**:
  The standard behind passkeys, in which the authenticator scopes keys to the
  relying party ID and the browser enforces it.

## X

- **[XSS (cross-site scripting)](/notes/application-security/untrusted-input/02-xss-and-output-encoding/)**:
  Injection where the interpreter is the victim's browser, so attacker script
  runs with your origin's authority.

## Z

- **[Zanzibar](/notes/application-security/authorization/02-rbac-abac-and-relationships/)**:
  Google's consistent, global authorization system, described in a 2019 paper.
  Its data model is the template for open-source ReBAC systems such as SpiceDB
  and OpenFGA.
- **[Zip slip](/notes/application-security/untrusted-input/05-files-and-paths/)**:
  Path traversal through archive entry names, found in hand-written extraction
  loops across many libraries.
