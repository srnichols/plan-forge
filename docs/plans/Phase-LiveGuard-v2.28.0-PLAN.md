# Phase: LiveGuard II — Security Scanning, Dashboard & Telemetry

> **Roadmap Reference**: [ROADMAP.md](../../ROADMAP.md) → v2.28.0  
> **Status**: 📋 Planned  
> **Target Version**: `2.28.0`  
> **Branch Strategy**: `feature/v2.28-liveguard-2`  
> **Predecessor**: [Phase-LiveGuard-v2.27.0-PLAN.md](./Phase-LiveGuard-v2.27.0-PLAN.md) — must be complete before execution  
> **Estimated Effort**: 3–4 days (6 execution slices)  
> **Risk Level**: Low-Medium (security scanning, dashboard UI augmentation, telemetry retrofit)

---

## Overview

v2.28.0 completes the LiveGuard guardian with three remaining pillars:

1. **`forge_secret_scan`** — Post-commit entropy analysis that catches secrets slipping into source after ship day. No external dependencies — pure Shannon entropy + regex on `git diff` output.
2. **`forge_env_diff`** — Key-presence diff between `.env.*` files. Catches the "works in staging, 500s in prod" failure mode before the call comes in at 2am. Never reads values — keys only.
3. **LiveGuard Dashboard Tab** — The 9th tab in the existing `localhost:3100/dashboard`. A live operational health panel driven by the 11 `.forge/` data stores written in v2.27.0. Real-time updates via `liveguard-tool-completed` hub events.
4. **Telemetry Retrofit** — The `emitToolTelemetry()` helper added in v2.27 Slice 1 powers the Traces tab for all 9 LiveGuard tools. This slice ensures the Traces tab, `liveguard-events.jsonl`, and hub events all wire up correctly and are visible in the existing dashboard.

The combination closes the loop: forge the plan → guard the deploy → scan the secrets → diff the config → watch the health in real-time.

---

## Brand Narrative Addition

> "Plan Forge forged the armor. LiveGuard wears it. Now it has eyes."

The v2.28.0 dashboard tab is the guardian's visor — a real-time window into everything LiveGuard is watching. The forge still burns behind it; the guardian still stands watch. Now you can see exactly what it sees.

---

## Prerequisites

- [x] v2.27.0 shipped — all 9 LiveGuard tools live, `emitToolTelemetry()` implemented, `.forge/liveguard-events.jsonl` being written
- [x] `activeHub?.broadcast('liveguard-tool-completed', ...)` firing from all 9 handlers
- [x] Dashboard infrastructure exists — 8 tabs, WebSocket conn, REST polling pattern in `pforge-mcp/dashboard/app.js`
- [x] `Severity`, `addEvent`, `startSpan`, `endSpan` available in `telemetry.mjs` (established in v2.4)
- [x] `appendForgeJsonl`, `readForgeJson`, `ensureForgeDir` available in `orchestrator.mjs` (v2.27 Slice 1)
- [x] `.forge.json` `onCall` config field exists (v2.27 Slice 3)

---

## Acceptance Criteria

- [ ] `forge_secret_scan` detects entropy anomalies in `git diff HEAD~1` without any new npm deps
- [ ] `forge_secret_scan` NEVER includes actual secret values in output — masked to `<REDACTED>` always
- [ ] `forge_env_diff` detects missing, extra, and mismatched keys between env files — never logs values
- [ ] LiveGuard section (5 tabs: `lg-health`, `lg-incidents`, `lg-triage`, `lg-security`, `lg-env`) appears in the unified dashboard at `localhost:3100/dashboard`, separated from the FORGE section by a visual divider; all 5 tabs are active and load their respective widgets
- [ ] All 9 LiveGuard tool invocations appear in the Traces tab (via `liveguard-events.jsonl` reader)
- [ ] Dashboard LiveGuard tab updates in <2s on any `liveguard-tool-completed` hub event (no full page refresh)
- [ ] `curl http://localhost:3100/api/capabilities` returns 30 tools in `tools` array
- [ ] `docs/capabilities.md` header reads `30 MCP`
- [ ] `npx vitest run` passes with all new test coverage
- [ ] Write endpoints require auth when `bridge.approvalSecret` is configured

---

## Scope Contract

### In Scope

| Area | Changes |
|------|---------|
| `pforge-mcp/server.mjs` | +2 TOOLS entries (`forge_secret_scan`, `forge_env_diff`), +2 handlers, +4 REST endpoints, **+1 modification to `forge_runbook` handler** (env-diff-cache check + "Environment Key Gaps" section) |
| `pforge-mcp/capabilities.mjs` | +2 TOOL_METADATA entries, +4 `restApi.endpoints`, dashboard tab docs update |
| `pforge-mcp/telemetry.mjs` | Read-only import — no changes to telemetry.mjs itself |
| `pforge-mcp/orchestrator.mjs` | Telemetry retrofit validation only (all 9 handlers verified to call `emitToolTelemetry`) |
| `pforge-mcp/dashboard/app.js` | +1 LiveGuard tab, +8 widget components, WebSocket `liveguard-tool-completed` listener |
| `pforge.ps1` + `pforge.sh` | +2 CLI commands (`secret-scan`, `env-diff`) |
| `docs/capabilities.md` | Count update (28→30), 2 new tool rows, LiveGuard tab description |
| `docs/capabilities.html` | Count update, 2 new tool cards, dashboard tab description |
| `ROADMAP.md` | v2.28.0 entry |
| `pforge-mcp/tests/` | New test cases for both new handlers + Traces tab telemetry integration |

### Out of Scope (Explicitly Forbidden)

