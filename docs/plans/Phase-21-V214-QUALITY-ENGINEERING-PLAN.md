# Phase 21: v2.14.0 — Quality Engineering (Framework Tests + Architecture Fixes)

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 5 hours (6 execution slices)  
> **Risk Level**: Medium (new test infrastructure + orchestrator architecture change)  
> **Branch**: `feature/v2.14-quality-engineering`  
> **Quorum**: Auto

---

## Overview

Add a vitest framework test suite, convert orchestrator from blocking terminal to background service, make the plan parser format-tolerant, add auto-discover to the updater, add dashboard loading states, and verify stderr streaming is safe.

## Acceptance Criteria

- **MUST**: vitest test suite with tests for parser, bridge formatters, analyzer scoring, gate extraction, agent list, updater file list
- **MUST**: `npm test` in pforge-mcp/ runs all tests and passes
- **MUST**: Orchestrator runs as background process — `pforge run-plan` spawns node detached and polls `/api/runs` for completion
- **MUST**: Plan parser accepts case-insensitive headers, flexible spacing, and both `Build Command` and `Build command` formats
- **MUST**: Updater auto-discovers all MCP files by comparing directory trees (not hardcoded list)
- **SHOULD**: Dashboard config tab shows loading skeleton before API data arrives
- **SHOULD**: stderr streaming verified to not corrupt token parsing buffer

---

## Scope Contract

### In Scope
- `pforge-mcp/tests/` — new test directory with vitest test files
- `pforge-mcp/package.json` — add vitest devDependency, test script
- `pforge-mcp/orchestrator.mjs` — parser tolerance, background execution mode
- `pforge-mcp/server.mjs` — add `/api/runs/latest` endpoint for polling
- `pforge-mcp/dashboard/app.js` — loading states for config tab
- `pforge.ps1` — background orchestrator invocation, auto-discover updater
- `pforge.sh` — mirror ps1 changes for background mode
- `CHANGELOG.md`, `VERSION`

### Out of Scope
- Dashboard redesign
- New features
- Preset changes

### Forbidden Actions
- Do NOT modify bridge.mjs
- Do NOT modify existing preset files
- Do NOT delete any existing functionality

---

## Execution Slices

### Slice 1: Framework Test Suite [sequential]

**Goal**: Create vitest test infrastructure with tests covering the bugs we found this session.

**Tasks**:
1. Add `vitest` to pforge-mcp/package.json devDependencies
2. Add `"test": "vitest run"` script
3. Create `pforge-mcp/tests/parser.test.mjs`:
   - Test `parsePlan()` with sample plan markdown
   - Test case-insensitive `Build Command` / `Build command` extraction
   - Test `### Slice N:` and `### Slice N —` formats
   - Test scope contract extraction
   - Test parallel tag detection
4. Create `pforge-mcp/tests/bridge.test.mjs`:
   - Test `formatTelegram()` output structure (chat_id, text, parse_mode)
   - Test `formatSlack()` output structure (blocks, text)
   - Test `formatDiscord()` output structure (embeds, color)
   - Test `formatGeneric()` output structure
   - Test `ApprovalGate` lifecycle (request → pending → approve → resolved)
5. Create `pforge-mcp/tests/analyzer.test.mjs`:
   - Test MUST/SHOULD extraction regex
   - Test checkbox fallback parsing
   - Test score calculation (25/25 when all criteria traced)
6. Create `pforge-mcp/tests/constants.test.mjs`:
   - Test SUPPORTED_AGENTS matches dashboard allAgents list
   - Test MODEL_PRICING has expected models

**Build Command**: `cd pforge-mcp && npx vitest run --reporter=verbose 2>&1`
**Test Command**: `cd pforge-mcp && npx vitest run 2>&1`

**Depends On**: None

---

### Slice 2: Background Orchestrator Mode [sequential]

**Goal**: Convert `pforge run-plan` from blocking terminal to background + polling.

