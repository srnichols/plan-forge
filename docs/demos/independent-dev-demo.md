# Demo: Independent Developers

> **Audience**: Solo devs and small teams using Claude, Cursor, Codex, or mixed tools
> **Key message**: Full guardrails on every AI tool you use. Rich native integration. One setup, all agents.
> **Duration**: 10-15 minutes

---

## Script

### 1. The Problem (1 min)

> "You use Claude for architecture, Codex for bug fixes, Cursor for quick edits. Each tool starts from zero every session. None of them know your project's rules."

### 2. One Setup, All Agents (3 min)

```bash
.\setup.ps1 -Preset typescript -Agent all
```

> "One command generates native files for every agent:"

| Agent | What Gets Generated |
|---|---|
| Copilot | `.github/` — instructions, agents, prompts, hooks |
| Claude | `CLAUDE.md` with ALL 16 guardrails + `.claude/skills/` (33+ skills) |
| Cursor | `.cursor/rules` with guardrails + `.cursor/commands/` (33+ commands) |
| Codex | `.agents/skills/` (33+ skills) |

> "Claude gets a rich context file with every guardrail embedded. Not a copy of copilot-instructions — the full 16-domain rule set organized by section."

### 3. MCP Tools — AI Calls Plan Forge (2 min)

```bash
cd mcp && npm install
```

> "Now Claude, Cursor, and Copilot can call forge operations as native functions."

Show in Claude Code:
> "Run forge_smith" → diagnostics appear
> "Run forge_sweep" → zero markers

> "Your AI agent discovers these tools automatically. No terminal commands needed."

### 4. Full Auto Execution (3 min)

```bash
pforge run-plan docs/plans/Phase-3-PAYMENTS-PLAN.md
```

> "Claude Code executes slices automatically. Build + test gates at every boundary. Token usage tracked. Walk away and come back to results."

Show progress output → all slices pass → auto-sweep → auto-analyze → score.

### 5. Cost Savings (2 min)

Show the model suggestion headers in step prompts:

> "Steps 1, 3, 4, 6 suggest Copilot Auto — 10% token savings. Steps 0, 2, 5 use Claude for quality. You spend smart, not just more."

```
Phase 3 cost: $0.86 (Claude: $0.67, Auto: $0.19)
Without model routing: ~$1.40
Savings: 39%
```

### 6. Spec Kit Compatible (1 min)

> "Already use Spec Kit? Plan Forge auto-detects your specs and imports them. Same extension catalog format. Complementary, not competing."

### 7. Q&A

> "MIT licensed. Free. Clone and go."

---

## Key Differentiators vs Spec Kit

| | Spec Kit | Plan Forge |
|---|---|---|
| Strength | Spec-first methodology, 85K community | Runtime enforcement, 18 reviewer agents |
| Agent support | 25+ agents | 4 first-class + MCP tools + copy-paste |
| Guardrails | At planning time | During coding (auto-load, hooks, MCP) |
| Best for | Defining what to build | Ensuring it's built correctly |
| Together | Write specs with Spec Kit → enforce with Plan Forge |