- **No new npm dependencies** — Shannon entropy implemented in-file (~15 lines Node.js); Chart.js already loaded via CDN in dashboard
- **No SAST/full static analysis** — `forge_secret_scan` is entropy + regex on git diffs only; full SAST is an extension opportunity
- **No secret value logging** — values are never read, only keys and entropy scores of values
- **No `.env` value comparison** — `forge_env_diff` is key-presence only
- **No dashboard tab redesign** — new tab follows the exact same HTML/JS structure as existing tabs in `app.js`
- **No telemetry.mjs modifications** — consume existing exports; do not add new functions
- **No changes to existing telemetry for plan runs** — orchestrator-level traces are untouched; only LiveGuard tool telemetry is in scope

---

## New Data Stores (`.forge/`)

| File | Schema | Written By |
|------|--------|-----------|
| `.forge/secret-scan-cache.json` | `{ scannedAt, since, scannedFiles: number, clean: boolean, findings: [{ file, line, type, entropyScore, masked: "<REDACTED>", confidence: "high"\|"medium"\|"low" }] }` | `forge_secret_scan` |
| `.forge/env-diff-cache.json` | `{ comparedAt, pairs: [{ baseline, compareTo, missing: string[], extra: string[], total: number, match: boolean }], summary: { clean: boolean, totalMissing: number, totalExtra: number } }` | `forge_env_diff` |

---

## Telemetry Architecture (Unified View)

The v2.28.0 telemetry integration creates three observable signals for LiveGuard, all flowing from the `emitToolTelemetry()` established in v2.27 Slice 1:

```
LiveGuard tool call
       │
       ├─► .forge/liveguard-events.jsonl  ──► Traces tab reader (REST /api/liveguard/traces)
       │                                       displays per-tool spans with durationMs, status
       │
       ├─► Hub broadcast: liveguard-tool-completed
       │         │
       │         └─► Dashboard LiveGuard tab (WebSocket listener)
       │               updates widgets in real-time without polling
       │
       └─► OTLP Severity.INFO/ERROR event on span
             (writes to trace context if run-plan is active;
              standalone liveguard tool calls write lightweight
              event to liveguard-events.jsonl only)
```

**Severity mapping** (from `telemetry.mjs` Severity constants):

| LiveGuard Event | Severity |
|----------------|----------|
| Tool started | `Severity.DEBUG` |
| Tool completed OK | `Severity.INFO` |
| Drift score below threshold | `Severity.WARN` |
| New CVE detected | `Severity.WARN` |
| Regression gate failed | `Severity.ERROR` |
| Secret found | `Severity.ERROR` |
| Tool invocation error | `Severity.FATAL` |

---

## Execution Slices

### Slice 1 — Telemetry Retrofit Verification [hard prerequisite]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs"`

**Goal**: Verify — and if necessary repair — that all 9 v2.27 LiveGuard tool handlers correctly emit telemetry and hub events. This is the foundation for the dashboard tab. Slice 2, 3, and 4 must not start until this passes.

**Tasks**:
1. Run the telemetry anti-pattern check from v2.27 Slice 10:
   ```bash
node -e " const fs = require('fs'); const src = fs.readFileSync('pforge-mcp/server.mjs', 'utf8'); const handlers = src.match(/case 'forge_(drift|incident|dep_watch|regression|runbook|hotspot|health_trend|alert_triage|deploy_journal)':/g) || []; const withTelemetry = src.match(/emitToolTelemetry/g) || []; console.log('handlers:', handlers.length, '/ telemetry calls:', withTelemetry.length); if (withTelemetry.length < handlers.length) throw new Error('Missing emitToolTelemetry calls — fix before proceeding'); "
   ```
2. If any handlers are missing `emitToolTelemetry()`: add the call now (wrap in try/finally as specified in v2.27 cross-cutting requirement). Do not proceed to Slice 2 until the check passes.
3. Add REST endpoint: `GET /api/liveguard/traces` (no auth) — reads `.forge/liveguard-events.jsonl`, returns as array (same JSONL→array pattern as `readRunIndex`). Returns `[]` if file absent.
4. Add unit test in `pforge-mcp/tests/server.test.mjs`: `GET /api/liveguard/traces` returns 200 + array when liveguard-events.jsonl exists.
5. Verify hub emits `liveguard-tool-completed` by manually invoking `forge_alert_triage` (cheapest read-only tool) and confirming the event appears in the hub log.

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
node -e " const fs = require('fs'); const src = fs.readFileSync('pforge-mcp/server.mjs', 'utf8'); const lgTools = ['forge_drift_report','forge_incident_capture','forge_dep_watch','forge_regression_guard','forge_runbook','forge_hotspot','forge_health_trend','forge_alert_triage','forge_deploy_journal']; const covered = lgTools.filter(t => { const toolIdx = src.indexOf(t); if (toolIdx < 0) return false; // check for emitToolTelemetry within the next 1500 chars of the handler block const handlerBlock = src.substring(toolIdx, toolIdx + 1500); return handlerBlock.includes('emitToolTelemetry'); }); if (covered.length < 9) throw new Error('Only ' + covered.length + '/9 LiveGuard handlers have emitToolTelemetry. Missing: ' + lgTools.filter(t => !covered.includes(t)).join(', ')); console.log('ok — all 9 handlers covered:', covered.length); "
bash -c "cd pforge-mcp && npx vitest run tests/orchestrator.test.mjs"
```

**Stop Condition**: If `emitToolTelemetry` is absent from `orchestrator.mjs` (v2.27 Slice 1 not fully implemented) → implement it now before continuing. This slice is the prerequisite gate.

---

### Slice 2 — `forge_secret_scan` [P, depends: Slice 1]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Detect secrets accidentally committed post-ship using Shannon entropy + heuristic regex on `git diff` output. Zero new npm dependencies. Never logs actual secret values.

**Security design**:
- Values are never stored, logged, or returned — only the file path, line number, entropy score, and a masked placeholder `<REDACTED>`
- Shannon entropy threshold: default `4.0` (configurable `3.5`–`5.0`); values with entropy ≥ threshold AND matching a key-name heuristic (e.g., `key`, `secret`, `token`, `password`, `api_key`, `auth`) are flagged
- Allowlist: lines beginning with `#`, empty lines, and test fixture files (`*.test.*`, `*.spec.*`, `fixtures/`) are skipped
- Confidence scoring: `high` = entropy ≥ 4.5 + key-name match; `medium` = entropy ≥ 4.0 + key-name match OR entropy ≥ 4.8 alone; `low` = heuristic match only

