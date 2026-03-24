# Phase: Pipeline Enhancements — Specifications, Project Principles & Extensions

> **Roadmap Reference**: [DEPLOYMENT-ROADMAP.md](./DEPLOYMENT-ROADMAP.md)
> **Status**: 🟡 HARDENED — Ready for execution
> **Estimated Effort**: 2–3 days (6 workstreams, 18 execution slices)
> **Risk Level**: Low (documentation + template changes, no runtime code)
> **Origin**: Gap analysis — specification-driven workflows, project governance, and ecosystem extensibility

---

## Overview

Enhance the AI Plan Hardening Template with six improvements to support specification-driven development, project governance, and ecosystem extensibility. All additions are **optional and non-disruptive** — existing users who do not use external specification tools experience zero change to their current workflow.

### Goals

1. Let users with existing specifications (from any spec-driven workflow) feed them into the hardening pipeline as authoritative inputs
2. Formalize project governing principles via a Project Principles workshop (more structured than the current project-profile)
3. Add requirement-to-slice traceability so Step 5 can verify intent was preserved, not just scope
4. Add branch strategy guidance to prevent wrong-branch execution and lost plan-to-branch mappings
5. Enable a simple extension ecosystem for sharing custom reviewers, prompts, and instruction files
6. Provide an optional CLI wrapper for developers who want to automate common pipeline operations

### Design Principles

- **Additive only** — no existing file behavior changes
- **Gated behind "optional" / "if exists"** — all new sections are skipped when not populated
- **No new dependencies** — everything is Markdown, JSON, and shell scripts
- **Copilot-first** — all features work in GitHub Copilot Agent Mode in VS Code
- **Non-developers welcome** — CLI is a convenience layer; the manual workflow remains primary

---

## Scope Contract

### In Scope

- Modifications to existing runbook files (`AI-Plan-Hardening-Runbook.md`, `AI-Plan-Hardening-Runbook-Instructions.md`)
- New prompt templates in `templates/` and applicable presets
- New instruction files in `templates/` and applicable presets
- New template files for project principles and extensions
- Setup script enhancements (`setup.ps1`, `setup.sh`)
- Validation script enhancements (`validate-setup.ps1`, `validate-setup.sh`)
- New CLI wrapper scripts (`pharden.ps1`, `pharden.sh`)
- Documentation updates (`README.md`, `CUSTOMIZATION.md`)

### Out of Scope (Non-Goals)

- Multi-agent support (Cursor, Claude Code, etc.) — Copilot only
- Integration with or dependency on any external specification tool
- Automated branch creation (guidance only, not enforcement)
- Package registry or npm/PyPI publishing for extensions
- Runtime code, build systems, or compiled artifacts
- Changes to existing preset instruction file content (only additions)

### Forbidden Actions

- Do not modify existing Step 0–5 prompt behavior for users who don't populate new optional fields
- Do not renumber existing Steps (0–5 remain 0–5)
- Do not remove or rename any existing files
- Do not add runtime dependencies (Python, Node.js, etc.)
- Do not change the 3-session isolation model
- Do not modify existing examples in `docs/plans/examples/`

---

## Required Decisions (Resolve Before Execution)

| # | Decision | Options | Resolution |
|---|----------|---------|------------|
| 1 | Where does the project principles file live? | `docs/plans/PROJECT-PRINCIPLES.md` / `.github/PROJECT-PRINCIPLES.md` | `docs/plans/PROJECT-PRINCIPLES.md` — keeps all planning artifacts together |
| 2 | Extension manifest format? | JSON / YAML | JSON — no extra parser needed, matches `.plan-hardening.json` |
| 3 | CLI script name? | `pharden` / `plan-harden` / `hardening-cli` | `pharden` — short, memorable, no conflicts |
| 4 | Branch strategy default when undeclared? | Trunk / Feature branch / Prompt user | Trunk (matches current behavior — no branch management today) |
| 5 | Requirements register ID format? | `REQ-001` / `R1` / freeform | `REQ-001` — formal enough to grep, short enough to not clutter |
| 6 | Project Principles relationship to project-profile? | Replace / Complement / Independent | Complement — project principles = what we believe; profile = how Copilot codes |

---

## Execution Slices

---

### Slice 1: External Specification Support — Runbook Changes
**Goal**: Add optional "External Specification" support to existing runbook and instructions files
**Estimated Time**: 45 min
**Parallelism**: `[parallel-safe]` Group A
**Depends On**: None
**Inputs**: Current `AI-Plan-Hardening-Runbook.md`, `AI-Plan-Hardening-Runbook-Instructions.md`
**Outputs**: Updated runbook + instructions with optional spec-source fields

