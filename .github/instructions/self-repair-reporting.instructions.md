---
description: Self-repair reporting — when and how to file meta-bugs against Plan Forge itself using forge_meta_bug_file
applyTo: '**'
priority: LOW
---

# Self-Repair Reporting

> **When to use**: You discovered a defect in Plan Forge itself (plan files, orchestrator, CLI, prompts, instruction files) during execution and worked around it. File a meta-bug so the fix is captured.

---

## Two Lanes at a Glance

| | Project Bug | Meta Bug (Self-Repair) |
|---|---|---|
| **What** | Bug in the code you're building | Bug in Plan Forge itself |
| **Tool** | `forge_bug_file` / tempering | `forge_meta_bug_file` |
| **Target repo** | Workspace `git remote` | `.forge.json#meta.selfRepairRepo` → fallback `srnichols/plan-forge` |
| **Labels** | `bug`, severity | `self-repair`, class label |

If the defect is in user project code, use `forge_bug_file`. If the defect is in Plan Forge's own plans, orchestrator, CLI, or prompts — use `forge_meta_bug_file`.

---

## When to Fire `forge_meta_bug_file`

Fire the tool when you had to work around one of these three defect classes:

### 1. Plan Defect (`plan-defect`)

The plan file was wrong. Brittle validation gate, missing scope entry, wrong file path, over-narrow grep pattern, unsatisfiable dependency. You edited the plan or worked around the gate to keep moving.

### 2. Orchestrator / CLI Defect (`orchestrator-defect`)

Runtime bug in Plan Forge. Gate timeout too short, spawn failure on Windows, stash not popped after failed retry, estimator recommends a CLI-less model. You worked around it or the retry loop papered over it.

### 3. Prompt / Template Defect (`prompt-defect`)

A step-N prompt emitted unsafe output, an instruction file is missing a rule that would have prevented the problem, or a template placeholder wasn't expanded.

---

## Worked Examples

### Example 1: Brittle grep gate — `plan-defect`

**Phase-28.2 Slice 2** — The plan gate used `grep -q 'A' file || grep -q 'B' file` but the worker chose identifier `isApiOnlyModel`, which matched neither pattern. The agent edited the plan gate inline to broaden the match.

```json
{
  "class": "plan-defect",
  "title": "Phase-28.2 Slice 2 gate too narrow for chosen identifier",
  "symptom": "grep gate did not match worker's chosen export name",
  "workaround": "Edited plan gate to accept isApiOnlyModel",
  "slice": "2",
  "plan": "docs/plans/Phase-28.2-PLAN.md"
}
```

### Example 2: Vitest timeout — `orchestrator-defect`

**Phase-28.1 Slice 6** — `runGate` 120 s timeout killed a vitest run that needed ~200 s. The worker diagnosed correctly but the orchestrator marked the slice failed. Manual BUG file was created.

```json
{
  "class": "orchestrator-defect",
  "title": "runGate timeout too short for large vitest suite",
  "symptom": "Gate killed after 120s, vitest needed ~200s",
  "workaround": "Manual retry with extended timeout",
  "severity": "high",
  "filePaths": ["pforge-mcp/orchestrator.mjs"]
}
```

### Example 3: Bash gate portability — `prompt-defect`

**Phase-28 Slice 4** — Plan gate used `grep -c | { read n; [ "$n" -ge 1 ]; }` (pipe to brace-group). Variable was invisible through the Windows cmd→bash shim. Worker rewrote gate inline, but the same pattern appeared again in Slice 7.

```json
{
  "class": "prompt-defect",
  "title": "Step-2 hardener emits non-portable bash gates",
  "symptom": "Brace-group variable invisible through Windows cmd shim",
  "workaround": "Rewrote gate to use simple grep -q",
  "filePaths": [".github/prompts/step2-harden-plan.prompt.md"]
}
```

---

## When NOT to Fire

- **Project code bugs** — test failures, logic errors, or crashes in the code you're building. Use `forge_bug_file` or the tempering flow.
- **CI red flags in user code** — build failures caused by the project, not Plan Forge.
- **Test failures in features under development** — expected during TDD red-green cycles.

If none of the three canonical classes apply, it's a project bug.

---

## Tool Signature

```
forge_meta_bug_file({
  class:      "plan-defect" | "orchestrator-defect" | "prompt-defect",  // required
  title:      "Short title describing the defect",                       // required
  symptom:    "Observable symptom that revealed the defect",             // required
  workaround: "Workaround applied during execution",                    // optional
  filePaths:  ["affected/file1.md", "affected/file2.mjs"],              // optional
  slice:      "3",                                                       // optional — triggers trajectory auto-pull
  plan:       "docs/plans/Phase-28.2-PLAN.md",                          // optional
  severity:   "low" | "medium" | "high" | "critical"                    // optional, default: medium
})
```

Returns: `{ ok, issueNumber, url, deduped }`.

---

## Labels and Dedupe

- Every meta issue gets the `self-repair` label plus a class label (`plan-defect`, `orchestrator-defect`, or `prompt-defect`).
- Titles include a stable hash `[self-repair:<hash>]` computed from `sha256(class + normalize(title))`.
- If an open issue with the same hash exists within the last 7 days, the tool adds a comment instead of creating a duplicate.
- After 7 days, a new issue is created even if the title matches.
