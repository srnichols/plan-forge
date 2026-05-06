# Plan Forge on the GitHub Stack

> **Audience**: Platform engineers and architects evaluating Plan Forge alongside their existing GitHub Enterprise + Copilot Enterprise investment.
> **Thesis**: GitHub deliberately ships the agent runtime, the integration standards (MCP, AGENTS.md, Skills), the customization primitives, and the engagement metrics. Everything *above* the runtime — orchestration, planning, eval, fleet ops, quality scorecards — is explicitly the SDK / OSS / ecosystem layer. Plan Forge is built to fill that exact lane.

---

## The signal: GitHub said this out loud in April 2026

On April 2, 2026, GitHub shipped the **Copilot SDK in public preview**. The release notes describe it as "the same production-tested agent runtime that powers GitHub Copilot cloud agent and Copilot CLI" exposed for application developers to embed.

The implication is unmistakable: **GitHub views agent orchestration as something built *on top of* their primitives, not inside them.**

This page documents how Plan Forge composes with the primitives GitHub explicitly leaves to the ecosystem.

---

## What GitHub ships (the substrate)

| Primitive | What it is | Status (May 2026) |
|---|---|---|
| **Copilot Cloud Agent** (formerly Coding Agent) | Ephemeral Actions-powered runner. Single repo / single branch / single PR per task. Three modes: research-only, plan-only, branch-only | GA |
| **AGENTS.md** | Open standard for agent context files | Stewarded by **Agentic AI Foundation under the Linux Foundation**. 60k+ repos use it. GitHub adopts; does not own |
| **Agent Skills** | Open standard for agent procedural knowledge | Repo `agentskills/agentskills`, Apache 2.0, **maintained by Anthropic**. GitHub adopts |
| **Model Context Protocol (MCP)** | Open standard for agent-to-tool integration | Linux Foundation project. Maintained by Anthropic et al. GitHub ships `github/github-mcp-server` (29.5k stars, MIT) as the reference implementation |
| **`.github/instructions/`** | GitHub-native repo customization | GA. Plan Forge ships ~16 instruction files |
| **`.github/copilot-instructions.md`** | Repo-wide Copilot context | GA |
| **`.github/agents/`** | Custom agent personas | GA on github.com (preview in JetBrains/Eclipse/Xcode) |
| **`.github/hooks/`** | Lifecycle hooks (preToolUse, postToolUse, sessionStart, etc.) | GA |
| **`.github/skills/`** | Repo-scoped skill definitions | GA |
| **GitHub Actions** | CI/CD runtime that powers Cloud Agent | GA |
| **GitHub Advanced Security** (GHAS) | Code scanning, secret scanning, Dependabot | GA |
| **Copilot Spaces** | Curated context bundles for chat | GA (chat-side; not yet a Cloud Agent execution context) |
| **Copilot Metrics API** | Adoption + flow metrics (active users, PR throughput, time-to-merge) | GA |
| **Copilot SDK** | Embed the Cloud Agent runtime in your own app | **Public preview, April 2, 2026** |
| **Custom properties** | Org-level governance primitive | GA |
| **Org runner controls + firewall** | Cloud Agent runtime governance | GA (April 2026) |

This is a strong, coherent substrate. It is also explicitly *just the substrate*.

---

## What GitHub deliberately leaves to the ecosystem (the Plan Forge lane)

These are the surfaces GitHub does not ship and shows no sign of shipping — direct evidence from GitHub's own docs and roadmap:

| Gap | Evidence |
|---|---|
| **Hardened plan as versioned artifact** with scope contract, slices, validation gates, drift detection | Plan-mode is session-scoped one-shot; no plan file format, no scope contract, no slice persistence |
| **Cross-repo / multi-service orchestration** | Explicit single-repo limitation: *"Copilot can only make changes in the repository specified when you start a task. Copilot cannot make changes across multiple repositories in one run."* |
| **Multi-model quorum / consensus** per task | No built-in mechanism. Single model per session |
| **Plan execution harness** with per-slice gates and resume-from semantics | `copilot-setup-steps.yml` is one pre-flight hook; nothing slice-aware |
| **Semantic eval harness** (test pass rate, regression rate, plan-adherence) | Metrics API explicitly does not measure quality, only adoption + flow |
| **Cost prediction per task / per plan** before execution | Only post-hoc Actions + premium-request totals |
| **Live programmatic watch** of an in-flight agent from external tools | Session UI is in-product only; no public stream |
| **Cross-org / cross-team fleet console** with queue, capacity, SLA visibility | Only per-issue / per-project session UI |
| **Pre-merge plan-adherence gates** | No first-party concept of "this PR drifted from the approved plan" |
| **Agent skills / instructions sync** across N repos | Up to consumer (`.github-private` is the only template mechanism) |
| **Multi-tenant cost budgets** and prioritization | Not in product |
| **A/B comparison** of custom agents or models for the same task class | Not in product |