**Context Files**:
- `docs/plans/AI-Plan-Hardening-Runbook.md`
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`

**Tasks**:
1. In `AI-Plan-Hardening-Runbook.md` → Step 0 section, add a tip callout:
   ```markdown
   > **Tip — External Specifications**: If you use a spec-driven workflow,
   > you can reference your existing specification files as inputs to
   > Step 0/Step 2. The hardening pipeline
   > will treat them as authoritative sources, ensuring every slice traces
   > back to a documented requirement. See the optional "Specification
   > Source" field in Template 1.
   ```
2. In `AI-Plan-Hardening-Runbook.md` → Template 1 (Scope Contract), add an optional field:
   ```markdown
   ### Specification Source (Optional)
   - Spec file: (path to specification, e.g., docs/specs/feature-name/spec.md)
   - Requirements doc: (path to requirements, if separate from spec)
   - Project Principles: (path to docs/plans/PROJECT-PRINCIPLES.md, if exists)
   
   > When populated, the hardening process treats these as authoritative
   > inputs. All scope contracts and validation gates must trace back to
   > requirements in the referenced specification.
   ```
3. In `AI-Plan-Hardening-Runbook.md` → Template 3 (Execution Slices), add optional `Traces to:` field to the slice template:
   ```markdown
   **Traces to**: (optional — REQ-001, REQ-003 or User Story 2)
   ```
4. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 2 hardening prompt, add one line to the instructions block:
   ```
   If a Specification Source is referenced in the Scope Contract, ensure each
   slice includes a "Traces to" field mapping to requirements in that spec.
   ```
5. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 5 review prompt, add Part C after Part B:
   ```
   --- PART C: TRACEABILITY CHECK (if Specification Source exists) ---
   
   If the plan references an external specification:
   1. Verify every requirement in the spec has at least one slice that addresses it
   2. Verify no slice implements functionality NOT in the spec
   3. Flag any spec requirements with no corresponding validation gate
   
   Output Part C:
   | Requirement | Traced to Slice(s) | Status |
   |-------------|-------------------|--------|
   
   If no specification is referenced, skip Part C entirely.
   ```

**Validation Gate**:
- [ ] All changes are additive (no existing text removed or modified)
- [ ] Step 2 prompt still functions identically when no spec is referenced
- [ ] Step 5 prompt explicitly skips Part C when no spec exists
- [ ] No new files created in this slice

**Files Touched**:
- `docs/plans/AI-Plan-Hardening-Runbook.md`
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`

**Stop Condition**: If any change alters existing prompt behavior for non-spec users → STOP.

---

### Slice 2: Project Principles Workshop — Template & Prompt
**Goal**: Create the Project Principles template and prompt that guides users through defining their project's non-negotiable principles
**Estimated Time**: 60 min
**Parallelism**: `[parallel-safe]` Group A
**Depends On**: None
**Inputs**: Existing `project-profile.prompt.md` pattern, architecture-principles baseline
**Outputs**: Project Principles template + prompt template + instruction file

**Context Files**:
- `.github/instructions/architecture-principles.instructions.md`
- `templates/copilot-instructions.md.template`

**Tasks**:
1. Create `docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md` with the following structure:
   ```markdown
   # Project Principles
   
   > **Purpose**: Declares the non-negotiable principles, commitments,
   > and boundaries for this project. Referenced by the AI Plan Hardening
   > Pipeline to validate plans and detect drift against project intent.
   >
   > **How created**: Run `.github/prompts/project-principles.prompt.md` for a
   > guided ceremony, or fill in manually.
   >
   > **How used**: Auto-loaded by Project Principles instruction file. Referenced
   > in Step 1 (Preflight), Step 2 (Harden), and Step 5 (Review).
   
   ---
   
   ## Project Identity
   
   **What this project is** (one sentence):
   > (e.g., "A multi-tenant SaaS platform for managing healthcare appointments")
   
   **What this project is NOT**:
   > (e.g., "Not a general-purpose scheduling tool — healthcare-specific only")
   
   ---
   
   ## Core Principles (3–7, non-negotiable)
   
   | # | Principle | Rationale | Violated When |
   |---|-----------|-----------|---------------|
   | 1 | (e.g., All data access through repositories) | (why this matters) | (concrete example of violation) |
   | 2 | (e.g., No ORM magic — explicit SQL only) | | |
   | 3 | (e.g., Multi-tenant isolation at every layer) | | |
   
   ---
   
   ## Technology Commitments
   
   Locked-in choices that are NOT up for discussion during execution:
   
   | Category | Commitment | Alternatives Rejected |
   |----------|-----------|----------------------|
   | Language | (e.g., C# 14 / .NET 10) | |
   | Database | (e.g., PostgreSQL 17) | |
   | ORM/Data | (e.g., Dapper — no EF Core) | |
   | Testing | (e.g., xUnit + Testcontainers) | |
   | Frontend | (e.g., Blazor Server) | |
   
   ---
   
   ## Quality Non-Negotiables
   
   | Metric | Target | Enforcement |
   |--------|--------|-------------|
   | Test coverage | (e.g., 90%+ on business logic) | CI gate |
   | Build time | (e.g., <60s local, <5min CI) | Monitored |
   | Response time | (e.g., P95 <200ms for API) | Load test |
   | Accessibility | (e.g., WCAG 2.2 AA) | Reviewer agent |
   
   ---
   
   ## Forbidden Patterns
   
   Never acceptable, regardless of context or time pressure:
   
   | # | Pattern | Why Forbidden |
   |---|---------|--------------|
   | 1 | (e.g., String interpolation in SQL) | SQL injection risk |
   | 2 | (e.g., Sync-over-async (.Result, .Wait())) | Deadlock risk |
   | 3 | (e.g., Secrets in code or config files) | Security breach |
   | 4 | (e.g., Empty catch blocks) | Silent failures |
   
   ---
   
   ## Governance
   
   **How are these project principles amended?**
   > (e.g., "Requires a Pull Request with human review. No AI-only amendments.")
   
   **Who can amend it?**
   > (e.g., "Project lead or team consensus")
   
   **When was it last reviewed?**
   > (date)
   ```

