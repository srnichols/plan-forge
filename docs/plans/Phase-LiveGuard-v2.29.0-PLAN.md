# Phase: LiveGuard III — Self-Healing Proposals, Hooks & OpenClaw Bridge

> **Roadmap Reference**: [ROADMAP.md](../../ROADMAP.md) → v2.29.0  
> **Status**: 📋 Planned  
> **Target Version**: `2.29.0`  
> **Branch Strategy**: `feature/v2.29-liveguard-3`  
> **Predecessor**: [Phase-LiveGuard-v2.28.0-PLAN.md](./Phase-LiveGuard-v2.28.0-PLAN.md) — must be complete before execution  
> **Estimated Effort**: 4–5 days (8 execution slices)  
> **Risk Level**: Medium (hook wiring, cross-session context injection, external HTTP bridge)

---

## Overview

v2.29.0 closes the loop between LiveGuard's detection capabilities and the agent sessions that act on them. Three pillars:

1. **`forge_fix_proposal`** — When `forge_regression_guard` or `forge_drift_report` detects a failure, generate a scoped 1-2 slice fix plan automatically. Human reviews and approves before execution. The plan runs on a branch, never master. Loop is capped: one auto-proposal per incident.

2. **Lifecycle Hooks** — Three new hooks wired into the existing hook mechanism: `PreDeploy` (blocks deploy on secret findings), `PostSlice` (drift advisory after every commit), `PreAgentHandoff` (LiveGuard context injection at session start + OpenClaw bridge event). Specs in `.github/hooks/*.md`.

3. **OpenClaw Analytics Bridge** — LiveGuard snapshots are optionally POSTed to OpenClaw's endpoint on `PreAgentHandoff` and `PostAnalyze` events, giving OpenClaw a cross-project health timeline without polling the MCP server externally.

**What this is NOT**: autonomous self-healing. `forge_fix_proposal` generates a plan file — it does not execute it, does not push code, does not decide what to fix. The human approves and runs. LiveGuard proposes; the guardian still answers to the operator.

---

## Brand Narrative Addition

> "The guardian doesn't just watch. Now it drafts the repair order."

v2.29.0 adds the guardian's pen to its shield. When something breaks post-deploy, LiveGuard doesn't just surface the alert — it hands you a pre-written fix plan, scoped to the exact failing slice, ready to run on a branch. You still hold the sword.

---

## Prerequisites

- [x] v2.28.0 shipped — all 11 LiveGuard tools live, dashboard 5-tab LIVEGUARD section active, telemetry verified
- [x] `forge_regression_guard` returning `{ failed, results: [{ sliceId, planFile, command, status }] }` (v2.27 Slice 5)
- [x] `forge_drift_report` returning `{ score, violations, trend }` (v2.27 Slice 2)
- [x] `forge_incident_capture` writing `incidentId` to `.forge/incidents/<id>.json` (v2.27 Slice 3)
- [x] `emitToolTelemetry()` available in `orchestrator.mjs` (v2.27 Slice 1)
- [x] `checkApprovalSecret()` available for write endpoint auth (existing)
- [x] `.github/hooks/PreDeploy.md`, `PostSlice.md`, `PreAgentHandoff.md` present as specs (v2.29.0 companion files)
- [x] `pforge run-plan --assisted` works on a branch without touching master (established behavior)

---

## Acceptance Criteria

- [ ] `forge_fix_proposal` generates a valid 1-2 slice plan file for any `forge_regression_guard` failed result
- [ ] Generated plan is written to `docs/plans/auto/LIVEGUARD-FIX-<incidentId>.md` — never executed automatically
- [ ] `forge_fix_proposal` is capped at **one proposal per incidentId** — subsequent calls return the existing plan path, not a new file
- [ ] `curl http://localhost:3100/api/capabilities` returns 32 tools in `tools` array
- [ ] `PreDeploy` hook blocks file writes to `deploy/**` when `forge_secret_scan` returns findings
- [ ] `PostSlice` hook injects advisory when drift score drops >5 points after a `feat|fix|refactor` commit
- [ ] `PreAgentHandoff` hook injects LiveGuard context block on `SessionStart` with dirty branch or active plan
- [ ] OpenClaw POST fires when `openclaw.endpoint` is in `.forge.json` — failure is non-blocking
- [ ] `npx vitest run` passes with test coverage for all new handlers and hooks
- [ ] `docs/capabilities.md` header reads `32 MCP`

---

## Scope Contract

### In Scope

| Area | Changes |
|------|---------|
| `pforge-mcp/server.mjs` | +2 TOOLS entries (`forge_fix_proposal`, `forge_quorum_analyze`), +2 handlers, +4 REST endpoints |
| `pforge-mcp/orchestrator.mjs` | +1 `generateFixPlan()` helper, +1 `postOpenClawSnapshot()` helper |
| `pforge-mcp/capabilities.mjs` | +2 TOOL_METADATA entries, +4 `restApi.endpoints` |
| `pforge.ps1` + `pforge.sh` | +2 CLI commands (`fix-proposal`, `quorum-analyze`) |
| `.github/hooks/PreDeploy.md` | Implement hook wiring (already specced — this slice wires it) |
| `.github/hooks/PostSlice.md` | Implement hook wiring (already specced — this slice wires it) |
| `.github/hooks/PreAgentHandoff.md` | Implement hook wiring + OpenClaw POST (already specced — this slice wires it) |
| `pforge-mcp/tests/` | New test cases for both handlers, hook logic, fix plan generation |
| `docs/capabilities.md` | Count update (30→32), new tool rows |
| `docs/capabilities.html` | Count update, 2 new tool cards |
| `ROADMAP.md` | v2.29.0 entry |
| `docs/plans/auto/` | New directory created by `forge_fix_proposal` at runtime — not committed empty |
| `.gitignore` | Add `docs/plans/auto/` to prevent accidental commit of auto-generated fix plans |