GitHub's positioning is consistent: **wrap your tool/data source as an MCP server, layer your customization via the open file standards (AGENTS.md, Skills, instructions), and build your orchestration on top of the SDK.** That is exactly the Plan Forge architecture.

---

## How Plan Forge composes with each GitHub primitive

| GitHub primitive | How Plan Forge consumes it | Where in Plan Forge |
|---|---|---|
| **Copilot Cloud Agent** | Plan Forge dispatches plan slices to CCA via `gh issue create --assignee @copilot`. Trajectories captured to `.forge/trajectories/<plan-slug>.jsonl` | `pforge-mcp/orchestrator.mjs` (`--worker copilot-coding-agent` mode) |
| **AGENTS.md** | Plan Forge generates and maintains AGENTS.md alongside `.github/copilot-instructions.md` so any AGENTS.md-aware agent (Claude Code, Cursor, Codex, Amp, Aider, Gemini CLI, Goose, Windsurf) consumes Plan Forge context | `pforge-mcp/server.mjs` setup phase |
| **`.github/instructions/`** | Plan Forge ships ~16 instruction files covering architecture, security, testing, database, API, auth, error handling, deployment, performance, observability, version, status reporting, context fuel, self-repair, plan hardening | `templates/.github/instructions/` |
| **`.github/copilot-instructions.md`** | Plan Forge generates the project-scoped Copilot instructions during `setup.ps1 / setup.sh` | `setup.ps1`, `setup.sh` |
| **`.github/agents/`** | Plan Forge ships 20 custom agent personas (architecture, database, security, deploy, performance, test-runner, API contracts, accessibility, multi-tenancy, CI/CD, observability, dependency, compliance, plus 6 pipeline agents and an audit classifier) | `templates/.github/agents/` |
| **`.github/hooks/`** | Plan Forge ships SessionStart, PreToolUse, PostToolUse, Stop, plus three LiveGuard hooks (PreDeploy, PostSlice, PreAgentHandoff) | `templates/.github/hooks/` |
| **`.github/skills/`** | Plan Forge ships 14 skills as `/` slash-commands: database-migration, staging-deploy, test-sweep, dependency-audit, security-audit, code-review, release-notes, api-doc-gen, onboarding, health-check, forge-execute, audit-loop, plus pipeline skills | `templates/.github/skills/` |
| **MCP** | Plan Forge ships its own MCP server (`pforge-mcp`) with 68+ tools covering planning, execution, eval, observability, cost, memory, search, timeline, notifications. Auto-generates `.vscode/mcp.json` | `pforge-mcp/server.mjs`, `pforge-mcp/tools.json` |
| **github/github-mcp-server** | Plan Forge documents this as the canonical GitHub-side MCP integration. Plan Forge agents call it via the MCP plumbing they already speak | docs reference, `.vscode/mcp.json` example |
| **GitHub Actions** | Plan Forge plans can run as Actions workflows; `pforge run-plan` is callable from any runner. CCA itself runs in Actions and Plan Forge plans dispatched via CCA inherit Actions concurrency, runners, and minutes | `action.yml` |
| **GitHub Advanced Security** | Plan Forge's `forge_secret_scan`, `forge_dep_watch`, and security-audit skill complement GHAS — not replace it. Plan Forge surfaces GHAS findings into plan-aware bug reports | `pforge-mcp/notifications/`, `dependency-reviewer.agent.md` |
| **Copilot Spaces** | Plan Forge plan files + Scope Contract are the equivalent concept for autonomous execution. Spaces serves chat-side context curation; Plan Forge serves execution-time scope binding | docs reference |
| **Copilot Metrics API** | Plan Forge does not duplicate it. Plan Forge surfaces *quality* metrics (gate failure rates, drift scores, plan-adherence, regressions caught at gate boundary, cost per merged PR) that the Metrics API explicitly does not | `forge_health_trend`, `forge_drift_report`, `forge_cost_report` |
| **Copilot SDK** | Plan Forge does not embed the Copilot runtime. Plan Forge orchestrates *across* multiple agent runtimes (CCA, Claude Code, Codex, custom workers). The SDK is the right tool when you want to embed a single agent in your app; Plan Forge is the right tool when you want to coordinate many agent runs as a delivery pipeline | architecture reference |
| **Custom properties** | Plan Forge documents the recommended custom-property schema for governing per-team Plan Forge enablement, plan templates, and budget caps | `templates/docs/CUSTOMIZATION.md` |
| **Org runner controls** | Plan Forge dispatched plans inherit the org's runner policy. No conflict, no override needed | docs reference |