**Shannon entropy implementation** (inline, no dep):
```javascript
function shannonEntropy(str) {
  const freq = {};
  for (const c of str) freq[c] = (freq[c] || 0) + 1;
  const len = str.length;
  return -Object.values(freq).reduce((sum, f) => {
    const p = f / len;
    return sum + p * Math.log2(p);
  }, 0);
}
```

**Tasks**:
1. Add `forge_secret_scan` to TOOLS array:
   ```
   name: "forge_secret_scan"
   inputs: since (string, default "HEAD~1" — git ref for diff base), path (string, default "."), threshold (number 3.5–5.0, default 4.0), includeUntracked (boolean, default false)
   returns: { clean: boolean, scannedFiles: number, findings: [{ file, line, type, entropyScore, masked: "<REDACTED>", confidence }], since, scannedAt }
   ```
2. Handler logic:
   - Run `git diff <since> --unified=0 --name-only` to get changed file list (same git-available check as `forge_hotspot`)
   - For each changed file: run `git diff <since> -- <file>` and extract `+` lines (added lines only — not context lines)
   - For each `+` line: check for key-name heuristic via regex; compute `shannonEntropy()` on the value portion using the following **defined extraction regex** (ensures YAML, JSON, and shell assignment formats are all covered):
     ```js
     // Extracts the value token from lines like: KEY=value, key: value, "key": "value"
     const valueMatch = line.match(/(?:[=:]\s*["']?)([\w+/=]{8,})/);
     const valueToken = valueMatch?.[1] ?? null;
     ```
     If `valueToken` is null or shorter than 8 characters, skip entropy check for this line (too short to be a meaningful secret). Compute `shannonEntropy(valueToken)` only when a token is extracted.
   - Build findings array with masked values; never write or return raw values
   - Write result to `.forge/secret-scan-cache.json`
   - If `findings.length > 0`: dispatch bridge notification + broadcast `Severity.ERROR` hub event via `emitToolTelemetry`
   - If `includeUntracked`: also scan `git ls-files --others --exclude-standard` for untracked files using same logic
3. Add REST endpoints:
   - `GET /api/secrets/scan` (no auth) — return `.forge/secret-scan-cache.json` (last scan result)
   - `POST /api/secrets/scan/run` (requires auth) — trigger a fresh scan
4. Add `pforge secret-scan [--since HEAD~1] [--threshold 4.0]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_secret_scan` entry to `capabilities.mjs` TOOL_METADATA including explicit `sideEffects: ["writes .forge/secret-scan-cache.json"]` and security note
6. **Integration with deploy journal**: if `.forge/deploy-journal.jsonl` exists and last entry matches current git HEAD, annotate that journal entry in sidecar with `{ secretScanClean: boolean, secretScanAt }` via `readForgeJson`/`writeFileSync` on the sidecar
   - **Race condition guard**: Use `writeForgeJsonSafe(path, updaterFn)` helper from `orchestrator.mjs` (added in v2.27 Slice 8.6) for all sidecar writes to `.forge/deploy-journal-meta.json`. Never use bare `readFileSync` + `writeFileSync` on the sidecar — both this tool and `PATCH /api/deploy/journal/:id` can write it concurrently in CI environments.

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
pforge secret-scan --since HEAD~1 | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
const leaked = (d.findings || []).filter(f => f.masked !== '<REDACTED>');
if (leaked.length) throw new Error('Secret value leaked: ' + JSON.stringify(leaked));
console.log('ok — no values in output');
"
```

**Stop Condition**: If `git diff` returns exit code 128 (not a git repo) → return `{ clean: null, scannedFiles: 0, findings: [], error: "git unavailable" }`. No throw. Document same graceful degradation pattern as `forge_hotspot`.

---

### Slice 3 — `forge_env_diff` [depends: Slice 2]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Diff key presence between environment files. Surface missing, extra, and unexpected keys before a deploy promotes the discrepancy to a production outage. Values are never read, stored, or compared.

**Security design**:
- Only key names (before `=`) are read; values are discarded immediately after splitting `key=value`
- `.env.local` and `.env.*.local` files are excluded from comparison (git-ignored by convention, machine-specific)
- `.forge/env-diff-cache.json` stores key names only — values never written

**Tasks**:
1. Add `forge_env_diff` to TOOLS array:
   ```
   name: "forge_env_diff"
   inputs: path (string, default "."), baseline (string, default ".env" — the canonical reference file), compareFiles (string[], optional — auto-discovers all .env.* files in path if absent), excludePatterns (string[], default [".env.local", ".env.*.local"])
   returns: { pairs: [{ file, baseline, missing: string[], extra: string[], total: number, match: boolean }], summary: { clean: boolean, totalMissing: number, totalExtra: number }, comparedAt }
   ```
2. Handler logic:
   - Auto-discover: `glob(".env*", { cwd: path })` — use `readdirSync` filtered by `/^\.env(\.[a-zA-Z0-9._-]+)?$/` (supports hyphenated names like `.env.my-app`, `.env.ci-cd`, multi-segment like `.env.test.local`; no glob dep); exclude `excludePatterns`
   - Parse each file: `readFileSync → split('\n') → filter(l => l && !l.startsWith('#') && l.includes('=')) → map(l => l.split('=')[0].trim())` — keys only, values discarded immediately
   - Diff: `missing = baselineKeys.filter(k => !fileKeys.includes(k))`; `extra = fileKeys.filter(k => !baselineKeys.includes(k))`
   - Write result to `.forge/env-diff-cache.json`
   - If `summary.totalMissing > 0`: dispatch bridge notification (missing keys in a deployment target env = high risk)
3. Add REST endpoint: `GET /api/env/diff` (no auth) — returns `.forge/env-diff-cache.json`
4. Add `pforge env-diff [--baseline .env] [--files .env.staging,.env.production]` to `pforge.ps1` and `pforge.sh`
5. Add `forge_env_diff` entry to `capabilities.mjs` TOOL_METADATA with explicit `sideEffects: ["writes .forge/env-diff-cache.json — key names only, no values"]`
6. **Integration with forge_runbook**: when generating runbook, check for `.forge/env-diff-cache.json`; if present and not clean, add "Environment Key Gaps" section to the runbook listing the missing keys
   - **Scope note**: this modifies the existing `forge_runbook` handler shipped in v2.27 Slice 6. This change is **in-scope for v2.28** — add `pforge-mcp/server.mjs` (existing `forge_runbook` handler) to the v2.28 Scope Contract file change table explicitly. Tests for this modification are in v2.28 Slice 6.

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
echo "A=1\nB=2\nC=3" > /tmp/test.env.baseline
echo "A=x\nD=y" > /tmp/test.env.staging
pforge env-diff --baseline /tmp/test.env.baseline --files /tmp/test.env.staging | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
const pair = d.pairs?.[0];
if (!pair?.missing?.includes('B') || !pair?.missing?.includes('C')) throw new Error('Missing keys not detected');
if (!pair?.extra?.includes('D')) throw new Error('Extra key not detected');
const hasValues = JSON.stringify(d).includes('=1') || JSON.stringify(d).includes('=x');
if (hasValues) throw new Error('Values leaked into output');
console.log('ok');
"
```

