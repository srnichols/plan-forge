# Phase 22: Copilot Platform Integration — v2.15

> **Status**: 🟡 HARDENED — Ready for execution  
> **Branch**: `release/v2.15`  
> **Estimated Effort**: 3–4 days (8 execution slices)  
> **Risk Level**: Low–Medium (mostly additive: docs, templates, new CLI command, new skill)  
> **Quorum Mode**: auto (default — complex slices get multi-model consensus)

---

## Overview

Leverage new Copilot platform capabilities (VS Code 1.113–1.114, Copilot cloud agent, Org Custom Instructions GA, Copilot SDK public preview) to make Plan Forge a first-class citizen of the native Copilot ecosystem. The 8 slices map directly to ROADMAP.md Phase A + B items and are ordered lowest-effort → highest-impact.

---

## Prerequisites

- [x] `release/v2.15` branch created from `master`
- [x] Quorum mode default changed to `auto` (quorum fix committed)
- [x] VERSION = `2.14.0` (bump to `2.15.0` at Slice 8)
- [x] 91/91 tests passing (`npm test` in `pforge-mcp/`)
- [ ] `pforge smith` clean on this workstation
- [ ] VS Code 1.113+ installed

## Scope Contract

### In Scope
- A1: One-click plugin install link on website (HTML + AGENT-SETUP.md)
- A2: Model deprecation sweep (orchestrator, tools, docs)
- A3: Cloud agent integration guide + `copilot-setup-steps.yml` template
- A4: Copilot Memory coexistence documentation
- B1: `pforge org-rules export` CLI command + `forge_org_rules` MCP tool
- B3: `/forge-troubleshoot` skill (` presets/shared/skills/forge-troubleshoot/`)
- VERSION bump to `2.15.0`
- CHANGELOG entry for v2.15.0

### Out of Scope
- A3 `--cloud-agent` flag in `setup.ps1`/`setup.sh` (deferred — separate slice)
- B2 Nested subagent pipeline (requires VS Code API research spike — v2.16)
- B4 Validation Tools Complement Guide (documentation sprint — v2.16)
- C1 Copilot SDK Tool Provider (multi-week effort — v3.x)
- C2 Cloud Agent Plan Export (research spike needed — v3.x)
- Any changes to `pforge-mcp/tests/` unless a new export function needs a unit test

### Forbidden Actions
- Do NOT modify `pforge-mcp/orchestrator.mjs` (frozen in this release — only quorum default shipped)
- Do NOT rename or restructure `presets/shared/skills/` directories that already exist
- Do NOT modify `CHANGELOG.md` until Slice 8

---

## Execution Slices

### Slice 1 — One-Click Plugin Install Links (A1)
**Build command**: `node pforge-mcp/orchestrator.mjs --dry-run docs/plans/Phase-22-COPILOT-PLATFORM-v2.15-PLAN.md`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `docs/index.html`, `docs/docs.html`, `docs/capabilities.html`, `AGENT-SETUP.md`, `README.md`, `docs/QUICKSTART-WALKTHROUGH.md`

**Tasks**:
1. Add VS Code stable install button to `docs/index.html` hero CTA section:
   ```html
   <a href="vscode://chat-plugin/install?source=srnichols/plan-forge" class="btn btn-primary">Install in VS Code</a>
   <a href="vscode-insiders://chat-plugin/install?source=srnichols/plan-forge" class="btn btn-secondary">Install in VS Code Insiders</a>
   ```
