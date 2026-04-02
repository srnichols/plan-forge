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

This extension adds 4 files, but the memory integration extends **across the entire pipeline**:

### Extension Files (installed by `pforge ext install`)

| Type | File | Purpose |
|------|------|---------|
| **Instruction** | `persistent-memory.instructions.md` | Default parameters + rules for when to search and capture |
| **Agent** | `memory-reviewer.agent.md` | Audits whether key decisions were captured |
| **Prompt** | `search-project-history.prompt.md` | Search OpenBrain for prior decisions and context |
| **Prompt** | `capture-decision.prompt.md` | Structured decision capture with context and rationale |
| **Config** | `mcp.json` | Auto-merged into `.vscode/mcp.json` on install |

### Pipeline Files (already memory-aware, activated when OpenBrain is configured)

| Component | Count | Memory Behavior |
|-----------|-------|-----------------|
| **Pipeline prompts** (step0–step6) | 7 | Search before, capture after each step |
| **Pipeline agents** (specifier → shipper) | 5 | Search for context + capture decisions at each stage |
| **SessionStart hook** | 1 | Injects reminder to search OpenBrain on session open |
| **Stop hook** | 1 | Reminds agent to capture decisions before session ends |
| **Skills** (all presets) | 40 | Each skill searches prior patterns and captures outcomes |

All calls include `project`, `created_by`, and `source` for full provenance.

## Prerequisites