**Stop Condition**: If baseline file does not exist → return `{ pairs: [], summary: { clean: null, error: "baseline file not found: <path>" } }`. No throw.

---

### Slice 4 — Unified Dashboard: LiveGuard Section [depends: Slices 1, 2, 3]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Extend the single unified dashboard at `localhost:3100/dashboard` with a LiveGuard section. Rather than adding more flat tabs to an already 9-tab nav bar, introduce a **two-section nav bar**: FORGE (existing tabs) and LIVEGUARD (new operational tabs) separated by a visual divider. Single HTML file, single WebSocket, single REST base — zero infrastructure duplication.

> **Note (structural stubs may exist)**: A doc-sweep pass may have added placeholder LiveGuard tab buttons and empty `<section>` elements to `index.html`, plus skeleton `loadLG*()` functions and `tabLoadHooks` entries in `app.js`. If these stubs exist, **enhance them in place** — add the real Chart.js widget rendering, `tabBadgeState` tracking, `onLiveGuardEvent` dispatcher, and full data-loading logic described below. Do NOT delete and re-create them. If no stubs exist, build from scratch per the spec below.

---

#### Prerequisite Check (run BEFORE any file edits)

```bash
grep -c "tabLoadHooks\[" pforge-mcp/dashboard/app.js  # must be >= 1
```

**If this check returns 0**: the existing click handler is hardcoded to specific tab names. Perform the `tabLoadHooks` refactor as the **first committed task** of this slice before any LiveGuard additions:
1. Extract a `tabLoadHooks = {}` map in `app.js`, keyed by `data-tab` value
2. In the `tab-btn` click handler, replace the `if/else` chain with `tabLoadHooks[tabName]?.()`
3. Wire all 9 existing tabs into `tabLoadHooks` with their current render functions
4. Commit: `refactor(dashboard): extract tabLoadHooks for dynamic tab loading`
5. Validate all 9 existing tabs still work before proceeding

Only proceed with LiveGuard additions after the prerequisite check returns `>= 1`.

---

#### Dashboard Architecture Decision (Recorded)

```
BEFORE (flat, already crowded at 9 tabs):
  Progress | Runs | Cost | Actions | Replay | Extensions | Config | Traces | Skills

AFTER (two-section nav, single page):
  ── FORGE ──────────────────────────────────────────────  ── LIVEGUARD ──────────────────────────────────
  Progress | Runs | Cost | Actions | Replay | Config | Traces  ║  Health | Incidents | Triage | Security | Env
```

**Why unified, not separate app**:
- Infrastructure is identical (same WebSocket, same REST base, same Chart.js CDN, same Tailwind)
- Integration is real: Health Trend consumes cost data; Alert Triage reads run history; Traces tab spans both halves (filtered by source)
- `tabBadgeState` and `tabLoadHooks` patterns work identically across both sections — no framework changes needed
- The divider is a `<span>` in the nav HTML — no new routing, no new port, no new server process

**Section separator implementation**: A `<span class="section-divider">` between the last FORGE tab and first LIVEGUARD tab in `index.html`. Styled as a vertical divider line with a small `LIVEGUARD` label above it. The `tab-btn` / `tab-content` / `tabLoadHooks` wiring is identical for both sections.

---

#### LiveGuard Tab Inventory (5 focused tabs, not 8 redundant ones)

| Tab | `data-tab` | Widgets | Badge trigger |
|-----|-----------|---------|--------------|
| **Health** | `lg-health` | Drift Gauge + Health Trend multi-line chart (MTTR, drift, incidents) | `tabBadgeState.lgHealthAlert` on drift below threshold |
| **Incidents** | `lg-incidents` | Incident Feed (last 10) + Deploy Journal feed (last 5) | `tabBadgeState.lgIncidentsNew` incremented by hub event |
| **Triage** | `lg-triage` | Alert Triage ranked list (full) + Hotspot horizontal bar chart | `tabBadgeState.lgCritical` — red badge on any critical alert |
| **Security** | `lg-security` | Secret Scan status badge + scan findings list + Env Diff key gap table | `tabBadgeState.lgSecurityAlert` on any secret finding |
| **Env** | `lg-env` | Env Diff full comparison table — all baseline vs. compare-file pairs | updates on `liveguard-tool-completed` where `tool=forge_env_diff` |

