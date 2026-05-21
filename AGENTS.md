# AGENTS.md — Working on Plan Forge

> **Audience**: AI coding agents (Copilot, Claude, Cursor, Codex, Aider) **contributing to Plan Forge itself**.
> If you're trying to *install* Plan Forge into a target project, read [`AGENT-SETUP.md`](AGENT-SETUP.md) instead — that's a different workflow.
>
> **Project**: Plan Forge
> **Stack**: Node.js 18+ ESM (`.mjs`), no TypeScript build step. PowerShell 7+ AND Bash 4+ for every entry point.
> **Lives on**: This file is dev-internal — ships from `planning/main`, NOT from `master`.

---

## Project Identity (one paragraph)

Plan Forge is an agentic plan-execution pipeline for AI-driven software delivery: a specify → harden → execute → review → ship workflow backed by an MCP server (100+ `forge_*` tools), a CLI (`pforge`), a live dashboard, and a three-tier memory system (L1 hub / L2 files / L3 OpenBrain). It dogfoods itself — every feature ships via a hardened phase plan in [`docs/plans/`](docs/plans/) executed by `forge_run_plan`. Stack-neutral when targeting *user* projects (.NET / Node / Python / Rust / Java / Go / PHP), but the framework itself is opinionated about its own internals.

---

## Start Here (Read These First)

