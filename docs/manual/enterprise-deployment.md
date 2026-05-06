# Plan Forge for Enterprise

> **Audience**: Platform leads, security architects, and engineering managers evaluating Plan Forge for multi-team deployment in regulated or large-scale environments.
> **TL;DR**: Plan Forge is the open-source AI-SDLC orchestrator for teams whose code lives on GitHub. It is local-first by design (no Plan Forge SaaS plane), composes cleanly with Microsoft Foundry and other enterprise model gateways, and ships the orchestration layer GitHub explicitly leaves to the ecosystem.

---

## Why Plan Forge for the enterprise

Most "AI-SDLC" tools today are point solutions: a code completion in the IDE, an autonomous agent that opens one PR, a code reviewer that comments on PRs. Plan Forge is the layer above those — a plan-driven, gate-enforced, cost-tracked, multi-slice orchestration framework that turns a feature spec into a series of validated commits.

Three structural choices make it enterprise-fit:

1. **Local-first / air-gappable control plane.** The orchestrator runs on the developer's box or a CI runner. There is no Plan Forge SaaS service. Source code does not leave the customer's network unless the customer chooses to call a hosted LLM (and even then, all logging stays local). This is a structural difference from Cursor (workers can run on-prem but the control plane is in AWS) and Sourcegraph Amp (cloud-only, no self-host, no BYOK).
2. **GitHub-native by design, not by integration.** Plans, slices, and validation gates compose with GitHub Issues, Copilot Cloud Agent, Actions, AGENTS.md, and the GitHub MCP server. The architecture extends GitHub primitives in the direction GitHub has signaled (via the Copilot SDK preview and AGENTS.md/MCP/Skills as Linux Foundation standards) is the ecosystem's lane.
3. **Open standards throughout.** AGENTS.md, MCP, Agent Skills, and OpenTelemetry `gen_ai.*` semantic conventions are first-class. No proprietary file formats, no vendor lock-in, no "you must use our cloud."

---

## Where to find what you need

This page is a map. Each link goes to the document that answers a specific enterprise concern.

### Architecture and reference deployments

