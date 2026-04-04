# Demo: Team Leads & Engineering Managers

> **Audience**: Tech leads, engineering managers, VP Engineering
> **Key message**: Measurable AI quality. Visual proof. CI enforcement. Budget tracking.
> **Duration**: 15 minutes

---

## Script

### 1. The Management Problem (2 min)

> "Your team adopted AI coding 6 months ago. Token spend is up. But how do you answer:
> - Is the code actually better?
> - Are we spending tokens wisely?
> - Is the AI following our architecture?
> - Can we audit what the AI decided and why?"

### 2. Consistency Scores — Measurable Quality (3 min)

```bash
pforge analyze docs/plans/Phase-5-SEARCH-PLAN.md
```

Show the output:
```
Consistency Score: 91/100
  - Traceability: 25/25
  - Coverage: 22/25 (1 out-of-scope file)
  - Test Coverage: 22/25 (1 untested MUST criterion)
  - Gates: 22/25 (2 deferred markers)
```

> "Every phase gets a number. Track it over time. Scores going up? AI is learning your patterns. Scores dropping? Something changed."

### 3. CI Quality Gate — Every PR (2 min)

```yaml
- uses: srnichols/plan-forge-validate@v1
  with:
    analyze: true
    analyze-plan: docs/plans/Phase-5-SEARCH-PLAN.md
    analyze-threshold: 80
```

> "PR blocked if consistency score drops below 80. No human judgment needed — the gate is automatic."

### 4. Cost Tracking — Budget Justification (2 min)

Show cost tracker (from `.forge/cost-history.json`):

```
Monthly Token Spend:
  March:   $42.50 (12 phases across 3 projects)
  April:   $38.20 (14 phases — cost per phase dropping)
  
By Model:
  Claude (spec + review): $28.00
  Codex (execution):      $8.20
  Auto (mechanical):      $2.00
```

> "You know exactly what AI costs, by project, by model, by month. Try getting that from raw Copilot usage."

### 5. Dashboard — Visual Command Center (3 min)

Open `localhost:3100/dashboard`:

> "Multi-project view. Phase timeline. Run history with trend charts. One screen for your entire AI development pipeline."

Show:
- 3 projects with current phase status
- Consistency score trending up over 6 months
- Cost trending down (model routing optimization)
- Last run: 8/8 slices pass

### 6. Audit Trail — Compliance Ready (2 min)

> "Every decision the AI made is captured in OpenBrain (if deployed). Every phase has a plan, a scope contract, validation results, and a consistency score. SOC2 auditors love this."

Show:
- Plan file with locked scope contract
- `.forge/runs/` with per-slice results
- `pforge analyze` output as audit evidence

### 7. How to Adopt (1 min)

> "Start with one team, one project. Run `setup.ps1`. First feature gets guardrails from line 1. Measure the score. Compare rework rates before/after. The numbers sell themselves."

---

## ROI Talking Points

| Metric | Before Plan Forge | After Plan Forge |
|---|---|---|
| Rework rate | 30-50% needs rework after review | Independent review catches drift before merge |
| Time to re-explain | Re-explain architecture every session | Memory loads decisions in seconds |
| Token waste | Context window spent on exploration | Hardened plan = fewer tokens, faster results |
| Audit evidence | "It works on my machine" | Consistency score + validation gates + run logs |
| Onboarding | New dev reads 10 docs + asks team | `pforge smith` + `/onboarding` skill + memory explorer |
