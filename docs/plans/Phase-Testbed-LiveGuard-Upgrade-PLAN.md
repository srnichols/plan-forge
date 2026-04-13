# Phase: Testbed LiveGuard Upgrade — Tracker App v2.27–v2.29

> **Roadmap Reference**: [ROADMAP.md](../../ROADMAP.md) → Testbed maintenance  
> **Status**: 📋 Planned  
> **Target Version**: Testbed aligns with Plan Forge `2.29.0`  
> **Branch Strategy**: `feature/testbed-liveguard-upgrade` (in `plan-forge-testbed` repo)  
> **Predecessor**: [Phase-LiveGuard-v2.29.0-PLAN.md](./Phase-LiveGuard-v2.29.0-PLAN.md) — must be complete before execution  
> **Estimated Effort**: 2–3 days (5 execution slices)  
> **Risk Level**: Low (validation/demo work, no production code changes)  
> **Workspace**: `E:\GitHub\plan-forge-testbed`

---

## Overview

The **plan-forge-testbed** (Tracker sample app) is the reference installation used for:

- Dashboard screenshots for the book manual (Chapters 6, 16)
- Setup wizard recordings and `pforge smith` captures
- VS Code screenshots showing instruction files, agents, skills
- End-to-end plan execution demos

With LiveGuard v2.27–v2.29 adding 13 tools, 5 dashboard tabs, 3 lifecycle hooks, and the fix-proposal workflow, the testbed needs fixtures and scenarios to exercise these features. Without seeded data, the 5 LiveGuard dashboard tabs render empty placeholders — unusable for documentation or validation.

**What this plan does:**

1. Bumps the testbed's Plan Forge installation to v2.29 (hooks, instructions, `.forge.json` config)
2. Seeds `.forge/` data stores with realistic Tracker-app LiveGuard data
3. Creates 3 LiveGuard test scenarios (regression → fix-proposal, secret finding → fix-proposal, drift breach → quorum-analyze)
4. Captures dashboard screenshots for all 5 LiveGuard tabs with seeded data
5. Validates the 3 hooks fire correctly against a real plan execution

---

## Prerequisites

- [ ] `Phase-LiveGuard-v2.29.0-PLAN.md` fully shipped — all 8 slices pass, v2.29.0 tagged
- [ ] `plan-forge-testbed` repo is on latest Plan Forge setup (currently on v2.26.x — will be bumped in Slice 1)
- [ ] MCP server starts successfully against the testbed: `cd plan-forge-testbed && node ../Plan-Forge/pforge-mcp/server.mjs`
- [ ] Tracker app has a working test suite (`npm test` passes)
- [ ] `capture-screenshots.mjs` Playwright utility available in `pforge-mcp/` for dashboard captures

---

## Acceptance Criteria

- [ ] Testbed `.forge.json` contains `hooks.preDeploy`, `hooks.postSlice`, `hooks.preAgentHandoff` configuration
- [ ] Testbed `.github/hooks/` contains all three LiveGuard hook spec files (PreDeploy.md, PostSlice.md, PreAgentHandoff.md)
- [ ] Testbed `.github/copilot-instructions.md` references LiveGuard hooks and v2.29 features
- [ ] `.forge/incidents/` contains ≥2 realistic incident fixtures
- [ ] `.forge/drift-history.json` contains ≥5 realistic drift score entries
- [ ] `.forge/secret-scan-cache.json` contains 1 seeded finding (test credential, not real)
- [ ] `.forge/regression-gates.json` contains ≥1 failed regression entry
- [ ] `pforge fix-proposal --source regression` generates a plan from seeded data
- [ ] `pforge fix-proposal --source secret` generates a plan from seeded secret finding
- [ ] `pforge quorum-analyze --source drift --goal root-cause` returns a structured prompt from seeded drift data
- [ ] Dashboard LiveGuard Health tab renders drift score and incident count from seeded data
- [ ] Dashboard LiveGuard Incidents tab renders fix-proposals feed with ≥1 entry
- [ ] All 5 LiveGuard tab screenshots captured and saved to `docs/manual/assets/screenshots/`
- [ ] `pforge run-plan --assisted` against a test plan triggers PostSlice hook (advisory logged)
- [ ] PreDeploy hook blocks when seeded secret finding exists
- [ ] `npx vitest run` still passes in Plan Forge repo after testbed changes
- [ ] Book manual screenshot checklist updated in `book-manual-plan.md` with new LiveGuard captures

