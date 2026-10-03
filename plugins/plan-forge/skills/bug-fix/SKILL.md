---
name: bug-fix
description: Guided end-to-end bug-fix workflow for Plan Forge tempering bugs — load → pre-fix review → write failing test → fix → validate → post-fix sweep → close. Composes /code-review, /clean-code-review, /forge-quench, and /test-sweep around the forge_bug_* tool surface so a fix never closes without a regression check.
argument-hint: "[--bugId <id>] [--scanner <name>] [--no-sweep]"
tools: [read_file, run_in_terminal, grep_search, forge_bug_list, forge_bug_update_status, forge_bug_validate_fix, forge_analyze]
---

# `/bug-fix` Skill — Guided Bug-Fix Workflow

## Trigger
"Fix this bug" / "Work the bug queue" / "Close out bug-…" / `/bug-fix`

## Purpose

Plan Forge's bug-fix tools (`forge_bug_register` → `forge_bug_update_status` → `forge_bug_validate_fix`) form a tight state machine but don't compose with this project's skills by default. This skill wraps the state machine with the right skills at each transition so a fix that passes the original scanner doesn't ship a regression in a neighbour.

The bug tools surface `skillAdvisory` hints in their responses — this skill is the canonical realisation of those hints.

## Inputs

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--bugId <id>` | No | first `open` bug | Specific bug to work; otherwise picks the highest-severity `open` bug |
| `--scanner <name>` | No | match all | Filter by scanner (`unit`, `integration`, `ui-playwright`, `visual-diff`, `flakiness`, `mutation`, `load-stress`, `contract`, `performance-budget`) |
| `--no-sweep` | No | off | Skip the post-fix `/test-sweep` — only use for hot-fix paths under time pressure |

## Steps

### 1. Load the bug

```text
forge_bug_list --status open --severity high
```

Pick the bug (`--bugId` overrides). Read the full record: `scanner`, `classification`, `affectedFiles`, `evidence`, `reproSteps`. **Stop and report** if:
- The bug is already in a terminal status (`fixed` / `wont-fix` / `duplicate`)
- `classification === "infra"` — surface to the human; the fix is likely in CI / runner config, not product code
- `classification === "flake"` — run `/forge-troubleshoot` first; a flake fix is a different workflow

### 2. Pre-fix review (collateral surface)

Run `/code-review` scoped to `bug.affectedFiles`. The goal is to surface **related** issues that should be fixed in the same commit — fixing one bug while leaving its neighbours broken trains the next agent session to keep doing the same.

For **complexity-class** bugs (`scanner === "mutation"`, or `/code-review` flags high cyclomatic complexity in the affected functions), pivot to `/forge-quench` first. Quench's Chesterton's-Fence pass clarifies the logic so the fix lands on a stable shape, not on top of confusion.

### 3. Transition to in-fix

```text
forge_bug_update_status --bugId <id> --newStatus in-fix --note "Starting fix; pre-review: <link/summary>"
```

The response surfaces a `skillAdvisory` field tuned to the bug's scanner — follow it for scanner-specific guidance (UI / perf / contract / mutation).

### 4. Write the failing test first (TDD)

Before touching production code:

1. Reproduce the bug's failure mode in a new test case based on `bug.evidence.testName` and `bug.evidence.assertionMessage`
2. Run **only that test** — it must fail with the same symptom as the registered bug
3. If it doesn't fail, the bug's reproSteps are insufficient — go back to Step 1 and gather more evidence

> Why this step: `forge_bug_validate_fix` re-runs the **original** scanner. If the new failing test isn't part of that scanner's surface, the fix could pass validation without proving anything. Adding the test first guarantees the closed-loop covers the actual symptom.

### 5. Implement the fix

- Keep the scope tight — every file outside `bug.affectedFiles` is forbidden unless absolutely necessary
- Match adjacent code style; don't restructure neighbours unless the pre-fix review flagged them
- One logical change per commit — if a fix needs more than one commit, the bug should have been a fix-plan (submit a bug-batch lane Crucible smelt instead)

### 6. Validate the fix

```text
forge_bug_validate_fix --bugId <id>
```

| Verdict | Action |
|---------|--------|
| `fixed` | The original scanner now passes. Proceed to Step 7. The response's `skillAdvisory` will point to `/test-sweep`. |
| `still-failing` | The fix didn't take. Read `attempt.details`, follow the response's `skillAdvisory`, and revise. Do NOT increment fix attempts mechanically — every retry should be a hypothesis-driven change. |

### 7. Post-fix regression sweep

Unless `--no-sweep` was passed, run `/test-sweep` over the full project. The validate step only re-runs the bug's original scanner; `/test-sweep` catches regressions in unrelated suites.

If `/test-sweep` finds **new** failures:
- They are regressions caused by the fix. Treat them as bugs: `forge_bug_register` each one with `correlationId: "regression-of-<originalBugId>"` and `sliceRef` pointing at this fix's commit.
- Decide: revert the fix and re-plan, or batch the regression fixes into a follow-up slice.

### 8. Close

`forge_bug_validate_fix` already transitions the bug to `status: "fixed"` on a pass. The skill is done when:
- `forge_bug_list --status fixed` shows the bug
- The fix is committed with a conventional `fix(<scope>): <description>` message that references the bugId
- Any regression bugs from Step 7 are either fixed or filed

## Output template

```text
Bug-Fix Summary — <bugId>
  Classification: <real-bug|flake|infra>
  Scanner: <name>
  Severity: <low|medium|high|critical>

  Pre-fix review:    <findings count + collateral fixes bundled>
  TDD test added:    <test name>
  Fix commit:        <SHA — fix(<scope>): <description>>
  Validate-fix:      <verdict — fixed|still-failing>
  Post-fix sweep:    <pass|N regressions filed as <bugIds>>

  Status: <closed|still-open with reason>
```

## When NOT to use this skill

- **Infra-class bugs**: route to the human; the fix is in CI / runner config, not product code
- **Flake-class bugs**: use `/forge-troubleshoot` first to confirm flake vs. real bug
- **Multi-slice fixes**: submit a bug-batch lane Crucible smelt instead; the resulting plan already injects `/code-review` and `/test-sweep` gates
- **Meta-bugs** (defects in Plan Forge itself, not your project): use `forge_meta_bug_file`, not `forge_bug_register`

## Related

- `/code-review` — Step 2 pre-fix review
- `/clean-code-review` — mechanical pass before `/code-review`
- `/forge-quench` — complexity-class refactor pass before patching
- `/forge-troubleshoot` — flake / infra bug triage
- `/test-sweep` — Step 7 regression sweep