2. Create project principles prompt template at `templates/.github/prompts/project-principles.prompt.md`:
   ```markdown
   ---
   description: "Define your project's non-negotiable principles, commitments, and boundaries"
   mode: agent
   ---
   
   # Project Principles Workshop
   
   You are a PROJECT PRINCIPLES FACILITATOR. Your job is to interview the user and
   produce a completed `docs/plans/PROJECT-PRINCIPLES.md` following the template at
   `docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md`.
   
   ## Process
   
   Walk through each section one at a time. For each section:
   1. Explain what it captures and why it matters
   2. Ask the user targeted questions
   3. Draft the section based on their answers
   4. Confirm before moving on
   
   ### Section Interview Guide
   
   **Project Identity** (2 questions):
   - "In one sentence, what does this project do and who is it for?"
   - "What is this project explicitly NOT? What should an AI agent never
     mistake it for?"
   
   **Core Principles** (iterative):
   - "What are the 3–5 rules that, if violated, would make you reject a
     Pull Request regardless of how well the code works?"
   - For each: "When would an AI agent accidentally violate this?"
   
   **Technology Commitments** (checklist):
   - "Which technology choices are locked in and NOT open for discussion?"
   - "For each, what alternative was considered and rejected?"
   
   **Quality Non-Negotiables** (measurable):
   - "What coverage, performance, and accessibility targets must every
     phase meet?"
   - "How is each enforced — CI gate, reviewer agent, or manual check?"
   
   **Forbidden Patterns** (anti-patterns):
   - "What patterns should NEVER appear in this codebase, regardless of
     time pressure?"
   - "For each, what's the concrete risk if it slips through?"
   
   **Governance**:
   - "How should these project principles be changed? Who approves amendments?"
   
   ## Output
   
   Generate the completed `docs/plans/PROJECT-PRINCIPLES.md` using the template
   structure. Do not invent principles — only codify what the user states.
   
   After generating, remind the user:
   - "Your project principles are saved. They will be automatically checked during
     Step 1 (Preflight), Step 2 (Harden), and Step 5 (Review)."
   - "To amend it later, edit docs/plans/PROJECT-PRINCIPLES.md directly or
     re-run this prompt."
   ```

3. Create project principles instruction file at `templates/.github/instructions/project-principles.instructions.md`:
   ```markdown
   ---
   description: Project Principles — auto-loads governing principles when
     docs/plans/PROJECT-PRINCIPLES.md exists
   applyTo: '**'
   globs: docs/plans/PROJECT-PRINCIPLES.md
   ---
   
   # Project Principles Guardrails
   
   If `docs/plans/PROJECT-PRINCIPLES.md` exists in this project, it declares the
   non-negotiable principles, technology commitments, and forbidden patterns
   for this codebase.
   
   ## Rules
   
   1. **Read the Project Principles** before proposing architectural changes
   2. **Never violate a Core Principle** — these are non-negotiable
   3. **Never introduce a Forbidden Pattern** — regardless of convenience
   4. **Respect Technology Commitments** — do not suggest alternatives to
      locked-in choices
   5. **Flag potential violations** — if a requested change might conflict
      with the Project Principles, cite the specific principle and ask before proceeding
   
   ## Relationship to Other Guardrails
   
   - **Project Principles** = what the project believes (human-authored declarations)
   - **Project Profile** = how Copilot should write code (generated from interview)
   - **Architecture Principles** = universal baseline (applies to all projects)
   
   Project Principles take precedence when they conflict with generated guardrails.
   ```

**Validation Gate**:
- [ ] `PROJECT-PRINCIPLES-TEMPLATE.md` has all 6 sections (Identity, Principles, Tech, Quality, Forbidden, Governance)
- [ ] `project-principles.prompt.md` walks through each section interactively
- [ ] `project-principles.instructions.md` has correct `applyTo` and `globs` frontmatter
- [ ] No references to external tools in the project principles files — fully standalone

**Files Created**:
- `docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md`
- `templates/.github/prompts/project-principles.prompt.md`
- `templates/.github/instructions/project-principles.instructions.md`

---

### Slice 3: Project Principles Workshop — Pipeline Integration
**Goal**: Wire the project principles into Steps 1, 2, and 5 of the existing pipeline
**Estimated Time**: 30 min
**Parallelism**: `[sequential]`
**Depends On**: Slice 2
**Inputs**: Project Principles files from Slice 2, existing runbook files
**Outputs**: Updated pipeline prompts that optionally reference the project principles

**Context Files**:
- `docs/plans/AI-Plan-Hardening-Runbook.md`
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`

**Tasks**:
1. In `AI-Plan-Hardening-Runbook.md` → Step 0 (Pre-flight Checks), add a new checkbox:
   ```markdown
   - [ ] Project Principles exist (optional but recommended):
     - [ ] `docs/plans/PROJECT-PRINCIPLES.md` — project principles and commitments
   ```
2. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 1 (Preflight prompt), add check 6:
   ```
   6. PROJECT PRINCIPLES — Check if docs/plans/PROJECT-PRINCIPLES.md exists.
      If exists: read it and confirm plan doesn't violate any Core Principle.
      Report: ✅ Project Principles found (N principles) / ⚠️ no Project Principles file (optional)
   ```
   Add row to the summary table:
   ```
   | Project Principles | ✅/⚠️ | ... |
   ```
3. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 2 (Hardening prompt), add to the "Read these files first" list:
   ```
   5. docs/plans/PROJECT-PRINCIPLES.md (if exists)
   ```
   Add to the instruction block:
   ```
   If Project Principles exist, validate that no execution slice violates a
   Core Principle or introduces a Forbidden Pattern. Flag violations as
   REQUIRED DECISIONS that must be resolved before execution.
   ```
4. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 5 (Review prompt), add to "Read these files first":
   ```
   6. docs/plans/PROJECT-PRINCIPLES.md (if exists)
   ```
   Add to Part A (Code Review) checklist:
   ```
   9. PROJECT PRINCIPLES — Core Principles respected? Forbidden Patterns absent?
   ```

**Validation Gate**:
- [ ] Preflight outputs ⚠️ (not ❌) when Project Principles file is missing — does NOT block
- [ ] Step 2 prompt still functions identically when no Project Principles file exists
- [ ] Step 5 review gains Project Principles checking only when file is present
- [ ] All changes gated behind "if exists" / "if Project Principles exist" language

**Files Touched**:
- `docs/plans/AI-Plan-Hardening-Runbook.md`
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`