### Out of Scope (Explicitly Forbidden)

- **No autonomous code execution** — `forge_fix_proposal` generates a plan file, period. It does not run `pforge run-plan` at any point, under any condition, without explicit human invocation and `approvalSecret`
- **No git push from hooks** — hooks inject context and read data stores; they never write to git
- **No new npm dependencies** — hook logic uses Node.js built-ins and existing orchestrator helpers
- **No quorum calls from `server.mjs`** — `forge_quorum_analyze` accepts a LiveGuard snapshot and returns a structured prompt for the client to run through quorum; it does not invoke any LLM API directly
- **No OpenClaw API schema definition** — OpenClaw's endpoint accepts the snapshot payload defined in `PreAgentHandoff.md`; Plan Forge POSTs it, doesn't own the receiving schema
- **No automatic merge to master** — all fix proposals run on branches; PR creation is a future CI/CD extension

---

## New Data Stores (`.forge/`)

All created lazily on first use.

| File/Dir | Schema | Written By |
|----------|--------|-----------|
| `docs/plans/auto/LIVEGUARD-FIX-<incidentId>.md` | Standard Plan Forge plan format — 1-2 slices, scoped to failing gates | `forge_fix_proposal` |
| `.forge/fix-proposals.json` | `[{ incidentId, planFile, generatedAt, status: "proposed"\|"executed"\|"closed", triggeredBy: "regression"\|"drift"\|"incident"\|"secret" }]` — cap enforcement log | `forge_fix_proposal` |

---

## Execution Slices

### Slice 1 — `generateFixPlan()` Helper [hard prerequisite]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs"`

**Goal**: Add the shared helper that all fix proposal logic depends on. Generates a valid Plan Forge plan file (2-slice structure: fix + verify) from a structured failure descriptor input.

**Tasks**:
1. Add `generateFixPlan(descriptor)` export to `orchestrator.mjs`:
   - `descriptor` shape: `{ incidentId, failureType: "regression"|"drift"|"secret"|"incident", failedSlices: [{ sliceId, planFile, command, output }], affectedFiles: string[], severity: string }`
   - Generates a markdown plan file at `docs/plans/auto/LIVEGUARD-FIX-<incidentId>.md`
   - Calls `ensureForgeDir('docs/plans/auto')` first
   - Plan structure: plan header (auto-generated, links to originating incident), 1 fix slice (scoped to the failing gate commands only — not a broad rewrite), 1 verification slice (re-runs the exact failing commands from `failedSlices[].command`)
   - Fix slice is a **template with TODO markers** — it does NOT generate code. Example fix slice body: `## What to Fix\n\n<!-- TODO: Review the failing gate output and fix the identified issue -->\n\nFailing command: \`{command}\`\nOutput: \`\`\`\n{output}\n\`\`\`\n\nAffected files: {affectedFiles.join(', ')}`
   - Returns `{ planFile: string, sliceCount: 2, generatedAt }`
