---
crucibleId: 5b1be390-d26a-4a76-bd72-ef27a73d55ea
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.2 — Forge-Master Cross-Session Recall

> **Target release**: v2.73.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-38.1 shipped (v2.72.0) — needs `.forge/fm-sessions/` JSONL log to read from.

---

## Specification Source

- **Problem**: Each Forge-Master session starts cold. Repeat questions ("how do I configure quorum?") receive cold-start answers because no cross-session recall exists.
- **Root cause**: Phase-38.1 persists each turn per session but no reader scans across sessions to surface related prior interactions.
- **Contract**: After this phase, classification for operational/troubleshoot/advisory lanes queries a BM25 recall index over all past sessions and injects the top-3 most-similar prior turns as advisory context. Recall is annotated — Forge-Master still answers fresh.

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-master/src/recall-index.mjs` — `buildIndex(projectDir)`, `queryIndex(text, {topK})`, `loadIndex(projectDir)`. BM25 (or tf-idf) over `userMessage` field. Index doc shape: `{turnId, sessionId, timestamp, userMessage, lane, replyHash}`.
- New `pforge-master/src/__tests__/recall-index.test.mjs` — covers build, query, incremental refresh, OFFTOPIC exclusion.
- `pforge-master/src/reasoning.mjs` — when `deps.sessionId` is set AND lane is operational/troubleshoot/advisory, query recall index for top-3 prior turns; inject as "Related prior turns" context section (advisory, not classification result).
- Dashboard panel `pforge-mcp/dashboard/forge-master.js` — "Recent related conversations" section rendered when recall results present.
- CLI: `pforge fm-recall query "<text>"` and `pforge fm-recall rebuild` commands in `pforge.ps1` + `pforge.sh`.
- Index file: `.forge/fm-sessions/recall-index.json` — lazy refresh (once per day or on `rebuild`).
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.73.0 release metadata.

### Out of Scope

- ❌ Embedding-based similarity (Phase-38.8).
- ❌ Recall over Plan/Bug/Memory artifacts — those are graph nodes owned by Phase-38.3.
- ❌ Modifying lane keyword sets or auto-escalation thresholds.
- ❌ New write tool.
- ❌ Cross-project recall (index keyed by project root; no leakage across repos).
- ❌ Surfacing OFFTOPIC-classified prior turns — they are noise.
- ❌ Changing build/operational/troubleshoot lane tool lists (Phase-32 guardrail).

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ Do not modify `.forge/fm-sessions/` session files — recall-index is a pure reader.
- ❌ Do not include OFFTOPIC-classified turns in the recall index.
- ❌ Do not expose recall results as a `classification` result — they are context augmentation only.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | BM25 vs tf-idf | Resolved | BM25 (better for short queries); pure JS, no external dependency |
| 2 | Recall lanes | Resolved | operational, troubleshoot, advisory only — not build/offtopic |
| 3 | Top-K cap | Resolved | 3 to avoid context bloat |
| 4 | Index refresh trigger | Resolved | Lazy: on first query of the day (compare `lastBuiltAt` date) OR `pforge fm-recall rebuild` |
| 5 | Index key / isolation | Resolved | Keyed by absolute `projectDir` path; one index per project |

---

## Acceptance Criteria

### Slice 1 — BM25 indexer over fm-sessions

- **MUST**: `pforge-master/src/recall-index.mjs` exists and exports `buildIndex(projectDir)`, `queryIndex(text, opts)`, `loadIndex(projectDir)`.
- **MUST**: `buildIndex` reads all `*.jsonl` files in `.forge/fm-sessions/` (excluding `*.archive.jsonl`), parses each turn, and produces an in-memory BM25 index.
- **MUST**: `buildIndex` excludes turns where `classification.lane === "offtopic"`.
- **MUST**: `buildIndex` writes the index snapshot to `.forge/fm-sessions/recall-index.json` with a `lastBuiltAt` ISO timestamp.
- **MUST**: `loadIndex` reads `recall-index.json`; if file is absent or `lastBuiltAt` is a prior calendar day, calls `buildIndex` to refresh first.
- **MUST**: `queryIndex(text, {topK: 3})` returns an array of up to 3 `{turnId, sessionId, timestamp, userMessage, lane, replyHash, score}` objects sorted by descending score.
- **MUST**: `pforge-master/src/__tests__/recall-index.test.mjs` passes and covers: build with fixture sessions, query returns top-K, incremental refresh, OFFTOPIC exclusion, empty-state no-throw.

### Slice 2 — Wire recall into `runTurn`

- **MUST**: `pforge-master/src/reasoning.mjs` imports `loadIndex`, `queryIndex` from `./recall-index.mjs`.
- **MUST**: When `deps.sessionId` is set (non-ephemeral) AND classified `lane` is one of `operational`, `troubleshoot`, `advisory`, `runTurn` calls `queryIndex` with the user message.
- **MUST**: Recall results (up to 3) are appended to the system prompt as a "Related prior turns" section, clearly marked as advisory context.
- **MUST**: Recall results are NOT passed as part of the `classification` object or as a tool-call result.
- **MUST**: A new test verifies that after a first `runTurn` call (which persists a turn), a second `runTurn` with a similar message surfaces the first turn's `turnId` in the recall context returned.
- **MUST**: Full pforge-master suite continues to pass (recall is guarded in try/catch — recall failure must never fail the turn).

### Slice 3 — Dashboard panel + CLI commands

- **MUST**: `pforge fm-recall query "<text>"` prints the top-3 matching prior turns (or "No results") and exits 0.
- **MUST**: `pforge fm-recall rebuild` regenerates `.forge/fm-sessions/recall-index.json` from scratch and exits 0 (works on empty sessions directory).
- **MUST**: Dashboard in `pforge-mcp/dashboard/forge-master.js` renders a "Related conversations" section when the current reply context includes recall results.
- **MUST**: New dashboard unit test verifies the related-conversations section renders from a fixture recall payload.
- **MUST**: `pforge-master/tests/http-routes-sse.test.mjs` continues to pass.

### Slice 4 — Release v2.73.0

- **MUST**: `VERSION` contains exactly `2.73.0`.
- **MUST**: `CHANGELOG.md` has a `[2.73.0]` section mentioning `cross-session recall`, `BM25`, and `recall-index`.
- **MUST**: `ROADMAP.md` reflects Phase-38.2 / v2.73.0 as shipped.
- **MUST**: Git tag `v2.73.0` applied.

### Quality bar

- **SHOULD**: BM25 implementation uses k1=1.5 and b=0.75 (standard defaults).
- **SHOULD**: Recall section in the reply context is prefixed with `> **Recall (advisory):**` to make it visually distinct.
- **SHOULD**: `pforge fm-recall query` output shows session ID, timestamp, and lane alongside the matched message.

---


### Slice 38.2 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.2/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.2/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — BM25 indexer over fm-sessions [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to create**:
- `pforge-master/src/recall-index.mjs`
- `pforge-master/src/__tests__/recall-index.test.mjs`

**Depends On**: Phase-38.1 shipped (v2.72.0) — `session-store.mjs` and `.forge/fm-sessions/` schema exist.

**Context Files**:
- [pforge-master/src/session-store.mjs](../../pforge-master/src/session-store.mjs) — turn record shape
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Implement pure-JS BM25 scorer in `recall-index.mjs`. No external npm deps.
2. `buildIndex`: glob `*.jsonl` in `.forge/fm-sessions/`, parse turns, skip OFFTOPIC, build inverted index + doc-length table.
3. `queryIndex`: tokenize query, compute BM25 scores, return top-K sorted.
4. `loadIndex`: lazy-refresh check by comparing `lastBuiltAt` date to today.
5. Write fixture session files in the test (in OS temp dir) and assert query returns expected turn.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/recall-index.test.mjs
```