> Consolidating 8 widgets into 5 tabs groups related concerns: Health==trend+drift, Incidents==events+deploys, Triage==priority+hotspots, Security==secrets+env quick status, Env==full env detail. This matches the mental model of "what guard function am I checking?"

---

**Widget inventory** (full list, mapped to their tabs):

| Widget | Tab | Data Source | Update trigger |
|--------|-----|-------------|----------------|
| Drift Gauge | Health | `GET /api/drift/history` — latest score as `<progress>` | `tool=forge_drift_report` hub event |
| Health Trend Chart | Health | `GET /api/health-trend?days=30` — multi-line (drift, incidents, MTTR, MTTBF) | `tool=forge_health_trend` hub event |
| Incident Feed | Incidents | `GET /api/incidents` — last 10, severity badges | `tool=forge_incident_capture` hub event |
| Deploy Journal Feed | Incidents | `GET /api/deploy/journal` — last 5, pre/post health delta | `tool=forge_deploy_journal` hub event |
| Alert Triage List | Triage | `GET /api/alerts/triage` — full ranked list with severity + action | any `liveguard-tool-completed` |
| Hotspot Chart | Triage | `GET /api/hotspots` — top 10, horizontal bar (churn+failure+incident) | `tool=forge_hotspot` hub event |
| Secret Scan Badge | Security | `GET /api/secrets/scan` — green/red clean indicator + findings | `tool=forge_secret_scan` hub event |
| Env Diff Summary | Security | `GET /api/env/diff` — missing/extra counts per file | `tool=forge_env_diff` hub event |
| Env Diff Full Table | Env | `GET /api/env/diff` — full pair matrix, all keys | `tool=forge_env_diff` hub event |

**Tasks**:
1. **`pforge-mcp/dashboard/index.html`** — nav bar update:
   - After the `Skills` tab button, add:
     ```html
     <span class="section-divider mx-2 flex items-center gap-1 text-xs text-gray-600 select-none border-l border-gray-700 pl-3">
       <span class="text-amber-500 font-semibold tracking-wider">LIVEGUARD</span>
     </span>
     ```
   - Add 5 new `.tab-btn` buttons: `data-tab="lg-health"`, `lg-incidents`, `lg-triage`, `lg-security`, `lg-env`
   - Add corresponding `<div id="tab-lg-health" class="tab-content hidden">` content panels in the body
   - Add CSS to `<style>`: `.tab-active.lg-tab { border-bottom-color: #f59e0b; color: #f59e0b; }` — amber active color to visually distinguish the LIVEGUARD section from FORGE (blue)
2. **`pforge-mcp/dashboard/app.js`** — tab wiring:
   - Extend `tabBadgeState`: add `lgHealthAlert: false`, `lgIncidentsNew: 0`, `lgCritical: false`, `lgSecurityAlert: false`
   - Extend `updateTabBadges()`: badge rules for the 4 new badge states
   - Add `tabLoadHooks` entries for all 5 new tabs: `'lg-health': loadLgHealth`, etc.
   - Add to WebSocket `onmessage` handler: `case 'liveguard-tool-completed': onLiveGuardEvent(event); break;`
   - Add `onLiveGuardEvent(event)` — dispatches to selective widget refresh by `event.tool`; increments relevant `tabBadgeState` counters; calls `updateTabBadges()`
3. **`pforge-mcp/dashboard/app.js`** — render functions (one per tab, follows Runs/Traces tab pattern exactly):
   - `loadLgHealth()` — fetches drift history + health trend; renders gauge + Chart.js multi-line
   - `loadLgIncidents()` — fetches incidents + deploy journal; renders two feed lists
   - `loadLgTriage()` — fetches alert triage + hotspots; renders ranked list + Chart.js horizontal bar
   - `loadLgSecurity()` — fetches secret scan + env diff summary; renders status badges + counts
   - `loadLgEnv()` — fetches env diff full; renders key comparison table per pair
4. **Chart.js instances**: `window._lgHealthChart`, `window._lgHotspotChart` — destroy+recreate on refresh (Cost tab pattern)
5. **Drift Gauge**: `<progress max="100" value="${score}">` with dynamic Tailwind color class — no Chart.js
6. **Empty states**: every widget shows `<p class="text-gray-500 text-sm">No data yet — run <code>pforge [tool]</code></p>` when data store is absent
7. **Responsive**: 2-column grid `grid-cols-1 lg:grid-cols-2 gap-4` on Health, Triage, Security tabs; single column on Incidents and Env (feed/table format)
8. **Docs help link** — in `pforge-mcp/dashboard/index.html`, add a `Docs ↗` link to the LIVEGUARD section header span:
   ```html
   <a href="https://planforge.software/manual/liveguard-dashboard.html"
      target="_blank" rel="noopener noreferrer"
      class="text-xs text-amber-500/70 hover:text-amber-400 transition-colors ml-1"
      title="LiveGuard Manual">Docs ↗</a>
   ```
   This sits inline after the `LIVEGUARD` label text, visible at all times. The link opens in a new tab so the user never loses their dashboard session. Also add per-tab `Docs ↗` links inside each LiveGuard tab content `<div>` header row, each pointing to the relevant manual anchor:
   - Health → `liveguard-dashboard.html#health-tab`
   - Incidents → `liveguard-dashboard.html#incidents-tab`
   - Triage → `liveguard-dashboard.html#triage-tab`
   - Security → `liveguard-dashboard.html#security-tab`
   - Env → `liveguard-dashboard.html#env-tab`
