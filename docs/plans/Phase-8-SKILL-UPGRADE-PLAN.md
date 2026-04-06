# Phase 8: Skill Slash Command Upgrade — MCP-Integrated Executable Skills

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md) → Phase 8  
> **Status**: ✅ Complete  
> **Version**: v2.6.0  
> **Feature Branch**: `feature/skill-slash-command-upgrade`  
> **Pipeline**: Step 0 ✅ → Step 1 ✅ → Step 2 ✅ → Step 3 ✅ → Step 4 ✅ → Step 5 ✅  
> **Depends On**: v2.5 (quorum mode), v2.4 (telemetry), v2.0 (orchestrator, MCP server)

---

## Specification (Step 0)

### Problem Statement

The 8 app-preset skills and 3 azure-iac skills were written as static markdown playbooks before the MCP server existed. They describe steps for Copilot to interpret ad-hoc but have no programmatic enforcement of validation gates, no progress tracking, no integration with the orchestrator, and no structured output. Meanwhile, the pforge-mcp system has grown to include DAG execution, WebSocket broadcasting, OTLP telemetry, cost tracking, and OpenBrain memory — none of which the skills leverage.

The result: skills operate at "Layer 0" (markdown instructions) when the system supports "Layer 3" (orchestrated execution with observability). Users get no progress feedback, no cost tracking, no structured reports, and no inter-step gate enforcement when using slash commands.

### User Scenarios

1. **Developer runs `/test-sweep`** → expects structured pass/fail report, wants `forge_sweep` scan included automatically, wants results visible in dashboard
2. **Developer runs `/code-review`** → expects `forge_analyze` + `forge_diff` to provide structured findings alongside the agent-driven review
3. **Developer runs `/staging-deploy`** → expects pre-flight validation via `forge_validate`, progress events in the hub, rollback guidance if health check fails
4. **Developer runs `/database-migration`** → expects memory search for prior migration patterns, gate between generate and apply steps
5. **Developer runs `/health-check`** (new) → expects `forge_smith` + `forge_validate` + `forge_sweep` in a structured diagnostic pipeline
6. **Developer runs `/forge-execute`** (new) → guided wrapper around `forge_run_plan` with plan selection, mode choice, cost estimate, and confirmation
7. **Team lead monitors dashboard** → sees skill executions alongside plan executions in the event stream

### Acceptance Criteria

#### Tier 1 — MCP Tool Integration & Skill Modernization
- **MUST**: All 8 app-preset skills reference relevant MCP tools (`forge_sweep`, `forge_analyze`, `forge_diff`, `forge_validate`, `forge_smith`) in their step definitions
- **MUST**: All skills use `tools:` frontmatter to declare required tool access
- **MUST**: All skills include conditional step logic (e.g., "if unit tests fail, skip integration tests, go to Report")
- **MUST**: Each preset's skills contain ONLY stack-specific commands (remove duplicated multi-stack command blocks from `/dependency-audit`, `/api-doc-gen`, etc.)
- **MUST**: `/test-sweep` calls `forge_sweep` after test execution for completeness scan
- **MUST**: `/code-review` calls `forge_analyze` and `forge_diff` for structured findings
- **MUST**: `/staging-deploy` calls `forge_validate` as pre-flight check
- **MUST**: `/onboarding` calls `forge_smith` for environment diagnostics
- **SHOULD**: Skills emit structured output format (summary block with counts/scores) not just prose
- **SHOULD**: Memory integration uses consistent pattern (not copy-paste boilerplate per skill)

#### Tier 2 — New Skills & Hub Integration
- **MUST**: New `/health-check` skill — chains `forge_smith` → `forge_validate` → `forge_sweep` with structured report
- **MUST**: New `/forge-execute` skill — guided wrapper: list plans → pick plan → choose mode → estimate cost → confirm → execute
- **SHOULD**: Skills emit events to WebSocket hub so dashboard shows skill execution
- **SHOULD**: New MCP tool `forge_skill_status` to report skill execution events
- **SHOULD**: Hub event schema extended with `skill-started`, `skill-step-completed`, `skill-completed` event types
- **COULD**: Dashboard skill execution timeline view

