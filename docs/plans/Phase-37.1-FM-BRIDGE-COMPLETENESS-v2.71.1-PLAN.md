---
lane: hotfix
source: field-evidence
hardened: true
hardened_by: Claude Opus 4.7 (in-session, approved by Scott Nichols)
hardened_at: 2026-04-23
created: 2026-04-23
related_evidence: .forge/hammer-forge-master/logic/*.txt (2026-04-23 hammer session)
---

# Phase-37.1 — Forge-Master HTTP Bridge Completeness

> **Target release**: v2.71.1
> **Status**: Hardened — ready for `pforge run-plan`
> **Depends on**: Phase-37 shipped (v2.71.0). Classifier calibration already green (≥16/18 keyword-only lane-match).
> **Addresses**: Live-fire hammer test on 2026-04-23 at 127.0.0.1:3100 where the HTTP side of Forge-Master selected reasonable tools but every downstream call returned either `"Unknown tool: <name>"` or `"requires async dispatch — not available in Forge-Master bridge"`.

---

## Specification Source

- **Field input**: `.forge/hammer-forge-master/logic/{02..08}*.txt` — 7/7 on-topic prompts produced tool-call events whose `resultSummary` contained one of two error classes:
  1. `{"success":false,"error":"Unknown tool: X"}` for `forge_phase_status`, `forge_diagnose`, `forge_bug_list`, `forge_crucible_list`.
  2. `{"output":"(tool X requires async dispatch — not available in Forge-Master bridge)"}` for `forge_plan_status`, `forge_search`, `forge_watch_live`, `forge_cost_report`.
- **Root cause**:
  1. **Unknown-tool class** — the in-process `invokeForgeTool` exported from `pforge-mcp/server.mjs` (and wired into `forge-master-routes.mjs` via `registerForgeMasterRoutes(app, mcpCall)`) handles only a subset of the MCP tool registry. Tools with `async: true` / streaming / `registerHandler` variants are not matched by the sync `invokeForgeTool` dispatch.
  2. **Async-dispatch class** — the HTTP dispatcher bails early on tools that use the Plan Forge async stream protocol instead of awaiting their terminal result. This guard was added as a conservative stub in Phase-29, Slice 9 and never revisited.
- **Contract**: After this phase, `createHttpDispatcher` plus `invokeForgeTool` collectively handle **every tool in `BASE_ALLOWLIST` that is read-only**. Destructive tools in `WRITE_ALLOWLIST` continue to return the same "requires in-IDE confirmation" response. Live-fire re-hammer of the 8-prompt shipped battery must show **zero** `Unknown tool` and **zero** `requires async dispatch` messages.

No prior postmortems for this specific bridge.

---

## Scope Contract

### In Scope

- Audit `BASE_ALLOWLIST` (currently 39 entries) against the pforge-mcp tool registry in `pforge-mcp/tools.json` and the live MCP handler in `pforge-mcp/server.mjs`. Produce a parity report checked in at `.forge/validation/bridge-parity-<iso>.md`.
- Extend `pforge-mcp/server.mjs → invokeForgeTool` (the function passed to `registerForgeMasterRoutes` as `mcpCall`) so every read-only tool in `BASE_ALLOWLIST` either returns a terminal JSON result or is removed from the allowlist with a written reason.
- Replace the `"requires async dispatch — not available in Forge-Master bridge"` stub with a correct await: the dispatcher must await the tool's final event / return value and surface it to the caller, instead of rejecting.
- New test file `pforge-master/tests/http-dispatcher-parity.test.mjs` — snapshots the allowlist against a mocked MCP registry and fails when a tool would return the old `Unknown tool` or `async dispatch` error string.
- New test file `pforge-master/tests/http-dispatcher-async.test.mjs` — proves that a mocked streaming tool resolves through the dispatcher with its terminal payload, not the old stub.
- Update [`pforge-master/src/http-dispatcher.mjs`](../../pforge-master/src/http-dispatcher.mjs) docblock to reflect the new "await terminal" behavior.
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md` — v2.71.1 release metadata.

### Out of Scope

- ❌ Adding new tools to `BASE_ALLOWLIST` — this phase closes the gap between allowlist and dispatcher, not the gap between allowlist and wishlist. New tools = separate phase.
- ❌ Any change to `WRITE_ALLOWLIST` or the destructive-tool approval flow.
- ❌ Any change to the classifier keyword sets (that's Phase-37 territory, already calibrated).
- ❌ Dashboard UI — the bug is purely server-side.
- ❌ `forge_master_ask` MCP tool (stdio path) — it already proxies through the studio child and works; only the HTTP `/stream` path is broken.
- ❌ Harness upgrades — those are Phase-37.2. This phase only needs enough probe evidence to prove the fix.
- ❌ Creating `docs/plans/DEPLOYMENT-ROADMAP.md` (a separate surfaced gap) — file-a-meta-bug candidate, not in this scope.

### Forbidden Actions

- ❌ Do not modify `pforge-master/src/allowlist.mjs` — the allowlist is the contract, the dispatcher must match it, not vice versa.
- ❌ Do not introduce a fallback that silently returns `{}` for unknown tools — every tool in the allowlist must produce a meaningful response or be removed from the allowlist with an explanation.
- ❌ Do not route HTTP dispatcher calls through `stdio` or spawn a new child per request — the current in-process `mcpCall` injection is correct.
- ❌ Do not change the SSE event shape (`classification`, `reply`, `tool-call`, `done`, `error`) — that contract is pinned by `http-routes-sse.test.mjs`.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | What to do with a tool whose MCP handler is pure-streaming (no terminal payload)? | Resolved | Aggregate stream chunks into a single `{events: [...]}` object at dispatch boundary; return that as the terminal result. |
| 2 | Keep or drop `forge_watch_live` in the HTTP dispatcher? | Resolved | Keep — surface a bounded snapshot (`limit: 20` trailing events) via the aggregation behavior above. |
| 3 | How to prove re-hammer success? | Resolved | Re-run `.forge/hammer-forge-master/logic/ask2.ps1` against the 8-prompt battery in Slice 3; gate on zero `Unknown tool` + zero `async dispatch` strings in the output files. |

---

## Acceptance Criteria

### Slice 1 — Parity audit + test scaffolds

- **MUST**: `.forge/validation/bridge-parity-<iso>.md` exists and lists, per `BASE_ALLOWLIST` entry, one of: `OK` (terminal-dispatch works), `ASYNC` (needs streaming fix), `MISSING` (no MCP handler at all — remove from allowlist).
- **MUST**: `pforge-master/tests/http-dispatcher-parity.test.mjs` exists and has a red failing test for every `BASE_ALLOWLIST` entry classified `ASYNC` or `MISSING` in the audit.
- **MUST**: `pforge-master/tests/http-dispatcher-async.test.mjs` exists and has a red failing test that expects the new "await terminal" behavior for at least `forge_plan_status`, `forge_search`, `forge_cost_report`.
- **MUST**: `npx vitest run pforge-master/tests/http-dispatcher-parity.test.mjs pforge-master/tests/http-dispatcher-async.test.mjs` is RED (tests fail) at end of slice.

### Slice 2 — Implement terminal-await + allowlist hygiene

- **MUST**: `pforge-mcp/server.mjs → invokeForgeTool` now handles every `BASE_ALLOWLIST` entry. For streaming tools, the dispatcher awaits final event / aggregates into `{events:[...]}` and returns.
- **MUST**: The string literal `requires async dispatch — not available in Forge-Master bridge` no longer appears anywhere in `pforge-master/src/` or `pforge-mcp/`.
- **MUST**: Any allowlist entry the audit classified `MISSING` is removed from `BASE_ALLOWLIST` in `pforge-master/src/allowlist.mjs` with an inline comment `// removed in Phase-37.1 — no MCP handler`.
- **MUST**: `npx vitest run pforge-master/tests/http-dispatcher-parity.test.mjs pforge-master/tests/http-dispatcher-async.test.mjs` is GREEN.
- **MUST**: Full `pforge-master` suite (≥ 133 tests) remains green; full `pforge-mcp` suite (excluding the pre-existing [#97](https://github.com/srnichols/plan-forge/issues/97) cost-service regression) remains green.

### Slice 3 — Live-fire re-hammer + release v2.71.1

- **MUST**: `.forge/hammer-forge-master/logic/post-fix/<label>.txt` exists for all 8 shipped-prompt labels from the original battery (`01-offtopic`, `02-plan-status`, `03-troubleshoot`, `04-crucible`, `05-cost`, `06-hotspots`, `07-drift`, `08-quorum`).
- **MUST**: `grep -c "Unknown tool" .forge/hammer-forge-master/logic/post-fix/*.txt` returns `0`.
- **MUST**: `grep -c "requires async dispatch" .forge/hammer-forge-master/logic/post-fix/*.txt` returns `0`.
- **MUST**: At least 5 of the 8 labels show at least one `tool-call` event with a non-error `resultSummary` (real data came back).
- **MUST**: `VERSION` contains exactly `2.71.1`.
- **MUST**: `CHANGELOG.md` has a `[2.71.1]` section mentioning `HTTP bridge`, `dispatcher parity`, and `async terminal await`.
- **MUST**: `ROADMAP.md` reflects Phase-37.1 / v2.71.1 as shipped.

### Quality bar

- **SHOULD**: The parity audit markdown includes one representative `resultSummary` excerpt per tool so reviewers can see what the HTTP side now returns.
- **SHOULD**: Streaming-aggregation cap (default 20 events) is configurable via `deps.streamEventCap` for future tuning.
- **SHOULD**: `pforge-master/src/http-dispatcher.mjs` docblock updated to describe terminal-await behavior.

---

### Slice 37.1 — Recursive Test-Hardening Loop

- **MUST**: `.forge/load-sim/37.1/iterations.md` exists with ≥ 2 rows AND the last 2 rows show `defects_found: 0`.
- **MUST**: `.forge/load-sim/37.1/run-*.json` contains p95 < 250 ms for HTTP dispatcher terminal-await on mocked tools (I/O-bound — NOT a real MCP round-trip budget).
- **MUST**: All bugs filed during the loop have `status: resolved` or `status: deferred-with-rationale` by slice end.
- **MUST**: No iteration exceeded the 5-iteration cap. If cap exceeded, plan is NOT shipped — `forge_meta_bug_file` filed with `class: "orchestrator-defect"` instead.
- **MUST**: Live-fire re-hammer (Slice 3 artifacts) replayed from this slice; regression results captured to `.forge/validation/results-<iso>.md` showing lane-match did NOT regress vs Phase-37 baseline.

---

## Execution Slices

### Slice 1 — Parity audit + red test scaffolds [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 45–60 min

**Files to create**:
- `.forge/validation/bridge-parity-<iso>.md`
- `pforge-master/tests/http-dispatcher-parity.test.mjs`
- `pforge-master/tests/http-dispatcher-async.test.mjs`

**Depends On**: Phase-37 shipped (v2.71.0).

**Context Files**:
- [pforge-master/src/allowlist.mjs](../../pforge-master/src/allowlist.mjs)
- [pforge-master/src/http-dispatcher.mjs](../../pforge-master/src/http-dispatcher.mjs)
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs) — find `invokeForgeTool` export
- [pforge-mcp/tools.json](../../pforge-mcp/tools.json)
- [.forge/hammer-forge-master/logic/02-plan-status.txt](../../.forge/hammer-forge-master/logic/02-plan-status.txt) — evidence
- [.forge/hammer-forge-master/logic/04-crucible.txt](../../.forge/hammer-forge-master/logic/04-crucible.txt) — evidence

**Steps**:
1. Read `BASE_ALLOWLIST` from `pforge-master/src/allowlist.mjs` (filter out `WRITE_ALLOWLIST` entries).
2. For each entry, grep `pforge-mcp/server.mjs` for a matching `if (name === "<tool>")` handler — classify OK / ASYNC / MISSING.
3. Write the parity report: three sections (OK, ASYNC, MISSING) with one example `resultSummary` each, drawn from the 2026-04-23 hammer evidence.
4. Create `http-dispatcher-parity.test.mjs`: a parameterized test that loops over the allowlist and asserts the dispatcher does NOT return `{error: "Unknown tool: ..."}` for any entry. Tests are red for all MISSING entries.
5. Create `http-dispatcher-async.test.mjs`: mock a streaming MCP call that emits 3 events then a terminal; assert the dispatcher returns `{events: [...3 items...], terminal: <terminal payload>}`. Test is red against the current stub.

**Validation Gate**:
```r
node -e "const fs=require('fs');const f=fs.readdirSync('.forge/validation').find(x=>x.startsWith('bridge-parity-'));if(!f)throw new Error('parity report missing');const c=fs.readFileSync('.forge/validation/'+f,'utf8');if(!c.match(/OK|ASYNC|MISSING/))throw new Error('parity report malformed');console.log('parity report ok');"
```

**Commit**: `test(37.1): parity audit + red dispatcher tests`

---

### Slice 2 — Implement terminal-await + allowlist hygiene [sequential]

**Complexity**: 4
**Parallelism**: [sequential]
**Estimated duration**: 90–120 min

**Files to modify**:
- `pforge-mcp/server.mjs` — extend `invokeForgeTool`
- `pforge-master/src/http-dispatcher.mjs` — remove `"requires async dispatch"` stub, add docblock update
- `pforge-master/src/allowlist.mjs` — remove MISSING entries with inline comment

**Depends On**: Slice 1 complete.

**Context Files**:
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs) — the target
- [pforge-master/src/http-dispatcher.mjs](../../pforge-master/src/http-dispatcher.mjs)
- [.github/instructions/architecture-principles.instructions.md](../../.github/instructions/architecture-principles.instructions.md)

**Steps**:
1. For every tool classified ASYNC, replace the early-return stub in `invokeForgeTool` with an `await` on the handler's terminal path. Aggregate stream events into `{events: [...]}` capped at `streamEventCap` (default 20).
2. For every tool classified MISSING, delete from `BASE_ALLOWLIST` in `pforge-master/src/allowlist.mjs` with an inline `// removed in Phase-37.1 — no MCP handler` comment.
3. Remove the string literal `"requires async dispatch — not available in Forge-Master bridge"` from the codebase.
4. Update `http-dispatcher.mjs` docblock to describe terminal-await.
5. Run `http-dispatcher-parity.test.mjs` and `http-dispatcher-async.test.mjs` — both must go green.
6. Run full `pforge-master` + `pforge-mcp` suites (tolerating pre-existing [#97](https://github.com/srnichols/plan-forge/issues/97) failure) to confirm zero new regressions.

**Validation Gate**:
```r
npx vitest run pforge-master/tests/http-dispatcher-parity.test.mjs pforge-master/tests/http-dispatcher-async.test.mjs
```
AND
```r
grep -rn "requires async dispatch" pforge-master/src pforge-mcp && exit 1 || echo "string removed"
```

**Commit**: `fix(fm): HTTP dispatcher parity + terminal-await for streaming tools`

---

### Slice 3 — Live-fire re-hammer + release v2.71.1 [sequential]

**Complexity**: 2
**Parallelism**: [sequential]
**Estimated duration**: 30–45 min

**Files to create**:
- `.forge/hammer-forge-master/logic/post-fix/01-offtopic.txt` … `08-quorum.txt`

**Files to modify**:
- `VERSION`, `CHANGELOG.md`, `ROADMAP.md`

**Depends On**: Slice 2 complete. Requires the live dashboard on 127.0.0.1:3100 to be serving the patched code (restart node if needed; NOT done inside the slice — operator prompted to restart before the re-hammer command).

**Context Files**:
- [.forge/hammer-forge-master/logic/ask2.ps1](../../.forge/hammer-forge-master/logic/ask2.ps1)

**Steps**:
1. Restart the dashboard process on 127.0.0.1:3100 so it loads the patched `invokeForgeTool`.
2. Run the 8-prompt battery against `/api/forge-master/chat` + `/stream`, saving results to `.forge/hammer-forge-master/logic/post-fix/<label>.txt`.
3. Grep for `Unknown tool` and `requires async dispatch` — both counts MUST be zero.
4. Count non-error `tool-call` `resultSummary` entries — must be ≥ 5 of 8 labels.
5. Bump `VERSION` to `2.71.1`. Write `CHANGELOG.md` `[2.71.1]` entry. Update `ROADMAP.md`.
6. Commit.

**Validation Gate**:
```r
node -e "const fs=require('fs');const files=fs.readdirSync('.forge/hammer-forge-master/logic/post-fix').filter(f=>f.endsWith('.txt'));if(files.length<8)throw new Error('missing post-fix logs');let bad=0;for(const f of files){const c=fs.readFileSync('.forge/hammer-forge-master/logic/post-fix/'+f,'utf8');if(c.includes('Unknown tool')||c.includes('requires async dispatch'))bad++;}if(bad>0)throw new Error('still '+bad+' files with bridge errors');console.log('re-hammer clean');"
```
AND
```r
node -e "const v=require('fs').readFileSync('VERSION','utf8').trim();if(v!=='2.71.1')throw new Error('VERSION '+v);const c=require('fs').readFileSync('CHANGELOG.md','utf8');if(!c.includes('[2.71.1]'))throw new Error('CHANGELOG missing 2.71.1');console.log('release ok');"
```

**Commit**: `chore(release): v2.71.1 — Forge-Master HTTP bridge completeness`

---

### Slice 4 — Recursive Test-Hardening Loop

**Complexity**: 5
**Parallelism**: `[sequential]` — must be last; depends on release slice.
**Depends On**: Slice 3 complete (v2.71.1 released).

**Context Files**:
- [pforge-master/src/http-dispatcher.mjs](../../pforge-master/src/http-dispatcher.mjs)
- [pforge-mcp/server.mjs](../../pforge-mcp/server.mjs)
- [.forge/hammer-forge-master/logic/](../../.forge/hammer-forge-master/logic/)

**Sub-tasks** (iterate until 2 consecutive zero-defect iterations; hard cap 5):

**1 — Synthetic load harness**: Create `scripts/sim-load-phase-37.1.mjs`. 500 dispatcher invocations across all allowlisted tools with randomized args (empty object, huge object, malformed args, deep-nested objects). Concurrent batches of 25 via `Promise.all`. Capture `process.memoryUsage()` before/after/peak. Latency p50/p95/p99 logged to `.forge/load-sim/37.1/run-<iso>.json`.

**2 — Failure injection** (5 modes):
- Inject handler throwing `Error("mcp dropped")` mid-stream — assert dispatcher returns `{error: ...}` without crashing.
- Inject handler that never emits terminal (10s hang) — assert dispatcher aborts at `streamEventCap + 2s grace` with `{error: "stream-timeout"}`.
- Inject handler emitting 10 000 events — assert dispatcher caps to `streamEventCap` and returns cleanly.
- Inject malformed JSON in stream event — assert dispatcher skips, does not propagate corrupt data.
- Inject `null` terminal — assert dispatcher normalizes to `{events:[...], terminal: null}`.

**3 — Probe-harness regression**: Run `node scripts/probe-forge-master.mjs --keyword-only --timeout=90` AND (if a provider key is set) `node scripts/probe-forge-master.mjs --timeout=120`. Keyword-only MUST ≥ 16/18 lane-match. Capture to `.forge/validation/results-<iso>.md`.

**4 — `pforge` self-check sweep** → capture to `.forge/load-sim/37.1/diagnostics-<iter>.txt`:
- `pforge analyze docs/plans/Phase-37.1-FM-BRIDGE-COMPLETENESS-v2.71.1-PLAN.md` — consistency ≥ 85
- `pforge drift` — score must not drop > 5 vs `.forge/drift-history.json` last entry
- `pforge sweep` — no NEW deferred-work markers in changed files
- `pforge regression-guard` against this plan
- `pforge secret-scan` — zero new findings

**5 — Defect triage + auto-fix loop**: For every failure in steps 1–4: file via `pforge mcp-call forge_bug_register`, generate fix via `pforge mcp-call forge_fix_proposal --model claude-sonnet-4.6`, apply fix, re-run failed sub-task (must go green), close via `pforge mcp-call forge_bug_update_status --status=resolved`.

   **Escalation rule** — hard bugs warrant the strongest reasoner: if the same defect re-appears across 2 consecutive iterations, OR a fix attempt itself fails its re-run gate, OR iteration ≥ 3 still has open defects, **switch the fix-generation model to `claude-opus-4.7`** (`--model claude-opus-4.7`) for the remainder of the loop. Record the escalation in `.forge/load-sim/37.1/iterations.md` (column `model`) so cost attribution stays auditable.

**6 — Iteration accounting**: Append row to `.forge/load-sim/37.1/iterations.md`:
`| iter | model | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |`

**7 — Convergence check**: If this iteration AND prior iteration both found 0 defects → exit loop. Otherwise loop. Hard cap: 5 iterations. If iteration 5 still finds defects → `forge_meta_bug_file` with `class: "orchestrator-defect"` → STOP (do not claim shipped).

**Validation gate**:
```r
node scripts/sim-load-phase-37.1.mjs --validate-converged ; npx vitest run pforge-master/tests/http-dispatcher-parity.test.mjs pforge-master/tests/http-dispatcher-async.test.mjs ; pforge analyze docs/plans/Phase-37.1-FM-BRIDGE-COMPLETENESS-v2.71.1-PLAN.md
```

**Commit**: `test(37.1): recursive load-hardening converged`

---

## Re-anchor Checkpoints

**After Slice 1**: Re-read the parity report — every `MISSING` entry needs a one-line justification. If the report shows the allowlist is 100% OK, abort — there is no bridge gap and this plan is unnecessary (file `forge_meta_bug_file` with `class: "plan-defect"`).

**After Slice 2**: Run the full pforge-master suite AND `grep -rn "requires async dispatch" pforge-master/src pforge-mcp` — the string must be gone.

**After Slice 3**: Manually `curl 127.0.0.1:3100/api/forge-master/capabilities` to confirm the patched server is running (the dashboard process must have been restarted).

---

## Definition of Done

- [ ] All 3 implementation slices committed with validation gates passing + Slice 4 (hardening) converged.
- [ ] Zero regressions in the full pforge-master suite.
- [ ] `.forge/hammer-forge-master/logic/post-fix/` contains 8 log files with zero `Unknown tool` and zero `requires async dispatch` strings.
- [ ] `VERSION` = `2.71.1`, `CHANGELOG.md` and `ROADMAP.md` updated.
- [ ] Git tag `v2.71.1` applied.
- [ ] **Reviewer Gate passed (zero 🔴 Critical findings)**.

---

## Stop Conditions

- ❌ Any slice's validation gate fails and cannot be fixed within the slice's time budget → abort, document in postmortem.
- ❌ Full `pforge-master` suite drops more than 0 tests vs Phase-37 baseline → regression investigation required.
- ❌ The parity audit shows zero ASYNC / zero MISSING entries → scope invalid, file meta-bug and halt.
- ❌ The re-hammer in Slice 3 still shows any `Unknown tool` or `requires async dispatch` → DO NOT bump VERSION — fix or halt.
- ❌ Any modification to files outside `pforge-master/src/**`, `pforge-master/tests/**`, `pforge-mcp/server.mjs`, `pforge-mcp/tools.json`, `scripts/sim-load-phase-37.1.mjs`, `.forge/validation/**`, `.forge/hammer-forge-master/logic/post-fix/**`, `.forge/load-sim/37.1/**`, `VERSION`, `CHANGELOG.md`, `ROADMAP.md`, `docs/plans/Phase-37.1-FM-BRIDGE-COMPLETENESS-v2.71.1-PLAN.md` → scope violation, halt.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Streaming-aggregation changes break an existing MCP tool consumer | All changes are on the dispatcher side (one-shot `await`); the MCP tools themselves are untouched. Parity test loops over the allowlist so any missed tool fails fast. |
| 2 | `streamEventCap: 20` is too low for `forge_watch_live` and truncates useful data | Cap is tunable via `deps.streamEventCap`; HTTP route can bump to 100 if needed via a future config knob. Out of scope for this hotfix but documented. |
| 3 | Restarting the dashboard mid-hammer loses session state | `.forge/fm-sessions/` is persistent (Phase-38.1, not yet shipped — currently in-memory). Acceptable to lose in-memory session state for a hotfix release. |
| 4 | The "Unknown tool" error class has a second origin outside `invokeForgeTool` (e.g., spawned CLI subprocess) | Parity test greps `pforge-mcp/` for the error string; if a second source exists, the test captures it and Slice 2 must fix it too. |

---

## Budget

| Slice | Estimated tokens | Estimated cost (sonnet) |
|-------|-----------------|------------------------|
| Slice 1 | ~10K | ~$0.02 |
| Slice 2 | ~15K | ~$0.04 |
| Slice 3 | ~5K | ~$0.01 |
| Slice 4 (hardening) | ~20K | ~$0.05 |
| **Total** | **~50K** | **~$0.12** |

---

## Session Break Points

After Slice 2 if context is thin — Slice 3 requires a live dashboard restart and manual re-hammer, which benefits from a fresh context window.
