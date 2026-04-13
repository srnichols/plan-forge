# Phase: LiveGuard — Post-Coding Operational Intelligence

> **Roadmap Reference**: [ROADMAP.md](../../ROADMAP.md) → v2.27.0  
> **Status**: 📋 Planned  
> **Target Version**: `2.27.0`  
> **Branch Strategy**: `feature/v2.27-liveguard`  
> **Estimated Effort**: 4–5 days (10 execution slices)  
> **Risk Level**: Medium (new data stores, subprocess gate execution, git integration)

---

## Overview

Plan Forge currently ends at ship time. The MCP server stays with the codebase permanently — LiveGuard turns it into a continuous operational guardian after coding is complete.

Nine new MCP tools, CLI commands, and REST endpoints extend the existing server.mjs/capabilities.mjs/orchestrator.mjs architecture to cover:

1. **Drift detection** — score the codebase against guardrail rules over time
2. **Incident capture** — trace prod incidents back to originating plan slices and generate postmortems
3. **Dependency surveillance** — snapshot CVE state and alert on new vulnerabilities
4. **Regression verification** — re-run plan validation gates against deployed files
5. **Runbook generation** — synthesize operational runbooks from plan artifacts
6. **Hotspot ranking** — rank files by combined churn × failure × incident score
7. **Health trending** — surface project health trajectory across all metrics
8. **Alert triage** — morning briefing aggregating all LiveGuard signals into one ranked priority list
9. **Deploy journal** — flight recorder linking every deploy event to health scores and incident history

All features follow the `forge_memory_capture` pattern established in v2.24.0: TOOLS array entry → handler → REST endpoint → capabilities.mjs metadata.

---

## Brand Narrative

> *Plan Forge is the blacksmith. LiveGuard is the guardian wearing the armor.*

**Plan Forge** is the forge — fire, structure, and craft. It hammers raw ideas into hardened execution plans, slice by slice, with validation gates and guardrails built in from the start. Coding ends at ship time.

**LiveGuard** is what happens next. The armor that was forged doesn't sit on a shelf — it goes to work. LiveGuard is the guardian standing watch in production: shield raised, scanning for drift, ready to capture incidents, track regressions, and surface risk before it becomes an outage.

The narrative arc is the whole product story:

```
      FORGE                              GUARD
 ┌────────────┐                    ┌────────────────┐
 │  Plan it   │                    │  Watch it      │
 │  Build it  │  ──── ship ──────► │  Protect it    │
 │  Ship it   │                    │  Learn from it │
 └────────────┘                    └────────────────┘
  Blacksmith                        Guardian in armor
  hammers structure                 stands watch post-deploy
```

**In one sentence for docs and marketing:**
> "Plan Forge builds the armor. LiveGuard wears it."

### Feature-to-Guardian Mapping (for doc copy)

| Guardian Capability | LiveGuard Tool | What It Protects Against |
|---------------------|----------------|--------------------------|
| Architectural vigilance | `forge_drift_report` | Silent erosion of guardrail compliance over time |
| Battle record | `forge_incident_capture` | Lost context — trace every incident back to its originating slice |
| Supply chain watch | `forge_dep_watch` | New CVEs arriving after ship day |
| Gate re-verification | `forge_regression_guard` | Deploys that silently break previously-passing validation gates |
| Ops memory | `forge_runbook` | Institutional knowledge lost when the plan file is forgotten |
| Risk radar | `forge_hotspot` | Churn + failure + incident clustering in the same files — undetected |
| Health trajectory | `forge_health_trend` | Flying blind on whether the project is getting healthier or not |
| Morning briefing | `forge_alert_triage` | Alert noise — every tool fires independently; no unified view of what needs attention *right now* |
| Deploy memory | `forge_deploy_journal` | No record of when, what, or who deployed — or what health looked like before and after |

### Homepage Hero Concept (for site update in Slice 9)

**Visual**: Forge flames on the left (build phase) → armor / sentinel figure on the right (guard phase) → a glowing pipeline connecting them.

**H1**: "Your code has a guardian now."  
**Sub**: "Plan Forge forged the plan. LiveGuard stands watch after you ship — drift detection, incident capture, regression verification, and health trending in a single MCP server that stays with your code."  
**CTA**: "See LiveGuard →"

---

## Prerequisites

- [x] v2.26.0 shipped (OpenClaw REST API discovery)
- [x] `forge_memory_capture` pattern established in `pforge-mcp/server.mjs` lines 518–533
- [x] `buildMemoryCaptureBlock()` available in `pforge-mcp/memory.mjs`
- [x] `checkApprovalSecret()` available for write endpoint auth
- [x] `forge_run_skill` handler available for reuse in dep_watch skill invocation
- [x] `activeBridge?.dispatch()` pattern available for bridge notifications
- [x] `.forge/cost-history.json` and `.forge/runs/index.jsonl` exist as historical data sources

---

## Acceptance Criteria

- [ ] 9 new MCP tools registered in TOOLS array and callable via MCP client
- [ ] 14 new REST endpoints respond with correct shapes (see Verification section)
- [ ] 9 new `pforge` CLI commands work from both `pforge.ps1` and `pforge.sh`
- [ ] All 9 new `.forge/` data stores are created lazily (no errors on first run with empty state)
- [ ] `curl http://localhost:3100/api/capabilities` returns 28 tools in `tools` array
- [ ] Write endpoints require auth when `bridge.approvalSecret` is configured
- [ ] `forge_regression_guard` uses a command safety allowlist (no arbitrary shell execution)
- [ ] All new features degrade gracefully when git is unavailable
- [ ] `docs/capabilities.md` header reads `28 MCP`
- [ ] `npx vitest run` passes with new test coverage for all 9 handlers
- [ ] Every LiveGuard tool invocation appends a structured entry to `.forge/liveguard-events.jsonl` with `traceId`, `tool`, `status`, `durationMs` (unified telemetry)
- [ ] Hub broadcasts `liveguard-tool-completed` event on every tool call (real-time dashboard visibility)

---

## Scope Contract

### In Scope

| Area | Changes |
|------|---------|
| `pforge-mcp/server.mjs` | +9 TOOLS entries, +9 handlers, +14 REST endpoints |
| `pforge-mcp/capabilities.mjs` | +9 TOOL_METADATA entries, +14 `restApi.endpoints` entries |
| `pforge-mcp/orchestrator.mjs` | +5 shared helpers (`ensureForgeDir`, `readForgeJson`, `appendForgeJsonl`, `parseValidationGates`, `emitToolTelemetry`) |
| `pforge.ps1` + `pforge.sh` | +9 CLI commands |
| `docs/capabilities.md` | Count update (19→28), LiveGuard section |
| `docs/capabilities.html` | Count update, 9 new tool cards, LiveGuard section |
| `docs/faq.html` | 1 new FAQ entry under Enterprise |
| `ROADMAP.md` | v2.27.0 entry |
| `pforge-mcp/tests/` | New test cases for all 9 handlers |

### Out of Scope (Explicitly Forbidden)

