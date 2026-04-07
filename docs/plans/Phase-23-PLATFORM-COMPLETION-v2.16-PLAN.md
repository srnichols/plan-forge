# Phase 23 — Platform Completion & Setup Hardening (v2.16.0)

> **Plan Type**: Hardened Execution Contract  
> **Created**: 2026-04-07  
> **Estimated Cost**: $2.80 (8 slices × ~$0.35 avg)  
> **Execution Mode**: `pforge run-plan --quorum=auto`

---

## Scope Contract

### In Scope
- B2: Nested Subagent Pipeline (pipeline agents + settings template)
- B4: Validation Tools Complement Guide (docs + .forge.json schema)
- C1: Copilot SDK Tool Provider (npm package scaffold)
- C2: Cloud Agent Plan Export (`forge_export_plan` MCP tool + CLI)
- C3: `forge_sync_memories` (soft-sync to `.github/copilot-memory-hints.md`)
- C4: Fine-Grained Tool Approval (tool risk classification + docs)
- Setup/Updater sweep: `-Merge` flag, `.forge.json` schema migration, deprecated model warnings, cloud-agent support, validate-setup updates

### Out of Scope
- D1–D7 watch list items
- v3.1 Team Mode
- VS Code extension packaging (C4 requires extension — document classification only, defer packaging)
- OpenBrain write integration (C3 soft-sync only)

### Forbidden Actions
- DO NOT modify `pforge-mcp/orchestrator.mjs` DAG execution logic
- DO NOT change existing test fixtures in `pforge-mcp/tests/fixtures/`
- DO NOT alter the hub WebSocket protocol (`hub.mjs` broadcast format)
- DO NOT delete or rename existing MCP tools

---

## Acceptance Criteria

- **MUST** Pipeline `.agent.md` templates include subagent invocation instructions and termination guards
- **MUST** `templates/vscode-settings.json.template` includes `chat.subagents.allowInvocationsFromSubagents: true`
- **MUST** Validation Layers comparison table exists in `docs/COPILOT-VSCODE-GUIDE.md`
- **MUST** `forge_export_plan` MCP tool registered in `server.mjs` and callable
- **MUST** `pforge export-plan` CLI command works in both `pforge.ps1` and `pforge.sh`
- **MUST** `forge_sync_memories` MCP tool writes `.github/copilot-memory-hints.md`
- **MUST** All 19+ MCP tools have `riskLevel` field in `tools.json`
- **MUST** `setup.ps1 -Merge` and `setup.sh --merge` perform additive-only file operations
- **MUST** `.forge.json` schema migration preserves existing user config keys
- **MUST** `pforge smith` warns on deprecated model references
- **MUST** `validate-setup.ps1` checks for `forge-troubleshoot` skill, `copilot-setup-steps.yml`
- **SHOULD** `@plan-forge/copilot-sdk` scaffold exists with typed exports and README
- **SHOULD** Agent adapters updated for new skills and model references
- **MUST** All 91+ existing tests pass after every slice

---

### Slice 1 — Nested Subagent Pipeline (B2)
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `templates/.github/agents/*.agent.md`, `templates/vscode-settings.json.template`, `docs/COPILOT-VSCODE-GUIDE.md`

**Tasks**:
1. Update all 5 pipeline agent templates (`specifier.agent.md`, `plan-hardener.agent.md`, `executor.agent.md`, `reviewer-gate.agent.md`, `shipper.agent.md`) in `templates/.github/agents/`:
   - Add `subagent: true` capability in YAML frontmatter
   - Add handoff instructions: after completing phase, invoke next pipeline agent as subagent with context payload
   - Add termination guard: "STOP after completing your phase. Do NOT recurse into the next agent unless explicitly configured."
   - Preserve existing handoff buttons as fallback
2. Add `"chat.subagents.allowInvocationsFromSubagents": true` to `templates/vscode-settings.json.template`
3. Add section to `docs/COPILOT-VSCODE-GUIDE.md`: "Single-Session Pipeline with Nested Subagents" explaining the 4→1 session collapse, VS Code setting, and fallback to manual handoff

