# Phase 24 — Dashboard Reliability & Setup Completion (v2.17.0)

> **Plan Type**: Hardened Execution Contract  
> **Created**: 2026-04-07  
> **Estimated Cost**: $1.80 (6 slices × ~$0.30 avg)  
> **Execution Mode**: `pforge run-plan --quorum=auto`

---

## Scope Contract

### In Scope
- Dashboard reliability: inline orchestrator event dispatch to hub (no file watcher dependency)
- Dashboard cold-start: REST API populates full slice state on page load
- Setup script sweep: wire all v2.15–v2.16 features into setup.ps1/setup.sh for new installs
- Validate-setup updates: check all new artifacts, warn on missing
- Event watcher fix already committed — this plan builds on it

### Out of Scope
- D1–D7 watch list items
- v3.1 Team Mode
- New features — this is a hardening/polish release

### Forbidden Actions
- DO NOT change the orchestrator DAG execution logic or slice parser
- DO NOT modify existing test fixtures
- DO NOT alter the MCP tool API signatures

---

## Acceptance Criteria

- **MUST** Orchestrator `runPlan()` accepts an optional `hub` parameter and broadcasts events directly (no file-only path)
- **MUST** Server passes `activeHub` to `runPlan()` when invoking from MCP tool or REST API
- **MUST** File-based event watcher remains as fallback for CLI-spawned orchestrator runs
- **MUST** Dashboard loads full slice state from REST on page load (existing — verify working)
- **MUST** `setup.ps1` Done banner includes plugin install URL
- **MUST** `setup.ps1` Step 5 `.forge.json` defaults use current escalation chain `["auto", "claude-opus-4.6", "gpt-5.3-codex"]`
- **MUST** `setup.ps1` Step 3b copies `forge-troubleshoot` skill to `.github/skills/`
- **MUST** `validate-setup.ps1` checks for `copilot-setup-steps.yml`, `forge-troubleshoot` skill, `allowInvocationsFromSubagents` setting
- **MUST** `pforge smith` reports dashboard connectivity (port 3100 reachable)
- **MUST** All 91+ existing tests pass after every slice

---

### Slice 1 — Orchestrator Hub Integration (Direct Event Dispatch)
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `pforge-mcp/orchestrator.mjs`, `pforge-mcp/server.mjs`

**Tasks**:
1. In `orchestrator.mjs`, modify `runPlan()` options to accept an optional `hub` parameter
2. Create a `HubEventHandler` class that wraps hub.broadcast() — when hub is provided, events go directly to the WebSocket hub AND to the log file (dual-write)
3. In `server.mjs`, when `forge_run_plan` MCP tool or REST `/api/tool/run-plan` invokes `runPlan()`, pass `activeHub` so events flow directly to dashboard clients
4. Keep `LogEventHandler` as the default when no hub is provided (CLI-spawned runs)
5. The file watcher remains as a fallback bridge for CLI-spawned orchestrator processes

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const s=require('fs').readFileSync('pforge-mcp/orchestrator.mjs','utf8');if(!s.includes('HubEventHandler')){process.exit(1);}console.log('HubEventHandler exists')"
node -e "const s=require('fs').readFileSync('pforge-mcp/server.mjs','utf8');if(!s.includes('activeHub')){process.exit(1);}console.log('Hub passed to runPlan')"
```

**Stop Condition**: Tests fail → STOP.

---

### Slice 2 — Dashboard Cold-Start Verification & Polish
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `pforge-mcp/dashboard/app.js`, `pforge-mcp/dashboard/index.html`, `pforge-mcp/server.mjs`

**Tasks**:
1. Verify `/api/runs/latest` returns complete slice data (status, title, duration, model, cost for each)
2. Verify `/api/runs/0` returns per-slice detail with gate output
3. In `dashboard/app.js`, ensure `renderSliceCards()` is called after REST init AND after each WS event
4. Add a "Last updated" timestamp display in the dashboard header showing when the last event was received
5. Add a visual indicator showing event source: "live" (hub direct) vs "file-watcher" (tailed from log)
6. Ensure the Event Log panel shows events from both REST history replay and live WS

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const s=require('fs').readFileSync('pforge-mcp/dashboard/app.js','utf8');if(!s.includes('renderSliceCards')){process.exit(1);}console.log('Dashboard render verified')"
```

**Stop Condition**: None — UI polish.

---

### Slice 3 — Setup Script New Install Sweep
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `setup.ps1`, `setup.sh`