**Commit**: `feat(fm): BM25 recall index over fm-sessions`

---

### Slice 2 — Wire recall into `runTurn` [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `pforge-master/src/reasoning.mjs`

**Files to create**:
- `pforge-master/src/__tests__/reasoning-recall.test.mjs`

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-master/src/reasoning.mjs](../../pforge-master/src/reasoning.mjs)
- [pforge-master/src/recall-index.mjs](../../pforge-master/src/recall-index.mjs) (Slice 1)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)

**Steps**:
1. Import `loadIndex`, `queryIndex` from `./recall-index.mjs`.
2. After classification: if non-ephemeral AND lane ∈ {operational, troubleshoot, advisory}, call `queryIndex`.
3. Inject results as "Related prior turns" block in the prompt passed to the frontier model.
4. Wrap in try/catch — recall failure degrades gracefully (log warning, continue without recall).
5. Write round-trip test using fixture session data seeded in OS temp dir.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/reasoning-recall.test.mjs ; npx vitest run pforge-master/src/__tests__/recall-index.test.mjs
```

feat(fm): inject cross-session recall context in runTurn`

---

### Slice 3 — Dashboard panel + CLI commands [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `pforge-mcp/dashboard/forge-master.js` — related-conversations UI
- `pforge.ps1` — `fm-recall` subcommand
- `pforge.sh` — `fm-recall` subcommand

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge-mcp/dashboard/forge-master.js](../../pforge-mcp/dashboard/forge-master.js)
- [pforge.ps1](../../pforge.ps1)

**Steps**:
1. Dashboard: after each reply, check if reply context includes `relatedTurns`; render as a collapsible "Related conversations" section.
2. `pforge fm-recall query "<text>"`: call `queryIndex` with provided text, print top-3 or "No results".
3. `pforge fm-recall rebuild`: call `buildIndex` and print node count.

