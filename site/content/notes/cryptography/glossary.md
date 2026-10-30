+++
title = 'Glossary'
description = 'Short definitions of the terms this course uses, each linked to the lesson that explains it.'
weight = 100
+++

Short definitions of the terms used in this course. Where a lesson explains a
term in depth, the term links to it.

## 0-9

- **[0-RTT](/notes/cryptography/public-key-cryptography/04-the-tls-handshake/)**:
  TLS early data sent in the client's first flight. It is replayable, so allow
  idempotent requests only.

## A

- **[AEAD](/notes/cryptography/symmetric-cryptography/02-authenticated-encryption/)**:
  Authenticated encryption with associated data. It takes a key, a nonce, a
  plaintext, and associated data, and returns a ciphertext with a tag. Decryption
  returns the exact plaintext or an error and nothing else.
- **[AES-GCM](/notes/cryptography/symmetric-cryptography/02-authenticated-encryption/)**:
  An AEAD defined in NIST SP 800-38D and used in TLS 1.3. Reusing a nonce under
  the same key loses confidentiality and usually allows forgery.
- **[AES-GCM-SIV](/notes/cryptography/symmetric-cryptography/02-authenticated-encryption/)**:
  A misuse-resistant AEAD. If a nonce repeats, it leaks only whether two
  identical messages were encrypted, not their contents.
- **[Associated data](/notes/cryptography/symmetric-cryptography/02-authenticated-encryption/)**:
  Context that an AEAD authenticates but leaves in the clear, such as
  identifiers that give a ciphertext its meaning. It stops a valid ciphertext
  from being swapped into another context.
- **[Authenticity](/notes/cryptography/foundations/01-start-from-the-property/)**:
  The security property that a message came from the party who claims to have
  sent it. A MAC provides it between key holders.

## B

- **[Birthday bound](/notes/cryptography/foundations/03-hash-functions/)**:
  Finding a collision in an n-bit hash takes about 2^(n/2) work, not 2^n. This is
  why SHA-256 is rated at 128-bit collision security.
- **[Block cipher](/notes/cryptography/symmetric-cryptography/01-block-ciphers-and-modes/)**:
  A keyed permutation on one fixed-size block (128 bits for AES). It needs a mode
  of operation to encrypt anything longer than one block.

## C

- **[CBC](/notes/cryptography/symmetric-cryptography/01-block-ciphers-and-modes/)**:
  A mode that chains blocks and starts from an unpredictable IV. It needs
  padding and becomes a decryption oracle when padding errors are visible.
- **[CBOM](/notes/cryptography/applied-cryptography/04-crypto-agility-and-inventory/)**:
  Cryptography Bill of Materials. CycloneDX defines it as a standard,
  machine-readable format for a cryptographic inventory.