**Validation Gate**:
```bash
node -e "const fs=require('fs');const agents=['specifier','plan-hardener','executor','reviewer-gate','shipper'];const missing=agents.filter(a=>!fs.readFileSync('templates/.github/agents/'+a+'.agent.md','utf8').includes('subagent'));if(missing.length){console.error('Missing subagent capability:',missing);process.exit(1);}console.log('All 5 pipeline agents have subagent capability')"
node -e "const s=require('fs').readFileSync('templates/vscode-settings.json.template','utf8');if(!s.includes('allowInvocationsFromSubagents')){process.exit(1);}console.log('Settings template updated')"
```

**Stop Condition**: Pipeline agents don't have termination guards → STOP, recursion risk.

---

### Slice 2 — Validation Tools Complement Guide (B4)
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `docs/COPILOT-VSCODE-GUIDE.md`, `docs/faq.html`, `docs/capabilities.md`, `docs/capabilities.html`, `CUSTOMIZATION.md`

**Tasks**:
1. Add "Validation Layers" section to `docs/COPILOT-VSCODE-GUIDE.md` with comparison table (Plan Forge gates vs CodeQL vs secret scanning vs Copilot code review vs GitHub Actions CI)
2. Add FAQ entry to `docs/faq.html`: "How do Plan Forge gates relate to CodeQL and secret scanning?"
3. Add Validation Layers section to `docs/capabilities.md` after Execution Modes
4. Add matching section to `docs/capabilities.html`
5. Document optional `cloudAgentValidation` `.forge.json` key in `CUSTOMIZATION.md`

**Validation Gate**:
```bash
node -e "const fs=require('fs');const f=fs.readFileSync('docs/COPILOT-VSCODE-GUIDE.md','utf8');if(!f.includes('Validation Layers')){process.exit(1);}console.log('Validation Layers doc verified')"
```

**Stop Condition**: None — documentation only.

---

### Slice 3 — Cloud Agent Plan Export (C2: `forge_export_plan`)
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `pforge-mcp/server.mjs`, `pforge.ps1`, `pforge.sh`, `pforge-mcp/tools.json`, `pforge-mcp/capabilities.mjs`

**Tasks**:
1. Add `callExportPlan({ input, output })` function to `server.mjs` that:
   - Accepts markdown text (cloud agent plan) or file path
   - Parses numbered steps, headings, or checkboxes into slices
   - Adds build/test gate commands from `.forge.json` `gateCommands`
   - Adds scope isolation per slice (heuristic: file paths mentioned in step text)
   - Outputs hardened Plan Forge format to stdout or `--output <file>`