---

## Scope Contract

### In Scope

| Area | Changes |
|------|---------|
| `plan-forge-testbed/.forge.json` | Add hooks config, openclaw placeholder, LiveGuard thresholds |
| `plan-forge-testbed/.forge/` data stores | Seed incidents, drift-history, regression-gates, secret-scan-cache, fix-proposals.json |
| `plan-forge-testbed/.github/hooks/` | Copy PreDeploy.md, PostSlice.md, PreAgentHandoff.md from Plan Forge |
| `plan-forge-testbed/.github/copilot-instructions.md` | Regenerate from v2.29 template (includes LiveGuard hooks table) |
| `plan-forge-testbed/.github/instructions/` | Regenerate from v2.29 preset templates |
| `plan-forge-testbed/docs/plans/` | Add 2 test plan files for scenario execution |
| `Plan-Forge/docs/manual/book-manual-plan.md` | Update screenshot checklist with LiveGuard tab captures |
| `Plan-Forge/docs/manual/assets/screenshots/` | New screenshots from LiveGuard dashboard tabs |

### Out of Scope (Explicitly Forbidden)

- **No Tracker app code changes** — this plan updates Plan Forge infrastructure in the testbed, not the Tracker app's source code
- **No real secrets** — all seeded `.forge/secret-scan-cache.json` entries use dummy test tokens (`TEST-TOKEN-DO-NOT-USE-abc123`), never real credentials
- **No commits to Plan Forge `server.mjs` or tool handlers** — if testbed testing reveals a v2.29 bug, file it as a separate fix issue, do not patch in this plan
- **No OpenClaw endpoint setup** — `openclaw.endpoint` in `.forge.json` uses a placeholder URL; actual OpenClaw integration testing is a separate concern
- **No new npm dependencies in testbed or Plan Forge**

---

## Fixture Schemas

### `.forge/incidents/INC-2026-04-001.json`
```json
{
  "incidentId": "INC-2026-04-001",
  "severity": "high",
  "source": "regression",
  "title": "Tracker API: GET /tasks returns 500 after auth refactor",
  "affectedFiles": ["src/routes/tasks.js", "src/middleware/auth.js"],
  "sliceRef": "S3",
  "planFile": "docs/plans/Phase-Auth-Refactor-PLAN.md",
  "capturedAt": "2026-04-10T14:30:00Z",
  "resolvedAt": null,
  "mttr": null
}
```

### `.forge/incidents/INC-2026-04-002.json`
```json
{
  "incidentId": "INC-2026-04-002",
  "severity": "medium",
  "source": "drift",
  "title": "Architecture drift score dropped to 72 after bulk import feature",
  "affectedFiles": ["src/services/import.js", "src/routes/import.js"],
  "sliceRef": "S5",
  "planFile": "docs/plans/Phase-Bulk-Import-PLAN.md",
  "capturedAt": "2026-04-12T09:15:00Z",
  "resolvedAt": null,
  "mttr": null
}
```

### `.forge/drift-history.json`
```json
[
  { "timestamp": "2026-04-08T10:00:00Z", "score": 96, "violations": 1, "plan": "Phase-Auth-Refactor-PLAN.md" },
  { "timestamp": "2026-04-09T11:00:00Z", "score": 94, "violations": 2, "plan": "Phase-Auth-Refactor-PLAN.md" },
  { "timestamp": "2026-04-10T14:00:00Z", "score": 88, "violations": 4, "plan": "Phase-Auth-Refactor-PLAN.md" },
  { "timestamp": "2026-04-11T16:00:00Z", "score": 85, "violations": 5, "plan": "Phase-Bulk-Import-PLAN.md" },
  { "timestamp": "2026-04-12T09:00:00Z", "score": 72, "violations": 8, "plan": "Phase-Bulk-Import-PLAN.md" }
]
```