| File | What it gives you |
|------|-------------------|
| [`docs/plans/PROJECT-PRINCIPLES.md`](docs/plans/PROJECT-PRINCIPLES.md) | 8 non-negotiable principles, 20+ tech commitments, 16 forbidden patterns. **This is the contract.** |
| [`.github/instructions/architecture-principles.instructions.md`](.github/instructions/architecture-principles.instructions.md) | The 5 Questions to answer before ANY code change |
| [`docs/plans/DEPLOYMENT-ROADMAP.md`](docs/plans/DEPLOYMENT-ROADMAP.md) | Phase queue (what's planned, what's in flight, what's done) |
| [`docs/plans/AI-Plan-Hardening-Runbook.md`](docs/plans/AI-Plan-Hardening-Runbook.md) | How to harden a phase plan before execution |
| [`.github/instructions/clean-code.instructions.md`](.github/instructions/clean-code.instructions.md) | Clean Code guardrails — function design, naming, module-size limits, `/clean-code-review` skill |
| `forge_capabilities` (MCP tool) | Live inventory of every `forge_*` tool, skill, config, extension. **Call this first** — don't grep |

When in doubt, call [`forge_master_ask`](pforge-master/) for open-ended reasoning instead of chaining tools manually.

---

## Branch Model (do not violate)

| Branch | Purpose | What lives here |
|--------|---------|-----------------|
| `master` | Consumer template (clean) | What users get when they `setup.ps1`. **Zero `Phase-*-PLAN.md`.** Zero `docs/plans/archive/`. |
| `planning/main` | Dev superset | Everything from `master` PLUS phase plans, dev artifacts, this `AGENTS.md`, `PROJECT-PRINCIPLES.md` |

**Rules:**
- Phase plans (`Phase-*-PLAN.md`) NEVER land on `master`. There is **no** automated commit-time guard; it's a proactive maintainer responsibility. Tarball pollution is mitigated by `.gitattributes` `export-ignore` rules (Phase plans, `docs/plans/archive/`, `docs/plans/cleanup-findings/`, and `AGENTS.md` itself are stripped from `git archive` output even when a release tag happens to live on `planning/main`).
- Sync `master` → `planning/main` is **manual** today (typically a merge or cherry-pick). An automated workflow is on the wishlist but does not currently exist.
- New work begins on a feature branch off `planning/main`, gets reviewed, merges to `planning/main`. Consumer-visible code then cherry-picks to `master` (or lands via a planned shipper slice). The release checklist (`docs/RELEASE-CHECKLIST.md` §3.4) assumes the release tag is created from `master`; tagging from `planning/main` works for `pforge self-update` (because the consumer copy step uses an allow-list) but bypasses the canonical procedure.

---

## Architecture at a Glance

```
┌──────────────────────────────────────────────────────────────────────┐
│  pforge (CLI)              .vscode/mcp.json (Copilot MCP transport)  │
└────────────────┬─────────────────────────────────────────────────────┘
                 │ stdio                       │ HTTP :3100/mcp
                 ▼                             ▼
        ┌────────────────────────────────────────────┐
        │  pforge-mcp/server.mjs  (MCP server)       │
        │  ─ exposes 100+ forge_* tools              │
        │  ─ express :3100 (dashboard + WS)          │
        └─────────────┬──────────────────────────────┘
                      ▼
        ┌────────────────────────────────────────────┐
        │  pforge-mcp/orchestrator.mjs               │
        │  ─ slice execution, gates, retries         │
        │  ─ owns .forge/runs/ + .forge/traces/      │
        └─────────────┬──────────────────────────────┘
                      ▼
        ┌────────────────────────────────────────────┐
        │  Memory tiers (Hallmark-stamped)           │
        │    L1: hub.mjs (5000-event ring buffer)    │
        │    L2: .forge/*.jsonl + .json on disk      │
        │    L3: OpenBrain (Postgres + pgvector)     │
        └────────────────────────────────────────────┘
```

**Companion package**: [`pforge-master/`](pforge-master/) — Forge-Master Studio reasoning loop (stdio MCP + dashboard tab). Separate Node package, same monorepo.

**Layer responsibilities** (Principle 2 — Separation of Concerns):
- **Tool surfaces** (`pforge-mcp/*.mjs`) — single-purpose `forge_*` handlers, ACI-compliant payloads
- **Orchestrator** (`orchestrator.mjs`) — slice execution, gates, retries, audit trail
- **Memory** (`hub.mjs`, `memory.mjs`, OpenBrain) — provenance, recall, replay

A tool MUST NOT write to `.forge/runs/` directly. The orchestrator owns that surface. A tool MUST NOT embed business logic in the controller layer. The orchestrator MUST NOT shape tool responses (each tool owns its own ACI contract).

---

## The 4 Sessions (how Plan Forge work flows)

| Session | Purpose | Prompt |
|---------|---------|--------|
| 1 | **Specify & Plan** — define the feature, harden the plan | [`step0-specify-feature.prompt.md`](.github/prompts/step0-specify-feature.prompt.md), [`step2-harden-plan.prompt.md`](.github/prompts/step2-harden-plan.prompt.md) |
| 2 | **Execute** — build slice by slice with validation gates | [`step3-execute-slice.prompt.md`](.github/prompts/step3-execute-slice.prompt.md) |
| 3 | **Review** — independent audit, drift detection (fresh agent) | [`step5-review-gate.prompt.md`](.github/prompts/step5-review-gate.prompt.md) |
| 4 | **Ship** — commit, tag, sync `master` → `planning/main` | `pforge ship` |

Each session is a separate context window. This is intentional — it prevents context bleed and forces handoff via plan artifacts. Do NOT collapse sessions to save tokens.

---

## ACI Discipline (gold-standard reference: `forge_search`)

Every `forge_*` tool you add MUST:

1. **Bound the happy-path payload** to ~10 KB. Offer `verbose` / `drill` for details.
2. **Paginate anything that can grow**: `limit`, `cursor`, `hasMore`, `total`, `truncated`.
3. **Describe empty states explicitly** — `{ hits: [], total: 0, message: "Searched plans for 'X' — no matches. Try …" }`. Never return a bare empty array.
4. **Document every response field** in the tool's `description`, `inputSchema`, and `TOOL_METADATA.example.output`.
5. **Test the contract** — vitest happy path, empty-state path, pagination path, error path.

If you ignore these, the agent calling your tool will fall back to grep or hallucinate. See the Temper Guards table in `architecture-principles.instructions.md`.

---

## CLI Parity (non-negotiable)

Every entry point ships **both** shells:

| PowerShell | Bash | Purpose |
|------------|------|---------|
| `setup.ps1` | `setup.sh` | Install Plan Forge into a target project |
| `pforge.ps1` | `pforge.sh` | The CLI dispatcher |
| `validate-setup.ps1` | `validate-setup.sh` | Post-install verification |

When adding a new entry point: write the PowerShell version, write the Bash version in the same commit, add parity tests. A PR that ships only one shell is rejected.

---

## Cross-Platform Rules

- **Paths**: `path.join(...)` everywhere. NEVER hardcode `\` or `/`.
- **Shell-out**: `spawn(cmd, [args])` — NEVER `exec(stringWithInput)` (command-injection risk + breaks quoting on Windows).
- **No sync child_process in the orchestrator hot path** — blocks the event loop, freezes the dashboard, breaks live hub streaming.
- **Line endings**: `.gitattributes` enforces LF for code. Don't fight it.

---

## Cost Estimates (do not hand-compute)

When a plan asks "how much will this cost?", call:

- **`forge_estimate_quorum`** — projected cost under `auto` / `power` / `speed` / `false` modes (one payload, all four).
- **`forge_cost_report`** — actuals from previous runs.

Hand-computed quorum estimates in chat have been observed off by 10×. The tool is the source of truth.

---

## Quick Commands

```powershell
# Validate environment + setup files
pforge smith
pforge check

# Discover the full surface
# (or call forge_capabilities from the MCP client)
pforge --help

# Run a plan autonomously (foreground; tail dashboard at localhost:3100)
pforge run-plan docs/plans/Phase-NN-FOO-PLAN.md
pforge run-plan --estimate docs/plans/Phase-NN-FOO-PLAN.md
pforge run-plan --quorum=power docs/plans/Phase-NN-FOO-PLAN.md

# Test (both workspaces — root + pforge-mcp + pforge-master)
npm test
cd pforge-mcp; npm test
cd pforge-master; npm test

# Start the dashboard manually
node pforge-mcp/server.mjs   # → http://localhost:3100/dashboard
```

---

## Multi-Agent Notes

Plan Forge is designed for multiple AI agents. `setup.ps1 -Agent claude,cursor,codex` generates native instruction files for each (`.claude/`, `.cursor/`, `.codex/`). When working on Plan Forge itself:

- **Copilot**: reads [`.github/copilot-instructions.md`](.github/copilot-instructions.md) + everything in [`.github/instructions/`](.github/instructions/) (auto-loaded via `applyTo` frontmatter)
- **Claude/Cursor/Codex**: read **this file** (`AGENTS.md`) + [`docs/plans/PROJECT-PRINCIPLES.md`](docs/plans/PROJECT-PRINCIPLES.md)
- **All agents**: respect the Scope Contract of the active slice — never edit files in its Forbidden Actions list

If you're an agent and you got here from a `forge_delegate_to_agent` call, the calling orchestrator has already loaded the slice's Scope Contract into your prompt. Honor it.

---

## Forbidden Shortcuts (a sampler — full list in PROJECT-PRINCIPLES.md)

| Don't | Why |
|-------|-----|
| Land a phase plan on `master` | Branch-model violation; consumer template stays clean |
| Add a TypeScript build step | Breaks the no-build promise (`node server.mjs` must just work) |
| Add a dependency without a Required Decision entry | Defeats Principle 7 (lean deps); silent dep growth bloats the runtime |
| Hardcode a model name in business logic | Models change; must flow through `cost-service.mjs` registry |
| Write directly to `.forge/runs/` from a tool | Bypasses the orchestrator's audit + Hallmark provenance |
| Return `{ hits: [] }` with no `message` | ACI violation — ambiguous to agents (failure vs. no-results) |
| Ship a `.ps1` without the matching `.sh` (or vice versa) | Halves the user base |
| Modify a user's repo from a `forge_*` tool without dry-run + confirmation | Plan Forge orchestrates the user's repo; never silently mutates it |

When tempted: stop, re-read [`docs/plans/PROJECT-PRINCIPLES.md`](docs/plans/PROJECT-PRINCIPLES.md), pick a non-shortcut path.

---

## Status Reporting

When executing a plan slice or reporting progress, use the templates in [`.github/instructions/status-reporting.instructions.md`](.github/instructions/status-reporting.instructions.md): Progress Update, Slice Complete, Blocker Report, Failure / Recovery, Run Summary, Handoff Summary.

When a defect in Plan Forge ITSELF blocks you (plan defect, orchestrator defect, prompt defect), file via `forge_meta_bug_file` — see [`.github/instructions/self-repair-reporting.instructions.md`](.github/instructions/self-repair-reporting.instructions.md). Defects in *user* code go through `forge_bug_file`.

---

## Last Resort

If you're blocked, context is degraded, or you can't reconcile a request with the principles:

1. Stop. Don't brute-force.
2. Re-read [`docs/plans/PROJECT-PRINCIPLES.md`](docs/plans/PROJECT-PRINCIPLES.md) + the active slice's Scope Contract.
3. Call `forge_master_ask` for open-ended reasoning.
4. Surface the ambiguity to the human owner (srnichols) before guessing.

Better to halt than to drift.
