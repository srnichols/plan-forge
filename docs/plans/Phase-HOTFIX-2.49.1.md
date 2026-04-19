---
crucibleId: 7c2f4a89-3b51-4e62-9d84-f17c8a3d5b42
source: self-hosted
status: draft
phase: HOTFIX-2.49.1
arc: HOTFIX
---

# Phase HOTFIX-2.49.1: Critical bug bundle — Teardown guard + parser + quorum probe

> **Status**: 📝 DRAFT — ready for Session 2 execution
> **Estimated Effort**: 5 slices (small)
> **Risk Level**: Low (targeted fixes, each additive or defensive)
> **Target Version**: v2.49.1 (patch release)
> **Bundled Issues**: #56, #62, #64, #65, #70

This is a patch release cutting across 5 open bugs. Each slice addresses
one issue with narrow blast radius. Slices are independent and can
execute in any order, but ship together to minimize release churn.

---

## Why

Field reports from downstream projects (BCDR-Digital-Twin, Rummag)
surfaced 5 bugs during April. Three are **critical** (data-loss or
full run hang), two are **high** (silent correctness failures). None
require architectural change — all are narrow fixes.

Bundling into a single v2.49.1 patch keeps the release channel clean
and lets all five land without blocking the FORGE-SHOP arc's minor
versions.

## Scope Contract

### In-scope