### `.forge/regression-gates.json`
```json
[
  {
    "sliceId": "S3",
    "planFile": "docs/plans/Phase-Auth-Refactor-PLAN.md",
    "command": "npm test -- --grep 'tasks API'",
    "status": "failed",
    "output": "FAIL src/routes/tasks.test.js\n  ✕ GET /tasks returns 200 with valid token (expected 200, got 500)\n  ✕ GET /tasks/1 returns task detail (timeout)",
    "timestamp": "2026-04-10T14:25:00Z"
  }
]
```

### `.forge/secret-scan-cache.json`
```json
{
  "scannedAt": "2026-04-12T10:00:00Z",
  "ref": "HEAD",
  "findings": [
    {
      "file": "src/config/database.js",
      "line": 12,
      "type": "high-entropy-token",
      "confidence": "high",
      "redacted": "TEST-TOKEN-DO-NOT-USE-***"
    }
  ]
}
```

---

## Execution Slices

### Slice 1 — Bump Testbed to v2.29 Installation
**Build command**: `cd E:\GitHub\plan-forge-testbed && pwsh -c "../Plan-Forge/setup.ps1"`  
**Test command**: `cd E:\GitHub\plan-forge-testbed && pwsh -c "../Plan-Forge/pforge.ps1 smith"`

**Goal**: Update the testbed's Plan Forge installation artifacts to match v2.29 — hooks, instructions, copilot-instructions, and `.forge.json` config.

**Tasks**:
1. Run `setup.ps1` against the testbed to regenerate base template files from the v2.29 presets
2. Copy hook spec files from `Plan-Forge/.github/hooks/` to `plan-forge-testbed/.github/hooks/`:
   - `PreDeploy.md`
   - `PostSlice.md`
   - `PreAgentHandoff.md`
3. Update `plan-forge-testbed/.forge.json` — add hooks configuration:
   ```json
   {
     "hooks": {
       "preDeploy": { "enabled": true, "blockOnSeverity": "high" },
       "postSlice": { "enabled": true, "driftThreshold": 80 },
       "preAgentHandoff": { "enabled": true, "injectLiveGuardContext": true }
     },
     "openclaw": {
       "endpoint": "https://openclaw.example.com/api/v1/snapshot",
       "enabled": false
     }
   }
   ```
4. Verify `pforge smith` reports clean status with v2.29 version detection
5. Verify `.github/copilot-instructions.md` contains the LiveGuard Hooks table (auto-generated by setup)

**Validation Gate**:
```bash
cd E:\GitHub\plan-forge-testbed
pwsh -c "../Plan-Forge/pforge.ps1 smith" | Select-String "version"
# Should show v2.29.x
pwsh -c "../Plan-Forge/pforge.ps1 check"
# All checks pass
test -f .github/hooks/PreDeploy.md && echo "ok" || echo "FAIL: PreDeploy.md missing"
test -f .github/hooks/PostSlice.md && echo "ok" || echo "FAIL: PostSlice.md missing"
test -f .github/hooks/PreAgentHandoff.md && echo "ok" || echo "FAIL: PreAgentHandoff.md missing"
grep -c "PreDeploy" .github/copilot-instructions.md
# Should return ≥1
```

**Stop Condition**: If `setup.ps1` fails or `pforge smith` reports errors → debug the setup script first, do not proceed with seeded data on a broken installation.

---

### Slice 2 — Seed LiveGuard Fixtures [depends: Slice 1]
**Build command**: N/A (file creation only)  
**Test command**: `node -e "const fs = require('fs'); ['incidents/INC-2026-04-001.json','incidents/INC-2026-04-002.json','drift-history.json','regression-gates.json','secret-scan-cache.json'].forEach(f => { const p = '.forge/' + f; if (!fs.existsSync(p)) throw new Error('Missing: ' + p); console.log('ok:', p); })"`

