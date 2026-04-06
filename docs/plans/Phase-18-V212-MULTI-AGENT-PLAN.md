# Phase 18: v2.12.0 — Multi-Agent Orchestration + Doc Refresh

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 5 hours (6 execution slices)  
> **Risk Level**: Medium (orchestrator changes + broad doc updates)  
> **Branch**: `feature/v2.12-multi-agent`  
> **Quorum**: Auto

---

## Overview

Add v3.0-roadmap multi-agent features to the orchestrator: auto-escalation (re-route failed slices to stronger models), CI/CD integration (trigger GitHub Actions after slices), and cost optimization (historical model performance tracking). Also refresh all public-facing docs to reflect v2.10-v2.11 features (bridge, 8 presets, 7 agents, security-audit skill, ext publish).

---

## Acceptance Criteria

- **MUST**: Auto-escalation — if a slice fails after max retries on model A, promote to a stronger model from an escalation chain
- **MUST**: Escalation chain configurable in `.forge.json`: `escalationChain: ["auto", "claude-sonnet-4.6", "claude-opus-4.6"]`
- **MUST**: CI/CD hook — after all slices pass, optionally trigger `gh workflow run` if configured
- **MUST**: Cost optimization — track model success rate per slice type in `.forge/model-performance.json`
- **MUST**: capabilities.md/html updated with all v2.10-v2.11 features (bridge, 9 presets, 7 agents, ext publish, security-audit)
- **MUST**: CLI-GUIDE.md documents ext publish, bridge config, all presets
- **MUST**: README.md reflects 9 presets, 7 agents, bridge, security-audit
- **SHOULD**: FAQ.html mentions Windsurf, Gemini, bridge, approval gates
- **SHOULD**: EXTENSIONS.md documents pforge ext publish workflow

---

## Scope Contract

### In Scope
- `pforge-mcp/orchestrator.mjs` — auto-escalation logic, CI/CD hook, model performance tracking
- `docs/capabilities.md` — refresh preset count, skill count, add bridge + adapter sections
- `docs/capabilities.html` — sync with capabilities.md
- `docs/CLI-GUIDE.md` — add ext publish, bridge config, new presets
- `docs/EXTENSIONS.md` — add ext publish workflow
- `docs/faq.html` — add Windsurf/Gemini/bridge entries
- `docs/index.html` — fix preset count, feature numbers
- `README.md` — fix preset count, add security-audit, bridge
- `CHANGELOG.md` — v2.12.0 entry
- `VERSION` — bump to 2.12.0

### Out of Scope
- Team mode (deferred to v3.1)
- New MCP tools
- Dashboard changes
- New presets or skills

### Forbidden Actions
- Do NOT modify `pforge-mcp/bridge.mjs` or `pforge-mcp/hub.mjs`
- Do NOT modify setup.ps1/setup.sh
- Do NOT modify any preset file content

---

## Execution Slices

### Slice 1: Auto-Escalation in Orchestrator [sequential]

**Goal**: When a slice fails after max retries, automatically promote to a stronger model from a configurable escalation chain.

**Tasks**:
1. Add `loadEscalationChain(cwd)` function — reads `.forge.json` `escalationChain` array, defaults to `["auto", "claude-sonnet-4.6", "claude-opus-4.6"]`
2. Modify the retry loop in `executeSlice()`:
   - Track current model index in escalation chain
   - On retry failure, advance to next model in chain
   - Emit `slice-escalated` event with old model → new model
   - Log escalation to stdout (uses the new progress handler)
3. Add `slice-escalated` event type to the event bus
4. Update the progress logger to handle `slice-escalated`

**Build Command**: `node -c pforge-mcp/orchestrator.mjs`
**Test Command**: `node -e "import('./pforge-mcp/orchestrator.mjs').then(m => { console.log('exports:', Object.keys(m).join(',')); process.exit(0) })"`

**Depends On**: None

---

### Slice 2: CI/CD Integration Hook [sequential]

**Goal**: After all slices pass, optionally trigger a GitHub Actions workflow.