- **No new npm dependencies** — use Node.js `child_process`, JSON file I/O, existing plan parser only
- **No dashboard tab** — LiveGuard data is REST-accessible; dashboard tab is v2.28.0 stretch goal
- **No background scheduling daemon** — scheduling is the caller's responsibility (OpenClaw, CI cron, user-triggered)
- **No direct OpenBrain writes** — `forge_incident_capture` returns the `capture_thought` payload; the caller forwards it (same separation-of-concerns as `forge_memory_capture`)
- **No changes to existing tool handlers** — only the backward-compatible `healthTrend` field addition to `forge_cost_report` response
- **`forge_secret_scan` deferred to v2.28.0** — entropy-based secret detection on post-commit diffs; queued as first tool of next LiveGuard release
- **`forge_env_diff` deferred to v2.28.0** — key-presence diff between `.env.*` files across environments; queued as second tool of next LiveGuard release
- **Server binding**: `server.mjs` MUST call `app.listen(3100, '127.0.0.1', ...)` (loopback only, not `0.0.0.0`). The unauthenticated GET endpoints that auto-rerun git subprocesses (`/api/hotspots`, `/api/alerts/triage`) are only safe on a loopback-bound server. Verify this binding is in place before executing Slices 7 and 8.5.

---

## New Data Stores (`.forge/`)

All directories and files created lazily on first use by `ensureForgeDir()` / `readForgeJson()`.

| File/Dir | Schema | Written By |
|----------|--------|-----------|
| `.forge/drift-history.json` | `[{ timestamp, score, violations: [{file, rule, severity}] }]` | `forge_drift_report` |
| `.forge/incidents/<id>.json` | `{ id, timestamp, description, sliceRef, rootCause, postmortem, tags, affectedFiles, severity }` | `forge_incident_capture` |
| `.forge/deps-snapshot.json` | `{ capturedAt, deps: [{ name, version, knownCVEs, status }] }` | `forge_dep_watch` |
| `.forge/regression-gates.json` | `{ compiledAt, gates: [{ sliceId, planFile, commands: [], lastPassed, scopePatterns: [] }] }` | `forge_regression_guard` |
| `.forge/runbooks/<plan>-runbook.md` | Markdown — Overview, Validation, Rollback, Incidents, Monitoring | `forge_runbook` |
| `.forge/hotspot-cache.json` | `{ generatedAt, hotspots: [{ file, churnScore, failureScore, incidentScore, totalScore, rank }] }` | `forge_hotspot` |
| `.forge/health-trend.json` | Append-only JSONL: `{ date, avgSliceCost, avgRetries, quorumRate, driftScore, incidentCount, mttr }` | All LiveGuard tools |
| `.forge/deploy-journal.jsonl` | Append-only JSONL: `{ journalId, timestamp, version, triggeredBy, preHealthScore, sliceRef?, notes }` + sidecar `.forge/deploy-journal-meta.json` for mutable `postHealthScore` | `forge_deploy_journal` |
| `.forge/alert-triage-cache.json` | `{ generatedAt, items: [{ priority, tool, title, severity, details, recommendedAction }], summary: { critical, high, medium, low } }` | `forge_alert_triage` |
| `.forge/liveguard-events.jsonl` | Append-only JSONL (one entry per tool invocation): `{ traceId, tool, timestamp, status: "OK"\|"ERROR", durationMs, attributes }` — unified telemetry log consumed by v2.28.0 dashboard tab | All LiveGuard tools |

**Read-only dependency** (not written by LiveGuard, must exist from prior forge operations):

| File | Schema | Owner |
|------|--------|------|
| `.forge/cost-history.json` | `[{ date, totalCost, sessions }]` | `forge_cost_report` | 

If `.forge/cost-history.json` does not exist, `forge_health_trend` degrades gracefully: `avgSliceCost` metric returns an empty array — no error, no crash.

---

## Execution Slices

### Slice 1 — Operational Data Infrastructure
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs"`

**Goal**: Add shared data helpers to `orchestrator.mjs` that all 7 LiveGuard features depend on. This slice is a hard prerequisite for all others.

**Tasks**:
1. Add `ensureForgeDir(subpath)` export to `orchestrator.mjs`
   - Accepts a path relative to project root (e.g., `.forge/incidents`)
   - Creates dir recursively if absent; no-op if exists
   - No return value
2. Add `readForgeJson(filePath, defaultValue)` export to `orchestrator.mjs`
   - Reads and parses JSON from `.forge/<filePath>`
   - Returns `defaultValue` if file does not exist (no throw)
3. Add `appendForgeJsonl(filePath, record)` export to `orchestrator.mjs`
   - **Atomic write only**: serialize the new record to a temp file (`.forge/<filename>.tmp`), then `fs.renameSync(tmp, target)` — OS-level atomic on POSIX/Windows, preventing partial-write corruption on process crash
   - Creates file on first call (no pre-existing file required)
   - Used by health-trend and incident store
   - Companion `readForgeJsonl(filePath)` reader (for JSONL array files) must use per-line try/catch: `lines.forEach(l => { try { records.push(JSON.parse(l)) } catch (_) {} })` — skips any corrupt partial lines silently; add this reader alongside `readForgeJson`
4. Add `parseValidationGates(planFilePath)` export to `orchestrator.mjs`
   - Parses a plan file's slice headers and extracts: `sliceId`, `scopePatterns` (from `[scope:]` tags), `buildCommand`, `testCommand`, `gateCommands` (the bash block after **Validation Gate**)
   - Returns `[{ sliceId, scopePatterns, gateCommands }]`
   - Reuse the existing slice-parsing logic from `runPlan()` rather than reimplementing
5. Add `emitToolTelemetry(toolName, inputs, result, durationMs, status)` export to `orchestrator.mjs` — the **unified telemetry helper** that ALL 9 LiveGuard tool handlers must call:
   - Generates a `traceId` via `randomUUID()` (already imported from `node:crypto` in orchestrator)
   - Appends one structured entry to `.forge/liveguard-events.jsonl` via `appendForgeJsonl`:
     `{ traceId, tool: toolName, timestamp, status, durationMs, attributes: { ...inputs, ...summary(result) } }`
   - Broadcasts `liveguard-tool-completed` hub event via `activeHub?.broadcast()` with the same payload
   - Import `Severity`, `addEvent` from `./telemetry.mjs` — use `Severity.ERROR` for failed calls, `Severity.INFO` for success
   - Never throws — telemetry failure must not break the tool call
6. Add unit tests in `pforge-mcp/tests/orchestrator.test.mjs` for all 5 helpers

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs"
node -e "import('./pforge-mcp/orchestrator.mjs').then(m => { ['ensureForgeDir','readForgeJson','appendForgeJsonl','parseValidationGates'].forEach(fn => { if(typeof m[fn] !== 'function') throw new Error(fn + ' missing'); }); console.log('ok'); })"
```

**Stop Condition**: If `parseValidationGates` requires duplicating >30 lines from `runPlan()` → extract a shared private `parseSlices()` helper first and call it from both.

---

## Cross-Cutting Telemetry Requirement (applies to ALL Slices 2–8.6)

> **Every LiveGuard tool handler MUST call `emitToolTelemetry()` from Slice 1.** This is non-negotiable — it provides the data that the v2.28.0 LiveGuard Dashboard Tab displays.

The call pattern for every handler (wrap the entire work block):

```javascript
import { emitToolTelemetry } from './orchestrator.mjs';