#### Tier 3 — Executable Skill Engine
- **SHOULD**: Skill definition schema (JSON/YAML) that the orchestrator can parse into a step DAG
- **SHOULD**: `SkillRunner` class in orchestrator that executes skill steps with gate validation between them
- **SHOULD**: Skills define `gate:` per step (bash command that must exit 0 to proceed)
- **SHOULD**: `forge_run_skill` MCP tool to execute a skill programmatically with progress tracking
- **COULD**: Skill chaining — one skill triggers another (e.g., `/staging-deploy` calls `/test-sweep` as a pre-flight step)
- **COULD**: Skills expose parameters as typed schema (not just `argument-hint` text)
- **COULD**: Cost tracking per skill execution via telemetry spans

---

## Scope Contract

### In Scope

#### Tier 1 — Skill Files (All Presets)
- `presets/dotnet/.github/skills/*/SKILL.md` — all 8 skill files
- `presets/typescript/.github/skills/*/SKILL.md` — all 8 skill files
- `presets/python/.github/skills/*/SKILL.md` — all 8 skill files
- `presets/java/.github/skills/*/SKILL.md` — all 8 skill files
- `presets/go/.github/skills/*/SKILL.md` — all 8 skill files
- `presets/azure-iac/.github/skills/*/SKILL.md` — all 3 skill files

#### Tier 2 — New Skills & MCP Additions
- `presets/shared/skills/health-check/SKILL.md` — new shared skill (all presets)
- `presets/shared/skills/forge-execute/SKILL.md` — new shared skill (all presets)
- `pforge-mcp/server.mjs` — add `forge_skill_status` tool, skill event handling
- `pforge-mcp/hub.mjs` — skill event types in broadcast schema
- `pforge-mcp/capabilities.mjs` — update skill metadata, add new tools
- `pforge-mcp/EVENTS.md` — document skill event schema

#### Tier 3 — Skill Engine
- `pforge-mcp/skill-runner.mjs` — new module: skill parser + step executor + gate validator
- `pforge-mcp/orchestrator.mjs` — integrate SkillRunner, expose via event bus
- `pforge-mcp/server.mjs` — add `forge_run_skill` MCP tool
- `pforge-mcp/telemetry.mjs` — skill spans (skill-run → step spans)

#### Documentation
- `docs/plans/DEPLOYMENT-ROADMAP.md` — add Phase 8 entry
- `README.md` — update skill counts, add new skills to tables
- `CHANGELOG.md` — v2.6.0 entry
- `CUSTOMIZATION.md` — update skill documentation, new skill authoring guide
- `docs/capabilities.md` — update skill table
- `docs/COPILOT-VSCODE-GUIDE.md` — update skill usage section
- `docs/CLI-GUIDE.md` — document `forge_run_skill` if Tier 3 ships
- `pforge-mcp/package.json` — version bump to 2.6.0

### Out of Scope

- Modifying pipeline prompts (`step*.prompt.md`) or pipeline agent definitions (`*.agent.md`)
- Changing the orchestrator's existing plan execution flow (DAG scheduler, worker spawning)
- Adding external service dependencies
- Redesigning the dashboard layout (only additive skill timeline)
- Changing how `setup.ps1` / `setup.sh` copies skills (directory structure stays the same)
- Modifying the extension catalog or community extension system

### Forbidden Actions

- Do NOT modify the existing plan execution pipeline (run-plan, slice execution, quorum flow)
- Do NOT change MCP tool signatures for existing tools (additive only)
- Do NOT modify `step*.prompt.md` or pipeline `*.agent.md` files
- Do NOT add Python or non-Node dependencies to `pforge-mcp/`
- Do NOT break existing skills — all changes must be backward-compatible (a user with old-format skills should not see regressions)

---

## Architecture

### Tier 1: MCP-Integrated Skills

```
┌─────────────────────────────────────────────────┐
│  CURRENT: Copilot reads SKILL.md → interprets   │
│  steps → runs bash commands ad-hoc              │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  UPGRADED: Copilot reads SKILL.md → interprets  │
│  steps → calls MCP tools (forge_sweep, etc.)    │
│  → gets structured output → conditional flow    │
│  → memory search/capture via OpenBrain          │
└─────────────────────────────────────────────────┘
```

### Tier 2: Hub-Aware Skills with New Procedures