- **[Certificate](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  A small signed document that binds a public key to names, issued by a
  certificate authority and valid until a stated date.
- **[Certificate authority (CA)](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  The party that signs certificates. Its own key is vouched for by another
  certificate, up to a trust anchor.
- **[Certificate Transparency](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  Public append-only logs of issued certificates, built as Merkle trees. Logs
  return signed certificate timestamps (SCTs), and misissuance becomes visible
  only to those who monitor.
- **[ChaCha20-Poly1305](/notes/cryptography/symmetric-cryptography/02-authenticated-encryption/)**:
  An AEAD defined in RFC 8439 and used in TLS 1.3. Like AES-GCM, a repeated nonce
  loses confidentiality and enables forgery.
- **[Chain of trust](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  The sequence of certificates from a leaf through issuing CAs to a trust anchor.
  Following and checking it is path validation.
- **[Collision resistance](/notes/cryptography/foundations/03-hash-functions/)**:
  The hash property that no one can find any two inputs with the same digest.
  It is the weakest of the three hash properties and the first to fall, as it did
  for MD5 and SHA-1.
- **[Confidentiality](/notes/cryptography/foundations/01-start-from-the-property/)**:
  The property that only the intended parties can read the data. "Encrypted" is
  a statement about confidentiality only.
- **[Constant time](/notes/cryptography/applied-cryptography/02-side-channels-and-constant-time/)**:
  Code whose running time and memory access pattern are the same for every
  secret value: no secret-dependent branch, no secret array index, no early exit.
- **[Crypto-agility](/notes/cryptography/applied-cryptography/04-crypto-agility-and-inventory/)**:
  The ability to change an algorithm without re-architecting the system. It
  rests on a cryptographic inventory and on treating the algorithm as a
  parameter rather than a hardcoded assumption.
- **[Crypto-shredding](/notes/cryptography/key-management/02-envelope-encryption-and-kms/)**:
  Destroying a KEK so that everything under it becomes unreadable at once,
  including backups. It works only if no plaintext, cached DEK, or exported KEK
  survives.
- **[Cryptoperiod](/notes/cryptography/key-management/01-the-key-lifecycle/)**:
  The bounded time a key may be used for protecting operations. It includes
  usage limits, not just calendar dates.
- **[CSPRNG](/notes/cryptography/foundations/02-randomness-and-entropy/)**:
  A cryptographically secure pseudorandom generator, built so that past outputs
  reveal nothing useful about future ones. It stretches entropy but never creates
  it.
- **[CTR](/notes/cryptography/symmetric-cryptography/01-block-ciphers-and-modes/)**:
  A mode that turns a block cipher into a stream cipher with no padding. One
  repeated nonce under a key leaks the XOR of two plaintexts.

## D

- **[DEK (data encryption key)](/notes/cryptography/key-management/02-envelope-encryption-and-kms/)**:
  A fresh key that encrypts data locally with an AEAD. Its wrapped form is stored
  next to the ciphertext.
- **[Diffie-Hellman](/notes/cryptography/public-key-cryptography/01-key-exchange/)**:
  A key exchange in which each side combines its private number with the other's
  public value to reach the same secret. It defeats listeners but not an attacker
  who intercepts and replaces.
- **[Domain separation](/notes/cryptography/symmetric-cryptography/04-key-derivation/)**:
  Using distinct, unambiguous `info` values in HKDF so that different purposes
  get unrelated keys.
- **[Downgrade attack](/notes/cryptography/applied-cryptography/04-crypto-agility-and-inventory/)**:
  An attack that exploits algorithm negotiation to force a weaker option. The
  defense is to refuse weak options outright rather than rank them.

## E

- **[ECB](/notes/cryptography/symmetric-cryptography/01-block-ciphers-and-modes/)**:
  The "mode that is not a mode": it encrypts each block independently, so equal
  plaintext blocks give equal ciphertext blocks. Do not use it for data.
- **[ECDSA](/notes/cryptography/public-key-cryptography/02-digital-signatures/)**:
  An elliptic-curve signature scheme that needs a fresh secret nonce per
  signature. A repeated nonce lets anyone with two signatures compute the
  private key.
- **[Ed25519](/notes/cryptography/public-key-cryptography/02-digital-signatures/)**:
  A signature scheme defined in RFC 8032 that the course prefers. It avoids the
  ECDSA nonce hazard.
- **[Encrypted Client Hello (ECH)](/notes/cryptography/public-key-cryptography/04-the-tls-handshake/)**:
  A TLS extension that hides the server name, which TLS otherwise does not
  protect.
- **[Encryption context](/notes/cryptography/key-management/02-envelope-encryption-and-kms/)**:
  Values such as tenant and record that are bound as AAD on both the DEK and the
  data, so ciphertexts cannot be moved between contexts.
- **[Entropy](/notes/cryptography/foundations/02-randomness-and-entropy/)**:
  The unpredictability the operating system collects to seed its generator. Count
  only the random bits: six digits are 20 bits, a UUIDv4 is 122.
- **[Envelope encryption](/notes/cryptography/key-management/02-envelope-encryption-and-kms/)**:
  Encrypting data with a DEK and wrapping the DEK with a KEK held in a KMS. The
  KMS sees 32 bytes per object, and rotating the KEK means rewrapping small DEKs.
- **[Ephemeral key](/notes/cryptography/public-key-cryptography/01-key-exchange/)**:
  A key generated for one exchange and deleted after use. It is what gives
  forward secrecy.

## F

- **[FIPS 140-3](/notes/cryptography/key-management/03-hsms-and-key-ceremonies/)**:
  The standard whose levels grade an HSM. Level 2 adds tamper evidence, level 3
  adds tamper response and identity authentication, and level 4 adds
  environmental protection and multi-factor.
- **[FIPS 203, 204, and 205](/notes/cryptography/applied-cryptography/03-post-quantum-migration/)**:
  The post-quantum standards for ML-KEM, ML-DSA, and SLH-DSA, published 13 August
  2024.
- **[Forward secrecy](/notes/cryptography/foundations/01-start-from-the-property/)**:
  The property that today's traffic stays private even if a server is seized
  later. Ephemeral key exchange provides it; static key transport does not.

## H

- **[Harvest now, decrypt later](/notes/cryptography/applied-cryptography/03-post-quantum-migration/)**:
  Recording encrypted traffic today to decrypt it once a quantum computer
  exists. Anything that must stay secret for years is already exposed.
- **[Hash function](/notes/cryptography/foundations/03-hash-functions/)**:
  A public, deterministic, keyless function that maps input of any length to a
  fixed-size digest. It has no integrity value against someone who can replace
  the hash too.
- **[HKDF](/notes/cryptography/symmetric-cryptography/04-key-derivation/)**:
  The KDF of RFC 5869 for secrets that already have high entropy. It extracts a
  uniform pseudorandom key, then expands it bound to an `info` string. Never feed
  it a password.
- **[HMAC](/notes/cryptography/symmetric-cryptography/03-macs-and-hmac/)**:
  The MAC of RFC 2104 that wraps a hash twice with derived keys. It removes the
  length-extension attack on `hash(key || message)`.
- **[HSM](/notes/cryptography/key-management/03-hsms-and-key-ceremonies/)**:
  A hardware security module. It generates keys inside a tamper-resistant
  boundary and marks them non-exportable, which turns theft into misuse that you
  must still detect.
- **[Hybrid key exchange](/notes/cryptography/applied-cryptography/03-post-quantum-migration/)**:
  Combining a classical and a post-quantum exchange, such as `X25519MLKEM768` in
  TLS, so security holds if either algorithm does.

## I

- **[Integrity](/notes/cryptography/foundations/01-start-from-the-property/)**:
  The property that data was not changed in transit or storage. Encryption alone
  is malleable and does not provide it.
- **[IV](/notes/cryptography/symmetric-cryptography/01-block-ciphers-and-modes/)**:
  The initial value for a mode such as CBC. It must be fresh and unpredictable
  for each message.

## K

- **[KEK (key encryption key)](/notes/cryptography/key-management/02-envelope-encryption-and-kms/)**:
  A key held by a KMS that wraps DEKs. It never leaves the KMS, and every unwrap
  is an authorized, logged call.
- **[Kerckhoffs's principle](/notes/cryptography/foundations/04-why-not-to-roll-your-own/)**:
  A system must stay secure when everything about it except the key is known to
  the enemy.
- **[Key ceremony](/notes/cryptography/key-management/03-hsms-and-key-ceremonies/)**:
  A scripted, witnessed, recorded procedure whose product is a key and evidence
  that the key was handled as claimed.
- **[Key ID](/notes/cryptography/key-management/04-rotation-and-revocation/)**:
  The authenticated identifier carried by every ciphertext and signature that
  names the key version that made it.
- **[Key lifecycle](/notes/cryptography/key-management/01-the-key-lifecycle/)**:
  The states a key moves through, from generation to destruction, as named in
  NIST SP 800-57 Part 1. Protecting operations are allowed only while a key is
  active; decrypting and verifying may continue after retirement.
- **[KMS](/notes/cryptography/key-management/02-envelope-encryption-and-kms/)**:
  A key management service, backed by HSMs, that holds KEKs. Whoever may call
  `Decrypt` may read the data.

## L

- **[Length extension](/notes/cryptography/foundations/03-hash-functions/)**:
  An attack on SHA-256 and SHA-512 that lets someone holding `H(secret || msg)`
  compute a valid hash for the message with data appended, without the secret.
  It is why that construction is not a MAC.

## M

- **[MAC](/notes/cryptography/symmetric-cryptography/03-macs-and-hmac/)**:
  A message authentication code: a short tag from a secret key and a message. It
  gives integrity and authenticity between key holders, not secrecy and not
  non-repudiation.
- **[Misuse-resistant API](/notes/cryptography/foundations/04-why-not-to-roll-your-own/)**:
  A high-level library interface that does not ask you for a mode, padding, or
  IV. If an API asks for those, you are in the hazmat layer.
- **[ML-DSA](/notes/cryptography/applied-cryptography/03-post-quantum-migration/)**:
  The post-quantum signature standard FIPS 204.
- **[ML-KEM](/notes/cryptography/applied-cryptography/03-post-quantum-migration/)**:
  The post-quantum key encapsulation standard FIPS 203.
- **[Mosca's inequality](/notes/cryptography/applied-cryptography/03-post-quantum-migration/)**:
  If data must stay secret for `x` years, migration takes `y` years, and a quantum
  computer is `z` years away, you are already late whenever `x + y > z`. It
  prioritizes migration worst-first.
- **[Mutual TLS (mTLS)](/notes/cryptography/public-key-cryptography/04-the-tls-handshake/)**:
  TLS in which the client also presents a certificate. It authenticates clients,
  but authorization is still your job.

## N

- **[Name constraints](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  A certificate extension limiting which names a CA may vouch for. Private
  issuing CAs should carry them so a compromise can vouch for as little as
  possible.
- **[Nonce](/notes/cryptography/symmetric-cryptography/02-authenticated-encryption/)**:
  A value that must be unique per key for an AEAD or CTR. Reuse is a correctness
  failure, not a tuning issue.
- **[Nonce reuse (signatures)](/notes/cryptography/public-key-cryptography/02-digital-signatures/)**:
  Using the same nonce for two ECDSA or DSA signatures, which lets anyone holding
  both compute the private key. Slightly biased nonces leak it across many
  signatures.
- **[Non-repudiation](/notes/cryptography/foundations/01-start-from-the-property/)**:
  The property that a signer cannot later deny signing. A MAC cannot provide it;
  only a signature can.

## O

- **[OCSP](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  A protocol (RFC 6960) in which the client asks the CA about one certificate. It
  leaks browsing to the CA, and clients usually soft-fail if the responder is
  unreachable.

## P

- **[Padding oracle](/notes/cryptography/applied-cryptography/01-how-cryptography-fails-in-practice/)**:
  A system that reveals whether decryption produced valid padding, turning CBC
  into a decryption oracle that recovers a message one byte at a time.
- **[Path validation](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  Checking a certificate chain: signature linkage, trust anchor, validity dates,
  CA flag, name constraints, revocation, and then the hostname.
- **[PBKDF2](/notes/cryptography/symmetric-cryptography/04-key-derivation/)**:
  A password-based KDF (RFC 8018) that iterates HMAC many times. It is slow by
  design but not memory hard.

## Q

- **[Quorum](/notes/cryptography/key-management/03-hsms-and-key-ceremonies/)**:
  A rule that M of N people must each present something before an HSM will act. It
  splits authority, while Shamir splits the secret.

## R

- **[Revocation](/notes/cryptography/key-management/04-rotation-and-revocation/)**:
  Withdrawing trust in a signing key, needed because its signatures live on in
  other systems. Prefer short lifetimes over trusting revocation checks.
- **[Rotation](/notes/cryptography/key-management/04-rotation-and-revocation/)**:
  Introducing a new key version for new work and eventually retiring the old one.
  It helps only if old versions eventually stop working.

## S

- **[Scrypt](/notes/cryptography/symmetric-cryptography/04-key-derivation/)**:
  A memory-hard password-based KDF (RFC 7914) that fills a large buffer so each
  guess costs real memory.
- **[Shamir secret sharing](/notes/cryptography/key-management/03-hsms-and-key-ceremonies/)**:
  Splitting a secret into shares so that fewer than `k` reveal nothing. The shares
  have no integrity, so verify the rebuilt secret.
- **[Side channel](/notes/cryptography/applied-cryptography/02-side-channels-and-constant-time/)**:
  A leak of a secret through time, cache state, or power rather than through the
  output.
- **[Signature](/notes/cryptography/public-key-cryptography/02-digital-signatures/)**:
  A value only the private-key holder can produce and anyone with the public key
  can check. It proves "this key signed these bytes", not who holds the key, when,
  or why.
- **[Subject alternative name (SAN)](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  The certificate field (`subjectAltName`) that lists the DNS names, IP addresses,
  URIs, or emails the key is valid for.

## T

- **[Timing attack](/notes/cryptography/applied-cryptography/02-side-channels-and-constant-time/)**:
  A side-channel attack on a comparison that stops at the first mismatch. Each
  matching byte takes measurably longer, turning an n-byte secret into about
  `256 * n` guesses.
- **[TLS 1.3](/notes/cryptography/public-key-cryptography/04-the-tls-handshake/)**:
  The protocol of RFC 8446: ephemeral key exchange, a certificate chain, a
  signature over the transcript, and a Finished MAC, all keyed by an HKDF
  schedule.
- **[Transcript hash](/notes/cryptography/public-key-cryptography/04-the-tls-handshake/)**:
  A hash of every handshake byte both sides sent and received. Because the
  signature, MACs, and keys depend on it, any change to the handshake fails.
- **[Trust anchor](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  A root key that a system already trusts because it was installed in advance. It
  is a key, not a name, and can vouch for every name unless constrained.

## X

- **[X.509](/notes/cryptography/public-key-cryptography/03-certificates-and-pki/)**:
  The certificate format whose fields include the subject alternative name, CA
  flag, name constraints, revocation pointers, and embedded SCTs.
- **[X25519](/notes/cryptography/public-key-cryptography/01-key-exchange/)**:
  The modern form of Diffie-Hellman (RFC 7748) used at the start of nearly every
  TLS, SSH, Signal, and WireGuard session. Check for an all-zero result.
