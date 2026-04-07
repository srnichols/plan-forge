# Phase 19: v2.13.0 — Platform Complete (9 Features)

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 6 hours (8 execution slices)  
> **Risk Level**: Medium (orchestrator changes + new MCP tool + web UI)  
> **Branch**: `feature/v2.13-platform-complete`  
> **Quorum**: Auto

---

## Overview

Ship the remaining backlog to reach platform completeness: agent-per-slice routing (auto-select best model from historical data), OpenBrain deep context loading, preset validation counts, Spec Kit auto-detect, dual-publish extensions, auto-update notifications, and a plan visualization Web UI.

## Acceptance Criteria

- **MUST**: Agent-per-slice routing uses `.forge/model-performance.json` to recommend cheapest model with >80% success rate per slice type
- **MUST**: OpenBrain context loaded before each worker spawn (search project history, inject relevant decisions)
- **MUST**: `validate-setup` checks minimum file counts per preset and reports missing files
- **MUST**: Step 0 auto-detects Spec Kit artifacts (`specs/`, `memory/constitution.md`) and offers import
- **MUST**: `pforge ext publish` outputs Spec Kit-compatible catalog entry alongside Plan Forge entry
- **MUST**: `pforge smith` shows update notification when a newer Plan Forge version is available on GitHub
- **MUST**: Web UI at `localhost:3100/ui` for plan visualization (read-only plan browser + DAG view)
- **SHOULD**: Model routing suggestion shown in `--estimate` output ("Recommended: claude-sonnet for DB slices based on 95% success rate")

---

## Scope Contract

### In Scope
- `pforge-mcp/orchestrator.mjs` — agent-per-slice routing logic, OpenBrain context injection enhancement
- `pforge-mcp/memory.mjs` — enhanced context loading for worker prompts
- `pforge-mcp/server.mjs` — `/ui` route serving web UI, `/api/plans` enhanced
- `pforge-mcp/ui/` — new directory: plan visualization HTML + JS
- `pforge.ps1` — auto-update check in smith, preset validation counts in check
- `pforge.sh` — mirror ps1 changes
- `setup.ps1` — Spec Kit detection in Step 0 logic (already in prompt, needs setup support)
- `setup.sh` — mirror
- `extensions/PUBLISHING.md` — dual-publish instructions
- `validate-setup.ps1` / `validate-setup.sh` — preset min count enforcement
- `CHANGELOG.md`, `VERSION`, `ROADMAP.md`

### Out of Scope
- Team mode (v3.1)
- Two-way chat from messaging platforms
- Dashboard redesign
- New presets

### Forbidden Actions
- Do NOT modify existing preset files
- Do NOT modify bridge.mjs
- Do NOT modify dashboard/app.js or dashboard/index.html

---

## Execution Slices

### Slice 1: Agent-Per-Slice Routing [sequential]

**Goal**: Use model-performance.json to auto-select the best model for each slice based on historical success rates.

**Tasks**:
1. Add `recommendModel(cwd, sliceType)` to orchestrator.mjs:
   - Reads `.forge/model-performance.json`
   - Groups by slice type keyword (e.g., "database", "auth", "test", "api")
   - Returns cheapest model with >80% success rate for that type
   - Falls back to escalation chain if no history
2. In `buildSlicePrompt()`, if no explicit model set, call `recommendModel()` to select
3. In `--estimate` mode, show recommended model per slice with success rate
4. Add `slice-model-routed` event to event bus

**Build Command**: `node -c pforge-mcp/orchestrator.mjs`
**Test Command**: `echo PASS`

**Depends On**: None

---

### Slice 2: OpenBrain Deep Context [sequential]

**Goal**: Load full project context from OpenBrain memory before spawning each worker.

**Tasks**:
1. In memory.mjs, add `loadProjectContext(cwd, projectName, sliceTitle)`:
   - Searches for decisions, patterns, and lessons-learned relevant to the slice
   - Returns a context block to prepend to the worker prompt
2. In orchestrator.mjs `buildSlicePrompt()`, call `loadProjectContext()` and inject before the slice instructions
3. Add `search_thoughts` call with slice-specific keywords (e.g., if slice title contains "database", search for "database migration patterns")
4. Graceful degradation: if OpenBrain not configured, skip silently (already works)

**Build Command**: `node -c pforge-mcp/orchestrator.mjs && node -c pforge-mcp/memory.mjs`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slice 1)

---

### Slice 3: Preset Validation Counts + Spec Kit Detection [parallel-safe, Group A]

**Goal**: Add minimum file count checks to validate-setup and Spec Kit auto-detection to setup scripts.