| You're asking | Read |
|---|---|
| What does a 5-team Plan Forge deployment look like? | [Reference Architecture](enterprise-reference-architecture.md) |
| How does Plan Forge compose with Microsoft Foundry / Azure OpenAI in our tenant? | [Reference Architecture — Microsoft-shop variant](enterprise-reference-architecture.md#microsoft-foundry-variant) |
| How does Plan Forge align with the GitHub stack we already pay for? | [Plan Forge on the GitHub Stack](github-stack-alignment.md) |
| How do we onboard 12 squad members on Day 1? | [Agent Factory Recipe](agent-factory-recipe.md) |

### Operations

| You're asking | Read |
|---|---|
| What does Day 1 / Week 4 / Week 12 look like for a team adopting Plan Forge? | [Fleet Operator Playbook](fleet-operator-playbook.md) |
| How do we run Plan Forge across N teams with shared visibility? | [Fleet Operator Playbook — Multi-Team](fleet-operator-playbook.md#multi-team) |
| What metrics should we track? | [Fleet Operator Playbook — KPIs](fleet-operator-playbook.md#kpis) |

### Security, compliance, data residency

| You're asking | Read |
|---|---|
| What gets logged, where, in what format, and how do we export it for audit? | [Compliance and Data Residency](compliance-and-data-residency.md) |
| Where does our source code go when we run Plan Forge? | [Compliance and Data Residency — Data Flow](compliance-and-data-residency.md#data-flow) |
| Can we run Plan Forge fully air-gapped? | [Compliance and Data Residency — Air-Gapped](compliance-and-data-residency.md#air-gapped-deployment) |
| Does Plan Forge work with Azure Government? | [Compliance and Data Residency — Azure Government](compliance-and-data-residency.md#azure-government) |
| What about HIPAA, FedRAMP, SOC2, PCI? | [Compliance and Data Residency — Compliance Posture](compliance-and-data-residency.md#compliance-posture) |

### Identity, auth, RBAC

| You're asking | Read |
|---|---|
| How does authentication work today? | [Compliance and Data Residency — Identity](compliance-and-data-residency.md#identity-and-authentication) |
| What's the roadmap for Entra ID / SAML / SCIM? | [Compliance and Data Residency — Roadmap](compliance-and-data-residency.md#identity-roadmap) |

### Telemetry and observability

| You're asking | Read |
|---|---|
| Can we ship Plan Forge traces to Splunk / Datadog / Application Insights? | [Compliance and Data Residency — Observability Export](compliance-and-data-residency.md#observability-export) |

### Cost and budgeting

| You're asking | Read |
|---|---|
| How do we estimate cost for a plan before running it? | [Fleet Operator Playbook — Cost Discipline](fleet-operator-playbook.md#cost-discipline) |
| How do we attribute cost to teams and engineers? | [Fleet Operator Playbook — Cost Attribution](fleet-operator-playbook.md#cost-attribution) |

---

## What Plan Forge is *not*

We are deliberate about lanes. Plan Forge is not:

- **An IDE replacement.** Cursor, Windsurf, VS Code Copilot Chat all do that better. Plan Forge sits above the IDE.
- **An LLM provider.** Plan Forge talks to Anthropic, OpenAI, xAI, GitHub Copilot, Microsoft Foundry. Pick yours.
- **A first-party agent runtime in the Foundry/Agent-Service sense.** Plan Forge orchestrates the SDLC; Microsoft Agent Framework and Foundry Agent Service are the agent runtime layer one altitude below.
- **A SaaS product.** There is no Plan Forge cloud. The dashboard runs on `localhost:3100`. Customers own their deployment top to bottom.

---

## Quick start for evaluators

If you have 30 minutes:

1. Read [Reference Architecture](enterprise-reference-architecture.md) for the picture.
2. Read [Plan Forge on the GitHub Stack](github-stack-alignment.md) for the why.
3. Skim [Compliance and Data Residency](compliance-and-data-residency.md) — Sections 1–3 cover 80% of typical security review questions.

If you have 90 minutes:

4. Read [Fleet Operator Playbook](fleet-operator-playbook.md) — gives you a calendar, not a feature list.
5. Read [Agent Factory Recipe](agent-factory-recipe.md) — the concrete onboarding pattern.

If you want to run it:

6. Follow the QUICKSTART walkthrough in the repo root, then return here for the multi-team patterns.

---

## Engineering principles that make this work

Plan Forge is built on five non-negotiables that show up in every layer:

1. **Architecture-first**: every change asks five questions before code is written (see `.github/instructions/architecture-principles.instructions.md`)
2. **Separation of concerns**: orchestrator → worker → repository → presentation, never collapsed
3. **Test-driven for business logic**: Red → Green → Refactor
4. **Type safety**: explicit types at every boundary
5. **Open standards**: AGENTS.md, MCP, Skills, OTel `gen_ai.*` — adopt, don't invent

Customers can read the same instruction files Plan Forge agents read. Nothing is hidden. The framework is the documentation.

---

## Support model

Plan Forge is open source (MIT). Support model is honest:

- **Issues** on GitHub for bugs and feature requests
- **GitHub Discussions** for usage questions
- **Self-repair tooling** built in — `forge_meta_bug_file` lets agents file defects against Plan Forge itself when they encounter them, and the project is dogfooded against itself
- **No commercial support tier today.** This may change. When it does, the open-source core stays open source.

For enterprises that need a commercial relationship, the right pattern today is to use Plan Forge directly and engage your usual platform-services partner (Microsoft FDE, Slalom, Accenture, etc.) for integration work.

---

## Changelog

- **2026-05-06** — Initial enterprise landing page. Maps to companion docs on reference architecture, GitHub stack alignment, agent factory recipe, fleet operator playbook, and compliance & data residency.
