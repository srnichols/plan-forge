# Hotfix v2.90.2 — Worker Timeout Uplift + Per-Slice Override

> **Status**: Drafted, awaiting hardening (Step 2)
> **Tracks**: Code (orchestrator timeout config) + Tests + Docs
> **Estimated cost**: $0.10–$0.30 (3 slices, all small + tested)
> **VERSION target**: 2.90.1 → 2.90.2 (patch)
> **Depends on**: Hotfix v2.90.1 (watchdog) — must merge first so the new timeout has a finer-grained companion

---

## Feature Specification

### Problem Statement

The orchestrator currently has two coarse timeout knobs:

- `DEFAULT_GATE_TIMEOUT_MS` (10 min, env: `PFORGE_GATE_TIMEOUT_MS`) — bounds individual validation gates
- `spawnWorker(opts.timeout)` default (20 min) — bounds the entire worker subprocess

During the GitHub-stack chapter dogfood the **20 min worker timeout was too short** for Phase B Slice 5 (`--dry-run / --estimate polish`, took 25:28 first attempt → escalated). Two slices needed retries that consumed real budget.

The fix has two parts:

1. **Raise the default worker timeout to 30 min** (1,800,000 ms) — empirically a better default for moderate-complexity slices on `claude-sonnet-4.6`.
2. **Add per-slice frontmatter override** so a plan author can write `workerTimeoutMs: 2700000` (45 min) on a specific slice that legitimately needs more headroom (e.g. SARIF batch ingestion, full vitest sweeps), without raising the project-wide default.

The work is **strictly opt-in for behavior change beyond the default raise**. The default raise is a 1.5× uplift on a single constant — verified safe because the watchdog from v2.90.1 catches genuine stalls earlier.

### User Scenarios

**Scenario 1: Default uplift catches the Phase B Slice 5 case**
1. Worker runs a moderate-complexity slice that genuinely takes 25 min.
2. Old behavior: timeout fires at 20 min, retry consumes another premium request.
3. New behavior: completes at 25 min within the 30-min budget. No retry, no extra cost.

**Scenario 2: Plan author opts a single slice into longer timeout**
1. Plan file has a slice that runs the full vitest suite. They add `workerTimeoutMs: 3600000` (60 min) to that slice's frontmatter.
2. `parsePlan` extracts the override.
3. `spawnWorker` for that slice uses 60 min instead of the 30-min default.
4. Other slices use the default.

**Scenario 3: User sets project-wide override**
1. User exports `PFORGE_WORKER_TIMEOUT_MS=2700000` (45 min) for a CI environment with slow disk I/O.
2. All slices in any plan run on that machine use 45 min.
3. Per-slice frontmatter still overrides if present.

### Acceptance Criteria

- [ ] **MUST**: New constant `DEFAULT_WORKER_TIMEOUT_MS = 1_800_000` (30 min) and helper `resolveWorkerTimeoutMs(opts)` in `pforge-mcp/orchestrator.mjs` (mirrors `resolveGateTimeoutMs` shape).
- [ ] **MUST**: `resolveWorkerTimeoutMs` priority: `opts.sliceOverride` (per-slice frontmatter) → `PFORGE_WORKER_TIMEOUT_MS` env → `DEFAULT_WORKER_TIMEOUT_MS`.
- [ ] **MUST**: `spawnWorker`'s `timeout` default raised from 1,200,000 to call `resolveWorkerTimeoutMs()`. Existing callers that pass an explicit `timeout` are unchanged.
- [ ] **MUST**: `parsePlan` recognises `workerTimeoutMs: <number>` in slice frontmatter (or as a `**WorkerTimeoutMs**: <number>` body line — Hardener picks the more orthogonal location). Captured into `slice.workerTimeoutMs`.
- [ ] **MUST**: Slice runner threads `slice.workerTimeoutMs` into `spawnWorker(prompt, { timeout: slice.workerTimeoutMs ?? resolveWorkerTimeoutMs() })`.
- [ ] **MUST**: New vitest cases in `pforge-mcp/tests/worker-timeout-resolve.test.mjs` cover: default-30min, env-override, per-slice-override, slice-overrides-env.
- [ ] **MUST**: Existing `spawn-worker-*.test.mjs` cases still pass (no regression on the explicit-timeout path).
- [ ] **MUST**: Documentation in [.github/instructions/plan-gate-command-rules.md](../../.github/instructions/plan-gate-command-rules.md) gains a "Worker timeout" section with the env-var name, default, and per-slice override syntax.
- [ ] **SHOULD**: A SHOULD test asserts that the new default is at least 1.5× the old (1,200,000 → 1,800,000) so the uplift survives accidental regressions.

### Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Slice frontmatter has `workerTimeoutMs: "30m"` (string) | Parsed to 1,800,000. If parse fails, falls back to env/default with a warning. |
| Negative or zero value in any source | Falls back to default; logs a one-line warning. |
| Both env and per-slice set | Per-slice wins. Documented. |
| Slice frontmatter has `workerTimeoutMs: 0` | Treated as "unset" (falls through). Use a positive number to override. |
| Plan parser sees an unknown key | Ignored (current behavior). |

### Out of Scope

- Per-worker-type timeout (gh-copilot vs claude-cli vs codex). All workers share the timeout.
- Adaptive timeout based on prior slice durations (interesting but a larger feature).
- Modifying `runGate` timeout (already configurable via `PFORGE_GATE_TIMEOUT_MS`).

---

## Scope Contract

### Inputs
- [pforge-mcp/orchestrator.mjs](../../pforge-mcp/orchestrator.mjs) — `spawnWorker` (~1983), `resolveGateTimeoutMs` (~74)
- Plan parser (where slice frontmatter is read) — Hardener identifies exact location

### Outputs
- **Modified**: `pforge-mcp/orchestrator.mjs` (additive)
- **New**: `pforge-mcp/tests/worker-timeout-resolve.test.mjs`
- **Modified**: `.github/instructions/plan-gate-command-rules.md`
- **Modified**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`

### Forbidden Actions
- ❌ Modifying gate timeout
- ❌ Modifying watchdog (Hotfix v2.90.1's surface)
- ❌ Removing or weakening any existing test

---

## Slice Plan

### Slice 1 — Resolver helper + spawnWorker default raise
**Files in scope**: `pforge-mcp/orchestrator.mjs`
**Goal**: Add helper, raise default, plumb into `spawnWorker`.
**Validation gate**:
```bash
node -e "import('./pforge-mcp/orchestrator.mjs').then(m=>{if(typeof m.resolveWorkerTimeoutMs!=='function'){console.error('helper not exported');process.exit(1)} if(m.DEFAULT_WORKER_TIMEOUT_MS!==1800000){console.error('wrong default');process.exit(1)} console.log('ok')})"
```
**Estimated cost**: $0.10

### Slice 2 — Plan-parser frontmatter recognition + slice runner threading
**Files in scope**: `pforge-mcp/orchestrator.mjs` (parsePlan + slice runner)
**Goal**: `parsePlan` extracts `workerTimeoutMs`. Slice runner uses it when calling `spawnWorker`.
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/parser.test.mjs
```
**Estimated cost**: $0.10

### Slice 3 — Tests + docs + version + CHANGELOG
**Files in scope**: `pforge-mcp/tests/worker-timeout-resolve.test.mjs`, `.github/instructions/plan-gate-command-rules.md`, `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Validation gate**:
```bash
npx --prefix pforge-mcp vitest run pforge-mcp/tests/worker-timeout-resolve.test.mjs
node -e "const fs=require('fs'); const v=fs.readFileSync('VERSION','utf8').trim(); const cl=fs.readFileSync('CHANGELOG.md','utf8'); const inst=fs.readFileSync('.github/instructions/plan-gate-command-rules.md','utf8'); const checks={version:v==='2.90.2', changelog:/2\\.90\\.2/.test(cl) && /worker timeout/i.test(cl), instruction:/PFORGE_WORKER_TIMEOUT_MS/.test(inst)}; const failed=Object.entries(checks).filter(([_,v])=>!v); if(failed.length){console.error('failed:',failed.map(([k])=>k).join(','));process.exit(1)} console.log('ok')"
```
**Estimated cost**: $0.10

---

## Branch Strategy
- Branch: `hotfix/v2.90.2-worker-timeout`
- Base: `master` (after v2.90.1 merges)

## Rollback Plan
- Default uplift can be reverted by changing one constant.
- Per-slice override is opt-in — no plan currently uses it.
- Full rollback: `git revert <merge-commit>`.
