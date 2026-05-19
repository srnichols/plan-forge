# Project Principles — Plan Forge

> **Purpose**: Non-negotiable principles, technology commitments, and forbidden
> patterns for Plan Forge itself. Plan Forge dogfoods its own pipeline — every
> phase plan in `docs/plans/` is validated against this file. Drift detected
> here halts execution.
>
> **Last Updated**: 2026-05-18
> **Governance**: Requires human approval to amend (no AI-only edits).
> **Lives on**: `planning/main` branch only (this file is dev-internal, NOT
> shipped to consuming projects — the consumer-facing template is
> [`PROJECT-PRINCIPLES-TEMPLATE.md`](PROJECT-PRINCIPLES-TEMPLATE.md)).

---

## Project Identity

**What Plan Forge is:**
> An agentic plan-execution pipeline for AI-driven software delivery. A specify
> → harden → execute → review → ship workflow backed by an MCP server
> (100+ `forge_*` tools), a CLI (`pforge`), a live dashboard, and a memory
> system spanning L1 (hub) / L2 (files) / L3 (semantic via OpenBrain). It is
> the substrate that turns a markdown plan file into shipped, validated code.

**What Plan Forge is NOT:**
> Not an IDE. Not a code editor. Not an AI model or LLM. Not a CI/CD platform.
> Not a project management tool. Not a code generator. Plan Forge orchestrates
> existing AI agents (Copilot, Claude, Codex, Cursor) against existing tools
> (git, vitest, CI) — it doesn't replace any of them, and it doesn't try to be
> any of them.

**Stack neutrality:**
> Plan Forge runs against .NET, Node, Python, Rust, Java, Go, and PHP projects.
> The framework itself is opinionated about its own internals, but it makes NO
> assumptions about the user's stack. Every code path that touches a user repo
> must be stack-detected via `setup.ps1`/`setup.sh` or the auto-profile scan —
> never hard-coded.

**Self-hosting commitment:**
> Plan Forge is built using Plan Forge. Every feature lands via a hardened
> phase plan in `docs/plans/`, executed by `forge_run_plan`, reviewed by the
> `reviewer-gate` agent, and shipped via the same `pforge ship` flow that
> consuming projects use. If the framework can't ship its own features that
> way, the feature isn't done.

---

## Core Principles (non-negotiable)

| # | Principle | Rationale | Violated When |
|---|-----------|-----------|---------------|
| 1 | **Architecture-first** | Read [`architecture-principles.instructions.md`](../../.github/instructions/architecture-principles.instructions.md) and answer the 5 Questions before any code | A slice writes code without naming a layer, reuses no existing pattern, has no test plan, or no failure-mode analysis |
| 2 | **Separation of concerns (Plan Forge edition)** | Tool surface (`pforge-mcp/*.mjs`) → Orchestrator (`orchestrator.mjs`) → Memory (L1 hub / L2 files / L3 OpenBrain). Each layer has one job | A `forge_*` tool writes directly to `.forge/runs/` (bypassing the hub), or the orchestrator embeds tool response shaping logic |
| 3 | **ACI discipline for every tool surface** | Agents are bottlenecked by what tools return. Bounded payloads, pagination, descriptive empty states. `forge_search` is the gold standard | A new tool returns >10KB of JSON in the happy path with no opt-in, returns `{ hits: [] }` with no `message`, or omits `total`/`hasMore`/`truncated` metadata |
| 4 | **TDD for business logic** | Red-Green-Refactor. Every `forge_*` tool, orchestrator pathway, and cost calculation has a vitest test | Slice ships an MCP tool, gate runner, or cost estimator with no test; or tests written after the fact as box-checking |
| 5 | **Cross-platform / CLI parity** | Every `.ps1` has a `.sh` equivalent. Every path uses `path.join`. Every shell-out uses `spawn` with explicit args (never string interpolation) | A Windows-only or Unix-only code path lands; a script forks the user's OS handling without matching parity |
| 6 | **Self-hosting (dogfood) commitment** | Every Plan Forge feature ships via a hardened Plan Forge phase plan executed by `forge_run_plan` | A feature lands as a direct `git commit` to `master` without a phase plan on `planning/main` documenting the work |
| 7 | **Lean dependencies** | The runtime stays small: MCP SDK, ws, express, sharp, playwright, vitest. New dependencies require explicit justification in the plan's Required Decisions | A slice adds a dependency without a Required Decision entry; or pulls in a heavy framework (Next.js, NestJS, etc.) for something `node:http` could do |
| 8 | **Branch model integrity** | Phase plans live on `planning/main`. Consumer-facing code lives on `master`. Sync is automated. | A phase plan file lands on `master`, OR `planning/main` deletes a dev artifact that master also deleted (defeats the `-s ours` guard) |

---

## Technology Commitments

Locked-in choices for Plan Forge's own runtime and tooling. Do NOT suggest alternatives during plan execution.

