# Compliance and Data Residency

> **Audience**: Security architects, compliance officers, and platform leads conducting a security review of Plan Forge.
> **Scope**: Where data lives, what's logged, how to export for audit, identity model (today and roadmap), and the air-gapped / Azure Government deployment paths.

---

## TL;DR for security review

Plan Forge is **local-first**. The orchestrator runs on the developer's machine or a CI runner inside the customer's network. There is no Plan Forge SaaS service. Source code does not leave the customer's network unless the customer chooses to call a hosted LLM (and even then, all logging stays local). The audit trail is structured, complete, and exportable. Identity is currently bearer-token only and is the largest gap on the roadmap.

| Concern | Status |
|---|---|
| Source code leaves network | Only when customer-configured LLM provider is hosted; all logging stays local |
| Audit log of agent actions | Structured, complete, **production-grade** today (`telemetry.mjs`, `EVENTS.md`) |
| Audit log export | OTel exporter on roadmap (Week 2 of enterprise hardening); manual export available today |
| Identity / SSO | **Bearer token only today**; Entra ID / SAML / SCIM on roadmap |
| RBAC | **None today**; on roadmap |
| Data residency controls | Customer chooses LLM provider region; Plan Forge respects |
| Air-gapped deployment | Architecturally supported; documentation gap (this doc) |
| Encryption at rest | Customer's filesystem encryption (Plan Forge respects) |
| Secret redaction | Built-in for testbed findings; configurable scope on roadmap |
| FedRAMP / IL5 / IL6 / HIPAA / PCI / SOC2 | Plan Forge is OSS — compliance posture is the customer's deployment, not a Plan Forge certification |

---

## Data flow {#data-flow}

Five concrete data movements. For each, who handles the data and where it goes.

### 1. Source code

