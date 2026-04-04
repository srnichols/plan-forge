# Demo: Claude Code Power Users

> **Audience**: Developers using Claude Code CLI as their primary AI coding tool
> **Key message**: Plan Forge + Claude Code = the most automated AI development pipeline available. Full Auto execution, rich guardrails, MCP tools, and the best context file of any agent.
> **Duration**: 12-15 minutes

---

## Setup (Before Demo)

1. Project with Plan Forge installed: `setup.ps1 -Preset typescript -Agent claude`
2. `cd mcp && npm install` (MCP server ready)
3. A hardened plan with 5-6 slices
4. Claude Code CLI installed and authenticated

---

## Script

### 1. "Claude Is the Best Worker — Here's Why" (2 min)

> "Plan Forge supports 4 first-class agents. But Claude Code gets the richest experience. Here's what setup generated for you:"

Show `CLAUDE.md`:
```
# Project Context for Claude

## How to Use These Guardrails
- Editing database code → follow the **database** section
- Editing auth code → follow the **auth** section
- After every file edit: scan for TODO/FIXME markers. Warn immediately.
- Before editing: check the plan's Forbidden Actions.

## Project Instructions
(your copilot-instructions.md content)

## Guardrail Files
### architecture-principles
(full content)
### security
(full content)
### testing
(full content)
... (all 16 domains embedded)
```

> "This isn't a summary — it's every guardrail rule from every domain, structured so Claude applies the right section per file. No other agent gets this depth."

### 2. 33+ Skills — Everything as a Slash Command (2 min)

```bash
ls .claude/skills/
```

Show the list:
```
planforge-step0-specify-feature/
planforge-step1-preflight-check/
planforge-step2-harden-plan/
planforge-step3-execute-slice/
planforge-security-reviewer/
planforge-architecture-reviewer/
planforge-database-reviewer/
planforge-new-entity/
planforge-new-service/
...
```

> "Every pipeline step, every reviewer agent, every scaffolding recipe — as a native Claude skill. Type `/planforge-` and see them all."

Demo: `/planforge-security-reviewer` on a file → full OWASP audit in seconds.

### 3. MCP Tools — Claude Calls Plan Forge Natively (2 min)

> "Claude discovers our MCP tools at session start. Watch:"

In Claude Code:
```
> What forge tools are available?

I can see 9 Plan Forge MCP tools:
- forge_smith — diagnostics
- forge_sweep — TODO/FIXME scan
- forge_analyze — consistency scoring
- forge_diff — scope drift detection
...
```

> "Claude doesn't need instructions to use these — they're in its tool list. It calls `forge_sweep` proactively after edits."

### 4. Full Auto — Kick It Off and Walk Away (4 min)

This is the headline feature:

```bash
pforge run-plan docs/plans/Phase-3-PAYMENTS-PLAN.md
```

> "The orchestrator reads the plan. Spawns Claude Code workers. Each slice gets the full CLAUDE.md context. Build and test gates at every boundary."

Show progress:
```
Phase 3: PAYMENTS
  Slice 1: Payment model + migration  ✅ pass (38s, Claude, 12K tokens)
  Slice 2: Stripe integration         ✅ pass (52s, Claude, 18K tokens)
  Slice 3: Webhook handler            🔄 executing...
  Slice 4: Error handling              ⏳ pending
  Slice 5: Tests                       ⏳ pending

Elapsed: 1:30  |  Tokens: 30K  |  Est. cost: $0.45
```

Wait for completion:
```
Phase 3: 5/5 slices pass
Sweep: clean (0 markers)
Analyze: 94/100

Total: 4:12  |  62K tokens  |  $0.93
```

> "5 slices. $0.93. Under 5 minutes. And every line follows your architecture, security, and testing rules."

### 5. Smart Guardrail Instructions (2 min)

> "Claude reliably follows the behavioral instructions embedded in CLAUDE.md:"

Show examples from a real run:
- **File-type awareness**: Claude applied database rules when editing SQL, security rules when editing auth — correctly matched by section
- **Post-edit scanning**: Claude called `forge_sweep` after editing 3 files — caught a TODO marker, fixed it, re-ran sweep
- **Forbidden path check**: Claude checked the plan's Forbidden Actions before editing `config/` — skipped the forbidden file

> "These aren't platform hooks like VS Code Copilot has. They're instructions Claude follows because it's Claude — reliable, thorough, and consistent."

### 6. OpenBrain Memory — Context Compounds (2 min)

> "Claude searched OpenBrain 4 times during that run. Found 3 prior decisions that informed the implementation. Captured 5 new decisions for the next phase."

Show a search result:
```
search_thoughts("payment patterns")
→ Found: "Decision: Stripe webhooks use idempotency keys. 
   Source: Phase 2, Slice 4. 3 months ago."
```

> "The agent that runs Phase 5 will already know what Phase 3 decided. Zero re-explaining."

### 7. Q&A

> "Claude Code + Plan Forge is the most automated AI development pipeline available today. Full guardrails, Full Auto execution, MCP tools, persistent memory. Try it."

---

## Why Claude Code Is the Best Full Auto Worker

| Feature | Claude Code | Codex CLI | Copilot CLI | VS Code Copilot |
|---|---|---|---|---|
| Rich context file | ✅ CLAUDE.md (all 16 guardrails) | ✅ .agents/skills/ | ❌ Stateless | ✅ .github/ |
| MCP tools | ✅ Native | ❌ | ❌ | ✅ Native |
| Non-interactive spawn | ✅ Best | ✅ | ✅ Limited | ❌ UI only |
| Post-edit scanning | ✅ Instruction-based (reliable) | ❌ | ❌ | ✅ Hook-enforced |
| Forbidden path check | ✅ Instruction-based | ❌ | ❌ | ✅ Hook-enforced |
| Full Auto quality | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | N/A (UI only) |

---

## Objection Handling

| Objection | Answer |
|---|---|
| "Claude is expensive" | Model routing: Claude for spec+review, Auto/Codex for mechanical slices. Phase 3 cost $0.93 — less than a coffee. |
| "I prefer VS Code Copilot" | Use Assisted mode — code in VS Code, Plan Forge validates between slices. Or mix: Claude Full Auto for big phases, VS Code for polish. |
| "What if Claude makes a mistake?" | Validation gates catch it before the next slice. `forge_analyze` scores consistency. Review Gate runs in a fresh session. Three safety nets. |
| "Does this work offline?" | The MCP server and orchestrator run locally. Only the AI model needs internet. |
