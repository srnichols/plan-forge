---
crucibleId: a32df102-30bf-46b0-a009-aa2d07f7ddac
lane: feature
source: human
hardened: true
hardened_by: Claude Sonnet 4.6 (Copilot CLI plan hardener)
hardened_at: 2026-04-23
created: 2026-04-23
author: Claude Opus 4.7 (in-session draft, approved by Scott Nichols)
---

# Phase-38.1 — Forge-Master Conversation Memory

> **Target release**: v2.72.0
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-37 shipped (v2.71.0). No dependency on other 38.x phases — this is the foundation for 38.2, 38.5, and 38.8.
> **Series**: First of the **Forge-Master System-AI Tier** (Phase-38.1 → 38.8).

---

## Specification Source

- **Problem**: `runTurn` in `pforge-master/src/reasoning.mjs` is near-stateless. No record of prior turns is passed to each invocation — the user must re-state context with every follow-up question.
- **Root cause**: No persistence layer exists in `pforge-master/src/` for session turns. Each call to `runTurn` starts cold.
- **Contract**: After this phase, every `runTurn` with a non-ephemeral `sessionId` appends to `.forge/fm-sessions/<sessionId>.jsonl` and surfaces the last 10 prior turns as classification context. Single-turn probe runs (`sessionId: "ephemeral"`) remain unchanged.

No prior postmortems — first execution.

---

## Scope Contract

### In Scope

- New `pforge-master/src/session-store.mjs` — `appendTurn`, `loadSession`, `purgeSession`, `rotateIfNeeded` (cap 200 turns; rotate oldest 100 to `.archive.jsonl`).
- New `pforge-master/src/__tests__/session-store.test.mjs` — unit tests for all session-store exports.
- `pforge-master/src/reasoning.mjs` — accept optional `sessionId` in `runTurn` deps; after reply, append turn record; before classification, surface `priorTurns` (last 10) in context.
- `pforge-master/src/http-routes.mjs` — read `x-pforge-session-id` header; pass `sessionId` into `runTurn`. New `GET /api/forge-master/session/:id` route returning last 10 turns.
- Dashboard JS (`pforge-mcp/dashboard/forge-master.js`) — generate UUID session ID once per browser tab; attach header on every POST to `/api/forge-master/chat`.
- `pforge.ps1` + `pforge.sh` — add `fm-session list`, `fm-session purge <id>`, `fm-session purge --all` CLI commands.
- `docs/CLI-GUIDE.md` — document the new `fm-session` commands.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.72.0 release metadata.

### Out of Scope

- ❌ Cross-session recall / BM25 indexing (Phase-38.2).
- ❌ Embedding persisted turns (Phase-38.8).
- ❌ Digest or pattern surfacing (Phase-38.5, 38.6).
- ❌ Changing build/operational/troubleshoot lane tool lists (Phase-32 guardrail).
- ❌ New write tool — persistence is a side-effect of `runTurn`, not a callable MCP tool.
- ❌ Cross-user or cross-project session aggregation.

### Forbidden Actions

- ❌ No changes to the build/operational/troubleshoot lane tool lists.
- ❌ No principles-injection into `step2-harden-plan.prompt.md` or the slice executor — Forge-Master advisory only.
- ❌ No principles-violation detector — separate phase if we want that.
- ❌ No new write tool — advisory is inherently read-only.
- ❌ Do not store the full reply text in `.forge/fm-sessions/` — store only the sha256 hash (`replyHash`) to keep file size bounded and avoid sensitive output persistence.
- ❌ Do not write session files for `sessionId: "ephemeral"` — probe harness and CLI one-shots must remain zero-disk-side-effect.

---

## Required Decisions

None — outline fully resolved.

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | JSONL turn schema | Resolved | `{turn, timestamp, userMessage, classification, replyHash, toolCalls:[]}` |
| 2 | Rotation threshold | Resolved | 200 active turns; oldest 100 rotated to `<sessionId>.archive.jsonl` |
| 3 | Prior-context window | Resolved | Last 10 turns surfaced to classification context |
| 4 | Session ID origin | Resolved | Dashboard: UUID per tab; CLI/probe: `"ephemeral"` (not persisted) |
| 5 | Purge UX | Resolved | `pforge fm-session purge <id>` and `pforge fm-session purge --all` |