```
/health-check
  ├─ Step 1: forge_smith      → environment diagnostics
  ├─ Step 2: forge_validate   → setup integrity
  ├─ Step 3: forge_sweep      → deferred-work markers
  └─ Report: structured summary with pass/fail/warning counts

/forge-execute
  ├─ Step 1: forge_status     → list available plans
  ├─ Step 2: user picks plan  → plan selection
  ├─ Step 3: forge_run_plan(estimate=true) → cost preview
  ├─ Step 4: user confirms    → mode selection (auto/assisted)
  └─ Step 5: forge_run_plan   → execute with live progress
```

### Tier 3: Executable Skill Engine

```
SKILL.md (enhanced schema)
  │
  ├─ Parsed by SkillRunner → Step DAG
  │     ├─ Step 1: { command, gate, on_fail }
  │     ├─ Step 2: { command, gate, on_fail, depends: [1] }
  │     └─ Step N: { command, gate }
  │
  ├─ Executed by orchestrator
  │     ├─ step-started event → hub
  │     ├─ run command → capture output
  │     ├─ run gate → pass/fail
  │     ├─ step-completed event → hub
  │     └─ next step or abort
  │
  └─ Telemetry
        ├─ skill-run span (root)
        ├─ step-N spans (children)
        └─ cost aggregation
```

---

## Slices

### Slice 1: Audit & De-duplicate Existing Skills

**Goal**: Remove multi-stack duplication from preset skills, ensure each preset only has its own stack commands.

1. Audit all 5 app-preset skill directories for duplicated multi-stack command blocks
2. For each skill that has multi-stack commands (dependency-audit, api-doc-gen, onboarding), strip commands for other stacks
3. Verify each preset's skills reference only their own build/test/lint tooling
4. Run `pforge check` to validate setup integrity after changes

**Validation Gate**:
```bash
# No cross-stack contamination: dotnet skills should not mention "pnpm", "pip", "go test", "mvn"
# (adjust per preset)
grep -r "pnpm\|pip-audit\|govulncheck\|mvn dependency" presets/dotnet/.github/skills/ && exit 1 || exit 0
```

---

### Slice 2: Add `tools:` Frontmatter & Conditional Logic to All Skills

**Goal**: Modernize skill frontmatter with `tools:` declarations and add conditional step flow.

1. Add `tools:` frontmatter to all skill SKILL.md files declaring required tool access
2. Add conditional logic markers: "If Step N fails → skip to Report" / "If gate fails → suggest rollback"
3. Add structured output format to the Report step of each skill (counts, scores, pass/fail)
4. Standardize the OpenBrain memory pattern into a consistent reusable block (not copy-paste per skill)

**Validation Gate**:
```bash
# All skills should have tools: in frontmatter
for f in presets/*/\.github/skills/*/SKILL.md; do grep -q "^tools:" "$f" || echo "MISSING tools: $f"; done
```

---

### Slice 3: Wire MCP Tools into Existing Skills

**Goal**: Connect skills to the MCP tools they should be leveraging.

1. `/test-sweep` — add step calling `forge_sweep` after test runs for completeness scan
2. `/code-review` — add steps calling `forge_analyze` (plan reference if available) and `forge_diff` for structured findings
3. `/staging-deploy` — add `forge_validate` as Step 0 pre-flight check
4. `/onboarding` — add `forge_smith` call in Step 2 (Verify Build & Tests) for structured diagnostics
5. `/dependency-audit` — add `forge_sweep` call to cross-check for TODO markers left by dependency changes
6. Update each skill's Report step to incorporate MCP tool output alongside test/lint results

**Validation Gate**:
```bash
# Key skills should reference forge_ tools
grep -q "forge_sweep" presets/dotnet/.github/skills/test-sweep/SKILL.md || exit 1
grep -q "forge_analyze" presets/dotnet/.github/skills/code-review/SKILL.md || exit 1
grep -q "forge_validate" presets/dotnet/.github/skills/staging-deploy/SKILL.md || exit 1
grep -q "forge_smith" presets/dotnet/.github/skills/onboarding/SKILL.md || exit 1
```

---

### Slice 4: Create `/health-check` Shared Skill

**Goal**: New skill that chains `forge_smith` → `forge_validate` → `forge_sweep` into a structured diagnostic.

1. Create `presets/shared/skills/health-check/SKILL.md` with proper frontmatter
2. Define 3 steps: environment diagnostics, setup validation, completeness scan
3. Add structured Report combining all three tool outputs
4. Add conditional logic: if smith fails, warn but continue; if validate fails, flag critical
5. Add memory integration (search for prior health issues, capture new findings)
6. Update `setup.ps1` and `setup.sh` to copy shared skills alongside preset skills