**Tasks**:
1. In `pforge.ps1` `Invoke-RunPlan`, change from `& node orchestrator.mjs` (blocking) to:
   - Spawn `node orchestrator.mjs` as a detached background process
   - Write PID to `.forge/orchestrator.pid`
   - Poll `GET /api/runs/latest` every 5s for status updates
   - Print progress to stdout from the poll responses
   - Exit when run-completed event received
2. In `pforge-mcp/server.mjs`, add `GET /api/runs/latest` — returns the most recent run's summary + current slice status
3. In `pforge.sh`, mirror the background approach
4. Add `pforge run-plan --foreground` flag to keep the old blocking behavior (for debugging)

**Build Command**: `node -c pforge-mcp/server.mjs`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slice 1)

---

### Slice 3: Parser Format Tolerance [sequential]

**Goal**: Make the plan parser accept more markdown variations.

**Tasks**:
1. In `parsePlan()`, make slice header regex case-insensitive and flexible:
   - Accept `### Slice 1:`, `### Slice 1 —`, `### Slice 1.`, `### Slice 1 -`
   - Accept `**Build Command**:`, `**Build command**:`, `**build command**:`
   - Accept `**Test Command**:`, `**Test command**:`, `**test command**:`
   - Accept indented code blocks as gate commands: `` ```bash\ndotnet build\n``` ``
2. Add fuzzy slice type detection for dependencies:
   - `Depends On: Slice 1` and `Depends On: 1` and `depends: 1` all work
3. Add tests in `pforge-mcp/tests/parser.test.mjs` for each variation

**Build Command**: `cd pforge-mcp && npx vitest run tests/parser.test.mjs 2>&1`
**Test Command**: `cd pforge-mcp && npx vitest run tests/parser.test.mjs 2>&1`

**Depends On**: Slice 1 (needs vitest installed)

---

### Slice 4: Auto-Discover Updater [sequential]

**Goal**: Replace hardcoded file lists in `Invoke-Update` with directory tree comparison.

**Tasks**:
1. In `pforge.ps1` `Invoke-Update`, replace MCP file list with:
   ```powershell
   # Scan all .mjs, .json, .md files in pforge-mcp/ (excluding node_modules)
   Get-ChildItem -Path $srcMcp -File -Recurse | 
     Where-Object { $_.Extension -match '\.(mjs|json|md|html|js|css)$' -and $_.FullName -notmatch 'node_modules' }
   ```
2. Compare each file by SHA256 hash — update if different, add if new
3. Keep the "never update" list for user-customized files
4. Add `pforge update --check` (alias for `--dry-run`) to preview changes
5. Mirror in pforge.sh

**Build Command**: `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('pforge.ps1',[ref]$null,[ref]$null)|Out-Null;'OK'"`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slices 1-3)

---

### Slice 5: Dashboard Loading States + stderr Safety [sequential]

**Goal**: Fix dashboard config hydration and verify stderr streaming safety.

**Tasks**:
1. In `dashboard/app.js`, add loading skeleton to config tab:
   - Show "Loading configuration..." text while API call is in flight
   - Populate fields AFTER response arrives (not before)
   - Add timeout handler if API doesn't respond in 5s
2. Verify stderr streaming doesn't corrupt token parsing:
   - Add test in `tests/worker.test.mjs` that streams stderr while accumulating buffer
   - Verify `parseStderrStats()` still returns correct values when stderr has been streamed
3. Ensure `parseStderrStats()` reads from the complete `stderr` variable, not a partial stream

**Build Command**: `cd pforge-mcp && npx vitest run 2>&1`
**Test Command**: `cd pforge-mcp && npx vitest run 2>&1`

**Depends On**: Slice 1 (needs vitest)

---

### Slice 6: Version Bump + Changelog [sequential]

**Goal**: Bump to v2.14.0 and document all changes.

**Tasks**:
1. `VERSION` → 2.14.0
2. `pforge-mcp/package.json` → 2.14.0
3. `CHANGELOG.md` — v2.14.0 entry
4. Run `pforge version-bump 2.14.0` to update all version references
5. Run `npm test` to verify all framework tests pass

**Build Command**: `echo PASS`
**Test Command**: `cd pforge-mcp && npx vitest run 2>&1`

**Depends On**: Slices 1-5
