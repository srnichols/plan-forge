# Hotfix v2.90.1 — Test-Sweep Deadlock Guard

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (orchestrator output watchdog) + Tests
> **Estimated cost**: $0.10–$0.30 (3 slices, all small + tested with mocks)
> **Pipeline**: Specify (this doc) → Pre-flight → Harden → Execute → Sweep → Review → Ship
> **VERSION target**: 2.90.0 → 2.90.1 (patch)

---

## Feature Specification

### Problem Statement

During the GitHub-stack chapter dogfood (May 5, 2026), two slices' validation gates ran the full vitest suite and silently deadlocked:

- **Phase B Slice 9** (`npx --prefix pforge-mcp vitest run`): worker process alive ~31 min with no events, no test output flushing, no exit. Killed manually; manual `npx vitest run` produced 4127/4150 tests passing in ~9 min.
- **Phase D Slice 7** (`npx --prefix pforge-mcp vitest run "pforge-mcp/tests/dashboard-*.test.mjs"`): same failure mode. Killed manually; the gate's quoted glob doesn't expand on Windows cmd.exe so vitest reported "no test files found" instantly when run by hand.

Both deadlocks share a signature: **the worker's child process produces no stdout for an extended period and the orchestrator has no liveness check beyond the hard timeout.** The 25-min worker-timeout fires eventually but a `--resume-from <next-slice>` is the only recovery, costing the slice's prior work.

This hotfix adds a streaming-output watchdog: if a worker subprocess produces no stdout/stderr bytes for `PFORGE_WORKER_OUTPUT_IDLE_MS` (default 8 min), emit a `slice-output-stalled` event and kill the subprocess with a clear "worker stalled — no output for Nm" error. The slice fails fast with a recoverable status instead of consuming the full timeout budget.

The work is **strictly opt-in for behavior change** via the env var (default 8 min preserves the prior fail-after-25-min behavior in spirit but with earlier feedback). All existing tests must still pass.

### User Scenarios

**Scenario 1: Long test suite produces output every few minutes**
1. Worker runs `npx vitest run`. Vitest writes a progress dot every 30s.
2. Watchdog never fires because output keeps arriving.
3. Slice completes normally; no behavior change from today.

**Scenario 2: Worker stalls (gh copilot subprocess stuck on backend)**
1. Worker `gh copilot --model claude-sonnet-4.6` produces no output for 8 min.
2. Watchdog fires. Subprocess SIGKILL'd.
3. Orchestrator emits `slice-output-stalled` with stallDurationMs.
4. Slice marked failed. User can `--resume-from <slice>` to retry. Net wall-clock saved: 17 min (vs. waiting for 25-min hard timeout).

**Scenario 3: User overrides watchdog**
1. User sets `PFORGE_WORKER_OUTPUT_IDLE_MS=300000` (5 min) for a tight feedback loop.
2. Watchdog fires sooner.
3. Or: `PFORGE_WORKER_OUTPUT_IDLE_MS=0` disables the watchdog entirely.

### Acceptance Criteria

- [ ] **MUST**: New constant `DEFAULT_WORKER_OUTPUT_IDLE_MS = 480_000` (8 min) and `resolveWorkerOutputIdleMs()` helper in `pforge-mcp/orchestrator.mjs` (mirrors `resolveGateTimeoutMs` shape).
- [ ] **MUST**: `spawnWorker` (or its child-process wrapper) installs an idle-timer that resets on every `data` event from stdout AND stderr. When the timer fires, it kills the subprocess and resolves with `{ exitCode: -1, stalled: true, stallDurationMs }`.
- [ ] **MUST**: When the watchdog fires, orchestrator emits `slice-output-stalled` event with `{ sliceId, sliceTitle, stallDurationMs, lastBytesAtIso }` before the standard `slice-failed` event.
- [ ] **MUST**: Setting `PFORGE_WORKER_OUTPUT_IDLE_MS=0` disables the watchdog (passes the timer through cleanly).
- [ ] **MUST**: Setting `PFORGE_WORKER_OUTPUT_IDLE_MS=<positive integer>` overrides the default.
- [ ] **MUST**: The watchdog is NOT installed in `--dry-run` or `--estimate` mode (no subprocess to watch).
- [ ] **MUST**: New vitest cases in `pforge-mcp/tests/spawn-worker-output-watchdog.test.mjs` cover: silent-subprocess-killed, output-keeps-flowing-no-kill, env-override, env-zero-disables.
- [ ] **MUST**: Existing `spawn-worker-*.test.mjs` and `orchestrator-*.test.mjs` cases still pass.
- [ ] **MUST**: Documentation in [.github/instructions/plan-gate-command-rules.md](../../.github/instructions/plan-gate-command-rules.md) gains a section "Worker output watchdog" with the env-var name + default.
- [ ] **SHOULD**: Sequence-plans script's "Still running" log line includes `(idle Ns since last output)` when the watchdog can detect it.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Subprocess writes to stdout only (no stderr) | Watchdog resets on every stdout byte. No false-positive kills. |
| Subprocess writes to stderr only | Same — both streams reset the timer. |
| Subprocess produces a single byte every 7:59 min | Watchdog never fires. Stretches the run but tracks progress. |
| Subprocess exits cleanly while watchdog is armed | Watchdog cleared on subprocess `close` event. No spurious kill. |
| `PFORGE_WORKER_OUTPUT_IDLE_MS` set to non-numeric value | Falls back to default. Logs a one-line warning. |
| `PFORGE_WORKER_OUTPUT_IDLE_MS=-1` | Falls back to default (negative ignored). |
| Watchdog kills mid-write | Subprocess gets SIGKILL; partial stdout is still captured into `result.output`. |