**Validation Gate**:
```bash
test -f presets/shared/skills/health-check/SKILL.md || exit 1
grep -q "forge_smith" presets/shared/skills/health-check/SKILL.md || exit 1
grep -q "forge_validate" presets/shared/skills/health-check/SKILL.md || exit 1
grep -q "forge_sweep" presets/shared/skills/health-check/SKILL.md || exit 1
```

---

### Slice 5: Create `/forge-execute` Shared Skill

**Goal**: Guided wrapper skill around `forge_run_plan` for interactive plan execution.

1. Create `presets/shared/skills/forge-execute/SKILL.md` with proper frontmatter
2. Step 1: Call `forge_status` to list available plans and their current status
3. Step 2: Present plans to user, ask for selection
4. Step 3: Call `forge_run_plan(estimate=true)` to show cost preview
5. Step 4: Ask user to confirm mode (auto/assisted) and model preference
6. Step 5: Call `forge_run_plan` with selected parameters
7. Step 6: Call `forge_plan_status` to report results
8. Add memory integration (search for prior run failures for this plan)

**Validation Gate**:
```bash
test -f presets/shared/skills/forge-execute/SKILL.md || exit 1
grep -q "forge_status" presets/shared/skills/forge-execute/SKILL.md || exit 1
grep -q "forge_run_plan" presets/shared/skills/forge-execute/SKILL.md || exit 1
grep -q "forge_cost_report\|forge_plan_status" presets/shared/skills/forge-execute/SKILL.md || exit 1
```

---

### Slice 6: Skill Event Schema & Hub Integration

**Goal**: Extend the WebSocket hub to broadcast skill execution events.

1. Define skill event types in `pforge-mcp/EVENTS.md`: `skill-started`, `skill-step-started`, `skill-step-completed`, `skill-completed`
2. Add event schema: `{ type, skillName, stepNumber, stepName, status, output, timestamp }`
3. Update `pforge-mcp/hub.mjs` — register skill event types in the event proxy list
4. Add `forge_skill_status` MCP tool to `pforge-mcp/server.mjs` — returns last skill execution events
5. Update `pforge-mcp/capabilities.mjs` — add skill event metadata, update tool catalog

**Validation Gate**:
```bash
grep -q "skill-started" pforge-mcp/hub.mjs || exit 1
grep -q "forge_skill_status" pforge-mcp/server.mjs || exit 1
grep -q "skill-started" pforge-mcp/EVENTS.md || exit 1
```

---

### Slice 7: Dashboard Skill Timeline

**Goal**: Show skill executions in the dashboard alongside plan runs.

1. Add skill event listeners in `pforge-mcp/dashboard/app.js`
2. Add a "Skills" section or tab that displays recent skill executions
3. Show per-step status (running/passed/failed) with timestamps
4. Wire skill events from hub into the existing event stream display
5. Style consistently with existing dashboard theme

**Validation Gate**:
```bash
grep -q "skill-started\|skill-completed" pforge-mcp/dashboard/app.js || exit 1
```

---

### Slice 8: Skill Runner Engine — Parser & Step DAG [depends: Slice 6]

**Goal**: Create the SkillRunner module that parses enhanced SKILL.md into executable step DAGs.

1. Create `pforge-mcp/skill-runner.mjs` with `parseSkill(skillPath)` function
2. Parse SKILL.md frontmatter (name, description, tools, gates) and step definitions
3. Build step DAG with dependencies and gate definitions
4. Implement `executeSkill(skillPath, args, options)` — runs steps sequentially with gate validation
5. Emit events via event bus (skill-started, step-started, step-completed, skill-completed)
6. Support abort signal between steps
7. Add unit self-tests (parse a sample skill, verify DAG, mock execution)

**Validation Gate**:
```bash
node pforge-mcp/skill-runner.mjs --test
```

---

### Slice 9: `forge_run_skill` MCP Tool [depends: Slice 8]

**Goal**: Expose skill execution as an MCP tool for programmatic invocation.

