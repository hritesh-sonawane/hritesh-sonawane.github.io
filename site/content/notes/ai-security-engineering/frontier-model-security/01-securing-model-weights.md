+++
title = 'Securing model weights'
description = 'Model weights are a file of hundreds of gigabytes that carries the full capability without any of the safeguards. Count the copies, narrow the paths, slow the egress, and watch the volume.'
question = "What does it take to keep a frontier model's weights from being stolen?"
weight = 1
difficulty = 3
prerequisites = ['/notes/ai-security-engineering/securing-each-stage/05-deployment-and-infrastructure', '/notes/ai-security-engineering/threat-landscape/02-threat-modeling-ai-systems']
date = 2026-10-30T06:05:00Z
lastmod = 2026-10-30T06:05:00Z
verified = 2026-10-30
+++

## The idea in one minute

Training a frontier model costs months of compute. Copying it costs one file
transfer. Whoever holds the weights holds the capability, and none of the
controls around the official deployment come with the copy: no usage policy, no
classifiers, no rate limits, no monitoring. A thief can also fine-tune away the
safety training. A theft cannot be undone.

RAND's 2024 study *Securing AI Model Weights* gives the field a shared scale:
five **security levels** (SL1 to SL5), each defined by the class of attacker it
can likely stop, from amateurs up to the most capable state operations. Most of
the 38 attack vectors it lists are ordinary security failures: stolen
credentials, unpatched software, insiders, supply chain, physical access.

The engineering work comes down to four levers: **fewer copies, fewer paths,
fewer people, and egress that is slow and visible.** No single control holds.
You are buying time and the chance to notice.

## A picture

```mermaid {title="Every path to the weights, and the lever that narrows it"}
flowchart LR
  subgraph ATT["Ways in"]
    direction TB
    CRED["<b>Stolen credentials</b>"]
    CODE["<b>Unauthorized code</b><br/><small>exploit, supply chain</small>"]
    INS["<b>Insider</b><br/><small>malicious or coerced</small>"]
    API["<b>Model API</b><br/><small>extraction</small>"]
  end
  subgraph ENC["Weight enclave"]
    direction TB
    W[("<b>Weights</b><br/><small>encrypted at rest,<br/>few copies</small>")]
    SRV["<b>Approved workloads</b><br/><small>attested identity</small>"]
  end
  CRED --> SRV
  CODE --> SRV
  INS --> SRV
  API --> SRV
  SRV --> W
  W --> EG{"<b>Egress</b><br/><small>rate cap, volume<br/>budget, allowlist</small>"}
  EG -->|"over budget"| AL["<b>Alert and cut</b>"]
  EG -->|"allowlisted, small"| OUT(["Outside"])
  class CRED,CODE,INS,API warn
  class W memory
  class SRV compute
  class EG,AL good
  class OUT neutral
```

## How it really works

### What makes weights different

Weights are large, but not large enough to be hard to move. At two bytes per
parameter in bf16:

| Model | bf16 size | 4-bit quantized |
| --- | --- | --- |
| 70B parameters | 140 GB | about 35 GB |
| 405B parameters | 810 GB | about 200 GB |
| 1T parameters | 2 TB | about 500 GB |

A 100 Gb/s network interface moves the 70B file in about 11 seconds. A thief
also does not need the training format: a [quantized](/notes/inference-engineering/making-it-cheaper/01-quantization/) copy runs on far less
hardware and is a quarter of the size. The defender's question is not "can it
be copied?" but "how long does a copy take on each path, and would anyone see
it?"

Three properties set weights apart from other sensitive data:

- **Value is concentrated.** One file carries the result of the whole training
  budget. Customer data is valuable in aggregate; weights are valuable as a
  unit, and so is one tensor-parallel shard of them.
- **Safeguards stay behind.** At the API, the model sits behind filters,
  account checks, and monitoring. A stolen copy has none of them, and safety
  training can be weakened by fine-tuning.
- **Theft is permanent.** A leaked password can be rotated. A leaked model
  cannot be recalled.

### RAND's security levels

The RAND report (Nevo et al., 2024) defines five **operational capacity**
categories of attacker and a matching security level for each. A system at
SL*n* can likely thwart attackers up to OC*n*.

