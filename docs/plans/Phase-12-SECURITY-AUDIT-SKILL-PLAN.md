# Phase 12: `/security-audit` Skill — Multi-Step Security Procedure

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 4 hours (4 execution slices)  
> **Risk Level**: Low (new files only, no existing file modifications except registrations)  
> **Branch**: `feature/security-audit-skill`  
> **Quorum**: Auto

---

## Overview

Add a `/security-audit` skill to every preset that orchestrates a comprehensive security review: OWASP vulnerability scan across all source files, dependency audit, secrets detection, and a combined severity-rated report. This is the enterprise-grade security procedure referenced in the roadmap backlog.

---

## Prerequisites

- [x] Master clean at current HEAD
- [x] Security-reviewer agent exists in all 5 stack presets
- [x] Dependency-audit skill exists in TypeScript, Python, .NET, Go, Java presets
- [x] Forge skills infrastructure (SKILL.md format) established

## Acceptance Criteria

- [ ] `/security-audit` SKILL.md exists in all 5 stack presets + shared
- [ ] Skill orchestrates 3 phases: OWASP scan, dependency audit, secrets scan
- [ ] Combined report format with CRITICAL/HIGH/MEDIUM/LOW severity ratings
- [ ] Secrets scan detects API keys, tokens, connection strings, private keys in source
- [ ] Each preset's skill uses stack-appropriate tooling (npm audit / pip audit / dotnet list / go vuln / mvn dependency-check)
- [ ] Smith diagnostics updated to detect and report installed security skills
- [ ] Testable on plan-forge-testbed Tracker app
- [ ] Claude/Cursor/Codex adapter generation includes the new skill

---

## Scope Contract

### In Scope
- `presets/shared/.github/skills/security-audit/SKILL.md` — shared base skill
- `presets/typescript/.github/skills/security-audit/SKILL.md` — TypeScript/Node.js variant
- `presets/python/.github/skills/security-audit/SKILL.md` — Python variant
- `presets/dotnet/.github/skills/security-audit/SKILL.md` — .NET variant
- `presets/go/.github/skills/security-audit/SKILL.md` — Go variant
- `presets/java/.github/skills/security-audit/SKILL.md` — Java variant
- `setup.ps1` — register skill in adapter generation (Claude/Cursor/Codex)
- `setup.sh` — same for bash
- `docs/copilot-instructions.md.template` — add skill to quick commands table
- `CHANGELOG.md` — entry for this feature

### Out of Scope
- MCP server changes (no new MCP tools)
- Dashboard changes
- New agents (reuses existing security-reviewer agent)
- CI/CD integration (future)

### Forbidden Actions
- Do NOT modify existing security-reviewer agent definitions
- Do NOT modify existing dependency-audit skill definitions
- Do NOT change MCP server code (server.mjs, orchestrator.mjs)
- Do NOT modify pforge.ps1/pforge.sh (smith already checks skills)

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Secrets detection approach | ✅ Resolved | Regex-based pattern matching in SKILL.md steps (no external tool dependency). Patterns: AWS keys, Azure keys, GitHub tokens, JWT secrets, private keys, connection strings |
| 2 | Report format | ✅ Resolved | Structured markdown table matching existing agent output format. Sections: OWASP Findings, Dependency Vulnerabilities, Secrets Exposure, Summary |
| 3 | Shared vs stack-specific | ✅ Resolved | Shared base with stack-specific overrides. Shared handles secrets scan + report format. Stack-specific handles OWASP checklist items + dependency tooling |

---

## Execution Slices

### Slice 1: Shared Security Audit Skill (Base) [sequential]

**Goal**: Create the shared `/security-audit` SKILL.md that defines the 3-phase procedure and report format.

**Tasks**:
1. Create `presets/shared/.github/skills/security-audit/SKILL.md`
   - YAML frontmatter: name, description, argument-hint, tools (forge_sweep, run_in_terminal, read_file)
   - Phase 1: Invoke security-reviewer agent patterns (OWASP checklist)
   - Phase 2: Run dependency audit (delegates to stack-specific tooling)
   - Phase 3: Secrets scan — regex patterns for 10+ secret types
   - Phase 4: Combined report generation with severity aggregation
   - Safety rules, persistent memory section

**Context Files**:
- `presets/shared/skills/health-check/SKILL.md` (format reference)
- `presets/shared/skills/forge-execute/SKILL.md` (format reference)
- `presets/typescript/.github/agents/security-reviewer.agent.md` (OWASP checklist reference)
- `presets/typescript/.github/skills/dependency-audit/SKILL.md` (dependency audit reference)

