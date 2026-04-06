# Using This Framework with GitHub Copilot in VS Code

> **Purpose**: Practical guide for running the Plan Forge Pipeline using GitHub Copilot's Agent Mode in VS Code  
> **Audience**: Developers using GitHub Copilot (free, Pro, or Enterprise) in VS Code  
> **Last Updated**: 2026-03-20

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [How Copilot Reads Your Guardrails](#how-copilot-reads-your-guardrails)
3. [The 3-Session Workflow in Practice](#the-3-session-workflow-in-practice)
4. [Agent Mode vs Ask Mode vs Edit Mode](#agent-mode-vs-ask-mode-vs-edit-mode)
5. [Managing Context Budget](#managing-context-budget)
6. [Using Memory to Bridge Sessions](#using-memory-to-bridge-sessions)
7. [Referencing Files in Prompts](#referencing-files-in-prompts)
8. [Tips for Better Agent Execution](#tips-for-better-agent-execution)
   - [Prompt Templates, Agent Definitions & Skills](#0-use-prompt-templates-agent-definitions--skills)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Minimum |
|-------------|---------|
| **VS Code** | 1.96+ (January 2026 or later) |
| **GitHub Copilot** | Free, Pro, or Enterprise plan |
| **Copilot Chat extension** | Latest version (auto-updates) |
| **Agent Mode** | Enabled (Settings → `github.copilot.chat.agent.enabled`) |

### Verify Setup

1. Open VS Code
2. Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Shift+I` (macOS) to open Copilot Chat
3. At the bottom of the chat panel, confirm you can switch between **Ask**, **Edit**, and **Agent** modes
4. Select **Agent** mode — you should see the tools indicator (terminal, file edit, search)

---

## How Copilot Reads Your Guardrails

### Automatic Instruction Loading

GitHub Copilot reads instruction files **automatically** based on two mechanisms:

#### 1. `.github/copilot-instructions.md` (Always Loaded)

This file is loaded into **every** Copilot Chat session in your workspace. It's your global context — project overview, tech stack, coding standards.

```
.github/copilot-instructions.md  ← Copilot reads this EVERY time
```

#### 2. `.github/instructions/*.instructions.md` (Conditionally Loaded)

These files load **only when you're editing a matching file**, based on the `applyTo` glob pattern in their YAML frontmatter:

```yaml
---
description: Database patterns and conventions
applyTo: '**/*.sql'           # ← Only loads when editing .sql files
priority: HIGH
---
```

**Common `applyTo` patterns:**

| Pattern | When It Loads |
|---------|---------------|
| `'**'` | Every file (use sparingly — eats context budget) |
| `'**/*.cs'` | Any C# file |
| `'**/*.ts'` | Any TypeScript file |
| `'**/*.py'` | Any Python file |
| `'**/*.razor'` | Any Blazor Razor file |
| `'docs/plans/**'` | Any file under docs/plans/ |
| `'**/Controllers/**'` | Files in any Controllers directory |
| `'docker-compose*.yml'` | Docker Compose files |

#### What This Means for Plan Hardening

The `ai-plan-hardening-runbook.instructions.md` file has `applyTo: 'docs/plans/**'`, so Copilot automatically loads the runbook quick-reference whenever you're editing plan files. The `architecture-principles.instructions.md` has `applyTo: '**'`, so it's always active.

### Load Order

```
1. .github/copilot-instructions.md       ← Always loaded first
2. .github/instructions/*.instructions.md ← Loaded if applyTo matches current file
3. Your prompt                            ← Your message in chat
4. Attached files                         ← Files you explicitly reference
```

> **Tip**: Keep `copilot-instructions.md` concise. Long files consume your context window and leave less room for code.

---

## The 3-Session Workflow in Practice

The pipeline uses **4 sessions** to prevent context bleed. Here's exactly how to do that in VS Code:

### Session 1: Specify & Plan Hardening

1. **Open a new chat**: `Ctrl+Shift+I` → click the `+` (new conversation) button
2. **Select Agent mode** (bottom of chat panel)
3. **Attach** `.github/prompts/step0-specify-feature.prompt.md` to define the feature (or skip if requirements are clear)
4. **Attach** `.github/prompts/step1-preflight-check.prompt.md` (Step 1 — Pre-flight)
5. Wait for results
6. **Attach** `.github/prompts/step2-harden-plan.prompt.md` (Step 2) in the same session
7. Review the hardened plan output
8. **Save context to memory** (see [Using Memory](#using-memory-to-bridge-sessions) below)

> **Agent alternative**: Select the **Specifier** agent, describe your feature, then click **"Start Plan Hardening →"** when the spec is done. The Plan Hardener handles Steps 1–2 automatically.

### Session 2: Execution

**Automatic execution** (recommended):
```bash
# Full Auto — gh copilot CLI executes all slices
pforge run-plan docs/plans/Phase-1-YOUR-PLAN.md

# Assisted — you code in VS Code, orchestrator validates gates
pforge run-plan --assisted docs/plans/Phase-1-YOUR-PLAN.md

# Estimate cost without executing
pforge run-plan --estimate docs/plans/Phase-1-YOUR-PLAN.md
```
Monitor at `localhost:3100/dashboard` for live slice progress, cost tracking, and session replay.

**Manual execution** (step-by-step in Copilot Chat):
1. **Start a NEW chat session**: Click `+` again (critical — don't reuse Session 1)
2. **Select Agent mode**
3. **Attach** `.github/prompts/step3-execute-slice.prompt.md` (Step 3)
4. Let the agent work slice-by-slice
5. After all slices pass, **attach** `.github/prompts/step4-completeness-sweep.prompt.md` (Step 4)
6. Review and commit

> **Agent alternative**: Click **"Start Execution →"** from the Plan Hardener handoff. The Executor handles Steps 3–4 with built-in skill awareness.

### Session 3: Review & Audit

1. **Start a NEW chat session**: Click `+` again
2. **Select Agent mode** (or Ask mode for enforced read-only)
3. **Attach** `.github/prompts/step5-review-gate.prompt.md` (Step 5)
4. The reviewer audits without modifying files
5. If critical findings: start a new Session 2 to fix

> **Agent alternative**: Click **"Run Review Gate →"** from the Executor handoff. If it passes, click **"Ship It →"**. If LOCKOUT, click **"Fix Issues →"** to return to the Executor.

### Session 4: Ship

1. **Start a NEW chat session** (or continue if context allows)
2. **Attach** `.github/prompts/step6-ship.prompt.md` (Step 6)
3. The agent commits, updates the roadmap, captures postmortem, and optionally pushes

> **Agent alternative**: Click **"Ship It →"** from the Reviewer Gate. The Shipper agent handles everything automatically.

### Why Separate Sessions Matter

| Problem | Single Session | Separate Sessions |
|---------|---------------|-------------------|
| **Context bleed** | Agent remembers its own shortcuts | Fresh perspective |
| **Self-audit bias** | "I wrote it, looks right" | Independent judgment |
| **Context exhaustion** | Runs out of context budget | Full budget per session |
| **Drift accumulation** | Small drifts compound unseen | Each session re-grounds |
| **Forgotten cleanup** | Manual commit/roadmap steps | Shipper agent automates |

---

## Agent Mode vs Ask Mode vs Edit Mode

Use the right mode for each step:

| Mode | What It Does | When to Use |
|------|-------------|-------------|
| **Agent** | Reads files, runs terminal commands, edits files, searches codebase | **Execution** (Step 3), **Sweep** (Step 4) |
| **Ask** | Answers questions, analyzes code (read-only) | **Review** (Step 5), **Pre-flight** (Step 1) |
| **Edit** | Modifies a specific file inline | Quick fixes flagged by reviewer |

### Mode Selection by Pipeline Step

| Step | Recommended Mode | Why |
|------|-----------------|-----|
| Step 1: Pre-flight | **Agent** | Needs to run git commands and check files |
| Step 2: Harden | **Agent** | Needs to read plan + guardrails, write output |
| Step 3: Execute | **Agent** | Needs full tool access (edit, terminal, search) |
| Step 4: Sweep | **Agent** | Needs to search and edit files |
| Step 5: Review | **Ask** or **Agent** | Read-only audit (Ask prevents accidental edits) |

> **Pro Tip**: For the Reviewer Gate (Step 5), using **Ask mode** physically prevents the agent from modifying files, enforcing the read-only audit requirement.

---

## Managing Context Budget

Copilot has a finite context window. Large projects can exhaust it quickly. Strategies:

### Keep Instruction Files Focused

```yaml
# ❌ BAD: One huge file that loads everywhere
---
applyTo: '**'
---
# 500 lines of everything...

# ✅ GOOD: Targeted files that load only when needed
---
applyTo: '**/*.sql'
---
# 80 lines of database-specific rules
```

### Use `@workspace` Sparingly

The `@workspace` reference indexes your entire workspace. Use it when you need broad search:

```
@workspace where is the user authentication handled?
```

But for execution slices, reference specific files instead:

```
Read docs/plans/Phase-5-NOTIFICATIONS-PLAN.md and .github/instructions/testing.instructions.md
then execute Slice 3.
```

### Split Large Phases

If a phase has 10+ slices, the agent may run out of context before finishing. Plan for session breaks:

```
Slice 1-5:  Execute in Session 2a
Slice 6-10: Execute in Session 2b (new chat, resume from Slice 6)
```

When resuming, tell the agent:
```
Slices 1-5 are complete and committed. Resume from Slice 6 of
docs/plans/Phase-5-NOTIFICATIONS-PLAN.md.
Load the Scope Contract and Stop Conditions before starting.
```

---

## Using Memory to Bridge Sessions

Copilot's memory system lets you persist context between sessions. This is valuable for the 3-session pipeline.

### Memory Scopes

| Scope | Path | Persists | Use For |
|-------|------|----------|---------|
| **User** | `/memories/` | Across all workspaces | Personal patterns, general insights |
| **Session** | `/memories/session/` | Current conversation only | Slice progress, in-flight notes |
| **Repository** | `/memories/repo/` | This workspace | Phase outcomes, codebase conventions |

### Bridging Session 1 → Session 2

After hardening (Session 1), save key context to repo memory:

```
Save to /memories/repo/current-phase.md:
- Phase name and plan file path
- Key decisions resolved during hardening
- Any warnings or risks identified
- Which slices are parallel-safe vs sequential
```

Then in Session 2, the agent can read this memory to orient itself without re-processing.

### Bridging Session 2 → Session 3

After execution (Session 2), update the memory:

```
Update /memories/repo/current-phase.md with:
- Which slices completed successfully
- Any amendments made during execution
- Files created or modified (summary)
- Completeness sweep results
```

The Session 3 reviewer can then read this for context on what was done.

### Post-Phase Cleanup

After the phase is fully complete and committed, clean up:

```
Delete /memories/repo/current-phase.md — phase is done.
Update /memories/repo/lessons-learned.md with any new patterns discovered.
```

---

## Referencing Files in Prompts

### Explicit File References

When pasting prompts, reference files explicitly so the agent loads them:

```
Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md
2. docs/plans/Phase-5-NOTIFICATIONS-PLAN.md
3. .github/copilot-instructions.md
4. .github/instructions/testing.instructions.md
```

### Using `#file` References

In Copilot Chat, you can reference files directly with `#file`:

```
#file:docs/plans/Phase-5-NOTIFICATIONS-PLAN.md
Execute Slice 3 from this plan.
```

### Using `@workspace` for Discovery

```
@workspace find all files related to user notifications
```

### Attaching Files via UI

You can also click the **paperclip icon** in the chat input to attach files manually. This is useful for plans that aren't in the standard location.

---

## Tips for Better Agent Execution

### 0. Use Prompt Templates, Agent Definitions & Skills

This framework ships three categories of agentic files beyond instruction files. Each serves a distinct role in AI-assisted development:

#### Prompt Templates (`.github/prompts/`)

Pre-built scaffolding recipes that agents use to generate consistent code. Each prompt defines the full checklist an agent follows when creating a new entity, service, controller, test, or worker.

**How to use in Copilot Chat**:
```
#file:.github/prompts/new-entity.prompt.md
Create a Product entity with name, price, and category fields.
```

Or use the VS Code **prompt picker** — open the Command Palette (`Ctrl+Shift+P`) → "GitHub Copilot: Use Prompt" → select a prompt template.

**Available prompts** (15 per app preset):
| Template | When to Use |
|----------|-------------|
| `bug-fix-tdd.prompt.md` | Fixing a bug using Red-Green-Refactor |
| `new-config.prompt.md` | Creating typed configuration with validation |
| `new-controller.prompt.md` | Adding a REST API endpoint |
| `new-dockerfile.prompt.md` | Creating a multi-stage Dockerfile |
| `new-dto.prompt.md` | Defining request/response DTOs with validation |
| `new-entity.prompt.md` | Adding a new database-backed entity end-to-end |
| `new-error-types.prompt.md` | Defining custom exception hierarchy |
| `new-event-handler.prompt.md` | Creating an event/message handler with retry |
| `new-graphql-resolver.prompt.md` | Adding a GraphQL resolver with DataLoader |
| `new-middleware.prompt.md` | Adding request pipeline middleware |
| `new-repository.prompt.md` | Creating a data access layer |
| `new-service.prompt.md` | Creating a business logic service with DI |
| `new-test.prompt.md` | Writing unit or integration tests |
| `new-worker.prompt.md` | Adding a background job or scheduled task |
| `project-principles.prompt.md` | Defining non-negotiable project principles and forbidden patterns |

#### Agent Definitions (`.github/agents/`)

Specialized reviewer and executor roles that agents can adopt. Each agent definition includes a persona, checklist, tool access rules, and output format. They're designed for focused audits — agents can **read and search** but not edit files.

**How to invoke an agent** — three ways:

1. **Agent picker** (recommended for beginners): Click the agent dropdown at the top of the Chat view → select an agent by name (e.g., "Security Reviewer"). The agent's instructions and tool restrictions load automatically.

2. **File reference**: Reference the agent file in your prompt:
   ```
   #file:.github/agents/security-reviewer.agent.md
   Review the authentication flow in src/auth/ for OWASP Top 10 vulnerabilities.
   ```

3. **Pipeline handoff**: When using pipeline agents (Specifier → Plan Hardener → Executor → Reviewer Gate → Shipper), click the handoff button that appears after each agent completes. Context carries over automatically.

**Available agents** (6 stack-specific + 7 cross-stack + 5 pipeline):
| Agent | When to Use |
|-------|-------------|
| `architecture-reviewer.agent.md` | Before merging — audit layer separation and patterns |
| `security-reviewer.agent.md` | Before deploy — check for injection, auth gaps, secrets |
| `database-reviewer.agent.md` | After schema changes — verify SQL safety, N+1, naming |
| `performance-analyzer.agent.md` | After features — find hot paths, allocation issues |
| `test-runner.agent.md` | After changes — run tests and diagnose failures |
| `deploy-helper.agent.md` | Release time — build, push, migrate, verify |
| `api-contract-reviewer.agent.md` | API changes — versioning, backward compatibility, OpenAPI |
| `accessibility-reviewer.agent.md` | UI changes — WCAG 2.2, ARIA, keyboard nav, contrast |
| `multi-tenancy-reviewer.agent.md` | Data access — tenant isolation, RLS, cache separation |
| `cicd-reviewer.agent.md` | Pipeline changes — promotion, secrets, rollback safety |
| `observability-reviewer.agent.md` | After features — logging, tracing, metrics, health checks |
| `dependency-reviewer.agent.md` | Before merge/release — CVEs, outdated packages, license conflicts |
| `compliance-reviewer.agent.md` | Data features — GDPR, CCPA, SOC2, PII handling, audit logging |
| `specifier.agent.md` | Step 0 — interviews user to define what & why (pipeline) |
| `plan-hardener.agent.md` | Step 2 — hardens plans into execution contracts (pipeline) |
| `executor.agent.md` | Step 3 — executes slices with validation gates (pipeline) |
| `reviewer-gate.agent.md` | Step 5 — read-only audit for drift and violations (pipeline) |
| `shipper.agent.md` | Post-review — commits, updates roadmap, captures postmortem (pipeline) |

#### Skills (`.github/skills/{name}/SKILL.md`)

Multi-step executable procedures that chain together tool calls. Each skill file defines a step-by-step workflow with validation gates between steps.

**How to use in Copilot Chat** — two ways:

1. **Slash command** (recommended): Type `/` in the chat input and select the skill:
   ```
   /database-migration add an "orders" table with the columns described in the plan
   /staging-deploy the API service
   /test-sweep
   ```

2. **File reference**: Reference the skill file directly:
   ```
   #file:.github/skills/database-migration/SKILL.md
   Create a migration to add an "orders" table.
   ```

**Available skills** (varies by preset):
| Skill | Slash Command | When to Use |
|-------|--------------|-------------|
| `database-migration/` | `/database-migration` | Creating, validating, and deploying schema changes |
| `staging-deploy/` | `/staging-deploy` | Full deployment pipeline from build to verification |
| `test-sweep/` | `/test-sweep` | Running all test suites with aggregated reporting |
| `dependency-audit/` | `/dependency-audit` | Scan for vulnerable, outdated, or license-conflicting packages |
| `code-review/` | `/code-review` | Comprehensive review: architecture, security, testing, patterns |
| `release-notes/` | `/release-notes` | Generate release notes from git history and CHANGELOG |
| `api-doc-gen/` | `/api-doc-gen` | Generate or update OpenAPI spec, validate consistency |
| `onboarding/` | `/onboarding` | Walk a new developer through setup, architecture, and first task |
| `health-check/` | `/health-check` | Forge diagnostic — environment, setup, completeness |
| `forge-execute/` | `/forge-execute` | Guided plan execution with cost estimate |
| `infra-deploy/` *(azure-iac)* | `/infra-deploy` | Pre-flight → what-if/plan → deploy → verify for Bicep/Terraform/azd |
| `infra-test/` *(azure-iac)* | `/infra-test` | PSScriptAnalyzer → Bicep lint → Pester → Terraform validate |
| `azure-sweep/` *(azure-iac)* | `/azure-sweep` | 8-layer governance sweep: WAF, CAF, Landing Zone, Policy, Org Rules, Resource Graph, Telemetry, Remediation |

**Auto-invocation**: Skills can also load automatically without typing `/`. When you ask "help me test the login page", Copilot reads each skill's `description` field and loads the best match (e.g., `test-sweep`). You don't need to know the slash command name — just describe what you want.

#### AI Agent Discoverability

All three file types follow consistent naming conventions for discoverability:
- **Prompts**: `*.prompt.md` in `.github/prompts/`
- **Agents**: `*.agent.md` in `.github/agents/`
- **Skills**: `SKILL.md` in `.github/skills/{name}/`

AI agents can discover available capabilities by listing these directories. The `copilot-instructions.md` file at the repo root catalogs all available prompts, agents, and skills with descriptions.

#### Lifecycle Hooks (`.github/hooks/`)

Plan Forge includes lifecycle hooks that run automatically during agent sessions — no manual activation needed.

| Hook | Effect |
|------|--------|
| **SessionStart** | Auto-injects Project Principles, current phase, and Plan Forge version into every session's context |
| **PreToolUse** | Reads the active plan's Forbidden Actions and blocks file edits to forbidden paths before they happen |
| **PostToolUse** | Auto-formats edited files with the project's formatter, then warns on TODO/FIXME/stub markers |
| **Stop** | Warns when session ends if code was modified but no test run was detected — reminds to use `/test-sweep` |

**Customizing hooks**: Edit `.github/hooks/plan-forge.json` or `.github/hooks/scripts/` to change behavior. Use `/create-hook` in chat to generate new hooks with AI assistance.

**Disabling hooks**: Remove or rename `.github/hooks/plan-forge.json` to disable all Plan Forge hooks.

#### VS Code Checkpoints

VS Code automatically creates checkpoints (snapshots) during Copilot Agent sessions. Use them for quick rollback without Git:

1. Look for checkpoint markers between messages in the Chat view
2. Click a checkpoint to preview the state
3. Click **Restore** to roll back all files to that snapshot

> **Tip**: Checkpoints are great for undoing a failed slice mid-session. For permanent rollback across sessions, use the Git options in the [Rollback Protocol](plans/AI-Plan-Hardening-Runbook.md#rollback-protocol).

### 1. Front-Load Context

Put the most important information first in your prompt. The agent pays more attention to the beginning:

```
# GOOD — context first, then action
Read the Scope Contract in Phase-5-PLAN.md. The forbidden actions are:
- Do not modify auth/ directory
- Do not add new npm packages

Now execute Slice 3.
```

### 2. One Slice at a Time

Don't ask the agent to "execute all slices." Walk it through one at a time:

```
Execute Slice 1 from Phase-5-PLAN.md.
After validation passes, I'll tell you to proceed to Slice 2.
```

### 3. Validate Before Proceeding

After each slice, explicitly check:

```
Before moving to the next slice:
1. Run the build command
2. Run the tests
3. Confirm no forbidden files were touched
4. Show me the re-anchor checklist
```

### 4. Use Terminal Verification

Agent Mode can run terminal commands. Leverage this for validation gates:

```
Run `npm test` and show me the results.
If all pass, commit with: git commit -m "phase-5/slice-3: notification service"
```

### 5. Interrupt on Drift

If you see the agent expanding scope, stop it immediately:

```
STOP. You're adding error retry logic that isn't in the Scope Contract.
Re-read the Scope Contract and Forbidden Actions, then continue with
only what Slice 3 requires.
```

---

## Troubleshooting

### "Copilot isn't reading my instruction files"

1. Verify the file is in `.github/instructions/` (exact path)
2. Check the `applyTo` pattern matches the file you're editing
3. Confirm the file has valid YAML frontmatter (the `---` delimiters)
4. Restart VS Code if you just created the file

### "Agent runs out of context mid-execution"

1. Commit the completed work
2. Open a new chat session
3. Tell it which slices are done and which to resume from
4. Reference only the files needed for the current slice

### "Agent keeps expanding scope"

1. Stop the agent immediately
2. Re-paste the Scope Contract and Forbidden Actions
3. Ask it to re-read the Stop Conditions
4. Resume from the current slice

### "Review session is modifying files"

1. Switch to **Ask mode** instead of Agent mode for reviews
2. Ask mode physically cannot edit files
3. Or explicitly state: "You are a REVIEWER. Do NOT modify any files."

### "Instruction files are too large for context"

1. Split large instruction files by domain
2. Use specific `applyTo` patterns (not `'**'`)
3. Keep each file under ~150 lines
4. Move examples to a separate reference doc if needed

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  COPILOT PLAN HARDENING — QUICK REFERENCE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Open Chat:     Ctrl+Shift+I (Win) / Cmd+Shift+I (Mac)         │
│  New Session:   Click + in chat panel                           │
│  Agent Mode:    Select at bottom of chat panel                  │
│  File Ref:      #file:path/to/file.md                           │
│  Workspace:     @workspace <search query>                       │
│                                                                 │
│  AGENTIC FILES                                                  │
│    Prompts:  .github/prompts/*.prompt.md  (15 scaffolding recipes)│
│    Agents:   .github/agents/*.agent.md    (18 per app preset)     │
│    Skills:   .github/skills/*/SKILL.md    (8 per app preset)      │
│                                                                 │
│  SESSION 1 — Harden                                             │
│    Mode: Agent                                                  │
│    Paste: Pre-flight Prompt → Hardening Prompt                  │
│    Save: Key context to /memories/repo/                         │
│                                                                 │
│  SESSION 2 — Execute                                            │
│    Mode: Agent                                                  │
│    Paste: Execution Prompt (one slice at a time)                │
│    Use: Prompt templates for scaffolding new entities           │
│    After all: Completeness Sweep Prompt                         │
│    Commit after each passed slice                               │
│                                                                 │
│  SESSION 3 — Review                                             │
│    Mode: Ask (prevents accidental edits)                        │
│    Paste: Reviewer Gate Prompt + Drift Detection Prompt         │
│    Use: Agent definitions for focused audits                    │
│    Read-only audit — report only                                │
│                                                                 │
│  MEMORY BRIDGE                                                  │
│    /memories/repo/current-phase.md — phase progress             │
│    /memories/repo/lessons-learned.md — patterns discovered      │
│                                                                 │
│  INTERRUPT                                                      │
│    Type "STOP" if agent drifts                                  │
│    Re-paste Scope Contract                                      │
│    Re-read Stop Conditions                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