1. Add `forge_run_skill` tool definition in `pforge-mcp/server.mjs`
2. Schema: `{ skill: string, args: string, dryRun: boolean, path: string }`
3. Wire to `SkillRunner.executeSkill()` from skill-runner.mjs
4. Return structured result: `{ status, steps: [{ name, gate, passed }], duration, events }`
5. Add telemetry spans: skill-run (root) → step-N (children)
6. Update `pforge-mcp/capabilities.mjs` with new tool metadata
7. Update `pforge-mcp/telemetry.mjs` — add `startSkillSpan()`, `startSkillStepSpan()`

**Validation Gate**:
```bash
grep -q "forge_run_skill" pforge-mcp/server.mjs || exit 1
grep -q "forge_run_skill" pforge-mcp/capabilities.mjs || exit 1
```

---

### Slice 10: Documentation Sweep — Markdown Files

**Goal**: Update all `.md` documentation files to reflect new skill counts, new skills, MCP tool additions, and upgraded architecture.

**Files to update (18 markdown files)**:

| # | File | What Changes |
|---|------|-------------|
| 1 | `README.md` (lines 113, 123, 135, 447–458, 462, 636, 719) | Skill counts 8→10, add `/health-check` + `/forge-execute` to tables, update "Skills Per Preset" section, update installed counts line, update Quick Reference table |
| 2 | `CUSTOMIZATION.md` (lines 444–452, 594–609, 738, 870) | Add 2 new skills to setup list, update skill table with 10 entries, add `tools:` frontmatter authoring guide, update memory table counts, update directory tree |
| 3 | `AGENT-SETUP.md` (line 273) | Update skill count from "8 skills" to "10 skills", list new skills |
| 4 | `CHANGELOG.md` | Add v2.6.0 entry: Tier 1 (MCP integration, de-duplication, conditional logic), Tier 2 (new skills, hub events, dashboard), Tier 3 (skill engine, `forge_run_skill` tool) |
| 5 | `ROADMAP.md` (line 379) | Add skill upgrade milestone, reference `/health-check` and `/forge-execute` |
| 6 | `docs/capabilities.md` (lines 143–154) | Expand skill table from 8→10, add `forge_skill_status` and `forge_run_skill` to MCP tools section |
| 7 | `docs/COPILOT-VSCODE-GUIDE.md` (lines 408–442, 462) | Add 2 new skills to usage table, update slash command examples, mention `tools:` frontmatter |
| 8 | `docs/UNIFIED-SYSTEM-ARCHITECTURE.md` (lines 69–70, 699–707) | Update "8 skills" → "10 skills", add `/health-check` and `/forge-execute` to directory tree |
| 9 | `docs/CLI-GUIDE.md` | Document `forge_run_skill` MCP tool (if Tier 3 ships), document `forge_skill_status` tool |
| 10 | `docs/EXTENSIONS.md` | Update extension authoring guidance for new skill patterns (tools: frontmatter, gates) |
| 11 | `.github/copilot-instructions.md` (lines 148–165) | Add `/health-check` and `/forge-execute` to skill table, update count |
| 12 | `pforge-mcp/EVENTS.md` | Add skill event types documentation (covered in Slice 6 but verify completeness) |
| 13 | `docs/plans/DEPLOYMENT-ROADMAP.md` | Phase 8 status → ✅ Complete |
| 14 | `templates/copilot-instructions.md.template` | Update skill table template to include 10 skills |
| 15 | `presets/shared/README.md` | Document the new `skills/` subdirectory within shared preset |
| 16 | `docs/QUICKSTART-WALKTHROUGH.md` | Reference new `/health-check` skill as a quick diagnostic step |
| 17 | `VERSION` | Bump to v2.6.0 |
| 18 | `pforge-mcp/package.json` | Bump to v2.6.0 |

**Tasks**:
1. Run a grep sweep across all `.md` files for "8 skills" → update to "10 skills" (or "10 for app presets: 8 upgraded + 2 new shared")
2. Update every skill table/list to add `/health-check` and `/forge-execute` rows
3. Update `pforge-mcp/capabilities.mjs` skill listing (line ~516) to include 2 new skills and `forge_skill_status`/`forge_run_skill` tools
4. Add v2.6.0 CHANGELOG entry covering all 3 tiers
5. Bump version in `VERSION` and `pforge-mcp/package.json`
6. Verify no stale "8 skills" references remain: `grep -rn "8 skills" --include="*.md" .`