**Goal**: Populate `.forge/` data stores with realistic Tracker-app data so LiveGuard tools and dashboard tabs have content to work with.

**Tasks**:
1. Create `.forge/incidents/INC-2026-04-001.json` with the regression incident fixture (see Fixture Schemas above)
2. Create `.forge/incidents/INC-2026-04-002.json` with the drift incident fixture
3. Create `.forge/drift-history.json` with 5 entries showing a declining score (96 → 72)
4. Create `.forge/regression-gates.json` with 1 failed regression entry referencing the Tracker tasks API
5. Create `.forge/secret-scan-cache.json` with 1 test-only finding (`TEST-TOKEN-DO-NOT-USE-abc123`, never a real secret)
6. Create `.forge/fix-proposals.json` as empty array `[]` — will be populated by Slice 3 scenarios

**Validation Gate**:
```bash
cd E:\GitHub\plan-forge-testbed
node -e "
const fs = require('fs');
const files = [
  '.forge/incidents/INC-2026-04-001.json',
  '.forge/incidents/INC-2026-04-002.json',
  '.forge/drift-history.json',
  '.forge/regression-gates.json',
  '.forge/secret-scan-cache.json',
  '.forge/fix-proposals.json'
];
for (const f of files) {
  if (!fs.existsSync(f)) throw new Error('Missing: ' + f);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('ok:', f, '— entries:', Array.isArray(data) ? data.length : Object.keys(data).length);
}
// Verify no real secrets
const scan = JSON.parse(fs.readFileSync('.forge/secret-scan-cache.json', 'utf8'));
if (scan.findings.some(f => !f.redacted.includes('TEST-TOKEN'))) throw new Error('SECURITY: non-test token detected in fixture!');
console.log('ok — all fixtures valid, no real secrets');
"
```

**Stop Condition**: If any fixture file contains a string that looks like a real API key, credential, or connection string → STOP immediately. All test tokens must use the `TEST-TOKEN-DO-NOT-USE-*` prefix. Grep for common secret patterns (`AKIA`, `sk-`, `ghp_`, `-----BEGIN`) before committing.

---

### Slice 3 — LiveGuard Scenario Execution [depends: Slice 2]
**Build command**: `cd E:\GitHub\plan-forge-testbed && node ../Plan-Forge/pforge-mcp/server.mjs --validate`  
**Test command**: See validation gate

**Goal**: Run the 3 LiveGuard test scenarios against seeded data to verify the detect → propose → analyze loop works end-to-end with the Tracker app.

**Tasks**:
1. **Scenario A — Regression → Fix Proposal**:
   - Run: `pforge fix-proposal --source regression`
   - Verify a plan file is generated at `docs/plans/auto/LIVEGUARD-FIX-INC-2026-04-001.md`
   - Verify `.forge/fix-proposals.json` now has 1 entry with `status: "proposed"`
   - Verify the generated plan references `npm test -- --grep 'tasks API'` as the failing command
   - Verify re-running returns `alreadyExists: true` (cap enforcement)
2. **Scenario B — Secret Finding → Fix Proposal**:
   - Run: `pforge fix-proposal --source secret`
   - Verify a plan file is generated at `docs/plans/auto/LIVEGUARD-FIX-secret-src-config-database-js-*.md`
   - Verify the fix slice template mentions credential rotation
   - Verify `.forge/fix-proposals.json` now has 2 entries
3. **Scenario C — Drift Score → Quorum Analyze**:
   - Run: `pforge quorum-analyze --source drift --goal root-cause`
   - Verify output is a structured 3-section prompt (no model calls, just the prompt text)
   - Verify the prompt references the drift score decline (96 → 72) from seeded data
   - Run: `pforge quorum-analyze --source drift --custom-question "Should we revert the bulk import feature?"`
   - Verify `questionUsed` in response matches the custom question
4. Create a test plan file `docs/plans/Testbed-Scenario-Verify-PLAN.md` (1-slice plan that runs `npm test` in the testbed) for use in Slice 4's hook testing

