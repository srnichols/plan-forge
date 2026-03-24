# Plan Forge Memory Extension

> **Purpose**: Adds persistent semantic memory to Plan Forge via [OpenBrain](https://github.com/srnichols/OpenBrain) — a self-hosted MCP memory server. Decisions, patterns, and lessons captured in one session are searchable in every future session, across any AI tool.

## The Problem This Solves

Plan Forge's 3-session model (Plan → Build → Audit) is powerful, but each session starts fresh. The hardened plan carries forward, but:

- **"Why did we decide X?"** — The rationale lives in an old chat session, gone forever
- **"Has this been tried before?"** — No way to search past sessions semantically
- **Post-mortem insights** — Written in Markdown, rarely consulted again
- **Team rotation** — New developer or different AI tool starts from zero context
- **Long-running projects** — Months of decisions become unfindable

OpenBrain solves this by giving every AI session access to a **shared, searchable memory** that persists across sessions, tools, and team members.

## What's Included

| Type | File | Purpose |
|------|------|---------|
| **Instruction** | `persistent-memory.instructions.md` | Rules for when to search and capture decisions |
| **Agent** | `memory-reviewer.agent.md` | Audits whether key decisions were captured |
| **Prompt** | `search-project-history.prompt.md` | Search OpenBrain for prior decisions and context |
| **Prompt** | `capture-decision.prompt.md` | Structured decision capture with context and rationale |

## Prerequisites

1. **OpenBrain running** — Local Docker, Supabase, or Kubernetes deployment
   - See [OpenBrain setup guide](https://github.com/srnichols/OpenBrain)
2. **MCP configured** — OpenBrain MCP server accessible from your AI client
3. **Plan Forge installed** — This extension adds to an existing Plan Forge project

### MCP Configuration

Add OpenBrain to your VS Code MCP settings (`.vscode/mcp.json`):

```json
{
  "servers": {
    "openbrain": {
      "type": "sse",
      "url": "http://localhost:8080/sse",
      "headers": {
        "x-brain-key": "${env:OPENBRAIN_KEY}"
      }
    }
  }
}
```

Set the environment variable:
```bash
export OPENBRAIN_KEY=your-mcp-access-key
```

## Installation

### Manual
```bash
cp instructions/* .github/instructions/
cp agents/* .github/agents/
cp prompts/* .github/prompts/
```

### Using CLI
```bash
pforge ext install docs/plans/examples/extensions/plan-forge-memory
```

## How It Works in Practice

### Session 1 (Plan Hardening)
```
Agent starts → SessionStart searches OpenBrain:
  "Prior decisions for this project?"
  → Found: 5 architectural decisions from Phase 2
  → Found: 2 post-mortem lessons from Phase 3
  → Context loaded automatically

Agent hardens plan → Captures new decisions:
  "Decision: Use branch-per-slice for Phase 4 (high risk)"
  → Stored in OpenBrain with topics, rationale, alternatives
```

### Session 2 (Execution)
```
Fresh session → Searches OpenBrain:
  "What was decided during Phase 4 hardening?"
  → Retrieves exact decisions from Session 1
  → No context lost despite session boundary

After each slice → Auto-captures:
  "Slice 3 complete: Added UserProfileRepository with Dapper"
  → Stored with slice number, phase, outcome
```

### Session 3 (Review)
```
Independent reviewer → Searches OpenBrain:
  "What decisions were made during execution?"
  → Full decision trail available for audit
  → Can verify intent was preserved across sessions
```

### 3 Months Later
```
New team member joins → Asks:
  "What patterns does this project use for error handling?"
  → OpenBrain returns all error-handling decisions semantically
  → No need to dig through old PRs or chat logs
```

## What This Extension Does NOT Replace

- **Hardened plans** — Still the source of truth for scope and execution
- **Instruction files** — Still auto-load coding standards per file type
- **Project Principles** — Still the binding declarations of what the project believes
- **Git history** — Still the record of what actually changed

OpenBrain **supplements** these by capturing the *context and reasoning* behind decisions — the "why" that doesn't live in code or Markdown.