**Validation Gate**:
```bash
# No stale "8 skills" count references
grep -rn "8 skills" --include="*.md" . | grep -v CHANGELOG | grep -v Phase-8 && exit 1 || exit 0
# New skills documented
grep -q "health-check" README.md || exit 1
grep -q "forge-execute" README.md || exit 1
# Version bumped
grep -q "2.6.0" pforge-mcp/package.json || exit 1
grep -q "2.6.0" VERSION || exit 1
```

---

### Slice 11: Documentation Sweep — HTML Website Files

**Goal**: Update all `.html` website files (GitHub Pages site) to reflect new skill counts, new skills, and updated capability numbers.

**Files to update (5 HTML files)**:

| # | File | What Changes |
|---|------|-------------|
| 1 | `docs/capabilities.html` (lines 7, 15, 62, 66, 214–231, 268) | Meta description "8 skills" → "10 skills", Twitter card, badge count, "8 Slash Command Skills" heading → "10 Slash Command Skills", add `/health-check` + `/forge-execute` code blocks, update preset table Skills column |
| 2 | `docs/index.html` (lines 604–613, 705–713, 997, 1064, 1180, 1250, 1322, 1369, 1516–1518) | Add `/health-check` + `/forge-execute` to the slash command showcase, update "8 skills" badge → "10 skills" in the setup output section, update preset comparison table |
| 3 | `docs/faq.html` (line 129) | Update skill/agent mentions in multi-agent support answer |
| 4 | `docs/docs.html` | Update skill references if present in documentation overview |
| 5 | `docs/extensions.html` | Update extension authoring references for new skill patterns |

**Tasks**:
1. Search all `.html` files for "8 skills", "8 Slash Command", skill code blocks — update counts and add new skills
2. Add `/health-check` and `/forge-execute` code blocks to the capabilities.html skill grid
3. Add new skills to the index.html slash command showcase section
4. Update meta descriptions and Twitter card content
5. Verify all HTML is valid (no broken tags from edits)
6. Cross-check: every skill listed in `.md` files is also listed in the `.html` counterparts

**Validation Gate**:
```bash
# No stale "8 skills" or "8 Slash" in HTML
grep -rn "8 skills\|8 Slash" --include="*.html" docs/ && exit 1 || exit 0
# New skills present in HTML
grep -q "health-check" docs/capabilities.html || exit 1
grep -q "forge-execute" docs/capabilities.html || exit 1
grep -q "health-check" docs/index.html || exit 1
```

---

### Slice 12: Documentation Sweep — Code & Config Files

**Goal**: Update non-doc source files that embed skill metadata: MCP capabilities, setup scripts, dashboard, templates.

**Files to update**:

| # | File | What Changes |
|---|------|-------------|
| 1 | `pforge-mcp/capabilities.mjs` (line ~516) | Add `/health-check` and `/forge-execute` to `skills.available` object, update description count "8 multi-step" → "10 multi-step", add `forge_skill_status` and `forge_run_skill` (if Tier 3) tool metadata |
| 2 | `pforge-mcp/server.mjs` | Add `forge_skill_status` tool definition (overlaps with Slice 6 — verify present) |
| 3 | `pforge-mcp/dashboard/index.html` | Add skill timeline section to dashboard layout (overlaps with Slice 7 — verify present) |
| 4 | `pforge-mcp/dashboard/app.js` | Skill event listeners (overlaps with Slice 7 — verify present) |
| 5 | `setup.ps1` | Ensure shared skills directory is copied during setup alongside preset skills |
| 6 | `setup.sh` | Ensure shared skills directory is copied during setup alongside preset skills |
| 7 | `validate-setup.ps1` | Update expected skill count validation (8→10) if hardcoded |
| 8 | `validate-setup.sh` | Update expected skill count validation (8→10) if hardcoded |
| 9 | `scripts/validate-action.sh` (line 84) | Update skill count expectations if any thresholds exist |
| 10 | `action.yml` | Update description/metadata if it references skill counts |
| 11 | `plugin.json` | Update capability metadata if it references skill counts |

**Tasks**:
1. Audit capabilities.mjs skill listing — add 2 new skills, update count in description string
2. Verify setup scripts copy `presets/shared/skills/` into `.github/skills/`
3. Verify validation scripts accept 10 skills (not just 8)
4. Run `pforge check` against a test setup to confirm no regressions