9. Update `pforge-mcp/capabilities.mjs` `dashboard.tabs` — add all 5 LiveGuard tabs with descriptions; update top-level dashboard description to mention FORGE / LIVEGUARD sections

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
grep -c "section-divider" pforge-mcp/dashboard/index.html  # must be 1

node -e " const html = require('fs').readFileSync('pforge-mcp/dashboard/index.html', 'utf8'); const lgTabs = ['lg-health','lg-incidents','lg-triage','lg-security','lg-env']; const missing = lgTabs.filter(t => !html.includes('data-tab=\"' + t + '\"')); if (missing.length) throw new Error('Missing tabs: ' + missing.join(', ')); console.log('ok — all 5 LiveGuard tabs present'); "
grep -c "liveguard-tool-completed" pforge-mcp/dashboard/app.js  # must be >= 2 (onmessage + onLiveGuardEvent)

grep -c "lg-tab\|amber" pforge-mcp/dashboard/index.html  # must be > 0

grep -c "lgHealthAlert\|lgIncidentsNew\|lgCritical\|lgSecurityAlert" pforge-mcp/dashboard/app.js  # must be >= 4

grep -c "liveguard-dashboard.html" pforge-mcp/dashboard/index.html  # must be >= 6 (1 section header + 5 per-tab)
```

**Stop Condition**: If `tabLoadHooks` refactor is needed but breaks more than 3 existing tabs during validation — stop, revert the refactor commit, document which tabs broke, and raise a blocker for the user before proceeding. Do not force-proceed with broken existing functionality.

---

### Slice 5 — Capabilities Surface + All Doc Updates [depends: Slices 2, 3, 4]
**Build command**: `node pforge-mcp/server.mjs --validate`  
**Test command**: `bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"`

**Goal**: Update all machine-readable and human-readable surfaces to reflect 30 MCP tools, 4 new REST endpoints, 5 LiveGuard dashboard tabs, and fully flesh out the Act IV manual chapters seeded as stubs in v2.27 Slice 9.

**Tasks**:
1. `pforge-mcp/capabilities.mjs`:
   - Add `forge_secret_scan`, `forge_env_diff` to `TOOL_METADATA`
   - Add 4 new REST endpoints to `restApi.endpoints`
   - `dashboard.tabs` — verify all 5 LiveGuard tab entries present (done in Slice 4 task 8, verify here)
2. `docs/capabilities.md`:
   - Header: `28 MCP` → `30 MCP`
   - Add `forge_secret_scan`, `forge_env_diff` rows to MCP table
   - Add 4 new REST endpoint rows
   - Update LiveGuard section: add v2.28 tools, dashboard tab description
3. `docs/capabilities.html`:
   - Update `28 MCP` → `30 MCP` in title, meta, og:desc, twitter title, img alt, badge
   - Add 2 new tool cards
   - Update LiveGuard section with v2.28 addition note
4. `ROADMAP.md` — add v2.28.0 entry
5. **Manual Ch 15 — Full content** (`docs/manual/what-is-liveguard.html`): Replace `<!-- CONTENT-PLACEHOLDER -->` with:
   - "The Problem LiveGuard Solves" — code is shipped, forge sessions end; who watches what happens next?
   - "The Lifecycle Position" diagram: `Specify → Plan → Execute → Ship → 🛡️ LIVEGUARD WATCHES`
   - "What LiveGuard Is Not" — not a production APM (no traffic monitoring), not a security scanner for running services; it's a post-coding / pre-prod intelligence layer
   - "The Guardian Metaphor" — the forge forges; the guardian watches the gates
   - "When to run LiveGuard tools" — on every deploy, on every PR merge, on a cron schedule
   - Callout: link to Chapter 16 (tools) and Chapter 17 (dashboard)
6. **Manual Ch 16 — Full content** (`docs/manual/liveguard-tools.html`): Replace stub with full reference:
   - One `<section>` per tool (11 total from v2.27 + v2.28): name, description, CLI invocation, key options, output shape, threshold defaults, integration notes (which other tools it feeds)
   - Tools table at top for quick scanning
   - Callout linking to Appendix F for response runbooks
7. **Manual Ch 17 — Full content** (`docs/manual/liveguard-dashboard.html`): Replace stub with full walkthrough:
   - Section header: dashboard URL, how to open, the FORGE/LIVEGUARD two-section nav visual
   - One `<section>` per LiveGuard tab (5 tabs): tab name, badge color/trigger, each widget explained, how real-time updates flow from hub events
   - "Help from the dashboard" callout: explains the `Docs ↗` link in each tab header (added in Slice 4)
   - Screenshot placeholder `<figure>` blocks with `<figcaption>` per tab (actual screenshots added post-ship)
8. **Manual Appendix F — Full content** (`docs/manual/liveguard-runbooks.html`): Replace stub with:
   - Severity matrix table: Critical / High / Medium / Low — response SLA, notify who, which forge tools to run, escalation path
   - One runbook per major alert type: drift spike, secret found, env diff gap, regression gate failure, dep vulnerability, incident MTTR exceeded
   - Each runbook: trigger condition → immediate action → root cause steps → resolution checklist → link to relevant Ch 16 tool
9. **Manual index update** — Update `docs/manual/index.html` version string: `v2.27.0 · 17 chapters · 6 appendices` → `v2.28.0 · 17 chapters · 6 appendices` (content now complete, no longer stubs)

**Validation Gate**:
```bash
node pforge-mcp/server.mjs --validate
bash -c "cd pforge-mcp && npx vitest run tests/server.test.mjs"
node -e "import('./pforge-mcp/capabilities.mjs').then(m => m.buildCapabilitySurface([])).then(s => { const count = Object.keys(m.TOOL_METADATA || {}).length; console.log('TOOL_METADATA entries:', count); })"
grep -c "forge_" docs/capabilities.md
```