**Validation Gate**:
```r
npx vitest run pforge-master/tests/http-routes-sse.test.mjs
```

**Commit**: `feat(fm): recall dashboard panel + fm-recall CLI`

---

### Slice 4 — Release v2.73.0 [sequential]

**Complexity**: 1
**Parallelism**: [sequential]
**Estimated duration**: 20–30 min

**Files to modify**:
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 3 complete.

**Context Files**:
- [CHANGELOG.md](../../CHANGELOG.md)
- [ROADMAP.md](../../ROADMAP.md)

**Validation Gate**:
```bash
node -e "const fs=require('fs');const v=fs.readFileSync('VERSION','utf8').trim();if(v!=='2.73.0')throw new Error('VERSION mismatch: '+v);const c=fs.readFileSync('CHANGELOG.md','utf8');if(!c.includes('[2.73.0]'))throw new Error('missing [2.73.0]');console.log('ok');"
```

**Commit**: `chore(release): v2.73.0 — Forge-Master cross-session recall`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.73.0 released).

**Context Files**:
- [pforge-master/src/recall-index.mjs](pforge-master/src/recall-index.mjs)
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs)
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs)
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.2-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.2/hammer-<iter>.md`.

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.2.mjs`. 100 recall queries against a 500-document fixture index. Edge cases: empty string query, 8192-char query, unicode, single-char, all-offtopic corpus. Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.2/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- 10MB session log fixture — `loadIndex` must complete < 3s.
- Cyclic JSONL corruption (malformed JSON mid-file) — assert `buildIndex` skips bad lines and continues.
- Concurrent `buildIndex` calls for same project — assert index not corrupted (tmpfile+rename).
- `recall-index.json` deleted mid-query — assert `queryIndex` transparently rebuilds.
- All prior turns are OFFTOPIC — assert `queryIndex` returns `[]` gracefully.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.
Additionally run: `node scripts/hammer-fm.mjs --scenario=phase-38.2-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.2/hammer-<iter>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.2/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.2-FM-CROSS-SESSION-RECALL-v2.73-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.2/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.2.mjs --validate-converged ; npx vitest run pforge-master/src/__tests__/recall-index.test.mjs ; pforge analyze docs/plans/Phase-38.2-FM-CROSS-SESSION-RECALL-v2.73-PLAN.md
```

**Commit**: `test(38.2): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Confirm the index is written under `.forge/fm-sessions/recall-index.json` (not anywhere else). Confirm OFFTOPIC turns are excluded from index by inspecting fixture test assertions.

**After Slice 2**: Re-read `runTurn` exports — confirm `classification` return shape is unchanged (Phase-36 SSE contract). Check that `reasoning-classification-surface.test.mjs` still passes.

**After Slice 3**: Full pforge-master suite green. Smoke-test `pforge fm-recall rebuild` on the local repo (empty result expected since no real fm-sessions exist in CI).

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] Zero regressions in the full pforge-master suite.
- [ ] Recall index file not committed to git (add `.forge/fm-sessions/` to `.gitignore` if not already done in Phase-38.1).
- [ ] `VERSION` = `2.73.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.73.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ BM25 query returns incorrect results (wrong lane surfaced, OFFTOPIC not excluded) → do not proceed to Slice 2.
- ❌ `runTurn` test suite drops below baseline → regression investigation required.
- ❌ Recall results appear in `classification` object (scope violation — they are advisory context only) → fix before continuing.
- ❌ Any modification outside the files listed in Scope Contract → halt immediately.
- ❌ Recall failure causes `runTurn` to throw (must degrade gracefully) → fix in Slice 2 before continuing.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | BM25 query quality degrades on very short prompts (1-2 words) | Minimum query length check: if < 3 tokens, skip recall (return empty) |
| 2 | Index grows stale when session files accumulate rapidly | `lastBuiltAt` check triggers daily refresh; `pforge fm-recall rebuild` available for manual refresh |
| 3 | Injecting recall context inflates token cost | Top-K = 3 cap; each record is compact (message + lane + timestamp, not full reply); monitor cost via `forge_cost_report` after first production session |
| 4 | Cross-project leakage if projectDir detection fails | `buildIndex` receives explicit `projectDir` argument; default to `process.cwd()` only — document and unit-test the isolation |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~10K | ~$0.02 |
| Slice 2 | ~10K | ~$0.02 |
| Slice 3 | ~8K | ~$0.02 |
| Slice 4 | ~4K | ~$0.01 |
| **Total** | **~32K** | **~$0.07** |

---

## Session Break Points

After Slice 2 if context is thin — Slice 3 context-switches from backend reasoning to dashboard UI and CLI; a fresh session avoids carrying stale model of the BM25 implementation details.