2. Add same install buttons to `docs/docs.html` next to the "VS Code Plugin" card
3. Add brief mention to `docs/capabilities.html` setup instructions
4. Update `AGENT-SETUP.md` Quick Start — add URL handler as first option, keep existing manual steps as fallback with note "VS Code < 1.113"
5. Update `README.md` Quick Start section — add one-click install as preferred option
6. Update `docs/QUICKSTART-WALKTHROUGH.md` — step 1 is now the install link

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const f=require('fs'),files=['docs/index.html','docs/docs.html','AGENT-SETUP.md','README.md'];files.forEach(p=>{if(!f.readFileSync(p,'utf8').includes('vscode://chat-plugin')){console.error('Missing install link in '+p);process.exit(1);}});console.log('Install links verified in all 4 files')"
```

**Stop Condition**: If node check exits non-zero (install link missing from a file) → STOP, fix before proceeding.

---

### Slice 2 — Model Deprecation Sweep (A2)
**Build command**: `node pforge-mcp/orchestrator.mjs --dry-run docs/plans/Phase-22-COPILOT-PLATFORM-v2.15-PLAN.md`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `pforge-mcp/server.mjs`, `README.md`, `CUSTOMIZATION.md`, `docs/capabilities.md`, `docs/capabilities.html`, `docs/faq.html`, `templates/copilot-instructions.md.template`

**Tasks**:
1. Audit `pforge-mcp/server.mjs` for deprecated model names in the MODEL_PRICING / escalation defaults — remove `gpt-5.1`, confirm `gpt-5.3-codex` (LTS), `gpt-5.4`, `gpt-5.4-mini` are present
2. Update `README.md` "Model Routing" section — replace any `gpt-5.1` references, update escalation chain example
3. Update `CUSTOMIZATION.md` `.forge.json` model routing examples
4. Update `docs/capabilities.md` escalation chain example and default model column
5. Update `docs/capabilities.html` same table (rendered version)
6. Update `docs/faq.html` model routing answer
7. Update `templates/copilot-instructions.md.template` MCP server comment model names

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const f=require('fs'),files=['docs/capabilities.md','README.md','CUSTOMIZATION.md','templates/copilot-instructions.md.template'];files.forEach(p=>{const t=f.existsSync(p)?f.readFileSync(p,'utf8'):'';const m=t.match(/gpt-5\.1[^0-9]/g);if(m){console.error('Deprecated model ref in '+p+': '+m);process.exit(1);}});console.log('No gpt-5.1 refs found')"
```

**Stop Condition**: Any `gpt-5.1` reference found after sweep → STOP, fix before proceeding.

---

### Slice 3 — Cloud Agent Integration Guide (A3)
**Build command**: `node pforge-mcp/orchestrator.mjs --dry-run docs/plans/Phase-22-COPILOT-PLATFORM-v2.15-PLAN.md`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `templates/copilot-setup-steps.yml` (new), `docs/COPILOT-VSCODE-GUIDE.md`, `README.md`, `AGENT-SETUP.md`, `docs/index.html`, `docs/capabilities.md`, `docs/capabilities.html`, `docs/faq.html`

**Tasks**:
1. Create `templates/copilot-setup-steps.yml` with:
   - Node.js install step
   - `setup.ps1` / `setup.sh` execution step
   - `.vscode/mcp.json` config step
   - `pforge smith` post-setup validation step
   - Header comment: `# Plan Forge cloud agent setup — add to .github/copilot-setup-steps.yml`
2. Add section "Using Plan Forge with Copilot Cloud Agent" to `docs/COPILOT-VSCODE-GUIDE.md`:
   - How `copilot-setup-steps.yml` works
   - How instruction files auto-load in cloud agent
   - How Plan Forge gates complement CodeQL / secret-scanning
   - Positioning quote: "Copilot cloud agent plans. Plan Forge hardens."
3. Update `README.md` — add cloud agent mention to Quick Start, add FAQ entry
4. Update `AGENT-SETUP.md` — add cloud agent setup alongside local VS Code
5. Update `docs/index.html` hero — add "Cloud Agent Ready" feature bullet
6. Update `docs/capabilities.md` + `docs/capabilities.html` — add cloud agent to Execution Modes table
7. Update `docs/faq.html` — new FAQ "How does Plan Forge work with Copilot cloud agent?"

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const f=require('fs');if(!f.existsSync('templates/copilot-setup-steps.yml')){console.error('Missing: templates/copilot-setup-steps.yml');process.exit(1);}const files=['docs/COPILOT-VSCODE-GUIDE.md','AGENT-SETUP.md','README.md'];files.forEach(p=>{if(!f.readFileSync(p,'utf8').includes('copilot-setup-steps')){console.error('Missing cloud agent ref in '+p);process.exit(1);}});console.log('Template and docs verified')"
```

**Stop Condition**: Template file missing → STOP.

---

### Slice 4 — Copilot Memory Coexistence Docs (A4)
**Build command**: `node pforge-mcp/orchestrator.mjs --dry-run docs/plans/Phase-22-COPILOT-PLATFORM-v2.15-PLAN.md`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `docs/COPILOT-VSCODE-GUIDE.md`, `README.md`, `docs/faq.html`, `docs/capabilities.md`, `docs/capabilities.html`

**Tasks**:
1. Add "Memory Layers" section to `docs/COPILOT-VSCODE-GUIDE.md` with the 3-layer comparison table (Copilot Memory vs Plan Forge Session Memory vs OpenBrain)
2. Add FAQ entry to `README.md`: "How does Plan Forge relate to Copilot Memory?"
3. Add FAQ to `docs/faq.html`: "What's the difference between Copilot Memory and Plan Forge?"
4. Add Memory Layers section to `docs/capabilities.md`
5. Add same to `docs/capabilities.html` (rendered version)

**Table to include** (exact format):

| Feature | Copilot Memory | Plan Forge Run Memory | OpenBrain |
|---------|---------------|----------------------|-----------|
| Scope | Repo | Session / Run | Cross-project |
| Persistence | 28 days (auto-expire) | Per-run (`.forge/runs/`) | Permanent |
| Content | Auto-discovered conventions | Slice results, gate outcomes, cost | Architecture decisions, lessons learned |
| Discovery | Automatic (GitHub infra) | Explicit (run artifacts) | Semantic search |
| Sharing | Coding agent + code review + CLI | Dashboard + MCP tools | Any integrated tool |

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const f=require('fs'),files=['docs/COPILOT-VSCODE-GUIDE.md','docs/faq.html','README.md'];files.forEach(p=>{const t=f.readFileSync(p,'utf8');if(!t.includes('Memory Layers')&&!t.includes('Copilot Memory')){console.error('Missing memory section in '+p);process.exit(1);}});console.log('Memory layers docs verified')"
```