**Tasks**:
1. Add `loadCiConfig(cwd)` — reads `.forge.json` `ci` block: `{ enabled, workflow, ref, inputs }`
2. After successful run completion in `runPlan()`, check if CI is configured
3. If so, call `gh workflow run <workflow> --ref <ref>` via `execSync`
4. Emit `ci-triggered` event with workflow name and status
5. Record CI trigger in run summary

**Build Command**: `node -c pforge-mcp/orchestrator.mjs`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slice 1)

---

### Slice 3: Model Performance Tracking [sequential]

**Goal**: Track model success rates per slice type for future cost optimization recommendations.

**Tasks**:
1. After each slice completes, append to `.forge/model-performance.json`:
   ```json
   { "model": "claude-sonnet-4.6", "sliceType": "database-migration", "success": true, "duration": 205, "cost": 0.01, "timestamp": "..." }
   ```
2. Add `loadModelPerformance(cwd)` and `recordModelPerformance(cwd, entry)` functions
3. Add `forge_model_stats` section to `forge_cost_report` MCP tool output — shows success rate per model
4. In estimate mode, use historical performance to recommend cheapest model that has >80% success rate

**Build Command**: `node -c pforge-mcp/orchestrator.mjs`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slices 1-2)

---

### Slice 4: Doc Refresh — Capabilities + CLI Guide + Extensions [sequential]

**Goal**: Update capabilities.md, capabilities.html, CLI-GUIDE.md, EXTENSIONS.md with all v2.10-v2.11 features.

**Tasks**:
1. `docs/capabilities.md`: Fix preset count (7→9), add PHP/Rust/Swift to presets table, add Bridge section, add security-audit to skills, add Windsurf/Gemini to agents
2. `docs/capabilities.html`: Sync with capabilities.md changes
3. `docs/CLI-GUIDE.md`: Add `pforge ext publish`, bridge config, `-Preset php|rust|swift`, `-Agent windsurf|gemini|generic`
4. `docs/EXTENSIONS.md`: Add "Publishing Your Extension" section documenting `pforge ext publish` workflow

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Select-String 'ext publish' docs/CLI-GUIDE.md).Count -gt 0 -and (Select-String 'php' docs/capabilities.md).Count -gt 0) { 'PASS' } else { 'FAIL' }"`

**Depends On**: None (parallel-safe with Slices 1-3)

---

### Slice 5: Doc Refresh — README + FAQ + Index [sequential]

**Goal**: Update README.md, faq.html, index.html with current feature counts and new capabilities.

**Tasks**:
1. `README.md`: Fix "6 presets" → "9 presets (8 app + 1 IaC)", document /security-audit skill, mention bridge, list all 7 agents
2. `docs/faq.html`: Add entries for Windsurf, Gemini CLI, bridge/approval gates, generic agent
3. `docs/index.html`: Fix preset count in quick-start, verify MCP tool count, update feature highlights

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Select-String '9 presets' README.md).Count -gt 0) { 'PASS' } else { 'FAIL' }"`

**Depends On**: None (parallel-safe with Slices 1-4)

---

### Slice 6: Version Bump + Changelog + EVENTS.md [sequential]

**Goal**: Version bump, changelog, update EVENTS.md with new event types.

**Tasks**:
1. `VERSION` → 2.12.0
2. `pforge-mcp/package.json` → 2.12.0
3. `CHANGELOG.md` — v2.12.0 entry
4. `pforge-mcp/EVENTS.md` — add `slice-escalated`, `ci-triggered` events
5. `ROADMAP.md` — update current release to v2.12.0

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Get-Content VERSION -Raw).Trim() -eq '2.12.0') { 'PASS' } else { 'FAIL' }"`

**Depends On**: Slices 1-5

---

## Definition of Done

- [ ] Auto-escalation works with configurable chain
- [ ] CI/CD hook triggers workflow on success
- [ ] Model performance tracked per slice
- [ ] All docs updated with v2.10-v2.11 features
- [ ] VERSION = 2.12.0
- [ ] All validation gates passed
- [ ] Reviewer Gate passed (zero 🔴 Critical)

---

## Stop Conditions

- ❌ Orchestrator fails to load (syntax error)
- ❌ Bridge or hub modified (scope violation)
- ❌ Setup scripts modified (scope violation)
- ❌ Preset files modified (scope violation)