**Validation Gate**:
```bash
cd E:\GitHub\plan-forge-testbed

# Scenario A
pwsh -c "../Plan-Forge/pforge.ps1 fix-proposal --source regression"
test -f docs/plans/auto/LIVEGUARD-FIX-INC-2026-04-001.md && echo "ok — regression fix plan generated" || echo "FAIL"
node -e "const fp = JSON.parse(require('fs').readFileSync('.forge/fix-proposals.json','utf8')); if(fp.length < 1) throw 'no proposals'; console.log('ok —', fp.length, 'proposal(s)');"

# Scenario B
pwsh -c "../Plan-Forge/pforge.ps1 fix-proposal --source secret"
ls docs/plans/auto/LIVEGUARD-FIX-secret-* && echo "ok — secret fix plan generated" || echo "FAIL"

# Scenario C
pwsh -c "../Plan-Forge/pforge.ps1 quorum-analyze --source drift --goal root-cause" | Select-String "Section"
# Should show structured prompt sections

# Cap enforcement
pwsh -c "../Plan-Forge/pforge.ps1 fix-proposal --source regression" | Select-String "alreadyExists"
# Should show alreadyExists: true
```

**Stop Condition**: If `pforge fix-proposal` throws an error reading the fixture files → the data store format has drifted from v2.29's expected schema. Compare fixture schemas against `orchestrator.mjs`'s `generateFixPlan()` descriptor shape and fix the fixtures, not the tool code.

---

### Slice 4 — Hook Validation [depends: Slice 3]
**Build command**: `cd E:\GitHub\plan-forge-testbed && node ../Plan-Forge/pforge-mcp/server.mjs --validate`  
**Test command**: See validation gate

**Goal**: Verify the 3 lifecycle hooks fire correctly against real Tracker-app plan execution with seeded LiveGuard data.

**Tasks**:
1. **PreDeploy Hook Test**:
   - With seeded secret finding in `.forge/secret-scan-cache.json` (from Slice 2), run a plan that touches `deploy/` paths
   - Verify PreDeploy hook blocks with severity ≥ high message
   - Temporarily clear the secret cache, re-run → verify hook passes (no blocking)
   - Restore the secret cache fixture
2. **PostSlice Hook Test**:
   - Run: `pforge run-plan --assisted docs/plans/Testbed-Scenario-Verify-PLAN.md` (the 1-slice test plan from Slice 3)
   - Verify PostSlice hook fires after the slice commit with an advisory message
   - Verify the advisory includes the current drift score (72 from seeded data, below the 80 threshold)
   - Verify the plan execution is NOT blocked (advisory only)
3. **PreAgentHandoff Hook Test**:
   - Set `PFORGE_QUORUM_TURN=1` env var, start a session → verify the hook skips entirely (no context injection)
   - Unset `PFORGE_QUORUM_TURN`, start a session → verify LiveGuard context block is injected (drift score, open incidents, MTTR)
   - Verify `openclaw.enabled: false` means no HTTP POST attempt (no network call logged)
4. Document hook test results in the test plan's Slice 1 footnotes (in `Testbed-Scenario-Verify-PLAN.md`)

**Validation Gate**:
```bash
cd E:\GitHub\plan-forge-testbed

# PreDeploy — should block on secret finding
pwsh -c "../Plan-Forge/pforge.ps1 run-plan --assisted docs/plans/Testbed-Scenario-Verify-PLAN.md" 2>&1 | Select-String "PreDeploy"
# If plan doesn't touch deploy paths, manually test:
# node -e "import('../Plan-Forge/pforge-mcp/orchestrator.mjs').then(m => m.runPreDeployHook().then(r => console.log(JSON.stringify(r))))"

# PostSlice — should log advisory
# (advisory appears in run output when drift is below threshold)

# PreAgentHandoff — PFORGE_QUORUM_TURN guard
$env:PFORGE_QUORUM_TURN = "1"
# Verify hook skips (check server logs)
Remove-Item Env:\PFORGE_QUORUM_TURN
# Verify hook fires with context injection

echo "All 3 hooks verified against testbed"
```