---

## Acceptance Criteria

### Slice 1 — Session storage primitives

- **MUST**: `pforge-master/src/session-store.mjs` exists and exports `appendTurn`, `loadSession`, `purgeSession`, `rotateIfNeeded`.
- **MUST**: `appendTurn(sessionId, turnRecord)` creates `.forge/fm-sessions/<sessionId>.jsonl` on demand; each call appends exactly one JSONL line.
- **MUST**: Turn record shape is `{turn: number, timestamp: string, userMessage: string, classification: object, replyHash: string, toolCalls: array}`.
- **MUST**: `loadSession(sessionId)` returns an array of turn objects parsed from disk; returns `[]` when file does not exist (no-throw on missing file).
- **MUST**: `rotateIfNeeded(sessionId)` moves the oldest 100 turns to `<sessionId>.archive.jsonl` when active turn count ≥ 200; after rotation active file has exactly 100 turns.
- **MUST**: `purgeSession(sessionId)` deletes `<sessionId>.jsonl` and `<sessionId>.archive.jsonl` (if present); no error when files already absent.
- **MUST**: All session files are written under `.forge/fm-sessions/` (directory created on demand).
- **MUST**: `pforge-master/src/__tests__/session-store.test.mjs` has passing tests covering: append, load, rotate, purge, missing-file no-throw.

### Slice 2 — Wire `runTurn` to persist + read

- **MUST**: `runTurn` in `pforge-master/src/reasoning.mjs` accepts optional `sessionId` in its `deps` parameter.
- **MUST**: When `sessionId` is set and is not `"ephemeral"`, `runTurn` calls `appendTurn` after the reply is generated.
- **MUST**: When `sessionId` is set and is not `"ephemeral"`, `runTurn` calls `loadSession` before classification and passes the last 10 turns as `priorTurns` in classification context.
- **MUST**: When `sessionId` is absent or `"ephemeral"`, no disk writes occur — all existing tests continue to pass unchanged.
- **MUST**: New round-trip test in `pforge-master/src/__tests__/session-store.test.mjs` (or a dedicated test file) verifies that a sequence of two `runTurn` calls with the same non-ephemeral `sessionId` produces a JSONL file with two turn records.
- **MUST**: Full `pforge-master` test suite passes with no regressions.

### Slice 3 — HTTP + dashboard integration

- **MUST**: `pforge-master/src/http-routes.mjs` reads the `x-pforge-session-id` header from POST `/api/forge-master/chat` and threads the value into `runTurn` as `deps.sessionId`.
- **MUST**: New `GET /api/forge-master/session/:id` route returns `{sessionId, turns: [...]}` with the last 10 turns; returns `{sessionId, turns: []}` for an unknown session (no 404 on missing session).
- **MUST**: Dashboard JS (`pforge-mcp/dashboard/forge-master.js`) generates a UUID on first load (persisted to `sessionStorage`) and attaches `x-pforge-session-id` to every POST `/api/forge-master/chat`.
- **MUST**: `pforge-master/tests/http-routes-sse.test.mjs` continues to pass (no regressions from header-reading changes).
- **MUST**: New test file `pforge-master/tests/session-route.test.mjs` covers: session header threading, `GET /api/forge-master/session/:id` response shape, and unknown-session empty result.

### Slice 4 — CLI purge command + release v2.72.0

