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

---

## Reading Test Output Before Reporting

> **Field bug (Issue #198)**: subagents have hallucinated `"1 failed"` summaries on **fully green** vitest runs because they confused in-test log lines with vitest's own summary. Cost: false-positive failure reports trigger unnecessary investigation and risk shipping reverts for non-existent bugs.

### The trap

Plan Forge's own test suite contains many tests that *exercise* slice-failure code paths. Those tests legitimately emit log lines like:

```
❌ Slice 1: Fix the login bug — FAILED
Run complete: 0 passed, 1 failed
```

…**inside** a passing test, to assert the failure-handling code did the right thing. These are NOT vitest failures — they are application logs printed during a successful assertion.

### The rule

When you read captured test output to determine pass/fail counts:

1. **ONLY trust vitest's own summary block** — the lines that look like:
   ```
   Test Files  271 passed | 2 skipped (273)
        Tests  5699 passed | 35 skipped (5734)
     Duration  459.65s
   ```
2. **NEVER count grep hits on `FAILED`, `failed`, `❌`, or `Slice N — FAILED`** — those match in-test logs from tests that pass while asserting failure behavior.
3. **If the suite times out before the summary block appears** (>120s is common for the full sweep, ~460s for `pforge-mcp` end-to-end), say so explicitly: *"timed out before vitest emitted the summary block — re-run with a longer timeout or scope to a specific file."* Do NOT guess from partial output.
4. **For programmatic capture**, grep the literal anchor:
   ```powershell
   Get-Content $log | Select-String -Pattern '^\s*Test Files\s+\d+\s+passed' -Context 0,3
   ```
   This anchors to vitest's actual summary line and captures the next three lines (`Tests`, `Start at`, `Duration`).
5. **The exit code is authoritative** — if `$LASTEXITCODE` is 0 AND the summary block shows `0 failed` (or no `failed` token at all), the suite is green. Any other interpretation is a hallucination.

### Quick template for reporting test results

```
## Test Sweep

**Command:** <exact command>
**Exit code:** <0|N>
**Summary (verbatim from vitest):**
  Test Files  <X> passed | <Y> skipped (<total>)
       Tests  <X> passed | <Y> skipped (<total>)
    Duration  <X>s
**Failures:** <None | list of file:test names from the FAIL block>
```

If you cannot find the verbatim summary in the output, the right answer is *"unknown — re-run is needed"* — not a guess.
