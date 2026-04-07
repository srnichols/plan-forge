# Using This Framework with GitHub Copilot in VS Code

> **Purpose**: Practical guide for running the Plan Forge Pipeline using GitHub Copilot's Agent Mode in VS Code  
> **Audience**: Developers using GitHub Copilot (free, Pro, or Enterprise) in VS Code  
> **Last Updated**: 2026-04-07

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [How Copilot Reads Your Guardrails](#how-copilot-reads-your-guardrails)
3. [The 3-Session Workflow in Practice](#the-3-session-workflow-in-practice)
4. [Single-Session Pipeline with Nested Subagents](#single-session-pipeline-with-nested-subagents)
5. [Agent Mode vs Ask Mode vs Edit Mode](#agent-mode-vs-ask-mode-vs-edit-mode)
6. [Managing Context Budget](#managing-context-budget)
7. [Using Memory to Bridge Sessions](#using-memory-to-bridge-sessions)
8. [Referencing Files in Prompts](#referencing-files-in-prompts)
9. [Tips for Better Agent Execution](#tips-for-better-agent-execution)
   - [Prompt Templates, Agent Definitions & Skills](#0-use-prompt-templates-agent-definitions--skills)
10. [Troubleshooting](#troubleshooting)
11. [Using Plan Forge with Copilot Cloud Agent](#using-plan-forge-with-copilot-cloud-agent)

---

## Prerequisites

| Requirement | Minimum |
|-------------|---------|
| **VS Code** | 1.96+ (January 2026 or later) |
| **GitHub Copilot** | Free, Pro, or Enterprise plan |
| **Copilot Chat extension** | Latest version (auto-updates) |
| **Agent Mode** | Enabled (Settings → `github.copilot.chat.agent.enabled`) |
| **Nested subagents** *(optional)* | `chat.subagents.allowInvocationsFromSubagents: true` — required for single-session pipeline; manual handoff works without it |

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

## Single-Session Pipeline with Nested Subagents

> **VS Code requirement**: `chat.subagents.allowInvocationsFromSubagents: true` (see [Prerequisites](#prerequisites))

The 6 pipeline agents can run end-to-end in a **single session** by invoking each other as nested subagents. This collapses what would otherwise be 4 separate sessions into one continuous run — no manual handoff clicks required.

### How It Works

Each agent invokes the next automatically after completing its phase:

```
Single session:
  Specifier ──subagent──► Plan Hardener ──subagent──► Executor
                                                          │
                                            ──subagent──► Reviewer Gate
                                                          │
                                              ──subagent──► Shipper
```

The plan file path is passed from agent to agent so context flows without any copy-pasting.

### Enable Nested Subagents

Add this to `.vscode/settings.json` (already included in `templates/vscode-settings.json.template`):

```json
"chat.subagents.allowInvocationsFromSubagents": true
```

Without this setting, agents still display **handoff buttons** at the end of each phase — context carries over automatically when you click them.

### Starting a Single-Session Pipeline Run

1. Open Copilot Chat (`Ctrl+Shift+I`)
2. Confirm `chat.subagents.allowInvocationsFromSubagents: true` is in `.vscode/settings.json`
3. Select **Agent** mode
4. Select the **Specifier** agent from the agent picker
5. Describe your feature — the Specifier interviews you, creates the plan file, then invokes Plan Hardener automatically
6. Each subsequent agent completes its phase and hands off to the next without requiring input

You can type at any point to pause and redirect before the next subagent invocation.

### Recursion Safety — Termination Guards

Each pipeline agent has built-in **termination guards** to prevent runaway subagent loops:

| Agent | Invokes | Guard |
|-------|---------|-------|
| **Specifier** | Plan Hardener (once) | Stops if `[NEEDS CLARIFICATION]` markers remain |
| **Plan Hardener** | Executor (once) | Stops if TBD entries are unresolved |
| **Executor** | Reviewer Gate (once) | Stops if any validation gate fails |
| **Reviewer Gate** | Shipper (PASS) or Executor (FAIL, **max 2×**) | After 2 LOCKOUT→fix cycles, requires human intervention |
| **Shipper** | — *(terminal)* | Never invokes another pipeline agent |

The LOCKOUT guard is the most critical: the Reviewer Gate → Executor → Reviewer Gate loop runs at most **2 fix cycles** before stopping and asking for human input.

### Fallback: Manual Handoff

If `chat.subagents.allowInvocationsFromSubagents` is not set (or if you prefer step-by-step control), the pipeline falls back to **manual handoff buttons** — the same clickable buttons that appear at the end of each agent's response:

| Handoff button | From → To |
|----------------|-----------|
| **Start Plan Hardening →** | Specifier → Plan Hardener |
| **Start Execution →** | Plan Hardener → Executor |
| **Run Review Gate →** | Executor → Reviewer Gate |
| **Ship It →** | Reviewer Gate → Shipper |
| **Fix Issues →** | Reviewer Gate → Executor (on LOCKOUT) |

Manual handoff provides the same context transfer — the only difference is that you click the button rather than the agent invoking automatically.

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

### Memory Layers

Plan Forge works with three distinct memory systems. Understanding the difference helps you choose the right tool for each need:

| Layer | What It Is | Scope | Managed By | Best For |
|-------|-----------|-------|------------|---------|
| **Copilot Memory** | Built-in `/memories/` note storage | User / Session / Repo | Copilot Chat natively | Personal patterns, general insights, ad-hoc notes |
| **Plan Forge Session Bridge** | Structured `/memories/repo/current-phase.md` + `lessons-learned.md` | Repository | You (via pipeline prompts) | Carrying Session 1 → 2 → 3 state through the hardening pipeline |
| **OpenBrain** | Semantic vector memory via MCP `search_thoughts` / `capture_thought` | Global (workspace-agnostic) | OpenBrain MCP server | Auto-injecting relevant prior decisions before each slice begins |

**When to use each:**
- Use **Copilot Memory** for free-form notes that don't fit the pipeline structure.
- Use the **Plan Forge Session Bridge** files to hand off structured phase state between sessions — the pipeline prompts tell you exactly what to write.
- Use **OpenBrain** when you want the agent to automatically surface relevant past decisions without any manual prompt — it hooks into `forge_run_plan` automatically.

All three layers are complementary. A typical phase uses all three: Copilot Memory for quick notes, the session bridge files for structured handoffs, and OpenBrain for long-term pattern recall.

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

**Quorum mode**: The `/code-review` skill supports `--quorum` for multi-model code review. When invoked with `--quorum`, it dispatches analysis to multiple AI models independently and synthesizes findings:
```
/code-review --quorum
```

#### Multi-Model Analysis Tools

Two MCP tools provide multi-model consensus analysis:

1. **`forge_analyze`** — consistency scoring with optional quorum mode:
   ```
   Use forge_analyze with quorum=true to get multi-model consensus on this plan
   ```

2. **`forge_diagnose`** — multi-model bug investigation:
   ```
   Use forge_diagnose on src/services/billing.ts to investigate the race condition
   ```

Both tools dispatch to multiple models (including Grok via xAI API), then synthesize findings into a single report with confidence levels.

**Setting up Grok**: To use xAI Grok models, set `XAI_API_KEY` in your environment before starting VS Code. Models like `grok-4.20`, `grok-4`, `grok-3`, `grok-3-mini` auto-route through the API provider registry. Get your key at [console.x.ai](https://console.x.ai/).

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

### "Forge run failed — where do I start?"

Use the `/forge-troubleshoot` skill to diagnose the failure:

1. Type `/forge-troubleshoot` in Copilot Chat (Agent mode)
2. Optionally describe the symptom: `/forge-troubleshoot slice 3 failed gate error`
3. The skill will:
   - Run `forge_smith` to check environment health
   - Run `forge_validate` to verify setup files
   - Run `forge_plan_status` to retrieve the last run report
   - Run `forge_sweep` to detect stubs/TODOs blocking gate passage
   - Identify the root cause and provide specific fix steps
4. After fixing, resume with: `forge_run_plan resumeFrom: <failed-slice-number>`

**Common root causes and fixes:**

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Gate error: build failed | Stub or TODO in production code | Fill in the stub, then resume |
| Gate error: test failed | Missing implementation or broken import | Fix the failing test, then resume |
| CLI worker not found | `gh copilot` / `claude` / `codex` CLI not installed | Install CLI or switch to `mode: 'assisted'` |
| MCP tools missing | `pforge-mcp/` dependencies not installed | Run `npm install --prefix pforge-mcp` |
| Cost overrun warning | Model too expensive for slice count | Switch to a cheaper model in `.forge.json` |
| Slice stalled, no output | Run hung | Use `forge_abort`, then `resumeFrom` the stalled slice |



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

## Using Plan Forge with Copilot Cloud Agent

> *"Copilot cloud agent plans. Plan Forge hardens."*

GitHub Copilot's cloud agent can work on GitHub issues autonomously — cloning your repo, making code changes, and opening pull requests. Plan Forge integrates with this workflow so the cloud agent has your guardrails, MCP tools, and validation gates ready before it writes a single line of code.

### How `copilot-setup-steps.yml` Works

GitHub runs `.github/copilot-setup-steps.yml` to provision the cloud agent's environment before it starts on an issue. Add this file to your project to ensure Plan Forge is installed and validated every time:

```bash
# Copy the template from Plan Forge into your project
cp templates/copilot-setup-steps.yml .github/copilot-setup-steps.yml
```

Then edit `.github/copilot-setup-steps.yml` to set the correct `--preset` for your stack. The template handles four steps:

| Step | What It Does |
|------|-------------|
| **Install Node.js** | Ensures Node 20+ is available for the MCP server |
| **Run `setup.sh --force`** | Installs guardrail files, instruction files, and pipeline prompts |
| **Install MCP dependencies** | Runs `npm install` in `pforge-mcp/` so all 18 MCP tools are available |
| **Configure `.vscode/mcp.json`** | Wires the MCP server into the agent's VS Code session |
| **`pforge smith`** | Post-setup health check — logs any config issues before work begins |

### How Instruction Files Auto-Load in the Cloud Agent

The cloud agent reads `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` using the same `applyTo` mechanism as local VS Code. Your guardrails load automatically:

- **Security rules** activate when the agent edits auth files
- **Database patterns** activate when the agent edits query files
- **Architecture principles** load on every file (`applyTo: '**'`)

No changes needed to your instruction files — they work identically in cloud and local sessions.

### How Plan Forge Gates Complement CodeQL and Secret Scanning

Copilot cloud agent already integrates with GitHub's code scanning (CodeQL, secret scanning, dependency review). Plan Forge adds a complementary layer that runs **before** the code reaches GitHub's scanners:

| Layer | When | What It Catches |
|-------|------|----------------|
| **Plan Forge slice gates** | During cloud agent execution | Build failures, test regressions, scope drift |
| **Copilot code review** | PR opened | Style, correctness, suggestions |
| **CodeQL** | PR/push CI | Security vulnerabilities, data flow issues |
| **Secret scanning** | Commit time | Leaked credentials |

Use `pforge run-plan --assisted` if you want the orchestrator to prompt the cloud agent per slice and validate gates automatically. The cloud agent picks up the MCP `forge_run_plan` tool from `.vscode/mcp.json`.

### Quick Setup

1. Copy `templates/copilot-setup-steps.yml` → `.github/copilot-setup-steps.yml`
2. Set `--preset` to your stack in the setup step
3. Enable Copilot cloud agent on your repository (Settings → Copilot → Coding agent)
4. Assign a GitHub issue to `@copilot` — it will provision the environment and start with your guardrails loaded

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