| Level | Attacker it should stop (operational capacity) |
| --- | --- |
| SL1 | OC1: amateur attempts |
| SL2 | OC2: professional opportunistic efforts |
| SL3 | OC3: cybercrime syndicates and insider threats |
| SL4 | OC4: standard operations by leading cyber-capable institutions |
| SL5 | OC5: top-priority operations by the most capable institutions |

The report attaches rough budgets and timelines that grow by orders of magnitude
per category. It treats the lower levels as reachable with known, if
demanding, practice, and the upper levels as requiring measures that commercial
organizations rarely have, such as isolated networks, hardware-level
protection, and serious physical security. It judges SL5 unlikely to be
reachable in the near term without help from the national security community.

Insiders appear at OC3. That placement matters: it says that a system unable to
withstand one malicious employee is below SL3, however good its perimeter.

Among the report's recommendations for reaching SL3 are: centralize weights on
a limited number of access-controlled, monitored systems; reduce the number of
people authorized to access them; harden the interfaces that give model access
against weight exfiltration; run an insider threat program; invest in defense in
depth; commission advanced third-party red-teaming; and use confidential
computing to protect weights in use.

> [!IMPORTANT]
> Security levels describe the attacker you can stop, not a checklist you have
> completed. Claiming SL3 means you expect a well-funded criminal group or a
> malicious insider to fail. Test that claim with a red team, not an audit.

### Lever 1: fewer copies

Every copy is the asset. A single training run leaves weights in checkpoint
storage, evaluation snapshots, serving caches on every inference node, backups,
and whatever a researcher copied for debugging. The first control is an
**inventory**: every location that holds weights, its encryption key, its
readers, and its network reachability. The next lesson builds one.

Encrypt every copy at rest with a key held in a KMS, one key per model or per
run, so that reading a copy requires a logged decrypt call by an authorized
principal. [KMS and key hierarchies](/notes/infrastructure-security/secrets/03-kms-and-key-hierarchies/)
covers the mechanics. Be precise about what this buys: the serving host must
decrypt the weights into memory to run them, so encryption at rest protects
storage media, backups, and misconfigured buckets. It does not protect a
running host. Protecting weights in use is the subject of
[confidential inference](/notes/ai-security-engineering/frontier-model-security/06-confidential-inference/).

### Lever 2: fewer paths

A path is any way a principal can cause weight bytes to be read. Narrow them in
three ways:

- **Only workloads read weights.** Serving and training workloads get read
  access through an attested workload identity
  ([attestation and SPIFFE](/notes/infrastructure-security/workload-identity/02-attestation-and-spiffe/)).
  No human principal has standing read access to weight storage.
- **People use interfaces, not files.** Evaluation, sampling, fine-tuning, and
  most debugging can be done through an API that runs inside the enclave and
  returns results. RAND calls these weight-access interfaces and recommends
  hardening them, because an interface that returns too much (full logits, raw
  activations, or a "download checkpoint" button) is itself a path. See
  [extraction and distillation](/notes/ai-security-engineering/frontier-model-security/04-extraction-and-distillation/).
- **Control-plane paths count.** Sharing a disk snapshot with another cloud
  account, adding a cross-account replication rule, or changing a bucket policy
  moves terabytes without a single byte crossing your network egress monitor.
  These actions need the same approval and alerting as a data transfer.
  [Audit logs and detection](/notes/infrastructure-security/delivery-and-operations/03-audit-logs-and-detection/)
  lists the control-plane events to watch.

### Lever 3: fewer people

Count the humans who could cause a weight copy to leave today: storage admins,
cloud IAM admins, platform engineers with root on serving hosts, researchers
with checkpoint access. RAND recommends reducing that number, and the published
frontier safety frameworks put this into practice with access controls
such as two-party authorization. [Insider risk and model access](/notes/ai-security-engineering/frontier-model-security/03-insider-risk-and-model-access/)
designs the broker.

### Lever 4: slow and visible egress

If a path exists, make it slow and make it loud. Rate limiting is a time
buffer, and detection must fire inside that buffer.

| Egress rate | 70B bf16 (140 GB) | 405B bf16 (810 GB) |
| --- | --- | --- |
| 100 Gb/s | 11 s | 1 min |
| 1 Gb/s | 19 min | 1.8 h |
| 100 Mb/s | 3.1 h | 18 h |
| 10 Mb/s | 31 h | 180 h |

