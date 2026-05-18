# Plan Forge — Enterprise Fleet-Orchestration Readiness

> **Status:** Working research document. Iterating live.
> **Started:** 2026-05-06
> **Owner:** Scott
> **Purpose:** Use what we learn from observing large-enterprise AI-SDLC evaluations (Cohesity-class accounts) to harden Plan Forge for fleet-orchestration workloads at scale. **Not** a customer-specific deliverable. Generic improvement track.

---

## Why this document exists

Large enterprises evaluating AI-SDLC platforms in 2026 are no longer asking "does the agent write good code." They're asking "can we run an autonomous, multi-team, evaluable agent fleet across N product teams in 90 days." That's an **orchestration problem on top of LLM-native code generation**, and the vendors who win the next 18 months will be the ones with the strongest answer to it.

Plan Forge is unusually well-positioned for this category because:

1. It's GitHub-native by design (not by integration), which directly reinforces the platform-consolidation thesis large enterprises are pursuing.
2. It already implements several capabilities that competitors gloss over: plan-level scope contracts with enforcement, full trajectory capture, per-slice quality gates, per-task model selection, drift/regression as gates (not reports), cost attribution to plan/slice, memory architecture for cross-session continuity.
3. It's open source and dogfooded — the project documents itself with cost reports per chapter, which is a unique trust signal.

The gaps are not on the engineering axes. They're on the **enterprise readiness** axes: auth, audit, RBAC, multi-tenancy, on-prem/air-gapped, OpenTelemetry export, BYO-LLM, and operator-persona documentation.

This document tracks: (a) the competitive landscape we should understand cold, (b) the specific gaps to close, (c) the unique strengths to deepen, and (d) the work plan for the next 1–4 weeks.

---

## Section 1 — Competitive landscape

The eval set a sophisticated enterprise will compare against, in approximate order of likelihood.

### Commercial fleet-orchestration tools

| Tool | Strength | Weakness for fleet rollout |
|---|---|---|
| **Cursor (Background Agents + Bugbot)** | Best-in-class IDE polish; Background Agents ship fleet orchestration today; Bugbot for review automation | Platform-agnostic by design (works equally well on GitLab/Bitbucket) — does not reinforce GitHub consolidation; per-seat pricing scales painfully at 1000+ devs |
| **Sourcegraph (Cody + Amp)** | Strong code intelligence, enterprise tier mature, batch changes proven at scale | Originally a code-search company; orchestration story is younger; not GitHub-native |
| **Devin (Cognition Labs)** | High-profile autonomous agent; demo strong | Closed system; hard to integrate with existing GitHub workflow; trajectory opacity |
| **GitHub Copilot Coding Agent (native)** | Native to the substrate; no third party | Primitives only — does not solve the fleet orchestration layer; this is exactly the gap that opens space for Plan Forge |
| **Factory.ai** | "Droids" framing, agent-as-team-member positioning | Newer entrant; less battle-tested at scale |
| **Codeium / Windsurf** | IDE-first; growing enterprise traction | Like Cursor, platform-agnostic; not a GitHub-consolidation play |

### OSS / patterns enterprises survey for bespoke builds

Many large enterprises (data companies, infra companies, regulated industries) prefer to build their own AI-SDLC harness rather than buy. They survey OSS projects to gather patterns the community has already solved.

| Project | What it solves | What to learn from it |
|---|---|---|
| **Anthropic claude-code + AGENTS.md** | The reference implementation for agent context files | AGENTS.md adoption is universal — Plan Forge already integrates this |
| **OpenHands (formerly OpenDevin)** | Open autonomous coding agent | Trajectory capture model; sandbox patterns |
| **SWE-agent (Princeton)** | Research-grade autonomous agent for SWE-bench | Tool-use patterns; benchmark methodology |
| **aider** | Pair-programming CLI agent | Git-native diff workflow; minimal surface area discipline |
| **CrewAI / AutoGen / LangGraph** | Multi-agent orchestration frameworks | Fleet patterns, role definitions, agent-to-agent handoff |
| **Plan Forge** (us) | Plan-level scope contracts, slice gates, cost attribution, memory, drift detection | This is what we deepen |

### Research notes — to fill in

For each tool above, we should capture (one paragraph each, no marketing fluff):