**Stop Condition**: If a hook throws a runtime error → this is a v2.29 bug. Do NOT fix it in this plan. File an issue against `Phase-LiveGuard-v2.29.0-PLAN.md`, document the error, and proceed with remaining slices. Hook testing is verification, not development.

---

### Slice 5 — Dashboard Screenshots & Manual Update [depends: Slice 3]
**Build command**: `node pforge-mcp/capture-screenshots.mjs`  
**Test command**: `ls docs/manual/assets/screenshots/lg-*.png | Measure-Object`

**Goal**: Capture all 5 LiveGuard dashboard tab screenshots with seeded Tracker data visible, and update the book manual plan's screenshot checklist.

**Tasks**:
1. Start the MCP server against the testbed: `cd plan-forge-testbed && node ../Plan-Forge/pforge-mcp/server.mjs`
2. Open `localhost:3100/dashboard` in Playwright
3. Capture screenshots of all 5 LiveGuard tabs:
   - **Health tab** (`lg-health`): Drift score card showing 72, Open Incidents showing 2, Drift History showing 5-entry trend
   - **Incidents tab** (`lg-incidents`): Fix Proposals feed showing 2 entries from Slice 3, Open Incidents list showing 2 incidents
   - **Triage tab** (`lg-triage`): Alert triage placeholder (unless triage data was seeded — acceptable as placeholder)
   - **Security tab** (`lg-security`): Secret scan results showing 1 finding (redacted)
   - **Env tab** (`lg-env`): Env diff view (if `.env` files exist in testbed, otherwise placeholder)
4. Save screenshots to `Plan-Forge/docs/manual/assets/screenshots/`:
   - `lg-health-tab.png`
   - `lg-incidents-tab.png`
   - `lg-triage-tab.png`
   - `lg-security-tab.png`
   - `lg-env-tab.png`
5. Update `Plan-Forge/docs/manual/book-manual-plan.md` — add LiveGuard screenshots to the checklist:
   ```markdown
   - [ ] Dashboard LiveGuard Health tab (Ch 16) — **ESSENTIAL**: Real drift score + incident count. **Capture from testbed.**
   - [ ] Dashboard LiveGuard Incidents tab (Ch 16) — **ESSENTIAL**: Fix proposals feed with real entries. **Capture from testbed.**
   - [ ] Dashboard LiveGuard Triage tab (Ch 16) — **HELPFUL**: Alert triage list. **Capture from testbed.**
   - [ ] Dashboard LiveGuard Security tab (Ch 16) — **HELPFUL**: Secret scan results (redacted). **Capture from testbed.**
   - [ ] Dashboard LiveGuard Env tab (Ch 16) — **HELPFUL**: Env key diff. **Capture from testbed.**
   ```
6. Update the Asset Production Plan table in `book-manual-plan.md` with 5 new rows for LiveGuard captures

**Validation Gate**:
```bash
cd E:\GitHub\Plan-Forge
ls docs/manual/assets/screenshots/lg-*.png
# Should list 5 files
# Verify each is non-zero size
Get-ChildItem docs/manual/assets/screenshots/lg-*.png | ForEach-Object { if ($_.Length -eq 0) { throw "Empty screenshot: $_" }; "$($_.Name): $($_.Length) bytes" }
# Verify book-manual-plan.md updated
grep -c "LiveGuard Health tab" docs/manual/book-manual-plan.md
# Should return ≥1
```

**Stop Condition**: If `capture-screenshots.mjs` can't connect to the dashboard → verify the MCP server is running and the `--port` flag matches. If a LiveGuard tab renders empty despite seeded fixtures → check the tab load hooks in `app.js` are fetching the correct REST endpoints. Screenshot empty tabs with a TODO overlay rather than blocking.

---

## Rollback Plan

All changes are in the `plan-forge-testbed` repo (separate from Plan Forge core). Rollback is:

```bash
cd E:\GitHub\plan-forge-testbed
git checkout master
git branch -D feature/testbed-liveguard-upgrade
# Fixtures are in .forge/ which is gitignored — delete manually
rm -rf .forge/incidents/ .forge/drift-history.json .forge/regression-gates.json .forge/secret-scan-cache.json .forge/fix-proposals.json
rm -rf docs/plans/auto/
```

For Plan Forge repo (screenshots only):
```bash
cd E:\GitHub\Plan-Forge
git checkout -- docs/manual/book-manual-plan.md
rm docs/manual/assets/screenshots/lg-*.png
```

---

## Anti-Pattern Checks

| Anti-Pattern | Guard |
|-------------|-------|
| Real secrets in fixtures | All seeded tokens use `TEST-TOKEN-DO-NOT-USE-*` prefix. Secret scan validation in Slice 2 gate greps for common secret patterns. |
| Testbed changes leak into Plan Forge core | Scope Contract explicitly forbids changes to `server.mjs`, `orchestrator.mjs`, or any tool handler. File bugs, don't fix. |
| Fixtures that don't match v2.29 schema | Slice 3 runs the actual tools against fixtures. If the schema drifts, the tools will error — caught at validation gate. |
| Screenshots taken with stale data | Slice 5 depends on Slice 3 (fixture-populated, tools-exercised). Screenshots are taken after all scenarios pass. |
| Testbed becomes a testing dependency | Testbed is documentation/demo support only. Plan Forge's own tests in `pforge-mcp/tests/` remain self-contained with mocks. |

---

## Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Separate plan, not v2.29 slices | Testbed work is validation/demo, not feature development. Clean plan boundary lets us track testbed bugs separately from v2.29 implementation bugs. v2.29 stays at 8 slices (the sweet spot). |
| Fixtures use believable but fake data | Real-looking data (task API failures, auth refactor drift) produces better screenshots and more realistic tool output than lorem ipsum. All test tokens are prefixed `TEST-TOKEN-DO-NOT-USE-*`. |
| Hook testing is verification, not development | If a hook doesn't fire correctly, it's a v2.29 bug — filed as a separate issue. This plan's job is to surface bugs, not fix them. |
| Screenshots go in Plan Forge, not testbed | Screenshots are documentation assets for the book manual. They belong in the docs repo, not the sample app repo. |
| Only 5 slices | Testbed work is lower complexity than feature development. Each slice is focused: install, seed, test, verify hooks, capture. No need for 8+ slices. |

---

## Open Questions

| # | Question | Options | Recommendation |
|---|----------|---------|----------------|
| OQ1 | Should testbed fixtures be committed to git or gitignored? | **A)** Committed — enables reproducible screenshots without re-seeding. **B)** Gitignored — keeps the repo clean, seed via script. | **A — Committed**. Fixtures are documentation reference data. Committing them ensures anyone cloning the testbed gets the same LiveGuard experience. The `.forge/` directory is already gitignored by default, so we'd need a `.gitignore` exception (`!.forge/incidents/`, `!.forge/drift-history.json`, etc.) — similar to the `!docs/plans/auto/README.md` pattern from v2.29 OQ3. |
| OQ2 | Should we seed `.env` files for env-diff testing? | **A)** Yes — create `.env`, `.env.staging`, `.env.production` with dummy keys to populate the Env tab. **B)** No — Env tab shows placeholder, sufficient for v1 screenshots. | **A — Yes**. Three `.env.*` files with non-secret key stubs (e.g., `DATABASE_URL=placeholder`, `API_KEY=test-only`) makes the Env tab screenshot useful. All values must be dummy/placeholder — no real connection strings. |
| OQ3 | Should Triage tab have seeded data too? | **A)** Yes — create `.forge/triage-cache.json` with alert priority rankings. **B)** No — Triage is the least visual tab, placeholder is fine for v1. | **B — No**. Triage depends on `forge_alert_triage` having been run with real alert data. Seeding triage data without the tool having actually triaged would be misleading. Capture the placeholder state with a "run pforge alert-triage to populate" message. |

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
