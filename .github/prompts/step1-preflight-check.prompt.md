---
description: "Pipeline Step 1 — Pre-flight checks before plan hardening. Verifies git state, roadmap link, plan file, guardrails, and domain-specific instruction files."
---

# Step 1: Pre-flight Check

> **Pipeline**: Step 1 of 5 (Session 1 — Plan Hardening)  
> **When**: Before hardening any `*-PLAN.md`  
> **Model suggestion**: Any model / Copilot Auto (10% token savings) — checklist verification works well on all models  
> **Next Step**: `step2-harden-plan.prompt.md`

Replace `<YOUR-PLAN>` with your plan filename (without path or `.md` extension).

---

Act as a PRE-FLIGHT CHECK AGENT for plan hardening.

**Pre-flight context check:**
- **Check OpenBrain** (if configured): `search_thoughts("<plan topic> blockers", project: "<YOUR PROJECT NAME>")` — load prior preflight failures and known blockers
- **Check LiveGuard memories**: Read `.forge/liveguard-memories.jsonl` if present — recent incidents or drift violations may indicate unresolved issues

Run these checks and report results. If any check fails, report the failure and do not proceed to Step 2.

1. GIT STATE — Run `git pull origin main` and `git status`.
   Report: clean / dirty (list uncommitted files if dirty).

2. ROADMAP LINK — Read docs/plans/DEPLOYMENT-ROADMAP.md.
   Confirm the phase for <YOUR-PLAN> exists with a one-line goal.
   Report: ✅ found (quote the goal) / ❌ missing.

3. PLAN FILE — Confirm docs/plans/<YOUR-PLAN>.md exists and is non-empty.
   Report: ✅ exists (N lines) / ❌ not found.

4. CORE GUARDRAILS — Confirm these files exist and are non-empty:
   - .github/copilot-instructions.md
   - .github/instructions/architecture-principles.instructions.md
   - AGENTS.md
   Report: ✅ all present / ❌ missing (list which).

4b. AGENTIC FILES — Check if prompt templates, agent definitions, and skills exist:
   - .github/prompts/ — list *.prompt.md files found (0 is OK for non-preset repos)
   - .github/agents/ — list *.agent.md files found
   - .github/skills/ — list */SKILL.md files found
   Report: ✅ N prompts, N agents, N skills found / ⚠️ none found (optional — won't block)

5. DOMAIN GUARDRAILS — Scan <YOUR-PLAN>.md for keywords to identify relevant domains.
   For each domain detected, confirm the matching guardrail file exists:
   - UI/Component/Frontend/Razor/React/Vue → .github/instructions/frontend.instructions.md (or blazor/react specific)
   - Database/SQL/Repository/ORM/migration → .github/instructions/database.instructions.md
   - API/Route/Controller/REST → .github/instructions/api-patterns.instructions.md
   - Auth/OAuth/JWT/OIDC/session → .github/instructions/auth.instructions.md
   - GraphQL/Schema/Resolver → .github/instructions/graphql.instructions.md
   - Security/CORS/Secrets/Validation → .github/instructions/security.instructions.md
   - Docker/K8s/deploy/CI → .github/instructions/deploy.instructions.md
   - Test/spec/coverage → .github/instructions/testing.instructions.md
   Report: domains detected + guardrail status for each.

Output a summary table:

| Check | Result | Details |
|-------|--------|---------|
| Git state | ✅/❌ | ... |
| Roadmap link | ✅/❌ | ... |
| Plan file | ✅/❌ | ... |
| Core guardrails | ✅/❌ | ... |
| Agentic files | ✅/⚠️ | ... |
| Domain guardrails | ✅/❌ | ... |

If ALL pass: "Pre-flight complete ✅ — proceed to Step 2 (Harden the Plan)"
If ANY fail: "Pre-flight FAILED ❌" + list exactly what to fix.

> **Tip**: For deeper diagnostics (environment tools, VS Code config, version currency, common problems), suggest running `pforge smith`.

---

## Persistent Memory (if OpenBrain is configured)

- **Before checking**: `search_thoughts("preflight blockers", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — check if prior preflights failed for known reasons
- **If preflight fails**: `capture_thought("Preflight blocker: <what failed and why>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-1", type: "bug")` — persist the blocker so it's caught earlier next time
- **If preflight passes with notable decisions**: `capture_thought("Preflight passed: <key confirmations — branch strategy, resolved ambiguities>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-1", type: "decision")` — persist confirmations so next phase doesn't re-ask