- [x] **Cursor Background Agents** — actual capability today, pricing model, GitHub-vs-platform-agnostic stance, fleet orchestration claims vs. delivery (resolved in §8.2 — renamed to Cloud Agents in Cursor 3, per-user fan-out not multi-team, no plan-as-contract, no air-gap)
- [x] **Sourcegraph Amp** — orchestration story specifics, enterprise tier features, on-prem story (resolved in §8.3 — Sourcegraph 7.0 repositioned as "intelligence layer", Amp explicitly no self-host / no BYOK, subagents can't communicate)
- [ ] **Devin** — what's actually shipping vs. demo'd, integration model, trajectory exposure (deferred — not part of the May 6 research dispatch; queued for follow-up if Devin shows up in a customer conversation)
- [x] **GitHub Copilot Coding Agent** — current state, what it deliberately doesn't do (resolved in §8.4 — renamed to Cloud Agent April 2026, Copilot SDK preview is GitHub stating orchestration belongs to the ecosystem, single-repo / single-PR-per-task explicit limitation)
- [x] **OpenHands** — sandbox model, trajectory format, current adoption signals (resolved in §8.5 — 72.7k stars, immutable Pydantic Events with explicit source/role separation, two-level cost model worth borrowing)
- [ ] **CrewAI / AutoGen / LangGraph** — which patterns are useful at the fleet level vs. which are just framework noise (deferred — not part of May 6 dispatch; lower priority than the production-grade tools above)

---

## Section 2 — Gap analysis (what enterprises will look for)

Mapped against what Plan Forge ships today and what it's missing for an enterprise rollout.

| Capability | Why it matters at enterprise scale | Plan Forge today | Gap | Effort |
|---|---|---|---|---|
| **Enterprise auth (SAML / SCIM / Entra ID)** | MS-shop enterprises expect Entra ID SSO out of the box | None | High | High (real code) |
| **Audit logging for compliance** | SOC2 / ISO audit trail for every agent action, exportable | Telemetry exists in `telemetry.mjs`; not formalized as audit log | Medium | Medium (formalize what exists) |
| **RBAC and approval workflows** | Who can run which plans, who approves high-risk slices, who overrides gates | None | High | High |
| **Multi-tenancy / team isolation** | N teams running in parallel without bleed-over | Worktree-manager partial; not productized | Medium | Medium |
| **On-prem / air-gapped option** | Data-sensitive enterprises won't let LLM traffic leave their VPC | Possible via BYO API endpoint; undocumented | Medium (docs) → High (full air-gap) | Low to High |
| **OpenTelemetry export** | Plug into existing Splunk / Datadog / Grafana, not our dashboard | `telemetry.mjs` exists; no OTel exporter | Medium | Low to Medium |
| **BYO LLM credentials / Azure OpenAI in tenant** | Enterprise wants its own keys, its own tenant, its own billing | Multi-provider supported; needs Azure OpenAI first-class | Medium | Medium |
| **Fleet operator persona docs** | Docs assume a developer running locally; need ops docs for running across N teams | None | Medium | Low (pure docs) |
| **Reference architecture at scale** | "What does 1000 developers look like" deployment diagram | None | High visibility | Low (pure docs) |
| **Day 1 / Week 4 / Week 12 onboarding playbook** | Enterprises want a calendar, not a feature list | None | High visibility | Low (pure docs) |
| **Agent Factory recipe** | "How do 12 squad members come online on Day 1" | None | High visibility | Low (pure docs) |
| **Compliance / data-residency page** | Where does data live, what crosses boundaries, what's logged | Scattered across docs | Medium | Low (pure docs) |
| **Fleet dashboard cross-team view** | Single pane of glass across N team rollouts | Single-project dashboard exists | Medium | Medium |
| **SLA / support model documentation** | Even for OSS, enterprises want to know the contract | None | Medium | Low |

### Triage

**High visibility, low effort (do first):**
- Reference architecture diagram for 5–N team fleet
- Day 1 / Week 4 / Week 12 operator playbook
- Agent Factory recipe page
- Fleet operator persona docs
- Compliance / data-residency page
- Enterprise deployment landing page (one map of all the above)

**Medium effort, high payoff (do next):**
- Audit log formalization (define schema, ensure all events emit, document export)
- OpenTelemetry exporter (we have telemetry; convert to OTel spans)
- BYO Azure OpenAI documentation + first-class config

**High effort (queue for later, but plan now):**
- Entra ID SSO scaffolding + extension point
- Config-driven RBAC scaffold
- Multi-tenancy productization

---

## Section 3 — Unique strengths to deepen

Where Plan Forge wins on architecture today. These are the axes where we should sharpen the story so the comparison shifts to ground we own.

### 3.1 GitHub-native by design, not by integration

Cursor, Devin, Sourcegraph treat GitHub as one substrate among many. Plan Forge is built on top of GitHub primitives — Issues, Coding Agent, Actions, AGENTS.md, GHAS, MCP — and the architecture assumes them. For an enterprise consolidating on GitHub Enterprise + Copilot Enterprise, this is a *feature*, not a limitation.

**Deepening moves:**
- Document the primitive mapping explicitly: every Plan Forge capability → which GitHub primitive it consumes
- Show the "GitHub stack alignment score" as a first-class concept
- Build the "Plan Forge on the GitHub stack" page (already exists at `docs/manual/plan-forge-on-the-github-stack.html`) as the canonical reference for this thesis

### 3.2 Plan-level scope contracts with enforcement

Most fleet tools rely on prompt discipline ("don't touch files outside scope, please"). Plan Forge enforces at execution time via the Scope Contract block in plan files plus pre-tool-use hooks that block edits to forbidden paths. This is the most defensible architectural difference we have.

**Deepening moves:**
- Write a clear comparison page: "How Plan Forge prevents scope drift vs. how prompt-only tools attempt to"
- Quantify it: run a test scenario across competitors, count scope violations
- Surface the Scope Contract in the dashboard as a first-class artifact

### 3.3 Trajectory capture and replay

Full record of what the agent did — tool calls, intermediate decisions, model selections per step, cost per action. Most vendors capture only the final diff or a partial transcript. This is what makes incidents debuggable in week 8 and what makes eval data possible in week 12.

**Deepening moves:**
- Document the trajectory format as a public schema
- Build a trajectory diff tool: "compare two runs of the same plan"
- Demonstrate eval-from-trajectory: replay N runs, score quality trend over time

### 3.4 Per-slice quality gates, not just PR-level review

A 4-hour autonomous task can pass PR review and still have produced low-quality work in steps 3 through 7 that nobody sees. Plan Forge runs validation gates between every slice. This is invisible to most evals but critical for trust at scale.

**Deepening moves:**
- Build a "gate failure heatmap" — which slices fail gates most often, across all runs
- Add gate quality scoring (not just pass/fail, but *how* it passed)
- Surface gate failures as a first-class signal in the dashboard

### 3.5 Per-task model selection

True fleet orchestration picks the right model for each step (cheap fast model for boilerplate, flagship for hard reasoning, specialized model for security review). The "best tool for the job" claim only holds at the task level. Vendors who only offer chat-level model picking are answering a different question.

**Deepening moves:**
- Surface per-slice model decisions in cost reports
- Build "model recommendation" based on slice complexity scoring (some of this exists in the complexity-threshold work)
- Document the model routing logic publicly

### 3.6 Drift and regression eval as gates, not reports

Eval that runs at every commit and blocks progression on regression vs. eval that runs nightly and produces a dashboard. Both are useful; only one prevents bad merges in an autonomous fleet.

**Deepening moves:**
- Document the gate model vs. report model distinction publicly
- Show real numbers: how many regressions caught at the gate boundary in dogfood runs
- Build a "regression caught" counter as a first-class dashboard metric

### 3.7 Cost attribution to plan, slice, and engineer

Aggregate token spend isn't actionable. "Engineer X's plan Y cost $340 in step 4 because the model retried 6 times" is. Plan Forge has this granularity today.

**Deepening moves:**
- Build the per-engineer cost rollup view
- Add cost anomaly detection (already in patterns work) as a first-class alert
- Show cost-per-merged-PR as a fleet KPI

### 3.8 Memory architecture for cross-session continuity

N teams running multi-week initiatives means agents need to remember decisions, conventions, and prior work across sessions. Plan Forge has memory tiers (user / session / repo) and OpenBrain integration.

**Deepening moves:**
- Document the memory architecture as a public design doc (some of this exists at `docs/MEMORY-ARCHITECTURE.md`)
- Show recall in action: "the agent remembered the convention from week 3"
- Build a cross-session memory health metric

### 3.9 Open source and dogfooded

The project documents itself by dispatching to Copilot Coding Agent against itself. The chapter at `planforge.software/manual/plan-forge-on-the-github-stack.html` shows the dollar cost of every section. This is a uniquely strong trust signal.

**Deepening moves:**
- Make the dogfood story more visible on the landing page
- Publish a public "this month in dogfood" log: what we shipped, what it cost, what failed
- Maintain a public KPI: percentage of repo lines authored by Plan Forge vs. humans

---

## Section 4 — Work plan (1–4 weeks)

### Week 1 (May 6–12) — Documentation and surface

Highest ROI, lowest cost. A senior enterprise engineer reading the docs is asking "can this run in my environment, against my compliance, with my teams." Answer those questions explicitly.

- [x] **Reference architecture diagram** for a 5-team fleet deployment — shipped as Appendix K [`enterprise-reference-architecture.html`](../manual/enterprise-reference-architecture.html) with both generic and Microsoft Foundry composition variants (PR #158, commit `f72665c`)
- [x] **Agent Factory recipe** page showing how to onboard 12 squad members on Day 1 — shipped as Appendix L [`agent-factory-recipe.html`](../manual/agent-factory-recipe.html) (PR #158)
- [x] **Day 1 / Week 4 / Week 12 operator playbook** — shipped as Appendix M [`fleet-operator-playbook.html`](../manual/fleet-operator-playbook.html) (PR #158)
- [x] **Compliance / data-residency** page — shipped as Appendix N [`compliance-and-data-residency.html`](../manual/compliance-and-data-residency.html) with collapsible Q&A and Azure Government coverage (PR #158)
- [x] **Enterprise deployment** landing page — shipped as Appendix I [`enterprise-deployment.html`](../manual/enterprise-deployment.html) (PR #158)
- [x] **GitHub stack alignment** — shipped as Appendix J [`github-stack-alignment.html`](../manual/github-stack-alignment.html) (companion to existing Appendix H, which is the deeper integration tour) (PR #158)
- [x] **Bonus** — 7 hero images via Grok Aurora for all enterprise appendices (back-fills H + new I–N) (PR #158)
- [x] **Bonus** — Phase-MANUAL-EVIDENCE Phase 1: A/B test evidence diagram, evolution timeline, lessons-learned chapter, project-history chapter (PR #160, commit `ee378e3`)

### Week 2 (May 13–19) — Telemetry and observability formalization

We likely have most of the data already. Surface it as a real audit + observability story.

- [ ] **OpenTelemetry exporter** — convert `telemetry.mjs` events to OTel spans, document the span schema
- [ ] **Audit log spec** — one-page document defining event types, fields, format, export mechanism
- [ ] **Sample dashboards** committed to repo: Splunk, Datadog, Grafana
- [ ] **Audit log export CLI** — `pforge audit export --since <date> --format <json|csv>`

### Week 3 (May 20–26) — Auth and RBAC scaffolding

Probably can't ship full Entra ID SSO in one week, but we can lay the foundation.

- [ ] **Auth model** documentation — describe how Plan Forge thinks about identity today and the planned model
- [ ] **SSO extension point** — clear interface for plugging in SSO providers
- [ ] **Config-driven RBAC scaffold** — roles, permissions, who can do what (enforcement basic; structure right)
- [ ] **BYO Azure OpenAI** first-class config + documentation page

### Week 4 (May 27–June 2) — Polish and the "Plan Forge for Enterprise" story

One landing page on `planforge.software` that maps every enterprise concern to where in the docs it's answered. A senior eval engineer is going to skim, not read. Give them a map.

- [ ] **`/enterprise` landing page** on planforge.software
- [ ] **One-page PDF brief** suitable for sharing with technical decision-makers (no sales fluff, just architecture)
- [ ] **Public KPI / dogfood dashboard** — surface the dogfood numbers as a trust signal
- [ ] **"Why Plan Forge" comparison page** — feature-level comparison to competitive set, no name-calling, just facts

---

## Section 5 — What NOT to do

Discipline notes. Resist these temptations.

- **Don't try to compete with Cursor on IDE polish.** Their strength is the developer surface; ours is the orchestration surface. Don't muddy the lanes.
- **Don't add features just to have them.** This is a sharpening pass, not a broadening pass. If anything, we should *cut* surface area in messaging.
- **Don't position against any specific competitor by name in docs.** Customers respect tools that don't trash competitors. Show the architecture; let the comparison speak for itself.
- **Don't change positioning to chase any specific customer.** Whatever we ship in this window must make Plan Forge better for *any* enterprise. If a feature only makes sense for one named account, we're optimizing for the wrong thing.
- **Don't commit to support SLAs or commercial offerings prematurely.** Plan Forge stays open source. The enterprise readiness work is about being *deployable*, not about becoming a vendor.

---

## Section 6 — Open research questions

Things we should investigate this week alongside the documentation work.

- [ ] What does Cursor Background Agents *actually* ship today vs. roadmap? Read their docs cold, run the demo if possible.
- [ ] How does Sourcegraph's enterprise tier handle multi-team batch changes? What's the operator persona look like in their world?
- [ ] What's the OpenHands trajectory format, and is there anything to learn from it for ours?
- [ ] Which OTel conventions exist for AI/LLM workloads (semantic conventions for `gen_ai.*` spans)? Align early.
- [ ] What does GitHub Copilot Coding Agent deliberately leave to the ecosystem? That's the surface area Plan Forge should own without ambiguity.
- [ ] What does the Microsoft Foundry / Azure AI Foundry deployment story look like for a customer who wants to run agents in their own tenant? Where does Plan Forge fit on top?

---

## Section 7 — Strategic notes (private)

This document lives in the public repo because the work it describes is generic product hardening. A few strategic notes worth holding privately, not for inclusion in any user-facing doc:

1. **Microsoft alignment.** Plan Forge's GitHub-native + AGENTS.md + MCP-first architecture is unusually well-aligned with where Microsoft is investing. Strengthening the enterprise readiness story makes the project more useful as a reference artifact for Microsoft sellers and FDEs working AI-SDLC opportunities, even if it's never an official commitment.
2. **The Microsoft gap.** As of May 2026, Microsoft does not have a first-party autonomous fleet-orchestration product on top of Copilot Enterprise. The combination of Coding Agent + AGENTS.md + MCP + GHAS + Actions is a substrate, not a fleet product. That gap is real and is exactly the space large enterprises are trying to fill. Plan Forge sits cleanly in that gap *without competing with anything Microsoft ships*.
3. **Recognition surface area.** A single senior Microsoft technical leader recognizing this work could meaningfully change its trajectory. The work itself has to stand on its own merits — generic enterprise hardening, deepened differentiated strengths, dogfooded transparency. Don't optimize for the recognition; optimize for the artifact, and the recognition becomes possible.
4. **Account-level discipline.** Any work on this document is generic Plan Forge product work. It is not driven by, scoped to, or referenced against any specific customer. Commits, plan files, and roadmap entries should look like ordinary product evolution. This protects the project's credibility and the author's lane.

---

---

## Section 8 — Research Findings (2026-05-06, parallel agents)

Six parallel research agents were dispatched on 2026-05-06 to harden the assumptions in Sections 1–4. Findings below. Source reports are detailed; the synthesis here is what changes our position.

### 8.1 Plan Forge codebase audit (what we actually have today)

The capability table in Section 2 was largely correct, but the audit upgraded the maturity rating on several lines. Documented updates:

- **Audit logging** — already **production**: OTLP-compatible `trace.json` per run with span kinds, severity levels, events, plus `.forge/telemetry/tool-calls.jsonl` and `.forge/liveguard-events.jsonl`. ~30 typed event categories documented in [pforge-mcp/EVENTS.md](pforge-mcp/EVENTS.md). Gap is **export**, not the data.
- **Trajectory capture** — production. Per-run artifacts in `.forge/runs/<id>/` (`events.log`, `slice-N.json`, `summary.json`, `trace.json`, `cost-history.json`). Copilot Coding Agent trajectories in `.forge/trajectories/<plan-slug>.jsonl`. Replayable via dashboard timeline. Gap is **external schema documentation** and **export-to-tool path**.
- **Per-slice quality gates** — production with portability linting (W1–W4 anti-patterns) and reflexion retry context. Strict mode env-flag exists. Minimal real gaps.
- **Scope contracts** — declared in plans, validated post-hoc via `pforge diff`, gated at runtime in orchestrator. Real gap: **enforcement is best-effort, not a hard runtime block**. Worker prompt warns; the orchestrator can't *prevent* a bad edit, only detect it.
- **Cost attribution** — `.forge/cost-history.json` per run, per model. `forge_cost_report` MCP tool. Self-calibrating pricing table. Gaps: **no per-engineer attribution**, **no per-engineer budget controls**, **no anomaly enforcement** (drift detection exists but not spend-threshold blocking).
- **Memory architecture** — three-tier (L1 hub / L2 files / L3 OpenBrain) is production for L1/L2, partial for L3 (OpenBrain optional). Documented at [docs/MEMORY-ARCHITECTURE.md](docs/MEMORY-ARCHITECTURE.md).
- **Multi-tenancy** — worktree-manager handles concurrent slice attempts within one project; **no cross-project tenant model**. Hub memory volatile per process. L3 OpenBrain is cross-project by design (potential bleed if not scoped).
- **On-prem / air-gapped** — partial: orchestrator runs locally, only the LLM call needs egress. Update check has 24h cache and silent offline behavior. Gap: **OpenBrain L3 requires HTTP**; no documented BYO-model-endpoint path; no proxy/firewall guidance.
- **Auth** — bearer token only (`bridge.approvalSecret`). No OAuth, SAML, SCIM, Entra ID. Confirmed enterprise blocker.
- **Azure OpenAI** — not first-class. `KNOWN_SECRETS` lacks `AZURE_OPENAI_API_KEY` and endpoint URL. Multi-provider routing exists (`githubCopilot → anthropic → openai → xai`).
- **Compliance / data residency** — partial. `PreDeploy` hook runs secret scan + env diff. Audit mode configurable. Secret redaction in testbed findings. No formal residency controls or encryption-at-rest config.
- **Fleet dashboard** — single-project only. Roadmap lists "Team Mode" as v3.1.

**Bottom line from audit**: Plan Forge is production-ready for single-team, GitHub-native development. Critical gaps for enterprise fleet: **auth, RBAC, multi-tenancy, observability export**. Strongest differentiators (worth deepening): **scope contracts, trajectory capture, per-slice gates, cost attribution, three-tier memory**. The compliance reviewer agent (`.github/agents/compliance-reviewer.agent.md`) and project-profile prompt's compliance frameworks (SOC2, HIPAA, PCI-DSS, GDPR, FedRAMP) are useful starting points for the formalization work.

### 8.2 Cursor Cloud Agents (formerly Background Agents) + Bugbot

Renamed to **Cloud Agents** in Cursor 3 (April 2026). Key facts that change our positioning:

- **Architecture is per-user fan-out, not multi-team coordination.** "Run as many agents as you want in parallel" + `/multitask` for sub-agent decomposition within a single user request. **No first-class concept of N teams running M agents with cross-team visibility.** Coordination happens via Slack notifications and PR comments.
- **GitHub-first, GitLab supported, Bitbucket roadmap, Azure DevOps not in public docs.** SDK error enums hint at AzDO plumbing but no docs back it up.
- **All Cloud Agents forced into Max Mode** — no toggle. Significantly amplifies cost vs. cheaper editor modes.
- **No first-class plan-as-contract.** Hooks are reactive per-event. Rules are explicitly *suggestions, not guarantees* in their own docs. Multi-step adherence to a feature spec is left to the LLM.
- **No multi-model quorum.** Single-agent-per-run.
- **No deterministic per-task cost API.** v1 Cloud Agents API exposes `durationMs` and token counts via stream events but no `costUsd` per run. Chargeback granularity tops out at Billing Groups.
- **Audit logs explicitly exclude prompts and generated code.** From their compliance docs: *"We do not log agent responses or generated code content."* Customers needing AI-action evidence for SOC2/PCI must build it themselves via hooks (which are *fail-open by default* unless `failClosed: true` is set).
- **No air-gapped option.** Self-Hosted Pool lets *workers* run in your environment, but the orchestrator, model inference, and dashboard remain in Cursor's AWS. Industries that cannot allow source code to leave their network cannot deploy Cursor.
- **Bugbot has a hard 200 PRs/license/month cap.** Overage requires emailing the help center.
- **Pricing**: Pro $20, Pro+ $60, Ultra $200, Teams $40, Enterprise custom. Bugbot $40/seat add-on. Cloud Agents charged at API model pricing on top of seat.

**Strongest Cursor moats**: editor UX, multitask + multi-root agent surface, Bugbot adoption (Stripe, Sentry, Discord, Rippling logos), MDM/SSO/SCIM plumbing, signed commits, SDK + REST API. Those are formidable. The architectural gaps above are real and not closing in their changelog as of May 6, 2026.

**Plan Forge differentiation**: plan-as-contract, multi-model quorum per slice, air-gappable architecture, GitHub-native AI-SDLC orchestration tied to PR/plan/slice/status checks, per-slice cost attribution as a tool-callable API.

### 8.3 Sourcegraph (Cody, Amp, Batch Changes)

Sourcegraph repositioned in **7.0 (Feb 2026)** as the *"intelligence layer for AI coding agents and developers."* Cody is being de-emphasized; Cody Web was deprecated in 7.0. Agent story moves to (a) Amp, and (b) Sourcegraph as a context provider to third-party agents (Claude Code, Cursor, Codex, Amp) via MCP.

- **Amp** (terminal-first agent, ampcode.com): three modes (`smart` Opus 4.7, `rush`, `deep` GPT-5.5), subagents via Task tool (isolated, can't communicate), Oracle (GPT-5.4 second-opinion), AGENTS.md as convention, Skills via `.agents/skills/`, streaming JSON I/O.
- **Amp has NO self-hosted, NO BYOK.** From their security docs: *"Amp Server is a multi-tenant cloud service... Amp doesn't support Bring Your Own Key or self-hosted deployments."* Hard architectural limit. Air-gapped, FedRAMP, sovereign-cloud customers blocked.
- **Subagents cannot communicate.** Documented limitation — they "work in isolation, can't communicate with each other, you can't guide them mid-task."
- **No fleet operator console.** Each Amp workspace is a silo. No cross-workspace aggregation.
- **Application audit logs are NOT exposed in admin UI** — only provided on request during audits/incidents. No real-time SIEM streaming as a documented pattern.
- **Batch Changes and Amp are NOT unified.** The legacy automation product (Batch Changes — deterministic command runner over search query) and the agent product (Amp) are separate. **Agent-authored, batch-controller-managed multi-repo PR fleet does not exist as a product.** This is a real differentiation surface.
- **Pricing**: Sourcegraph Enterprise starts at **$16K/year**. Amp passes through LLM costs at zero markup for individual/team; **+50% markup for Enterprise**, plus $1,000 onboarding credit. SSO, SCIM, ZDR, MCP allowlists are Enterprise-only.

**Plan Forge differentiation vs. Amp**: plan-driven multi-slice execution, persistent multi-session orchestration, self-hosted/local-first by default, fleet operator visibility, OTel export of agent traces, agent-as-batch-driver unified workflow.

### 8.4 GitHub Copilot Cloud Agent (formerly Coding Agent)

**Renamed Coding Agent → Cloud Agent (CCA) on April 1, 2026.** This is the most important section for Plan Forge positioning because GitHub explicitly defines what they leave to the ecosystem.

What ships today:
- Ephemeral Actions-powered runner, **single repo / single branch / single PR per task** (explicit limitation in docs).
- Three new modes (April 1, 2026): **research-only**, **plan-only** (one-shot, session-scoped), **branch-only**.
- Customization: `.github/copilot-instructions.md`, `.github/instructions/*`, `.github/agents/`, `.github/hooks/`, `.github/skills/`, MCP servers.
- **Copilot SDK in public preview (April 2, 2026)** — exposes "the same production-tested agent runtime that powers GitHub Copilot cloud agent and Copilot CLI." This is the single most important signal: **GitHub is explicitly stating that orchestration belongs to the application layer, not to GitHub.**

What GitHub deliberately leaves to the ecosystem (the Plan Forge lane, with direct doc evidence):

| Gap | Evidence |
|---|---|
| Hardened plan as versioned artifact with scope contract, slices, validation gates, drift detection | Plan-mode is session-scoped one-shot; no plan file format, no scope contract |
| Cross-repo / multi-service orchestration | Explicit single-repo limitation in docs |
| Multi-model quorum / consensus | No built-in mechanism, single model per session |
| Plan execution harness with per-slice gates and resume-from semantics | `copilot-setup-steps.yml` is one pre-flight hook; nothing slice-aware |
| Semantic eval harness (test pass rate, regression rate, plan-adherence) | Metrics API explicitly does not measure quality (only adoption/throughput) |
| Cost prediction per task / per plan | Only post-hoc Actions + premium-request totals |
| Live programmatic watch of in-flight agent | Session UI is in-product only; no public stream |
| Cross-org / cross-team fleet console with queue, capacity, SLA visibility | Only per-issue / per-project session UI |
| Pre-merge plan-adherence gates | No first-party concept |
| AGENTS.md, Agent Skills, MCP | All explicitly **open standards under Linux Foundation**, GitHub adopts but does not own |

**Critical insight**: AGENTS.md is stewarded by the Agentic AI Foundation under the Linux Foundation. Agent Skills repo is `agentskills/agentskills` (Apache 2.0, maintained by Anthropic). MCP is a Linux Foundation project. **GitHub's stated extensibility model is: wrap your tool/data source as an MCP server, layer your customization via the open file standards, and build your orchestration on top of the SDK.** That is exactly the Plan Forge architecture.

The Copilot Metrics API surfaces adoption + flow metrics (`total_active_users`, PRs created, PRs merged, `used_copilot_cloud_agent`, median time to merge) but **deliberately does NOT measure**: semantic correctness, test pass rate of CCA-authored PRs, regression rate, revert rate, code-quality deltas, plan-adherence, scope-drift, per-task cost, time-to-green, decision-rationale quality. **This is the largest unmonetized surface area in the CCA story.**

### 8.5 OpenHands and SWE-agent (patterns to borrow)

| Project | Stars | Status |
|---|---|---|
| OpenHands (formerly OpenDevin) | 72.7k | Active, v1.7.0 (May 2026), MIT |
| SWE-agent (Princeton) | 19.1k | Maintenance-only, superseded by mini-SWE-agent (65% SWE-bench Verified in 100 LOC) |

OpenHands has become the production-grade reference implementation. Five patterns directly worth importing or auditing in Plan Forge:

1. **Typed event log with explicit `source` vs LLM `role` separation.** OpenHands' immutable Pydantic `Event` schema distinguishes attribution (`source`: user/agent/environment) from formatting (LLM `role`). Prevents agents from being misled by synthetic framework messages. Plan Forge's `.forge/runs/` events should be audited for this separation.
2. **`security_risk` field on every action event.** OpenHands tags every `ActionEvent` with a per-action security risk that drives confirmation policy. Plan Forge has `forge_secret_scan` and `PreDeploy` but no per-action risk threading.
3. **Two-level cost model**: per-LLM `Metrics` plus per-conversation `ConversationStats` keyed by `usage_id` (e.g., `agent`, `condenser`, `critic`). Includes **cache_read_tokens, cache_write_tokens, reasoning_tokens** — without these, cost reports are wrong by 30–80% on Anthropic + OpenAI models. Already noted in `/memories/repo/v2.83.0-quorum-cost-fix.md`. Plan Forge `cost-service.mjs` should be re-audited against this list.
4. **`DelegateTool` with `spawn` + `delegate(dict)` + parallel threads + consolidated observation.** Clean fan-out/fan-in primitive worth borrowing for slice-level parallelism where slices are independent.
5. **Stuck Detector** (in-loop) — detects agents looping or making no progress; auto-timeout. Plan Forge has post-hoc `forge_watch` and `forge_alert_triage`; an in-loop detector during slice execution would prevent cost runaway.

**The SWE-agent ACI (Agent-Computer Interface) principle is the most important conceptual import.** Empirically validated rules:
1. Lint on edit, reject on syntax error
2. Bounded file viewer (100 lines) beats `cat`
3. Search returns *only* file paths (no per-line context)
4. Empty output is hostile — replace with a friendly message

The lesson: **deliberately constrain what the agent sees to what it can use well.** Every Plan Forge tool surface is an ACI choice. Worth re-reading every tool definition through this lens.

**SWE-bench Verified leaderboard top (Feb 2026)**: Claude Opus 4.5 76.80% / $0.75 per instance, Gemini 3 Flash 75.80% / $0.36, MiniMax M2.5 75.80% / $0.07. Cost-per-task is published right next to accuracy as the industry norm for serious agent eval. Plan Forge could eventually publish a "plan success rate × cost per plan" benchmark — there is no academic equivalent today, which is itself an opportunity.

### 8.6 OpenTelemetry GenAI conventions — implementation spec

`gen_ai.*` conventions are still **experimental ("Development")** but rich enough to cover everything Plan Forge tracks. The repo just moved (PR #3696) to a dedicated [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai). Migration mechanism: `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`.

**Critical gap to be aware of**: there is **no `gen_ai.cost` attribute** in the spec. Cost must be derived locally from `usage.*_tokens × price table` and stamped under a vendor namespace (recommend `pforge.cost.usd`).

**No upstream `@opentelemetry/instrumentation-openai`** in `opentelemetry-js-contrib`. Community options are Traceloop OpenLLMetry-JS and Arize OpenInference (both Apache 2.0, both diverge slightly from upstream). Microsoft ships `@azure/opentelemetry-instrumentation-azure-sdk` first-party for Azure OpenAI calls.

#### Implementation spec for Plan Forge (drop-in for Week 2)

**Resource attributes (set once)**:
```
service.name      = "pforge-mcp"
service.version   = <pforge version from VERSION>
service.namespace = "plan-forge"
```

**Span: every LLM call** (CLIENT)
```
name: "{operation} {model}"   e.g. "chat claude-sonnet-4.6"
gen_ai.operation.name      = "chat" | "embeddings" | ...
gen_ai.provider.name       = "anthropic" | "openai" | "x_ai" | "azure.ai.openai" | ...
gen_ai.request.model       = "claude-sonnet-4.6"
gen_ai.response.model      = (from response)
gen_ai.usage.input_tokens  = (includes cache reads)
gen_ai.usage.output_tokens
gen_ai.usage.reasoning.output_tokens         (when applicable)
gen_ai.usage.cache_read.input_tokens         (subset of input)
gen_ai.usage.cache_creation.input_tokens     (subset of input)
gen_ai.response.id, finish_reasons
pforge.cost.usd            (computed locally — no spec attribute)
pforge.slice.number, pforge.run.id           (correlation)
error.type                 (when failed)
```

**Span: every tool call (including MCP)** (INTERNAL)
```
name: "execute_tool {tool_name}"
gen_ai.operation.name = "execute_tool"
gen_ai.tool.name      = "forge_run_plan"
gen_ai.tool.type      = "function"
gen_ai.tool.call.id   = (correlates to tool_call in messages)
pforge.run.id, pforge.slice.number
```

**Span: each slice** (INTERNAL)
```
name: "invoke_agent slice-{n}"
gen_ai.operation.name = "invoke_agent"
gen_ai.agent.name     = "slice-3"
gen_ai.agent.version  = (plan commit sha)
pforge.plan.name      = "Phase-28.2"
pforge.slice.number   = "3"
pforge.run.id         = (uuid)
```

**Span: each plan run** (INTERNAL)
```
name: "invoke_workflow {plan-name}"
gen_ai.operation.name  = "invoke_workflow"
gen_ai.workflow.name   = "Phase-28.2"
pforge.plan.path       = "docs/plans/Phase-28.2-PLAN.md"
pforge.plan.commit_sha = ...
pforge.quorum.mode     = "auto" | "power" | "speed" | "false"
pforge.quorum.threshold = 6
pforge.run.id          = (uuid)
```

**Span: validation gate** (INTERNAL, no `gen_ai.*`)
```
name: "pforge.gate {gate_name}"
pforge.gate.name      = "tests-pass"
pforge.gate.result    = "pass" | "fail" | "blocked"
pforge.slice.number, pforge.run.id
```

**Metrics (required + recommended)**
- `gen_ai.client.operation.duration` (histogram, s) — every LLM call. Required.
- `gen_ai.client.token.usage` (histogram, `{token}`) — one observation per token type per call.

**Events (opt-in)**
- `gen_ai.client.inference.operation.details` — gated by `pforge.telemetry.captureContent` config flag (default false; PII implications)
- `gen_ai.evaluation.result` — for `forge_analyze` / quorum synthesis scores

**Practical Node.js stack**:
```
@opentelemetry/api
@opentelemetry/sdk-node
@opentelemetry/exporter-trace-otlp-http   (or grpc)
@opentelemetry/exporter-metrics-otlp-http
@opentelemetry/exporter-logs-otlp-http
@opentelemetry/instrumentation-http       (free transport spans)
@opentelemetry/instrumentation-undici     (free fetch spans, pforge-mcp uses node fetch)
+ hand-rolled gen_ai.* span emission in cost-service.mjs / orchestrator.mjs
```

Adoption strategy: **wrap and emit, don't refactor**. Initialize the SDK only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (graceful no-op otherwise). Existing internal hub events stay; OTel becomes a second sink.

---

## Section 9 — Updated work plan (post-research)

Findings revise the Week 1–4 plan as follows.

### Week 1 — Documentation (unchanged priorities, sharpened content)

The six docs identified earlier are still the highest-ROI work, but the research lets us be specific in each:

- **Reference architecture** — explicitly contrast against Cursor's "self-hosted workers, hosted control plane" and Amp's "cloud-only, no self-host." Plan Forge's local-first orchestrator is a real architectural difference, not marketing.
- **Agent Factory recipe** — show how AGENTS.md + GitHub Cloud Agent + Plan Forge plan files compose. Cite Linux Foundation governance of AGENTS.md and MCP. Makes the GitHub-native consolidation thesis concrete.
- **Day 1 / Week 4 / Week 12 operator playbook** — frame around what GitHub deliberately leaves to the ecosystem (the table in §8.4). Each stage shows which Plan Forge capability fills which CCA gap.
- **Compliance / data-residency** — explicitly position against Cursor's "audit logs exclude prompts and generated code" and Amp's "audit logs only on request" gaps. Plan Forge's local-first + hub event log + L2 file artifacts is a stronger compliance story than either, *if formalized*.
- **Enterprise deployment landing** — map of where every concern is answered.
- **GitHub stack alignment** — promote `plan-forge-on-the-github-stack.html`. Add the "every Plan Forge capability → which GitHub primitive it consumes" mapping table.

### Week 2 — Telemetry/observability formalization (now has a spec)

Use §8.6 as the implementation spec.

- [ ] Add OTel SDK + exporters as optional deps, init only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
- [ ] Wrap `cost-service.mjs` to emit `gen_ai.usage.*_tokens` + `pforge.cost.usd`
- [ ] Wrap orchestrator slice execution as `invoke_agent` spans
- [ ] Wrap `forge_run_plan` as `invoke_workflow` span
- [ ] Wrap MCP tool dispatch (`pforge-mcp/server.mjs`) as `execute_tool` spans
- [ ] Emit `gen_ai.client.operation.duration` and `gen_ai.client.token.usage` histograms
- [ ] Document the published `gen_ai.*` + `pforge.*` schema as a public spec page
- [ ] Verify `cost-service.mjs` correctly accounts for `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens` (per OpenHands two-level model — without these, costs are wrong by 30–80%)
- [ ] Audit log spec — formalize what's logged, where, in what format, how to export
- [ ] `pforge audit export --since <date> --format <json|csv>` CLI

### Week 3 — Auth and RBAC scaffolding (unchanged)

No research input changes the priorities here. Plus:

- [ ] BYO Azure OpenAI first-class config (add `AZURE_OPENAI_API_KEY` and endpoint URL to `KNOWN_SECRETS`, document as primary path for Microsoft-shop enterprises)

### Week 4 — Polish + sharpening (expanded)

Three new items based on research:

- [ ] **Audit `.forge/runs/` event schema** for OpenHands-style explicit `source` vs LLM `role` separation. Document the schema publicly with versioning.
- [ ] **Add a `security_risk` field to `ActionEvent`-equivalent records** in trajectory capture (per OpenHands pattern). Drives future confirmation policy work.
- [x] **Re-read every Plan Forge tool definition through the SWE-agent ACI lens**: bounded views, sparse results, friendly empty-output messages. Especially `forge_capabilities`, `forge_run_plan`, `forge_plan_status`, `forge_home_snapshot`. ACI tuning is one of the highest-ROI quality improvements possible without adding features. _Done 2026-05-07: Phase-ACI-HARDENING shipped the §13 top-5 fixes — `forge_home_snapshot` drill + activity cursor pagination, `forge_search` / `forge_timeline` friendly empty messages, `forge_watch_live` lite event projection, `forge_sweep` empty-result message, plus tool-surface temper guards in `architecture-principles.instructions.md`._

### Backlog (post-Week 4, surfaced by research)

- **`DelegateTool`-style fan-out for parallel independent slices** (OpenHands pattern). Plan Forge runs sequential slices today; parallelism in the scheduler exists for `[P]`-tagged but not as a clean delegation primitive.
- **In-loop Stuck Detector** during slice execution (OpenHands pattern). Prevents cost runaway when an agent loops.
- **Critic / inline LLM evaluator** (OpenHands pattern, complementary to quorum). Cheaper than full quorum, runs per step.
- **Agent-as-batch-driver workflow** (the Sourcegraph gap — Batch Changes + Amp not unified). Plan Forge could productize the agent-authored, plan-controlled, multi-repo PR fleet pattern as a unified workflow.
- **Public Plan Forge benchmark**: "plan success rate × cost per plan" — there is no academic equivalent (SWE-bench is single-issue, single-shot). First mover here defines the category.

---

## Section 10 — Sharpened positioning (post-research)

What we now know with confidence about the competitive surface:

| Axis | Cursor | Sourcegraph Amp | GitHub CCA | OpenHands | **Plan Forge** |
|---|---|---|---|---|---|
| Plan as contract | No | No (prompting only) | Session-scoped, not artifact | No | **Yes — first-class artifact** |
| Multi-model quorum per slice | No | No | No | No | **Yes — `auto/power/speed`** |
| Per-slice validation gates | Hooks per tool call | No | `copilot-setup-steps.yml` (pre-flight only) | Confirmation policy | **Yes — slice-level gates** |
| Air-gapped / self-hosted control plane | Workers only, control plane in AWS | **Not supported** | Cloud-hosted runner | Yes (K8s self-host) | **Yes — local-first by design** |
| Trajectory capture + replay | Per-run streams, opaque format | Threads on ampcode.com | Session UI in-product | **Best-in-class** Pydantic events | Production, schema not yet public |
| Per-task cost API | Dashboard only, no per-run `costUsd` | Per-thread, no first-party SDK | Premium-request totals only | **Two-level** `usage_id` keyed | Production, gap on per-engineer |
| Cross-team fleet console | Per-user only | Per-workspace silo | Per-issue / per-project | Single-user focus | **Not yet — biggest open opportunity** |
| Audit log includes AI actions | **No** (excludes prompts + code) | Application logs only on request | Standard GH audit | Yes (immutable events) | Yes (need to formalize as compliance pattern) |
| GitHub-native architecture | GitHub app | Code-host-agnostic | Native | Code-host-agnostic | **Native by design** |
| Open standards (AGENTS.md, MCP, Skills) | Adopts AGENTS.md, MCP | Adopts AGENTS.md | Adopts all three | Adopts MCP | **Adopts all three; ships own MCP server** |

**The two strongest defensible positions** for Plan Forge after this research:

1. **GitHub-native AI-SDLC orchestration on top of the open standards GitHub explicitly leaves to the ecosystem.** Cursor and Amp are platform-agnostic; OpenHands is too. Plan Forge is the only project in this comparison set built specifically to extend GitHub's primitives in the direction GitHub itself has signaled (via the Copilot SDK preview and AGENTS.md/Skills/MCP adoption) is the ecosystem's lane.
2. **Local-first / air-gappable control plane.** Cursor cannot offer this. Amp explicitly cannot offer this. CCA runs on GitHub-hosted infrastructure. Only OpenHands-self-hosted comes close, and OpenHands is single-user-focused. **For regulated industries — defense, sovereign cloud, financial, healthcare — Plan Forge is structurally the only viable option in this comparison set.** This is worth saying clearly in the Enterprise Deployment doc.

The next research thread worth pursuing: **how does the Microsoft Foundry / Azure AI Foundry deployment story compose with Plan Forge?** That's an open §6 question and remains open after this batch.

---

---

## Section 11 — Microsoft Foundry composition (2026-05-06, parallel agent)

This is the highest-strategic-value section in the document. **Microsoft does not ship a Plan Forge–shaped product.** GitHub Copilot Cloud Agent is the closest, and is explicitly limited to single-repo, single-PR-per-task. The natural composition vectors with Foundry (Responses API, MCP/Toolboxes, OpenTelemetry) are all open standards Microsoft is actively standardizing on, and Plan Forge already speaks them.

### 11.1 Foundry today (May 2026) — what it actually is

Microsoft completed a major rebrand and consolidation between late 2025 and Q1 2026. "Microsoft Foundry" is now the umbrella brand. The five distinct surfaces:

| Surface | What it is | Status (May 2026) |
|---|---|---|
| **Microsoft Foundry (platform)** | Unified Azure resource provider, project model, RBAC, networking, model catalog (1,900+ models from MS, OpenAI, Anthropic, Mistral, xAI, Meta, DeepSeek, Hugging Face), portal at `ai.azure.com`, unified `azure-ai-projects` SDK 2.x | GA (consolidated brand) |
| **Foundry Agent Service** | Hosted agent runtime built on the OpenAI **Responses API**. Three agent types: prompt agents, workflow agents (preview), hosted agents (containerized BYO code, preview). Built-in tracing, evaluations, MCP, content safety, Entra agent identities | **GA (Mar 2026)** for prompt agents; workflow + hosted in preview |
| **Azure OpenAI in Foundry** | OpenAI model API surface (GPT-5.5, GPT-5.4 series, GPT-5.3-codex, o-series, GPT-image, Sora-2). Reachable via legacy `?api-version=...` route or new stable `/openai/v1/` route | GA, monthly model cadence |
| **Microsoft Foundry Local** | Cross-platform on-device runtime (Win/macOS Apple Silicon/Linux), ONNX Runtime + WinML/Metal, OpenAI-compatible API. Curated catalog: GPT-OSS, Qwen, Whisper, DeepSeek, Mistral, Phi | **GA (Mar 16, 2026)** for devices; "Foundry Local powered by Azure Local" (distributed customer infra) in preview |
| **Foundry Tools** (formerly Azure AI Services) | Vision, Speech, Translator, Document Intelligence, Content Moderator | GA (rebranded) |

**Architectural shift to remember**: Microsoft killed the old `Hub + AOAI + AI Services` resource model in favor of a single **Foundry resource** with **projects**. The Assistants API was replaced by the **Responses API**. Terminology moved from `Threads/Messages/Runs/Assistants` → `Conversations/Items/Responses/Agent Versions`. **The wire protocol Microsoft is standardizing on for agents is the OpenAI Responses API, not a Microsoft-proprietary contract.**

### 11.2 Foundry Agent Service — does it have plan/slice/gate concepts?

**No.** Workflow agents (preview) provide YAML/visual graph orchestration with sequential, branching, group-chat, human-in-the-loop, and approval steps — but this is an *agent orchestration graph*, not a software-delivery pipeline. There is no scope contract, no forbidden actions, no validation gate that must pass before the next slice, no completeness sweep against TODO/stub markers. Foundry has continuous evaluation (sampling production traffic) but evaluation ≠ gate enforcement against a hardened plan.

Multi-agent today is "agent A hands off to agent B" inside one project runtime, not "team Alpha's plan is on slice 3, team Bravo's plan is on slice 7, here's the org-wide cost roll-up."

### 11.3 Microsoft Agent Framework (MAF) — complement, not competitor

| Property | Value |
|---|---|
| Languages | Python (`pip install agent-framework`), .NET (`Microsoft.Agents.AI`), TypeScript present but small |
| Status | **v1.0 GA April 2026**, ~10.1k stars, 80+ releases |
| Origin | Successor to **Semantic Kernel + AutoGen** (same teams, both officially superseded with migration guides) |
| Capabilities | Single agents and workflows, multi-provider (Foundry/Anthropic/AOAI/OpenAI/Ollama/GitHub Copilot SDK), graph workflows, checkpointing, time-travel, human-in-the-loop, middleware, OpenTelemetry built-in, declarative YAML agents, agent skills |
| Position | The SDK; Foundry Agent Service is the hosted runtime. MAF agents deploy to Foundry hosted agents with "2 additional lines of code" |

**MAF sits one altitude *below* Plan Forge.** MAF builds individual agents and workflows. Plan Forge orchestrates the SDLC: specifies, plans, hardens, executes via worker LLM sessions, validates with gates, runs LiveGuard, tracks cost across runs, files self-repair bugs, feeds back into planning. Different products. **Plan Forge could internally use MAF to drive worker sessions in the future** — that's an implementation detail, not a competitive overlap.

Microsoft's positioning is explicit: MAF docs state *"If you can write a function to handle the task, do that instead of using an AI agent."* MAF is a **building block**, not a turnkey orchestration platform.

### 11.4 Microsoft's first-party AI-SDLC story (the gap analysis)

| Plan Forge capability | Microsoft offering | Gap vs Plan Forge |
|---|---|---|
| **Plan-driven autonomous engineering** | GitHub Copilot Cloud Agent (closest fit) | **GitHub-only repos. One branch, one PR per task. Cannot work across repos in one run.** No multi-slice plan with gates between slices. No scope contract / forbidden-action enforcement. No fleet view across N concurrent tasks across N teams. No cost attribution rollup across runs. No quorum-mode preflight. No 4-session model (specify → execute → review → ship). |
| **Fleet orchestration of agents across teams** | None | Foundry has agent observability (App Insights) and centralized AI asset management (cross-cloud agent inventory), but **no active-fleet execution status across teams**. |
| **Eval / quality scoring of AI-generated code** | Foundry Evaluations (GA Mar 2026) | Designed for AI agent output quality (coherence, relevance, groundedness, safety) — **not for AI-generated code quality**. No first-party "score this PR's architecture compliance, test coverage, scope-contract adherence" evaluator. Plan Forge `forge_analyze` and review-gate prompts fill this gap. |
| **Cost attribution per task** | Foundry App Insights at project level | **No first-party "cost per slice, per plan, per phase, per team" attribution.** |

### 11.5 Composition opportunities

#### A. Foundry as a first-class LLM provider in Plan Forge — **YES, high-value, low-effort**

The wire protocol is OpenAI-compatible. Implementation surface:
- New provider type: `microsoft-foundry`
- Config keys: `endpoint` (`https://{resource}.openai.azure.com/openai/v1/`), `deployment` (deployment name, **not** model family), `auth` (`api_key | entra | managed_identity`), `tenant_id`, `client_id`, `subscription_id`, `region`
- Model catalog mapping: Plan Forge quorum presets (`power`, `speed`) map to customer's Foundry deployments. Customer configures deployment names; Plan Forge stays vendor-neutral
- Cost computation: Foundry pricing varies by deployment type (Global Standard / Data Zone / Provisioned). `forge_estimate_quorum` already abstracts this; needs Foundry rate cards

**Auth flow** (Entra recommended):
```python
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://ai.azure.com/.default"
)
client = OpenAI(base_url="https://YOUR-RESOURCE.openai.azure.com/openai/v1/", api_key=token_provider)
```

#### B. Plan Forge consuming Foundry-hosted MCP servers — **YES, high-value, low-effort**

Foundry **Toolboxes** are explicitly MCP-compatible endpoints. A customer who curates their org's tools into a Foundry Toolbox can hand the Plan Forge MCP server config a `server_url` pointing at their Toolbox endpoint with a Bearer token from a Custom Keys connection. Plan Forge already supports MCP servers in `.vscode/mcp.json` — adding a Foundry Toolbox is a config change, not a code change.

**This is the strongest composition vector for Microsoft-shop enterprises**: "your org's curated, governed, audited tool surface — exposed once via Foundry Toolbox, consumed by Plan Forge agents in worker sessions and by Foundry agents in production."

Also catalog-shipped: **Azure DevOps MCP Server (preview)**, **GitHub MCP server** (third-party but heavily referenced), self-hosted MCP templates for Container Apps and Azure Functions with dedicated MCP subnet patterns.

#### C. Plan Forge exporting traces to Foundry observability — **YES, low-effort**

Plan Forge already plans OTel emission (Section 8.6). Setting the OTel exporter to Application Insights with the customer's Foundry-attached App Insights connection string means Plan Forge runs show up alongside Foundry agent runs in the same dashboards. No protocol translation needed — both sides use OTel `gen_ai.*` semantic conventions.

**Microsoft + Cisco Outshift jointly extended OTel with multi-agent observability semantic conventions** (`execute_task`, `agent_to_agent_interaction`, `agent.state.management`, `agent_planning`, `agent_orchestration`). Built into Foundry, MAF, LangChain, LangGraph, OpenAI Agents SDK. **A natural fit for Plan Forge's plan/slice/orchestrator semantics.**

#### D. Plan Forge sitting on top of Foundry Agent Service — **awkward, don't force it**

Foundry Agent Service is an agent runtime. Plan Forge is an SDLC orchestrator that spawns CLI workers. These don't compose vertically. You wouldn't want Plan Forge slices to execute as Foundry hosted agents (different lifetimes, different IO models — Plan Forge workers need filesystem/git/terminal access; Foundry Hosted Agents are containerized with VM-isolated sandboxes per session).

What does compose:
- Plan Forge calls Foundry Agent Service **as a tool** (Responses API call from inside a slice)
- Plan Forge generates code that **deploys to** Foundry Agent Service (a Plan Forge plan ships a feature that's an MAF agent → hosted on Foundry Agent Service). Natural extension of `deploy.instructions.md` and the skill system.

### 11.6 Reference architecture (Microsoft-shop customer)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CUSTOMER'S AZURE TENANT                          │
│                                                                         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌─────────────────┐    │
│  │  Plan Forge      │───▶│  Microsoft       │    │  Foundry Agent  │    │
│  │  (open source,   │    │  Foundry         │◀───│  Service        │    │
│  │   in customer    │    │  (model gateway) │    │  (production    │    │
│  │   repo / CI)     │    │                  │    │   agent runtime)│    │
│  └──────────────────┘    └──────────────────┘    └─────────────────┘    │
│         │                        │                       │              │
│         │                        ▼                       │              │
│         │                ┌──────────────────┐            │              │
│         └───────────────▶│ Foundry Toolbox  │◀───────────┘              │
│                          │ (MCP endpoint)   │                           │
│                          └──────────────────┘                           │
│                                  │                                      │
│         ┌────────────────────────┼────────────────────────┐             │
│         ▼                        ▼                        ▼             │
│  ┌─────────────┐         ┌─────────────┐          ┌─────────────┐       │
│  │ App Insights│         │ Entra ID    │          │ Private VNet│       │
│  │ (OTel sink) │         │ (auth)      │          │ (isolation) │       │
│  └─────────────┘         └─────────────┘          └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Plan Forge sits *above* Foundry as the SDLC orchestrator. Foundry sits *below* as the model gateway and production agent runtime. They share Foundry Toolbox for tools and App Insights for telemetry. Plan Forge is not inside Foundry, not beside Foundry as a peer agent product, but above Foundry as the higher-altitude orchestration layer.**

### 11.7 Strategic positioning line

> **"Plan Forge is the open-source AI-SDLC orchestrator for teams whose models, agents, and tools live in Microsoft Foundry."**

This is defensible because Microsoft demonstrably does not ship a Plan Forge–shaped product, and the natural composition surfaces (Responses API, MCP/Toolboxes, OTel) are all open standards Microsoft is actively standardizing on.

### 11.8 Honest friction points

1. **Quorum across providers** — Same model can be reached via OpenAI direct, AOAI direct, or Foundry. Cost estimator needs to deduplicate or the customer will be confused why Plan Forge says quorum costs $X but Azure invoice says $Y.
2. **Deployment-name vs model-name** — Every Plan Forge UI/CLI/config that says "model" needs reworking when provider is Foundry. Customer says "I'm using gpt-5.4-mini"; Plan Forge needs the deployment name (e.g., `eastus-prod-mini`).
3. **AOAI quota differs from OpenAI** — OpenAI uses RPM/TPM with auto-scaling tiers; AOAI uses fixed TPM per region per model, plus PTU for provisioned. A slice estimating 150K tokens against a 100K TPM deployment will be throttled mid-run. Preflight should ideally read the customer's quota via Cognitive Services control-plane API and warn.
4. **Foundry's MCP approval model is per-call** — `require_approval: "always"` means every call needs human approval. If Plan Forge invokes a Foundry agent that uses MCP tools from inside a slice, the approval loop gets awkward. Workable but not free.
5. **No Foundry "fleet view" to integrate into** — There's no Foundry portal surface where Plan Forge can register itself and have its runs show up as first-class entities. Integration is one-way (Plan Forge writes to App Insights). Customers expecting a single pane in `ai.azure.com` will use Plan Forge's own dashboard.
6. **Government cloud model gap** — Azure Gov has a much-reduced catalog (`gpt-5.1`, `gpt-4.1` family, `o3-mini`, `gpt-4o`). Plan Forge's `power` quorum preset (assumes flagship models) won't resolve cleanly. Need a `power-gov` preset or graceful fallback. Endpoint domain is `openai.azure.us`, Entra is `login.microsoftonline.us`.
7. **Foundry Agent Service is NOT a substitute for the worker model** — Plan Forge workers stay where they are (local CLI, GitHub Actions, etc.). Plan Forge cannot offload its workers to Foundry to claim "managed compute".
8. **No first-party AGENTS.md adoption by Microsoft** — Copilot uses `copilot-instructions.md` and `.github/instructions/*.instructions.md`. Plan Forge already supports both, but Microsoft's gravity is toward its own instruction-file conventions, not the cross-vendor AGENTS.md spec.
9. **Microsoft account-team default is "just use workflow agents"** — Plan Forge needs a clear, repeatable answer: the SDLC depth (scope contracts, slice gates, completeness sweeps, fleet roll-up, cost attribution per slice, the 4-session model) that Microsoft hasn't built and shows no signs of building.

---

## Section 12 — Bug surfaced by audit: cost-service token coverage (CRITICAL)

The cost-service audit identified a real defect with measurable customer impact. This is now the highest-priority engineering item, separate from the Week 1 documentation work.

### 12.1 Defect summary

`pforge-mcp/cost-service.mjs` is missing accounting for **four token types** that comprise 30–80% of actual LLM cost on production workloads:

| Token type | Recognized? | Failure mode | Impact |
|---|---|---|---|
| **`cache_read_tokens`** (Anthropic + OpenAI prompt caching) | NO | Silent miss, billed at 10% of input rate; not tracked | 10–30% underestimate on cached prompts |
| **`cache_creation_input_tokens`** / **`cache_write_tokens`** (Anthropic ephemeral cache) | NO | Silent miss, billed at 1.25× (5min) or 2× (1hr) input rate | Severe underestimate when cache churn is high |
| **`reasoning_tokens`** (OpenAI o-series, Anthropic extended thinking) | **PARTIALLY** — captured at `orchestrator.mjs:1170` but NOT priced in `cost-service.mjs:163-197` `priceSlice()` | Captured then discarded | 20–40% underestimate on reasoning models |
| **`service_tier`** (OpenAI flex/standard/priority) | NO | Not extracted from response | Up to 2× underestimate on flex tier |

**Combined effect (cache + reasoning)**: potentially **60–80% cost underestimate** on Anthropic Opus + OpenAI o-series workloads.

### 12.2 Specific code locations

- [pforge-mcp/cost-service.mjs#L22-L65](pforge-mcp/cost-service.mjs) — `MODEL_PRICING` table has only `{input, output}` keys; missing cache multipliers and `gpt-5.5`, `o1`, `o3` entries
- [pforge-mcp/cost-service.mjs#L128-L131](pforge-mcp/cost-service.mjs) — `getPricing()` returns only `{input, output}`; needs `cache_read_multiplier`, `cache_write_multiplier`, `service_tier`
- [pforge-mcp/cost-service.mjs#L163-L197](pforge-mcp/cost-service.mjs) — `priceSlice()` only consumes `tokens_in`, `tokens_out`; ignores `reasoning_tokens`, cache tokens, service_tier
- [pforge-mcp/orchestrator.mjs#L1145-L1175](pforge-mcp/orchestrator.mjs) — `callOpenAICompatible` extracts `completion_tokens_details.reasoning_tokens` but not `prompt_tokens_details.cache_read_tokens` / `cache_creation_input_tokens`
- [pforge-mcp/orchestrator.mjs#L2484-L2520](pforge-mcp/orchestrator.mjs) — `extractTokens` (CLI path) does not extract cache or reasoning tokens
- [pforge-mcp/tests/cost-service.test.mjs](pforge-mcp/tests/cost-service.test.mjs) — no test coverage for cache/reasoning/service_tier

### 12.3 v2.83.0 fix status

The v2.83.0 quorum-cost-fix (provider-aware pricing for subscription CLIs via `costForLeg()` helper at `cost-service.mjs:435-445`) is still in place and correct. **It addresses a different defect** (~250× over-estimate for users without API keys). The four-token gap above is orthogonal and untouched by that fix.

### 12.4 Recommended fix sequence

1. **Capture** — Extend orchestrator extraction (`callOpenAICompatible` + `extractTokens`) to read `prompt_tokens_details.cache_read_tokens`, `prompt_tokens_details.cache_creation_input_tokens`, `service_tier` headers
2. **Price** — Upgrade `MODEL_PRICING` schema to `{input, output, cache_read_multiplier, cache_write_multiplier, reasoning_uses_output_rate, service_tier_multipliers}`. Add `gpt-5.5`, `o1`, `o3` entries
3. **Apply** — Extend `priceSlice()` to multiply each token class by its rate
4. **Test** — Add four targeted test cases (cache_read × 0.1, cache_write × 1.25, reasoning at output rate, flex tier ×2)
5. **Document** — Update `forge_cost_report` output to break down spend by token class so customers can see where the money went

This is a phase-worthy item. Recommend creating a Crucible smelt → plan, running it through tempering, executing in a dedicated phase. **Should land before any Week 1 enterprise documentation publishes**, because the docs will reference cost attribution as a Plan Forge strength — and we want that claim to be rock-solid before any reader stress-tests it.

### 12.5 Plan drafted (2026-05-06)

Hardened phase plan: **[docs/plans/archive/Phase-COST-TOKEN-COVERAGE-PLAN.md](../plans/archive/Phase-COST-TOKEN-COVERAGE-PLAN.md)**.

7 slices, ~$1.00–$2.50 estimated cost, all small code + tests, no docs-heavy work, fully backward-compatible (additive schema, defaulting strategy, positional `priceSlice()` signature preserved). Awaiting hardening (Step 2) and execution. Ready for the Plan Forge pipeline.

### 12.6 Status: FIXED in Phase-COST-TOKEN-COVERAGE (2026-05-06)

Defect resolved. All 10 hardened slices executed. Audit re-run: `priceSlice()` now correctly accounts for all four token classes (cache_read, cache_creation_5m, cache_creation_1h, reasoning_tokens) plus OpenAI service tier (flex 0.5× symmetric, priority 2.0×/1.5× asymmetric).

Hardening also surfaced and corrected stale base rates discovered during the vendor-pricing research:
- Anthropic Opus 4.5/4.6/4.7 corrected from $15/$75 to $5/$25 per Mtok (Plan Forge was 3× overestimating)
- GPT-5.4 input corrected from $5 to $2.50 per Mtok (Plan Forge was 2× overestimating on input)
- 14 missing model entries added (gpt-5.5, gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.4-nano, gpt-5.1, o1, o1-mini, o3, o3-mini, o4-mini, gpt-4o, gpt-4o-mini, grok-4.3)
- Per-model cache multipliers: OpenAI varies by family (GPT-5.x = 0.10×, GPT-4.1/o3 = 0.25×, o1/GPT-4o = 0.50×); Anthropic 0.10× universal

Combined effect: cost reports for Anthropic-Opus + OpenAI-with-caching workloads now match vendor invoices within ~5%.

**Scope clarification by cost path:**

- **Subscription CLI workers** (`gh-copilot`, `claude-cli`, `codex-cli`): unchanged. These bill via the v2.83.0 premium-request path; this fix does not touch that code path. The `costForLeg()` helper at `pforge-mcp/cost-service.mjs:309-318` is byte-identical to pre-execution. GitHub Copilot, Claude Code, and Codex CLI users see no cost-report difference.
- **Direct vendor API keys** (Anthropic, OpenAI, xAI): full benefit from both the missing token classes and the stale-base-rate corrections. Cost-report numbers should now align with vendor invoices.
- **Azure OpenAI**: cache + reasoning + service_tier fields apply via the OpenAI-compatible parser; AOAI deployment-type uplift (+10% for Data Zone / Regional vs. Global) deferred to the BYO-Azure-OpenAI phase per §11.5.A.

**Plan executed**: [docs/plans/archive/Phase-COST-TOKEN-COVERAGE-PLAN.md](../plans/archive/Phase-COST-TOKEN-COVERAGE-PLAN.md). 10 slices in 6 commits (`d123fd3` → Slices 1+2, `a91c211` → Slice 3, then Slices 4–10 in subsequent commits). All validation gates passed. Subscription-CLI regression guard verified ($0.05 unchanged). Mirror-opposite vendor invariant verified (Anthropic excludes cached from `tokens_in`; OpenAI/xAI include cached and subtract before billing). Reasoning tokens verified NOT double-counted.

See [CHANGELOG.md](../../CHANGELOG.md) `[Unreleased]` section "Phase-COST-TOKEN-COVERAGE — Cost-Service Token Coverage" for the full release-note narrative.

---

## Section 13 — Quick wins surfaced by ACI audit

The ACI audit gave Plan Forge an overall **6.2/10** ACI compliance score. **Five high-ROI fixes** were identified, all small effort, all measurable agent-quality improvements. Bundling them into a single "ACI hardening" phase is the right shape.

### Top 5 fixes (ranked by effort vs. quality improvement)

1. **`forge_home_snapshot` — truncate output, add drill subcommand** (1–2 hrs). Currently returns 30–50KB of all four quadrants + activity feed. Solves 70% of agent context overflow on health checks. Pattern: return summary counts/status only; agent calls a `?drill=crucible` variant for details.
2. **`forge_search` + `forge_timeline` — friendly empty messages** (30 min). Currently return silent `{ hits: [], total: 0 }`. Add a `message` field with actionable suggestion. Eliminates agent confusion on silent success.
3. **`forge_watch_live` — bounded event objects** (1 hr). Currently can return 10K events × ~10KB each (100MB worst case). Add a "lite" default mode (`{ ts, type, cid }` per event) and `--detailed` flag for full events. 90% size reduction on typical runs.
4. **`forge_sweep` — empty-result message** (15 min). Currently returns silent empty string when no markers. Post-process to: `"No TODO/FIXME/HACK markers found. Code is complete!"`
5. **`forge_home_snapshot` — activity feed cursor** (30 min). Already has `activityTail`; add cursor return + `hasMore` flag.

### Gold standard reference

**`forge_search`** scored ⭐⭐⭐⭐⭐ — exemplary ACI design. 80-char snippets (bounded), sparse fields (`{ source, recordRef, snippet, score, timestamp }`), `total` + `truncated` for pagination metadata, friendly empty case when implemented. Use as reference for all future tool refactors.

### Temper guards observed (anti-patterns to document)

- "Return full object to be safe" → unbounded output (`forge_home_snapshot`, `forge_watch`)
- "Raw CLI output is good enough" → silent success/failure (`forge_smith`, `forge_sweep`, `forge_validate`)
- "Pagination too hard; return all" → context overflow (`forge_run_plan`, `forge_diagnose`)
- "Empty response means nothing happened" → ambiguous to agent (`forge_search`, `forge_timeline`)

These deserve a permanent home in `temper guards` documentation alongside the existing architecture-principles ones.

### Recommended sequencing

This is a strong candidate for a small dedicated phase: **"Phase-XX — ACI Hardening Pass."** All five fixes plus the temper-guard documentation. Lands fast, measurably improves agent quality across the entire tool surface, and sets the pattern for future tool additions.

---

## Section 14 — Updated work plan (post-Foundry + audit)

Three new high-priority items now sit ahead of the original Week 1 documentation work:

### Priority A (engineering, before Week 1 docs publish)

1. **Cost-service token coverage fix** (Section 12) — phase-worthy, highest customer impact
2. **ACI hardening pass** (Section 13) — small phase, high agent-quality ROI _**(shipped 2026-05-07: PR after this one)**_

### Priority B (Week 1 documentation, now informed by Foundry research)

The original six docs, sharpened by Foundry findings:

- **Reference Architecture** — now includes the §11.6 Microsoft-Foundry composition diagram as the headline architecture for MS-shop customers
- **Agent Factory Recipe** — composes AGENTS.md + GitHub Cloud Agent + Plan Forge plan files + Foundry Toolboxes for MS shops
- **Day 1 / Week 4 / Week 12 Operator Playbook** — frame each stage around what GitHub explicitly leaves to the ecosystem (§8.4) and which Foundry surface fills which Plan Forge gap
- **Compliance / Data Residency** — Plan Forge's local-first + hub event log + L2 file artifacts is a stronger compliance story than Cursor's "audit logs exclude prompts" or Amp's "audit logs only on request" *if formalized*. Add Azure Government coverage from §11.8
- **Enterprise Deployment** landing page — map of where every concern is answered
- **GitHub Stack Alignment** — promote `plan-forge-on-the-github-stack.html`. Add Foundry composition vectors as a sibling story for Microsoft-shop variants

### Priority C (Week 2+, unchanged)

_**Status (2026-05-07): SHIPPED — all four items landed on master via the Priority-C chain. See §14.5 below for the per-phase summary, commits, and PR references.**_

- ~~OpenTelemetry exporter using §8.6 spec~~ — ✅ Phase-OTEL-AUDIT-EXPORT (12 slices)
- ~~Audit log formalization~~ — ✅ same phase (`pforge audit export` CLI + `docs/observability/audit-log-spec.md`)
- ~~Auth scaffolding~~ — ✅ Phase-AUTH-RBAC-SCAFFOLD (8 slices)
- ~~BYO Azure OpenAI as first-class provider (uses §11.5.A spec)~~ — ✅ Phase-FOUNDRY-PROVIDER (8 slices)

Fifth shipped item (originally a §9 Week 4 backlog entry, sequenced first in execution order because every downstream phase consumed its event-record shape):

- ✅ **Trajectory schema hardening** — Phase-TRAJECTORY-SCHEMA-HARDENING (6 slices). Adds `source` and `security_risk` to every `events.log` record per OpenHands pattern (§8.5).

### Priority D (backlog, Foundry-informed additions)

_**Status (2026-05-07): partially shipped via Phase-FOUNDRY-PROVIDER. The two `power-gov` and Foundry-Toolbox/App-Insights doc items landed; the deployment-name UX item landed as a `priceSlice()` mapping; quota preflight remains open.**_

- ~~**Foundry Toolbox MCP integration documentation**~~ — ✅ `docs/integrations/foundry-toolbox-mcp.md`
- ~~**Foundry App Insights OTel sink** documentation~~ — ✅ `docs/observability/foundry-app-insights.md`
- ~~**Deployment-name vs model-name UX**~~ — ✅ `priceSlice()` reads `.forge/foundry-deployments.json` (operator-editable mapping) with literal-fallback per Phase-FOUNDRY-PROVIDER Slice 4
- ~~**`power-gov` quorum preset** for Azure Government model catalog~~ — ✅ Slice 6 of Phase-FOUNDRY-PROVIDER
- ~~**Foundry quota preflight**~~ — ✅ **Phase-FOUNDRY-QUOTA-PREFLIGHT** (5 slices, 35.6 min wall, `$0.05` declared / `$0.00` wall). Opt-in via `PFORGE_FOUNDRY_QUOTA_PREFLIGHT=1` env var. Reads AOAI deployment quota via Cognitive Services REST control-plane API; compares against slice token estimate; emits warning at slice-start when headroom < 30% (warning) or < 10% (critical). Fail-open: control-plane outages NEVER block plan execution. New module `pforge-mcp/foundry-quota.mjs` with 4 exports (`getDeploymentQuota`, `quotaCacheGet`/`Set`, `compareSliceEstimate`); 34 tests in `foundry-quota.test.mjs`; doc at `docs/integrations/foundry-quota-preflight.md`. `costForLeg()` byte-identical to v2.92.0. Closes §14 Priority D.

---

## Section 14.5 — Priority C shipped (2026-05-07)

Priority C from §14 was executed as a single 4-phase chain on `feat/priority-c-enterprise-readiness` and landed on master across PRs/squash-commits in the order below. Total: **34 slices, ~3 hours of orchestrator wall time, $0.32 declared cost / $0.00 wall** (gh-copilot subscription path per the v2.83.0 cost path).

Execution order was determined by code-dependency analysis (search subagent, 2026-05-07): every downstream phase consumes the event-record shape that Phase 1 modifies, so it must land first; Phase 2 follows because OTel + audit-export both consume the now-stable event bus; Phases 3 and 4 are independent of 1/2 in file footprint but were sequenced after to avoid git working-tree contention during the chain run.

| # | Phase | Slices | Cost | Status | Plan |
|---|---|---|---|---|---|
| 1 | Phase-TRAJECTORY-SCHEMA-HARDENING | 6/6 | $0.06 | ✅ on master | [docs/plans/archive/Phase-TRAJECTORY-SCHEMA-HARDENING-PLAN.md](../plans/archive/Phase-TRAJECTORY-SCHEMA-HARDENING-PLAN.md) |
| 2 | Phase-OTEL-AUDIT-EXPORT | 12/12 | $0.11 | ✅ on master | [docs/plans/archive/Phase-OTEL-AUDIT-EXPORT-PLAN.md](../plans/archive/Phase-OTEL-AUDIT-EXPORT-PLAN.md) |
| 3 | Phase-FOUNDRY-PROVIDER | 8/8 | $0.08 | ✅ on master | [docs/plans/archive/Phase-FOUNDRY-PROVIDER-PLAN.md](../plans/archive/Phase-FOUNDRY-PROVIDER-PLAN.md) |
| 4 | Phase-AUTH-RBAC-SCAFFOLD | 8/8 | $0.07 | ✅ on master (slices 1-7 direct, slice 8 via PR #169) | [docs/plans/archive/Phase-AUTH-RBAC-SCAFFOLD-PLAN.md](../plans/archive/Phase-AUTH-RBAC-SCAFFOLD-PLAN.md) |

**What each phase shipped:**

- **Phase 1** — Adds `source` (orchestrator/worker/user/hook/environment) and `security_risk` (none/low/medium/high/critical) fields to every `events.log` record at `pforge-mcp/orchestrator.mjs:292`. Backwards-compatible read path (legacy events parse as `null`). Tagged `bridge-edit-blocked` events with `security_risk: high` automatically. Per OpenHands pattern (§8.5).
- **Phase 2** — Wires OpenTelemetry `gen_ai.*` semantic conventions per §8.6 spec: chat / tool / agent / workflow / gate spans, plus `gen_ai.client.operation.duration` and `gen_ai.client.token.usage` histograms. OTel SDK loaded as optional dep, gated on `OTEL_EXPORTER_OTLP_ENDPOINT` (no-op when unset). Adds `pforge audit export --since/--until/--type/--run --format json|csv` CLI to `pforge.ps1` and `pforge.sh`. New docs under `docs/observability/`: `otel-schema.md`, `audit-log-spec.md`, plus Grafana / Datadog / Splunk sample dashboards. Phase-1's `source`/`security_risk` map to `pforge.actor.source` / `pforge.action.security_risk` span attributes.
- **Phase 3** — Adds `microsoft-foundry` as a first-class LLM provider per §11.5.A spec. Six new `KNOWN_SECRETS` entries (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`). Two auth modes (api-key default, Entra opt-in via `@azure/identity` optional dep). Deployment-name → model-name mapping in `priceSlice()` via `.forge/foundry-deployments.json` with literal fallback. AOAI deployment-type uplift (`global` 1.0× / `data-zone` + `regional` 1.1×). Government cloud detection on `.azure.us` endpoints. New `power-gov` quorum preset (gpt-5.1, gpt-4.1, gpt-4.1-mini, o3-mini, gpt-4o; threshold 5). Three new docs: `byo-azure-openai.md`, `foundry-toolbox-mcp.md`, `foundry-app-insights.md`. `costForLeg()` byte-identical (v2.83.0 invariant preserved).
- **Phase 4** — Pluggable auth model under `pforge-mcp/auth/`: `index.mjs` (provider dispatch), `providers/bearer.mjs` (extracted from current `bridge.approvalSecret` flow, behavior-preserving), `providers/sso-stub.mjs` (interface scaffold), `rbac.mjs` (`resolveRoles` / `expandScopes` / `hasScope` with `:` hierarchy + `*` wildcard), `middleware.mjs` (`withAuth(handler, requiredScopes)`). Wired into `bridge.mjs` edit-approval and `server.mjs` MCP tool dispatch. **Open-by-default invariant**: when `.forge/rbac.json` is absent, behavior is byte-identical to today (zero solo-operator regression). 37 tests in `auth-rbac.test.mjs`. Full vitest suite (4503 tests) re-verified at Slice 7. Three security docs under `docs/security/`: `auth-model.md`, `sso-extension-point.md`, `rbac-config.md`.

**Cost-path scope clarification** (matches §12.6 framing):

- **Subscription CLI workers** (`gh-copilot`, `claude-cli`, `codex-cli`): Phase 3's AOAI multiplier and Foundry deployment-name mapping do not touch this path. `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` is byte-identical to pre-execution.
- **Direct vendor API keys** (Anthropic / OpenAI / xAI): unchanged.
- **Azure OpenAI in customer tenant**: now first-class via `microsoft-foundry` provider with deployment-name mapping and the AOAI deployment-type uplift previously deferred from Phase-COST-TOKEN-COVERAGE per §11.5.A.

**Operational lessons learned (recorded for the next chain run):**

- `pforge run-plan` defaults to background spawn — chain scripts MUST pass `--foreground`. Without it, every phase races in parallel against the same git working tree. Documented in `/memories/repo/pforge-run-plan-foreground.md`.
- Plan validation gates calling `node` or `pwsh` MUST NOT be wrapped in `bash -c "..."` on Windows. WSL bash resolves first via `where bash` and has no `node` / `pwsh` on PATH. Documented in `/memories/repo/plan-gate-command-rules.md` (anti-pattern #1).
- Plan validation gates piping pwsh-output into `grep` MUST NOT use cmd.exe-dispatched pwsh. Use `pwsh -NoProfile -Command "... | Select-String -Quiet"` instead.

**Chain runner**: Priority C used a one-shot chain script that has since been removed (all four phases shipped on 2026-05-07). For future chained-phase work, use [scripts/sequence-plans.ps1](../../scripts/sequence-plans.ps1) — the canonical, tested sequencer.

**Remaining Priority D work**: ~~Foundry quota preflight~~ — ✅ shipped via Phase-FOUNDRY-QUOTA-PREFLIGHT on 2026-05-08 (see Priority D entry above and changelog below). **§14 Priority D is now fully complete.**

---

## Changelog (this document)

- **2026-05-06 (initial)** — Initial draft. Sections 1–7 outlined; week 1 work plan defined; competitive landscape captured at a high level. Research questions queued.
- **2026-05-06 (research synthesis)** — Sections 8–10 added from six parallel research agents (codebase audit, Cursor, Sourcegraph, GitHub CCA, OpenHands/SWE-agent, OTel gen_ai). Work plan revised with specifics. Positioning matrix added. Week 2 now has a concrete OTel emit spec ready to implement.
- **2026-05-06 (Foundry + audits)** — Section 11 added (Microsoft Foundry composition — answers the strategic question of where Plan Forge sits relative to Foundry, with reference architecture). Section 12 added (cost-service token coverage defect — concrete bug with file:line evidence, 60–80% cost underestimate on cache+reasoning workloads). Section 13 added (ACI audit — top 5 quick wins, gold-standard reference, temper guards observed). Section 14 sequences engineering fixes ahead of Week 1 docs publication.
- **2026-05-06 (Week 1 docs drafted)** — All six Week 1 enterprise documentation pages drafted in parallel: [enterprise-deployment.md](../manual/enterprise-deployment.md), [github-stack-alignment.md](../manual/github-stack-alignment.md), [enterprise-reference-architecture.md](../manual/enterprise-reference-architecture.md) (with Microsoft Foundry composition variant), [agent-factory-recipe.md](../manual/agent-factory-recipe.md), [fleet-operator-playbook.md](../manual/fleet-operator-playbook.md), [compliance-and-data-residency.md](../manual/compliance-and-data-residency.md). Each consumes specific findings from sections 8–13. Week 1 documentation work for the enterprise hardening track is complete and ready for review.
- **2026-05-06 (Priority A + B shipped to master)** — Three PRs landed:
  - **PR #154** (squash `af93b747`) — Phase-COST-TOKEN-COVERAGE: vendor-aware `priceSlice()` math + 14 model entries + stale base-rate refresh. Section 12 defect FIXED. 25 new tests, all passing.
  - **PR #158** (squash `f72665c`) + cleanup (`da79672`) — 6 enterprise appendices converted from Markdown to HTML matching the manual chapter template (Appendices I–N), 2 new SVG diagrams, 7 hero images via Grok Aurora (back-fills Appendix H + new I–N), navigation registry updated, index.html cards added. Source `.md` files removed.
  - **PR #160** (squash `ee378e3`) — Phase-MANUAL-EVIDENCE Phase 1: A/B test evidence diagram, evolution timeline, lessons-learned reference chapter, project-history reference chapter, expansions to what-is-plan-forge.html and how-it-works.html.

  **Net result**: Priority A (cost fix + ACI hardening) and Priority B (Week 1 docs) from §14 are now both complete on master. Priority C (OTel exporter, audit log formalization, auth scaffolding, BYO Azure OpenAI) and Priority D (Foundry-informed backlog) are unstarted and remain the natural next chapter of work.
- **2026-05-06 (Phase-MANUAL-DISCOVERY-LOOP and Phase-MANUAL-INTEGRATIONS plans drafted)** — Two follow-up plans authored in parallel sessions and now committed to master at [docs/plans/archive/Phase-MANUAL-DISCOVERY-LOOP-PLAN.md](../plans/archive/Phase-MANUAL-DISCOVERY-LOOP-PLAN.md) and [docs/plans/archive/Phase-MANUAL-INTEGRATIONS-PLAN.md](../plans/archive/Phase-MANUAL-INTEGRATIONS-PLAN.md). Neither has been executed yet. Both extend the manual coverage further.
- **2026-05-07 (Priority C shipped)** — All four §14 Priority-C items plus the §9 Week-4 trajectory-schema item shipped via the Priority-C chain (4 phases, 34 slices, ~3 hours wall time, $0.32 declared / $0.00 wall on gh-copilot subscription). See §14.5 above for per-phase narrative, commits, and operational lessons. Net result: §14 Priority C is complete; §14 Priority D is partially complete (4 of 5 items landed via Phase-FOUNDRY-PROVIDER; only Foundry quota preflight remains open).
- **2026-05-08 (Priority D fully complete)** — The last open Priority-D item shipped via Phase-FOUNDRY-QUOTA-PREFLIGHT (5 slices, 35.6 min, `$0.05` declared / `$0.00` wall). Adds opt-in AOAI quota preflight via `PFORGE_FOUNDRY_QUOTA_PREFLIGHT=1` env var; reads Cognitive Services control-plane API; compares against slice token estimate; emits warning at slice-start when headroom < 30%; fail-open invariant (control-plane outages never block execution). 34 tests, costForLeg byte-identical, priceSlice signature unchanged. Audit ran clean per the post-DOCS-UX-LIFT discipline (verified each MUST against actual artifacts, not just gate output). **Net result: every §14 line item across Priority A, B, C, and D is shipped.**

### 12.6 Status: FIXED in Phase-COST-TOKEN-COVERAGE (commit d59b907, 2026-05-16)

Defect resolved. Audit re-run: priceSlice() now correctly accounts for all four token classes.
See docs/plans/archive/Phase-COST-TOKEN-COVERAGE-PLAN.md for the executed plan.
Hardening also surfaced and corrected stale base rates (Opus 3× overestimate, GPT-5.4 2× overestimate);
combined effect: cost reports for Anthropic-Opus + OpenAI-with-caching workloads now match vendor invoices within ~5%.

**Scope clarification by cost path:**
- Subscription CLI workers (gh-copilot, claude-cli, codex-cli): unchanged. These bill via the
  v2.83.0 premium-request path; this fix does not touch that code path.
- Direct vendor API keys (Anthropic, OpenAI, xAI): full benefit from both the missing token
  classes and the stale-base-rate corrections.
- Azure OpenAI: cache + reasoning + service_tier fields apply; AOAI deployment-type uplift
  (+10% for Data Zone / Regional) deferred to the BYO-Azure-OpenAI phase per §11.5.A.
