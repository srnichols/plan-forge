---
description: "Pipeline Step 4 — Completeness sweep to eliminate TODOs, mocks, stubs, and placeholder code before review."
---

# Step 4: Completeness Sweep

> **Pipeline**: Step 4 of 5 (Session 2 — Execution)  
> **When**: After all slices pass (Step 3), before the Review Gate  
> **Next Step**: `step5-review-gate.prompt.md` (new session)

Replace `<YOUR-HARDENED-PLAN>` with your hardened plan filename.

---

Read these files first:
1. docs/plans/AI-Plan-Hardening-Runbook.md (Section 6.1)
2. docs/plans/<YOUR-HARDENED-PLAN>.md (Definition of Done)
3. .github/copilot-instructions.md

Now act as a COMPLETENESS SWEEP AGENT (see Section 6.1 of the runbook).

Scan ALL files created or modified during this phase for:
- TODO, HACK, FIXME comments
- Mock/placeholder/stub data (hardcoded records, fake values)
- "will be replaced" / "Simulate" / "Seed with sample" comments
- Stub implementations (methods that return defaults / do nothing)
- Commented-out code with future intent

For each finding:
1. Wire it to the real service/API/method
2. Remove the deferred-work comment
3. Verify build + tests pass after each batch

Output:
1) Findings count (before → after)
2) Files modified
3) New methods/types added
4) Build: pass/fail
5) Tests: pass/fail

If ANY finding cannot be resolved without scope expansion: STOP and report.

---

## Persistent Memory (if OpenBrain is configured)

- **Before sweeping**: `search_thoughts("common stubs", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — check if prior sweeps found recurring stub patterns so you can look for them proactively
- **After sweep**: `capture_thoughts([...findings], project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "plan-forge-step-4-sweep")` — batch capture patterns and conventions discovered during cleanup
