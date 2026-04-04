# Demo: Microsoft Enterprise Teams

> **Audience**: Microsoft employees using VS Code + GitHub Copilot
> **Key message**: Same tool, same license, same workflow — just with guardrails, validation gates, and measurable quality scores.
> **Duration**: 15-20 minutes

---

## Setup (Before Demo)

1. Have a project with Plan Forge installed (`setup.ps1 -Preset dotnet`)
2. A hardened plan with 4-5 slices ready
3. VS Code open with Copilot Agent Mode active
4. Terminal ready for `pforge` commands

---

## Script

### 1. The Problem (2 min)

> "How many of you have had Copilot silently expand scope, skip tests, or pick its own architecture? How many have had it write code that passes once but breaks in production?"

Show a quick example: ask Copilot to "build an auth endpoint" without guardrails. Note how it picks JWT vs cookies without asking, skips error handling, and doesn't write tests.

### 2. Plan Forge in 60 Seconds (2 min)

> "Plan Forge is an open-source framework that turns Copilot from a smart autocomplete into a disciplined engineering system."

```bash
pforge smith    # Show: environment healthy, 16 guardrail files loaded
```

> "17 instruction files auto-load based on what file you're editing. Security rules when editing auth. Database rules when editing queries. Architecture rules always."

### 3. The Pipeline (5 min)

Show the hardened plan:
> "Every feature starts as a spec, gets hardened into a locked contract, built slice by slice with validation gates, swept for completeness, and independently reviewed."

Run through Steps 0-2 quickly (already done — show the plan file).

Then demonstrate Step 3 (Execute) in Assisted mode:

```bash
pforge run-plan --assisted docs/plans/Phase-1-AUTH-PLAN.md
```

> "I code normally in Copilot. The orchestrator validates between slices. I can't skip to the next slice until build and tests pass."

Show: code a slice in Copilot → press Enter → orchestrator runs gates → PASS → next slice.

### 4. Quality Proof (3 min)

```bash
pforge analyze docs/plans/Phase-1-AUTH-PLAN.md
```

> "Consistency score: 91 out of 100. Every requirement traced to code. Every MUST criterion has a test. Zero deferred-work markers."

Show the 4-dimension breakdown. This is what management wants to see.

### 5. CI Integration (2 min)

```yaml
# Already in your PR workflow
- uses: srnichols/plan-forge-validate@v1
  with:
    analyze: true
    analyze-plan: docs/plans/Phase-1-AUTH-PLAN.md
```

> "Every PR gets a consistency score. Below 60? PR blocked."

### 6. What You DON'T Need (1 min)

| Requirement | Needed? |
|---|---|
| New AI tool license | ❌ Uses your existing Copilot license |
| New vendor approval | ❌ Open source, MIT licensed |
| Cloud service | ❌ Runs entirely local |
| New IDE | ❌ Stay in VS Code |
| Training | ❌ `pforge smith` tells you what to do |

### 7. Q&A + Next Steps

> "Clone the template. Run setup. Start planning. Your first feature gets guardrails from line 1."

```
https://github.com/srnichols/plan-forge
```

---

## Key Objections & Answers

| Objection | Answer |
|---|---|
| "We already have Copilot" | Plan Forge makes Copilot follow your standards instead of its own improvisation |
| "Our team won't adopt another tool" | It's VS Code files — no new tool. Guardrails auto-load invisibly |
| "How do we measure ROI?" | `pforge analyze` gives a consistency score per phase. Track it over time. |
| "What about compliance?" | Compliance-reviewer agent audits for GDPR/SOC2/HIPAA. CI action validates on every PR. |
| "Does this slow developers down?" | Prevents rework. Phase 1 with guardrails ships faster than Phase 1 → rework → re-review. |