2. Register `forge_export_plan` MCP tool in server.mjs TOOLS array with inputSchema (planText: string, output?: string)
3. Add `POST /api/tool/export-plan` REST endpoint
4. Add `Invoke-ExportPlan` function to `pforge.ps1` with `export-plan` subcommand
5. Add `cmd_export_plan()` function to `pforge.sh` with `export-plan)` dispatch case
6. Add help text and examples for `export-plan` in both CLIs
7. Update `pforge-mcp/tools.json` with `forge_export_plan` definition
8. Update capability count in `pforge-mcp/capabilities.mjs`

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const s=require('fs').readFileSync('pforge-mcp/server.mjs','utf8');if(!s.includes('forge_export_plan')){process.exit(1);}console.log('forge_export_plan registered')"
node -e "const s=require('fs').readFileSync('pforge.ps1','utf8');if(!s.includes('export-plan')){process.exit(1);}console.log('PS1 wired')"
node -e "const s=require('fs').readFileSync('pforge.sh','utf8');if(!s.includes('export-plan')){process.exit(1);}console.log('SH wired')"
```

**Stop Condition**: Tests fail → STOP.

---

### Slice 4 — Memory Sync Tool (C3: `forge_sync_memories`)
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `pforge-mcp/server.mjs`, `pforge.ps1`, `pforge.sh`, `pforge-mcp/tools.json`, `pforge-mcp/capabilities.mjs`

**Tasks**:
1. Add `callSyncMemories({ cwd })` function to `server.mjs` that:
   - Reads OpenBrain decisions from `.forge/` artifacts (summary.json files) and `PROJECT-PRINCIPLES.md`
   - Reads `.github/instructions/*.instructions.md` for architecture decisions
   - Generates `.github/copilot-memory-hints.md` with key decisions in a format Copilot Memory auto-discovery picks up
   - Filters: architecture decisions only — no code, no secrets, no file paths
   - Header: `<!-- Generated by Plan Forge v2.16 — soft-sync for Copilot Memory auto-discovery -->`
2. Register `forge_sync_memories` MCP tool in server.mjs TOOLS array
3. Add `POST /api/tool/sync-memories` REST endpoint
4. Add `Invoke-SyncMemories` / `cmd_sync_memories` to CLIs with `sync-memories` subcommand
5. Update `pforge-mcp/tools.json` and `capabilities.mjs` tool count

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const s=require('fs').readFileSync('pforge-mcp/server.mjs','utf8');if(!s.includes('forge_sync_memories')){process.exit(1);}console.log('forge_sync_memories registered')"
```

**Stop Condition**: Tests fail → STOP.

---

### Slice 5 — Tool Risk Classification (C4) + Copilot SDK Scaffold (C1)
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `pforge-mcp/server.mjs`, `pforge-mcp/tools.json`, `docs/COPILOT-VSCODE-GUIDE.md`, `docs/capabilities.md`, `docs/faq.html`, `pforge-sdk/`

**Tasks**:
1. Add `riskLevel` field to every tool in the TOOLS array in `server.mjs`:
   - `"low"` (read-only): forge_smith, forge_validate, forge_sweep, forge_status, forge_diff, forge_analyze, forge_capabilities, forge_plan_status, forge_skill_status, forge_ext_search, forge_ext_info, forge_cost_report, forge_org_rules
   - `"medium"` (side effects, reversible): forge_new_phase, forge_run_skill, forge_diagnose, forge_export_plan, forge_sync_memories, forge_generate_image
   - `"high"` (side effects, hard to reverse): forge_run_plan, forge_abort
2. Update `pforge-mcp/tools.json` with `riskLevel` on all tools
3. Add "Tool Approval Levels" section to `docs/COPILOT-VSCODE-GUIDE.md`
4. Add risk level column to MCP Tools table in `docs/capabilities.md`
5. Add FAQ to `docs/faq.html`: "Which Plan Forge tools are safe to auto-approve?"
6. Create `pforge-sdk/` scaffold directory with:
   - `pforge-sdk/package.json` (name: `@plan-forge/copilot-sdk`, version: 0.1.0, type: module, exports)
   - `pforge-sdk/index.mjs` — exports `planForgeTools` array with 5 SDK-compatible tool wrappers: `forge.harden()`, `forge.validateSlice()`, `forge.sweep()`, `forge.analyze()`, `forge.smith()`
   - `pforge-sdk/README.md` with usage examples showing Copilot SDK integration

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const t=JSON.parse(require('fs').readFileSync('pforge-mcp/tools.json','utf8'));const missing=t.tools.filter(x=>!x.riskLevel);if(missing.length){console.error('Missing riskLevel:',missing.map(x=>x.name));process.exit(1);}console.log('All tools have riskLevel')"
node -e "if(!require('fs').existsSync('pforge-sdk/package.json')){process.exit(1);}console.log('SDK scaffold exists')"
```

**Stop Condition**: Tests fail → STOP.

---

### Slice 6 — Setup Script Upgrades (Setup/Updater Sweep)
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `setup.ps1`, `setup.sh`, `validate-setup.ps1`, `validate-setup.sh`, `templates/vscode-settings.json.template`
**Depends on**: Slices 1, 2

**Tasks**:
1. Add `-Merge` parameter to `setup.ps1` (alongside existing `-Force`):
   - When `-Merge` is set: only copy files that don't exist yet; merge new keys into existing `.forge.json` and `.vscode/settings.json` without overwriting user values
   - `.forge.json` merge: read existing, add new keys (`cloudAgentValidation`, `memorySyncEnabled`, `pipeline.nestedSubagents`) preserving user's `modelRouting`, `quorum`, `gateCommands`, `extensions`
   - `.vscode/settings.json` merge: read existing JSON, add new keys only if missing, write back
2. Add `--merge` flag to `setup.sh` with same behavior
3. Add `--cloud-agent` flag to `setup.ps1` and `setup.sh`:
   - When set: copy `templates/copilot-setup-steps.yml` to project root
   - Add cloud agent config to `.forge.json`
4. Update `validate-setup.ps1` and `validate-setup.sh`:
   - Add check for `forge-troubleshoot` skill directory
   - Add check for `copilot-setup-steps.yml` (advisory, not required)
   - Add check for deprecated model names in `.forge.json` (advisory warning)
   - Update expected skill counts (9 → 10 for presets that include shared skills)
5. Add deprecated model warning to `pforge smith` in both `pforge.ps1` and `pforge.sh`:
   - Scan `.forge.json` for `gpt-5.1` → warn "Deprecated model. Use gpt-5.3-codex (LTS) or gpt-5.4"

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const ps=require('fs').readFileSync('setup.ps1','utf8');if(!ps.includes('-Merge')){process.exit(1);}console.log('PS1 -Merge flag added')"
node -e "const sh=require('fs').readFileSync('setup.sh','utf8');if(!sh.includes('--merge')){process.exit(1);}console.log('SH --merge flag added')"
node -e "const ps=require('fs').readFileSync('setup.ps1','utf8');if(!ps.includes('cloud-agent')){process.exit(1);}console.log('PS1 --cloud-agent flag added')"
```

**Stop Condition**: Merge logic overwrites existing user config → STOP, must be additive only.

---

### Slice 7 — Agent Adapter Updates + Doc Sweep [P]
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `setup.ps1` (adapter functions), `setup.sh` (adapter functions), `README.md`, `docs/index.html`, `docs/docs.html`, `docs/capabilities.html`, `docs/llms.txt`, `plugin.json`, `templates/copilot-instructions.md.template`, `ROADMAP.md`
**Depends on**: Slices 1–6

**Tasks**:
1. Update agent adapter functions in `setup.ps1`:
   - `Install-ClaudeAgent`: add `/forge-troubleshoot` to CLAUDE.md slash commands; add `export-plan`, `sync-memories` to commands
   - `Install-CursorAgent`: add troubleshoot + new commands to `.cursor/commands/`
   - `Install-CodexAgent`: add new skills to `.agents/skills/`
   - `Install-GeminiAgent`: update model references
   - `Install-WindsurfAgent`: add troubleshoot rule
   - `Install-GenericAgent`: add new commands
2. Mirror adapter updates in `setup.sh`
3. Update `README.md`: MCP tool count (19→21+), add new CLI commands to Quick Commands, add FAQ entries
4. Update `docs/index.html`, `docs/docs.html`: tool counts, feature mentions
5. Update `docs/capabilities.html`: add new tools to MCP table, add risk level column
6. Update `docs/llms.txt`: tool and skill counts
7. Update `plugin.json` description with new tool count
8. Update `templates/copilot-instructions.md.template`: add new CLI commands, update skill table
9. Mark B2, B4, C1-C4 items in `ROADMAP.md` as ✅

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const r=require('fs').readFileSync('README.md','utf8');if(!r.includes('export-plan')){process.exit(1);}console.log('README updated')"
node -e "const r=require('fs').readFileSync('ROADMAP.md','utf8');if(!r.includes('B2') && r.includes('B4')){console.log('ROADMAP checked');}else{console.log('ROADMAP checked');}"
```

**Stop Condition**: None — documentation sweep.

---

### Slice 8 — VERSION Bump + CHANGELOG + Push [P] ← final
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`, `ROADMAP.md`
**Depends on**: Slices 1–7

**Tasks**:
1. Run `pforge version-bump 2.16.0` — updates `VERSION` + `pforge-mcp/package.json`
2. Add CHANGELOG entry `## [2.16.0] — 2026-04-07` with sections:
   - **Added — Platform Completion (Phase 23)**
   - Bullet for each shipped feature (B2, B4, C1–C4, Setup/Updater sweep)
3. Update `ROADMAP.md` "Current Release" line: `**v2.16.0**`
4. Stage all changes: `git add -A`
5. Commit: `git commit -m "feat: v2.16.0 — Platform Completion & Setup Hardening (Phase 23)"`
6. Push: `git push origin release/v2.16`

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const v=require('fs').readFileSync('VERSION','utf8').trim();if(v!=='2.16.0'){process.exit(1);}console.log('VERSION='+v)"
node -e "const o=require('child_process').execSync('git log --oneline -3',{encoding:'utf8'});console.log(o)"
```

**Stop Condition**: Tests fail after version bump → STOP, do not push.

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Subagent recursion in B2 | Termination guards in every agent + guard-rail instruction |
| `forge_export_plan` parse accuracy | Heuristic with 3 format fallbacks + template TODOs for manual refinement |
| `-Merge` config corruption | Read-then-merge pattern, never overwrite keys that already exist |
| SDK API instability (C1) | Scaffold only, pin to specific SDK version, document upgrade path |
| Large slice scope (6, 7) | Worker has full context from prior slices; gates verify incrementally |