- **MUST**: `pforge fm-session list` prints a table of active session files in `.forge/fm-sessions/` and exits 0.
- **MUST**: `pforge fm-session purge <id>` removes the named session files and exits 0.
- **MUST**: `pforge fm-session purge --all` removes the entire `.forge/fm-sessions/` directory and exits 0. On a clean repo with no sessions, exits 0 without error.
- **MUST**: `docs/CLI-GUIDE.md` documents the `fm-session` subcommand group.
- **MUST**: `VERSION` contains exactly `2.72.0`.
- **MUST**: `CHANGELOG.md` has a `[2.72.0]` section mentioning `conversation memory`, `fm-sessions`, and `session-store`.
- **MUST**: `ROADMAP.md` reflects Phase-38.1 / v2.72.0 as shipped.

### Quality bar

- **SHOULD**: Session files use UTC ISO-8601 timestamps.
- **SHOULD**: `replyHash` is a truncated sha256 hex (first 16 chars) for readability.
- **SHOULD**: `pforge fm-session list` displays turn count and last-activity timestamp per session.
- **SHOULD**: CLI purge commands print a confirmation line (e.g. "Purged 3 session(s)") before exiting.

---


### Slice 38.1 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/38.1/iterations.md` exists with ≥2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/38.1/run-*.json` contains p95 < 500ms for hot-path operations (or documented phase-specific budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — meta-bug filed instead.
- **MUST**: Probe harness regression results captured to `.forge/validation/results-<iso>.md` showing no lane-match regression vs prior baseline.
## Execution Slices

### Slice 1 — Session storage primitives [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to create**:
- `pforge-master/src/session-store.mjs`
- `pforge-master/src/__tests__/session-store.test.mjs`

**Depends On**: Phase-37 shipped (v2.71.0). No other 38.x slices.

