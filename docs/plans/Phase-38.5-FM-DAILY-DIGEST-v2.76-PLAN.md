---
crucibleId: 8406b431-fee8-4a0d-baec-49775a3b1e8b
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.5 — Forge-Master Daily Digest

> **Target release**: v2.76.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-37 shipped (v2.71.0) for probe harness. Phase-38.1 and 38.3 optional but recommended (digest richer when sessions + graph available).

---

## Specification Source

- **Problem**: Forge-Master is reactive — only answers when asked. Stale meta-bugs, stalled phases, drift score drops, and cost spikes go unnoticed until the user happens to check the dashboard.
- **Root cause**: No scheduled summary generator exists. Notification infrastructure (`extensions/notify-*`) exists but is only triggered by live incidents.
- **Contract**: After this phase, `pforge digest [--date <iso>] [--notify] [--force]` generates a structured daily digest covering: probe lane-match deltas, aging bugs, stalled phases, drift trend, cost anomaly. Routes via existing notifiers when `--notify` is passed. Idempotent.

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-mcp/digest/aggregator.mjs` — `buildDigest({projectDir, date, baselineDate}) → {sections, generatedAt}`. Sections: `probe-deltas`, `aging-bugs`, `stalled-phases`, `drift-trend`, `cost-anomaly`. Each section has 0..N items with `severity: "info"|"warn"|"alert"`.
- New `pforge-mcp/tests/digest-aggregator.test.mjs` — unit tests for aggregator.
- New `pforge-mcp/digest/render.mjs` — `renderMarkdown(digest)`, `renderJson(digest)`. Markdown for humans, JSON for machines/Slack blocks.
- New `pforge-mcp/tests/digest-render.test.mjs` — snapshot test for markdown + JSON stability.
- `pforge.ps1` + `pforge.sh` — add `digest [--date <iso>] [--notify] [--force]` commands.
- Dashboard tile `pforge-mcp/dashboard/forge-master.js` — "Yesterday's Digest" tile reads latest `.forge/digests/*.json`.
- New `pforge-mcp/tests/digest-dashboard.test.mjs` — unit test for dashboard tile rendering from fixture.
- `.github/workflows/forge-daily-digest.yml` — example GitHub Actions workflow (commented out by default).
- Digest output written to `.forge/digests/<YYYY-MM-DD>.json`.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.76.0 release metadata.

### Out of Scope

- ❌ Real-time alerts — those are LiveGuard's job.
- ❌ Modifying `extensions/notify-*` to add new notification channels.
- ❌ Auto-resolving stale items — read-only digest.
- ❌ Cross-project digest aggregation.
- ❌ New MCP tool — digest is CLI + scheduled workflow only.
- ❌ Changing build/operational/troubleshoot lane tool lists (Phase-32 guardrail).

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ Aggregator must not modify probe results, bug files, roadmap, drift history, or cost history — pure reader.
- ❌ `--notify` must reuse existing `extensions/notify-*` infrastructure — do not add new notification channels.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Digest storage path | Resolved | `.forge/digests/<YYYY-MM-DD>.json` |
| 2 | Idempotency | Resolved | Rerun on same date is no-op unless `--force` flag is passed |
| 3 | Severity gate for notifiers | Resolved | Configurable via `notify.config.json` routing rules; default: "alert" sections to PagerDuty, "warn"+ to Slack/email |
| 4 | GitHub Actions opt-in | Resolved | Workflow file exists but is commented out by default — user uncomments to activate cron |
| 5 | Empty/quiet day | Resolved | Digest renders "no significant deltas — all green" section, exits 0 |

---

## Acceptance Criteria

### Slice 1 — Digest aggregator

- **MUST**: `pforge-mcp/digest/aggregator.mjs` exports `buildDigest({projectDir, date, baselineDate})`.
- **MUST**: Return shape: `{sections: Array<{id, title, severity, items: [...]}>, generatedAt: string}`.
- **MUST**: `probe-deltas` section: compares today's probe results with `baselineDate` results; surfaces lane-match regressions.
- **MUST**: `aging-bugs` section: lists meta-bugs in `.forge/bugs/` older than 7 days with `open` status.
- **MUST**: `stalled-phases` section: reads `DEPLOYMENT-ROADMAP.md`; surfaces phases marked `in-progress` for > 14 days.
- **MUST**: `drift-trend` section: reads `.forge/drift-history.json` (if present); surfaces drops below threshold.
- **MUST**: `cost-anomaly` section: reads `.forge/cost-history.json` (if present); surfaces spikes > 2× the 7-day moving average.
- **MUST**: On a fresh repo with no artifacts, `buildDigest` returns a valid result with all sections present but empty (no-throw).
- **MUST**: `pforge-mcp/tests/digest-aggregator.test.mjs` passes covering: all 5 sections, empty-state, severity labels.

### Slice 2 — Digest renderer

- **MUST**: `pforge-mcp/digest/render.mjs` exports `renderMarkdown(digest)` and `renderJson(digest)`.
- **MUST**: `renderMarkdown` produces a human-readable Markdown string with `## Section Title` headings.
- **MUST**: `renderJson` returns a JSON object with `{version: "1", date, sections: [...]}` — stable machine-readable format.
- **MUST**: Snapshot test in `pforge-mcp/tests/digest-render.test.mjs` asserts that rendering the same fixture digest produces identical output on repeated runs (deterministic).
- **MUST**: Quiet-day digest renders a "all-green" section in both Markdown and JSON output.

### Slice 3 — CLI command + notifier dispatch

- **MUST**: `pforge digest --date 2026-04-22` generates the digest for that date, writes `.forge/digests/2026-04-22.json`, and prints the Markdown to stdout. Exits 0.
- **MUST**: Running the same command twice without `--force` is a no-op on the second run (writes nothing, prints "Digest already exists — use --force to regenerate"). Exits 0.
- **MUST**: `pforge digest --date 2026-04-22 --force` regenerates even if file exists.
- **MUST**: `pforge digest --notify` dispatches via configured `extensions/notify-*` channels; respects severity routing in `notify.config.json`.
- **MUST**: `pforge-mcp/tests/digest-aggregator.test.mjs` and `digest-render.test.mjs` both continue to pass.

### Slice 4 — GitHub Actions workflow + dashboard tile + release v2.76.0

- **MUST**: `.github/workflows/forge-daily-digest.yml` exists with a `schedule:` trigger commented out and a `workflow_dispatch:` trigger active.
- **MUST**: Dashboard in `pforge-mcp/dashboard/forge-master.js` has a "Yesterday's Digest" tile that reads the latest `.forge/digests/*.json` file on load.
- **MUST**: New `pforge-mcp/tests/digest-dashboard.test.mjs` passes verifying tile renders from a fixture digest JSON.
- **MUST**: `VERSION` contains exactly `2.76.0`.
- **MUST**: `CHANGELOG.md` has a `[2.76.0]` section mentioning `daily digest`, `aggregator`, and `notifier dispatch`.
- **MUST**: `ROADMAP.md` reflects Phase-38.5 / v2.76.0 as shipped.
- **MUST**: Git tag `v2.76.0` applied.

### Quality bar

- **SHOULD**: Digest markdown includes a "Generated at" footer with UTC timestamp.
- **SHOULD**: Each section lists `severity` as a badge (e.g. `🟢 info`, `🟡 warn`, `🔴 alert`).
- **SHOULD**: `pforge digest` without `--date` defaults to yesterday's date.

---


### Slice 38.5 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.5/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.5/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — Digest aggregator [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-mcp/digest/aggregator.mjs`
- `pforge-mcp/tests/digest-aggregator.test.mjs`

**Depends On**: Phase-37 shipped (v2.71.0). Phase-38.1 and 38.3 optional — aggregator gracefully handles absent session/graph data.

**Context Files**:
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs) — understand module structure
- [.forge/validation/probes.json](../../.forge/validation/probes.json) — probe format
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Create `pforge-mcp/digest/` directory.
2. Implement each section as a private function in `aggregator.mjs`; compose into `buildDigest`.
3. Use `glob` for `.forge/bugs/`, `fs.readFileSync` for JSON artifacts; wrap all reads in try/catch.
4. Write unit tests with fixture files in OS temp dir.

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/digest-aggregator.test.mjs
```

**Commit**: `feat(digest): daily digest aggregator — 5 sections`

---

### Slice 2 — Digest renderer [parallel-safe, Group A]

**Complexity**: 2
**Parallelism**: [parallel-safe] — Parallel Group A (independent of Slice 3 CLI work)
**Estimated duration**: 30–45 min

**Files to create**:
- `pforge-mcp/digest/render.mjs`
- `pforge-mcp/tests/digest-render.test.mjs`

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-mcp/digest/aggregator.mjs](../../pforge-mcp/digest/aggregator.mjs) (Slice 1)

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/digest-render.test.mjs
```

**Commit**: `feat(digest): markdown + JSON renderer`

---

### Parallel Merge Checkpoint (after Group A)

Confirm Slice 2 gate passes. Slices 3 and 4 are sequential from this point.

---

### Slice 3 — CLI command + notifier dispatch [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `pforge.ps1`
- `pforge.sh`

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge.ps1](../../pforge.ps1)
- [extensions/](../../extensions/) — notify-* extension structure

**Steps**:
1. Add `digest` command branch in both CLI scripts.
2. Call `buildDigest` + `renderMarkdown`; write to `.forge/digests/<date>.json`.
3. Idempotency guard: check if file exists, skip unless `--force`.
4. `--notify`: iterate configured channels in `notify.config.json`; dispatch sections above severity threshold.

**Validation Gate**:
```r
node -e "const fs=require('fs');if(!fs.existsSync('pforge-mcp/digest/aggregator.mjs'))throw new Error('aggregator missing');console.log('ok')"
```

**Commit**: `feat(digest): pforge digest CLI command with --notify and idempotency`

---

### Slice 4 — GitHub Actions workflow + dashboard tile + release v2.76.0 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to create**:
- `.github/workflows/forge-daily-digest.yml`
- `pforge-mcp/tests/digest-dashboard.test.mjs`

**Files to modify**:
- `pforge-mcp/dashboard/forge-master.js`
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 3 complete.

**Context Files**:
- [pforge-mcp/dashboard/forge-master.js](../../pforge-mcp/dashboard/forge-master.js)

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/digest-dashboard.test.mjs ; node -e "const fs=require('fs');if(fs.readFileSync('VERSION','utf8').trim()!=='2.76.0')throw new Error('VERSION');console.log('ok')"
```

chore(release): v2.76.0 — Forge-Master daily digest`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.76.0 released).

**Context Files**:
- [pforge-mcp/digest/aggregator.mjs](pforge-mcp/digest/aggregator.mjs)
- [pforge-mcp/digest/render.mjs](pforge-mcp/digest/render.mjs)
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs)
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.5-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.5/hammer-<iter>.md`.

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.5.mjs`. 100 `buildDigest` calls across date ranges. Edge cases: fresh repo (no probe history), all-green day (empty sections), missing drift-history, all bugs resolved. Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.5/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- Notifier extension not configured — `--notify` flag exits 0 with warning, no crash.
- Same date run twice — second run is a no-op (idempotency check).
- Cost history file corrupted (malformed JSON) — aggregator skips that section, produces partial digest.
- Missing `.forge/runs/` directory — `stalled-phases` section returns empty, no throw.
- 1000 bugs in `.forge/bugs/` — `aging-bugs` section completes in < 2s.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.5-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.5/hammer-<iter>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.5/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.5-FM-DAILY-DIGEST-v2.76-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.5/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.5.mjs --validate-converged ; npx vitest run pforge-mcp/tests/digest-aggregator.test.mjs ; pforge analyze docs/plans/Phase-38.5-FM-DAILY-DIGEST-v2.76-PLAN.md
```

**Commit**: `test(38.5): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Verify aggregator is read-only — confirm it does not modify `.forge/bugs/`, `.forge/cost-history.json`, or `DEPLOYMENT-ROADMAP.md`.

**After Slice 2 (Group A merge)**: Confirm markdown and JSON renderers are deterministic (snapshot test). Confirm `pforge-mcp` test suite baseline is intact.

**After Slice 3**: Smoke-test `pforge digest --date <yesterday>` on local repo; expect an "all-green" digest if no artifacts are present.

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] Aggregator is purely read-only — no modifications to plan or artifact files.
- [ ] `.forge/digests/` is gitignored (runtime artifacts).
- [ ] GitHub Actions workflow exists but is opted-out by default.
- [ ] `VERSION` = `2.76.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.76.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ Aggregator modifies any artifact file (read-only violation) → halt immediately.
- ❌ `--notify` sends to a new channel not already in `extensions/notify-*` → scope violation, halt.
- ❌ Digest test suite fails and cannot be fixed within time budget → abort, document in postmortem.
- ❌ `pforge-mcp` full test suite regressions → fix before continuing.
- ❌ Any modification outside listed scope → halt.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Stalled-phases detection false-positives on intentionally paused phases | Check `DEPLOYMENT-ROADMAP.md` for explicit `paused` status; skip those from "stalled" count |
| 2 | Cost anomaly detection fires on first run (no baseline) | If `cost-history.json` has < 7 entries, skip cost-anomaly section (not enough baseline); note in digest as "insufficient history" |
| 3 | Digest generation on Windows fails due to path glob differences | Use `path.join` and `node:fs` throughout; test on Windows paths in unit test fixture |
| 4 | GitHub Actions cron triggers during non-business hours cause noise | Workflow is commented out; user explicitly opts in and can configure the schedule |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~10K | ~$0.02 |
| Slice 2 | ~6K | ~$0.01 |
| Slice 3 | ~8K | ~$0.02 |
| Slice 4 | ~6K | ~$0.01 |
| **Total** | **~30K** | **~$0.06** |

---

## Session Break Points

Plan for a session break after Slice 2 if context is thin — Slice 3 CLI changes require re-reading `pforge.ps1` and `pforge.sh` branch structures which are large files; fresh context avoids mistakes in the CLI plumbing.