**Tasks**:
1. Step 8 "Done" banner: add `"Install Plan Forge plugin: vscode://chat-plugin/install?source=srnichols/plan-forge"` to the next-steps output
2. Step 5 `.forge.json` generation: set `escalationChain` default to `["auto", "claude-opus-4.6", "gpt-5.3-codex"]`; remove any `gpt-5.1` references from defaults
3. Step 3b: ensure `presets/shared/skills/forge-troubleshoot/` is copied to `.github/skills/forge-troubleshoot/`
4. Step 5 `.forge.json`: add `cloudAgentValidation` key with `{ "codeql": true, "secretScanning": true, "copilotReview": true }` defaults
5. Step 5 `.forge.json`: add `memorySyncEnabled: false` and `pipeline: { nestedSubagents: true }` defaults
6. Mirror all changes in `setup.sh`

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const s=require('fs').readFileSync('setup.ps1','utf8');if(!s.includes('chat-plugin/install')){process.exit(1);}console.log('Plugin install link added')"
node -e "const s=require('fs').readFileSync('setup.ps1','utf8');if(!s.includes('claude-opus-4.6')){process.exit(1);}console.log('Escalation chain updated')"
```

**Stop Condition**: None — additive only.

---

### Slice 4 — Validate-Setup & Smith Upgrades
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `validate-setup.ps1`, `validate-setup.sh`, `pforge.ps1`, `pforge.sh`

**Tasks**:
1. `validate-setup.ps1`: add check for `forge-troubleshoot` skill directory existence
2. `validate-setup.ps1`: add check for `copilot-setup-steps.yml` (advisory warning if missing)
3. `validate-setup.ps1`: add check for `allowInvocationsFromSubagents` in `.vscode/settings.json` (advisory)
4. `validate-setup.ps1`: scan `.forge.json` for deprecated model names (`gpt-5.1`) — warn if found
5. `pforge.ps1` smith: add dashboard connectivity check (HTTP GET to `localhost:3100/api/hub`, report pass/fail)
6. Mirror all changes in `validate-setup.sh` and `pforge.sh`

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const s=require('fs').readFileSync('validate-setup.ps1','utf8');if(!s.includes('forge-troubleshoot')){process.exit(1);}console.log('Troubleshoot check added')"
node -e "const s=require('fs').readFileSync('pforge.ps1','utf8');if(!s.includes('3100')){process.exit(1);}console.log('Smith dashboard check added')"
```

**Stop Condition**: None — advisory checks only.

---

### Slice 5 — Doc & Template Final Sweep [P]
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `README.md`, `CUSTOMIZATION.md`, `docs/COPILOT-VSCODE-GUIDE.md`, `templates/copilot-instructions.md.template`, `ROADMAP.md`
**Depends on**: Slices 1–4

**Tasks**:
1. `CUSTOMIZATION.md`: document `cloudAgentValidation`, `memorySyncEnabled`, `pipeline.nestedSubagents` `.forge.json` keys
2. `README.md`: update escalation chain example to `auto → opus → codex`
3. `docs/COPILOT-VSCODE-GUIDE.md`: add "Dashboard Connectivity" section explaining how to verify events flow
4. `templates/copilot-instructions.md.template`: add `sync-memories` and `export-plan` to Quick Commands
5. `ROADMAP.md`: mark Setup & Updater Sweep as complete; update current release to v2.17

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const s=require('fs').readFileSync('CUSTOMIZATION.md','utf8');if(!s.includes('cloudAgentValidation')){process.exit(1);}console.log('CUSTOMIZATION updated')"
```

**Stop Condition**: None — documentation only.

---

### Slice 6 — VERSION Bump + CHANGELOG + Push [P] ← final
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`
**Depends on**: Slices 1–5

**Tasks**:
1. Run `pforge version-bump 2.17.0` — updates `VERSION` + `pforge-mcp/package.json`
2. Add CHANGELOG entry `## [2.17.0] — 2026-04-07` with sections:
   - **Fixed — Dashboard Reliability**
   - **Added — Setup Completion & Smith Diagnostics**
3. Stage all changes: `git add -A`
4. Commit: `git commit -m "feat: v2.17.0 — Dashboard Reliability & Setup Completion (Phase 24)"`
5. Push: `git push origin release/v2.17`

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const v=require('fs').readFileSync('VERSION','utf8').trim();if(v!=='2.17.0'){process.exit(1);}console.log('VERSION='+v)"
node -e "const o=require('child_process').execSync('git log --oneline -3',{encoding:'utf8'});console.log(o)"
```

**Stop Condition**: Tests fail after version bump → STOP, do not push.

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Hub integration breaks CLI-spawned runs | LogEventHandler preserved as default; hub is optional |
| Setup defaults conflict with user config | `-Merge` flag (v2.16) handles existing `.forge.json` |
| Dashboard WS reconnect after server restart | Hub sends event history on new connections |