**Stop Condition**: If any change makes Project Principles mandatory (blocking) → STOP.

---

### Slice 4: Branch-Aware Workflow — Runbook & Template Changes
**Goal**: Add branch strategy guidance to the hardening pipeline
**Estimated Time**: 45 min
**Parallelism**: `[parallel-safe]` Group A
**Depends On**: None
**Inputs**: Current runbook, rollback protocol section
**Outputs**: Updated runbook with branch strategy options and preflight check

**Context Files**:
- `docs/plans/AI-Plan-Hardening-Runbook.md`
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
- `.github/instructions/git-workflow.instructions.md`

**Tasks**:
1. In `AI-Plan-Hardening-Runbook.md` → after Template 1 (Scope Contract) `### Forbidden Actions`, add:
   ```markdown
   ### Branch Strategy (Optional)
   
   Declare the branching approach for this phase. If omitted, defaults to
   trunk-based (work on current branch).
   
   | Strategy | When to Use | Convention |
   |----------|-------------|-----------|
   | **Trunk** | Micro/Small changes (<2 hrs) | Work on `main`, commit directly |
   | **Feature branch** | Medium changes (2–8 hrs) | `feature/phase-N-description` |
   | **Branch-per-slice** | Large/risky changes (1+ days) | `phase-N/slice-K-description` |
   
   **Branch**: (e.g., `feature/phase-12-user-profiles` or "trunk")
   **Created from**: (e.g., `main` at commit `abc1234`)
   ```
2. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 1 (Preflight prompt), add check 7:
   ```
   7. BRANCH CHECK — Does the plan declare a Branch Strategy?
      If yes: confirm current branch matches the plan's declared branch.
      If no: recommend a strategy based on estimated effort.
      Report: ✅ on correct branch / ❌ wrong branch / ⚠️ no strategy declared
   ```
   Add row to the summary table:
   ```
   | Branch check | ✅/⚠️/❌ | ... |
   ```
3. In `AI-Plan-Hardening-Runbook.md` → Section 10 (Rollback Protocol), enhance Option 3 with naming conventions:
   ```markdown
   ### Option 3: Branch-Per-Slice (Safest — Recommended for Large Phases)
   
   **Naming convention**: `phase-N/slice-K-short-description`
   
   ```bash
   # Before each slice
   git checkout -b phase-12/slice-1-db-migration
   
   # After validation passes
   git checkout feature/phase-12-user-profiles
   git merge phase-12/slice-1-db-migration --no-ff -m "phase-12/slice-1: database migration"
   
   # If validation fails
   git checkout feature/phase-12-user-profiles
   git branch -D phase-12/slice-1-db-migration
   ```
   
   **Parallel slice branches**: When slices in the same Parallel Group use
   branch-per-slice, create all branches from the same base commit. Merge
   them sequentially after the Parallel Merge Checkpoint passes.
   ```
4. In `AI-Plan-Hardening-Runbook.md` → Step 4 (Execute with Validation Loop), add after step 7 (COMMIT):
   ```
   7b. BRANCH — If Branch Strategy is feature-branch or branch-per-slice,
       confirm you are on the correct branch before the next slice.
   ```

**Validation Gate**:
- [ ] Default behavior (no branch strategy declared) matches current behavior (trunk)
- [ ] Preflight outputs ⚠️ (not ❌) when no branch strategy — does NOT block
- [ ] Rollback Option 3 naming convention is consistent with existing examples
- [ ] No automated branch creation — guidance only

**Files Touched**:
- `docs/plans/AI-Plan-Hardening-Runbook.md`
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`

---

### Parallel Merge Checkpoint (after Group A: Slices 1, 2, 4)

- [ ] All Group A slices passed their validation gates
- [ ] Runbook changes from Slices 1 and 4 don't conflict (different sections)
- [ ] Project Principles files from Slice 2 are standalone (no runbook edits in Slice 2) 
- [ ] All additions gated behind "optional" / "if exists" language
- [ ] Re-anchor: all changes remain in-scope

---

### Slice 5: Traceability — Requirements Register
**Goal**: Add optional requirements register to Step 0 and traceability checking to Step 5
**Estimated Time**: 30 min
**Parallelism**: `[sequential]`
**Depends On**: Slice 1 (uses the Spec Source field pattern)
**Inputs**: Updated runbook from Slice 1
**Outputs**: Requirements register template + Definition of Done update

**Context Files**:
- `docs/plans/AI-Plan-Hardening-Runbook.md` (post-Slice 1)
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md` (post-Slice 1)

