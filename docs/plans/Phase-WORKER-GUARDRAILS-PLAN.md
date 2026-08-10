# Phase WORKER-GUARDRAILS — Apply A1–A8 enhancements from the gh-aw comparison

> **Status**: ✅ Complete. All 12 slices shipped. See [What actually shipped](#what-actually-shipped) for the retro.
> **Source**: [docs/research/gh-aw-agent-factory-comparison.md](../research/gh-aw-agent-factory-comparison.md) §3 "Action list (AGREED 2026-05-18)".
> **Tracks**: `pforge-mcp/` (new tool + bridge filter + plan-parser fields), `.github/hooks/` + `templates/.github/hooks/` (PreCommit chain + Forbidden-Actions tightening), plan frontmatter schema (3 new optional fields), one new agent file, docs + auto-discovery sweep.
> **Estimated cost**: medium — most changes are mechanical with explicit tests; one new MCP tool (A2) uses cheap-tier model and is exercised once per slice in QA.
> **Pipeline**: Specify ✅ → Harden ✅ → Execute ✅ → S9 full QA ✅ → S10 docs sweep ✅ → S11 retro ✅.
> **Recommended starting cluster**: **Cluster A — Foundation** (S0) so every later slice has a baseline to regress against.
> **Session budget**: 12 slices total. Recommended break points: **commit + new session after S3** (end of Safe-Outputs unit) and **after S6** (end of Frontmatter Cluster). Resume each new session with `pforge run-plan --resume-from <slice>`.

---

## Execution Hold

This plan is hardened but **MUST NOT be executed yet**. Lift the hold only when ALL of the following are true:

- [ ] No competing in-flight plan is modifying `pforge-mcp/orchestrator.mjs`, `pforge-mcp/bridge.mjs`, `pforge-mcp/capabilities.mjs`, `pforge-mcp/server.mjs`, or `.github/hooks/PreCommit.mjs` (this phase touches all five — a parallel agent's edits would conflict)
- [ ] No competing plan is modifying `templates/.github/hooks/plan-forge.json` (Slice 2 + Slice 3 register new chain entries)
- [ ] `master` is clean: `git status` returns no untracked files inside the scope listed above
- [ ] The most recent `pforge run-plan` orchestrator log is closed (no run in-flight)
- [ ] The S0 baseline snapshots can be regenerated deterministically on the current `master` (i.e. nothing about the current build is in flux)

**To resume**: change Status to `HARDENED — cleared for execution YYYY-MM-DD` and run `pforge run-plan docs/plans/Phase-WORKER-GUARDRAILS-PLAN.md`. The orchestrator will refuse if `lockHash` (added by A6 if S5 has shipped in a prior run) doesn't match — that's intentional. For first run before A6 exists, `lockHash` is absent and the orchestrator runs as today.

---

## Why this phase exists

The gh-aw / Peli's Agent Factory comparison surfaced 8 concrete enhancements (A1–A8) that map cleanly onto existing Plan-Forge surfaces. Each is small in isolation; together they close real gaps:

| Gap today | A# | What lands |
|---|---|---|
| Forbidden-Actions hook only matches backticked paths in Copilot sessions | **A1** | Cross-engine enforcement + glob/dir-pattern matcher coverage |
| No diff-level check between worker completion and commit | **A2** | New `forge_diff_classify` tool — leaked secrets, prompt-injection echoes, introduced `eval`/`exec`, license-incompatible pastes |
| PreDeploy hook only fires for deploy slices | **A3** | Generalize into a PreCommit chain that runs on **every** slice's staged diff |
| Plan-Health insights live only in `/memories/repo/*.md` by hand | **A4** | New `plan-health-auditor.agent.md` reads run history + memories + bugs, emits a markdown report |
| Worker has unbounded network egress | **A5** | `network.allowed` frontmatter (log-only first) + in-process proxy logging hosts to the slice run log |
| No protection against plan body drift after Step-2 harden | **A6** | `lockHash:` frontmatter — orchestrator refuses to run if the plan body diverged from the hash |
| `forge_tempering_run` can't optimize a numeric metric | **A7** | `--objective <cmd>` flag accepts the change only if metric improves |
| Worker has access to every MCP tool, including expensive ones | **A8** | `tools.deny: [...]` frontmatter — MCP bridge strips listed tools at session start |

Every change is **opt-in** (new fields default to today's behavior) or a **strict promotion** (A1 — never weakens enforcement). No existing plan needs editing for the phase to ship.

---

## Scope Contract

### In Scope

**Hooks + scripts** (A1, A3):
- `.github/hooks/PreCommit.mjs` — extend with chain runner (currently only does master-branch reject)
- `templates/.github/hooks/PreCommit.mjs` — keep in sync
- `templates/.github/hooks/scripts/check-forbidden.sh` + `.ps1` — tighten matcher (glob/dir), document cross-engine invocation
- `templates/.github/hooks/scripts/check-diff-classify.sh` + `.ps1` (new, thin shims that call `forge_diff_classify`)
- `templates/.github/hooks/plan-forge.json` — register new PreCommit chain entries

**MCP tools** (A2, A7, A8):
- `pforge-mcp/server.mjs` — register `forge_diff_classify`, accept new tempering flag, parse `tools.deny` from plan frontmatter
- `pforge-mcp/diff-classify.mjs` (new) — the classifier (cheap-tier model + structured rubric)
- `pforge-mcp/tempering.mjs` (or wherever `forge_tempering_run` lives — confirm at harden time) — accept `--objective`
- `pforge-mcp/bridge.mjs` — strip denied tools from the MCP tool list at worker spawn
- `pforge-mcp/capabilities.mjs` — register new tool + new flag in `TOOL_METADATA`

**Plan parser + orchestrator** (A5, A6, A8):
- `pforge-mcp/orchestrator.mjs` — parse `network.allowed`, `lockHash`, `tools.deny` from plan frontmatter; spawn the network proxy when `network.allowed` is set; verify `lockHash` before launching worker
- `pforge-mcp/proxy-logger.mjs` (new, ~50 LOC) — minimal in-process HTTPS proxy that logs hostnames and (later) enforces

**Agent** (A4):
- `.github/agents/plan-health-auditor.agent.md` (new) — single agent file using existing tools (`forge_master_ask`, `forge_cost_report`, `forge_health_trend`, `forge_bug_list`, `forge_team_activity`, `brain_recall`) + read access to `.forge/orchestrator-logs/`, `.forge/runs/`, `/memories/repo/`
- `.forge/health/` directory (created at first run) for `latest.md` output

**Tests** (every slice + S9):
- `pforge-mcp/tests/diff-classify.test.mjs` (new)
- `pforge-mcp/tests/precommit-chain.test.mjs` (new)
- `pforge-mcp/tests/plan-frontmatter-extensions.test.mjs` (new) — covers `network.allowed`, `lockHash`, `tools.deny` parsing + enforcement
- `pforge-mcp/tests/tempering-objective.test.mjs` (new)
- `pforge-mcp/tests/forbidden-matcher.test.mjs` (new) — covers A1's expanded matcher
- Updates to any existing test that asserts the old advisory-only behavior

**Docs sweep** (S10):
- `docs/capabilities.md` + `pforge-mcp/capabilities.mjs` `TOOL_METADATA` — register `forge_diff_classify` + new flag + new frontmatter fields
- `docs/llms.txt` + root `llms.txt` — auto-discovery payload
- `docs/manual/customization.html` — Lifecycle Hooks section (PreCommit chain expansion, new Forbidden-Actions matcher behavior)
- `docs/manual/forge-json-reference.html` — new `hooks.preCommit.chain[]` config block
- `docs/manual/environment-variables-reference.html` — any new env vars introduced by the proxy (`PFORGE_NETWORK_LOG_ONLY=1` default)
- `docs/manual/errors-and-exit-codes.html` — new `diff-classify-blocked`, `lock-hash-mismatch`, `network-allowlist-violation`, `tool-denied` codes
- `docs/manual/glossary.html` — terms: "PreCommit Chain", "Diff Classifier", "Plan Lock Hash", "Tool Denylist", "Network Allowlist"
- `docs/manual/book-index.html` — index entries for the four new concepts
- `docs/EXTENSIONS.md` / `docs/CLI-GUIDE.md` — `--objective` flag on `forge_tempering_run`
- `CHANGELOG.md` — one entry per A#; group under a single minor-version bump
- `VERSION` — bump per `version.instructions.md` (likely a single MINOR — these are additive)
- `.github/copilot-instructions.md` — mention the new plan frontmatter fields in the "Cost estimates" / "Project Overview" section if relevant

### Out of Scope

- **Anything not listed in §"In Scope"**. This is not a refactor pass.
- Flipping A5 from log-only to enforce — that's a separate later phase once we have real traffic data
- Allowlist mode for A8 (only denylist this phase — see comparison §3 "Why this is the right cut")
- gh-aw's `permissions:` / `safe-outputs:` / `bash:` blocks — explicitly rejected in the comparison
- Splitting `forge_diff_classify` into multiple specialized scanners (one tool, one severity, multiple categories internally)
- A separate `.lock.json` artifact for plans (A6 uses a hash inside the existing frontmatter)
- Dashboard surfacing for A4's report (markdown file only this phase; dashboard later if signal warrants)
- Touching `pforge-master/`, `pforge-sdk/`, `extensions/`, `presets/` — none of these are affected
- Migrating any **existing** plan to use the new optional frontmatter fields
- Changing the model used by quorum / worker / Forge-Master — A2 picks its own cheap-tier model independently

### Forbidden Actions

- **Do NOT modify** `costForLeg()` at `pforge-mcp/cost-service.mjs:309-318` (v2.83.0 protected fix — universal tripwire)
- **Do NOT** make any of the new frontmatter fields (`network.allowed`, `lockHash`, `tools.deny`) **required**. They MUST default to today's behavior when absent.
- **Do NOT** change the default `network.allowed` behavior from "log-only" to "enforce" in this phase — that flip is explicitly a later decision
- **Do NOT** ship A8's denylist with a starter content (e.g. pre-denying `forge_lattice_blast`). Default is empty; surprises break trust.
- **Do NOT** call the diff classifier (A2) on the worker's model account — it MUST go to the cheap-tier model so it doesn't blow `forge_cost_report` budgets
- **Do NOT** weaken or bypass the existing PreCommit master-branch reject (#74) — A3 chains AROUND it, not through it
- **Do NOT** introduce a new top-level CLI verb. All new behavior reaches users through existing surfaces (`pforge run-plan`, `forge_tempering_run`, plan frontmatter, hook config)
- **Do NOT** bundle slices into one commit. Each A# slice = one commit. S0/S9/S10 are also one commit each.
- **Do NOT** edit `/memories/repo/*.md` files as part of this phase — A4 reads them; it does not curate them
- **Do NOT** modify the plan-parser to silently strip unknown frontmatter fields; keep the existing pass-through behavior so future fields stay forward-compatible
- **Do NOT** add a `postinstall` or other implicit network-proxy startup — the proxy spawns only when a plan declares `network.allowed`

### Source files (read-only, treated as authoritative)

| Source | Authoritative for |
|---|---|
| `docs/research/gh-aw-agent-factory-comparison.md` §3 + §3-archive | Action definitions, rejected alternatives, sequencing |
| `.github/hooks/PreCommit.mjs` (existing) | Hook entry-point pattern + config loader shape |
| `templates/.github/hooks/scripts/check-forbidden.sh` + `.ps1` | Cross-shell hook script pattern |
| `templates/.github/hooks/scripts/check-predeploy.sh` + `.ps1` | Chain-entry shell script template (model for `check-diff-classify`) |
| `pforge-mcp/capabilities.mjs` `TOOL_METADATA` | Tool registration shape — required for `forge_diff_classify` |
| `pforge-mcp/orchestrator.mjs` frontmatter parsing | Existing pattern for `network`, `lockHash`, `tools.deny` to slot into |
| `templates/.github/hooks/plan-forge.json` | Hook registration schema |

---

## Required Decisions

All resolved during plan drafting; no TBDs remain. Step-2 hardener may add per-slice details but the locked decisions below do not move.

| # | Decision | Resolution |
|---|---|---|
| 1 | A2 model tier | **Cheap tier** (same family as `forge_classifier_issue`) — runs every slice; flagship-tier cost is unjustifiable. Confirm pricing at S3 harden time. |
| 2 | A2 severity threshold | **Block on `>= high`**, warn on `medium`, log only on `low`. Matches existing `forge_secret_scan` + PreDeploy hook semantics. |
| 3 | A2 categories | `leaked-secret`, `prompt-injection-echo`, `eval-exec-introduced`, `license-incompatible-paste`, `unexpected-network-call`, `large-binary-dump`. Internal-only enum; no public schema commitment. |
| 4 | A5 default mode | **Log-only**. Set `PFORGE_NETWORK_LOG_ONLY=1` as the default. Plans CAN opt into enforce-mode via `network.enforce: true` but no plan ships it this phase. |
| 5 | A5 default allowlist (when enforce ever flips on) | `api.openai.com`, `api.anthropic.com`, `api.x.ai`, `*.githubusercontent.com`, `github.com`, `api.github.com`, `localhost`, `127.0.0.1`. **Documented but not enforced this phase.** |
| 6 | A6 hash scope | `sha256` over the concatenation of (per slice, in document order): `### Slice N:` header line + `**Scope** (files in scope):` list + `**Validation Gate**:` bash block + the plan's top-level `### Forbidden Actions` list. Stored in frontmatter as `lockHash: <hex>`. |
| 7 | A6 enforcement | Orchestrator computes hash on plan load. If frontmatter has `lockHash` and it doesn't match, **refuse to run** and tell the user to re-harden. If frontmatter has no `lockHash`, run as today (backwards-compatible). |
| 8 | A6 hash insertion | Added by Step-2 hardener (existing prompt) as the final action of hardening. Hand-edited plans without re-harden retain old behavior. |
| 9 | A7 acceptance semantics | `--objective <cmd> --accept-if greater` (default) or `less`. Command runs in repo root, must print a single numeric line on stdout, non-zero exit = fail (do not accept). |
| 10 | A7 baseline capture | Tempering captures baseline by running `<cmd>` BEFORE the worker proposes changes. Worker doesn't see the number. After commit candidate, re-run; compare. |
| 11 | A8 denylist semantics | **Strip listed tools from the worker's MCP tool list at session start.** Worker never sees the tool exists. No runtime error; no fallback prompt. |
| 12 | A8 enforcement layer | `pforge-mcp/bridge.mjs` — at MCP session init, intersect `TOOLS` with `tools.deny` from active plan; expose only the difference. Independent of which engine (Copilot/Claude/Codex) connects. |
| 13 | A4 trigger model | **Manual only this phase** — invoke via `forge_master_ask({ message: "@plan-health-auditor weekly report" })`. Scheduled trigger deferred until output quality is observed. |
| 14 | A4 output location | `.forge/health/latest.md` (overwritten) + `.forge/health/<ISO-date>.md` (kept). No dashboard wiring this phase. |
| 15 | Version bump | **Single MINOR bump** at the end of the phase. All 8 actions are additive + backwards-compatible. No MAJOR bump needed even though A1 tightens existing behavior — the existing behavior was already documented as "hard block." |
| 16 | A1 backwards compatibility for the matcher tightening | The expanded matcher (globs, dir patterns) is a strict superset of today's substring match. A path blocked today remains blocked; new patterns block MORE. No existing plan should regress. |
| 17 | Where the network proxy listens | Ephemeral port chosen at spawn time; bound to `127.0.0.1` only. Worker env gets `HTTPS_PROXY=http://127.0.0.1:<port>` and `HTTP_PROXY=...`. Proxy dies with worker. |
| 18 | A4 agent runtime | Reuses existing `forge_master_ask` orchestrator — no new runtime. The agent file is just a prompt + tool-allowlist contract. |

---

## Acceptance Criteria

> Flat MUST/SHOULD list (analyzer-scoreable). Every criterion is traceable to at least one slice's Validation Gate \u2014 see the trace map at the end of this section.

- **MUST**: `bash -c "cd pforge-mcp && npx vitest run"` exits 0 after every slice \u2014 the slice's new vitest suite passes AND no existing test regresses
- **MUST**: `pwsh -NoProfile -File pforge.ps1 check` reports zero new validation errors compared to the S0 baseline
- **MUST**: `forge_capabilities` payload size growth \u2264 10% per slice (ACI bound \u2014 see architecture-principles temper guards)
- **MUST**: No new `any` / `dynamic` / `Object<string, *>` types introduced in changed `.mjs` files
- **MUST**: A plan with no new frontmatter fields (`network.allowed`, `lockHash`, `tools.deny`) runs **byte-identically** to its pre-slice run (baseline log hash captured in S0; diffed by each slice's `baselines.test.mjs` invocation)
- **MUST**: A malformed value for any new frontmatter field (e.g. `network.allowed: "not-an-array"`) fails fast with a parse error pointing at the line number, not a silent default
- **MUST**: PreCommit chain runs in declared order; first non-zero exit aborts the chain and the commit
- **MUST**: Existing master-branch reject (#74) remains the FIRST entry in the PreCommit chain after S2 lands
- **MUST**: A chain step that returns `{ blocked: true, reason: "..." }` JSON aborts with that reason surfaced via the existing `permissionDecisionReason` path\n- **MUST**: A1's expanded Forbidden-Actions matcher is a strict superset of today's matcher \u2014 any path blocked today remains blocked (verified by `forbidden-matcher.test.mjs` fixture set including current production patterns)\n- **MUST**: A2 (`forge_diff_classify`) blocks the commit when severity is `high` or `critical`; warns at `medium`; logs at `low`\n- **MUST**: A2 uses the cheap-tier model account, NOT the worker's model account (verified by inspecting cost-report attribution in `diff-classify.test.mjs`)\n- **MUST**: A5 ships in **log-only** mode this phase; `PFORGE_NETWORK_LOG_ONLY=1` is the default. No plan in `docs/plans/` declares `network.enforce: true`\n- **MUST**: A6 `lockHash` field, when absent from frontmatter, runs as today (backwards compatible \u2014 verified in `plan-frontmatter-extensions.test.mjs`)\n- **MUST**: A8 `tools.deny`, when empty or absent, leaves the advertised MCP tool list byte-identical to today's (verified in `plan-frontmatter-extensions.test.mjs`)\n- **MUST**: A4 (`plan-health-auditor`) is read-only \u2014 the agent file's tool allowlist contains no write-capable tool\n- **MUST**: `forge_capabilities` returns the new tool name (`forge_diff_classify`), the new `objective` flag on `forge_tempering_run`, and the three new frontmatter fields in its response payload after S10\n- **MUST**: `docs/llms.txt` and root `llms.txt` mention `forge_diff_classify`, `plan-health-auditor`, `network.allowed`, `lockHash`, and `tools.deny` after S10\n- **MUST**: Manual HTML pages (`customization.html`, `forge-json-reference.html`, `environment-variables-reference.html`, `errors-and-exit-codes.html`, `glossary.html`, `book-index.html`) reference each new concept in the appropriate section after S10\n- **MUST**: `CHANGELOG.md` contains one entry per action tagged `[A1]` through `[A8]` after S10\n- **MUST**: `VERSION` is bumped MINOR (per decision #15) after S10; tag is NOT created in this plan (release is a separate phase)\n- **SHOULD**: `pforge run-plan --estimate` cost projection on a canonical real plan stays within 5% of the S0 baseline (catches surprise tool-call growth from chain entries)\n- **SHOULD**: Each slice commit message follows the `feat(<scope>): <A#> \u2014 <summary>` convention defined in the Commit message convention sub-section below\n- **SHOULD**: Slice diffs stay under 500 net LOC except S10 (docs sweep \u2014 expected larger)\n\n### MUST-to-Slice traceability\n\n| Acceptance Criterion (theme) | Slice that proves it |\n|---|---|\n| Vitest baseline regression | S0 (define), S1\u2013S8 (every gate re-runs `baselines.test.mjs`), S9 (full suite) |\n| Capabilities payload growth bound | S9 + S10 |\n| Frontmatter backwards compatibility | S4, S5, S6 (each ships its own opt-in field with absent-default test) |\n| PreCommit chain ordering + abort semantics | S2 |\n| Forbidden-Actions matcher superset | S1 |\n| A2 severity thresholds + cheap-tier attribution | S3 |\n| A5 log-only default | S4 |\n| A6 absent-`lockHash` compatibility | S5 |\n| A8 empty-deny compatibility | S6 |\n| A4 read-only allowlist | S8 |\n| `forge_capabilities` reflects new surface | S10 |\n| `llms.txt` + manual HTML coverage | S10 |\n| CHANGELOG + VERSION bump | S10 |

### Commit message convention

```
feat(<scope>): <A#> — <one-line summary>

<2-4 sentence body explaining the user-visible change and the QA evidence.>
```

Scopes:
- `hooks` for A1, A3
- `tools` for A2, A7
- `plan` for A5, A6, A8
- `agents` for A4
- `docs` for S10
- `tests` for S9

---

## Slice Plan

Slices are sequential where dependencies exist, parallel-safe otherwise. S0 must land first (baseline). S9 + S10 must land last (QA + docs sweep depend on all prior slices).

### Cluster A — Foundation

| # | Slice | Output | Depends on |
|---|---|---|---|
| **S0** | **Baseline test harness + capture today's behavior** | New vitest snapshot of: `forge_capabilities` payload, plan-parse output for one canonical plan, PreToolUse hook output for a forbidden path, current `pforge run-plan --estimate` output for a canonical plan. Stored under `pforge-mcp/tests/__baselines__/`. Every later slice diff-checks against these. | — |

### Cluster B — Safe-outputs unit (gh-aw's central pattern)

| # | Slice | Output | Depends on |
|---|---|---|---|
| **S1** | **A1 — Forbidden Actions matcher hardening** | Expand `check-forbidden.{sh,ps1}` matcher to support: glob patterns (`docs/**/*.html`), directory patterns (`pforge-mcp/`), and intent-style entries already used in plans (treat lines starting with `**Do NOT**` as enforced). Add cross-engine wrapper invocation note in `templates/.github/hooks/PreCommit.mjs`. New `forbidden-matcher.test.mjs`. | S0 |
| **S2** | **A3 — PreCommit chain framework** | Generalize `PreCommit.mjs` to read `hooks.preCommit.chain[]` from `.forge.json`, run entries in order, abort on first deny. Master-branch reject becomes the first declared chain entry. Add `precommit-chain.test.mjs`. | S0 |
| **S3** | **A2 — `forge_diff_classify` tool + wire into S2 chain** | New `pforge-mcp/diff-classify.mjs`, registered in `server.mjs` + `capabilities.mjs`. New `check-diff-classify.{sh,ps1}` shim in `templates/.github/hooks/scripts/`, registered as second entry in `hooks.preCommit.chain[]`. New `diff-classify.test.mjs` covering all 6 categories from decision #3. | S2 |

### Cluster C — Independent frontmatter additions

| # | Slice | Output | Depends on |
|---|---|---|---|
| **S4** | **A5 — `network.allowed` frontmatter (log-only)** | Plan-parser accepts `network.allowed: [...]`. New `pforge-mcp/proxy-logger.mjs`. Orchestrator spawns proxy + injects `HTTPS_PROXY` into worker env when field present. Hosts logged to `.forge/runs/<run-id>/slices/<n>/network.log`. New `network-allowlist.test.mjs`. | S0 |
| **S5** | **A6 — `lockHash` frontmatter + enforcement** | Plan-parser computes the hash per decision #6. Orchestrator verifies on load. Step-2 hardener prompt updated to emit `lockHash` as its final step (template only — does not retroactively harden existing plans). Tests in `plan-frontmatter-extensions.test.mjs`. | S0 |
| **S6** | **A8 — `tools.deny` frontmatter + MCP bridge filter** | Plan-parser accepts `tools.deny: [...]`. `bridge.mjs` strips listed tools at session init. Tests in `plan-frontmatter-extensions.test.mjs`. | S0 |

### Cluster D — Tooling additions

| # | Slice | Output | Depends on |
|---|---|---|---|
| **S7** | **A7 — `--objective` flag on `forge_tempering_run`** | New optional input fields `objective.command`, `objective.acceptIf` (default `greater`) per decision #9. Baseline-capture-then-compare flow per decision #10. New `tempering-objective.test.mjs`. `forge_capabilities` reflects the new fields. | S0 |
| **S8** | **A4 — `plan-health-auditor.agent.md`** | New agent file under `.github/agents/`. Reads `.forge/orchestrator-logs/`, `.forge/runs/`, `/memories/repo/`, runs `forge_cost_report`/`forge_health_trend`/`forge_bug_list`/`forge_team_activity`/`brain_recall`. Emits markdown to `.forge/health/latest.md` + dated copy. Smoke test invokes via `forge_master_ask` and asserts a non-empty report with expected sections. | S0 |

### Cluster E — Cross-cutting

| # | Slice | Output | Depends on |
|---|---|---|---|
| **S9** | **Full QA sweep + new test suites green together** | Run full vitest suite (`npm test --workspace=pforge-mcp`) on the merged set of S1–S8. Run `pforge check` on every plan under `docs/plans/`. Run `pforge run-plan --estimate` on one representative real plan; confirm cost projection within 5% of S0 baseline (no surprise tool-call regressions). Run all baseline snapshots from S0 — confirm only the diffs we expect. | S1–S8 |
| **S10** | **Docs sweep + auto-discovery** | All HTML doc updates listed in §"In Scope → Docs sweep". `pforge-mcp/capabilities.mjs` `TOOL_METADATA` updated. `docs/capabilities.md` + `docs/llms.txt` + root `llms.txt` regenerated/edited. `CHANGELOG.md` entries (one per A#, tagged `[A1]`..`[A8]`). `VERSION` bumped MINOR per decision #15. | S1–S9 |
| **S11** | **Retro** | Append `## What actually shipped` to this plan: per-slice LOC delta, tests added, capabilities payload growth, any decisions that moved during execution. Confirm `forge_capabilities` and `llms.txt` describe all 8 actions. | S1–S10 |

---

## Execution Slices

> Parser-compatible execution contracts. Each `### Slice N:` carries a fenced `bash` Validation Gate using `node -e '...'` checks (portable across Windows/macOS/Linux) and `npm test` for the slice's vitest suite.

### Slice 0: Baseline test harness — capture today's behavior

**Parallelism:** [sequential] — foundation; every other slice depends on the snapshots this slice produces.

**Depends On:** —

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)
- [.github/instructions/status-reporting.instructions.md](../../.github/instructions/status-reporting.instructions.md)

**Scope** (files in scope):
- `pforge-mcp/tests/__baselines__/capabilities.snapshot.json` (new)
- `pforge-mcp/tests/__baselines__/plan-parse.snapshot.json` (new)
- `pforge-mcp/tests/__baselines__/forbidden-hook-deny.snapshot.json` (new)
- `pforge-mcp/tests/__baselines__/estimate.snapshot.json` (new)
- `pforge-mcp/tests/baselines.test.mjs` (new — asserts current build produces these snapshots; later slices diff against them)

**Worker guidance**: capture, don't change. The point of S0 is that every later slice has something to regress against. Snapshots must be deterministic — strip timestamps, run IDs, and absolute paths before hashing.

**Validation Gate**:

```bash
node -e 'for (const f of ["pforge-mcp/tests/__baselines__/capabilities.snapshot.json","pforge-mcp/tests/__baselines__/plan-parse.snapshot.json","pforge-mcp/tests/__baselines__/forbidden-hook-deny.snapshot.json","pforge-mcp/tests/__baselines__/estimate.snapshot.json","pforge-mcp/tests/baselines.test.mjs"]) require("fs").accessSync(f)'
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

---

### Slice 1: A1 — Forbidden Actions matcher hardening

**Parallelism:** [parallel-safe, Group P1] — touches `check-forbidden.{sh,ps1}` only; no overlap with S2's `PreCommit.mjs` / `plan-forge.json`.

**Depends On:** Slice 0

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/security.instructions.md](../../.github/instructions/security.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)

**Scope** (files in scope):
- `templates/.github/hooks/scripts/check-forbidden.sh` (expand matcher: glob, directory, `**Do NOT**` intent lines)
- `templates/.github/hooks/scripts/check-forbidden.ps1` (mirror)
- `.github/hooks/scripts/check-forbidden.sh` + `.ps1` (keep template + working copy in sync)
- `pforge-mcp/tests/forbidden-matcher.test.mjs` (new — unit tests for matcher logic; spawns the shell scripts and asserts deny/allow on representative inputs)

**Worker guidance**: extend the matcher in place; do NOT rewrite as a Node script. The shell scripts must remain cross-shell-portable (bash + powershell). Test inputs should cover: literal path, directory prefix, glob with `**`, glob with `*`, and `**Do NOT** modify <thing>` intent lines.

**Validation Gate**:

```bash
node -e 'for (const f of ["templates/.github/hooks/scripts/check-forbidden.sh","templates/.github/hooks/scripts/check-forbidden.ps1",".github/hooks/scripts/check-forbidden.sh",".github/hooks/scripts/check-forbidden.ps1","pforge-mcp/tests/forbidden-matcher.test.mjs"]) require("fs").accessSync(f)'
node -e 'const a=require("fs").readFileSync("templates/.github/hooks/scripts/check-forbidden.sh","utf-8");const b=require("fs").readFileSync(".github/hooks/scripts/check-forbidden.sh","utf-8");if(a!==b)throw new Error("template and working hook scripts drifted")'
bash -c "cd pforge-mcp && npx vitest run tests/forbidden-matcher.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

---

### Slice 2: A3 — PreCommit chain framework

**Parallelism:** [parallel-safe, Group P1] — touches `PreCommit.mjs` + `plan-forge.json`; no overlap with S1's `check-forbidden.*`.

**Depends On:** Slice 0

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/security.instructions.md](../../.github/instructions/security.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)

**Scope** (files in scope):
- `.github/hooks/PreCommit.mjs` (extend: read `hooks.preCommit.chain[]`, run in order, abort on first deny)
- `templates/.github/hooks/PreCommit.mjs` (mirror)
- `templates/.github/hooks/plan-forge.json` (add `hooks.preCommit.chain` schema; master-branch reject becomes the FIRST chain entry)
- `pforge-mcp/tests/precommit-chain.test.mjs` (new — covers: empty chain (no-op), one-entry chain, two-entry chain with second denying, master reject as first entry)

**Worker guidance**: master-branch reject MUST remain enabled; it just becomes a declared chain entry instead of hardcoded behavior. The chain runner reads JSON from each script's stdout — same protocol as PreToolUse already uses.

**Validation Gate**:

```bash
node -e 'for (const f of [".github/hooks/PreCommit.mjs","templates/.github/hooks/PreCommit.mjs","templates/.github/hooks/plan-forge.json","pforge-mcp/tests/precommit-chain.test.mjs"]) require("fs").accessSync(f)'
node -e 'const a=require("fs").readFileSync(".github/hooks/PreCommit.mjs","utf-8");const b=require("fs").readFileSync("templates/.github/hooks/PreCommit.mjs","utf-8");if(a!==b)throw new Error("template and working PreCommit.mjs drifted")'
node -e 'const cfg=JSON.parse(require("fs").readFileSync("templates/.github/hooks/plan-forge.json","utf-8"));if(!cfg.hooks||!cfg.hooks.preCommit||!Array.isArray(cfg.hooks.preCommit.chain))throw new Error("plan-forge.json missing hooks.preCommit.chain[]");if(cfg.hooks.preCommit.chain.length<1)throw new Error("chain must contain at least the master-reject entry")'
bash -c "cd pforge-mcp && npx vitest run tests/precommit-chain.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

---

### Parallel Merge Checkpoint — after Group P1 (S1, S2)

Before starting S3, the orchestrator MUST:
1. Merge S1 and S2 commits into the working branch
2. Re-run `bash -c "cd pforge-mcp && npx vitest run"` (full suite) and confirm green — catches accidental shared-import regressions even though file-level scopes were disjoint
3. Re-run `pwsh -NoProfile -File pforge.ps1 check` and confirm zero new errors
4. Confirm the S0 baseline snapshots are still byte-identical except for any deltas explicitly introduced by S1/S2

---

### Slice 3: A2 — `forge_diff_classify` tool + wire into S2 chain

**Parallelism:** [sequential] — depends on S2's `plan-forge.json` chain schema; both touch `plan-forge.json` so they cannot interleave.

**Depends On:** Slice 2 (PreCommit chain framework), Slice 0

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/security.instructions.md](../../.github/instructions/security.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)
- [.github/instructions/api-patterns.instructions.md](../../.github/instructions/api-patterns.instructions.md)

**Scope** (files in scope):
- `pforge-mcp/diff-classify.mjs` (new — implements the classifier; reads `git diff --cached` output; calls cheap-tier model; returns `{ severity, findings[] }`)
- `pforge-mcp/server.mjs` (register `forge_diff_classify` tool handler)
- `pforge-mcp/capabilities.mjs` (add `forge_diff_classify` to `TOOL_METADATA` with intents, aliases, example, error codes)
- `templates/.github/hooks/scripts/check-diff-classify.sh` (new — shim that calls `forge_diff_classify` via local MCP, returns deny on `severity >= high`)
- `templates/.github/hooks/scripts/check-diff-classify.ps1` (mirror)
- `templates/.github/hooks/plan-forge.json` (register as second `hooks.preCommit.chain[]` entry)
- `pforge-mcp/tests/diff-classify.test.mjs` (new — one test per category from decision #3, plus severity-threshold tests, plus end-to-end test that the PreCommit chain blocks a known-bad diff)

**Worker guidance**: the classifier prompt + rubric live in `diff-classify.mjs`. Keep the prompt under 50 lines; cheap-tier models perform better with short, structured rubrics. Test fixtures (known-bad diffs) live in `pforge-mcp/tests/fixtures/diff-classify/`.

**Validation Gate**:

```bash
node -e 'for (const f of ["pforge-mcp/diff-classify.mjs","templates/.github/hooks/scripts/check-diff-classify.sh","templates/.github/hooks/scripts/check-diff-classify.ps1","pforge-mcp/tests/diff-classify.test.mjs"]) require("fs").accessSync(f)'
node -e 'const c=require("fs").readFileSync("pforge-mcp/capabilities.mjs","utf-8");if(!c.includes("forge_diff_classify"))throw new Error("capabilities.mjs missing forge_diff_classify in TOOL_METADATA")'
node -e 'const cfg=JSON.parse(require("fs").readFileSync("templates/.github/hooks/plan-forge.json","utf-8"));const names=cfg.hooks.preCommit.chain.map(e=>e.name||e.command||"");if(!names.some(n=>n.includes("diff-classify")))throw new Error("plan-forge.json preCommit.chain missing diff-classify entry")'
bash -c "cd pforge-mcp && npx vitest run tests/diff-classify.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/precommit-chain.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

> **Recommended session break here.** S0–S3 complete the Safe-Outputs unit (A1+A3+A2). Commit, push, start a new session, and resume with `pforge run-plan --resume-from 4 docs/plans/Phase-WORKER-GUARDRAILS-PLAN.md`.

---

### Slice 4: A5 — `network.allowed` frontmatter + log-only proxy

**Parallelism:** [sequential] — touches `pforge-mcp/orchestrator.mjs` (shared with S5, S6). S4→S5→S6 must be strictly sequential.

**Depends On:** Slice 0

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/security.instructions.md](../../.github/instructions/security.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)
- [.github/instructions/observability.instructions.md](../../.github/instructions/observability.instructions.md)

**Scope** (files in scope):
- `pforge-mcp/orchestrator.mjs` (parse `network.allowed`; when present, spawn proxy + inject env vars into worker)
- `pforge-mcp/proxy-logger.mjs` (new — ~50 LOC HTTPS proxy on `127.0.0.1:<ephemeral>`, logs `{ host, method, timestamp }` to `.forge/runs/<run-id>/slices/<n>/network.log`)
- `pforge-mcp/tests/network-allowlist.test.mjs` (new — covers: parse, proxy spawn, env injection, log format. Does NOT assert enforce-mode behavior — log-only this phase per decision #4)

**Worker guidance**: the proxy is in-process Node, not Squid. When `network.enforce: true` is also set on the plan (no plan ships this), the proxy returns 403 for unlisted hosts; otherwise it logs and forwards. **Default mode for this phase = log only.**

**Validation Gate**:

```bash
node -e 'for (const f of ["pforge-mcp/proxy-logger.mjs","pforge-mcp/tests/network-allowlist.test.mjs"]) require("fs").accessSync(f)'
node -e 'const c=require("fs").readFileSync("pforge-mcp/orchestrator.mjs","utf-8");if(!/network\.allowed|network\?\.allowed|networkAllowed/.test(c))throw new Error("orchestrator.mjs does not reference network.allowed")'
bash -c "cd pforge-mcp && npx vitest run tests/network-allowlist.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

---

### Slice 5: A6 — `lockHash` frontmatter + enforcement

**Parallelism:** [sequential] — touches `orchestrator.mjs` (shared with S4, S6).

**Depends On:** Slice 4

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/security.instructions.md](../../.github/instructions/security.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)
- [.github/instructions/ai-plan-hardening-runbook.instructions.md](../../.github/instructions/ai-plan-hardening-runbook.instructions.md)

**Scope** (files in scope):
- `pforge-mcp/orchestrator.mjs` (compute hash per decision #6 on plan load; verify against frontmatter `lockHash` if present; refuse to run on mismatch with clear error)
- `.github/prompts/step2-harden-plan.prompt.md` (append final step: emit `lockHash:` line in frontmatter — template-only change, does not retroactively re-harden anything)
- `pforge-mcp/tests/plan-frontmatter-extensions.test.mjs` (new — initial scaffold, covers `lockHash` parse + compute + match + mismatch)

**Worker guidance**: hash scope is exactly what's in decision #6, no more. The hash is intended to detect *body drift*, not frontmatter edits. A plan without `lockHash` runs exactly like today.

**Validation Gate**:

```bash
node -e 'for (const f of ["pforge-mcp/tests/plan-frontmatter-extensions.test.mjs",".github/prompts/step2-harden-plan.prompt.md"]) require("fs").accessSync(f)'
node -e 'const c=require("fs").readFileSync("pforge-mcp/orchestrator.mjs","utf-8");if(!/lockHash/.test(c))throw new Error("orchestrator.mjs does not reference lockHash")'
node -e 'const c=require("fs").readFileSync(".github/prompts/step2-harden-plan.prompt.md","utf-8");if(!/lockHash/.test(c))throw new Error("step2-harden prompt does not mention lockHash")'
bash -c "cd pforge-mcp && npx vitest run tests/plan-frontmatter-extensions.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

---

### Slice 6: A8 — `tools.deny` frontmatter + MCP bridge filter

**Parallelism:** [sequential] — touches `orchestrator.mjs` (shared with S4, S5).

**Depends On:** Slice 5

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/security.instructions.md](../../.github/instructions/security.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)

**Scope** (files in scope):
- `pforge-mcp/orchestrator.mjs` (parse `tools.deny`; pass to bridge at worker spawn)
- `pforge-mcp/bridge.mjs` (at MCP session init, strip listed tools from advertised tool list)
- `pforge-mcp/tests/plan-frontmatter-extensions.test.mjs` (extend — add `tools.deny` cases: empty deny (no-op), one tool denied (advertised list shrinks by 1), denied tool name not in registry (no-op + log a warning))

**Worker guidance**: denylist defaults empty. NEVER ship a starter deny set (forbidden action). The filter happens at the advertise step — worker should never see the denied tool exists. No fallback prompt.

**Validation Gate**:

```bash
node -e 'const c=require("fs").readFileSync("pforge-mcp/orchestrator.mjs","utf-8");if(!/tools\.deny|toolsDeny/.test(c))throw new Error("orchestrator.mjs does not reference tools.deny")'
node -e 'const c=require("fs").readFileSync("pforge-mcp/bridge.mjs","utf-8");if(!/tools\.deny|toolsDeny|deniedTools/.test(c))throw new Error("bridge.mjs does not filter on tools.deny")'
bash -c "cd pforge-mcp && npx vitest run tests/plan-frontmatter-extensions.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

> **Recommended session break here.** S4–S6 complete the Frontmatter Cluster (A5+A6+A8). Commit, push, start a new session, and resume with `pforge run-plan --resume-from 7 docs/plans/Phase-WORKER-GUARDRAILS-PLAN.md`.

---

### Slice 7: A7 — `--objective` mode on `forge_tempering_run`

**Parallelism:** [sequential] — touches `capabilities.mjs` and the tempering handler (likely `server.mjs`). Both files are shared with other slices' indirect concerns; serialize.

**Depends On:** Slice 6

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)
- [.github/instructions/api-patterns.instructions.md](../../.github/instructions/api-patterns.instructions.md)

**Scope** (files in scope):
- The file housing `forge_tempering_run` handler (confirm exact path at harden time — likely `pforge-mcp/server.mjs` + a tempering helper)
- `pforge-mcp/capabilities.mjs` (update `forge_tempering_run` `inputSchema` to include `objective.command` + `objective.acceptIf`)
- `pforge-mcp/tests/tempering-objective.test.mjs` (new — covers: no objective (existing behavior), greater accepts higher number, greater rejects lower number, less accepts lower number, non-numeric stdout fails fast, non-zero exit fails fast, baseline captured before worker runs)

**Worker guidance**: baseline-capture-then-compare per decision #10. Worker MUST NOT see the baseline number — that defeats the point. If `<cmd>` ever fails (non-zero exit), the candidate is rejected (do not commit) and the error surfaces.

**Validation Gate**:

```bash
node -e 'for (const f of ["pforge-mcp/tests/tempering-objective.test.mjs"]) require("fs").accessSync(f)'
node -e 'const c=require("fs").readFileSync("pforge-mcp/capabilities.mjs","utf-8");const idx=c.indexOf("forge_tempering_run");if(idx<0)throw new Error("forge_tempering_run missing from capabilities.mjs");const block=c.slice(idx,idx+4000);if(!/objective/.test(block))throw new Error("forge_tempering_run inputSchema does not mention objective")'
bash -c "cd pforge-mcp && npx vitest run tests/tempering-objective.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

---

### Slice 8: A4 — `plan-health-auditor.agent.md`

**Parallelism:** [parallel-safe, Group P2] — only touches new agent file + new test; no shared files with S4–S7.

**Depends On:** Slice 0 (does NOT require S4–S7; can run any time after baselines exist)

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)
- [.github/instructions/status-reporting.instructions.md](../../.github/instructions/status-reporting.instructions.md)

**Scope** (files in scope):
- `.github/agents/plan-health-auditor.agent.md` (new — read-only agent; tool allowlist: `forge_master_ask`, `forge_cost_report`, `forge_health_trend`, `forge_bug_list`, `forge_team_activity`, `brain_recall`, plus filesystem read of `.forge/orchestrator-logs/`, `.forge/runs/`, `/memories/repo/`)
- `pforge-mcp/tests/plan-health-auditor.test.mjs` (new smoke test — synthesize fake `.forge/runs/` data, invoke the agent via `forge_master_ask` with a `@plan-health-auditor` mention, assert report file exists at `.forge/health/latest.md` and contains the expected section headings)
- `docs/manual/customization.html` row in the agents table (will be added in S10; flagged here for traceability — slice does NOT touch HTML)

**Worker guidance**: the agent is a markdown file. The "runtime" is the existing `forge_master_ask` orchestrator. Output sections required: "Top Failure Modes (last 14d)", "Recurring Gate-Portability Issues", "Slice Retry Rate Trend", "Proposed Patches" (with file paths + suggested changes).

**Validation Gate**:

```bash
node -e 'for (const f of [".github/agents/plan-health-auditor.agent.md","pforge-mcp/tests/plan-health-auditor.test.mjs"]) require("fs").accessSync(f)'
node -e 'const c=require("fs").readFileSync(".github/agents/plan-health-auditor.agent.md","utf-8");for (const section of ["Top Failure Modes","Recurring Gate-Portability","Slice Retry Rate","Proposed Patches"]){if(!c.includes(section))throw new Error("agent file missing expected output section heading: "+section)}'
bash -c "cd pforge-mcp && npx vitest run tests/plan-health-auditor.test.mjs"
bash -c "cd pforge-mcp && npx vitest run tests/baselines.test.mjs"
```

---

### Parallel Merge Checkpoint — after S4–S8 cluster

Before starting S9, the orchestrator MUST:
1. Confirm S4→S5→S6→S7 landed in that order on the working branch (sequential chain)
2. Merge S8's commits in (parallel-safe with S4–S7 but must land before S9 so the full suite includes the agent test)
3. Re-run `bash -c "cd pforge-mcp && npx vitest run"` and confirm green
4. Confirm `forge_capabilities` payload size growth is still within the 10% per-slice MUST

---

### Slice 9: Full QA sweep + new test suites green together

**Parallelism:** [sequential] — cross-cutting; aggregates evidence from all prior slices.

**Depends On:** Slice 1 through Slice 8

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)
- [.github/instructions/status-reporting.instructions.md](../../.github/instructions/status-reporting.instructions.md)

**Scope** (files in scope):
- `pforge-mcp/tests/__baselines__/capabilities.snapshot.json` (updated — expected to grow by exactly the new tool + new flag + new frontmatter fields; diff must match the expected delta)
- `pforge-mcp/tests/full-suite-regression.test.mjs` (new — runs the full vitest suite header as a smoke + diffs capabilities snapshot delta against an expected list of additions)

**Worker guidance**: this slice is about *evidence*, not new behavior. Update the baseline snapshot ONLY for the deltas explicitly added by S1–S8; any unexplained snapshot drift is a regression and must be investigated before committing this slice. Run `pwsh -NoProfile -File pforge.ps1 check` and confirm clean.

**Validation Gate**:

```bash
node -e 'for (const f of ["pforge-mcp/tests/full-suite-regression.test.mjs"]) require("fs").accessSync(f)'
bash -c "cd pforge-mcp && npx vitest run"
node -e 'const cur=JSON.parse(require("fs").readFileSync("pforge-mcp/tests/__baselines__/capabilities.snapshot.json","utf-8"));const names=Object.keys(cur.tools||{});if(!names.includes("forge_diff_classify"))throw new Error("baseline snapshot did not register forge_diff_classify after S3 landed")'
node -e 'const fs=require("fs");const plans=fs.readdirSync("docs/plans").filter(f=>f.endsWith("-PLAN.md"));if(plans.length===0)throw new Error("no plans found to regression-check")'
```

---

### Slice 10: Docs sweep + auto-discovery

**Parallelism:** [sequential] — docs aggregation slice.

**Depends On:** Slice 9

**Context Files** (load before running):
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)
- [.github/instructions/status-reporting.instructions.md](../../.github/instructions/status-reporting.instructions.md)

**Scope** (files in scope):
- `pforge-mcp/capabilities.mjs` `TOOL_METADATA` (final pass — confirm A1/A2/A3/A5/A6/A7/A8 fully documented in tool metadata and frontmatter-field metadata)
- `docs/capabilities.md` (regenerated from `forge_capabilities` output)
- `docs/llms.txt` (regenerated — new concepts listed)
- root `llms.txt` (regenerated — new concepts listed)
- `docs/manual/customization.html` (Lifecycle Hooks table — PreCommit chain expansion, new chain entries; Agents table — `plan-health-auditor` row)
- `docs/manual/forge-json-reference.html` (new `hooks.preCommit.chain[]` section)
- `docs/manual/environment-variables-reference.html` (`PFORGE_NETWORK_LOG_ONLY` row)
- `docs/manual/errors-and-exit-codes.html` (new codes: `diff-classify-blocked`, `lock-hash-mismatch`, `network-allowlist-violation`, `tool-denied`, `forbidden-action-glob`)
- `docs/manual/glossary.html` (5 new terms)
- `docs/manual/book-index.html` (5 new index entries)
- `docs/EXTENSIONS.md` (none — confirm at harden time whether `--objective` belongs here or in CLI-GUIDE)
- `docs/CLI-GUIDE.md` (new `--objective` flag on tempering)
- `CHANGELOG.md` (8 entries tagged `[A1]`..`[A8]`, grouped under one minor-version section header)
- `VERSION` (MINOR bump per decision #15)

**Worker guidance**: this slice is mechanical doc-writing. Every concept must appear in (a) `forge_capabilities` payload, (b) `llms.txt`, (c) the relevant manual HTML page, (d) glossary, (e) CHANGELOG. The drift check in the gate enforces (a)–(e).

**Validation Gate**:

```bash
node -e 'const c=require("fs").readFileSync("docs/capabilities.md","utf-8");for(const term of ["forge_diff_classify","network.allowed","lockHash","tools.deny","PreCommit chain","plan-health-auditor","--objective"]){if(!c.includes(term))throw new Error("docs/capabilities.md missing: "+term)}'
node -e 'const c=require("fs").readFileSync("docs/llms.txt","utf-8");for(const term of ["forge_diff_classify","plan-health-auditor","network.allowed","lockHash","tools.deny"]){if(!c.includes(term))throw new Error("docs/llms.txt missing: "+term)}'
node -e 'const c=require("fs").readFileSync("llms.txt","utf-8");for(const term of ["forge_diff_classify","plan-health-auditor"]){if(!c.includes(term))throw new Error("root llms.txt missing: "+term)}'
node -e 'const c=require("fs").readFileSync("docs/manual/glossary.html","utf-8");for(const term of ["PreCommit Chain","Diff Classifier","Plan Lock Hash","Tool Denylist","Network Allowlist"]){if(!c.includes(term))throw new Error("glossary.html missing: "+term)}'
node -e 'const c=require("fs").readFileSync("docs/manual/customization.html","utf-8");if(!/plan-health-auditor/.test(c))throw new Error("customization.html agents table missing plan-health-auditor row")'
node -e 'const c=require("fs").readFileSync("docs/manual/errors-and-exit-codes.html","utf-8");for(const code of ["diff-classify-blocked","lock-hash-mismatch","network-allowlist-violation","tool-denied"]){if(!c.includes(code))throw new Error("errors-and-exit-codes.html missing: "+code)}'
node -e 'const c=require("fs").readFileSync("docs/manual/forge-json-reference.html","utf-8");if(!/hooks\.preCommit\.chain|preCommit\.chain/.test(c))throw new Error("forge-json-reference.html missing hooks.preCommit.chain section")'
node -e 'const c=require("fs").readFileSync("CHANGELOG.md","utf-8");for(const tag of ["[A1]","[A2]","[A3]","[A4]","[A5]","[A6]","[A7]","[A8]"]){if(!c.includes(tag))throw new Error("CHANGELOG.md missing entry tagged "+tag)}'
node -e 'const v=require("fs").readFileSync("VERSION","utf-8").trim();if(!/^\d+\.\d+\.\d+/.test(v))throw new Error("VERSION not semver: "+v)'
bash -c "cd pforge-mcp && npx vitest run"
```

---

### Slice 11: Retro

**Parallelism:** [sequential] — final slice.

**Depends On:** Slice 10

**Context Files** (load before running):
- [.github/instructions/status-reporting.instructions.md](../../.github/instructions/status-reporting.instructions.md)

**Scope** (files in scope):
- `docs/plans/Phase-WORKER-GUARDRAILS-PLAN.md` (this file — append `## What actually shipped` section)
- `docs/research/gh-aw-agent-factory-comparison.md` (append running-log entry pointing at the shipped phase)

**Worker guidance**: pure documentation. Record per-slice LOC delta, tests added, capabilities payload growth %, and any decisions that moved during execution.

**Validation Gate**:

```bash
node -e 'const c=require("fs").readFileSync("docs/plans/Phase-WORKER-GUARDRAILS-PLAN.md","utf-8");if(!c.includes("## What actually shipped"))throw new Error("retro section not appended")'
node -e 'const c=require("fs").readFileSync("docs/research/gh-aw-agent-factory-comparison.md","utf-8");if(!/Phase-WORKER-GUARDRAILS-PLAN.*shipped|shipped.*Phase-WORKER-GUARDRAILS/.test(c))throw new Error("scratchpad running log not updated with shipped phase pointer")'
```

---

## Rollback Plan

Per slice. Each slice = one commit. To roll back slice N: `git revert <commit-sha>`. Because every slice's new behavior is opt-in (new frontmatter fields default to absent) or strictly additive (new tool, new chain entry), reverting a single slice does NOT regress unrelated functionality.

The only slice with a behavior change for existing setups is **S1** (Forbidden Actions matcher tightening). Decision #16 commits to the strict-superset rule: any path blocked today remains blocked. If S1 regresses any existing plan's execution, revert S1 and re-harden the matcher rules with the failing case as a new test fixture.

---

## QA Strategy Summary

| Test layer | Where | What it covers |
|---|---|---|
| **Baseline snapshots** (S0) | `pforge-mcp/tests/__baselines__/` | Today's `forge_capabilities`, plan-parse, hook-deny, estimate outputs — every later slice diffs against these |
| **Per-slice vitest suites** | `pforge-mcp/tests/<feature>.test.mjs` | Each A# gets its own suite; gate runs only that suite for fast feedback |
| **Cross-slice baseline re-check** | Every slice's gate runs `baselines.test.mjs` | Catches accidental side-effects on unrelated surfaces |
| **Full suite regression** (S9) | `bash -c "cd pforge-mcp && npx vitest run"` | All suites pass together; baseline snapshots updated with expected deltas only |
| **Plan-validity sweep** (S9) | `pwsh -NoProfile -File pforge.ps1 check` | Confirms existing plans still parse and validate |
| **Estimate stability** (S9) | `pwsh -NoProfile -File pforge.ps1 run-plan --estimate` on a canonical plan | Confirms cost projection unchanged (no surprise tool-call growth from new chain entries) |
| **Doc + auto-discovery completeness** (S10) | Gate greps each new concept across `capabilities.md`, `llms.txt`, manual HTML, CHANGELOG | Forces every concept into every discoverability surface |

---

## Re-anchor Checkpoints

The executor MUST re-verify plan alignment at each of these points. If a check fails, STOP and surface the drift before continuing.

| Checkpoint | What to verify | If drift detected |
|---|---|---|
| **Before each slice** | Slice's `Depends On` list of prior slices have committed and their tests are still green on the current branch tip | Abort the slice; revert to the last green commit and re-evaluate the slice plan |
| **After S3** (end of Safe-Outputs unit) | A1+A2+A3 work together \u2014 forbidden-action deny + PreCommit chain + diff-classify chain entry can all fire on the same commit without conflict | Open an incident; do not start S4 until reconciled |
| **After S6** (end of Frontmatter Cluster) | A plan with NONE of the new frontmatter fields runs byte-identically to its S0 baseline log | Roll back the offending slice; the absent-default invariant is a hard MUST |
| **After S8** (end of feature work) | `forge_capabilities` payload growth is still \u2264 10% per slice cumulatively | Trim docstrings or move examples out of the payload before S9 |
| **After S9** | The expected snapshot delta exactly matches the documented additions (`forge_diff_classify` tool, `objective` flag, three frontmatter fields, one agent) \u2014 no surprises | Investigate the surprise; do not start S10 docs sweep until snapshot delta is fully explained |
| **After S10** | Every new concept is discoverable via `forge_capabilities` AND `llms.txt` AND the manual AND the glossary | Add the missing entry before claiming S10 complete \u2014 the gate enforces this but spot-check manually |

---

## Definition of Done

This phase is DONE when ALL of the following are true:

- [ ] All 12 slices (S0\u2013S11) committed on the working branch with the conventional commit messages defined below
- [ ] Full `bash -c "cd pforge-mcp && npx vitest run"` passes (every suite green, including the new ones from S1\u2013S8)
- [ ] `pwsh -NoProfile -File pforge.ps1 check` reports zero new validation errors compared to the S0 baseline
- [ ] `forge_capabilities` payload reflects all new surface (new tool, new `objective` flag, three new frontmatter fields, new agent)
- [ ] `docs/capabilities.md`, root `llms.txt`, and `docs/llms.txt` are regenerated and mention every new concept
- [ ] `docs/manual/{customization,forge-json-reference,environment-variables-reference,errors-and-exit-codes,glossary,book-index}.html` each contain entries for the relevant new concepts
- [ ] `CHANGELOG.md` has one entry per action tagged `[A1]` through `[A8]` under a single new MINOR-version section header
- [ ] `VERSION` is bumped MINOR (per decision #15). The git tag itself is NOT created in this plan \u2014 release is a separate phase
- [ ] S11 retro section appended to this plan's body with per-slice LOC delta, tests added, and capabilities payload growth %
- [ ] Scratchpad `docs/research/gh-aw-agent-factory-comparison.md` running-log updated with a pointer to the shipped phase
- [ ] **Reviewer Gate passed** (zero \ud83d\udd34 Critical findings from the Reviewer Gate agent / `step5-review-gate` prompt). Document the reviewer's verdict in the retro section.
- [ ] No untracked files remain inside any of this plan's Scope paths
- [ ] `git push` succeeded to the project's remote

---

## Stop Conditions

The orchestrator (or executor) MUST stop and surface the issue \u2014 NOT auto-retry or paper over \u2014 if ANY of the following occur:

| Condition | Why we stop | Recovery |
|---|---|---|
| **Build failure** (any `npm test` or vitest gate returns non-zero on the slice's own suite after one retry) | Retrying a broken suite hides bugs. The slice's contract is broken. | Diagnose root cause, fix in the same slice, re-run gate. Do not commit until green. |
| **Baseline regression** (any prior slice's snapshot diff reveals an unexplained delta) | The current slice has side-effects outside its declared Scope. | Revert the slice's commit, narrow the change, retry. |
| **Scope violation** (slice's commit touches a file outside its declared `Scope` list) | The PreToolUse forbidden-actions hook should have caught this; if it didn't, S1 has a regression. | Stop, revert, re-evaluate S1's matcher. |
| **Security incident** (`forge_secret_scan` or `forge_diff_classify` reports `severity: critical` on any commit attempt) | Critical security finding overrides everything. | File a `forge_bug_register` entry, halt the plan, escalate to operator. |
| **MUST acceptance criterion violated** during a slice (e.g. capabilities payload grew >10% in one slice) | The plan's MUST list is the contract. A MUST violation falsifies the plan. | Stop, refactor the slice to fit the MUST, OR open a Required-Decision change request and re-harden the plan. |
| **`lockHash` mismatch** detected at orchestrator startup (only relevant after S5 has shipped in a prior run) | The plan body changed since hardening; running stale execution against a drifted plan corrupts outcomes. | Re-run Step 2 hardening to regenerate `lockHash`, then resume. |
| **External dependency unmet** \u2014 the `Execution Hold` checklist above is no longer satisfied (e.g. a parallel agent is now editing `orchestrator.mjs`) | Concurrent edits to shared files cause silent merge conflicts that the slice's gate cannot detect. | Pause, re-enter hold, resume only when the hold checklist is green again. |
| **Cost overrun** \u2014 actual cost per slice exceeds the per-slice estimate by >50% | Indicates the cheap-tier model attribution (decision #3) is mis-wired, OR the worker is in a retry loop. | Inspect `forge_cost_report`, identify the culprit, fix attribution OR cap retries before re-running the slice. |

---

## Commit message convention

```
feat(<scope>): <A#> \u2014 <summary>
```

Where:
- `<scope>` is one of: `hooks`, `mcp`, `plan-parser`, `agents`, `docs`, `tests`, `release`
- `<A#>` is the action ID this commit advances (e.g. `A1`, `A3`). Use `S<n>` for cross-cutting slices (S0, S9, S11).
- `<summary>` is the slice's one-line objective.

Examples:
- `feat(hooks): A1 \u2014 expand forbidden-actions matcher to globs, dirs, intent lines`
- `feat(mcp): A2 \u2014 add forge_diff_classify tool + wire into PreCommit chain`
- `feat(tests): S0 \u2014 capture today's baselines for capabilities, plan-parse, hook-deny, estimate`
- `chore(release): S10 \u2014 docs sweep + auto-discovery + CHANGELOG entries + MINOR bump`

The orchestrator's commit template auto-fills `<scope>` and `<A#>` per slice; the worker fills `<summary>`.

---

## Decisions Resolution Summary

All 18 Required Decisions are resolved \u2014 zero TBDs remain.

| # | Decision | Status | Resolution (one-liner) |
|---|----------|--------|------------------------|
| 1 | A1 matcher expansion | RESOLVED | Globs + directory prefixes + `**Do NOT**` intent lines; superset of today |
| 2 | A1 cross-shell parity | RESOLVED | Mirror `.sh` and `.ps1`; gate enforces template/working-copy byte equality |
| 3 | A2 severity categories | RESOLVED | `low` / `medium` / `high` / `critical`; high+ blocks |
| 4 | A5 enforce vs log | RESOLVED | Log-only this phase; `PFORGE_NETWORK_LOG_ONLY=1` default; no plan ships `enforce: true` |
| 5 | A5 proxy implementation | RESOLVED | In-process Node, ~50 LOC, ephemeral port on `127.0.0.1` |
| 6 | A6 hash scope | RESOLVED | Plan body sans frontmatter sans whitespace runs; SHA-256 |
| 7 | A6 mismatch behavior | RESOLVED | Refuse to run, clear error pointing at hash diff |
| 8 | A8 deny semantics | RESOLVED | Denylist (not allowlist); defaults empty; filter at MCP advertise step |
| 9 | A8 fallback | RESOLVED | None \u2014 denied tools are invisible to the worker |
| 10 | A7 objective contract | RESOLVED | `{ command, acceptIf: "greater"|"less" }`; baseline-capture-then-compare; numeric-only |
| 11 | A4 agent surface | RESOLVED | Markdown agent file invoked via `forge_master_ask @plan-health-auditor` |
| 12 | A4 tool allowlist | RESOLVED | Read-only set (see Slice 8 Scope); gate enforces no-write |
| 13 | A3 chain protocol | RESOLVED | Same JSON-from-stdout protocol PreToolUse already uses |
| 14 | A3 ordering | RESOLVED | Master-branch reject is FIRST chain entry; diff-classify is second |
| 15 | Versioning | RESOLVED | One MINOR bump in S10; no tag created in this plan |
| 16 | A1 backward compat | RESOLVED | Strict superset rule \u2014 anything blocked today remains blocked |
| 17 | Test fixture location | RESOLVED | `pforge-mcp/tests/__baselines__/` + `pforge-mcp/tests/fixtures/diff-classify/` |
| 18 | Auto-discovery scope | RESOLVED | S10 covers `forge_capabilities`, `llms.txt`, all manual HTML pages, CHANGELOG, glossary, book-index |

**Plan hardened \u2705** \u2014 execution deferred per user request. Lift the `Execution Hold` checklist above when ready, then run `pforge run-plan docs/plans/Phase-WORKER-GUARDRAILS-PLAN.md`.
---

## Hardening Audit Trail

- **Step 2 hardening applied**: 2026-05-18 (this session)
- **Gate linter result**: `lintGateCommands` from `pforge-mcp/orchestrator.mjs` → **0 errors, 57 warnings, 0 portability warnings** across 12 slices. The orchestrator preflight will pass (errors only block). All warnings classified as known stylistic false-positives:
  - **W1 `bash -c`** (most warnings): every vitest gate uses `bash -c "cd pforge-mcp && npx vitest run tests/<file>"`. This is the **preferred pattern** documented in `.github/prompts/step2-harden-plan.prompt.md` ("Preferred gate pattern" section), and v2.93.1's `runGate` routes literal `bash -c` through Git Bash on Windows. The `cd pforge-mcp &&` chain is required because vitest config is workspace-local.
  - **`vitest-direct-node` rule** (false positive): the rule's regex `/^node\s+.*\.test\.(mjs|js|ts)/` matches any `node -e '...'` script whose argument string happens to mention a test filename (e.g. `accessSync(["pforge-mcp/tests/baselines.test.mjs"])`). The actual command is `node -e`, not `node tests/X.test.mjs`. Tracked as a linter sharpening candidate, not a plan defect.
  - **W2 pipeline-node**: triggered on a few coalesced `node -e '...' && bash -c "..."` lines; the `&&` chain (not a pipe) is correctly executed by `runGate`.
- **Session Budget Check**: 12 slices total. Recommended commit-and-resume points are inlined in the slice bodies above — break after **S3** (Safe-Outputs unit) and after **S6** (Frontmatter Cluster).
- **Release-Slice Hardening**: N/A per decision #15 — this plan ships a MINOR version bump in S10 but does NOT create a git tag (release is a separate phase). Release-slice tag-collision and retrograde gates are not required.

If a future linter version reclassifies any of the above warnings as errors, re-evaluate before resuming execution.

---

## What actually shipped

> **Retro completed**: 2026-05-18 (Slice 11 — final slice)

All 11 slices (S0–S10) shipped without requiring any plan amendments. The phase delivered every action in the agreed A1–A8 set plus the baseline harness (S0), full QA sweep (S9), and docs sweep (S10).

### Shipped actions

| Action | Slice | Commits | What landed |
|--------|-------|---------|-------------|
| **S0** baseline | S0 | `3c653a1` | Vitest baseline test harness capturing capabilities payload, plan-parse output, hook-deny behavior, and estimate baseline |
| **A1** Forbidden-Actions matcher | S1 | `bf02aca` | Expanded matcher: glob patterns, directory prefixes, and `**Do NOT**` intent-line matching; strict superset of prior substring match |
| **A3** PreCommit chain | S2 | `57a8c0d`, `0a7ea48` | PreCommit hook chain framework; master-branch reject promoted to first hard chain entry; chain protocol matches `{ blocked, reason }` JSON |
| **A2** `forge_diff_classify` | S3 | `1cd0308` | New MCP tool wired into PreCommit chain; cheap-tier model; `high`/`critical` block, `medium` warn, `low` log; categories: leaked-secret, prompt-injection-echo, eval-exec-introduced, license-incompatible-paste, unexpected-network-call, large-binary-dump |
| **A5** network allowlist | S4 | `320144b`, `749ca10` | `network.allowed` plan frontmatter field; in-process Node proxy logging hostnames to slice run log; log-only mode default (`PFORGE_NETWORK_LOG_ONLY=1`) |
| **A6** `lockHash` | S5 | `a1bbb8c` | `lockHash` frontmatter field; orchestrator computes SHA-256 over slices + gates + scope contracts + forbidden actions at plan load; refuses run on mismatch; absent = backwards-compatible |
| **A8** `tools.deny` | S6 | `2fe0baf` | `tools.deny` frontmatter field; MCP bridge strips denied tools at session init; denylist semantics (absent = empty = no effect); worker never sees denied tools |
| **A7** `--objective` tempering | S7 | `cc1a540` | `--objective <cmd> --accept-if greater\|less` flag on `forge_tempering_run`; baseline captured before worker proposes; numeric stdout; non-zero exit = fail |
| **A4** Plan Health Auditor | S8 | `7d3e557` | `.github/agents/plan-health-auditor.agent.md`; read-only tool allowlist; output to `.forge/health/latest.md` + `.forge/health/<ISO-date>.md`; invoked via `forge_master_ask @plan-health-auditor` |
| **S9** full QA | S9 | `e040f6f` | All new test suites green together: `diff-classify.test.mjs`, `precommit-chain.test.mjs`, `plan-frontmatter-extensions.test.mjs`, `tempering-objective.test.mjs`, `forbidden-matcher.test.mjs` |
| **S10** docs sweep | S10 | `3cf6866`, `46f921a` | `forge_capabilities` payload updated; `llms.txt` (both); manual HTML pages (`customization.html`, `forge-json-reference.html`, `environment-variables-reference.html`, `errors-and-exit-codes.html`, `glossary.html`, `book-index.html`); `CHANGELOG.md` entries for A1–A8; MINOR version bump |

### What was NOT shipped (by design)

- A5 enforce mode — log-only this phase as planned; flip deferred to a later phase once real traffic data is available
- A6 `lockHash` auto-insertion in Step-2 hardener — deferred; the field can be hand-added when re-hardening a plan
- Dashboard surfacing for A4 health report — markdown file only this phase
- A7 objective-loop budget controls — `--max-iterations` and cost-cap deferred; flag ships in basic form
- Any new top-level CLI verb — all behavior reached users through existing surfaces as required

### Surprises and gotchas

- S2 required two commits to resolve a hook entry-point conflict — the first commit (`57a8c0d`) landed the chain runner framework; the second (`0a7ea48`) patched an em-dash editorial pass collision that had crept in from a parallel manual docs run. No plan amendment was needed.
- S4 picked up a duplicate commit (`320144b` then `749ca10`) due to a docs/manual hero-image fix landing between the two attempts. The second commit is canonical.
- Gate linter's `vitest-direct-node` false positive (flagged during hardening audit) did not surface as a real issue during execution — every vitest gate used the `bash -c "cd pforge-mcp && ..."` preferred pattern correctly.
- No slice violated the 500 net LOC soft cap except S10 (docs sweep), which was expected and called out in the plan.

### Reference

See `docs/research/gh-aw-agent-factory-comparison.md` for the full A1–A8 action list, dependency graph, and sequencing rationale that drove this phase.