**Stop Condition**: If tool count at `GET /api/capabilities` is not 30 → debug TOOL_METADATA vs TOOLS array discrepancy in server.mjs before proceeding to Slice 6.

---

### Slice 6 — Tests + VERSION + CHANGELOG + Push [depends: Slice 5]
**Build command**: `npx vitest run`  
**Test command**: `npx vitest run`

**Goal**: Full test coverage for both new tools, telemetry retrofit verification, dashboard tab smoke, version bump, clean commit and push.

**Tasks**:
1. `pforge-mcp/tests/server.test.mjs` — add for `forge_secret_scan`:
   - `clean: true` returned when no high-entropy additions in diff
   - `findings.masked` is always `"<REDACTED>"` — never a raw value
   - `GET /api/secrets/scan` returns 200 + last cache
   - `POST /api/secrets/scan/run` returns 401 without auth token
2. `pforge-mcp/tests/server.test.mjs` — add for `forge_env_diff`:
   - Missing keys detected correctly (fixture env files)
   - Extra keys detected correctly
   - Values never appear in output (JSON.stringify scan)
   - `GET /api/env/diff` returns 200 + cache
3. `pforge-mcp/tests/server.test.mjs` — telemetry integration:
   - `GET /api/liveguard/traces` returns 200 + array after any LiveGuard tool call
   - Hub broadcast `liveguard-tool-completed` fires (mock hub in test)
4. `pforge-mcp/tests/server.test.mjs` — dashboard tab smoke:
   - `GET /` returns HTML containing `LIVEGUARD` section label
   - 14 `tab-btn` elements rendered (9 FORGE tabs + 5 LIVEGUARD tabs — string count check)
   - Section divider element present in HTML (`section-divider` class)
5. `pforge-mcp/tests/server.test.mjs` — `forge_runbook` backward compatibility (H6):
   - When `.forge/env-diff-cache.json` is absent, `forge_runbook` completes without error and does NOT include an "Environment Key Gaps" section
   - When `.forge/env-diff-cache.json` is present with `summary.clean: false`, `forge_runbook` includes an "Environment Key Gaps" section listing the missing keys
   - Existing `forge_runbook` tests from v2.27 Slice 10 still pass (no regression)
5. Bump `VERSION` to `2.28.0`
6. Prepend `CHANGELOG.md` entry:
   ```
   ## [2.28.0] — 2026-xx-xx
   ### Added
   - forge_secret_scan: entropy-based secret detection on post-commit diffs
   - forge_env_diff: key-presence diff between .env.* files (values never read)
   - LiveGuard Dashboard Section: 5 focused tabs (Health, Incidents, Triage, Security, Env) in the unified dashboard
     with 9 operational health widgets, separated from FORGE section by a visual divider
   - GET /api/liveguard/traces: telemetry event stream for all LiveGuard tools
   - GET /api/secrets/scan, POST /api/secrets/scan/run
   - GET /api/env/diff
   ### Modified
   - forge_runbook: adds "Environment Key Gaps" section when .forge/env-diff-cache.json is present and not clean
   ### Telemetry
   - All 9 v2.27 LiveGuard tools verified to emit into .forge/liveguard-events.jsonl (scoped verification — not aggregate count)
   - liveguard-tool-completed hub event drives real-time dashboard updates
   ```
7. `git add -A`
8. `git commit -m "feat(liveguard): secret scan, env diff, dashboard tab, telemetry retrofit (v2.28.0)"`
9. `git push origin master`

**Validation Gate**:
```bash
npx vitest run
cat VERSION
git log --oneline -1
node -e " const fs = require('fs'), path = require('path'); const caches = ['.forge/secret-scan-cache.json', '.forge/env-diff-cache.json']; for (const f of caches) { if (!fs.existsSync(f)) continue; const raw = fs.readFileSync(f, 'utf8'); if (raw.includes('password') && !raw.includes('<REDACTED>') && !raw.includes('missing') && !raw.includes('extra')) throw new Error('Possible value leak in ' + f); } console.log('ok — no value leaks in .forge/ stores'); "
```

---

## Rollback Plan

1. **Dashboard tab**: LiveGuard tab is additive only — removing the `'LiveGuard'` entry from the tab array and deleting `renderLiveGuardTab()` restores the 8-tab layout with zero side effects
2. **New tools**: Comment out `forge_secret_scan` and `forge_env_diff` TOOLS entries and handlers — server restarts cleanly, other tools unaffected
3. **Telemetry retrofit**: `emitToolTelemetry()` failures are non-throwing; reverting means removing the calls — existing tools degrade gracefully to pre-telemetry behavior
4. **Git revert**: `git revert HEAD` cleanly reverts the single commit

---

## Anti-Pattern Checks

```bash
grep -rn '\.value\b\|rawValue\|secretValue' pforge-mcp/server.mjs    # no secret value capture
grep -rn '\.split.*=.*\[1\]' pforge-mcp/server.mjs                   # no value extraction after = in env parse
grep -rn 'console\.log.*findings' pforge-mcp/server.mjs               # no raw findings logging

node -e " const fs = require('fs'); const src = fs.readFileSync('pforge-mcp/server.mjs', 'utf8'); const allLgTools = ['forge_drift_report','forge_incident_capture','forge_dep_watch','forge_regression_guard','forge_runbook','forge_hotspot','forge_health_trend','forge_alert_triage','forge_deploy_journal','forge_secret_scan','forge_env_diff']; const covered = allLgTools.filter(t => { const toolIdx = src.indexOf(t); if (toolIdx < 0) return false; const handlerBlock = src.substring(toolIdx, toolIdx + 1500); return handlerBlock.includes('emitToolTelemetry'); }); if (covered.length < 11) throw new Error('Expected 11 handlers covered, got ' + covered.length + '. Missing: ' + allLgTools.filter(t => !covered.includes(t)).join(', ')); console.log('ok:', covered.length, '/ 11 handlers covered'); "

grep -rn "exec(" pforge-mcp/orchestrator.mjs                          # no exec() — use execFile() or spawn()
grep -rn "require(" pforge-mcp/dashboard/app.js                       # no Node.js require() in browser JS
```

