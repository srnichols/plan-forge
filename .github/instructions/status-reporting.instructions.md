---
description: Standard output templates for orchestration status updates, progress reports, blockers, completions, handoffs, and failure reports. Use these formats during plan execution, multi-agent runs, and autonomous operations.
applyTo: 'docs/plans/**,pforge-mcp/**,.forge/**'
---

# Status Reporting Templates

> **When to use**: During `forge_run_plan` execution, multi-agent orchestration, autonomous runs, slice monitoring, and session handoffs. Use the template that matches the moment — don't force every message into a template.

---

## Template 1: Progress Update

Use during long-running operations to report current state. Send every 2–3 slices or every 5 minutes, whichever comes first.

```
## Progress Update

**Run:** <plan name>
**Current:** Slice <N> — <slice title>
**Status:** <Running | Waiting for gate | Queued>
**Completed:** <N>/<total> slices passed
**Failed:** <N> (if any)
**Next:** Slice <N+1> — <title>
**ETA:** ~<X> minutes remaining
```

**Example:**
```
## Progress Update

**Run:** Phase-22-COPILOT-PLATFORM-v2.15
**Current:** Slice 3 — `forge_export_plan`
**Status:** Running (~10 min so far)
**Completed:** 2/8 slices passed
**Failed:** 0
**Next:** Slice 4 — `forge_sync_memories`
**ETA:** ~35 minutes remaining
```

---

## Template 2: Slice Complete

Use immediately after a slice passes its validation gate.

```
## Slice Complete

**Slice:** <N> — <title>
**Result:** <Passed | Passed with warnings>
**Duration:** <X> min
**Gate:** <gate evidence summary>
**Files changed:** <count>
**Key outputs:** <1–2 line summary of what was built>
**Next:** Slice <N+1> — <title>
```

---

## Template 3: Blocker Report

Use when execution is stalled and needs human input or a fix.

```
## ⚠ Blocker

**Slice:** <N> — <title>
**Problem:** <what failed>
**Cause:** <root cause or best guess>
**Impact:** <what's blocked downstream>
**Attempted:** <what was tried, if anything>
**Next action:** <specific fix or question for human>
```

---

## Template 4: Failure / Recovery Report

Use when a slice fails its gate and the system is retrying or escalating.

```
## ❌ Slice Failed

**Slice:** <N> — <title>
**Attempt:** <N> of <max>
**Error:** <error message or gate output>
**Model:** <model used>
**Recovery:** <Retrying | Escalating to <model> | Awaiting human input>
**Files affected:** <list>
```

---

## Template 5: Run Summary

Use at the end of a complete `forge_run_plan` execution.

```
## Run Summary

**Plan:** <plan name>
**Status:** <Completed | Completed with failures | Aborted>
**Slices:** <passed>/<total> passed
**Duration:** <total time>
**Cost:** <estimated cost>
**Models used:** <list>
**Key outputs:**
- <bullet 1>
- <bullet 2>
**Follow-up:** <next steps, if any>
```

---

## Template 6: Handoff Summary

Use when transferring context between sessions (e.g., Session 1 → Session 2, or Specifier → Plan Hardener).

```
## Handoff

**From:** <agent/session>
**To:** <agent/session>
**Completed:** <what was done>
**Artifacts:**
- <file 1>
- <file 2>
**Open risks:** <known issues or uncertainties>
**Next step:** <specific action for the receiving agent>
**Context files to read:** <list of files the next agent should load>
```

---

## Template 7: Slice Status Table

Use for at-a-glance multi-slice status during a run. Render as a markdown table.

```
| # | Slice | Status | Duration | Gate |
|---|-------|--------|----------|------|
| 1 | <title> | ✅ Passed | 5.7 min | <evidence> |
| 2 | <title> | ✅ Passed | 4.8 min | <evidence> |
| 3 | <title> | 🔄 Running | ~10 min | — |
| 4 | <title> | ⏳ Queued | — | — |
```

Status icons:
- ✅ Passed
- 🔄 Running
- ⏳ Queued
- ❌ Failed
- ⚠️ Passed with warnings
- 🔁 Retrying
- ⏸️ Blocked

---

## Usage Guidelines

1. **Don't template every message** — use templates for key moments (progress, completion, failure, handoff), not conversational responses
2. **Keep it brief** — fill in only the fields that matter; omit fields with no useful value
3. **Machine-friendly labels** — use the exact field names (`Status:`, `Slice:`, `Next:`, `ETA:`) for future parseability
4. **Combine when appropriate** — a progress update can include the slice status table inline
5. **Adapt, don't rigidly copy** — these are guides, not prisons. If a situation needs a different shape, use it
6. **Dashboard alignment** — these templates mirror what the dashboard shows on the Progress and Runs tabs, keeping human chat output consistent with the visual UI