---

## The composition picture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       PLAN FORGE (orchestration layer)                  │
│   plans · slices · scope contracts · gates · cost · drift · memory      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
┌─────────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│ AGENTS.md / Skills  │  │  MCP servers    │  │  GitHub Actions     │
│ .github/instructions│  │  (Plan Forge,   │  │  (Cloud Agent       │
│ .github/agents      │  │   GitHub MCP,   │  │   runtime, plus     │
│ .github/hooks       │  │   org tools)    │  │   user CI)          │
└─────────────────────┘  └─────────────────┘  └─────────────────────┘
        │                        │                       │
        └────────────────────────┼───────────────────────┘
                                 ▼
        ┌─────────────────────────────────────────────────┐
        │  GitHub Copilot Cloud Agent (the agent runtime)  │
        │  + Copilot Enterprise + GHAS + Metrics API       │
        └─────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │      Customer's repos    │
                    └─────────────────────────┘
```

Read top-to-bottom: Plan Forge orchestrates a plan, generates the GitHub-native customization files, dispatches slices to the agent runtime via the integration standards, and runs validation against the customer's own repos. **Every box except the top one is GitHub-native.**

---

## Why this matters for the consolidation thesis

If your strategic direction is "consolidate on GitHub Enterprise + Copilot Enterprise," Plan Forge *reinforces* that choice rather than competing with it.

- **Cursor and Sourcegraph Amp are platform-agnostic by design.** They work as well on GitLab and Bitbucket as on GitHub. Adopting them does not strengthen your GitHub investment.
- **GitHub Copilot Cloud Agent shipped the substrate but explicitly leaves orchestration to the ecosystem.** Without an orchestration layer, the substrate is incomplete for fleet rollouts.
- **Plan Forge is the only project in the comparison set built specifically to extend GitHub primitives in the direction GitHub itself signaled is the ecosystem's lane.** The architecture is a deliberate "yes, and" to GitHub's stack.

For Microsoft-shop enterprises pursuing the GitHub-native consolidation thesis, this is the cleanest path: GitHub for the substrate, Plan Forge for the orchestration layer, no third vendor in the picture.

---

## Variations for Microsoft Foundry shops

For customers using **Microsoft Foundry** (Azure OpenAI, Foundry Agent Service, Foundry Toolboxes), Plan Forge composes additionally with:

- **Azure OpenAI** as a first-class LLM provider (alongside GitHub Copilot, Anthropic, OpenAI, xAI). Auth via Entra ID (recommended), API key, or managed identity. Endpoint format `https://{resource}.openai.azure.com/openai/v1/`. Customer configures **deployment names**, not model families.
- **Foundry Toolboxes** as MCP-compatible endpoints. Plan Forge already speaks MCP; pointing `.vscode/mcp.json` at a Foundry Toolbox endpoint is config, not code.
- **Foundry App Insights** as the OTel sink. Plan Forge OTel traces land in the same dashboards as the customer's Foundry agent runs.

See [Reference Architecture](enterprise-reference-architecture.md#microsoft-foundry-variant) for the full picture.

---

## What Plan Forge does *not* duplicate

Discipline matters. Plan Forge does not:

- Replicate the Copilot Metrics API (we add quality metrics; we don't re-implement adoption metrics)
- Embed or fork the Copilot Cloud Agent runtime (we dispatch to it)
- Compete with `github/github-mcp-server` (we use it; we ship our own MCP server for orchestration concerns)
- Reinvent AGENTS.md, Skills, or MCP (we adopt the open standards; we contribute back when we learn something)

If GitHub ships a feature that subsumes a Plan Forge capability, the right answer is to delete the Plan Forge code and use GitHub's. We're explicit about that in the project README.

---

## Changelog

- **2026-05-06** — Initial GitHub stack alignment doc. Documents the substrate / ecosystem-lane split GitHub signaled with the Copilot SDK preview, maps every Plan Forge capability to the GitHub primitive it consumes, and articulates why Plan Forge is the cleanest fit for the consolidation thesis.