A weight-serving enclave's legitimate outbound traffic is small: metrics,
logs, model responses (which are text). Capping the enclave's outbound
bandwidth well below what a bulk copy needs turns a seconds-long theft into a
days-long one. At least one published framework implements this: Anthropic's
May 2025 report on activating its ASL-3 protections lists egress bandwidth
controls on secure environments holding model weights, alongside two-party
authorization for weight access and endpoint software allowlisting.

A cap is not enough on its own. A patient attacker stays under it. What catches
a slow copy is a **volume budget over a long window**: bytes per destination per
day, compared with what that destination normally receives. The program below
shows the difference.

### Where the published frameworks put this

The frontier safety frameworks published by model developers tie weight
security to capability: as a model crosses defined capability thresholds, the
required security standard rises. Anthropic's Responsible Scaling Policy
defines AI Safety Level security standards; Google DeepMind's Frontier Safety
Framework recommends security levels for each critical capability level and
refers to the RAND levels in doing so; OpenAI's Preparedness Framework requires
security safeguards for models that reach its High capability threshold.
[Capability evaluations and release gates](/notes/ai-security-engineering/frontier-model-security/05-capability-evaluations-and-release-gates/)
covers how that trigger works.

## Code

The program has two parts. The first computes the transfer table above. The
second simulates 48 hours of outbound flow records from a four-host enclave:
telemetry, one large nightly backup to an allowlisted destination, and an
insider copying a 17.5 GB tensor-parallel shard to an outside address at about
1 Mb/s. Two detectors run over it.

```python {title="egress_watch.py"}
"""egress_watch.py: how long weight exfiltration takes, and which egress detector sees it.

Part 1 is arithmetic: transfer time for model weights at different egress rates.
Part 2 simulates 48 hours of outbound traffic from a weight-serving enclave in
5-minute buckets and runs two detectors over it: a per-bucket spike threshold
and a rolling 24-hour byte budget per destination. Traffic is synthetic.
"""
from __future__ import annotations

import random
from collections import defaultdict, deque
from dataclasses import dataclass

GB = 10**9
MB = 10**6
BUCKET_S = 300                      # 5-minute buckets
BUCKETS_PER_DAY = 86_400 // BUCKET_S


def transfer_hours(size_bytes: float, bits_per_s: float) -> float:
    return size_bytes * 8 / bits_per_s / 3600


def human(hours: float) -> str:
    if hours < 1 / 60:
        return f"{hours * 3600:.0f} s"
    if hours < 1:
        return f"{hours * 60:.0f} min"
    return f"{hours:.1f} h"


def part1() -> None:
    models = {"70B bf16": 70e9 * 2, "405B bf16": 405e9 * 2, "1T bf16": 1e12 * 2}
    rates = {"100 Gb/s NIC": 100e9, "1 Gb/s": 1e9, "100 Mb/s": 100e6, "10 Mb/s cap": 10e6}
    print("time to move the weights at a sustained egress rate")
    print(f"{'model':<11}{'size':>9}" + "".join(f"{r:>15}" for r in rates))
    for name, size in models.items():
        cells = "".join(f"{human(transfer_hours(size, bps)):>15}" for bps in rates.values())
        print(f"{name:<11}{size / GB:>7.0f}GB{cells}")


@dataclass
class Flow:
    bucket: int
    host: str
    dest: str
    nbytes: int


def synthetic_traffic(seed: int = 7) -> list[Flow]:
    rng = random.Random(seed)
    flows: list[Flow] = []
    hosts = [f"srv-{i}" for i in range(4)]
    for b in range(2 * BUCKETS_PER_DAY):
        for h in hosts:
            # telemetry and metrics: a few MB per bucket per host
            flows.append(Flow(b, h, "metrics.internal", int(rng.uniform(2, 6) * MB)))
        # one sanctioned nightly backup: big, to an allowlisted destination
        if b % BUCKETS_PER_DAY == 24:
            flows.append(Flow(b, "srv-0", "backup.vault", 140 * GB))
    # insider copies one 17.5 GB tensor-parallel shard, slowly, starting hour 6
    shard, per_bucket, start = int(17.5 * GB), 40 * MB, 72
    sent, b = 0, start
    while sent < shard:
        chunk = min(per_bucket, shard - sent)
        flows.append(Flow(b, "srv-2", "203.0.113.50", chunk))
        sent += chunk
        b += 1
    return flows


def spike_detector(flows: list[Flow], limit: int) -> list[tuple[int, str, str]]:
    per = defaultdict(int)
    for f in flows:
        per[(f.bucket, f.host, f.dest)] += f.nbytes
    return [k for k, v in sorted(per.items()) if v > limit]


def budget_detector(flows: list[Flow], allow: set[str], budget: int) -> dict[str, tuple[int, int]]:
    """Rolling 24 h bytes per (host, dest) for non-allowlisted destinations."""
    windows: dict[tuple[str, str], deque] = defaultdict(deque)
    totals: dict[tuple[str, str], int] = defaultdict(int)
    first_alert: dict[str, tuple[int, int]] = {}
    for f in sorted(flows, key=lambda f: f.bucket):
        if f.dest in allow:
            continue
        key = (f.host, f.dest)
        w = windows[key]
        w.append((f.bucket, f.nbytes))
        totals[key] += f.nbytes
        while w and w[0][0] <= f.bucket - BUCKETS_PER_DAY:
            totals[key] -= w.popleft()[1]
        label = f"{f.host} -> {f.dest}"
        if totals[key] > budget and label not in first_alert:
            first_alert[label] = (f.bucket, totals[key])
    return first_alert


def part2() -> None:
    flows = synthetic_traffic()
    exfil = [f for f in flows if f.dest == "203.0.113.50"]
    print(f"\nsimulated 48 h: {len(flows)} flow records, exfil runs buckets "
          f"{exfil[0].bucket}-{exfil[-1].bucket} ({sum(f.nbytes for f in exfil) / GB:.1f} GB at "
          f"{40 * MB * 8 / BUCKET_S / 1e6:.2f} Mb/s)")

    spikes = spike_detector(flows, limit=100 * MB)
    print(f"spike detector (>100 MB per bucket): {len(spikes)} alerts")
    for b, h, d in spikes:
        print(f"  bucket {b:>3} {h} -> {d}")

    allow = {"metrics.internal", "backup.vault"}
    alerts = budget_detector(flows, allow, budget=2 * GB)
    print("24 h budget detector (>2 GB to any non-allowlisted destination):")
    for label, (b, total) in alerts.items():
        lag_min = (b - exfil[0].bucket + 1) * BUCKET_S / 60
        print(f"  {label}: alert at bucket {b}, {total / GB:.2f} GB in window, "
              f"{lag_min:.0f} min after start, {total / (17.5 * GB):.0%} of shard out")


if __name__ == "__main__":
    part1()
    part2()
```