**Tasks**:
1. In `AI-Plan-Hardening-Runbook.md` → after Template 2 (Required Decisions), add a new optional template block:
   ```markdown
   ### Template 2b — Requirements Register (Optional)
   
   ```markdown
   ## Requirements Register
   
   > **Optional**: Populate this when traceability from requirements to
   > slices matters (regulated, spec-driven, or multi-team projects).
   > When populated, Step 5 will verify bidirectional traceability.
   > When empty, traceability checks are skipped entirely.
   
   | ID | Requirement | Priority | Source |
   |----|-------------|----------|--------|
   | REQ-001 | (e.g., Users can reset passwords via email) | P1 | (spec.md or stakeholder) |
   | REQ-002 | (e.g., Password reset tokens expire after 1 hour) | P1 | (spec.md §3.2) |
   | REQ-003 | (e.g., Audit log records all password resets) | P2 | (compliance) |
   ```
   ```
2. In `AI-Plan-Hardening-Runbook.md` → Template 5 (Definition of Done), add a new optional checkbox under "Drift & Quality":
   ```markdown
   - [ ] Requirements traceability verified (if Requirements Register populated):
     - [ ] Every REQ-xxx traced to at least one slice
     - [ ] Every slice traces to at least one REQ-xxx
   ```
3. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 2 (Hardening prompt), add:
   ```
   If a Requirements Register is present, ensure each Execution Slice includes
   a "Traces to" field (e.g., "Traces to: REQ-001, REQ-003"). Flag any
   requirement with no corresponding slice as a gap.
   ```
4. In `AI-Plan-Hardening-Runbook-Instructions.md` → Step 5 (Review prompt), the Part C added in Slice 1 already covers traceability checking. Verify it references the Requirements Register:
   ```
   For Part C: Use the Requirements Register (if present) OR the external
   Specification Source (if referenced) as the source of truth.
   ```

**Validation Gate**:
- [ ] Requirements Register is clearly marked "Optional"
- [ ] Step 5 Part C works with both internal register AND external spec
- [ ] All traceability checks skipped when neither register nor spec exists
- [ ] `REQ-xxx` format used consistently

**Files Touched**:
- `docs/plans/AI-Plan-Hardening-Runbook.md`
- `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`

---

### Slice 6: Extension Ecosystem — Directory Convention & Manifest
**Goal**: Define the extension folder structure, manifest schema, and documentation
**Estimated Time**: 60 min
**Parallelism**: `[parallel-safe]` Group B
**Depends On**: None
**Inputs**: Extension design requirements from overview
**Outputs**: Extension documentation, manifest schema, example template

**Context Files**:
- `CUSTOMIZATION.md`
- `setup.ps1`

**Tasks**:
1. Create `docs/EXTENSIONS.md` documenting the extension system:
   ```markdown
   # Extensions
   
   > **Optional**: Extensions let teams share custom reviewers, prompts,
   > and instruction files as installable packages.
   
   ## Overview
   
   An extension is a folder containing guardrail files that can be
   installed into any project using the AI Plan Hardening Pipeline.
   No runtime, no dependencies, no build step — just folders you copy.
   
   ## Structure
   
   ```
   .plan-hardening/
   └── extensions/
       ├── extensions.json              ← manifest of installed extensions
       └── <extension-name>/
           ├── extension.json           ← metadata (name, version, author)
           ├── instructions/            ← .instructions.md files
           ├── agents/                  ← .agent.md files
           ├── prompts/                 ← .prompt.md files
           └── README.md               ← usage documentation
   ```
   
   ## Extension Manifest (extension.json)
   
   ```json
   {
     "name": "healthcare-compliance",
     "version": "1.0.0",
     "description": "HIPAA compliance guardrails and reviewer agent",
     "author": "your-org",
     "minTemplateVersion": "1.0.0",
     "files": {
       "instructions": ["hipaa.instructions.md"],
       "agents": ["hipaa-reviewer.agent.md"],
       "prompts": ["hipaa-checklist.prompt.md"]
     }
   }
   ```
   
   ## Installing an Extension
   
   **Manual** (works everywhere):
   1. Copy the extension folder to `.plan-hardening/extensions/<name>/`
   2. Copy files from `instructions/` → `.github/instructions/`
   3. Copy files from `agents/` → `.github/agents/`
   4. Copy files from `prompts/` → `.github/prompts/`
   
   **Using setup script**:
   ```powershell
   .\setup.ps1 -InstallExtensions
   ```
   
   **Using CLI** (if installed):
   ```bash
   pharden ext install .plan-hardening/extensions/healthcare-compliance
   ```
   
   ## Creating an Extension
   
   1. Create a folder with the extension name
   2. Add `extension.json` with metadata
   3. Add your `.instructions.md`, `.agent.md`, and/or `.prompt.md` files
   4. Add a `README.md` explaining what the extension provides
   5. Distribute via GitHub repo, zip file, or any file-sharing method
   
   ## Distribution Channels
   
   | Channel | How | Best For |
   |---------|-----|----------|
   | **GitHub repo** | Clone or download | Open source extensions |
   | **Git submodule** | `git submodule add <url> .plan-hardening/extensions/<name>` | Team-shared |
   | **Manual copy** | Download and paste | Air-gapped / enterprise |
   ```

2. Create `templates/.plan-hardening/extensions/extensions.json` (empty manifest):
   ```json
   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "description": "Installed Plan Hardening extensions",
     "version": "1.0.0",
     "extensions": []
   }
   ```

3. Create `templates/.plan-hardening/extensions/example-extension/extension.json` (example):
   ```json
   {
     "name": "example-extension",
     "version": "1.0.0",
     "description": "Example extension — copy this as a starting point",
     "author": "your-name",
     "minTemplateVersion": "1.0.0",
     "files": {
       "instructions": [],
       "agents": [],
       "prompts": []
     }
   }
   ```

