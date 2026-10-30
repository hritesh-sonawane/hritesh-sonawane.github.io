+++
title = 'Glossary'
description = 'Short definitions of the terms this course uses, each linked to the lesson that explains it.'
weight = 100
+++

Short definitions of the terms used in this course. Where a lesson explains a
term in depth, the term links to it.

## A

- **[Action policy](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/)**:
  The deterministic check on every proposed tool call: tool allowlist, argument
  validation, the user's entitlement, session taint, approvals, and budgets.
  Also called an action rail.
- **[Adaptive attack](/notes/ai-security-engineering/how-attacks-work/01-prompt-injection/)**:
  An attack tuned against a specific defense, adjusting to how the defense
  responds. Published defenses fare much worse against adaptive attacks than
  against fixed test sets.
- **[Adversarial example](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  An input crafted to make a model err, also called model evasion. The EU AI
  Act names it among the attacks high-risk systems must resist.
- **[AI Act](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  Regulation (EU) 2024/1689, the EU law that regulates AI systems by the
  operator's role and the system's risk class, with obligations applying in
  stages from February 2025.
- **[AI-BOM](/notes/ai-security-engineering/securing-each-stage/03-models-and-supply-chain/)**: A bill of materials for an AI system or model: files, lineage,
  training data, licenses, and evaluations.
- **[AI inventory](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  The register of every AI system an organization runs, with its owner,
  purpose, models, data, capabilities, risk class, and controls. Every
  framework assumes one exists.
- **[AI RMF](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  NIST's voluntary AI Risk Management Framework (NIST AI 100-1), organized into
  four functions: Govern, Map, Measure, and Manage.
- **[Approval binding](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/)**:
  Tying a human approval to a hash of the exact tool and arguments shown, so
  that it cannot authorize any other call.
- **[ASI01–ASI10](/notes/ai-security-engineering/threat-landscape/03-frameworks-and-maps/)**: The identifiers of the OWASP Top 10 for Agentic
  Applications.
- **[ATLAS](/notes/ai-security-engineering/threat-landscape/03-frameworks-and-maps/)**:
  MITRE's knowledge base of adversary tactics, techniques, and case studies
  against AI systems.
- **[Attack success rate (ASR)](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  The share of attack attempts that achieve their outcome. **Model-level** ASR
  counts how often the model was fooled; **system-level** ASR counts how often
  the harmful outcome actually happened.
- **[Attacker model](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  A model used to generate and refine attacks against a target, guided by a
  scorer that checks the outcome.
- **[Attestation](/notes/ai-security-engineering/securing-each-stage/05-deployment-and-infrastructure/)**: Hardware-signed evidence of what software is running in a
  protected environment, checked before secrets or data are released to it.
- **[Audience](/notes/ai-security-engineering/securing-agents/02-identity-and-authorization/)**:
  The single resource server a token is valid for. A token with one audience
  cannot be replayed against other services.

## B

- **[Backdoor](/notes/ai-security-engineering/how-attacks-work/03-poisoning-and-supply-chain/)**: Behavior planted in a model, usually through poisoned training
  data, that appears only when a trigger is present.

## C

- **[CaMeL](/notes/ai-security-engineering/securing-agents/03-architectural-defenses/)**: A research design that tracks the origin of every value an agent
  handles and enforces policies on tool arguments based on that origin.
- **[Canary](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  A planted marker string whose appearance in output or outbound traffic
  reveals a leak. Red teams use canaries instead of real data.
- **[Confidential computing](/notes/ai-security-engineering/securing-each-stage/05-deployment-and-infrastructure/)**: Hardware protection of data while it is in use,
  combined with attestation.
- **[Confused deputy](/notes/ai-security-engineering/threat-landscape/01-why-ai-security-is-different/)**:
  A program that holds authority and is tricked into using it on behalf of
  someone who lacks it. The typical shape of an AI attack: the attacker's text,
  the victim's authority.
- **[Context provenance](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/)**:
  A record of which sources were in a model's context when it made a decision,
  written to the audit log so that incidents can be traced to their cause.

## D

- **[Data poisoning](/notes/ai-security-engineering/how-attacks-work/03-poisoning-and-supply-chain/)**: Corrupting the data a model is trained, fine-tuned, or
  grounded on, to change its behavior.
- **[Denial of wallet](/notes/ai-security-engineering/how-attacks-work/04-abuse-and-resource-attacks/)**: Driving up token or GPU spend to exhaust a budget or
  run up costs.
- **[Deployer](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  Under the AI Act, an organization that uses an AI system under its own
  authority. A deployer can become a provider by rebranding, substantially
  modifying, or repurposing a system.
- **[Deterministic control](/notes/ai-security-engineering/threat-landscape/02-threat-modeling-ai-systems/)**:
  A control enforced by code or configuration, independent of model behavior:
  a policy rule, scope, sandbox, or egress allowlist.
- **[Direct injection](/notes/ai-security-engineering/how-attacks-work/01-prompt-injection/)**:
  Prompt injection in which the attacker is the user, typing the instructions.
- **[Dual LLM](/notes/ai-security-engineering/securing-agents/03-architectural-defenses/)**: A pattern pairing a privileged model that plans and calls tools
  with a quarantined model that reads untrusted text and has no tools.

## E

- **[Egress control](/notes/ai-security-engineering/securing-agents/04-sandboxing-and-egress/)**:
  Restricting the outbound network destinations a workload can reach, usually
  deny by default through a proxy. It does not stop writes to destinations that
  are allowed.
- **[Excessive agency](/notes/ai-security-engineering/securing-agents/01-agent-threats/)**:
  A model holding more functionality, permission, or autonomy than its task
  needs.
- **[Exfiltration](/notes/ai-security-engineering/how-attacks-work/02-data-exfiltration-and-leakage/)**:
  Moving data to somewhere an attacker can read it, for example in a URL, an
  image request, or a message.

## G

- **[GPAI model](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  A general-purpose AI model under the AI Act, such as a foundation model.
  Providers have documentation and copyright duties, and more for models with
  systemic risk.
- **[Gray-box testing](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  Testing with knowledge of the design: architecture, tools, system prompts, and
  threat model. The most productive mode for AI red teaming.
- **[Guardrail](/notes/ai-security-engineering/securing-each-stage/06-runtime-guardrails/)**:
  A runtime check on input, action, or output, usually a classifier, a second
  model, or a rule.

## H

- **Hidden context exposure**: Disclosure of a system prompt or other context
  the user should not see.
- **[High-risk AI system](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  Under the AI Act, a system used in an Annex III area such as hiring or credit,
  or as a safety component of a regulated product. It carries the Act's full
  set of requirements.

## I

- **[Indirect prompt injection](/notes/ai-security-engineering/how-attacks-work/01-prompt-injection/)**:
  Prompt injection delivered through content the system reads, such as a web
  page, a file, an email, or a tool result.
- **[Influence flow](/notes/ai-security-engineering/threat-landscape/02-threat-modeling-ai-systems/)**: Which text can steer which model, and what that model can
  then do.
- **[ISO/IEC 42001](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  The certifiable international standard for an AI management system. It
  certifies a process within a declared scope, not the safety of a model.

## J

- **[Jailbreak](/notes/ai-security-engineering/how-attacks-work/04-abuse-and-resource-attacks/)**:
  Getting a model to violate its own safety training or its operator's rules.

## K

- **[Kill switch](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/)**:
  A tested mechanism that stops or restricts an agent, tool, tenant, or the
  whole platform at once, such as a global read-only mode.

## L

- **[Lethal trifecta](/notes/ai-security-engineering/threat-landscape/01-why-ai-security-is-different/)**:
  Access to private data, exposure to untrusted content, and a way to
  communicate externally, combined in one agent. Together they make
  exfiltration possible.

## M

- **[MCP (Model Context Protocol)](/notes/ai-security-engineering/securing-agents/05-mcp-and-tool-security/)**: An open protocol through which AI
  applications connect to external tools and data sources, called MCP servers.
- **[Memory poisoning](/notes/ai-security-engineering/securing-agents/01-agent-threats/)**: Planting instructions or false facts in an agent's
  persistent memory so that they affect later sessions.
- **[Model signing](/notes/ai-security-engineering/securing-each-stage/03-models-and-supply-chain/)**: A cryptographic signature over all the files of a model,
  verified before loading. OpenSSF Model Signing (OMS) is one format.

## O

- **[On-behalf-of](/notes/ai-security-engineering/securing-agents/02-identity-and-authorization/)**: An agent acting with a user's delegated, scoped authority,
  never more than the user's own permissions.

## P

- **[Probabilistic control](/notes/ai-security-engineering/threat-landscape/02-threat-modeling-ai-systems/)**: A control that estimates rather than enforces,
  such as a classifier, a judge model, or an instruction in a prompt.
- **[Prompt injection](/notes/ai-security-engineering/how-attacks-work/01-prompt-injection/)**:
  Attacker-supplied text that changes what a model does, making it follow
  someone else's instructions.
- **[Provenance](/notes/ai-security-engineering/securing-each-stage/02-data-and-training/)**: The recorded origin of data, a model, or an item in a
  context.
- **[Provider](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  Under the AI Act, whoever develops an AI system or model and places it on the
  market or puts it into service under their own name. Providers carry most
  obligations.
- **[Purple teaming](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  Running attacks with defenders watching, to check that each attack produced an
  alert, a usable audit trail, and a workable response.

## Q

- **[Quarantined model](/notes/ai-security-engineering/securing-agents/03-architectural-defenses/)**: A model with no tools, used to read untrusted content
  so that an injection in it has nothing to act with.

## R

- **[Red teaming](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  Attacking your own system on purpose, as an adversary would, to find
  weaknesses that reviews and tests missed.
- **[Regression case](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  A past finding turned into a permanent automated test with a code-checked
  success condition, run on every release.
- **[Release gate](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  A CI check that blocks a release when an evaluation or adversarial suite
  falls below its threshold.
- **[Residual risk](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/)**:
  The risk that remains after all controls, written down with the reason it
  remains, its mitigations, and an owner.
- **[Rug pull](/notes/ai-security-engineering/how-attacks-work/03-poisoning-and-supply-chain/)**: A tool or server that changes its behavior or description after
  it was reviewed and approved.
- **[Rule of two](/notes/ai-security-engineering/securing-agents/03-architectural-defenses/)**:
  Within one session, an agent should hold at most two of untrusted input,
  access to sensitive data, and the ability to act externally, unless a human
  approves the step.

## S

- **[safetensors](/notes/ai-security-engineering/securing-each-stage/03-models-and-supply-chain/)**: A weights-only model file format that cannot execute code
  when loaded, unlike pickle-based formats.
- **[Sandbox](/notes/ai-security-engineering/securing-agents/04-sandboxing-and-egress/)**:
  An isolated environment for running untrusted code, such as a gVisor
  container or a microVM.
- **[Session taint](/notes/ai-security-engineering/securing-agents/03-architectural-defenses/)**:
  A sticky flag recording that untrusted content entered a session's context.
  Policies use it to gate outbound or irreversible actions.
- **[Shadow AI](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  AI tools, models, and agents adopted without review, and so missing from the
  inventory.
- **[Systemic risk](/notes/ai-security-engineering/governance-and-practice/01-compliance-and-regulation/)**:
  Under the AI Act, the category of the most capable general-purpose models,
  presumed above 10^25 FLOPs of training compute, which carry extra duties such
  as adversarial testing and incident reporting.

## T

- **[Token exchange](/notes/ai-security-engineering/securing-agents/02-identity-and-authorization/)**:
  Trading one token for a narrower one that names the subject, the actor, one
  audience, and a minimal scope, as defined in RFC 8693.
- **[Tool gateway](/notes/ai-security-engineering/securing-agents/05-mcp-and-tool-security/)**: The proxy between agents and MCP servers that enforces the
  tool catalog, authorization, inspection, and audit.
- **[Tool poisoning](/notes/ai-security-engineering/how-attacks-work/03-poisoning-and-supply-chain/)**: Instructions hidden in a tool's description or metadata,
  which the model reads as part of its context.
- **[Trust boundary](/notes/ai-security-engineering/threat-landscape/02-threat-modeling-ai-systems/)**: A line in a design where control of data or execution
  changes hands.

## W

- **[Wilson score interval](/notes/ai-security-engineering/governance-and-practice/02-the-red-team-program/)**:
  A confidence interval for a success rate that stays sensible at small counts
  and at zero successes, used to report attack success rates.
- **[Workload identity](/notes/ai-security-engineering/governance-and-practice/03-securing-an-agent-platform/)**:
  A cryptographic identity issued to a piece of software, such as a SPIFFE ID,
  used instead of a shared secret.