2. Add cap enforcement: read `.forge/fix-proposals.json` before generating; if an entry with the same `incidentId` exists with `status: "proposed"`, return `{ planFile: existing.planFile, alreadyExists: true }` — do not overwrite
3. Append new entry to `.forge/fix-proposals.json` via `appendForgeJsonl`
4. Add unit tests for `generateFixPlan` in `orchestrator.test.mjs`:
   - Returns valid plan file path
   - Plan file contains originating incidentId in header
   - Fix slice contains the failing command
   - Verify slice re-runs the exact failing commands
   - Cap enforcement returns existing path on duplicate incidentId

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs"
node -e "
const { generateFixPlan } = await import('./pforge-mcp/orchestrator.mjs');
const result = await generateFixPlan({
  incidentId: 'test-001',
  failureType: 'regression',
  failedSlices: [{ sliceId: 'S1', planFile: 'test.md', command: 'npm test', output: 'FAIL' }],
  affectedFiles: ['src/test.js'],
  severity: 'high'
});
const fs = await import('fs');
const content = fs.readFileSync(result.planFile, 'utf8');
if (!content.includes('test-001')) throw new Error('incidentId missing from plan');
if (!content.includes('npm test')) throw new Error('failing command missing from plan');
console.log('ok — plan generated at', result.planFile);
"
```

**Stop Condition**: If `docs/plans/auto/` cannot be created (permissions issue) → return `{ error: "cannot create docs/plans/auto/ — check filesystem permissions" }`. No throw. Do not write to `.forge/` as a fallback — plan files must be in `docs/plans/auto/` to be recognized by `pforge run-plan`.

---

### Slice 2 — `forge_fix_proposal` Tool [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: MCP tool and CLI command that triggers `generateFixPlan()` from a regression guard result or a drift report result. The primary integration path for the "detect → propose → approve → fix" loop.

**Tasks**:
1. Add `forge_fix_proposal` to TOOLS array:
   ```
   name: "forge_fix_proposal"
   inputs:
     source ("regression"|"drift"|"incident"|"secret", required — which LiveGuard tool triggered this)
     incidentId (string, optional — links to .forge/incidents/<id>.json)
     regressionResultFile (string, optional — path to .forge/regression-gates.json, used when source="regression")
     driftResultFile (string, optional — path to .forge/drift-history.json, used when source="drift")
     maxSlices (number, default 2 — cap on generated fix plan size)
   returns: { planFile, alreadyExists: boolean, generatedAt, incidentId, sliceCount, nextStep: string }
   ```
2. Handler logic:
   - Load the source data:
     - `source="regression"`: read `.forge/regression-gates.json`, extract all `status: "failed"` results
     - `source="drift"`: read `.forge/drift-history.json` last entry, extract top 5 violations by severity
     - `source="incident"`: read `.forge/incidents/<incidentId>.json`, use `affectedFiles` and `sliceRef`
     - `source="secret"`: read `.forge/secret-scan-cache.json`; extract `findings[]`; build descriptor with `failureType: "secret"`, `affectedFiles: findings.map(f => f.file)`, fix slice template body: `"## What to Fix\n\nRemove the identified secret from the diff and rotate the credential immediately.\n\nFinding: {findings[0].type} in {findings[0].file}:{findings[0].line} (confidence: {findings[0].confidence})\n\n> Never commit the rotation PR until the old credential is revoked."`. `incidentId` defaults to `"secret-" + findings[0].file.replace(/\W/g, '-') + "-" + Date.now()`
   - Build `descriptor` from loaded data and call `generateFixPlan(descriptor)`
   - `nextStep` in response: `"Review docs/plans/auto/<planFile>, then run: pforge run-plan --assisted docs/plans/auto/<planFile>"`
   - Emit telemetry via `emitToolTelemetry` (the Cross-Cutting pattern from v2.27)
3. Add REST endpoints:
   - `POST /api/fix/propose` (requires auth via `checkApprovalSecret()`) — accepts `{ source, incidentId?, regressionResultFile?, driftResultFile? }`; same as tool invocation
   - `GET /api/fix/proposals` (no auth) — returns `.forge/fix-proposals.json` as array; returns `[]` if absent
4. Add `pforge fix-proposal --source regression|drift|incident|secret [--incident-id ID]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_fix_proposal` entry to `capabilities.mjs` TOOL_METADATA with explicit note: `"sideEffects": ["writes docs/plans/auto/LIVEGUARD-FIX-{incidentId}.md", "appends .forge/fix-proposals.json"]`

**Security note**: The generated plan file is a markdown document. It does NOT contain executable code — only template markers and the failing command as display text. It CANNOT be executed without explicit `pforge run-plan` invocation and `approvalSecret`. Add to TOOL_METADATA `securityNote`: `"Fix plans are templates requiring human review — not auto-executed."`

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
curl -s -X POST http://localhost:3100/api/fix/propose -H "Content-Type: application/json" \
  -d '{"source":"regression"}' | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.status !== 401 && !d.error?.includes('auth')) throw new Error('expected 401')"
curl -s http://localhost:3100/api/fix/proposals | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!Array.isArray(d)) throw new Error('expected array')"
node -e "
import('./pforge-mcp/server.mjs').then(async () => {
  // Use REST or direct handler test via test harness
  console.log('see server.test.mjs for cap enforcement test');
})"
```

**Stop Condition**: If `.forge/regression-gates.json` is absent or empty (no regression run yet) → return `{ error: 'no regression data — run pforge regression-guard first', planFile: null }`. No throw. Same pattern for drift, incident, and secret sources when their data stores are empty (`secret-scan-cache.json` absent → `{ error: 'no secret scan data — run pforge secret-scan first', planFile: null }`).

---

### Slice 3 — `forge_quorum_analyze` Tool [depends: Slice 2]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Accept a LiveGuard snapshot (or the name of a specific LiveGuard data source) and return a structured quorum prompt that the MCP client can run through `pforge run-plan --quorum`. The tool itself makes no LLM calls — it is a prompt architect, not an AI agent. Quorum happens at the client layer.

**Why this belongs in `server.mjs`**: The quorum prompt requires precise formatting of LiveGuard data (violations, findings, incidents) into a structure the quorum voter can reason about. That assembly logic belongs in the data layer (server), not in ad hoc client prompts.

**Tasks**:
1. Add `forge_quorum_analyze` to TOOLS array:
   ```
   name: "forge_quorum_analyze"
   inputs:
     source ("drift"|"incident"|"triage"|"runbook"|"fix-proposal", required)
     targetFile (string, optional — specific data file; defaults to most recent for source type)
     analysisGoal (string, optional — what question to answer: "root-cause"|"risk-assess"|"fix-review"|"runbook-validate"; ignored when customQuestion is provided)
     customQuestion (string, optional — freeform question that overrides the analysisGoal preset entirely; max 500 chars)
     quorumSize (number, default 3 — number of model votes to request in the prompt)
   returns: { quorumPrompt: string, promptTokenEstimate: number, suggestedModels: string[], dataSnapshotAge: string, questionUsed: string }
   ```
