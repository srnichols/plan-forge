---
lane: feature
source: human
hardened: true
hardened_by: Claude Opus 4.7 (in-session, approved by Scott Nichols)
hardened_at: 2026-04-23
created: 2026-04-23
related_evidence: .forge/hammer-forge-master/logic/*.txt (2026-04-23 initial hammer)
---

# Phase-37.2 — Forge-Master Hammer Harness (Realistic Q&A + Tier-Dial Sweep)

> **Target release**: v2.71.2
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-37.1 shipped (v2.71.1) — HTTP bridge must return real results, not `Unknown tool`. Without that, the harness measures dispatcher bugs instead of reasoning quality.
> **Series**: Designed for **reuse on Phase-38.1 → 38.8** — every Phase-38 slice's hardening loop (sub-task 3: "Probe-harness regression") will call into this harness.

---

## Specification Source

- **Field input**: Ad-hoc hammer session on 2026-04-23 (`.forge/hammer-forge-master/logic/ask2.ps1`) covered 8 prompts and proved Forge-Master's classifier + LLM + SSE plumbing all work. But the harness was hand-authored PowerShell, measured no cost, did not vary the reasoning tier, and cannot be checked into CI.
- **Root cause**: No formal Forge-Master end-to-end harness exists. `scripts/probe-forge-master.mjs` exists (from Phase-36) but only measures lane-match keyword scoring — it does NOT exercise the full reasoning loop, does NOT vary tiers, and does NOT compare answer quality.
- **Contract**: After this phase, a single command (`node scripts/hammer-fm.mjs --scenario=<name> [--tier=low|medium|high|all] [--provider=<name>]`) runs a named scenario pack against the live dashboard, produces a JSON + Markdown report at `.forge/hammer-forge-master/reports/<iso>/`, and exits non-zero if any scenario's acceptance criteria fail. The harness is invoked by Phase-38.x Slice 5 hardening loops (`sub-task 3`) via `node scripts/hammer-fm.mjs --scenario=phase-38.N-baseline`.

No prior postmortems for this specific harness.

---

## Scope Contract

### In Scope

- New `scripts/hammer-fm.mjs` — the harness CLI. Flags: `--scenario`, `--tier`, `--provider`, `--base-url`, `--out-dir`, `--timeout`, `--parallel`, `--dry-run`.
- New `scripts/hammer-fm/scenarios/` — scenario pack directory, JSON files per scenario.
- New `scripts/hammer-fm/scorers.mjs` — per-prompt acceptance checks (lane-match, tool-set-overlap, reply-contains, reply-not-contains, tool-success-rate).
- New `scripts/hammer-fm/reporter.mjs` — writes `<iso>/report.json` and `<iso>/report.md` with per-prompt rows + per-tier summary tables + cost rollup.
- Starter scenario packs (all in `scripts/hammer-fm/scenarios/`):
  - `shipped-prompts.json` — the 30+ prompts from `pforge-master/src/prompts.mjs` (1 rep per category, minimum 8).
  - `realistic-qa.json` — 20 realistic Plan-Forge-adjacent questions (follow-ups, ambiguous phrasing, multi-intent).
  - `dial-sweep.json` — pins a 10-prompt subset for fast tier-dial comparison runs.
  - `phase-38.1-baseline.json` — stubbed baseline for Phase-38.1 hardening reuse (real data populated when Phase-38.1 runs).
- `pforge.ps1` + `pforge.sh` — new `hammer-fm` subcommand that wraps `node scripts/hammer-fm.mjs` with sensible defaults.
- `docs/CLI-GUIDE.md` — document `pforge hammer-fm` and scenario pack format.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.71.2 release metadata.

### Out of Scope

- ❌ Adding new prompts to the shipped catalog in `pforge-master/src/prompts.mjs` — that's the catalog's job; the harness merely exercises what's there.
- ❌ Changing the classifier, dispatcher, or any `pforge-master/src/` runtime behavior — purely a test harness + scenario packs.
- ❌ CI integration (GitHub Actions step) — separate follow-up; harness must be runnable locally first.
- ❌ Paid provider auto-setup — the harness READS `$env:ANTHROPIC_API_KEY` / `$env:XAI_API_KEY` / `$env:OPENAI_API_KEY` / `$env:GITHUB_TOKEN` but does not write or prompt for them.
- ❌ UI changes — no dashboard surface for the harness.
- ❌ Re-running Phase-38.x hardening loops — those run themselves per plan; this phase only produces the tool they will call.

### Forbidden Actions

- ❌ Do not modify any file under `pforge-master/src/` — the harness is a **consumer**, not an author, of runtime code.
- ❌ Do not modify `pforge-master/src/prompts.mjs` — the catalog is the contract.
- ❌ Do not spin up a new dashboard / HTTP server — the harness must target an EXISTING `127.0.0.1:3100` (or configurable `--base-url`). If the base URL is unreachable, the harness exits with code 2 and a clear error.
- ❌ Do not commit any report artifact under `.forge/hammer-forge-master/reports/` — those are runtime outputs and must be gitignored.
- ❌ Do not bake provider API keys into scenario packs — scenarios are model-agnostic.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | What counts as a "real-life question" worth including? | Resolved | Realistic-qa.json = 20 prompts drawn from (a) the last 30 days of Forge-Master session logs if present, else (b) the Crucible raw ideas in `.forge/crucible/*.json`. Authored by hand once; rotated when drift becomes visible in reports. |
| 2 | How is tier-dial sweep scored? | Resolved | Per prompt, for each tier in `--tier=all`, record `{lane, tools, replyTokens, costUSD, replyHash, scorerResults}`. Report shows a side-by-side table with a `sameLane?`, `sameToolSet?`, `replyDiffChars` column. Acceptance: dial-sweep scenario passes when ≥ 80 % of prompts have `sameLane=true` across all tiers (classifier must be stable). |
| 3 | What does the harness do when no provider is configured? | Resolved | Harness runs classification + SSE plumbing only; replies are guaranteed to be from the keyword-only fallback. The `--provider=keyword-only` mode pins this and is the default CI mode. Real-LLM mode requires `--provider=<resolved>` AND the relevant key in env — harness fails fast if missing. |
| 4 | Does Phase-38.x Slice 5 sub-task 3 HAVE to use this harness? | Resolved | Yes. Phase-38.1 → 38.8 plans' Slice 5 sub-task 3 reference `node scripts/probe-forge-master.mjs` today; Phase-37.2 **adds** (not replaces) `scripts/hammer-fm.mjs`. Phase-38.x plans are amended in a follow-up micro-commit to call both. This plan's Slice 4 lands the amendment. |

---

## Acceptance Criteria

### Slice 1 — Harness core + scorers

- **MUST**: `scripts/hammer-fm.mjs` exists, reads a scenario pack, POSTs to `/api/forge-master/chat`, opens `/stream`, captures all SSE events, writes per-prompt records.
- **MUST**: `scripts/hammer-fm/scorers.mjs` exports at minimum `lane-match`, `tool-set-overlap`, `reply-contains`, `reply-not-contains`, `tool-success-rate`, `no-error-events`.
- **MUST**: Running `node scripts/hammer-fm.mjs --scenario=shipped-prompts --tier=keyword-only --dry-run` exits 0, prints the scenario plan, makes NO HTTP calls.
- **MUST**: Running `node scripts/hammer-fm.mjs --scenario=shipped-prompts --tier=keyword-only` against a live dashboard writes `.forge/hammer-forge-master/reports/<iso>/report.json` with one row per prompt AND `report.md` with a summary table.
- **MUST**: Harness exits with code `1` when any scenario acceptance check fails, code `0` on success, code `2` on connection failure to base URL.
- **MUST**: `scripts/hammer-fm/` is covered by `pforge-mcp/tests/hammer-fm.test.mjs` (new file) with at least 10 tests across scorer correctness, scenario-loader validation, and exit-code behavior (via mocked fetch).

### Slice 2 — Scenario packs + reporter

- **MUST**: `scripts/hammer-fm/scenarios/shipped-prompts.json` exists and references at least one prompt from each of the 7 prompt categories (`plan-status`, `troubleshooting`, `crucible`, plus 4 others), minimum 8 prompts total.
- **MUST**: `scripts/hammer-fm/scenarios/realistic-qa.json` exists with exactly 20 prompts covering at minimum: ambiguous phrasing (5), multi-intent (3), follow-up requiring session context (3), off-topic redirects (2), operational status (4), troubleshooting (3).
- **MUST**: `scripts/hammer-fm/scenarios/dial-sweep.json` exists with exactly 10 prompts — the pinned subset used for fast tier comparison.
- **MUST**: `scripts/hammer-fm/scenarios/phase-38.1-baseline.json` exists with at least 6 prompts that exercise conversation-memory scenarios (multi-turn dialog, session-scoped memory recall). Acceptance checks deferred until Phase-38.1 ships.
- **MUST**: `scripts/hammer-fm/reporter.mjs` renders a markdown table with columns: `prompt_id`, `lane_expected`, `lane_actual`, `tools_expected`, `tools_called`, `tool_success_rate`, `reply_len`, `cost_usd`, `tier`, `verdict`.
- **MUST**: When `--tier=all` is used, the markdown report includes a dedicated **Tier Comparison** section: one row per prompt with columns `prompt_id`, `low_lane`, `medium_lane`, `high_lane`, `sameLane?`, `sameToolSet?`, `replyDiffChars_low_vs_high`.

### Slice 3 — CLI surface + release v2.71.2

- **MUST**: `pforge hammer-fm <args>` exists in both `pforge.ps1` and `pforge.sh` and forwards all args to `node scripts/hammer-fm.mjs`.
- **MUST**: `pforge hammer-fm --help` prints the scenario list (`shipped-prompts`, `realistic-qa`, `dial-sweep`, `phase-38.1-baseline`) and the 4 primary flags.
- **MUST**: `.forge/hammer-forge-master/reports/` is listed in `.gitignore` (append one line).
- **MUST**: `docs/CLI-GUIDE.md` has a new `hammer-fm` section documenting the subcommand and scenario pack JSON schema.
- **MUST**: `VERSION` contains exactly `2.71.2`.
- **MUST**: `CHANGELOG.md` has a `[2.71.2]` section mentioning `hammer harness`, `scenario packs`, and `tier-dial sweep`.
- **MUST**: `ROADMAP.md` reflects Phase-37.2 / v2.71.2 as shipped.

### Slice 4 — Phase-38.x harness adoption

- **MUST**: Each of `Phase-38.1` through `Phase-38.8` PLAN files gains one line in Slice 5 sub-task 3 reading: `Additionally run: node scripts/hammer-fm.mjs --scenario=phase-38.<N>-baseline --tier=keyword-only` (where `<N>` matches the phase sub-number).
- **MUST**: `scripts/hammer-fm/scenarios/phase-38.{2..8}-baseline.json` exist as stubs with at least 4 prompts per phase tailored to that phase's feature (e.g., `cross-session recall` for 38.2, `knowledge graph` for 38.3).
- **MUST**: Running `node scripts/hammer-fm.mjs --scenario=phase-38.1-baseline --tier=keyword-only --dry-run` succeeds for all 8 baselines.
- **MUST**: No other edits to the 8 Phase-38.x plans — diff per plan is exactly one added line in Slice 5 sub-task 3.

### Quality bar

- **SHOULD**: Harness supports `--parallel=N` (default 4) — prompt batches issued concurrently, respecting SSE ordering per session.
- **SHOULD**: Report markdown includes a cost summary footer: total tokens in/out, total USD, per-tier breakdown.
- **SHOULD**: Scenario packs include an optional `notes` field per prompt for reviewer context.
- **SHOULD**: Reporter writes a machine-readable `report.json` first (durable) before rendering `report.md`, so a crashed render doesn't lose data.

---

### Slice 37.2 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/37.2/iterations.md` exists with ≥ 2 rows AND last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/37.2/run-*.json` contains p95 < 2000 ms per prompt (real HTTP to localhost; NOT an LLM budget — a plumbing budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — `forge_meta_bug_file` filed with `class: "orchestrator-defect"` instead.
- **MUST**: Harness self-runs `shipped-prompts` scenario against the live dashboard in each hardening iteration and the report is attached to `.forge/load-sim/37.2/<iter>-report.md`.

---

## Execution Slices

### Slice 1 — Harness core + scorers [sequential]

**Complexity**: 4
**Parallelism**: [sequential]
**Estimated duration**: 90–120 min

**Files to create**:
- `scripts/hammer-fm.mjs`
- `scripts/hammer-fm/scorers.mjs`
- `scripts/hammer-fm/sse-client.mjs` — SSE parser helper (reused across scenarios)
- `pforge-mcp/tests/hammer-fm.test.mjs`

**Depends On**: Phase-37.1 shipped (HTTP bridge returns real results).

**Context Files**:
- [pforge-master/src/http-routes.mjs](../../pforge-master/src/http-routes.mjs) — SSE event shape (pinned by Phase-36)
- [pforge-master/src/prompts.mjs](../../pforge-master/src/prompts.mjs) — shipped catalog
- [scripts/probe-forge-master.mjs](../../scripts/probe-forge-master.mjs) — existing probe (reference for SSE reading)
- [.forge/hammer-forge-master/logic/ask2.ps1](../../.forge/hammer-forge-master/logic/ask2.ps1) — prior hand-rolled harness

**Steps**:
1. Create `scripts/hammer-fm/sse-client.mjs` — `openStream(url, {timeoutMs})` returns `{events: [...], closedReason}`. Handles `event:` + `data:` multi-line frames.
2. Create `scripts/hammer-fm/scorers.mjs` — export the 6 scorer functions. Each takes `(promptRecord, sseEvents)` and returns `{pass: boolean, reason: string}`.
3. Create `scripts/hammer-fm.mjs` CLI skeleton: arg parsing (yargs or minimal), scenario loader (JSON → schema check), orchestrator loop, exit codes.
4. Create `pforge-mcp/tests/hammer-fm.test.mjs` with mocked fetch: 10 tests covering scorer correctness + scenario validation + exit-code behavior.
5. `--dry-run` path: print scenario plan, skip network, exit 0.

**Validation Gate**:
```r
npx vitest run pforge-mcp/tests/hammer-fm.test.mjs
```

**Commit**: `feat(37.2): hammer-fm harness core + scorers`

---

### Slice 2 — Scenario packs + reporter [sequential]

**Complexity**: 3
**Parallelism**: [sequential]
**Estimated duration**: 60–90 min

**Files to create**:
- `scripts/hammer-fm/scenarios/shipped-prompts.json`
- `scripts/hammer-fm/scenarios/realistic-qa.json`
- `scripts/hammer-fm/scenarios/dial-sweep.json`
- `scripts/hammer-fm/scenarios/phase-38.1-baseline.json`
- `scripts/hammer-fm/reporter.mjs`

**Files to modify**:
- `scripts/hammer-fm.mjs` — wire reporter

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-master/src/prompts.mjs](../../pforge-master/src/prompts.mjs) — source for shipped-prompts.json
- [pforge-master/src/intent-router.mjs](../../pforge-master/src/intent-router.mjs) — lane definitions
- [.forge/crucible/](../../.forge/crucible/) — raw ideas inspiration for realistic-qa.json
- [docs/plans/Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md](Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md) — baseline shape

**Steps**:
1. `shipped-prompts.json`: pick 1 prompt per category from `pforge-master/src/prompts.mjs`, set `expectedLane` per category, `expectedTools` from `suggestedTools`. Minimum 8 entries.
2. `realistic-qa.json`: author 20 prompts covering the composition listed in acceptance criteria. Each entry: `{id, message, expectedLane, expectedTools, mustContain?, mustNotContain?, notes?}`.
3. `dial-sweep.json`: 10-prompt pinned subset — 4 from shipped + 4 from realistic-qa + 2 offtopic. Mark each with a `purpose` string so tier-drift analysis is readable.
4. `phase-38.1-baseline.json`: 6 prompts covering conversation-memory flows (multi-turn dialog, session recall). Acceptance `scorers` intentionally empty at this stage — populated when 38.1 ships.
5. `reporter.mjs`: write JSON first (durable), then render markdown with per-prompt table + tier-comparison table (when multi-tier).
6. Wire reporter into `hammer-fm.mjs` end-of-run path.

**Validation Gate**:
```r
node -e "const fs=require('fs');const files=['shipped-prompts','realistic-qa','dial-sweep','phase-38.1-baseline'];for(const f of files){const p='scripts/hammer-fm/scenarios/'+f+'.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(!Array.isArray(j.prompts))throw new Error(p+' missing prompts[]');if(j.prompts.length<(f==='dial-sweep'?10:(f==='realistic-qa'?20:(f==='phase-38.1-baseline'?6:8))))throw new Error(p+' too few prompts');}console.log('scenario packs valid');"
```
AND
```r
node scripts/hammer-fm.mjs --scenario=shipped-prompts --tier=keyword-only --dry-run
```

**Commit**: `feat(37.2): scenario packs (shipped, realistic-qa, dial-sweep, phase-38.1-baseline) + reporter`

---

### Slice 3 — CLI surface + release v2.71.2 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to modify**:
- `pforge.ps1` — add `hammer-fm` subcommand
- `pforge.sh` — add `hammer-fm` subcommand
- `.gitignore` — add `.forge/hammer-forge-master/reports/`
- `docs/CLI-GUIDE.md` — document `hammer-fm`
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 2 complete.

**Context Files**:
- [pforge.ps1](../../pforge.ps1)
- [pforge.sh](../../pforge.sh)
- [docs/CLI-GUIDE.md](../../docs/CLI-GUIDE.md)

**Steps**:
1. `pforge.ps1`: add `hammer-fm` branch under arg switch → forward `$args[1..]` to `node scripts/hammer-fm.mjs`.
2. `pforge.sh`: mirror with `"$@"` shift.
3. Append `.forge/hammer-forge-master/reports/` to `.gitignore`.
4. Add `hammer-fm` section to `docs/CLI-GUIDE.md` with scenario list and JSON schema excerpt.
5. Bump `VERSION` to `2.71.2`. Write `CHANGELOG.md` `[2.71.2]` entry. Update `ROADMAP.md`.
6. Live smoke test: run `.\pforge.ps1 hammer-fm --scenario=shipped-prompts --tier=keyword-only --dry-run`.

**Validation Gate**:
```r
node -e "const v=require('fs').readFileSync('VERSION','utf8').trim();if(v!=='2.71.2')throw new Error('VERSION '+v);const c=require('fs').readFileSync('CHANGELOG.md','utf8');if(!c.includes('[2.71.2]'))throw new Error('CHANGELOG missing 2.71.2');const gi=require('fs').readFileSync('.gitignore','utf8');if(!gi.includes('.forge/hammer-forge-master/reports'))throw new Error('.gitignore missing reports dir');console.log('release + gitignore ok');"
```

**Commit**: `chore(release): v2.71.2 — hammer-fm harness + pforge hammer-fm CLI`

---

### Slice 4 — Phase-38.x harness adoption [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to create**:
- `scripts/hammer-fm/scenarios/phase-38.2-baseline.json` … `phase-38.8-baseline.json` (7 files)

**Files to modify**:
- `docs/plans/Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md`
- `docs/plans/Phase-38.2-FM-CROSS-SESSION-RECALL-v2.73-PLAN.md`
- `docs/plans/Phase-38.3-FM-KNOWLEDGE-GRAPH-v2.74-PLAN.md`
- `docs/plans/Phase-38.4-FM-PLANNER-EXECUTOR-v2.75-PLAN.md`
- `docs/plans/Phase-38.5-FM-DAILY-DIGEST-v2.76-PLAN.md`
- `docs/plans/Phase-38.6-FM-PATTERN-SURFACING-v2.77-PLAN.md`
- `docs/plans/Phase-38.7-FM-QUORUM-ADVISORY-v2.78-PLAN.md`
- `docs/plans/Phase-38.8-FM-EMBEDDING-FALLBACK-v2.79-PLAN.md`

**Depends On**: Slice 3 complete (v2.71.2 released).

**Context Files**:
- [docs/plans/Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md](Phase-38.1-FM-CONVERSATION-MEMORY-v2.72-PLAN.md)
- (the other 7 plan files)

**Steps**:
1. For each Phase-38.N plan, locate Slice 5 sub-task 3 (`Probe-harness regression`) and append exactly one line:
   `Additionally run: node scripts/hammer-fm.mjs --scenario=phase-38.<N>-baseline --tier=keyword-only` — capture output to `.forge/load-sim/38.<N>/hammer-<iter>.md`.
2. Create 7 new scenario files (`phase-38.2-baseline.json` … `phase-38.8-baseline.json`) each with ≥ 4 prompts tailored to the phase's feature:
   - 38.2: cross-session recall (prior-Q&A retrieval prompts)
   - 38.3: knowledge graph queries ("what touched X in last N days")
   - 38.4: planner-executor handoff
   - 38.5: daily digest trigger
   - 38.6: pattern surfacing
   - 38.7: quorum advisory
   - 38.8: embedding fallback
3. Confirm `node scripts/hammer-fm.mjs --scenario=phase-38.N-baseline --dry-run` works for N ∈ {1..8}.
4. Diff each plan — must show exactly 1 added line per plan.

**Validation Gate**:
```r
node -e "const fs=require('fs');for(let n=1;n<=8;n++){const p='scripts/hammer-fm/scenarios/phase-38.'+n+'-baseline.json';if(!fs.existsSync(p))throw new Error('missing '+p);const j=JSON.parse(fs.readFileSync(p,'utf8'));if((j.prompts||[]).length<(n===1?6:4))throw new Error(p+' too few prompts');}console.log('all 8 baselines present');"
```
AND
```r
for /L %n in (1,1,8) do node scripts/hammer-fm.mjs --scenario=phase-38.%n-baseline --tier=keyword-only --dry-run || exit 1
```
(Windows `cmd /c` syntax; bash equivalent in `pforge.sh`.)

**Commit**: `docs(38.x): wire hammer-fm into all Phase-38 hardening loops`

---

### Slice 5 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last.
**Depends On**: Slice 4 complete.

**Context Files**:
- [scripts/hammer-fm.mjs](../../scripts/hammer-fm.mjs)
- [scripts/hammer-fm/scenarios/](../../scripts/hammer-fm/scenarios/)
- [pforge-mcp/tests/hammer-fm.test.mjs](../../pforge-mcp/tests/hammer-fm.test.mjs)

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Self-run harness**: Run `node scripts/hammer-fm.mjs --scenario=shipped-prompts --tier=keyword-only` against the live dashboard. Capture report path. Append to `.forge/load-sim/37.2/<iter>-report.md`.

**2 — Failure injection** (5 modes, mocked via `pforge-mcp/tests/hammer-fm.test.mjs`):
- Base URL unreachable → harness exits code 2 within 3 s with clear error.
- Mid-scenario 500 error from `/api/forge-master/chat` → per-prompt verdict = fail, harness continues, exit 1.
- SSE stream stall (no frames for 20 s) → harness aborts that prompt with `{closedReason: "timeout"}`, continues remainder.
- Malformed scenario JSON → harness exits code 1 BEFORE network, clear error citing file + line.
- Scorer throws → captured into report as `verdict: error`, does not crash run.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND `node scripts/hammer-fm.mjs --scenario=dial-sweep --tier=keyword-only`. Both must pass their acceptance checks. Capture to `.forge/validation/results-<iso>.md`.

**4 — Tier-dial sweep validation** (only runs if at least one provider key is present in env):
Run `node scripts/hammer-fm.mjs --scenario=dial-sweep --tier=all`. Tier Comparison table MUST show `sameLane?: true` for ≥ 80 % of prompts. If not: file bug and continue loop.

**5 — `pforge` self-check sweep** → capture to `.forge/load-sim/37.2/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-37.2-FM-HAMMER-HARNESS-v2.71.2-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json`
- `pforge sweep` — no NEW deferred-work markers
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings

**6 — Defect triage + auto-fix loop**: For every failure in steps 1–5: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/37.2/iterations.md` (column `model`).

**7 — Iteration accounting**: Append to `.forge/load-sim/37.2/iterations.md`:
`| iter | model | started | duration | defects_found | defects_fixed | p95_ms | shipped_pass_rate | realistic_pass_rate |`

**8 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Hard cap: 5. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "orchestrator-defect"` → STOP.

**Validation gate**:
```r
node scripts/hammer-fm.mjs --scenario=shipped-prompts --tier=keyword-only ; npx vitest run pforge-mcp/tests/hammer-fm.test.mjs ; pforge analyze docs/plans/Phase-37.2-FM-HAMMER-HARNESS-v2.71.2-PLAN.md
```

**Commit**: `test(37.2): recursive hardening converged`

---

## Re-anchor Checkpoints

**After Slice 1**: Confirm `hammer-fm.test.mjs` tests cover scorer correctness + exit codes. Confirm `--dry-run` mode makes zero network calls (test with dashboard STOPPED — harness must still exit 0).

**After Slice 2**: Spot-check 3 realistic-qa prompts for quality — are they actually ambiguous / multi-intent? If they feel pedantic, rewrite before locking in.

**After Slice 3**: Run `pforge hammer-fm --scenario=shipped-prompts --tier=keyword-only` against the real dashboard. Read `report.md` start-to-finish. Does it tell a coherent story?

**After Slice 4**: Open two Phase-38 plans at random and diff. Exactly one line added per plan — if more, back out and restart the amendment pass.

---

## Definition of Done

- [ ] All 4 implementation slices committed with validation gates passing + Slice 5 (hardening) converged.
- [ ] Zero regressions in `pforge-master` and `pforge-mcp` test suites.
- [ ] `scripts/hammer-fm.mjs` runs end-to-end against live dashboard, produces report artifacts.
- [ ] 4 primary scenario packs (`shipped-prompts`, `realistic-qa`, `dial-sweep`, `phase-38.1-baseline`) exist + 7 Phase-38.{2..8} baselines exist.
- [ ] `.gitignore` excludes `.forge/hammer-forge-master/reports/`.
- [ ] `pforge hammer-fm` CLI works on Windows (`pforge.ps1`) and bash (`pforge.sh`).
- [ ] `VERSION` = `2.71.2`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.71.2` applied.
- [ ] All 8 Phase-38.x plans reference `scripts/hammer-fm.mjs` in Slice 5 sub-task 3.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ Any slice's validation gate fails and cannot be fixed within the slice's time budget → abort, document in postmortem.
- ❌ The `realistic-qa` pack cannot achieve ≥ 70 % pass rate on a healthy dashboard → scope is wrong (prompts too strict or harness buggy) — halt and re-scope.
- ❌ Tier-dial sweep (Slice 5 sub-task 4) shows `sameLane?: false` for > 20 % of prompts with paid providers → classifier is not model-stable; file meta-bug `class: "prompt-defect"` and do not ship.
- ❌ Any modification to `pforge-master/src/**` runtime code → scope violation, halt immediately.
- ❌ Report artifacts committed to git → gitignore broken, back out commit and fix.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Real LLM runs burn token budget during hardening | Default harness mode is `--tier=keyword-only` (zero LLM cost). Tier-dial sweep with paid providers is opt-in via env keys. |
| 2 | Realistic-qa prompts age out as Plan Forge evolves | Scenario packs are versioned (filename includes `.json` → future `.v2.json`). A Phase-38.x "scenario refresh" slice can rotate them. |
| 3 | SSE parser misses multi-line `data:` frames | `sse-client.mjs` unit-tested with synthetic event streams including multi-line data blocks. |
| 4 | Phase-38 plans amended incorrectly (Slice 4) | Validation gate uses `git diff --stat` to confirm exactly 1 line per plan file changed. |
| 5 | `--parallel=N` breaks SSE ordering within a single session | Harness uses a fresh `sessionId` per prompt by default; parallelism is across sessions, not within. Documented in CLI-GUIDE. |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~15K | ~$0.04 |
| Slice 2 | ~14K | ~$0.03 |
| Slice 3 | ~6K | ~$0.01 |
| Slice 4 | ~10K | ~$0.02 |
| Slice 5 (hardening) | ~20K | ~$0.05 |
| **Total** | **~65K** | **~$0.15** |

---

## Session Break Points

After Slice 2 if context is thin — Slice 3 is pure CLI plumbing and Slice 4 is a mechanical amendment pass. Both benefit from a fresh context when the harness internals are no longer top-of-mind.