Run it with `python3 egress_watch.py`:

```text
time to move the weights at a sustained egress rate
model           size   100 Gb/s NIC         1 Gb/s       100 Mb/s    10 Mb/s cap
70B bf16       140GB           11 s         19 min          3.1 h         31.1 h
405B bf16      810GB          1 min          1.8 h         18.0 h        180.0 h
1T bf16       2000GB          3 min          4.4 h         44.4 h        444.4 h

simulated 48 h: 2744 flow records, exfil runs buckets 72-509 (17.5 GB at 1.07 Mb/s)
spike detector (>100 MB per bucket): 2 alerts
  bucket  24 srv-0 -> backup.vault
  bucket 312 srv-0 -> backup.vault
24 h budget detector (>2 GB to any non-allowlisted destination):
  srv-2 -> 203.0.113.50: alert at bucket 122, 2.04 GB in window, 255 min after start, 12% of shard out
```

The spike detector does the wrong thing twice: it fires on the sanctioned
backup and never sees the theft, because 40 MB per five minutes looks like
telemetry. The 24-hour budget ignores the allowlisted backup and flags the
outside destination about four hours in, with 12% of the shard gone. The cap
and the budget work as a pair: at a 10 Mb/s cap the shard needs almost four
hours to leave while a 2 GB budget fires within half an hour, and without a cap
the shard leaves in seconds, long before any window fills.

## Where it breaks

- **The allowlisted path is the best path.** The backup destination in the
  simulation is exempt from the budget. An insider who can write to the backup
  target, or an attacker who compromises it, uses your own bulk channel. Watch
  allowlisted destinations for volume against their own baselines, and protect
  the destination like the source.
- **Spreading defeats per-destination budgets.** Ten hosts each sending 1 GB a
  day to ten different addresses stay under a 2 GB per-pair budget. Add a budget
  for the enclave as a whole, and alert on any new external destination.
- **Control-plane copies bypass the network.** Snapshot sharing, replication
  rules, and policy changes need their own detections; egress monitoring cannot
  see them.