4. Create `templates/.plan-hardening/extensions/example-extension/README.md` with usage instructions.

**Validation Gate**:
- [ ] `EXTENSIONS.md` covers: structure, manifest, install (3 methods), create, distribute
- [ ] `extensions.json` is valid JSON
- [ ] Example extension is self-documenting
- [ ] No runtime dependencies mentioned — pure file copy

**Files Created**:
- `docs/EXTENSIONS.md`
- `templates/.plan-hardening/extensions/extensions.json`
- `templates/.plan-hardening/extensions/example-extension/extension.json`
- `templates/.plan-hardening/extensions/example-extension/README.md`

---

### Slice 7: Extension Ecosystem — Setup Script Integration
**Goal**: Add extension installation support to `setup.ps1` and `setup.sh`
**Estimated Time**: 45 min
**Parallelism**: `[sequential]`
**Depends On**: Slice 6
**Inputs**: Extension structure from Slice 6, current `setup.ps1` / `setup.sh`
**Outputs**: Updated setup scripts with extension installation step

**Context Files**:
- `setup.ps1`
- `setup.sh`
- `docs/EXTENSIONS.md` (from Slice 6)

**Tasks**:
1. Add `-InstallExtensions` switch parameter to `setup.ps1`
2. Add Step 3c to `setup.ps1` — after preset files, scan `.plan-hardening/extensions/*/extension.json`:
   - Read each `extension.json`
   - Copy `instructions/*.instructions.md` → `.github/instructions/`
   - Copy `agents/*.agent.md` → `.github/agents/`
   - Copy `prompts/*.prompt.md` → `.github/prompts/`
   - Update `extensions.json` manifest with installed extension metadata
   - Respect `-Force` flag (skip existing files by default)
3. Add equivalent logic to `setup.sh`
4. Add extension check to `validate-setup.ps1` and `validate-setup.sh`:
   ```
   Extensions: ✅ N extensions installed / ⚠️ none (optional)
   ```
5. Copy `.plan-hardening/` template during setup (Step 1) when it exists in the template root

**Validation Gate**:
- [ ] `setup.ps1 -InstallExtensions` copies extension files correctly
- [ ] Setup silently skips Step 3c when no `.plan-hardening/extensions/` directory exists
- [ ] Existing setup behavior unchanged when `-InstallExtensions` is not passed
- [ ] `validate-setup` reports extensions as ⚠️ (optional), not ❌

**Files Touched**:
- `setup.ps1`
- `setup.sh`
- `validate-setup.ps1`
- `validate-setup.sh`

**Stop Condition**: If extension installation would overwrite existing user files without `-Force` → STOP (skip silently instead).

---

### Slice 8: CLI Wrapper — Core Commands
**Goal**: Create the `pharden` CLI wrapper with init, check, status, new-phase commands
**Estimated Time**: 90 min
**Parallelism**: `[parallel-safe]` Group B
**Depends On**: None
**Inputs**: Current `setup.ps1`, `validate-setup.ps1`, `DEPLOYMENT-ROADMAP-TEMPLATE.md`
**Outputs**: `pharden.ps1` and `pharden.sh` with core commands

**Context Files**:
- `setup.ps1`
- `validate-setup.ps1`
- `docs/plans/DEPLOYMENT-ROADMAP-TEMPLATE.md`

**Tasks**:
1. Create `pharden.ps1` with the following commands:
   - `pharden init` — delegates to `setup.ps1` (passes through all params)
   - `pharden check` — delegates to `validate-setup.ps1`
   - `pharden status` — parses `DEPLOYMENT-ROADMAP.md`, prints phase table with status icons
   - `pharden new-phase <name>` — creates `Phase-N-NAME-PLAN.md` from template, adds entry to roadmap
   - `pharden branch <plan>` — reads Branch Strategy from plan, creates branch with declared name
   - `pharden help` — prints command reference
   - Every command prints the equivalent manual steps (so non-CLI users can learn)
2. Create `pharden.sh` with equivalent Bash implementations
3. Both scripts must:
   - Work from any subdirectory (find repo root via `.git`)
   - Print clear error messages when prerequisites are missing
   - Exit with meaningful codes (0=success, 1=error, 2=missing prereq)
   - Include `--help` for every command
   - Include `--dry-run` for destructive commands (new-phase, branch)

**Validation Gate**:
- [ ] `pharden help` prints all commands with descriptions
- [ ] `pharden init` delegates to `setup.ps1` correctly
- [ ] `pharden check` delegates to `validate-setup.ps1` correctly
- [ ] `pharden status` reads and displays roadmap phases
- [ ] `pharden new-phase test-feature --dry-run` shows what would be created without creating it
- [ ] Each command shows "Equivalent manual steps:" before execution

**Files Created**:
- `pharden.ps1`
- `pharden.sh`

---

### Slice 9: CLI Wrapper — Extension Commands
**Goal**: Add extension management commands to the CLI
**Estimated Time**: 30 min
**Parallelism**: `[sequential]`
**Depends On**: Slice 7 (extension setup integration), Slice 8 (CLI core)
**Inputs**: CLI from Slice 8, extension system from Slices 6–7
**Outputs**: CLI with `ext install`, `ext list`, `ext remove` commands

**Context Files**:
- `pharden.ps1` (from Slice 8)
- `pharden.sh` (from Slice 8)
- `docs/EXTENSIONS.md` (from Slice 6)