**Stop Condition**: Less than 3 files updated → STOP.

---

### Slice 5 — `forge_org_rules` MCP Tool + CLI Command (B1) [P]
**Build command**: `node pforge-mcp/server.mjs &; sleep 2; kill %1`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `pforge-mcp/server.mjs`, `pforge.ps1`, `pforge.sh`, `pforge-mcp/tools.json`  
**Depends on**: none (parallelizable with Slice 6)

**Tasks**:
1. Add `forge_org_rules` handler to `pforge-mcp/server.mjs`:
   - Input: `{ format: "github" | "markdown" | "json", output?: string }`
   - Logic: read all `.github/instructions/*.instructions.md`, `copilot-instructions.md`, `PROJECT-PRINCIPLES.md` (if exists), consolidate into single block, strip `applyTo` frontmatter, add header `# Generated by Plan Forge v2.15 from repo: <repo-name>`, respect `format` param
   - Return: `{ content, format, sourceFiles, charCount }`
2. Register as MCP tool under name `forge_org_rules`
3. Add REST handler: `POST /api/tool/org-rules`
4. Add `org-rules` subcommand to `pforge.ps1` — calls `node pforge-mcp/server.mjs` via HTTP POST or directly invokes the consolidation logic
5. Add `org-rules` subcommand to `pforge.sh` — same approach

**Validation Gate**:
```bash
npm test --prefix pforge-mcp       # 91 tests pass
node -e "import('./pforge-mcp/server.mjs').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"   # server starts without error
```

**Stop Condition**: Server fails to start → STOP, fix import/syntax error first.

---

### Slice 6 — `/forge-troubleshoot` Skill (B3) [P]
**Build command**: `node pforge-mcp/orchestrator.mjs --dry-run docs/plans/Phase-22-COPILOT-PLATFORM-v2.15-PLAN.md`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `presets/shared/skills/forge-troubleshoot/` (new), `docs/COPILOT-VSCODE-GUIDE.md`, `README.md`, `docs/capabilities.md`, `docs/capabilities.html`, `templates/copilot-instructions.md.template`  
**Depends on**: none (parallelizable with Slice 5)

**Tasks**:
1. Create `presets/shared/skills/forge-troubleshoot/SKILL.md` with:
   - Detection triggers: "why didn't copilot follow", "instructions ignored", "guardrail bypass", "instructions not loading"
   - Step 1: Run `pforge smith` — verify instruction files installed
   - Step 2: Check `.vscode/settings.json` for `instructions` / `customInstructions` config
   - Step 3: Suggest VS Code `/troubleshoot #session` on problematic session
   - Step 4: Common failure checklist (applyTo mismatch, wrong directory, file too large, settings override)
   - Step 5: If OpenBrain available → search past issues
2. Add `/forge-troubleshoot` entry to skill slash commands table in `templates/copilot-instructions.md.template`
3. Add troubleshooting section to `docs/COPILOT-VSCODE-GUIDE.md`
4. Update `README.md` skill count and slash commands table
5. Update `docs/capabilities.md` + `docs/capabilities.html` — add skill to table, update count

**Validation Gate**:
```bash
npm test --prefix pforge-mcp
node -e "const f=require('fs');if(!f.existsSync('presets/shared/skills/forge-troubleshoot/SKILL.md')){console.error('Missing SKILL.md');process.exit(1);}const files=['templates/copilot-instructions.md.template','README.md'];files.forEach(p=>{if(!f.readFileSync(p,'utf8').includes('forge-troubleshoot')){console.error('Missing skill ref in '+p);process.exit(1);}});console.log('Skill and refs verified')"
```