1. **OpenBrain running** — Local Docker, Kubernetes, or Azure Container Apps deployment
   - See [OpenBrain setup guide](https://github.com/srnichols/OpenBrain)
   - Requires the **dev-ready upgrade** (v1.1+) for project scoping, batch capture, and thought mutation
2. **Plan Forge installed** — This extension adds to an existing Plan Forge project

### MCP Configuration (Automatic)

The extension includes an `mcp.json` that is **automatically merged** into `.vscode/mcp.json` when you install via `pforge ext install` or `setup.ps1 -InstallExtensions`. The default config points to `localhost:8080`.

The only manual step is setting the environment variable:
```bash
# Linux / macOS
export OPENBRAIN_KEY=your-mcp-access-key

# Windows (PowerShell)
$env:OPENBRAIN_KEY = "your-mcp-access-key"
```

If OpenBrain runs on a different host, edit the `url` in `.vscode/mcp.json`:

**Tailscale (access from any device on your tailnet):**
```json
{
  "servers": {
    "openbrain": {
      "type": "sse",
      "url": "https://<your-machine>.<tailnet>.ts.net/sse?key=${env:OPENBRAIN_KEY}"
    }
  }
}
```

**Azure Container Apps:**
```json
{
  "servers": {
    "openbrain": {
      "type": "sse",
      "url": "https://openbrain-api.<region>.azurecontainerapps.io/sse?key=${env:OPENBRAIN_KEY}"
    }
  }
}
```

> **Tip**: The Tailscale option is ideal for developers who self-host OpenBrain on a home server or NAS — it works from any PC on your tailnet without exposing ports to the internet.

## Installation

### Using CLI (recommended — auto-configures mcp.json)
```bash
pforge ext install docs/plans/examples/extensions/plan-forge-memory
```

### Manual
```bash
cp instructions/* .github/instructions/
cp agents/* .github/agents/
cp prompts/* .github/prompts/
cp mcp.json .vscode/mcp.json  # or merge into existing
```

## The Compounding Effect

Unlike static documentation, OpenBrain knowledge **compounds across phases**:

```
Phase 1:  0 prior thoughts  →  captures 8 decisions
Phase 2:  8 thoughts loaded  →  avoids 2 prior mistakes, captures 12 more
Phase 3:  20 thoughts loaded →  reuses 3 patterns, captures 10 more
Phase 5:  40+ thoughts       →  agent has full project context from day one
```

Each phase costs less in rework because the agent already knows what worked, what failed, and why. A new team member (or a fresh Copilot session) gets the same institutional knowledge as someone who was there from the start — via a single `search_thoughts()` call.

## How It Works in Practice

### Session 1 (Plan Hardening)
```
Agent starts → SessionStart searches OpenBrain:
  search_thoughts("Prior decisions for this project?", project: "my-api",
    created_by: "copilot-vscode")
  → Found: 5 architectural decisions from Phase 2
  → Found: 2 post-mortem lessons from Phase 3
  → Context loaded automatically

Agent hardens plan → Captures new decisions:
  capture_thought(
    "Decision: Use branch-per-slice for Phase 4 (high risk)",
    project: "my-api",
    created_by: "copilot-vscode",
    source: "plan-forge-phase-4-hardening"
  )
  → Stored in OpenBrain with topics, rationale, alternatives
```

### Session 2 (Execution)
```
Fresh session → Searches OpenBrain:
  search_thoughts("Phase 4 hardening decisions", project: "my-api", type: "decision")
  → Retrieves exact decisions from Session 1
  → No context lost despite session boundary

After each slice → Auto-captures:
  capture_thought(
    "Slice 3 complete: Added UserProfileRepository with Dapper",
    project: "my-api",
    created_by: "copilot-vscode",
    source: "plan-forge-phase-4-slice-3"
  )
  → Stored with slice number, phase, outcome

After all slices → Batch capture post-mortem:
  capture_thoughts([
    "Lesson: Dapper query timeout defaults are too low for batch inserts",
    "Pattern: Always set CommandTimeout = 60 for multi-row operations",
    "Convention: Repository methods return domain objects, never DataReader"
  ], project: "my-api", source: "phase-4-postmortem")
```

### Session 3 (Review)
```
Independent reviewer → Searches OpenBrain:
  search_thoughts("execution decisions", project: "my-api", type: "decision")
  → Full decision trail available for audit
  → Can verify intent was preserved across sessions
```

### 3 Months Later
```
New team member joins → Asks:
  search_thoughts("error handling patterns", project: "my-api", type: "pattern")
  → OpenBrain returns all error-handling decisions and patterns
  → No need to dig through old PRs or chat logs
```

## What This Extension Does NOT Replace

- **Hardened plans** — Still the source of truth for scope and execution
- **Instruction files** — Still auto-load coding standards per file type
- **Project Principles** — Still the binding declarations of what the project believes
- **Git history** — Still the record of what actually changed

OpenBrain **supplements** these by capturing the *context and reasoning* behind decisions — the "why" that doesn't live in code or Markdown.

## Expected Impact

### Where Persistent Memory Reduces Rework

| Problem | Without OpenBrain | With OpenBrain |
|---------|------------------|----------------|
| **Agent picks wrong pattern** (e.g., tries EF Core when project uses Dapper) | Agent reads instruction files, but doesn't know *why* Dapper was chosen or what was tried before | Searches "data access decisions" → gets rationale + failed alternatives |
| **Re-discovers the same solution** (e.g., figures out JSONB merge syntax again) | Every session re-solves solved problems | Searches "JSONB update pattern" → gets the exact approach used last time |
| **Contradicts a previous decision** (e.g., cache key without tenant prefix) | Caught at Step 5 (Review) — after code is written | Searches "caching conventions" → finds tenant-prefix rule before writing code |
| **Post-mortem lessons ignored** (e.g., repeats N+1 query mistake from Phase 3) | Lessons sit in a Markdown file nobody re-reads | Searches "performance lessons" → gets specific warnings from prior phases |
| **Session 2 doesn't know Session 1's reasoning** | Agent reads the hardened plan but not *why* decisions were made | Searches "Phase 4 hardening decisions" → gets full context with rationale |

### Where It Doesn't Help

- **Syntax errors / typos** — Not a memory problem
- **Context window overflow** — OpenBrain adds context; overuse could make this worse
- **Wrong business logic** — If the spec is wrong, remembering it perfectly doesn't help
- **Brand new problems** — No prior memory to search

### Realistic Estimates

For a **long-running project** (months, multiple phases) with consistent patterns:

| Metric | Estimated Improvement |
|--------|----------------------|
| Architectural rework (wrong patterns) | ~40–60% reduction |
| Review gate failures (drift violations) | ~20–30% reduction |
| Time per session (searching/re-discovering) | ~10–15% reduction |
| Errors on repeat patterns | Significant reduction |

For a **new project** in its first few phases: minimal benefit — there's no memory to search yet. The value **compounds over time**, which is exactly how real institutional knowledge works.

### The Real Win

The biggest value isn't speed — it's **consistency**. When every session across every team member across every AI tool shares the same decision memory, the codebase stays architecturally coherent. That's what reduces errors long-term.