2. Handler logic (pure data assembly — no model calls):
   - Load the requested source data from `.forge/`
   - Resolve the Question section: if `customQuestion` is provided and its length is ≤ 500 chars, use it verbatim; otherwise use the `analysisGoal` preset map. If neither is provided, default to `"risk-assess"` preset question.
   - Build a structured quorum prompt with 3 sections:
     - **Context**: the LiveGuard snapshot data (drift score + top violations, or incident record, or triage list)
     - **Question**: resolved question string (preset or custom)
     - **Voting instruction**: `"Each model must respond with: (1) a confidence score 0-100, (2) a one-paragraph answer, (3) one concrete recommendation. The aggregator accepts answers with confidence >= {threshold} and majority consensus."`
   - `suggestedModels`: read from `.forge.json` `quorum.models` if configured; else fall back to the power preset defaults `["claude-opus-4.6", "grok-4.20", "gemini-3-pro-preview"]`. Never hardcode — the config is the source of truth.
   - `promptTokenEstimate`: rough count via `Math.ceil(quorumPrompt.length / 4)`
   - `questionUsed`: echo back the resolved question string so the caller can log/audit it
   - Does NOT call `pforge run-plan` — returns the prompt for the caller to decide whether to run it
   - **Security**: validate `customQuestion` is plain text only (reject strings containing `<script`, `javascript:`, or control characters)
3. Add REST endpoints:
   - `POST /api/quorum/prompt` (no auth required — read-only, returns a prompt string) — accepts `{ source, targetFile?, analysisGoal?, quorumSize? }`
   - `GET /api/quorum/prompt?source=triage&goal=risk-assess` (no auth) — shorthand GET for simple cases