**Stays in the customer's network**, except for:
- The bytes of files you choose to send to a hosted LLM as part of a prompt (Anthropic API, OpenAI API, GitHub Copilot, etc.)
- The bytes of code Copilot Cloud Agent reads on its GitHub-hosted ephemeral runner (subject to GitHub's data handling)

If you use only on-prem inference (Foundry Local, Ollama, vLLM, llama.cpp, etc.), source code never leaves your network for any reason.

### 2. Plan files

**Stay in the customer's repo.** Plan files (`docs/plans/*.md`) are committed to git. They live wherever the repo lives.

### 3. `.forge/` artifacts

**Stay on the local filesystem** (developer machine or CI runner). Includes:
- `.forge/runs/<id>/` — per-run trajectory, events, slice artifacts, summary, traces, cost history
- `.forge/cost-history.json` — aggregate cost
- `.forge/telemetry/tool-calls.jsonl` — MCP tool invocations
- `.forge/liveguard-events.jsonl` — LiveGuard scan events
- `.forge/trajectories/<plan-slug>.jsonl` — Copilot Coding Agent trajectories (when CCA is the worker)
- `.forge/fm-sessions/*.jsonl` — Forge-Master conversation sessions

`.forge/` is gitignored by default. It can be committed for audit purposes if your security policy requires.

### 4. Memory

Three tiers, three different residency stories:

| Tier | Location | Lifetime | Notes |
|---|---|---|---|
| **L1 (volatile hub)** | In-process RAM | Per-process | Bounded ring buffer, evicted on restart |
| **L2 (structured)** | Local filesystem (`.forge/`, `.github/`, `docs/plans/`) | Persistent | Survives restart; lives where the repo lives |
| **L3 (semantic via OpenBrain)** | External Postgres + pgvector (optional) | Forever | **Cross-project by design.** If used, deploy the Postgres in your network |

If L3/OpenBrain is not configured, Plan Forge runs single-project, single-session memory only. No external service required.

### 5. Telemetry / observability

By default, telemetry stays local in `.forge/telemetry/`. With the OTel exporter (Week 2 of enterprise hardening), traces and metrics are emitted in the OpenTelemetry `gen_ai.*` semantic-convention format to a customer-chosen OTLP endpoint. Common targets:

- Splunk Observability Cloud
- Datadog
- Grafana Tempo / Mimir / Loki
- Microsoft Application Insights (especially relevant for Foundry-attached deployments)
- Honeycomb
- Customer-hosted OTel Collector forwarding anywhere

The OTel exporter is **off by default**. Enable by setting `OTEL_EXPORTER_OTLP_ENDPOINT`.

---

## Audit logging

### What's logged

Plan Forge emits **structured events** for ~30 categories. The schema is documented at [pforge-mcp/EVENTS.md](../../pforge-mcp/EVENTS.md). Categories include:

- Plan execution lifecycle (`run-started`, `slice-started`, `slice-completed`, `run-completed`)
- Worker LLM calls (model, provider, token counts, latency, cost)
- MCP tool invocations (tool name, args [optional], result [optional])
- Validation gate execution (gate name, result, duration)
- Quorum dispatch (`quorum-started`, `quorum-model-replied`, `quorum-synthesized`)
- LiveGuard scans (`drift-`, `incident-`, `secret-scan-`, `dep-watch-`)
- Crucible smelts (idea funnel)
- Tempering runs (plan hardening)
- Bug registry (open, status changes)
- Skill execution (start, step, complete)
- Watcher events (when one project tails another)

Each event carries:
- ISO8601 timestamp
- Event type
- Correlation ID (groups events from the same run)
- Source (which subsystem emitted it)
- Severity (TRACE / DEBUG / INFO / WARN / ERROR / FATAL)
- Type-specific data payload

### Where it's logged

| Sink | Format | Retention |
|---|---|---|
| `.forge/runs/<id>/events.log` | NDJSON | Per-run, kept until manual cleanup |
| `.forge/runs/<id>/trace.json` | OTLP-compatible | Per-run |
| `.forge/telemetry/tool-calls.jsonl` | NDJSON, append-only | Persistent |
| `.forge/liveguard-events.jsonl` | NDJSON, append-only | Persistent |
| Hub event stream | In-memory + WebSocket | Volatile (last N events) |

### How to export for audit

Today (manual):
```bash
# Aggregate all events from a date range
jq -s 'sort_by(.ts)' .forge/runs/*/events.log > audit-export.json

# Or use forge_search for filtered export
pforge search --since 2026-04-01 --sources run,liveguard,bug --output audit.json
```

Roadmap (Week 2 of enterprise hardening): `pforge audit export --since <date> --format <json|csv>` as a first-class CLI.

### Secret redaction

Built-in for testbed findings (`defect-log.mjs`). High-entropy secret detection in diffs (`forge_secret_scan`) **always redacts values**; findings are masked before caching or display. Plan to formalize as a configurable scope in Week 3 (auth/RBAC scaffolding).

---

## Identity and authentication {#identity-and-authentication}

### Today

Plan Forge supports:
- **Bearer token** for write operations against the dashboard / hub (configured as `bridge.approvalSecret` in `.forge.json`)
- **API keys** loaded from environment variables or `.forge/secrets.json` for LLM providers (OpenAI, Anthropic, xAI, GitHub Copilot, Azure OpenAI when manually configured)

Known secrets recognized:
- `GITHUB_TOKEN`
- `XAI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENCLAW_API_KEY`

**Not yet supported as first-class:**
- `AZURE_OPENAI_API_KEY` + endpoint URL (works manually; first-class config on roadmap)
- Entra ID / SAML / SCIM
- OAuth flows

### Identity roadmap {#identity-roadmap}

Order of priority based on enterprise requests:

1. **BYO Azure OpenAI first-class** (Week 3 of enterprise hardening) — `AZURE_OPENAI_API_KEY` and endpoint as recognized secrets, deployment-name vs model-name handled in config, Entra ID auth via `azure-identity` SDK
2. **Auth model documentation + extension point** (Week 3) — describes how Plan Forge thinks about identity today and the planned model. Adds a clear interface for plugging in SSO providers
3. **Config-driven RBAC scaffold** (Week 3) — roles, permissions, who can do what (enforcement basic; structure right)
4. **Entra ID SSO** (post-Week-4) — full implementation
5. **SAML / SCIM** (later) — driven by enterprise demand

If your security review requires SSO/SCIM/RBAC today, Plan Forge is not a fit. The honest answer matters more than overpromising.

---

## Compliance posture

Plan Forge is **open-source software (MIT license)**. Compliance certifications (FedRAMP, IL5/IL6, HIPAA, PCI-DSS, SOC2) attach to the **customer's deployment** of Plan Forge, not to Plan Forge itself. There is no Plan Forge SaaS to certify.

That said, several Plan Forge architectural choices are friendly to compliance audits:

| Posture | What helps |
|---|---|
| **No SaaS data plane** | Nothing to subpoena from a vendor; data lives where you put it |
| **Structured audit trail** | Every action logged with timestamps, correlation IDs, severity |
| **Open source** | Auditable end-to-end; no proprietary closed binaries |
| **Local-first by default** | Air-gapped deployment is structurally possible (see below) |
| **Open standards** | AGENTS.md, MCP, OTel `gen_ai.*` — no proprietary lock-in to challenge |
| **Compliance reviewer agent** | `.github/agents/compliance-reviewer.agent.md` ships out of the box for GDPR/CCPA/SOC2/HIPAA-aware code review |
| **Project profile compliance frameworks** | `.github/prompts/project-profile.prompt.md` collects SOC2, HIPAA, PCI-DSS, GDPR, FedRAMP early in setup |

For specific frameworks:

### SOC2 Type II
- Audit trail completeness: ✅ (events, traces, run artifacts)
- Access controls: ⚠️ (bearer token today; SSO/RBAC on roadmap)
- Change management: ✅ (git-based plan files, scope contracts, gates)
- Encryption in transit: ✅ for LLM API calls; ✅ for OTel export when configured with TLS
- Encryption at rest: customer's filesystem encryption

### HIPAA
- BAA: not applicable (no Plan Forge SaaS to BAA)
- Customer's BAA with their LLM provider applies to inference data
- Audit log: structured and complete
- PHI handling: customer's responsibility — Plan Forge does not pre-process content

### PCI-DSS
- Scope reduction: Plan Forge does not handle payment data unless customer-configured to read it. Recommend isolating any PCI-relevant code review to dedicated Plan Forge instances with strict secret scanning enabled.
- Secret handling: built-in detection + redaction for high-entropy strings in diffs

### FedRAMP / IL5 / IL6
- Plan Forge is deployable in Azure Government and on-prem environments that match FedRAMP / IL boundaries
- Use only FedRAMP-authorized LLM providers (Azure OpenAI in Azure Government has FedRAMP-authorized models — `gpt-5.1`, `gpt-4.1`, `o3-mini`, `gpt-4o`)
- Plan Forge itself does not require FedRAMP authorization (it's software you run, not a service you consume)

### GDPR / CCPA
- Data minimization: Plan Forge does not collect personal data unless customer-configured
- Right to access / delete: applies to data the customer chooses to capture; `.forge/` artifacts are deletable

---

## Air-gapped deployment {#air-gapped-deployment}

Plan Forge is architecturally compatible with fully air-gapped deployment. The complete pattern:

### What works air-gapped

- Plan Forge orchestrator (Node.js process; no inbound network calls required)
- Dashboard (`localhost:3100`)
- Plan execution against local repos
- All `.forge/` artifact storage
- L1 (in-memory) and L2 (filesystem) memory tiers
- OTel export to in-network OTel collector
- Validation gates (run locally as shell commands)

### What requires special handling air-gapped

| Component | Air-gapped solution |
|---|---|
| **LLM inference** | Use **Foundry Local powered by Azure Local** (preview May 2026), Ollama, vLLM, llama.cpp, or similar on-prem inference. Configure as the OpenAI-compatible endpoint Plan Forge talks to. |
| **GitHub Enterprise** | Use **GitHub Enterprise Server (GHES)** instead of GitHub.com. Plan Forge supports GHES; Cloud Agent local-MCP-server pattern works |
| **Update checks** | Set `PFORGE_NO_UPDATE_CHECK=1` to disable. Manual updates via `pforge self-update --from-local <path>` or repo sync from internal mirror |
| **OpenBrain L3 memory** | Optional; if used, deploy the Postgres+pgvector inside the boundary |
| **MCP servers** | Self-host any MCP server you want available; point `.vscode/mcp.json` at internal endpoints only |

### What does NOT work air-gapped

- Plan Forge Hub WebSocket connections to external observability (configure local OTel collector instead)
- Any LLM provider that requires public internet (configure on-prem inference instead)
- The community extensions catalog (use `pforge ext add --from-local <path>` for vetted extensions)

### Deployment checklist for air-gap

- [ ] On-prem LLM inference deployed (Foundry Local / Ollama / vLLM)
- [ ] GHES instead of GitHub.com (or no GitHub at all if your VCS is internal)
- [ ] Internal git mirror for `srnichols/plan-forge` updates
- [ ] OTel collector inside the boundary
- [ ] OpenBrain (if using L3 memory) deployed inside the boundary
- [ ] All MCP server endpoints internal
- [ ] `PFORGE_NO_UPDATE_CHECK=1` set
- [ ] Network egress audit confirms zero outbound to public internet

**This is the differentiator vs. competitors.** Cursor cannot offer this (control plane in AWS even with self-hosted workers). Sourcegraph Amp explicitly cannot (no self-host, no BYOK). GitHub Copilot Cloud Agent runs on GitHub-hosted infrastructure. **For air-gapped requirements, Plan Forge is structurally the only viable option in the comparison set.**

---

## Azure Government {#azure-government}

For customers deploying in Azure Government:

### What works
- Plan Forge orchestrator running on Azure Government VMs / AKS / Functions
- Azure OpenAI in Azure Government as the LLM provider
- Endpoint domain: `openai.azure.us` (not `openai.azure.com`)
- Auth: `login.microsoftonline.us` Entra ID (when first-class Entra support lands)
- Today: API key auth works via the manually-configured Azure OpenAI path

### Model availability
Azure Government has a **substantially smaller catalog** than commercial Azure:
- `gpt-5.1`
- `gpt-4.1`
- `gpt-4.1-mini`
- `o3-mini`
- `gpt-4o`
- Embeddings: `text-embedding-3-large`, `text-embedding-3-small`, `text-embedding-ada-002`

Available in `usgovarizona` and `usgovvirginia`, with Data Zone Standard and Provisioned variants.

### Plan Forge implications
- The default `power` quorum preset (assumes flagship models like `gpt-5.5` or `claude-opus-4.7`) won't resolve cleanly
- Use a `power-gov` preset (planned) or graceful fallback
- The `speed` preset works (`gpt-4.1-mini` exists in gov)

### Compliance certifications inherited
Both global Azure and Azure Government are FedRAMP High. Azure Government adds contractual commitments around US-based data storage and screened-US-persons access. HIPAA and PCI are covered under Azure's standard compliance umbrella for the underlying services; Plan Forge running on top inherits the boundary.

For Azure Government Secret and Top Secret cloud feature availability, contact your Microsoft account team — public documentation is limited.

---

## Observability export {#observability-export}

The Week 2 work in the enterprise hardening track adds first-class OpenTelemetry export. Spec is documented at [docs/research/enterprise-fleet-readiness.md §8.6](../research/enterprise-fleet-readiness.md). Summary:

### What gets emitted

- **Spans** for every LLM call (CLIENT, kind chat/embeddings/etc.) with full `gen_ai.*` attribute set including token counts (input, output, cache_read, cache_write, reasoning), latency, model, provider
- **Spans** for every MCP tool call (INTERNAL, kind execute_tool) with tool name and call ID
- **Spans** for every slice (INTERNAL, kind invoke_agent) with plan/slice correlation
- **Spans** for every plan run (INTERNAL, kind invoke_workflow)
- **Spans** for every validation gate (INTERNAL, plan-forge-vendor namespace)
- **Metrics** — `gen_ai.client.operation.duration` histogram, `gen_ai.client.token.usage` histogram
- **Events** (opt-in) — `gen_ai.client.inference.operation.details` with input/output messages (gated by `pforge.telemetry.captureContent` flag, default off — PII implications)

### Vendor-namespaced extensions

`pforge.*` attributes for plan/slice/run correlation, scope contract IDs, gate names, cost USD (since `gen_ai.cost` doesn't exist in the spec).

### Backends supported

Anything that speaks OTLP. Tested compatibility (planned for Week 2):
- Splunk Observability Cloud
- Datadog
- Grafana Tempo
- Microsoft Application Insights (especially relevant for Foundry-attached deployments — Foundry uses the same OTel `gen_ai.*` conventions, so Plan Forge runs land in the same dashboards as the customer's Foundry agents)
- Honeycomb
- Customer-hosted OTel Collector

### Privacy controls

- Content capture (prompt + completion text) is **opt-in by default**
- Three patterns supported: don't capture / capture as span attributes / externalize via hook to a separate store with only references on the span
- Toggle via `pforge.telemetry.captureContent` config flag and standard OTel env vars

---

## Common security review questions

### Q: Where can our source code go?
A: Wherever you choose to send it via your configured LLM provider. With on-prem inference, nowhere outside your network. Plan Forge itself never transmits source code.

### Q: Does Plan Forge phone home?
A: No telemetry is transmitted to Plan Forge maintainers. The optional update check fetches release metadata from GitHub. Disable with `PFORGE_NO_UPDATE_CHECK=1`.

### Q: Can we audit every action an agent took?
A: Yes. Per-run trajectory in `.forge/runs/<id>/` includes events, slice artifacts, traces, cost history, and (for CCA-dispatched runs) the full Copilot Cloud Agent trajectory.

### Q: How do we prevent agents from editing files outside scope?
A: Plan Forge enforces scope contracts at the plan level (`In Scope`, `Out of Scope`, `Forbidden Actions` blocks). Pre-tool-use hooks block edits to forbidden paths. Post-execution `pforge diff` checks for drift.
**Honest gap**: enforcement is best-effort at the worker level — the orchestrator can't always *prevent* a bad edit, only detect it. Roadmap item to harden.

### Q: What happens if an agent malfunctions?
A: Per-slice `workerTimeoutMs` cap kills runaway workers. Reflexion retry with backoff handles recoverable failures. `forge_alert_triage` ranks issues by priority. In-loop stuck detector is on the roadmap (OpenHands-pattern).

### Q: Can we enforce a budget per team?
A: `.forge.json` per repo supports `cost.dailyMax` and similar caps (planned formalization). Per-engineer attribution is on the roadmap.

### Q: What's the data retention model?
A: Plan Forge does not delete `.forge/` artifacts automatically. Retention is the customer's policy — implement via standard filesystem tools or post-run cleanup hooks.

### Q: Are LLM responses cached?
A: Plan Forge does not cache LLM responses. Some LLM providers (Anthropic, OpenAI) do prompt caching — that's their infrastructure, billed at reduced rates. Plan Forge tracks cache hit/miss for cost accuracy (see Week 3 cost-service token coverage fix).

### Q: How do we know Plan Forge itself isn't compromised?
A: Open source. MIT license. Audit the code. Plan Forge is dogfooded against itself — every release ships through the same Plan Forge pipeline that customers use. Self-repair tooling (`forge_meta_bug_file`) gives agents a way to file defects against Plan Forge during execution.

---

## Changelog

- **2026-05-06** — Initial Compliance and Data Residency doc. Covers data flow (5 movements), audit logging (events, sinks, export), identity (today + roadmap), compliance posture per framework (SOC2/HIPAA/PCI-DSS/FedRAMP/GDPR), air-gapped deployment pattern (the structural differentiator), Azure Government composition, OTel observability export spec summary, and 9 common security-review Q&A.