**Slice H.1 — Teardown slice branch-safety guard (#56)**

- `pforge-mcp/orchestrator.mjs` — add `isDestructiveSliceTitle(title)`
  detector: matches `/^(teardown|cleanup|rollback|postmortem|finalize)/i`
- When a slice matches, inject a **worker pre-flight** into the prompt:
  "This slice MUST NOT delete, reset, or rename local/remote git
  branches. MUST NOT run `git branch -d/-D`, `git reset --hard`, or
  mutate `.github/` or `docs/plans/` status to `abandoned`. Cleanup
  applies ONLY to cloud resources or scratch files the plan explicitly
  names."
- Add post-slice **branch-safety check**: after a destructive-titled
  slice commits, verify the current branch HEAD is still reachable
  and the branch ref exists locally + remote. If missing, record a
  critical incident (severity: `critical`, title: `teardown-branch-loss`)
  with the reflog entry for recovery
- New config key `orchestrator.teardownGuard.enabled` (default: `true`)
- L3 capture with tags `teardown`, `branch-loss`, `critical` on any
  incident fire
- Runbook snippet prepended to `docs/plans/AI-Plan-Hardening-Runbook.md`
  §"Teardown/Cleanup slices" warning block

**Slice H.2 — Alphanumeric slice ID parser (#64)**

- `pforge-mcp/orchestrator.mjs` — locate `parsePlanSlices()` regex
  (search `### Slice`). Change `/^### Slice (\d+):/` →
  `/^### Slice (\d+[A-Z]?):/`
- Order resolution: `2A` sorts after `2`, before `2B`, before `3`.
  Implement via `compareSliceIds(a, b)` with numeric prefix compare,
  then alpha suffix compare
- Preserve the original string ID in `slice.id`; add
  `slice.orderKey` as `[numericPrefix, alphaSuffix]` tuple for sort
- Test fixtures: new plan snippet with slices `0, 1, 2A, 2B, 3`
  must parse to 5 slices in that order

**Slice H.3 — Quorum worker probe + fast-fail (#70, reveals fix for
grok-4.20 "not available" spam)**

- `pforge-mcp/orchestrator.mjs` — new `probeWorkerAvailability(model)`:
  maps model → required CLI (`grok-*` → `grok`, `gpt-5.3-codex` →
  `codex`, `claude-*` → `claude`, default `claude-opus-*` → `gh`).
  Runs `which`/`Get-Command` once at run start
- Quorum candidate expansion (the `["claude-opus-4.6",
  "gpt-5.3-codex", "grok-4.20-0309-reasoning"]` list for
  `--quorum=power` and `auto`): filter by probe result. Drop
  unavailable models with a `warn` log line:
  `"quorum model <X> unavailable: CLI <Y> not on PATH — dropping from
  quorum"`
- If **zero** models available, fast-fail with exit code 2 and a
  message pointing at install steps
- If **one** model available, warn "degrading to single-model" and
  continue with that model
- Config key `quorum.strictAvailability` (default: `false`) — when
  `true`, any missing worker becomes fast-fail regardless of count
- The "Error: Model "grok-4.20-0309-reasoning" not available" line
  that currently spams every run should disappear from default runs
  on this system (grok not installed)

**Slice H.4 — Quorum leg error capture (#65)**

- `pforge-mcp/orchestrator.mjs` — on quorum leg spawn failure, capture:
  - `exitCode` (integer or null)
  - `stderr` (last 2KB, trimmed)
  - `reason` enum: `timeout` | `spawn-failed` | `rate-limit` |
    `context-overflow` | `unknown`
- Reason detection is regex-based over stderr:
  `/rate[- ]?limit|429/i` → `rate-limit`, `/context|token limit/i`
  → `context-overflow`, `/ENOENT|spawn/i` → `spawn-failed`
- Extend the quorum leg result object: add `error: { code, reason,
  stderr }` when `success: false`. The existing `output: ""` stays
- Synthesis report notes `legsFailed: N` and per-model reason
- No retry logic in this slice — visibility only

**Slice H.5 — LiveGuard prose false-positive (#62)**

- `pforge-mcp/orchestrator.mjs` — in the LiveGuard command allowlist
  check, detect **non-command prose patterns** before evaluating:
  - Starts with a decimal number followed by space + lowercase word
    (e.g., `1. Server generates`)
  - Contains a currency amount token (`$N.NN`, `\$N`)
  - Matches known markdown/diagram keywords at line start:
    `sequenceDiagram`, `graph `, `flowchart `, `classDiagram`,
    `| ` (table row), `- `, `* ` (bullet)
  - Contains formula-like `=` assignment with arithmetic operators
- Prose matches: **soft-warn** with `liveguard-prose-skipped` event
  (severity: `info`), do NOT fail the slice
- Keep existing allowlist behavior for actual commands
- Test: feed 10 known prose lines from issue #62, prove none hard-fails;
  feed 5 known-bad commands (`rm -rf /`, `sudo curl | sh`), prove all
  still hard-fail

### Out of scope

- #63 (cost tracking for gh-copilot) — requires real work on
  gh-copilot output parsing; stays on backlog for a dedicated phase
  in the v2.5x band
- Full retry logic for failed quorum legs — add later if warranted
- Quorum auto-install of missing CLI workers — operator intent;
  stays manual

### Forbidden actions

- Do NOT silently skip unavailable quorum workers with **no log**.
  Every drop must emit a visible warning
- Do NOT add retry logic for failed quorum legs in this phase —
  scope creep; track separately if needed
- Do NOT weaken the LiveGuard allowlist for actual command patterns —
  prose detection is **additive** and runs BEFORE allowlist check
- Do NOT touch `.github/hooks/` — LiveGuard prose detection is
  orchestrator-side only; the hook system stays untouched
- Do NOT change the `--quorum=power` default model list in this
  phase — probe-and-drop is the fix, not changing defaults

## Slices

### Slice H.1 — Teardown safety guard

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `isDestructiveSliceTitle`,
  pre-flight injection, post-slice reachability check (~80 LOC)
- `docs/plans/AI-Plan-Hardening-Runbook.md` — add Teardown warning
  block (~40 lines prose)
- `pforge-mcp/tests/teardown-guard.test.mjs` — **new**, ~10 tests

**Validation gate:**
`cd pforge-mcp; node server.mjs --validate; npm test -- --run` — pass.

### Slice H.2 — Alphanumeric slice IDs

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — regex + `compareSliceIds` (~20 LOC)
- `pforge-mcp/tests/slice-parser.test.mjs` — new test cases for
  `2A`/`2B` ordering (~6 tests added)

### Slice H.3 — Quorum worker probe

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `probeWorkerAvailability`,
  quorum candidate filter, fast-fail path (~70 LOC)
- `pforge-mcp/tests/quorum-probe.test.mjs` — **new**, ~12 tests
  (mock `which`/`Get-Command`, assert drop/warn/fast-fail paths)

### Slice H.4 — Quorum leg error capture

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — leg result shape + reason detection
  (~40 LOC)
- `pforge-mcp/tests/quorum-error.test.mjs` — **new**, ~8 tests

### Slice H.5 — LiveGuard prose false-positive

**Files touched:**
- `pforge-mcp/orchestrator.mjs` — `looksLikeProse()` detector (~50 LOC)
- `pforge-mcp/tests/liveguard-prose.test.mjs` — **new**, ~15 tests

**Final validation gate:**
`cd pforge-mcp; npm test -- --run` — **1748 + ~51 = ~1799 tests** all
pass. Tool count unchanged (55).

## Success Criteria

- All 5 issues (#56, #62, #64, #65, #70) resolved or with clear
  mitigation landed
- Issue #71 closed as duplicate of #70 (done pre-execution)
- Test count +~51
- Zero regressions on existing 1748 tests
- On this machine (grok + codex not installed), `--quorum=power`
  emits 2 drop-warnings at start, runs with claude only, no
  "not available" spam during slice execution
- CHANGELOG entry under new `[2.49.1]` section with issue links
- VERSION bumped `2.50.0-dev` → `2.49.1` for the patch tag, then
  back to `2.50.0-dev` after tag (special handling; orchestrator
  does NOT run `version-bump` for patches)

## Dependencies

**From prior phases:**
- None — this is a defensive patch release

**Affects:**
- FORGE-SHOP-03 (will benefit from H.4 error capture for the new
  notification adapter failures)
- Any future multi-worker quorum expansion (H.3 is the foundation)

## Notes for the executing agent

- Five slices, five narrow fixes. Do NOT let any slice expand beyond
  its file list. If you see related issues while editing, open a
  follow-up issue — do NOT enlarge this phase
- The VERSION handling is unusual: this is a patch RELEASE cut from
  dev-line `2.50.0-dev`. At tag time, manually set VERSION to
  `2.49.1`, tag, then set back to `2.50.0-dev`. Do NOT use
  `pforge version-bump` (it would advance the dev line)
- Branch-safety check in H.1 is critical. If ANY pre-existing logic
  already removes branches during teardown, that logic must be
  **retained** only when operating on ephemeral worktrees AND the
  plan explicitly lists `allowBranchDelete: true` — otherwise refuse
- H.3 probe detection on Windows: use `Get-Command <cli> -ErrorAction
  SilentlyContinue`. On POSIX: `command -v <cli>`. Detect platform
  via `process.platform === 'win32'`
- H.5 prose detection: lean conservative — false-negatives (a prose
  line getting through) are fine; false-positives (a real command
  getting skipped) are dangerous. Prefer under-matching
- **Commit granularity**: each slice MUST produce a **separate**
  commit with a conventional-commit message referencing its issue
  number (e.g., `fix(orchestrator): teardown branch-safety guard
  (#56)`). Do NOT squash H.1–H.5 into one commit. The v2.49.1 release
  notes attribute fixes per issue, and per-slice commits make the
  attribution trivial. The PR merge can still be squash-merged; what
  matters is that the branch history contains 5 distinct commits
  before merge