4. Add `pforge quorum-analyze --source drift|triage|incident [--goal root-cause] [--custom-question "..."] [--quorum-size 3]` to `pforge.ps1` and `pforge.sh`. `--custom-question` overrides `--goal` when both are provided.
5. Add `forge_quorum_analyze` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
curl -s -X POST http://localhost:3100/api/quorum/prompt \
  -H "Content-Type: application/json" -d '{"source":"triage","analysisGoal":"risk-assess"}' | \
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.quorumPrompt?.includes('confidence')) throw new Error('voting instruction missing'); if(!d.questionUsed) throw new Error('questionUsed missing'); console.log('tokens:', d.promptTokenEstimate)"
curl -s -X POST http://localhost:3100/api/quorum/prompt \
  -H "Content-Type: application/json" \
  -d '{"source":"triage","customQuestion":"Which alert should I address first given the current sprint deadline?"}' | \
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.quorumPrompt?.includes('sprint deadline')) throw new Error('custom question not in prompt'); console.log('custom question ok')"
```

**Stop Condition**: If the source data store is empty or absent → return `{ quorumPrompt: null, error: "no {source} data available — run the corresponding LiveGuard tool first" }`. No throw.

---

### Slice 4 — `PreDeploy` Hook Implementation [P, depends: Slice 2]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Wire the `PreDeploy` hook spec at `.github/hooks/PreDeploy.md` into the existing `PreToolUse` hook mechanism. Invoke `forge_secret_scan` and `forge_env_diff` cache reads before any deploy-pattern file writes or commands.

**Tasks**:
1. Extend the `PreToolUse` hook handler (in the hooks system, not in `server.mjs`) to detect deploy triggers:
   - File write paths matching: `deploy/**`, `Dockerfile*`, `*.bicep`, `*.tf`, `k8s/**`, `docker-compose*.yml`
   - Terminal commands matching: `pforge deploy-log`, `docker push`, `az deploy`, `kubectl apply`, `azd up`, `git push`
2. On trigger: read `.forge/secret-scan-cache.json` via `readForgeJson`
   - If cache age > 10 minutes OR file absent: invoke `forge_secret_scan` handler directly (not via CLI subprocess) and wait for result
   - If `findings.length > 0` and `hooks.preDeploy.blockOnSecrets !== false`: return `{ blocked: true, reason: "secret-scan-findings", findings: [...masked findings...] }` — the agent session sees a hard stop
3. On trigger: read `.forge/env-diff-cache.json` via `readForgeJson`
   - If cache age > 10 minutes OR file absent: invoke `forge_env_diff` handler directly
   - If `summary.totalMissing > 0` and `hooks.preDeploy.warnOnEnvGaps !== false`: inject the advisory as a non-blocking system message
4. Read config from `.forge.json` `hooks.preDeploy` — use defaults if absent (defined in `PreDeploy.md`)
5. Add unit tests:
   - Hook fires on `Dockerfile` write trigger
   - Hook blocks when `secret-scan-cache.json` has findings and `blockOnSecrets: true`
   - Hook does NOT block when `secret-scan-cache.json` has `clean: true`
   - Hook passes advisory (not block) when `env-diff-cache.json` has missing keys

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
echo '{"clean":false,"findings":[{"file":"src/config.js","line":5,"type":"api_key","entropyScore":4.8,"masked":"<REDACTED>","confidence":"high"}],"scannedAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > .forge/secret-scan-cache.json
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs" --grep "PreDeploy"
rm .forge/secret-scan-cache.json
```

**Stop Condition**: If the existing `PreToolUse` hook mechanism does not support returning `{ blocked: true }` (no block API) → implement block as a warning injection only (`blockOnSecrets` becomes advisory-only for this release); document the limitation in `PreDeploy.md` under Implementation Notes.

---

### Slice 5 — `PostSlice` + `PreAgentHandoff` Hook Implementation [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Wire the `PostSlice` and `PreAgentHandoff` hook specs into the existing `PostToolUse` and `SessionStart` hook mechanisms. Add OpenClaw bridge POST to the `PreAgentHandoff` flow.

**Tasks**:

#### PostSlice

1. Extend `PostToolUse` hook handler to detect `git commit` with conventional commit message (regex: `/^(feat|fix|refactor|perf|chore|style|test)\(/`)
2. On trigger: read `.forge/drift-history.json` last two entries via `readForgeJsonl`
3. Compute `priorScore` (second-to-last entry) and `newScore` (last entry); calculate `delta = priorScore - newScore`
4. Inject advisory/warning system message per the thresholds in `PostSlice.md`
5. Track `postSliceHookFired` in module-level session state to prevent duplicate firings

#### PreAgentHandoff

6. **PFORGE_QUORUM_TURN guard** — At the very start of the `SessionStart` handler, check `process.env.PFORGE_QUORUM_TURN`. If set (any truthy value), skip the entire context injection and return immediately. Quorum model turns receive only the prompt text — not the LiveGuard header — to avoid inflating token usage and polluting quorum voters with operational context they shouldn't factor into their votes. Log: `[PreAgentHandoff] skipping context injection — PFORGE_QUORUM_TURN active`.
7. Extend `SessionStart` hook handler to detect trigger conditions (dirty branch OR active plan files OR auto-fix plans)
7. On trigger: read all LiveGuard caches (triage, drift, incidents, secret-scan, deploy-journal) via `readForgeJson` — all file reads, no subprocesses unless cache is stale (>30 min)
9. If dirty branch detected (`git diff --name-only origin/master` returns files): invoke `forge_regression_guard` handler directly with those files
10. Build and inject the context header string per the format in `PreAgentHandoff.md`
11. If `openclaw.endpoint` in `.forge.json`: fire `postOpenClawSnapshot()` helper (add to `orchestrator.mjs`) — non-blocking Promise, no await, log failure silently

**`postOpenClawSnapshot(endpoint, apiKey, snapshot)` helper** (add to `orchestrator.mjs`):
```javascript
export async function postOpenClawSnapshot(endpoint, apiKey, snapshot) {
  try {
    const res = await fetch(`${endpoint}/api/liveguard/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Forge-Version': VERSION
      },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(5000) // 5s hard timeout — never block session start
    });
    if (!res.ok) console.warn(`[PreAgentHandoff] OpenClaw snapshot POST failed: ${res.status}`);
  } catch (err) {
    console.warn(`[PreAgentHandoff] OpenClaw snapshot skipped: ${err.message}`);
  }
}
```

12. Add unit tests:
    - `PostSlice` injects advisory when delta > 5 with score >= 70
    - `PostSlice` injects warning when delta > 10 or score < 70
    - `PostSlice` is no-op when score held or improved
    - `PreAgentHandoff` injects context block with drift score from cache
    - `PreAgentHandoff` returns immediately (no injection) when `PFORGE_QUORUM_TURN` env var is set
    - `PreAgentHandoff` skips OpenClaw POST (no error) when `openclaw.endpoint` absent
    - `postOpenClawSnapshot` returns without throw when endpoint is unreachable

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
node -e "import('./pforge-mcp/orchestrator.mjs').then(m => { if(typeof m.postOpenClawSnapshot !== 'function') throw new Error('missing'); console.log('ok'); })"
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs" --grep "PreAgentHandoff.*empty"
PFORGE_QUORUM_TURN=1 bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs" --grep "PreAgentHandoff.*quorum"
```

**Stop Condition**: If `SessionStart` hook mechanism does not support asynchronous context injection (hooks must be synchronous) → implement the LiveGuard context read synchronously using `readFileSync` calls; mark OpenClaw POST as fire-and-forget only (already is). Document in `PreAgentHandoff.md` if async is unsupported.

---

### Slice 6 — `.gitignore` + `docs/plans/auto/` Setup [P, depends: Slice 2]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Ensure auto-generated fix plans don't accidentally land in version control, and the `docs/plans/auto/` directory is documented.

**Tasks**:
1. Add to `.gitignore`:
   ```
   # Auto-generated LiveGuard fix proposals (human reviews and runs manually)
   docs/plans/auto/
   # Exception: static README is committed (it's documentation, not a generated artifact)
   !docs/plans/auto/README.md
   ```
2. Create `docs/plans/auto/.gitkeep` — empty file so the directory is tracked structurally but content is ignored
3. Add `docs/plans/auto/README.md` — **this file is committed** (gitignore exception above):
   - Explains the directory is populated by `forge_fix_proposal`
   - Explains the review-and-run workflow: `pforge run-plan --assisted docs/plans/auto/<plan>.md`
   - Notes the cap: one proposal per incidentId; subsequent calls return the existing plan
   - Notes the plan is gitignored — it is local-only until the human promotes it to `docs/plans/` manually
4. Update `docs/capabilities.md`: add `docs/plans/auto/` to the "File Outputs" reference section

**Validation Gate**:
```bash
grep -c "docs/plans/auto" .gitignore  # must be >= 1
grep -c '!docs/plans/auto/README.md' .gitignore  # must be >= 1 (exception)
test -d docs/plans/auto && echo "ok"
git status --ignored docs/plans/auto/ | grep -c "Ignored" || echo "not ignored — check .gitignore"
git ls-files docs/plans/auto/README.md | grep -c README.md  # must be 1 (tracked)
```

---

### Slice 7 — Capabilities Surface + Doc Updates [depends: Slices 2, 3, 5, 6]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Update all machine-readable and human-readable surfaces to reflect 32 MCP tools, 4 new REST endpoints, 3 new hooks, and the OpenClaw bridge.

**Tasks**:
1. `pforge-mcp/capabilities.mjs` — add `forge_fix_proposal`, `forge_quorum_analyze` to TOOL_METADATA; add 4 new REST endpoints
2. `docs/capabilities.md`:
   - Header: `30 MCP` → `32 MCP`
   - Add `forge_fix_proposal`, `forge_quorum_analyze` rows to MCP table
   - Add 4 new REST endpoint rows
   - Add "Lifecycle Hooks" section: list `PreDeploy`, `PostSlice`, `PreAgentHandoff` with trigger conditions and behavior summary
   - Add "OpenClaw Bridge" subsection under LiveGuard section
3. `docs/capabilities.html`:
   - Update count badge `30 MCP` → `32 MCP`
   - Add 2 new tool cards
   - Add hooks summary block to LiveGuard section
4. `ROADMAP.md` — add v2.29.0 entry
5. `docs/manual/liveguard-tools.html` (Ch 16) — add `forge_fix_proposal` and `forge_quorum_analyze` entries to the tools table and reference sections
6. `docs/manual/liveguard-runbooks.html` (Appendix F) — add "Fix Proposal Workflow" runbook section: trigger → review plan → run on branch → verify → promote or close
7. Update `copilot-instructions.md` hooks table: add `PreDeploy`, `PostSlice`, `PreAgentHandoff` rows

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
curl http://localhost:3100/api/capabilities | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.tools.length!==32) throw new Error('Expected 32, got '+d.tools.length); console.log('ok — 32 tools')"
grep -c "forge_fix_proposal" docs/capabilities.md  # must be >= 1
grep -c "PreDeploy\|PostSlice\|PreAgentHandoff" docs/capabilities.md  # must be 3
```

**Stop Condition**: If tool count at `GET /api/capabilities` is not 32 → debug TOOL_METADATA vs TOOLS array discrepancy before proceeding to Slice 8.

---

### Slice 8 — Tests + VERSION + CHANGELOG + Push [depends: Slice 7]
**Build command**: `npx vitest run`  
**Test command**: `npx vitest run`

**Goal**: Full test coverage, version bump, clean commit and push.

**Tasks**:
1. `pforge-mcp/tests/server.test.mjs` — add for `forge_fix_proposal`:
   - Returns valid `planFile` path when source data exists
   - `POST /api/fix/propose` returns 401 without auth token
   - `GET /api/fix/proposals` returns 200 + array
   - Cap enforcement: second call with same incidentId returns `alreadyExists: true`
2. `pforge-mcp/tests/server.test.mjs` — add for `forge_quorum_analyze`:
   - Returns `quorumPrompt` string containing all 3 sections (Context, Question, Voting instruction)
   - Returns `suggestedModels` array with 3 entries
   - Returns `{ quorumPrompt: null, error: "..." }` when source data absent (no throw)
3. `pforge-mcp/tests/orchestrator.test.mjs` — add for `generateFixPlan`:
   - Plan file written to `docs/plans/auto/`
   - Plan contains incidentId and failing command
   - Cap enforcement works correctly
4. `pforge-mcp/tests/server.test.mjs` — hook integration:
   - `PreDeploy` blocks on secret findings
   - `PostSlice` injects advisory on drift delta > 5
   - `PreAgentHandoff` builds context block from cached LiveGuard data
   - `postOpenClawSnapshot` does not throw when endpoint is unreachable
5. Bump `VERSION` to `2.29.0`
6. Prepend `CHANGELOG.md` entry:
   ```
   ## [2.29.0] — 2026-xx-xx
   ### Added
   - forge_fix_proposal: generates scoped 1-2 slice fix plans from regression/drift failures (capped, human-approved)
   - forge_quorum_analyze: assembles structured quorum prompt from LiveGuard data for multi-model analysis
   - GET /api/fix/proposals, POST /api/fix/propose
   - GET /api/quorum/prompt, POST /api/quorum/prompt
   - docs/plans/auto/: directory for auto-generated fix plans (gitignored)
   ### Hooks (new)
   - PreDeploy: blocks deploy writes when forge_secret_scan finds secrets
   - PostSlice: injects drift advisory/warning after every feat|fix|refactor commit
   - PreAgentHandoff: injects LiveGuard context block at session start + OpenClaw bridge POST
   ### Integration
   - OpenClaw bridge: optional POST to openclaw.endpoint on PreAgentHandoff
   - forge_quorum_analyze: client-side quorum analysis of LiveGuard snapshots (no server-side LLM calls)
   ```
7. `git add -A`
8. `git commit -m "feat(liveguard): fix proposals, quorum analysis, deploy/slice/handoff hooks, OpenClaw bridge (v2.29.0)"`
9. `git push origin master`

**Validation Gate**:
```bash
npx vitest run
cat VERSION  # must read 2.29.0
git log --oneline -1
curl http://localhost:3100/api/capabilities | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(d.tools.length!==32) throw new Error('tool count wrong'); console.log('ok — 32 tools')"
git show --stat HEAD | grep "plans/auto" && echo "FAIL — auto plans committed" || echo "ok — auto plans not committed"
node -e "
const fs = require('fs');
// Seed a minimal regression failure
const regDir = '.forge'; if (!fs.existsSync(regDir)) fs.mkdirSync(regDir, {recursive:true});
fs.writeFileSync('.forge/regression-gates.json', JSON.stringify([{sliceId:'S1',planFile:'test.md',command:'npm test',status:'failed',output:'FAIL',timestamp:new Date().toISOString()}]));
" && \
pforge fix-proposal --source regression && \
ls docs/plans/auto/LIVEGUARD-FIX-* && echo "ok — vertical smoke: plan generated" || echo "FAIL — vertical smoke" && \
rm -rf docs/plans/auto/LIVEGUARD-FIX-* && \
node -e "const fs=require('fs'); const fp=JSON.parse(fs.readFileSync('.forge/fix-proposals.json','utf8')); fs.writeFileSync('.forge/fix-proposals.json','[]'); console.log('cleaned',fp.length,'proposals')"
```

---

## Rollback Plan

1. **`forge_fix_proposal`**: Comment out TOOLS entry and handler; delete `docs/plans/auto/`; remove `fix-proposals.json`. Server restarts cleanly.
2. **`forge_quorum_analyze`**: Comment out TOOLS entry and handler. No data stores affected — read-only.
3. **Hooks**: Each hook is independently wired in the hook mechanism. Disable via `.forge.json` `hooks.<name>.enabled: false`. No code revert needed for advisory-only hooks.
4. **OpenClaw bridge**: Remove `openclaw` block from `.forge.json`. `postOpenClawSnapshot()` is only called when the endpoint is configured — removing it silences the bridge without a code change.
5. **Git revert**: Single commit per slice. `git revert HEAD~N` reverts cleanly.

---

## Anti-Pattern Checks

```bash
grep -rn "exec(" pforge-mcp/orchestrator.mjs                  # no exec() — use execFile() or spawn()
grep -rn "run-plan" pforge-mcp/server.mjs                     # forge_fix_proposal must NOT invoke run-plan
grep -rn "require(" pforge-mcp/dashboard/app.js               # no Node.js require() in browser JS

node -e "
const fs = require('fs'), path = require('path');
const autoDir = 'docs/plans/auto';
if (!fs.existsSync(autoDir)) { console.log('ok — no auto plans yet'); process.exit(0); }
const plans = fs.readdirSync(autoDir).filter(f => f.endsWith('.md'));
for (const p of plans) {
  const content = fs.readFileSync(path.join(autoDir, p), 'utf8');
  // Plans must not contain exec/spawn/require calls (not runnable code)
  if (/\\bexec\\b|\\bspawn\\b|require\\(/.test(content))
    throw new Error('Auto plan contains executable code: ' + p);
}
console.log('ok — ' + plans.length + ' auto plan(s) checked');
"

node -e "
const fs = require('fs');
const src = fs.readFileSync('pforge-mcp/server.mjs', 'utf8');
const newTools = ['forge_fix_proposal', 'forge_quorum_analyze'];
const covered = newTools.filter(t => {
  const idx = src.indexOf(t);
  if (idx < 0) return false;
  return src.substring(idx, idx + 1500).includes('emitToolTelemetry');
});
if (covered.length < 2) throw new Error('Missing emitToolTelemetry in: ' + newTools.filter(t => !covered.includes(t)).join(', '));
console.log('ok — both new handlers have telemetry');
"
```

---

## Patterns to Reuse (Do Not Reinvent)

| Need | Where to Find It |
|------|-----------------|
| Plan file generation | Study existing plan template format in `docs/plans/Phase-LiveGuard-v2.27.0-PLAN.md` — the auto-generated plan must follow the same 6-mandatory-block structure |
| JSONL append | `appendForgeJsonl()` from `orchestrator.mjs` (v2.27 Slice 1) |
| File existence check | `readForgeJson(path, defaultValue)` — returns default when absent, no throw |
| Write endpoint auth | `checkApprovalSecret()` — already imported in `server.mjs` |
| Unified telemetry | `emitToolTelemetry()` from `orchestrator.mjs` |
| Hub broadcast | `activeHub?.broadcast()` — called inside `emitToolTelemetry` automatically |
| HTTP POST (OpenClaw) | `fetch()` with `AbortSignal.timeout(5000)` — Node.js 18+ built-in, no axios/got |
| Bridge notification | `activeBridge?.dispatch()` — same pattern used by all LiveGuard handlers |

---

## Verification

| Check | Command | Expected |
|-------|---------|----------|
| Tool count | `curl http://localhost:3100/api/capabilities \| node -e "..."` | `32` |
| All tests | `npx vitest run` | 0 failures |
| Fix proposal generates | `pforge fix-proposal --source regression` (with regression data) | `planFile` written to `docs/plans/auto/` |
| Cap enforcement | Run fix-proposal twice with same incidentId | Second call: `alreadyExists: true` |
| Quorum prompt | `pforge quorum-analyze --source triage` | Returns `quorumPrompt` string |
| PreDeploy blocks | write to `Dockerfile` with secret in cache | `{ blocked: true }` injected |
| PostSlice advisory | commit after drift drops 8 points | advisory injected in next turn |
| PreAgentHandoff | new session on dirty branch | LiveGuard context block injected |
| OpenClaw POST | configure `openclaw.endpoint` and trigger handoff | POST fires; failure is silent |
| capabilities.md count | `head -4 docs/capabilities.md` | `32 MCP` |

---

## Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| `forge_fix_proposal` generates a plan file, not code | Maintains the forge workflow: human reviews before execution. Prevents silent auto-patching. |
| Fix plans are gitignored | Auto-generated plans are local-only until promoted deliberately. Prevents polluting plan history with agent-generated drafts. |
| Cap at one proposal per incidentId | Prevents runaway proposal generation. One attempt → human reviews. If the fix fails, the human re-runs with context, not the agent autonomously. |
| `forge_quorum_analyze` returns a prompt, not a quorum result | Server stays data-only. The quorum model invocations happen at the client (MCP caller) layer, which has model access. `server.mjs` never has API keys. |
| OpenClaw POST is fire-and-forget with 5s timeout | Session start must not be blocked by network latency. OpenClaw is an enhancement, not a dependency. |
| Hooks use `.forge.json` for config, not separate hook config file | Consistent with the established `.forge.json` pattern (`bridge`, `model`, `onCall`). One config file to manage. |
| `PostSlice` is advisory-only, never blocking | Drift fluctuations during active development are expected. Blocking the agent mid-plan on a noise signal would break the forge workflow. Advisory keeps the human informed without stopping work. |
| `forge_fix_proposal` supports `source="secret"` | Parity with other LiveGuard sources. Secret findings are the highest-urgency trigger for a fix proposal (immediate credential rotation required). Covered by the same `generateFixPlan()` helper with a purpose-built fix slice template. |
| `PreAgentHandoff` skips context injection when `PFORGE_QUORUM_TURN` is set | Quorum voters must reason from the prompt alone, not from injected operational context. Mixing LiveGuard health state into quorum votes contaminates the consensus signal. Each voter gets a clean context. |
| `docs/plans/auto/README.md` is committed (gitignore exception) | Static documentation belongs in version control; generated artifacts do not. The exception `!docs/plans/auto/README.md` is the standard pattern for committing documentation inside an ignored directory. |
| `forge_quorum_analyze` exposes `customQuestion` in v2.29 (not deferred to v2.30) | Maximum flexibility: preset `analysisGoal` values cover the common cases; `customQuestion` covers the long tail without requiring a plan change. The 500-char limit and XSS validation keep it safe. `questionUsed` in the response enables audit logging. |

---

## Open Questions

> ✅ All resolved — decisions applied to slices above and recorded in Architectural Decisions.

| # | Question | Decision | Applied To |
|---|----------|----------|------------|
| OQ1 ✅ | Should `forge_fix_proposal` support `source="secret"`? | **Yes** — `source` enum expanded; fix slice template targets credential removal + rotation. | Slice 2 Tasks 1–2, Stop Condition |
| OQ2 ✅ | Should `PreAgentHandoff` skip context injection during quorum model turns? | **Yes** — `PFORGE_QUORUM_TURN` env var guard as first check in `SessionStart` handler. | Slice 5 Task 6, unit tests |
| OQ3 ✅ | Should `docs/plans/auto/README.md` be committed? | **Yes (committed)** — static doc; gitignore exception `!docs/plans/auto/README.md` added. | Slice 6 Task 1, validation gate |
| OQ4 ✅ | Should `forge_quorum_analyze` support `customQuestion` freeform override? | **Yes, in v2.29** — max 500 chars, XSS-validated, echoed back as `questionUsed`; `analysisGoal` presets remain available as default. | Slice 3 Task 1–2, CLI, validation gate |

---

## 6 Mandatory Blocks — Verification

| # | Block | Present |
|---|-------|---------|
| 1 | Numbered execution slices with build/test commands | ✅ |
| 2 | Explicit validation gates per slice | ✅ |
| 3 | Stop conditions | ✅ |
| 4 | Rollback plan | ✅ |
| 5 | Anti-pattern checks | ✅ |
| 6 | Scope contract with explicit Out of Scope | ✅ |