- **Weights can leave as something else.** A quantized copy is smaller; a
  distilled model needs no weights at all. Neither defeats the budget, but both
  lower what a successful theft requires.
- **Simulation, not traffic.** Real flow logs are noisier, sampled, and late.
  The thresholds here were chosen to make the mechanism visible, not tuned on
  data.
- **SL4 and SL5 are a different game.** Against state operations with zero-day
  exploits, supply chain access, and recruited insiders, these controls are
  necessary and far from sufficient. RAND is explicit that the top levels need
  measures most organizations do not have.

## Remember this

- Whoever holds the weights holds the capability, without the safeguards.
- RAND SL1 to SL5 are defined by the attacker stopped; insiders sit at SL3.
- Four levers: fewer copies, fewer paths, fewer people, slow and visible egress.
- Encryption at rest forces theft through a logged key use; it does not
  protect a running host.
- A rate cap buys time; a long-window volume budget uses it.
- Control-plane actions can copy terabytes with no network egress.

## Try it

1. Run `egress_watch.py`. Change the insider's rate to 10 MB per bucket. When
   does the budget detector fire, and how much of the shard has left?
2. Add an enclave-wide budget (all hosts, all non-allowlisted destinations) and
   split the exfiltration across four hosts and four addresses. Which detector
   catches it now?
3. List every location where a copy of one model you run exists today. For
   each, write who can read it and whether it can reach the internet.
4. Find the control-plane actions in your cloud that can copy storage to
   another account. Is each one alerting?

## Check yourself

1. Why do RAND's security levels place insider threats at OC3 rather than
   treating them separately?

   {{< details summary="Show answer" >}}
   Because the levels are defined by capability, and one malicious or coerced
   insider with legitimate access is roughly as capable as an organized
   criminal group working from outside. Placing insiders at OC3 means a system
   that cannot withstand one bad insider cannot claim SL3, regardless of its
   perimeter.
   {{< /details >}}

2. Encryption at rest is on for every weight copy. What attacks does it still
   leave open?

   {{< details summary="Show answer" >}}
   Anything that reads the weights through an authorized workload: a
   compromised serving host has the plaintext in memory, a stolen workload
   identity can call decrypt, and an insider who controls the workload can copy
   what it loaded. Encryption at rest protects media, backups, and storage
   misconfigurations, and makes every read a logged key use. It does not
   protect data in use.
   {{< /details >}}

3. Why does a rate cap on egress need a detector to be useful?

   {{< details summary="Show answer" >}}
   A cap only stretches the time a copy takes. A patient attacker stays under
   it and completes the copy in days instead of seconds. The cap is useful
   because it creates a window in which a detector watching volume over a long
   period can notice and someone can cut the path before the copy completes.
   {{< /details >}}

4. Give two ways to move weights out of a cloud environment that network
   egress monitoring will never see.

   {{< details summary="Show answer" >}}
   Sharing a disk snapshot or machine image with another account, and adding a
   cross-account replication rule or a permissive bucket policy so another
   account reads the objects directly. Both are control-plane actions; the
   bytes move inside the provider. Alert on them in the audit log.
   {{< /details >}}

## Sources

- Nevo, Lahav, Karpur, Bar-On, Bradley, and Alstott, [Securing AI Model Weights: Preventing Theft and Misuse of Frontier Models](https://www.rand.org/pubs/research_reports/RRA2849-1.html), RAND, RR-A2849-1, 2024.
- Anthropic, [Activating AI Safety Level 3 protections](https://www.anthropic.com/news/activating-asl3-protections), May 2025.
- Anthropic, [Responsible Scaling Policy](https://www.anthropic.com/responsible-scaling-policy) (current version).
- Google DeepMind, [Frontier Safety Framework](https://deepmind.google/discover/blog/updating-the-frontier-safety-framework/), version 2.0, February 2025.
- OpenAI, [Preparedness Framework, version 2](https://openai.com/index/updating-our-preparedness-framework/), April 2025.
- NIST, [SP 800-218A: Secure Software Development Practices for Generative AI and Dual-Use Foundation Models](https://csrc.nist.gov/pubs/sp/800/218/a/final), July 2024.
- CISA, NSA, FBI, and partners, [Deploying AI Systems Securely](https://www.cisa.gov/news-events/alerts/2024/04/15/joint-guidance-deploying-ai-systems-securely), April 2024.