| Category | Commitment | Alternatives Rejected | Decision Date |
|----------|-----------|----------------------|---------------|
| **Runtime** | Node.js 18+ (ESM only, `.mjs`) | TypeScript build pipeline, Deno, Bun | 2025-04 (founding) |
| **Type system** | JSDoc annotations where types matter | TypeScript build step (breaks the no-build promise) | 2025-04 |
| **MCP transport** | `@modelcontextprotocol/sdk` stdio + HTTP | Hand-rolled JSON-RPC, gRPC | 2025-06 |
| **Dashboard server** | `express` (5.x) | Fastify, Koa, native `http` (more boilerplate for the static + WS surface) | 2025-08 |
| **Live hub transport** | `ws` (raw WebSocket) | Socket.io (too heavy for hub broadcast) | 2025-08 |
| **Testing** | `vitest` (run mode, no watch) | Jest, Mocha, node:test | 2025-07 |
| **Image processing** | `sharp` (PNG diff via `pixelmatch` + `pngjs`) | Jimp, ImageMagick shell-outs | 2026-01 |
| **Browser automation** | `playwright` (screenshot capture, dashboard tests) | Puppeteer, Selenium | 2026-01 |
| **Load testing** | `autocannon` | wrk shell-out, k6 | 2026-02 |
| **CSS build** | `tailwindcss` 3.x (only for `docs/assets/*` and the dashboard) | PostCSS-only pipeline, plain CSS for the dashboard | 2025-09 |
| **CLI shell parity** | PowerShell 7+ (`.ps1`) AND Bash 4+ (`.sh`) for every entry point | PowerShell-only or Bash-only | 2025-05 |
| **L1 memory (hub)** | In-process bounded ring buffer | Redis pub/sub (adds external dep for a single-process concern) | 2025-08 |
| **L2 memory (structured)** | Files on disk under `.forge/` (`.jsonl` append-only, `.json` overwrite) | SQLite, LevelDB | 2025-04 |
| **L3 memory (semantic)** | [OpenBrain](https://github.com/srnichols/openbrain) (Postgres + pgvector, HTTP API) | Chroma, Qdrant, Pinecone, in-process vector store | 2025-11 |
| **Observability** | OpenTelemetry (optional, gated by `OTEL_EXPORTER_OTLP_ENDPOINT`) + line-oriented audit log (`pforge audit export`) | Always-on OTel, vendor-specific SDKs | 2026-03 (Phase-OTEL-AUDIT-EXPORT) |
| **Secrets** | `.forge/secrets.json` (gitignored) OR environment variables | Hardcoded keys, in-repo `.env` files | 2025-06 |
| **CI/CD** | GitHub Actions | Azure DevOps, GitLab CI, CircleCI | 2025-04 |
| **Versioning** | Semver via `VERSION` file + commit-driven bumps | Date-based, manual `package.json` edits | 2025-05 |
| **License** | MIT | Apache-2.0, GPL | 2025-04 |
| **Distribution** | GitHub releases + `setup.ps1`/`setup.sh` clone-and-bootstrap | npm publish, Homebrew, scoop | 2025-04 |

---

## Forge Configuration Constants

Authoritative defaults for Plan Forge's own runtime. Plans MUST honor these unless an explicit Required Decision overrides one for a specific slice.

| Parameter | Value | Source |
|-----------|-------|--------|
| **Default dashboard port** | `3100` | `pforge-mcp/server.mjs` |
| **Default MCP transport** | stdio (CLI), HTTP on `3100/mcp` (dashboard mode) | `pforge-mcp/server.mjs` |
| **L1 hub ring buffer size** | 5000 events | `pforge-mcp/hub.mjs` |
| **L2 trace retention** | 30 days under `.forge/runs/` and `.forge/traces/` | `pforge-mcp/orchestrator.mjs` |
| **Default gate timeout** | 600s (10 min) per validation gate | `pforge-mcp/orchestrator.mjs` (overridable per-slice) |
| **Quorum modes** | `auto`, `power`, `speed`, `false` — thresholds owned by `forge_estimate_quorum` | `pforge-mcp/cost-service.mjs` |
| **Cost estimator source of truth** | `forge_estimate_quorum` / `forge_cost_report` — NEVER hand-computed in chat | `.github/copilot-instructions.md` |
| **Plan file location** | `docs/plans/Phase-N-<NAME>-PLAN.md` (numbered) | `DEPLOYMENT-ROADMAP.md` queue order |
| **Audit log format** | `[ISO timestamp] event-type: {json}` (line-oriented, streamable) | `docs/observability/audit-log-spec.md` |

---

## Quality Non-Negotiables

| Metric | Target | Enforcement |
|--------|--------|-------------|
| Vitest pass rate | 100% on `npm test` (both workspaces) | CI gate; orchestrator gate runner |
| New `forge_*` tool has tests | Yes — contract + happy path + empty-state + pagination | Plan slice gate; reviewer agent |
| ACI compliance for new tools | Bounded payload (<10KB happy path), pagination, `message` on empty | reviewer-gate agent; matches `forge_search` standard |
| CLI parity (`.ps1` / `.sh`) | Every new entry point ships both shells | Plan slice gate |
| Plan execution success | Slice gate exit 0 OR explicit Stop Condition documented | `forge_run_plan` |
| `master` branch hygiene | Zero `Phase-*-PLAN.md`, zero `docs/plans/archive/` content | PreCommit hook + `.gitattributes` + branch model |
| Cross-platform path handling | `path.join` everywhere; no hardcoded `\` or `/` separators | reviewer-gate agent |
| Token cost transparency | Every multi-model call recorded via `cost-service` | `forge_cost_report` regression check |

---

## Forbidden Patterns

Never acceptable, regardless of context or time pressure.

| # | Pattern | Why Forbidden |
|---|---------|--------------|
| 1 | Secrets in source code, plan files, or committed `.env` files | Security breach; `.forge/secrets.json` is gitignored for a reason |
| 2 | Empty catch blocks | Silent failures destroy debuggability for everyone downstream |
| 3 | Sync `child_process.execSync` / `spawnSync` in the orchestrator hot path | Blocks the event loop, breaks live hub streaming, freezes the dashboard |
| 4 | Shell-out with string interpolation of user input | Command injection; always use `spawn(cmd, [args])` |
| 5 | Direct `fs` writes to `.forge/runs/` or `.forge/traces/` from a tool | Bypasses orchestrator audit + Hallmark provenance; must go through the orchestrator |
| 6 | A `forge_*` tool that returns the full domain object "to be safe" | ACI violation (Temper Guard in `architecture-principles.instructions.md`) — unbounded payloads blow agent context |
| 7 | A `forge_*` tool that returns `{ hits: [] }` with no `message` field on the empty path | ACI violation — ambiguous to agents (failure vs. no results) |
| 8 | Hardcoded model names in business logic | Models change; must flow through `cost-service.mjs` registry |
| 9 | Hand-computed cost/quorum estimates in chat or in code | Must call `forge_estimate_quorum` / `forge_cost_report` — hand math has been observed off by 10× |
| 10 | Hardcoded `\` or `/` path separators | Cross-platform regression; use `path.join` / `path.sep` |
| 11 | A `.ps1` entry point without a matching `.sh` (or vice versa) | Breaks the CLI parity commitment; halves the user base |
| 12 | Plan file (`Phase-*-PLAN.md`) committed to `master` | Violates the branch model; the PreCommit hook + `.gitattributes` will catch most cases, but human judgment is the last line of defense |
| 13 | Editing files listed in the active slice's **Forbidden Actions** | Defeats the Scope Contract; PostToolUse hook will block but agents must respect the contract proactively |
| 14 | Introducing a TypeScript build step or any other build pipeline that requires compilation before `node server.mjs` works | Breaks the no-build promise; users clone and run |
| 15 | Adding a new dependency without a Required Decision entry in the plan | Defeats Principle 7 (lean deps); silent dep growth is how runtimes bloat |
| 16 | Modifying a consuming project's repo from a `forge_*` tool without explicit user-facing dry-run + confirmation | Plan Forge orchestrates the user's repo — it must never silently mutate it |

---

## Phase Execution Standards

Every phase plan in `docs/plans/` MUST include these 6 mandatory blocks before execution (this is Plan Forge's own standard — we hold ourselves to it):

1. **Scope Contract** — In-scope, Out-of-scope, Forbidden Actions
2. **Required Decisions** — Unresolved choices that block execution
3. **Execution Slices** — 30-120 min bounded chunks with validation gates
4. **Re-anchor Checkpoints** — Drift detection between slices
5. **Stop Conditions** — When to halt execution immediately
6. **Definition of Done** — Measurable completion criteria

Plans missing any block are **NOT execution-ready** and must be hardened via
[`step2-harden-plan.prompt.md`](../../.github/prompts/step2-harden-plan.prompt.md)
or the `plan-hardener` agent first.

---

## Governance

**How are these principles amended?**
> Requires a human-approved Pull Request **into `planning/main`** (this file
> does not live on `master`). The amendment must explain what changed, why it
> changed, and what prior decisions are superseded. AI agents may propose
> amendments but cannot approve them.

**Who can amend them?**
> Project owner (srnichols) only. Even AI agents acting on the owner's behalf
> in autonomous mode must surface the diff for explicit approval before merging
> a PR against this file.

**Where this file is enforced:**
> - [`.github/instructions/project-principles.instructions.md`](../../.github/instructions/project-principles.instructions.md) auto-loads this file's rules into every Copilot session when it exists
> - [`step1-preflight-check.prompt.md`](../../.github/prompts/step1-preflight-check.prompt.md) validates incoming plans against the Forbidden Patterns table
> - [`step5-review-gate.prompt.md`](../../.github/prompts/step5-review-gate.prompt.md) audits shipped slices for principle drift
> - The `reviewer-gate` and `architecture` agents reference this file when
>   scoring PRs