**Stop Condition**: SKILL.md missing → STOP.

---

### Slice 7 — Doc + AI Discovery Sweep (all features)
**Build command**: `node pforge-mcp/orchestrator.mjs --dry-run docs/plans/Phase-22-COPILOT-PLATFORM-v2.15-PLAN.md`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `docs/llms.txt`, `docs/index.html`, `plugin.json`, `docs/docs.html`, `templates/copilot-instructions.md.template`  
**Depends on**: Slices 1–6

**Tasks**:
1. `docs/llms.txt` — update: add cloud agent execution environment, add install URL, update MCP tool count (if forge_org_rules added), update skill count
2. `docs/index.html` — update feature counts (MCP tools, skills), add "Cloud Agent Ready" to feature list, add install buttons if not already present from Slice 1
3. `plugin.json` — update `description` with new tool and skill counts
4. `docs/docs.html` — update MCP tool count reference, add `copilot-setup-steps.yml` to setup resources
5. `templates/copilot-instructions.md.template` — update Quick Commands to include `pforge org-rules export`, update skill count, ensure cloud agent section is present

**Validation Gate**:
```bash
npm test --prefix pforge-mcp       # 91 tests pass
node -e "const p = JSON.parse(require('fs').readFileSync('plugin.json','utf8')); if (!p.name) process.exit(1)"   # valid JSON
```

**Stop Condition**: `plugin.json` invalid JSON → STOP.

---

### Slice 8 — VERSION Bump + CHANGELOG + Push [P] ← final
**Build command**: `npm test --prefix pforge-mcp`  
**Test command**: `npm test --prefix pforge-mcp`  
**Scope**: `VERSION`, `pforge-mcp/package.json`, `CHANGELOG.md`, `ROADMAP.md`  
**Depends on**: Slices 1–7

**Tasks**:
1. Run `pforge version-bump 2.15.0` — updates `VERSION` + `pforge-mcp/package.json`
2. Add CHANGELOG entry `## [2.15.0] — 2026-04-07` with sections:
   - **Added — Copilot Platform Integration (Phase 22)**
   - Bullet for each shipped feature (A1–A4, B1, B3, quorum=auto default)
3. Update `ROADMAP.md` "Current Release" line: `**v2.15.0**`
4. Mark Phase A items A1–A4 and Phase B item B3 as ✅ in ROADMAP.md
5. Stage all changes: `git add -A`
6. Commit: `git commit -m "feat: v2.15.0 — Copilot Platform Integration (Phase 22)"`
7. Push: `git push origin release/v2.15`
8. Open PR: `release/v2.15 → master` titled `feat: v2.15.0 — Copilot Platform Integration`

**Validation Gate**:
```bash
npm test --prefix pforge-mcp       # 91 tests pass
node -e "const v=require('fs').readFileSync('VERSION','utf8').trim();if(v!=='2.15.0'){process.exit(1);}console.log('VERSION='+v)"
node -e "const o=require('child_process').execSync('git log --oneline -3',{encoding:'utf8'});console.log(o)"
```

**Stop Condition**: Tests fail after version bump → STOP, do not push.

---

## Acceptance Criteria

- [ ] One-click VS Code install links live on website (index.html, docs.html, AGENT-SETUP.md)
- [ ] Zero `gpt-5.1` references in docs/source after model deprecation sweep
- [ ] `templates/copilot-setup-steps.yml` exists with valid YAML
- [ ] Memory Layers comparison table in COPILOT-VSCODE-GUIDE.md
- [ ] `forge_org_rules` MCP tool registered and responding (server starts clean)
- [ ] `pforge org-rules export` CLI command works (ps1 + sh)
- [ ] `presets/shared/skills/forge-troubleshoot/SKILL.md` exists with all 5 detection steps
- [ ] `quorum=auto` is the default in orchestrator + server + CLI (already committed)
- [ ] VERSION = `2.15.0`, CHANGELOG entry present
- [ ] 91 tests still passing after all slices

---

## Post-Execution Checklist

- [ ] Run `pforge smith` — all green
- [ ] Run `pforge analyze docs/plans/Phase-22-COPILOT-PLATFORM-v2.15-PLAN.md` — score ≥ 70
- [ ] Run `pforge sweep` — zero TODOs/stubs
- [ ] PR opened: `release/v2.15 → master`
- [ ] Tag: `v2.15.0-plans` (squash merge, then tag before plan file removal)
- [ ] Update session memory: record v2.15 completion in `/memories/repo/v2-architecture-notes.md`