**Validation Gate**:
```bash
# capabilities.mjs has new skills
grep -q "health-check" pforge-mcp/capabilities.mjs || exit 1
grep -q "forge-execute" pforge-mcp/capabilities.mjs || exit 1
# Setup scripts handle shared skills
grep -q "shared" setup.ps1 || exit 1
grep -q "shared" setup.sh || exit 1
```

---

## Tier-to-Slice Mapping

| Tier | Slices | Priority |
|------|--------|----------|
| **Tier 1** — MCP Integration & Modernization | Slices 1, 2, 3 | High — Low risk, immediate value |
| **Tier 2** — New Skills & Hub Integration | Slices 4, 5, 6, 7 | Medium — New features, moderate effort |
| **Tier 3** — Executable Skill Engine | Slices 8, 9 | Lower — Architectural, higher effort |
| **Doc Sweep** — Markdown, HTML, Code & Config | Slices 10, 11, 12 | Ships after each tier or as final sweep |
| **Validation** — Testbed verification | Slice 13 | Ships last — validates everything in plan-forge-testbed |

---

### Slice 13: Testbed Validation — End-to-End Capability Testing

**Goal**: Run the full capability suite in the `plan-forge-testbed` repo to validate all changes work in a real dotnet project environment.

**Test Matrix**:

| # | Capability | Command / Test | Expected | Status |
|---|-----------|---------------|----------|--------|
| 1 | Environment health | `pforge smith` | 14+ passed, 0 failed | Baseline ✅ |
| 2 | Setup validation | `pforge check` | All checks pass | Pre-existing bug (empty path arg) |
| 3 | Completeness sweep | `pforge sweep` | Returns marker count | Baseline ✅ |
| 4 | Phase status | `pforge status` | Lists all phases | Baseline ✅ |
| 5 | Plan analysis | `pforge analyze <plan>` | Consistency score | Pre-existing bug (git stderr as error in PS 5.1) |
| 6 | Scope drift | `pforge diff <plan>` | Drift detection | Pre-existing bug (git stderr as error in PS 5.1) |
| 7 | Orchestrator self-test | `node orchestrator.mjs --test` | 65+ passed, 0 failed | Baseline ✅ |
| 8 | MCP capabilities | `buildCapabilitySurface()` | All 10 skills listed | After upgrade |
| 9 | Skill frontmatter | All SKILL.md have `tools:` | 10/10 present | After Slice 2 |
| 10 | `/test-sweep` invocation | Invoke via Copilot Chat | Calls `forge_sweep` in flow | After Slice 3 |
| 11 | `/code-review` invocation | Invoke via Copilot Chat | Calls `forge_analyze` + `forge_diff` | After Slice 3 |
| 12 | `/health-check` invocation | Invoke via Copilot Chat | Structured 3-step report | After Slice 4 |
| 13 | `/forge-execute` invocation | Invoke via Copilot Chat | Plan selection + cost estimate flow | After Slice 5 |
| 14 | Hub skill events | Start hub + invoke skill | `skill-started` events broadcast | After Slice 6 |
| 15 | Dashboard skill timeline | Connect dashboard + invoke skill | Skill steps visible | After Slice 7 |
| 16 | `forge_run_skill` MCP tool | Call via MCP client | Structured result with step statuses | After Slice 9 |
| 17 | Doc consistency | `grep -rn "8 skills"` across all files | 0 stale references (excluding CHANGELOG) | After Slice 10–12 |

**Pre-existing Bugs Found During Baseline Testing** (not caused by Phase 8 — document for separate fix):
1. `validate-setup.ps1` — empty string passed to `-Path` parameter when checking required files (likely missing config value)
2. `pforge analyze` / `pforge diff` — git stderr warnings (`LF will be replaced by CRLF`) treated as terminating errors by PS 5.1 (need `$ErrorActionPreference = 'SilentlyContinue'` around git calls)
3. `pforge status` — emoji characters (📋, ✅) display as garbled text in PS 5.1 stdout (cosmetic, not functional)
4. **UTF-8 BOM** — `pforge.ps1`, `setup.ps1`, `validate-setup.ps1` lacked UTF-8 BOM, causing all non-ASCII characters to corrupt in Windows PowerShell 5.1 (**fixed on this branch**)