**Tasks**:
1. In `validate-setup.ps1` and `validate-setup.sh`, add per-preset minimum counts:
   - dotnet: >=15 instructions, >=6 agents, >=9 prompts, >=8 skills
   - typescript: same
   - python/java/go/rust/php/swift: same
   - azure-iac: >=5 instructions, >=1 agent, >=3 prompts
   - Report missing counts as warnings (not failures)
2. In `setup.ps1` and `setup.sh`, add Spec Kit detection at the start:
   - Check for `specs/` directory, `memory/constitution.md`, `specs/*/spec.md`
   - If found, print message: "Spec Kit artifacts detected. Plan Forge will layer guardrails on top."
   - Set flag in `.forge.json`: `speckit: true`

**Build Command**: `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('validate-setup.ps1',[ref]$null,[ref]$null)|Out-Null;'OK'"` and `bash -n validate-setup.sh`
**Test Command**: `echo PASS`

**Depends On**: None

---

### Slice 4: Dual-Publish Extensions to Spec Kit [sequential]

**Goal**: Update `pforge ext publish` to output both Plan Forge and Spec Kit compatible catalog entries.

**Tasks**:
1. In `Invoke-ExtPublish` (pforge.ps1), after generating the Plan Forge entry, also generate a Spec Kit-compatible `extensions.json` entry:
   ```json
   { "name": "...", "version": "...", "description": "...", "files": { "rules": [...], "agents": [...] } }
   ```
2. Print both entries with labels: "Plan Forge Catalog Entry:" and "Spec Kit Catalog Entry:"
3. Mirror in pforge.sh `cmd_ext_publish`
4. Update `extensions/PUBLISHING.md` with dual-publish instructions

**Build Command**: `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('pforge.ps1',[ref]$null,[ref]$null)|Out-Null;'OK'"`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slices 1-3)

---

### Slice 5: Auto-Update Notification in Smith [parallel-safe, Group A]

**Goal**: `pforge smith` checks GitHub for the latest Plan Forge version and warns if outdated.

**Tasks**:
1. In `Invoke-Smith` (pforge.ps1), add a "Version Currency" check:
   - Fetch `https://raw.githubusercontent.com/srnichols/plan-forge/master/VERSION` (timeout 5s)
   - Compare with local VERSION file
   - If remote is newer: warn "Plan Forge v{remote} available (you have v{local}). Run: pforge update"
   - If fetch fails: skip silently (offline OK)
2. Mirror in `pforge.sh` `cmd_doctor`
3. Cache the result in `.forge/version-check.json` with timestamp — only re-check every 24h

**Build Command**: `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('pforge.ps1',[ref]$null,[ref]$null)|Out-Null;'OK'"` and `bash -n pforge.sh`
**Test Command**: `echo PASS`

**Depends On**: None

---

### Slice 6: Web UI — Plan Visualization [sequential]

**Goal**: Serve a read-only plan visualization UI at `localhost:3100/ui`.

**Tasks**:
1. Create `pforge-mcp/ui/index.html` — single-page plan browser:
   - Lists plans from `docs/plans/` directory via `/api/plans`
   - Shows plan metadata: title, slices, status, scope contract
   - DAG visualization of slice dependencies (reuse dashboard DAG logic)
   - Slice detail cards: title, tasks, depends on, parallel tag
   - Read-only — no execution controls (those are on the dashboard)
2. Create `pforge-mcp/ui/app.js` — plan parsing and rendering
3. In `server.mjs`, add `app.use('/ui', express.static('pforge-mcp/ui'))`
4. Ensure `/api/plans` returns plan list with parsed metadata

**Build Command**: `node -c pforge-mcp/server.mjs`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slices 1-5)

---

### Slice 7: Version Bump + Changelog + Roadmap Update [sequential]

**Goal**: Bump to v2.13.0 and update all version references.

**Tasks**:
1. `VERSION` → 2.13.0
2. `pforge-mcp/package.json` → 2.13.0
3. `CHANGELOG.md` — v2.13.0 entry
4. `ROADMAP.md` — update current release, mark v3.0 items as shipped, move Team Mode to v3.1
5. `docs/index.html` — update version badge

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Get-Content VERSION -Raw).Trim() -eq '2.13.0') { 'PASS' } else { 'FAIL' }"`

**Depends On**: Slices 1-6

---

### Slice 8: README + Capabilities Refresh [sequential]

**Goal**: Update README and capabilities with v2.13 features.

**Tasks**:
1. `README.md` — add agent-per-slice routing, OpenBrain context, Web UI to feature list
2. `docs/capabilities.md` — add new features
3. `docs/capabilities.html` — sync

**Build Command**: `echo PASS`
**Test Command**: `echo PASS`

**Depends On**: Slices 1-7

---

## Definition of Done

- [ ] All 9 features implemented
- [ ] JS modules parse cleanly
- [ ] Shell scripts parse cleanly
- [ ] All docs updated
- [ ] VERSION = 2.13.0