const t0 = Date.now();
let status = 'OK';
try {
  // ... tool logic ...
  await emitToolTelemetry(toolName, inputs, result, Date.now() - t0, 'OK');
  return result;
} catch (err) {
  status = 'ERROR';
  await emitToolTelemetry(toolName, inputs, { error: err.message }, Date.now() - t0, 'ERROR');
  throw err;
}
```

The hub event fired by `emitToolTelemetry` enables the v2.28 dashboard to update in real-time when any LiveGuard tool runs, without polling.

---

### Slice 2 — `forge_drift_report` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Score the codebase against architecture guardrail rules on demand. Track drift over time. Fire bridge alert when score drops below threshold.

**Tasks**:
1. Add `forge_drift_report` to TOOLS array in `server.mjs`:
   ```
   name: "forge_drift_report"
   description: "Score the codebase against architecture guardrail rules. Tracks drift over time in .forge/drift-history.json. Fires a bridge notification when score drops below threshold."
   inputs: path (string, default "."), threshold (number 0-100, default 70), rules (string[], optional — default: all architecture-principles violations)
   returns: { score, violations: [{file, rule, severity}], trend: "improving"|"stable"|"degrading", delta, historyLength }
   ```
2. Handler logic:
   - **Do NOT spawn `pforge analyze` via child_process** — spawning a CLI tool from within the MCP server creates recursive execution risk and forks the Node.js process unnecessarily
   - Instead, call the analysis logic directly: `import { runAnalyze } from './orchestrator.mjs'` — add `export async function runAnalyze(options)` to `orchestrator.mjs` if it does not already exist as a callable export. The CLI `pforge analyze` command must also call `runAnalyze()` rather than duplicating the logic
   - `runAnalyze({ mode: 'file', path })` returns scored violations against all `.js/.ts/.cs/.py` source files
   - Parse output into `violations` array; compute `score` as `100 - (violations.length * penaltyPerViolation)`
   - Load prior entry from `.forge/drift-history.json` (via `readForgeJson`); compute `delta` and `trend`
   - Append new record via `appendForgeJsonl('.forge/drift-history.json', record)`
   - If `score < threshold`: broadcast `drift-alert` hub event, dispatch bridge notification if configured
3. Add REST endpoints:
   - `GET /api/drift` — run drift check and return result (no auth required)
   - `GET /api/drift/history` — return full `.forge/drift-history.json` contents (no auth required)
4. Add `pforge drift [--threshold N]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_drift_report` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

**Stop Condition**: If `pforge analyze --mode file` subprocess interface doesn't support multi-file mode → run per-file and aggregate results.

---

### Slice 3 — `forge_incident_capture` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Accept a prod incident description, trace it to the originating plan slice, generate a structured postmortem, and return a `capture_thought` payload ready to forward to OpenBrain.

**Tasks**:
1. Add `forge_incident_capture` to TOOLS array:
   ```
   name: "forge_incident_capture"
   inputs: description (string, required), affectedFiles (string[], optional), severity ("low"|"medium"|"high"|"critical", default "medium"), tags (string[], optional), resolvedAt (ISO timestamp string, optional — when provided, MTTR is computed and written to health-trend)
   returns: { incidentId, sliceRef: { sliceId, planFile } | null, postmortem: { rootCause, contributingFactors, preventionRecommendation }, mttr: number | null, capturePayload, onCallNotified: boolean }
   ```
2. Handler logic:
   - Generate UUID `incidentId`, capture timestamp
   - If `affectedFiles` provided: scan `.forge/runs/*/slice-*.json` for slice scope patterns that intersect affected files; set `sliceRef` to the best match
   - Build postmortem as a **markdown template populated from structured data — no LLM API call from `server.mjs`**. The MCP server is a tool server; AI model access belongs to the client (Copilot/Claude). Template sections: `## Root Cause Hypothesis` (filled with slice context: which guardrail rule the affected files violated), `## Contributing Factors` (list of `violations[]` from the most recent `forge_drift_report` for the affected files), `## Prevention Recommendation` (static guardrail reminder text), `## Action Required: [Requires human input]` marker for the human reviewer
   - Return `postmortem` as a markdown string in the tool response; the AI client that receives this response is responsible for further enrichment and forwarding to OpenBrain
   - Write incident record to `.forge/incidents/<incidentId>.json` via `ensureForgeDir` + `writeFileSync`
   - Build `capture_thought` payload using `buildMemoryCaptureBlock()` from `memory.mjs` — note: caller is responsible for forwarding to OpenBrain
   - If `resolvedAt` provided: compute `mttr = Math.round((Date.parse(resolvedAt) - Date.parse(timestamp)) / 60000)` minutes; include in incident record and health-trend append
   - Append summary (including `mttr` when computed) to `.forge/health-trend.json` via `appendForgeJsonl`
   - Read `onCall: { name, channel }` from `.forge.json` if present; if configured, include `onCallTarget` in bridge dispatch payload; set `onCallNotified: true` in incident record only when bridge dispatch fires
3. Add REST endpoints:
   - `POST /api/incidents` (requires auth via `checkApprovalSecret()`) — accepts same body as tool inputs
   - `GET /api/incidents` (no auth) — returns list of all incidents from `.forge/incidents/`
   - `GET /api/incidents/:id` (no auth) — returns single incident JSON
4. Add `pforge incident "<description>" [--severity S] [--files f1,f2] [--resolved-at ISO]` to `pforge.ps1` and `pforge.sh`
   - Add `pforge incident --resolve <incidentId> [--resolved-at ISO]` as a shorthand alias: sets `resolvedAt` on the existing incident file and computes MTTR. Defaults `--resolved-at` to now if omitted.
5. Add `forge_incident_capture` entry to `capabilities.mjs` TOOL_METADATA
6. **MTTR**: `mttr` is `null` when `resolvedAt` is absent. Callers record resolution via a second `pforge incident` call with `--resolved-at`. This decouples capture-time from resolution-time, matching real incident timelines.
   - **UX requirement**: The CLI output of `forge_incident_capture` MUST prominently display the `incidentId` with a usage hint: `"⚠ Save this ID to mark the incident resolved:\n  pforge incident --resolve <incidentId>"`. Emit this regardless of whether the user is using the CLI or MCP client.
   - Add `pforge incident list` as an alias for `GET /api/incidents` in `pforge.ps1` and `pforge.sh` — provides a lookup path when the incidentId has been lost
7. **On-call config**: Read `onCall` from `.forge.json` root (same file as `bridge`, `model`). No new config file needed. Bridge dispatch carries the target; the notification channel is the bridge consumer's responsibility.

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

---

### Slice 4 — `forge_dep_watch` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Snapshot dependency CVE state. Diff against the prior snapshot. Fire bridge notification when new vulnerabilities appear.

**Tasks**:
1. Add `forge_dep_watch` to TOOLS array:
   ```
   name: "forge_dep_watch"
   inputs: path (string, default "."), notify (boolean, default true)
   returns: { newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: number, snapshot: { capturedAt, depCount } }
   ```
2. Handler logic:
   - Load prior snapshot via `readForgeJson('.forge/deps-snapshot.json', { deps: [] })`
   - **Do NOT invoke the `/dependency-audit` skill runner** — skill output is AI-driven Markdown prose, not a guaranteed JSON schema. CVE extraction from unstructured text is fragile and will silently fail on any output format variation.
   - Instead, run `npm audit --json` via `execFile('npm', ['audit', '--json'], ...)` and parse the well-defined npm audit JSON schema directly. Map vulnerabilities to CVE-style objects: `{ name: advisory.module_name, version, severity: advisory.severity, id: advisory.cves[0] || advisory.title }`
   - Use the skill runner via `forge_run_skill` only for the **human-readable report** returned to the user in the tool's narrative description field — not for machine parsing
   - **Stop Condition** (update): If `npm audit --json` is unavailable (non-npm project) — check `package.json` existence first; if absent, return `{ newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: 0, snapshot: { capturedAt, depCount: 0 }, note: "npm audit unavailable — not an npm project" }`. No throw.
   - Diff CVE lists (new = in current but not prior; resolved = in prior but not current)
   - Write updated snapshot to `.forge/deps-snapshot.json`
   - If `notify` and `newVulnerabilities.length > 0`: dispatch bridge notification via `activeBridge?.dispatch()`
3. Add REST endpoints:
   - `GET /api/deps/watch` (no auth) — returns last snapshot from `.forge/deps-snapshot.json`
   - `POST /api/deps/watch/run` (requires auth) — triggers a new dep_watch run
4. Add `pforge dep-watch [--no-notify]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_dep_watch` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

---

### Slice 5 — `forge_regression_guard` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: After a deploy, re-execute the validation gates from plan slices whose scope intersects the deployed files. Report regressions when previously-defined gates now fail.

**Security note**: Gate commands come from user-authored plan files. All commands MUST be validated against a safety allowlist before execution. Commands not matching the allowlist are skipped and logged — never silently executed.

**Safety Allowlist** (prefix match):
`npm`, `pnpm`, `yarn`, `npx`, `node`, `dotnet`, `pytest`, `python -m pytest`, `go test`, `cargo test`, `mvn`, `gradle`, `php`, `pforge`, `bash`, `sh`

**Argument injection guard** (applied AFTER prefix match passes):
- Parse command into argv via simple split on whitespace
- Reject if any argument contains shell metacharacters: `; | & > < $ \` ( ) { }`
- Reject if any argument equals `-c` or `--cmd` (shell command injection vector via allowed prefixes like `bash -c "rm -rf /"`)
- Blocked commands get `status: "blocked"` with `blockedReason: "argument-injection-risk"` (not `"safety-allowlist"`)
- Add to `isGateCommandAllowed(cmd)` return value: `{ allowed: boolean, blockedReason?: string }` — callers already log blocked reasons

**Tasks**:
1. Add `forge_regression_guard` to TOOLS array:
   ```
   name: "forge_regression_guard"
   inputs: deployedFiles (string[], required), planDir (string, default "docs/plans/"), failFast (boolean, default false)
   returns: { passed: number, failed: number, skipped: number, blocked: number, results: [{ sliceId, planFile, command, status, output, blockedReason? }] }
   ```
2. Handler logic:
   - Call `parseValidationGates(planFile)` for all `*.md` files in `planDir`
   - Filter to slices whose `scopePatterns` intersect `deployedFiles` (glob match)
   - **`scopePatterns` extraction**: `parseValidationGates` extracts scope from the slice header's `[scope: <glob>]` tag if present. If no `[scope:]` tag is found for a slice, `scopePatterns` defaults to `['**']` (all files) — that slice's gates run on every deploy. This is the safe default: missing scope = runs always, rather than silently skipping. Document this behavior in TOOL_METADATA.
   - For each gate command: validate against allowlist (including argument injection check); if blocked, add to `blocked` count with `blockedReason`; if allowed, execute via child_process with 60s timeout
   - Write updated `.forge/regression-gates.json` (last run timestamp, results)
   - Append summary to `.forge/health-trend.json`
   - If any failures: dispatch bridge notification
3. Add REST endpoints:
   - `POST /api/regression/run` (requires auth) — accepts `{ deployedFiles, planDir, failFast }`
   - `GET /api/regression/status` (no auth) — returns last run from `.forge/regression-gates.json`
4. Add `pforge regression-guard --files f1,f2 [--fail-fast]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_regression_guard` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
node -e "
import('./pforge-mcp/orchestrator.mjs').then(m => {
  const allowed = m.isGateCommandAllowed('npm test');
  const blocked = m.isGateCommandAllowed('rm -rf /');
  if (!allowed || blocked) throw new Error('allowlist check failed');
  console.log('ok');
})"
```

**Stop Condition**: If `parseValidationGates` cannot reliably extract commands from existing plan files → limit regression guard to `testCommand` fields only (defined in slice header, not bash block) and document the limitation.

---

### Slice 6 — `forge_runbook` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Synthesize an operational runbook from a plan file. Combine plan artifacts (rollback, gates, stop conditions) with any captured incidents to produce a living ops reference.

**Tasks**:
1. Add `forge_runbook` to TOOLS array:
   ```
   name: "forge_runbook"
   inputs: plan (string, required — path to plan file), includeIncidents (boolean, default true)
   returns: { runbookFile: string, sections: string[], incidentsIncluded: number }
   ```
2. Handler logic:
   - Parse plan file: extract Overview, Acceptance Criteria, Rollback Plan, all validation gates, stop conditions, per-slice failure modes
   - If `includeIncidents`: scan `.forge/incidents/*.json` for entries where `sliceRef.planFile` matches `plan`
   - Generate structured markdown runbook to `.forge/runbooks/<plan-kebab-basename>-runbook.md` via `ensureForgeDir`
   - Runbook sections: Overview, Validation Commands, Rollback Procedure, Known Incidents, Monitoring Checklist
   - Return file path and section summary
3. Add REST endpoints:
   - `GET /api/runbooks` (no auth) — list all files in `.forge/runbooks/`
   - `POST /api/runbooks/generate` (requires auth) — accepts `{ plan, includeIncidents }`; same as tool invocation
4. Add `pforge runbook <plan-file> [--no-incidents]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_runbook` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
pforge runbook docs/plans/examples/Phase-TYPESCRIPT-EXAMPLE.md
test -f .forge/runbooks/phase-typescript-example-runbook.md && echo "ok" || echo "fail"
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

---

### Slice 7 — `forge_hotspot` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Rank files by a weighted combination of git churn, plan execution failure rate, and incident frequency. Surface the riskiest areas of the codebase in one command.

**Tasks**:
1. Add `forge_hotspot` to TOOLS array:
   ```
   name: "forge_hotspot"
   inputs: path (string, default "."), topN (number, default 10), since (string, default "3 months ago")
   returns: { hotspots: [{ file, churnScore, failureScore, incidentScore, totalScore, rank }], generatedAt, gitAvailable: boolean }
   ```
2. Handler logic:
   - **Git check**: verify git is available via the same check used by `forge_smith`; if unavailable, return `{ gitAvailable: false, hotspots: [], ... }` — no throw
   - **`since` parameter sanitization**: validate `since` against an allowlist pattern before passing to git — accept ISO dates (`/^\d{4}-\d{2}-\d{2}$/`), relative strings (`/^\d+\s+(day|week|month|year)s?\s+ago$/`), and bare git refs (`/^[0-9a-f]{7,40}$/`). If the format doesn't match, return `{ hotspots: [], generatedAt, gitAvailable: true, error: "invalid 'since' format" }` — do not pass arbitrary strings to git
   - **Churn score**: `git log --since="<since>" --name-only --format= | sort | uniq -c | sort -rn` → normalise top file count to 100
   - **Failure score** — verify runs schema before use: read one existing `slice-*.json` from `.forge/runs/` on first invocation and confirm it has a `status` key. If no `status` key is found, set `failureScoreAvailable: false` in the response and log `"runs schema mismatch — failure score unavailable"`. If schema is confirmed, scan `.forge/runs/*/slice-*.json` for `status: "failed"` entries; map each slice's `scope` patterns to files; normalise
   - **Incident score**: scan `.forge/incidents/*.json`; tally `affectedFiles`; normalise
   - **Combined score**: `(churn * 0.40) + (failure * 0.35) + (incident * 0.25)`; sort descending; return top `topN`
   - Write result to `.forge/hotspot-cache.json`
3. Add REST endpoint: `GET /api/hotspots` (no auth) — returns `.forge/hotspot-cache.json`, triggers fresh analysis if cache >24h old
   - **Rate-limit auto-rerun**: if a fresh analysis has been triggered >3 times within 60 seconds (tracked via a module-level counter + timestamp), return the stale cache with an added `staleness: true` flag rather than spawning again. Reset counter after 60s. This prevents process exhaustion from rapid-fire unauthenticated GETs.
   - **Server binding prerequisite** (noted in Scope Contract): verify `server.mjs` binds to `127.0.0.1` only (`app.listen(3100, '127.0.0.1', ...)`), not `0.0.0.0`. Auto-rerun endpoints are only safe on a loopback-bound server.
4. Add `pforge hotspot [--top N] [--since "date"]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_hotspot` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

---

### Slice 8 — `forge_health_trend` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Aggregate data written by all other LiveGuard features plus existing run history into a single health trend view. Report trajectory: improving, stable, or degrading.

**Tasks**:
1. Add `forge_health_trend` to TOOLS array:
   ```
   name: "forge_health_trend"
   inputs: days (number, default 30), metrics (string[], optional — subset filter)
   returns: { period: { from, to }, metrics: { avgSliceCost: [], avgRetries: [], driftScore: [], incidentCount: [], mttr: [], mttbf: [] }, trend: "improving"|"stable"|"degrading", dataPoints: number }
   ```
2. Handler logic:
   - Read `.forge/health-trend.json` (append-only JSONL written by all LiveGuard slices and existing run completion hooks)
   - Backfill historical cost data from `.forge/cost-history.json` (a **read-only dependency** — this file is owned and written by `forge_cost_report`, not by LiveGuard; see Data Stores table). If `cost-history.json` does not exist, the `avgSliceCost` metric array returns empty — not an error. Ingest deploy events from `.forge/deploy-journal.jsonl` for MTTBF calculation
   - Filter to last `days` days
   - Calculate MTTR (mean of all `mttr` values in the window) and MTTBF (mean interval between incident groups in the window)
   - Calculate linear regression slope for each metric series; overall `trend` is the majority direction
   - Return typed per-metric arrays sorted by date, ready for charting
3. Extend `forge_cost_report` response: add backward-compatible `healthTrend: { trend, dataPoints }` summary field (does not break existing callers)
   - **Location**: find the `forge_cost_report` handler in `server.mjs` by searching for `'forge_cost_report'` in the TOOLS case block. Add `healthTrend: await getHealthTrendSummary()` to its response object.
   - Extract `getHealthTrendSummary()` as a private (non-exported) helper from the `forge_health_trend` handler — do not duplicate the logic inline in `forge_cost_report`
   - Add backward-compatibility assertion to Slice 10 tests: `GET /api/cost` still returns `total: number` after this change
4. Add REST endpoints:
   - `GET /api/health-trend` (no auth) — runs `forge_health_trend` with default 30-day window
   - `GET /api/health-trend?days=N` (no auth) — custom window
5. Add `pforge health-trend [--days N] [--metrics m1,m2]` to `pforge.ps1` and `pforge.sh`
6. Add `forge_health_trend` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

---

### Slice 8.5 — `forge_alert_triage` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Aggregate all LiveGuard signals into one ranked triage list — the guardian's morning briefing. Pure read-only aggregation over the other data stores. No new side effects from this tool.

**Tasks**:
1. Add `forge_alert_triage` to TOOLS array:
   ```
   name: "forge_alert_triage"
   inputs: maxItems (number, default 20), minSeverity ("low"|"medium"|"high"|"critical", default "low")
   returns: { generatedAt, items: [{ priority: number, tool: string, title: string, severity: string, details: string, recommendedAction: string }], summary: { critical: number, high: number, medium: number, low: number } }
   ```
2. Handler logic (read-only — no writes to any LiveGuard data store):
   - Read all LiveGuard data stores via `readForgeJson`
   - **Drift**: latest score < 70 → `high`; < 50 → `critical`; include top 3 violations in `details`
   - **Incidents**: any incident with absent `resolvedAt`, timestamp within last 7 days → `high` or `critical` per its `severity` field
   - **Deps**: any `newVulnerabilities` from last dep snapshot → `critical` if CVSS ≥ 7.0 else `medium`
   - **Regression**: any `status: "failed"` from last regression run → `high`
   - **Hotspots**: top 3 files with `totalScore > 70` → `medium`
   - **Health trend**: overall trend is `degrading` → `medium`
   - **Deploy journal**: last deploy has no `postHealthScore` yet → `low` reminder
   - Priority formula: **additive with severity floor** to guarantee critical always outranks lower severities regardless of age: `priority = (severity_weight × 3) + recency_weight` where critical=4, high=3, medium=2, low=1 and last 24h=1.0, last 7d=0.8, older=0.5. Example: critical+older = 4×3+0.5=12.5; medium+fresh = 2×3+1.0=7.0. Critical will always rank above medium. Sort descending by `priority`; secondary sort by `timestamp` (more recent = higher) as tiebreak; slice to `maxItems`
   - Overwrite `.forge/alert-triage-cache.json` with result (not append-only — always latest snapshot)
3. Add REST endpoints:
   - `GET /api/alerts/triage` (no auth) — returns cache if <1h old, else runs fresh analysis
     - **Rate-limit auto-rerun**: same 3-calls-per-60s cap as `GET /api/hotspots` — return stale cache with `staleness: true` on excess requests
   - `GET /api/alerts/triage?refresh=true` (no auth) — always runs fresh analysis (also rate-limited)
4. Add `pforge triage [--min-severity S] [--max N]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_alert_triage` entry to `capabilities.mjs` TOOL_METADATA

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

**Stop Condition**: If priority formula produces ties that make ranking non-deterministic → add `timestamp` as secondary sort key (more recent = higher in list); document the tiebreak rule in TOOL_METADATA.

---

### Slice 8.6 — `forge_deploy_journal` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Flight recorder for every deploy event. Links deploy version, trigger, and pre/post health scores. Enables `forge_incident_capture` to cross-reference which deploy preceded an incident and `forge_alert_triage` to surface deploys with no post-health check.

**Tasks**:
1. Add `forge_deploy_journal` to TOOLS array:
   ```
   name: "forge_deploy_journal"
   inputs: version (string, required), triggeredBy (string, optional — default "user"), notes (string, optional), sliceRef (string, optional — plan slice that shipped this version)
   returns: { journalId, timestamp, version, triggeredBy, preHealthScore: number | null, postHealthScore: null, entryCount }
   ```
2. Handler logic:
   - Call `forge_health_trend` handler internally (not via REST) to capture current health score as `preHealthScore`; if no trend data yet, set `null`
   - Generate `journalId` as `deploy-<YYYYMMDD>-<HHmmss>-<4hexchars>` (timestamp-based, human-readable, with a 4-character hex fragment from `crypto.randomBytes(2).toString('hex')` to prevent same-second collisions in parallel CI matrix builds — `crypto` is a Node.js built-in, no new dep)
   - Append entry to `.forge/deploy-journal.jsonl` via `appendForgeJsonl`
   - `postHealthScore` is initially `null`; mutable update path uses sidecar `.forge/deploy-journal-meta.json` (JSON object keyed by `journalId`) to avoid rewriting the append log
   - **Race condition guard**: Both `forge_secret_scan` (v2.28 Slice 2) and `PATCH /api/deploy/journal/:id` write to the same sidecar file. Use `writeForgeJsonSafe(path, updaterFn)` helper (add to `orchestrator.mjs`) for all sidecar mutations: use `fs.openSync(lockPath, 'wx')` (O_EXCL — atomic on both POSIX and Windows) to create `.forge/deploy-journal-meta.json.lock`, read-modify-write, then `fs.unlinkSync(lock)`. Retry up to 3 times at 100ms intervals before returning `{ error: "sidecar locked" }`. Use `try/finally` to ensure lock is always cleaned up. Never throw from the lock failure; log a warning only.
   - Return entry with current `entryCount`
3. Add REST endpoints:
   - `POST /api/deploy/journal` (requires auth) — record a deploy event; same inputs as tool
   - `GET /api/deploy/journal` (no auth) — return full journal as array (merge JSONL + sidecar meta)
   - `PATCH /api/deploy/journal/:id` (requires auth) — update `postHealthScore` on an existing entry via sidecar
4. Add `pforge deploy-log "<version>" [--by "CI"] [--notes "..."] [--slice S]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_deploy_journal` entry to `capabilities.mjs` TOOL_METADATA
6. Update `forge_incident_capture` handler: scan `.forge/deploy-journal.jsonl` for the most-recent deploy before the incident timestamp; include `precedingDeploy: { journalId, version }` in the incident record

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
```

**Stop Condition**: If merging JSONL + sidecar at read time is too slow for large journals → build a compact index file `.forge/deploy-journal-index.json` on first `GET` call, invalidated on each append.

---

### Slice 9 — Capabilities Surface + All Doc Updates [depends: Slices 2–8.6]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Update the machine-readable API surface and all public documentation to reflect 28 MCP tools, 14 new REST endpoints, and the LiveGuard feature set.

> **Dashboard Note**: The LiveGuard GUI lives in the **existing unified dashboard** at `localhost:3100/dashboard` — NOT a separate app or page. v2.28 Slice 4 adds a LIVEGUARD section (5 tabs) to the same nav bar, separated by a visual divider from the FORGE section. This is intentional: single WebSocket, single Chart.js instance, full integration between halves. Do NOT create a separate `liveguard.html` file.

**Tasks**:
1. `pforge-mcp/capabilities.mjs` — add all 9 tools to `TOOL_METADATA`; add all 14 new REST endpoints to `restApi.endpoints`
2. `docs/capabilities.md`:
   - Header: `19 MCP` → `28 MCP`
   - Add all 9 LiveGuard tool rows to MCP table
   - Add new REST endpoint rows (14 total) to REST API table
   - Add “LiveGuard — Post-Deploy Intelligence” section
3. `docs/capabilities.html`:
   - Update `19 MCP` → `28 MCP` in title, meta, og:desc, twitter title, img alt, badge
   - Add 9 new tool cards to MCP grid
   - Add LiveGuard section after REST API section
4. `docs/faq.html` — add 1 new FAQ entry under Enterprise & Teams: "Does Plan Forge help monitor the app after coding?" — describe all 9 tools
5. `ROADMAP.md` — add v2.27.0 LiveGuard entry under Planned
6. **Manual: Act IV stub pages** — Create 4 stub HTML files. These are structural placeholders filled out fully in v2.28 Slice 5. Use the exact same page shell as existing manual chapters (Tailwind CDN, `shared.css`, `manual.css`, `manual.js`). Each stub has the chapter header, a short intro paragraph, an `under-construction` callout, and a `<!-- CONTENT-PLACEHOLDER -->` comment marking where full content goes:
   - `docs/manual/what-is-liveguard.html` — Chapter 15 stub: "What Is LiveGuard?" — mental model, lifecycle position (before: forge builds; LiveGuard watches), the guardian metaphor
   - `docs/manual/liveguard-tools.html` — Chapter 16 stub: "LiveGuard Tools Reference" — intro paragraph; full tool table filled in v2.28
   - `docs/manual/liveguard-dashboard.html` — Chapter 17 stub: "The LiveGuard Dashboard" — intro paragraph; tab walkthrough filled in v2.28
   - `docs/manual/liveguard-runbooks.html` — Appendix F stub: "LiveGuard Alert Runbooks" — intro paragraph; severity response matrix filled in v2.28
7. **Manual navigation wiring** — Update `docs/manual/assets/manual.js` CHAPTERS array: add 4 new entries after the existing Act III entries (before Appendix):
   ```js
   { id: "what-is-liveguard",      file: "what-is-liveguard.html",      num: "15", title: "What Is LiveGuard?",           act: "IV" },
   { id: "liveguard-tools",        file: "liveguard-tools.html",        num: "16", title: "LiveGuard Tools Reference",     act: "IV" },
   { id: "liveguard-dashboard",    file: "liveguard-dashboard.html",    num: "17", title: "The LiveGuard Dashboard",       act: "IV" },
   { id: "liveguard-runbooks",     file: "liveguard-runbooks.html",     num: "F",  title: "LiveGuard Alert Runbooks",      act: "Appendix" },
   ```
8. **Manual index update** — Update `docs/manual/index.html`:
   - Add "Act IV — Guard with LiveGuard" section (3 chapter cards: Ch 15, 16, 17) in the chapter grid between Act III and Appendices
   - Add Appendix F card to the Appendices grid
   - Update version string from `v2.21.0 · 14 chapters · 5 appendices` → `v2.27.0 · 17 chapters · 6 appendices`
   - Update chapter-6 card subtitle: `9 tabs` → `14 tabs (FORGE + LIVEGUARD sections)`
9. **`.gitignore` update** — Append the following entries to `.gitignore` to prevent sensitive LiveGuard data from being committed accidentally:
   ```
   # LiveGuard operational data (contains incident details, secret scan results, deploy history)
   .forge/incidents/
   .forge/secret-scan-cache.json
   .forge/deploy-journal.jsonl
   .forge/deploy-journal-meta.json
   .forge/liveguard-events.jsonl
   ```
   Note: `.forge/drift-history.json`, `.forge/regression-gates.json`, `.forge/runbooks/`, and `.forge/health-trend.json` may be committed deliberately for team-shared history — leave those to the user's discretion.
10. **`.forge.json` schema documentation** — Add a ".forge.json Schema" section to `docs/manual/liveguard-tools.html` (Chapter 16, to be fleshed out in v2.28 Slice 5). The section documents all root-level fields including the new `onCall` field:
    ```json
    {
      "bridge": { "url": "string", "approvalSecret": "string" },
      "model": "string",
      "onCall": { "name": "string", "channel": "string", "escalation": "string (optional)" }
    }
    ```
    Also add a `forge_smith` validation check: if `.forge.json` exists and has an `onCall` field, verify it has at minimum `name` and `channel` — emit a warning (not an error) if either is missing.

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
grep -c "forge_" docs/capabilities.md
node -e "import('./pforge-mcp/capabilities.mjs').then(m => m.buildCapabilitySurface()).then(s => console.log('tools:', s.tools?.length))"
grep -c "CONTENT-PLACEHOLDER" docs/manual/what-is-liveguard.html  # must be 1
grep -c "CONTENT-PLACEHOLDER" docs/manual/liveguard-tools.html    # must be 1
node --input-type=module < /dev/null; node -e "require('fs').readFileSync('docs/manual/assets/manual.js','utf8')" 2>&1 | grep -i syntaxerror || echo 'ok'
grep -c "incidents" .gitignore  # must be >= 1
```

**Stop Condition**: If `buildCapabilitySurface()` tool count doesn't match 28 → STOP, debug TOOL_METADATA entries before proceeding to Slice 10.

---

### Slice 10 — Tests + VERSION + CHANGELOG + Push [depends: Slice 9]
**Build command**: `npx vitest run`  
**Test command**: `npx vitest run`

**Goal**: Full test coverage for all new tools. Version bump. Clean commit and push.

**Tasks**:
1. `pforge-mcp/tests/server.test.mjs` — add test cases for each of the 9 new tool handlers:
   - Input validation (required fields, type checks)
   - Expected response shape (all top-level keys present)
   - REST GET endpoints return 200 with correct Content-Type
   - REST POST write endpoints return 401 when auth required and no token provided
   - **`forge_incident_capture` — additional tests for Slice 8.6 modification**:
     - When `.forge/deploy-journal.jsonl` contains a prior deploy entry before the incident timestamp, the incident record includes `precedingDeploy: { journalId, version }` with correct values
     - When no prior deploy entry exists, `precedingDeploy` is `null` — not an error, not an omitted field
2. `pforge-mcp/tests/orchestrator.test.mjs` — add test cases for all 4 new helpers:
   - `ensureForgeDir` creates dir; is no-op if exists
   - `readForgeJson` returns default when file missing; parses correctly when present
   - `appendForgeJsonl` creates file on first call; appends on subsequent calls
   - `parseValidationGates` returns correct structure from a known plan file
3. `pforge-mcp/tests/orchestrator.test.mjs` — add test for `isGateCommandAllowed` allowlist (from Slice 5)
4. Bump `VERSION` to `2.27.0`
5. Prepend `CHANGELOG.md` entry for v2.27.0 with full feature list
6. Stage: `git add -A`
7. Commit: `feat(liveguard): post-coding operational intelligence — 9 new tools, 14 REST endpoints (v2.27.0)`
8. Push: `git push origin master`

**Validation Gate**:
```bash
npx vitest run
cat VERSION
git log --oneline -1
```

---

## Rollback Plan

1. **MCP tools**: If a new tool handler throws and crashes the server, comment out the TOOLS entry and handler block — server restarts cleanly, other tools unaffected
2. **REST endpoints**: Each endpoint is independently registered by `app.get/post()` calls — remove individual registrations without touching others
3. **Data files**: All new `.forge/` artifacts are non-destructive; deleting them resets to a clean state without breaking existing functionality
4. **Git revert**: Each slice is a single commit; `git revert HEAD~N` reverts cleanly if a slice introduced a regression

---

## Anti-Pattern Checks

```bash
grep -rn "any\b" pforge-mcp/*.mjs --include="*.mjs"          # no TypeScript 'any' equivalent in JS modules
grep -rn "exec(" pforge-mcp/orchestrator.mjs                 # no exec() — use execFile() or spawn() instead
grep -rn "rm -rf\|rimraf" pforge-mcp/                        # no destructive filesystem ops
grep -rn "process.exit" pforge-mcp/server.mjs                # no abrupt exits from new handlers
node -e "
const fs = require('fs');
const src = fs.readFileSync('pforge-mcp/server.mjs', 'utf8');
const handlers = src.match(/case 'forge_(drift|incident|dep_watch|regression|runbook|hotspot|health_trend|alert_triage|deploy_journal)':/g) || [];
const withTelemetry = src.match(/emitToolTelemetry/g) || [];
console.log('handlers:', handlers.length, '/ telemetry calls:', withTelemetry.length);
if (withTelemetry.length < handlers.length) throw new Error('Missing emitToolTelemetry calls');
"
```

---

## Bridge Notification Payload Reference

All LiveGuard `activeBridge?.dispatch()` calls use the following payload shapes. Document these in Slice 9's TOOL_METADATA `sideEffects` entries so Bridge SDK consumers can deserialize correctly:

| Tool | `eventName` | Payload Shape |
|------|------------|---------------|
| `forge_drift_report` | `"drift-alert"` | `{ tool, score, threshold, delta, violations: [{ file, rule, severity }] }` |
| `forge_incident_capture` | `"incident-captured"` | `{ tool, incidentId, severity, sliceRef, onCallTarget?: string }` |
| `forge_dep_watch` | `"dep-vulnerability"` | `{ tool, newVulnerabilities: [{ name, version, severity, id }], count }` |
| `forge_regression_guard` | `"regression-failure"` | `{ tool, failed, passed, skipped, blocked, results: [{ sliceId, status }] }` |
| `forge_env_diff` | `"env-key-gap"` | `{ tool, totalMissing, totalExtra, pairs: [{ baseline, compareTo, missing, extra }] }` |

Tools that do NOT dispatch bridge notifications: `forge_runbook`, `forge_hotspot`, `forge_health_trend`, `forge_alert_triage`, `forge_deploy_journal` (read-only or journal tools — no notification).

| Need | Where to Find It |
|------|-----------------|
| Tool definition structure | `server.mjs` lines 518–533 (`forge_memory_capture`) |
| Write endpoint auth | `checkApprovalSecret()` — already imported in `server.mjs` |
| Bridge notification dispatch | `activeBridge?.dispatch(eventName, payload)` — pattern used in existing run handlers |
| OpenBrain capture payload | `buildMemoryCaptureBlock()` in `memory.mjs` — import and call |
| Skill runner invocation | `forge_run_skill` handler (~line 492) — extract the child_process call pattern |
| Hub event broadcast | `activeHub?.broadcast(eventName, payload)` — used by existing run events |
| Run history scanning | `.forge/runs/index.jsonl` + `readForgeJson` — established pattern |
| Unified tool telemetry | `emitToolTelemetry(toolName, inputs, result, durationMs, status)` from `orchestrator.mjs` (Slice 1) — ALL handlers must call this; writes `.forge/liveguard-events.jsonl` + broadcasts hub event |
| OTLP Severity levels | `import { Severity } from './telemetry.mjs'` — use `Severity.INFO` / `Severity.WARN` / `Severity.ERROR` constants; never hardcode severity strings |

---

## Verification

| Check | Command | Expected |
|-------|---------|----------|
| Tool count | `curl http://localhost:3100/api/capabilities \| node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.tools.length)"` | `28` |
| All tests pass | `npx vitest run` | 0 failures |
| Server starts clean | `node pforge-mcp/server.mjs --validate` | no errors |
| drift endpoint | `curl http://localhost:3100/api/drift` | `{ score, violations, trend }` |
| incidents endpoint | `curl http://localhost:3100/api/incidents` | `[]` (empty array) |
| hotspots endpoint | `curl http://localhost:3100/api/hotspots` | `{ hotspots: [], generatedAt }` |
| health trend | `curl "http://localhost:3100/api/health-trend?days=7"` | `{ period, metrics, trend }` |
| cost report BC | `curl http://localhost:3100/api/cost` | includes `healthTrend` field, `total` still present |
| capabilities.md count | `head -4 docs/capabilities.md` | `28 MCP` |
| regression allowlist | manual test with blocked command | returns `blockedReason: "safety-allowlist"` |
| alert triage | `curl http://localhost:3100/api/alerts/triage` | `{ items: [], summary: { critical:0, high:0, medium:0, low:0 }, generatedAt }` |
| deploy journal | `curl http://localhost:3100/api/deploy/journal` | `[]` (empty array on first run) |
| MTTR in health trend | `curl "http://localhost:3100/api/health-trend?days=30"` | includes `metrics.mttr` and `metrics.mttbf` arrays |
| Telemetry log exists | `test -f .forge/liveguard-events.jsonl && head -1 .forge/liveguard-events.jsonl` | valid JSON with `traceId`, `tool`, `status`, `durationMs` |
| Hub telemetry event | WebSocket client receives `liveguard-tool-completed` on any tool call | event payload: `{ tool, status, durationMs, traceId }` |

---

## Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| No new npm dependencies | Zero-install guarantee must be preserved. All features are implementable with `child_process`, `fs`, `path`, and the existing plan parser. |
| No dashboard tab this release | Data is fully accessible via REST; a Live Health dashboard tab is a natural v2.28.0 follow-on that benefits from seeing all 7 data stores populated first. |
| No scheduling daemon | Plan Forge is a dev-time tool, not an always-on service. OpenClaw, CI cron, or the user supplies the schedule. PF exposes the trigger surface. |
| `forge_incident_capture` returns payload, doesn't write OpenBrain | Same separation-of-concerns as `forge_memory_capture` (v2.24.0). Plan Forge normalises; the caller (OpenClaw) owns the OpenBrain write. Keeps the boundary clean. |
| `.forge/health-trend.json` is append-only JSONL | Historical fidelity is more valuable than a compact single object. Append-only means no read-modify-write race conditions and trivial rollback (truncate). |
| `forge_regression_guard` uses command safety allowlist | Gate commands are user-authored strings. Executing arbitrary strings from files introduces arbitrary code execution risk. Allowlist + logged rejections is the right tradeoff. |
| `forge_hotspot` degrades gracefully without git | Not all environments have git available (container builds, some CI). Return `gitAvailable: false` with empty hotspots rather than throwing. |
| `forge_alert_triage` is read-only | Pure aggregation over existing data stores. No side effects beyond writing the triage cache. Idempotent — safe to call as frequently as needed. |
| `forge_deploy_journal` uses a sidecar for mutable fields | The JSONL append log is immutable by design. `postHealthScore` (recorded after deploy stabilises) lives in `.forge/deploy-journal-meta.json` keyed by `journalId`. The GET endpoint merges both. No rewriting the append log. |
| `resolvedAt` is optional and caller-supplied | Incidents are captured at detection time. Resolution is a second call. This decouples capture from resolution, matching real incident timelines where MTTR spans hours or days. |
| On-call routing via existing `.forge.json` | No new config file. `onCall: { name, channel }` sits alongside `bridge` and `model` in the config the user already manages. PF carries the target in the bridge payload; the notification channel is the bridge consumer's responsibility. |

---

## Open Questions (Resolve Before Execution)

| # | Question | Recommendation |
|---|----------|---------------|
| OQ1 | What penalty weight converts `violations.length` to a drift score in Slice 2? | Start with `score = Math.max(0, 100 - violations.length * 5)`. Adjust based on first real run. |
| OQ2 ✅ | Should `forge_dep_watch` parse `package.json` directly or always delegate to the `/dependency-audit` skill? | **Use `npm audit --json` directly** — skill output is AI-driven Markdown prose with no guaranteed JSON schema; parsing it is fragile. `npm audit --json` returns a well-defined schema. Non-npm projects return graceful degradation (see Slice 4 stop condition). |
| OQ3 | Should `forge_runbook` generate the monitoring section from `.forge.json` bridge config? | Yes — if bridge channels are configured, include them in "Where to watch for alerts" section of the runbook. || OQ4 | What is the priority ranking formula for `forge_alert_triage`? | Severity weight (critical=4, high=3, medium=2, low=1) × recency weight (last 24h=1.0, last 7d=0.8, older=0.5). Secondary sort: timestamp descending. Tiebreak documented in TOOL_METADATA. |
| OQ5 | Should `forge_deploy_journal` auto-capture pre-deploy health, or require the caller to supply it? | Auto-capture: call `forge_health_trend` handler internally at record time. Ensures a consistent baseline without requiring the caller to orchestrate two separate calls. If no trend data exists yet, record `null`. |
---

## 6 Mandatory Blocks — Verification

| # | Block | Present |
|---|-------|---------|
| 1 | Numbered execution slices with build/test commands | ✅ |
| 2 | Explicit validation gates per slice | ✅ |
| 3 | Stop conditions | ✅ |
| 4 | Rollback plan (3 tiers: tool, endpoint, git revert) | ✅ |
| 5 | Anti-pattern checks | ✅ |
| 6 | Scope contract with explicit Out of Scope | ✅ |