---

## Patterns to Reuse (Do Not Reinvent)

| Need | Where to Find It |
|------|-----------------|
| Shannon entropy | Inline implementation in Slice 2 (~15 lines) — do not reach for `zxcvbn` or similar |
| Env file key parsing | `readFileSync → split('\n') → filter → map(l => l.split('=')[0].trim())` — 4 lines |
| Git graceful degradation | `forge_hotspot` handler — `gitAvailable: false` pattern, same check |
| Unified tool telemetry | `emitToolTelemetry()` from `orchestrator.mjs` (v2.27 Slice 1) |
| OTLP severity constants | `import { Severity } from './telemetry.mjs'` |
| Hub broadcast | `activeHub?.broadcast(eventName, payload)` — called inside `emitToolTelemetry` automatically |
| Dashboard tab structure | Read Runs tab and Traces tab in `app.js` — mirror their exact render function pattern |
| Chart.js chart instances | Cost tab in `app.js` — `window._costChart` pattern; mirror for `window._lgHotspotChart` |
| Write endpoint auth | `checkApprovalSecret()` — already imported in `server.mjs` |

---

## Verification

| Check | Command | Expected |
|-------|---------|----------|
| Tool count | `curl http://localhost:3100/api/capabilities \| node -e "..."` | `30` |
| All tests | `npx vitest run` | 0 failures |
| Server clean | `node pforge-mcp/server.mjs --validate` | no errors |
| Secret scan | `curl http://localhost:3100/api/secrets/scan` | `{ clean, scannedFiles, findings }` |
| Env diff | `curl http://localhost:3100/api/env/diff` | `{ pairs, summary, comparedAt }` |
| Traces endpoint | `curl http://localhost:3100/api/liveguard/traces` | `[]` or array of JSONL entries |
| Dashboard tab count | grep in app.js | 9 unique tab names |
| Hub event fires | WebSocket listener on `liveguard-tool-completed` | Fires within 2s of any tool call |
| No value leaks | Final security check in Slice 6 | `ok — no value leaks` |
| Telemetry all handlers | Anti-pattern check | `>=11 emitToolTelemetry calls` |

---

## Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Shannon entropy inline, no dep | Zero-install guarantee. 15 lines of pure JS covers the use-case. External libs (zxcvbn, detect-secrets) add install friction and maintenance burden. |
| Keys-only parsing for env diff | Values are irrelevant to key-presence analysis. Reading them would be a security anti-pattern with no upside. |
| `.env.local` excluded by default | `.env.local` is gitignored by convention (Next.js, Laravel, etc.) and machine-specific. Including it in diffs produces false positives. |
| Dashboard tab reads telemetry hub, not polling | Polling at 5s would generate 720 requests/hour for an idle dashboard. WebSocket event-driven update fires only when tools execute. |
| Chart.js instances stored on `window._lg*` | Same pattern as Cost tab's `window._costChart`. Allows destroy+recreate on data refresh without orphaned canvas elements. |
| Telemetry retrofit in Slice 1, not deferred | If v2.27 shipped with any handlers missing `emitToolTelemetry`, the dashboard tab would show dead widgets. Slice 1 verifies and repairs before building the UI. |
| No changes to `telemetry.mjs` | The OTLP module is stable and well-tested. LiveGuard adds a consumer pattern (not new exports). Adding to it risks breaking plan-execution telemetry. |

---

## Open Questions (Resolve Before Execution)

| # | Question | Recommendation |
|---|----------|---------------|
| OQ1 | What entropy threshold catches real secrets without false positives on Base64 images or minified JS? | Default `4.0`. Add file extension allowlist: skip `*.min.js`, `*.map`, `*.png.b64`. Document in TOOL_METADATA. Adjust threshold via input if teams report false positives. |
| OQ2 | Should the dashboard LiveGuard tab auto-refresh on a timer as a fallback when hub events are absent? | Yes — 30-second polling fallback if no `liveguard-tool-completed` event received in 60s. Same pattern as how the Runs tab falls back to polling when WebSocket drops. |
| OQ3 | Should `forge_env_diff` support non-dotenv formats (e.g., YAML-based config)? | No — scope to `.env.*` files only (KEY=VALUE format). YAML/TOML config diff is a future extension opportunity. Document explicitly in Out of Scope. |

---

## v2.28 → v2.29 Handoff Notes

Features deferred from v2.28 that are logical next candidates:

| Feature | Rationale for Deferral | Note |
|---------|------------------------|------|
| LiveGuard tab in DEPLOYMENT-ROADMAP.md auto-update | Requires write to roadmap on health change — risk of accidental file corruption | Add as opt-in `forge_roadmap_sync` tool in v2.29 |
| `forge_load_test_baseline` | Needs k6/Locust integration — new dep | External tool bridge, not standalone |
| GitOps canary gate | Requires cluster access — environment-specific | Extension candidate |
| Secret scan scheduled on git hook | PF doesn't manage git hooks (daemon constraint) | Provide `pforge secret-scan` as the pre-push hook command; document setup |

---

## 6 Mandatory Blocks — Verification

| # | Block | Present |
|---|-------|---------|
| 1 | Numbered execution slices with build/test commands | ✅ |
| 2 | Explicit validation gates per slice | ✅ |
| 3 | Stop conditions | ✅ |
| 4 | Rollback plan (4 tiers: tab, tools, telemetry, git revert) | ✅ |
| 5 | Anti-pattern checks (security + telemetry + architecture) | ✅ |
| 6 | Scope contract with explicit Out of Scope | ✅ |
