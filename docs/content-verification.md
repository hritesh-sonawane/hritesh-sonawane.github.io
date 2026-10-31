# Claims and links to verify (four new courses, 2026-10-29)

Agents could not fetch external pages. Each item below was written from memory or kept as a canonical address. Check before publishing.

## appsec/foundations
- OWASP Top 10 2025 status (lesson says 2021 edition, 2025 update in progress as of late 2025)
- CWE Top 25 2024 top five (79, 787, 89, 352, 22) from memory
- CSRF/path traversal under A01:2021; XXE merged into A05:2021
## crypto/foundations
- links unfetched; unlinked citations: Duong/Rizzo Flickr 2009, McLean JWT 2015, fail0verflow 27C3
- 1.b randomness rewritten by a second agent (defensive scope) after safety stop
## crypto/applied-cryptography
- AGENT NOTE: a safety classifier interrupted this agent once; it resumed and finished. Programs: padding-oracle attack vs toy Feistel, op-count timing oracle vs toy MAC compare. Surface to user.
- NIST IR 8547 2030/2035 milestones (cited as initial public draft); FIPS 203/204/205 13 Aug 2024; HQC March 2025; X25519MLKEM768
## crypto/symmetric
- unlinked: Joux 2006 NIST comment, Duong-Rizzo Flickr, Sweet32; NIST CSRC URLs, XChaCha draft unfetched
## sd/worked-designs
- least certain links: Stripe rate-limiter blog, Builders' Library static stability, Orca OSDI URL, arXiv 2401.00588, C2SP tlog-tiles/witness
## infra/isolation
- version-sensitive facts softened (default caps, seccomp profile, PSS)
## appsec/untrusted-input
- safety stop on SSRF lesson; 4.c/4.d/4.e rewritten by three agents with defensive scope
- OWASP cheat sheets, CSP3/Trusted Types drafts, Weichselbaum et al. links unfetched
## infra/foundations
- RCPs launched Nov 2024; permissions-boundary same-account nuance; ATT&CK technique IDs; Capital One DOJ complaint unlinked; Lambert essay GitHub copy, Rhino Security Labs, Codecov notice, IMDSv2 blog links
## sd/reliability
- links: CrowdStrike RCA PDF, Spinnaker canary docs, Tail at Scale DOI, Dapper pub36356, arXiv 1512.04922, NIST SP 800-34
- claims: SRE book "~70% of outages due to changes"; 20% single-incident postmortem rule; Kayenta Mann-Whitney U; Peter Krogh 3-2-1
## crypto/1.b randomness
- Ps and Qs figures (0.50% TLS, 0.03% SSH, 1.03% DSA); 64-bit session secret rule (SP 800-63B Rev 3); RFC 9562 note; Linux 3.17/5.6/vmgenid; SP 800-90C generic link
## appsec/authorization
- links: AWS SaaS tenant isolation whitepaper/SaaS Lens, OPA docs, Cedar docs, Zanzibar USENIX; Cedar paper cited without DOI
- Zanzibar scale figures; Cedar skipping erroring policies
## sd/concurrency
- links: Chubby, ZooKeeper, Zanzibar, Debezium outbox, KIP-98, antirez.com/news/101; PortSwigger research (Kettle 2023) kept as primary research
## appsec/building-it-secure
- CISA SbD URL, NTIA SBOM min elements URL; Kern 2014 CACM unlinked; event-stream/xz details, ECMA-424, ISO/IEC 5962:2021, SSDF PW.7/PW.8
## crypto/key-management
- CA/B Forum SC-081 ballot URL slug (shakiest); Cloud KMS 64 KiB Encrypt limit; AWS KMS 90-2560 day rotation; FIPS 140-2 certs to historical Sept 2026
## sd/thinking-in-invariants
- Bezos 2015 letter date; 2009 LADIS keynote attribution; papers cited without links
## infra/delivery-and-operations
- SP 800-61r3 Apr 2025 + authors; tj-actions CVE-2025-30066 + CISA URL; SolarWinds "fewer than 18,000"; CloudTrail ~5 min; GetSessionToken 36h; GH Security Lab pwn-requests URL; Kyverno field names
## infra/secrets
- GitHub Docs, GitLab secret detection, Canarytokens guide, AWS Secrets Manager rotation URLs
## infra/workload-identity
- SPIRE default SVID TTLs (1h/5m); AWS IID attestor TOFU; Istio/Linkerd 24h cert default; Istio PERMISSIVE default
## sd/failure-modes
- Idempotency-Key draft details (400/422/409); Route 53 4 of 2048 NS; Tail at Scale Bigtable hedging numbers; 2017 S3 summary details; Builders' Library/ACM Queue/AWS whitepaper URLs
## appsec/authentication
- SP 800-63B-4 date ("2025"); WebAuthn L3 maturity; Chrome Lax-by-default 2020; Uber Sept 2022 push fatigue; CISA fact sheet PDFs; Auth0 McLean URL
## appsec/4.c SSRF
- IMDSv2 details (6h TTL, hop limit 2, XFF refused, IPv6 endpoint); Capital One DOJ July 2019 / OCC $80M Aug 2020; Black Hat 2017 unlinked
## appsec/4.d parsers, 4.e files
- Marshalling Pickles 2015 unlinked; PyYAML Loader/FullLoader; BinaryFormatter deprecated; RFC 9112 close-after-both-length-headers
- 2025 tarfile filter bypass fixes (no CVE numbers); openat2 not in stdlib
## fixes by me
- sd 3.c: prose said SI allows read skew; corrected to match table (SI prevents read skew, allows write skew)
## crypto/public-key
- LE ending OCSP 2025 + URL; CA/B BR URL, SC-063, SC-081 (47 days by 2029); ECH cited as draft

# Wave 1 additions (2026-10-30)

No external page could be fetched. All links are canonical but unverified. Check first:

## inference-engineering
- vLLM "v0.30 line" as of Oct 2026; V1 recompute-only preemption; SHA-256 default prefix hash; priority ordering; `--enable-eplb`, `--all2all-backend`, `cache_salt`; NIXL TP resharding; docs paths (optimization, engine_args, prefix_caching, spec_decode, metrics, sleep_mode, disagg_prefill)
- TGI maintenance mode; TensorRT-LLM PyTorch default workflow (2025); CVE-2025-25183
- DeepSeek-V3 EPLB cadence and deployment units; model config values from memory; arXiv 2409.20002
## ai-system-design
- Provider prices/discounts "as of 2025/Oct 2026" (cache reads 10%, batch 50%/24h, 1,024-token minimum); Anthropic multi-agent figures (4x/15x/90.2%/80%); contextual retrieval figures; Temporal history limits; Stripe 24h key retention; Llama 3 interruption/MFU figures; Faiss nlist rule
## systems-design (scale, data, observability)
- Envoy defaults "as of Oct 2026"; HAProxy hash-balance-factor; PEP 779 status; etcd defaults; K8s 5,000 nodes/150k pods; Kafka 4.0 ZooKeeper removal; OTel 160-bucket default; Alertmanager group_wait; DCGM fields and Xid meanings
## ai-security-engineering/frontier-model-security, infrastructure-security/securing-gpu-clusters
- RAND SL/OC details and 38 vectors; ASL-3 report contents; RSP/FSF reassessment triggers and version dates; Carlini 2024 cost figures; H100 confidential-mode details; MPS fault behavior; NCCL lacks auth/encryption; Lustre nodemaps; DRA stable
## fonts
- Excalifont OFL licence asserted, full OFL text not vendored; compare files with Excalidraw upstream
