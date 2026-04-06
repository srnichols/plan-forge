# Phase 17: v2.11 Quick Wins — Windsurf Adapter + Generic Agent + Swift Preset

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 3 hours (4 execution slices)  
> **Risk Level**: Low (follows established adapter patterns)  
> **Branch**: `feature/v2.11-quick-wins`  
> **Quorum**: Auto

---

## Overview

Add Windsurf IDE adapter, generic bring-your-own-agent pattern, and Swift/iOS preset. These expand Plan Forge from 5 agents to 7 and from 7 stacks to 8.

---

## Acceptance Criteria

- **MUST**: `-Agent windsurf` generates `.windsurf/rules/` with trigger frontmatter + `.windsurf/workflows/` commands
- **MUST**: `-Agent generic` with `-GenericDir` generates commands in user-specified directory
- **MUST**: `-Agent all` includes windsurf and generic (7 agents total)
- **MUST**: `presets/swift/` exists with AGENTS.md, agents, instructions, prompts, skills (49+ files)
- **MUST**: `Cargo.toml` → rust, `Package.swift` → swift auto-detection in setup scripts
- **SHOULD**: Windsurf rules use proper frontmatter: `trigger: glob` for instruction files, `trigger: always_on` for architecture
- **SHOULD**: Generic agent generates a README explaining the directory structure
- **MUST**: All scripts pass syntax checks (PS1 + Bash)

---

## Scope Contract

### In Scope
- `setup.ps1` — add `Install-WindsurfAgent`, `Install-GenericAgent` functions; wire into switch; add swift to `Find-Preset`
- `setup.sh` — mirror Windsurf + Generic adapters; add swift detection
- `presets/swift/` — full preset (copy from Go, customize for Swift/SwiftUI/Vapor)
- `presets/swift/.github/skills/security-audit/SKILL.md` — Swift-specific security audit
- `CHANGELOG.md` — v2.11.0 entry
- `VERSION` — bump to 2.11.0
- `pforge-mcp/package.json` — version bump
- `README.md` — update agent count references
- `ROADMAP.md` — mark windsurf, generic, swift as shipped

### Out of Scope
- MCP server changes
- Dashboard changes
- pforge.ps1/pforge.sh command changes
- Existing adapter modifications

### Forbidden Actions
- Do NOT modify existing adapter functions (Claude, Cursor, Codex, Gemini)
- Do NOT modify pforge-mcp/server.mjs or orchestrator.mjs

---

## Execution Slices

### Slice 1: Windsurf Adapter (setup.ps1 + setup.sh) [sequential]

**Goal**: Add `-Agent windsurf` that generates `.windsurf/rules/*.md` (with trigger frontmatter) and `.windsurf/workflows/*.md` commands.

**Tasks**:
1. Add `Install-WindsurfAgent` function to setup.ps1:
   - Generate `.windsurf/rules/planforge-guardrails.md` with `trigger: always_on` containing copilot-instructions + architecture principles
   - Generate per-domain rules: `.windsurf/rules/planforge-{domain}.md` with `trigger: glob` and appropriate `globs:` patterns (e.g. `**/*.sql` for database, `**/*.test.*` for testing)
   - Convert prompts → `.windsurf/workflows/planforge.{name}.md`
   - Convert agents → `.windsurf/workflows/planforge.{name}.md`
2. Mirror in setup.sh as `install_windsurf_agent`
3. Wire `'windsurf'` into ValidateSet, all expansion, and switch in both scripts
4. Add `.windsurf/` to .gitignore

**Build Command**: `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('setup.ps1',[ref]$null,[ref]$null)|Out-Null; 'PASS'"` and `bash -n setup.sh && echo PASS`
**Test Command**: `echo PASS`

**Depends On**: None

---

### Slice 2: Generic Agent Adapter [sequential]

**Goal**: Add `-Agent generic` with `-GenericDir <path>` that generates commands in any user-specified directory.

**Tasks**:
1. Add `Install-GenericAgent` function to setup.ps1:
   - Accept target directory (from new `-GenericDir` parameter or default `.ai-agent/`)
   - Generate `{dir}/context.md` — project instructions + guardrails (like CLAUDE.md but generic)
   - Convert prompts → `{dir}/commands/{name}.md`
   - Convert agents → `{dir}/commands/{name}.md`
   - Generate `{dir}/README.md` explaining directory structure
2. Add `-GenericDir` parameter to setup.ps1 param block
3. Mirror in setup.sh with `--generic-dir` flag
4. Wire into ValidateSet and switch

**Build Command**: `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('setup.ps1',[ref]$null,[ref]$null)|Out-Null; 'PASS'"` and `bash -n setup.sh && echo PASS`
**Test Command**: `echo PASS`

**Depends On**: None (parallel-safe with Slice 1 — different functions)

---

### Slice 3: Swift/iOS Preset [parallel-safe, Group A]

**Goal**: Create `presets/swift/` with full stack-specific content for Swift/SwiftUI/Vapor projects.

**Tasks**:
1. Copy `presets/go/` as base for `presets/swift/`
2. Bulk replace Go terms with Swift equivalents (go build→swift build, go test→swift test, etc.)
3. Customize AGENTS.md with Swift patterns (actors, async/await, SwiftUI views, Vapor controllers)
4. Customize security-audit skill for Swift (use `swift package audit`, check for force-unwraps, check ATS exceptions)
5. Add `Package.swift` auto-detection to `Find-Preset` in setup.ps1 and `detect_preset` in setup.sh

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if (Test-Path 'presets/swift/AGENTS.md') { 'PASS' } else { 'FAIL' }"`

**Depends On**: None (parallel-safe — different directory)

---

### Slice 4: Version Bump + Changelog + README + Roadmap [sequential]

**Goal**: Update version to 2.11.0 and document all new features.

**Tasks**:
1. Bump `VERSION` to 2.11.0
2. Bump `pforge-mcp/package.json` version to 2.11.0
3. Add CHANGELOG.md entry for v2.11.0
4. Update README.md agent count references (5→7 agents, 7→8 stacks)
5. Update ROADMAP.md: mark Windsurf, Generic, Swift as shipped in backlog

**Build Command**: `echo PASS`
**Test Command**: `pwsh -NoProfile -Command "if ((Get-Content VERSION -Raw).Trim() -eq '2.11.0') { 'PASS' } else { 'FAIL' }"`

**Depends On**: Slices 1, 2, 3

---

## Definition of Done

- [ ] `-Agent windsurf` generates proper `.windsurf/rules/` + `.windsurf/workflows/`
- [ ] `-Agent generic` generates commands in user-specified directory
- [ ] `-Agent all` includes windsurf and generic (7 agents)
- [ ] `presets/swift/` has 49+ files
- [ ] `Package.swift` auto-detected
- [ ] VERSION = 2.11.0
- [ ] All scripts pass syntax checks
- [ ] Reviewer Gate passed (zero 🔴 Critical)

---

## Stop Conditions

- ❌ Build failure in setup scripts
- ❌ Existing adapter functions modified
- ❌ MCP server code modified