**Tasks**:
1. Add to `pharden.ps1`:
   - `pharden ext install <path>` — copies extension from path to `.plan-hardening/extensions/`, runs installation
   - `pharden ext list` — reads `extensions.json`, prints table of installed extensions
   - `pharden ext remove <name>` — removes extension files from `.github/` directories, updates manifest
2. Add equivalent commands to `pharden.sh`
3. `ext remove` should prompt for confirmation (unless `--force`)
4. `ext install` should validate `extension.json` exists in the source path

**Validation Gate**:
- [ ] `pharden ext list` works with empty extensions (shows "No extensions installed")
- [ ] `pharden ext install` validates extension.json before copying
- [ ] `pharden ext remove` prompts before deleting (unless `--force`)
- [ ] All commands show equivalent manual steps

**Files Touched**:
- `pharden.ps1`
- `pharden.sh`

---

### Parallel Merge Checkpoint (after Group B: Slices 6, 8)

- [ ] Extension docs (Slice 6) and CLI core (Slice 8) don't conflict
- [ ] CLI `ext` subcommand references match extension directory structure
- [ ] No shared file edits between Group B slices
- [ ] Re-anchor: all changes remain in-scope

---

### Slice 10: Setup Script Updates — Project Principles & Templates
**Goal**: Wire project principles template and new files into the standard setup flow
**Estimated Time**: 30 min
**Parallelism**: `[sequential]`
**Depends On**: Slices 2, 6, 7
**Inputs**: All new template files from prior slices
**Outputs**: Updated setup scripts that copy new files during project bootstrapping

**Context Files**:
- `setup.ps1`
- `setup.sh`

**Tasks**:
1. In `setup.ps1` Step 1 (Core planning files), add:
   - `PROJECT-PRINCIPLES-TEMPLATE.md` → `docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md`
2. In `setup.ps1` Step 2 (Shared instruction files), add:
   - `project-principles.instructions.md` → `.github/instructions/project-principles.instructions.md`
3. In `setup.ps1`, add Step 3c for extension template:
   - Copy `.plan-hardening/extensions/extensions.json` → `.plan-hardening/extensions/extensions.json`
   - Copy `.plan-hardening/extensions/example-extension/` → `.plan-hardening/extensions/example-extension/`
   - Only when source exists (skip silently otherwise)
4. Add project principles prompt to all preset prompt directories (or templates/ shared):
   - `project-principles.prompt.md` → `.github/prompts/project-principles.prompt.md`
5. Apply equivalent changes to `setup.sh`
6. Update "Next steps" output to mention project principles:
   ```
   10. Optional: Run .github/prompts/project-principles.prompt.md to define project principles
   ```

**Validation Gate**:
- [ ] `setup.ps1` copies project principles template to target project
- [ ] `setup.ps1` copies project principles instruction file to target project
- [ ] Setup skips `.plan-hardening/` copy when template directory doesn't exist
- [ ] "Next steps" output mentions project principles as optional
- [ ] Existing setup flow unaffected for all presets

**Files Touched**:
- `setup.ps1`
- `setup.sh`

---

### Slice 11: Validation Script Updates
**Goal**: Update `validate-setup.ps1` and `validate-setup.sh` to check for new optional files
**Estimated Time**: 20 min
**Parallelism**: `[sequential]`
**Depends On**: Slice 10
**Inputs**: Updated setup scripts from Slice 10
**Outputs**: Validation scripts that report on project principles, extensions, and CLI

**Context Files**:
- `validate-setup.ps1`
- `validate-setup.sh`

**Tasks**:
1. In `validate-setup.ps1`, add optional checks:
   ```
   Project Principles:   ✅ found (N principles) / ⚠️ not created (optional)
   Extensions:     ✅ N installed / ⚠️ none (optional)
   CLI:            ✅ pharden.ps1 found / ⚠️ not installed (optional)
   ```
2. Apply equivalent changes to `validate-setup.sh`
3. All new checks must output ⚠️ (not ❌) when missing — they are optional

**Validation Gate**:
- [ ] Validation script passes on a project with zero new features (backward compatible)
- [ ] New checks output ⚠️ for missing optional files
- [ ] No existing checks modified

**Files Touched**:
- `validate-setup.ps1`
- `validate-setup.sh`

---

### Slice 12: Documentation Updates — README & CUSTOMIZATION
**Goal**: Update top-level documentation to describe new capabilities
**Estimated Time**: 30 min
**Parallelism**: `[sequential]`
**Depends On**: All prior slices
**Inputs**: All new files and features from Slices 1–11
**Outputs**: Updated README.md and CUSTOMIZATION.md

**Context Files**:
- `README.md`
- `CUSTOMIZATION.md`

**Tasks**:
1. In `README.md`, add to the features list:
   - Project Principles ceremony (optional project principles)
   - External specification support (optional upstream spec-driven workflow integration)
   - Requirements traceability (optional REQ-xxx → slice mapping)
   - Branch strategy guidance (optional branching conventions)
   - Extension ecosystem (optional shared guardrails)
   - CLI wrapper (optional developer automation)
2. In `CUSTOMIZATION.md`, add sections:
   - "Setting Up a Project Principles" — link to project principles prompt and template
   - "Using External Specifications" — guide for users with existing specification files
   - "Installing Extensions" — link to `docs/EXTENSIONS.md`
   - "CLI Quick Reference" — `pharden help` command list