**Tasks**:
1. Re-run `setup.ps1 -Preset dotnet` in testbed with updated Plan Forge source to install new shared skills
2. Verify 10 skills appear in `.github/skills/` (8 existing + 2 shared)
3. Run full test matrix above, marking each row pass/fail
4. For manual Copilot Chat tests (rows 10–13), invoke each slash command and verify MCP tool calls appear in the output
5. For hub/dashboard tests (rows 14–15), start MCP server with `--port 3100`, connect dashboard, invoke a skill, verify events
6. Run `pforge smith` and confirm skill count shows 10
7. Run `node orchestrator.mjs --test` and confirm 65+ pass
8. Run final doc consistency check: `grep -rn "8 skills" --include="*.md" --include="*.html" . | grep -v CHANGELOG | grep -v Phase-8`

**Validation Gate**:
```bash
# Orchestrator tests pass
node pforge-mcp/orchestrator.mjs --test 2>&1 | grep -q "0 failed" || exit 1
# 10 skills installed
find .github/skills -name "SKILL.md" | wc -l | grep -q "10" || exit 1
# No stale "8 skills" outside CHANGELOG/Phase-8
grep -rn "8 skills" --include="*.md" --include="*.html" . | grep -v CHANGELOG | grep -v Phase-8 | grep -c . | grep -q "^0$" || exit 1
```

---

## Definition of Done

- [ ] All 5 app-preset skill directories updated (40 files)
- [ ] All 3 azure-iac skills updated (3 files)
- [ ] 2 new shared skills created (`/health-check`, `/forge-execute`)
- [ ] No multi-stack duplication in preset-specific skills
- [ ] All skills have `tools:` frontmatter
- [ ] All skills reference relevant MCP tools
- [ ] All skills have conditional step logic
- [ ] All skills have structured output format in Report step
- [ ] Hub broadcasts skill events (Tier 2)
- [ ] Dashboard shows skill timeline (Tier 2)
- [ ] SkillRunner parses and executes skills (Tier 3)
- [ ] `forge_run_skill` MCP tool works (Tier 3)
- [ ] **Doc Sweep — Markdown**: All 18 `.md` files updated (counts, tables, new skills)
- [ ] **Doc Sweep — HTML**: All 5 `.html` website files updated (counts, meta tags, showcases)
- [ ] **Doc Sweep — Code/Config**: capabilities.mjs, setup scripts, validate scripts, dashboard updated
- [ ] No stale "8 skills" references in any `.md` or `.html` file (excluding CHANGELOG history)
- [ ] Version bumped to v2.6.0 in `VERSION`, `pforge-mcp/package.json`
- [ ] CHANGELOG.md has v2.6.0 entry
- [ ] `pforge check` passes on all presets
- [ ] Setup scripts copy shared skills directory
- [ ] Self-tests pass: `node pforge-mcp/orchestrator.mjs --test`
- [ ] Self-tests pass: `node pforge-mcp/skill-runner.mjs --test` (Tier 3)
- [ ] **Testbed validation**: All 17 test matrix rows pass in `plan-forge-testbed`
- [ ] **Testbed validation**: Copilot Chat slash command invocations verified (rows 10–13)
- [ ] Self-tests pass: `node pforge-mcp/orchestrator.mjs --test`
- [ ] Self-tests pass: `node pforge-mcp/skill-runner.mjs --test` (Tier 3)

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing skills for users who already ran setup | High | All changes backward-compatible; old-format skills still work |
| `tools:` frontmatter not respected by older Copilot versions | Medium | Degrade gracefully — tools just won't be restricted |
| Skill engine overcomplicates simple procedures | Medium | Tier 3 is optional uplift; skills always remain human-readable markdown |
| Dashboard changes conflict with quorum mode dashboard work | Low | Additive only — new skill section, don't modify existing plan views |
| 40+ file changes across presets risk merge conflicts | Medium | Slice 1–3 per-preset; review preset-by-preset |

---

## Notes

- Skills are installed by `setup.ps1`/`setup.sh` into the user's project. Changes to preset skills only affect new installs or re-runs. Existing users would need to re-run setup or manually update.
- The `presets/shared/` directory is a new concept — the setup wizard should merge shared skills into `.github/skills/` alongside preset-specific ones.
- Tier 3 (Skill Engine) is fully optional. If it proves too complex during execution, Tiers 1–2 deliver the majority of the value.