**Validation Gate**:
- File exists and has valid YAML frontmatter
- Contains all 4 phases (OWASP, Dependencies, Secrets, Report)
- Contains at least 10 secret detection patterns

**Depends On**: None

---

### Slice 2: Stack-Specific Security Audit Skills [parallel-safe, Group A]

**Goal**: Create stack-specific variants for all 5 presets.

**Tasks**:
1. Create `presets/typescript/.github/skills/security-audit/SKILL.md` — npm audit, Node.js-specific OWASP (eval, prototype pollution, XSS)
2. Create `presets/python/.github/skills/security-audit/SKILL.md` — pip audit / safety, Python-specific (pickle, exec, SQL injection)
3. Create `presets/dotnet/.github/skills/security-audit/SKILL.md` — dotnet list --vulnerable, .NET-specific (SQL injection, CSRF, secrets in appsettings)
4. Create `presets/go/.github/skills/security-audit/SKILL.md` — govulncheck, Go-specific (race conditions, unsafe package)
5. Create `presets/java/.github/skills/security-audit/SKILL.md` — mvn dependency-check:check, Java-specific (deserialization, JNDI injection)

**Context Files**:
- `presets/shared/.github/skills/security-audit/SKILL.md` (base reference from Slice 1)
- Each preset's existing `dependency-audit/SKILL.md` (tooling reference)
- Each preset's existing `security-reviewer.agent.md` (OWASP reference)

**Validation Gate**:
- All 5 files exist with valid YAML frontmatter
- Each references the correct stack tooling (npm/pip/dotnet/go/mvn)
- Each includes stack-specific vulnerability patterns

**Depends On**: Slice 1

---

### Slice 3: Setup Script Registration [sequential]

**Goal**: Update setup.ps1 and setup.sh so the new skill is included in Claude/Cursor/Codex adapter generation and in the copilot-instructions template.

**Tasks**:
1. In `setup.ps1`: Add `security-audit` to the skills list that gets converted for each adapter
2. In `setup.sh`: Same changes mirrored in bash
3. In `templates/copilot-instructions.md.template`: Add `/security-audit` to the skill slash commands table

**Context Files**:
- `setup.ps1` (Install-ClaudeAgent, Install-CursorAgent, Install-CodexAgent functions)
- `setup.sh` (corresponding functions)
- `templates/copilot-instructions.md.template`
- `.github/copilot-instructions.md` (reference for table format)

**Validation Gate**:
- `pwsh -c "[System.Management.Automation.Language.Parser]::ParseFile('setup.ps1', [ref]\$null, [ref]\$null)"` — PS syntax clean
- `bash -n setup.sh` — bash syntax clean
- Grep confirms "security-audit" appears in all 3 adapter functions (claude, cursor, codex) in setup.ps1
- Grep confirms "security-audit" appears in copilot-instructions template

**Depends On**: Slice 1

---

### Slice 4: Changelog + Testbed Verification [sequential]

**Goal**: Update CHANGELOG.md and verify the skill works on the plan-forge-testbed Tracker app.

**Tasks**:
1. Add entry to CHANGELOG.md under a new section (or append to 2.9.0)
2. Test the skill by reading the shared SKILL.md and manually walking through its steps against the testbed repo's Tracker app code patterns
3. Verify secrets scan patterns detect intentional test patterns (if any)

**Context Files**:
- `CHANGELOG.md`
- `presets/shared/.github/skills/security-audit/SKILL.md`

**Validation Gate**:
- CHANGELOG.md has security-audit entry
- SKILL.md steps are coherent and actionable when read against a real codebase

**Depends On**: Slices 1, 2, 3

---

## Re-Anchor Checkpoints

- After Slice 2: Verify all 5 stack skills + shared base total 6 files
- After Slice 4: Full re-anchor — scope contract, acceptance criteria, stop conditions

---

## Definition of Done

- [ ] 6 SKILL.md files created (1 shared + 5 stack-specific)
- [ ] Setup scripts register the skill for all 3 external agents
- [ ] Copilot-instructions template includes the skill
- [ ] CHANGELOG.md updated
- [ ] All validation gates passed
- [ ] Reviewer Gate passed (zero 🔴 Critical)

---

## Stop Conditions

- ❌ Build failure in setup scripts (syntax error)
- ❌ Existing skills/agents modified (scope violation)
- ❌ MCP server code modified (scope violation)
- ❌ Security vulnerability introduced (ironic but must check)