### Out of Scope

- Auto-retry on stall (existing retry logic handles this — watchdog just makes it fire faster).
- Per-slice idle-timer override via plan frontmatter (deferred to a future hotfix if needed).
- Distinguishing "stalled" from "slow" — 8 min is the threshold; user tunes if their workload differs.
- API-path workers (`callApiWorker`) — only CLI-spawned workers can stall this way.

### Out of Scope (explicit non-goals)

- Modifying `runGate` timeout (that's Hotfix v2.90.2).
- Modifying retry policy (out of scope).

---

## Scope Contract

### Inputs
- [pforge-mcp/orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) — `spawnWorker` (line ~1983), `resolveGateTimeoutMs` (line ~74) for shape reference

### Outputs
- **Modified**: `pforge-mcp/orchestrator.mjs` (additive — new helper + watchdog wiring)
- **New**: `pforge-mcp/tests/spawn-worker-output-watchdog.test.mjs`
- **Modified**: `.github/instructions/plan-gate-command-rules.md` (new section)
- **Modified**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`

### Forbidden Actions
- ❌ Changing `DEFAULT_GATE_TIMEOUT_MS` (separate hotfix)
- ❌ Changing `spawnWorker`'s default `timeout` parameter
- ❌ Modifying retry logic in `runWorker` retry loop
- ❌ Removing or weakening any existing test

---

## Slice Plan

> Memory note `plan-gate-command-rules.md` applies — plain `node` / `npx` invocations, no `bash -c` wrappers.

### Slice 1 — Watchdog helper + spawnWorker integration
**Files in scope**: `pforge-mcp/orchestrator.mjs`
**Goal**: Add `DEFAULT_WORKER_OUTPUT_IDLE_MS`, `resolveWorkerOutputIdleMs()`, and the data-event-driven idle-timer inside `spawnWorker`'s child-process branch. Emit `slice-output-stalled` via the eventBus when fired.
**Validation gate**:
```bash
node -e "import('./pforge-mcp/orchestrator.mjs').then(m=>{if(typeof m.resolveWorkerOutputIdleMs!=='function'){console.error('helper not exported');process.exit(1)} if(m.DEFAULT_WORKER_OUTPUT_IDLE_MS!==480000){console.error('wrong default');process.exit(1)} console.log('ok')})"
```
**Estimated cost**: $0.10

### Slice 2 — Vitest coverage
**Files in scope**: `pforge-mcp/tests/spawn-worker-output-watchdog.test.mjs`
**Goal**: 4 test cases — silent-killed, output-flows, env-override, env-zero-disables. Use a fixture child script that emits configurable patterns of output.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/spawn-worker-output-watchdog.test.mjs
```
**Estimated cost**: $0.10

### Slice 3 — Docs + version + CHANGELOG
**Files in scope**: `.github/instructions/plan-gate-command-rules.md`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Goal**: Document `PFORGE_WORKER_OUTPUT_IDLE_MS` + watchdog behavior. Bump VERSION 2.90.0 → 2.90.1. CHANGELOG entry under "Hotfix series 2.90.x".
**Validation gate**:
```bash
node -e "const fs=require('fs'); const v=fs.readFileSync('VERSION','utf8').trim(); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const inst=fs.readFileSync('.github/instructions/plan-gate-command-rules.md','utf8'); const checks={version:v==='2.90.1', changelog:/2\.90\.1/.test(cl) && /watchdog/i.test(cl), instruction:/PFORGE_WORKER_OUTPUT_IDLE_MS/.test(inst)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.05

---

## Branch Strategy
- Branch: `hotfix/v2.90.1-watchdog`
- Base: `master`
- Squash merge after Step 5 review

## Rollback Plan
- Watchdog default is conservative (8 min). If false-positives surface, set `PFORGE_WORKER_OUTPUT_IDLE_MS=0` to disable in environment without code rollback.
- Full rollback: `git revert <merge-commit>` removes the watchdog wholesale.

## Notes for the Hardener
- This is the first of a six-hotfix series (2.90.1 through 2.90.6). All bumps are patch-level per user instruction.
- The watchdog should be **non-invasive** — wraps existing spawn behavior, doesn't replace it.
- Reflexion / retry logic is unchanged; this hotfix only changes how quickly the loop knows to retry.
