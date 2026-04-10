---
description: Context management for AI agents — recognize context degradation, prioritize instructions, bridge sessions with memory
applyTo: '**'
priority: LOW
---

# Context Fuel

> Context is what fuels good agent output. Running low starves quality.

## When to Load What

| Situation | Action |
|-----------|--------|
| Session start | Call `forge_capabilities` once — gets the full surface (tools, skills, config, extensions) in one call instead of reading multiple files |
| Working on database code | Prioritize `database.instructions.md`, `security.instructions.md` — read these first, reference others only when needed |
| Working on API endpoints | Prioritize `api-patterns.instructions.md`, `auth.instructions.md`, `errorhandling.instructions.md` |
| Working on tests | Prioritize `testing.instructions.md` — the test patterns and Temper Guards are more valuable than reviewing architecture rules |
| Executing a plan slice | Read the plan's Scope Contract and the specific slice — don't reload the full plan every slice |
| Context feels degraded | Stop and re-read `architecture-principles.instructions.md` — it's the universal baseline that anchors everything else |

## Recognizing Context Degradation

You are losing context when:

- You repeat a mistake that a loaded instruction file already warns against
- You forget a constraint you acknowledged earlier in the session (naming convention, forbidden pattern, tech commitment)
- You make an architectural decision that contradicts the project's established patterns
- You suggest adding a dependency that the Project Principles explicitly forbid
- Your output quality drops noticeably — shorter explanations, missed edge cases, skipped validation
- You can't recall the Scope Contract for the current slice

## What to Do When Context Degrades

1. **Re-read the active instruction files** — not all of them, just the ones relevant to the current task
2. **Check Project Principles** — re-read `docs/plans/PROJECT-PRINCIPLES.md` if it exists
3. **Search memory** — if OpenBrain is configured, run `search_thoughts` for the current task context to recall prior decisions
4. **Recommend a fresh session** — Plan Forge uses 4 sessions for a reason. If context is severely degraded, suggest the user start a new session and hand off via the plan's status artifacts

## Token Budget Awareness

- Each instruction file is 80–200 lines. Loading 15+ simultaneously consumes significant context
- `applyTo` patterns exist to prevent unnecessary loading — trust them. Don't request all instruction files when editing a single `.cs` file
- Plan files can be 200–500 lines. Load only the current slice's section, not the full plan
- If you need to reference a large file, summarize the relevant section instead of quoting it entirely
- The `forge_capabilities` tool returns a compact summary — prefer it over reading `README.md` or `capabilities.md`

## Session Boundaries

Plan Forge's 4-session model prevents context bleed:

| Session | Purpose | What to Load |
|---------|---------|-------------|
| 1 — Specify & Plan | Define the feature, harden the plan | Project Principles, architecture, DEPLOYMENT-ROADMAP |
| 2 — Execute | Build slice by slice | Plan file (current slice), stack-specific instructions, testing |
| 3 — Review | Independent audit | Plan file (Scope Contract), all instructions (fresh context = thorough review) |
| 4 — Ship | Commit and close | DEPLOYMENT-ROADMAP, git-workflow, CHANGELOG |

If you're deep in Session 2 and context is degrading, that's the signal to finish the current slice, commit, and continue in a fresh session with `--resume-from`.