3. Add mention of `PROJECT-PRINCIPLES-TEMPLATE.md` and `EXTENSIONS.md` to the `copilot-instructions.md` template:
   ```markdown
   - **Project Principles**: `docs/plans/PROJECT-PRINCIPLES.md` (if created)
   - **Extensions**: `docs/EXTENSIONS.md`
   ```

**Validation Gate**:
- [ ] README mentions all 6 new capabilities as "optional"
- [ ] CUSTOMIZATION has working links to all new files
- [ ] `copilot-instructions.md.template` updated with new file references
- [ ] No existing documentation removed or rewritten

**Files Touched**:
- `README.md`
- `CUSTOMIZATION.md`
- `templates/copilot-instructions.md.template`

---

### Slice 13: Preset Updates — Add Project Principles Prompt to All Presets
**Goal**: Ensure the project principles prompt is available in all tech stack presets
**Estimated Time**: 20 min
**Parallelism**: `[sequential]`
**Depends On**: Slice 2 (project principles prompt created)
**Inputs**: Project Principles prompt template from Slice 2, all preset directories
**Outputs**: Project Principles prompt copied to all 5 preset prompt directories

**Context Files**:
- `templates/.github/prompts/project-principles.prompt.md`
- Preset directories: `presets/dotnet/`, `presets/typescript/`, `presets/python/`, `presets/java/`, `presets/go/`

**Tasks**:
1. Copy `project-principles.prompt.md` to each preset's `.github/prompts/` directory:
   - `presets/dotnet/.github/prompts/project-principles.prompt.md`
   - `presets/typescript/.github/prompts/project-principles.prompt.md`
   - `presets/python/.github/prompts/project-principles.prompt.md`
   - `presets/java/.github/prompts/project-principles.prompt.md`
   - `presets/go/.github/prompts/project-principles.prompt.md`
2. Copy `project-principles.instructions.md` to each preset's `.github/instructions/` directory:
   - `presets/dotnet/.github/instructions/project-principles.instructions.md`
   - `presets/typescript/.github/instructions/project-principles.instructions.md`
   - `presets/python/.github/instructions/project-principles.instructions.md`
   - `presets/java/.github/instructions/project-principles.instructions.md`
   - `presets/go/.github/instructions/project-principles.instructions.md`
3. Verify the files are identical across all presets (same source)

**Validation Gate**:
- [ ] Project Principles prompt exists in all 5 preset directories
- [ ] Project Principles instruction file exists in all 5 preset directories
- [ ] All copies are byte-identical to the template source
- [ ] No existing preset files modified

**Files Created**:
- 10 new files (2 per preset × 5 presets)

---

## Re-anchor Checkpoints

After completing each slice, the executing agent MUST:

- [ ] Re-read the **Scope Contract** — confirm all changes are in-scope
- [ ] Re-read the **Forbidden Actions** — confirm nothing off-limits was touched
- [ ] Re-read the **Stop Conditions** — confirm no halt triggers fired
- [ ] Summarize what changed in ≤ 5 bullets
- [ ] Record validation gate results (pass/fail with output)
- [ ] Confirm the next slice's inputs are ready
- [ ] Confirm the next slice's dependencies are satisfied

> If any checkbox fails: STOP execution and report the issue.

---

## Definition of Done

This phase is COMPLETE when ALL of the following are true:

### Build & Quality

- [ ] All 13 execution slices have passed their individual validation gates
- [ ] All re-anchor checkpoints passed (no drift detected)
- [ ] No existing file behavior changed for current users

### New Capabilities (all optional)

- [ ] Project Principles ceremony works end-to-end (prompt → template → pipeline integration)
- [ ] External specification support works when spec is referenced, skipped when absent
- [ ] Requirements traceability works when register is populated, skipped when absent
- [ ] Branch strategy documented, preflight checks it, defaults to trunk when absent
- [ ] Extension system documented, setup installs them, skipped when no extensions exist
- [ ] CLI wrapper works for all documented commands, `--help` on all subcommands

### Documentation & Guardrails

- [ ] README and CUSTOMIZATION updated with all new capabilities
- [ ] `copilot-instructions.md.template` updated with new file references
- [ ] All new files described as "optional" in user-facing documentation
- [ ] Reviewer Gate passed (run in fresh agent session)
- [ ] Zero 🔴 Critical findings
- [ ] Drift Detection audit passed (run in fresh agent session)
- [ ] `DEPLOYMENT-ROADMAP.md` status updated to ✅ Complete
- [ ] Post-Mortem template completed

### Sign-Off

- [ ] Human review confirms all additions are non-disruptive
- [ ] Existing `setup.ps1` / `setup.sh` flow tested without new features
- [ ] At least one preset (dotnet) tested end-to-end with all new features

---

## Stop Conditions (Execution Must Halt)

Execution STOPS immediately if:

1. Any change **breaks existing behavior** for users who don't use the new features
2. Any new check in preflight returns **❌ (blocking)** instead of ⚠️ (optional)
3. Any file from `docs/plans/examples/` is modified
4. A **runtime dependency** (Python, Node.js, etc.) would be introduced
5. The **3-session isolation model** would be compromised
6. An existing Step (0–5) would be **renumbered**
7. Any new feature is **not gated** behind "optional" / "if exists" language

When stopped:
- Report what triggered the halt
- Do NOT attempt to work around the issue
- Wait for human resolution before continuing

---

## Post-Mortem

### What Went Well
- (to be completed after execution)

### What Drifted
- (to be completed after execution)

### What Was Underestimated
- (to be completed after execution)

### Guardrail Gaps Discovered
- (to be completed after execution)

### Changes to Make for Next Phase
- [ ] (to be completed after execution)