**Context Files**:
- [pforge-master/src/reasoning.mjs](../../pforge-master/src/reasoning.mjs) — understand `runTurn` signature
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. Create `pforge-master/src/session-store.mjs`. Export `appendTurn(sessionId, record)`, `loadSession(sessionId)`, `purgeSession(sessionId)`, `rotateIfNeeded(sessionId)`.
2. Use `node:fs/promises` for async file I/O; create `.forge/fm-sessions/` directory with `mkdir -p` on demand.
3. JSONL: each call to `appendTurn` appends one JSON-stringified line + newline.
4. `rotateIfNeeded`: count lines in active file; if ≥ 200, move oldest 100 to archive.
5. Create unit tests: append→load round-trip, rotation threshold, purge, missing-file no-throw.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/session-store.test.mjs
```

**Commit**: `feat(fm): session-store primitives (appendTurn, loadSession, purge, rotate)`

---

### Slice 2 — Wire `runTurn` to persist + read [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `pforge-master/src/reasoning.mjs` — add optional `sessionId` in deps; call session-store

**Files to create**:
- `pforge-master/src/__tests__/reasoning-session.test.mjs` — round-trip test

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-master/src/reasoning.mjs](../../pforge-master/src/reasoning.mjs)
- [pforge-master/src/session-store.mjs](../../pforge-master/src/session-store.mjs) (created in Slice 1)
- [.github/instructions/testing.instructions.md](../../.github/instructions/testing.instructions.md)

**Steps**:
1. Import `appendTurn`, `loadSession` from `./session-store.mjs` in `reasoning.mjs`.
2. At top of `runTurn`, if `deps.sessionId` and it is not `"ephemeral"`, call `loadSession` and add last-10 turns to the context map passed to `classify`.
3. After reply is finalized, if non-ephemeral, call `appendTurn` with the turn record.
4. Guard all session-store calls in try/catch — a file-system error must not fail the turn.
5. Write round-trip test: two sequential `runTurn` calls with same sessionId → assert JSONL has 2 lines.
6. Run full pforge-master suite to confirm zero regressions.

**Validation Gate**:
```r
npx vitest run pforge-master/src/__tests__/reasoning-session.test.mjs ; npx vitest run pforge-master/src/__tests__/session-store.test.mjs
```

**Commit**: `feat(fm): wire runTurn session persistence + prior-turn context`

---

### Slice 3 — HTTP + dashboard integration [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–75 min

**Files to modify**:
- `pforge-master/src/http-routes.mjs` — read `x-pforge-session-id`; add `GET /api/forge-master/session/:id`
- `pforge-mcp/dashboard/forge-master.js` — generate UUID per tab; attach header

**Files to create**:
- `pforge-master/tests/session-route.test.mjs`

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge-master/src/http-routes.mjs](../../pforge-master/src/http-routes.mjs)
- [pforge-mcp/dashboard/forge-master.js](../../pforge-mcp/dashboard/forge-master.js)
- [pforge-master/tests/http-routes-sse.test.mjs](../../pforge-master/tests/http-routes-sse.test.mjs)

**Steps**:
1. In `http-routes.mjs`, POST `/api/forge-master/chat` handler: read `req.headers['x-pforge-session-id']` and pass as `deps.sessionId` to `runTurn`.
2. Add `GET /api/forge-master/session/:id`: return `{sessionId: id, turns: loadSession(id).slice(-10)}`.
3. Dashboard JS: on module init, `const SESSION_ID = sessionStorage.getItem('fm-session') || crypto.randomUUID(); sessionStorage.setItem('fm-session', SESSION_ID);`. Attach `'x-pforge-session-id': SESSION_ID` to every `fetch` to `/api/forge-master/chat`.
4. Write `session-route.test.mjs` verifying header threading and session route response shape.

**Validation Gate**:
```r
npx vitest run pforge-master/tests/session-route.test.mjs pforge-master/tests/http-routes-sse.test.mjs
```

**Commit**: `feat(fm): HTTP session header + /api/forge-master/session/:id route`

---

### Slice 4 — CLI purge command + release v2.72.0 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to modify**:
- `pforge.ps1` — add `fm-session list|purge` commands
- `pforge.sh` — add `fm-session list|purge` commands
- `docs/CLI-GUIDE.md` — document `fm-session` subcommand group
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 3 complete.

**Context Files**:
- [pforge.ps1](../../pforge.ps1) — existing CLI command pattern
- [pforge.sh](../../pforge.sh) — existing CLI command pattern
- [docs/CLI-GUIDE.md](../../docs/CLI-GUIDE.md)

**Steps**:
1. In `pforge.ps1`: add `fm-session` branch under argument switch. `list` → enumerate `.forge/fm-sessions/*.jsonl`; `purge <id>` → remove named files; `purge --all` → remove directory.
2. Mirror in `pforge.sh` with `rm -rf` equivalents.
3. Update `docs/CLI-GUIDE.md` with `fm-session` section.
4. Bump `VERSION` to `2.72.0`. Write `CHANGELOG.md` entry. Update `ROADMAP.md`.
5. Commit.

**Validation Gate**:
```bash
node -e "const fs=require('fs');const v=fs.readFileSync('VERSION','utf8').trim();if(v!=='2.72.0')throw new Error('VERSION mismatch: '+v);console.log('VERSION ok');"
```
AND
```bash
node -e "const c=require('fs').readFileSync('CHANGELOG.md','utf8');if(!c.includes('[2.72.0]'))throw new Error('missing [2.72.0]');if(!c.includes('conversation memory'))throw new Error('missing narrative');console.log('CHANGELOG ok');"
```

**Commit**: `chore(release): v2.72.0 — Forge-Master conversation memory`

---


### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on prior release slice.
**Depends On**: Slice 4 complete (v2.72.0 released).

**Context Files**:
- [pforge-master/src/session-store.mjs](pforge-master/src/session-store.mjs)
- [pforge-master/src/reasoning.mjs](pforge-master/src/reasoning.mjs)
- [scripts/probe-forge-master.mjs](scripts/probe-forge-master.mjs)

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-38.1.mjs`. 100 `appendTurn` / `loadSession` / `rotateIfNeeded` cycles with seeded random messages (empty, max-length 8192 chars, unicode, malformed JSON attempts). Concurrent batches of 10 via `Promise.all`. Memory pressure capture (`process.memoryUsage()` before/after/peak). Latency p50/p95/p99 logged to `.forge/load-sim/38.1/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- Disk-full / EACCES on `.forge/fm-sessions/` — assert `appendTurn` surfaces error without corrupting existing turns.
- Provider timeout mid-`runTurn` — assert turn still appended with `error: timeout` in toolCalls.
- Concurrent writers for same sessionId in parallel — assert no line corruption.
- Process restart mid-rotation — assert `loadSession` returns valid JSON lines after recovery.
- 10 MB session log fixture — assert `loadSession({last: 10})` completes in < 200ms.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/probe-forge-master.mjs --timeout=120`. Both MUST meet baseline (≥22/24 OK, ≥16/18 lane-match). Capture output to `.forge/validation/results-<iso>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/38.1/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings
- `pforge testbed-happypath` — all scenarios green

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/<phase>/iterations.md` (add column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/38.1/iterations.md`:
`| iter | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "plan-defect"` → STOP (do not claim shipped).

**Validation gate**:
```
node scripts/sim-load-phase-38.1.mjs --validate-converged ; npx vitest run pforge-master/src/__tests__/session-store.test.mjs ; pforge analyze docs/plans/Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md
```

**Commit**: `test(38.1): recursive load-hardening converged`

---
## Re-anchor Checkpoints

**After Slice 1**: Verify `session-store.test.mjs` is fully green. Confirm `.forge/fm-sessions/` is NOT committed (it's a runtime directory — add to `.gitignore` if absent).

**After Slice 2**: Re-read the `runTurn` signature in `reasoning.mjs`. Confirm: (a) ephemeral sessions leave no files; (b) the prior-context injection does not alter the `classification` SSE payload shape (Phase-36 pinned it).

**After Slice 3**: Run the full pforge-master suite before continuing to Slice 4. Confirm `http-routes-sse.test.mjs` still passes — SSE stream must not break.

**After Slice 4**: Smoke-check `pforge fm-session list` and `purge --all` manually on local repo.

---

## Definition of Done

- [ ] All 4 slices committed with validation gates passing.
- [ ] Zero regressions in the full pforge-master suite (133+ tests).
- [ ] `.forge/fm-sessions/` is gitignored (no session data committed to repo).
- [ ] `docs/CLI-GUIDE.md` updated.
- [ ] `VERSION` = `2.72.0`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.72.0` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ Any slice's validation gate fails and cannot be fixed within the slice's time budget → abort, document in postmortem.
- ❌ `pforge-master` full suite drops below 133 tests → regression investigation required before continuing.
- ❌ Session-store writes data for `sessionId: "ephemeral"` (scope violation) → immediate halt.
- ❌ Disk-write errors in `appendTurn` cause `runTurn` to throw (must be caught) → fix before continuing.
- ❌ Any modification to files outside `docs/plans/**`, `pforge-master/**`, `pforge-mcp/dashboard/forge-master.js`, `pforge.ps1`, `pforge.sh`, `docs/CLI-GUIDE.md`, `VERSION`, `CHANGELOG.md`, `ROADMAP.md` → scope violation, halt.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | JSONL file grows unbounded if rotation bug | Unit test covers rotation at threshold; add a safety max-size read guard in `loadSession` (skip lines beyond 300 as a hard cap) |
| 2 | Session file writes fail on Windows path separators | Use `path.join` throughout session-store; test on Windows paths in unit tests |
| 3 | Prior-turn injection inflates classification context causing longer/costlier runTurn calls | Cap at 10 turns; each turn record is small (hashed reply, not full text); monitor cost in Slice 4 probe run |
| 4 | Dashboard UUID generation uses `crypto.randomUUID()` which may be undefined in older browsers | Add fallback: `(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)` |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~8K | ~$0.02 |
| Slice 2 | ~12K | ~$0.03 |
| Slice 3 | ~10K | ~$0.02 |
| Slice 4 | ~6K | ~$0.01 |
| **Total** | **~36K** | **~$0.08** |

---

## Session Break Points

After Slice 2 if context is thin — Slice 3 requires reading both `http-routes.mjs` and dashboard JS simultaneously; a fresh session avoids stale model of the prior-turn injection code.
