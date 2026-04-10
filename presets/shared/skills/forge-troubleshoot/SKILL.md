---
name: forge-troubleshoot
description: Diagnose and resolve Plan Forge issues — failed runs, broken validation gates, misconfigured environments, stalled slices, and orchestrator errors. Use when a plan run fails or the forge behaves unexpectedly.
argument-hint: "[optional: symptom description, e.g. 'slice 3 failed' or 'MCP tools missing' or 'validation gate error']"
tools:
  - forge_smith
  - forge_validate
  - forge_sweep
  - forge_plan_status
  - forge_diagnose
  - forge_cost_report
---

# Forge Troubleshoot Skill

## Trigger
"My plan failed" / "Something went wrong" / "Forge isn't working" / "Fix my forge" / "Diagnose the error" / "Slice failed" / "MCP tools missing" / "Validation gate error"

## Steps

### 1. Capture the Symptom
If the user provided an argument, use it as the starting hypothesis. Otherwise, ask:
- What happened? (plan failed, tool missing, gate error, stalled run)
- At which slice did it fail? (if applicable)
- What error message was shown? (if any)

Categorize the symptom into one of:
- **Environment** — missing tools, wrong Node version, MCP not connected
- **Setup** — missing files, unresolved placeholders, broken config
- **Run Failure** — slice failed a validation gate or threw an error
- **Orchestrator** — CLI worker not found, token limits, cost overrun
- **Code Quality** — TODOs/stubs preventing gate passage

### 2. Environment Scan
Use the `forge_smith` MCP tool to inspect the environment.

Look for:
- Missing required tools (git, Node 20+, gh CLI, pforge)
- VS Code Copilot agent mode not enabled
- MCP server not running or not connected
- `.forge.json` missing or malformed
- Version mismatch (installed vs. required)

> **If critical failures found**: Report each failure with its FIX recommendation before continuing.

### 3. Setup Validation
Use the `forge_validate` MCP tool to check that all required Plan Forge files are present and correctly configured.

Look for:
- Missing instruction files (`.github/instructions/`)
- Missing skill or agent files
- Unresolved `<YOUR PROJECT NAME>` or `<YOUR TECH STACK>` placeholders
- `AGENTS.md` or `copilot-instructions.md` not generated

> **If setup failures found**: Recommend re-running `pforge check` or `setup.ps1`/`setup.sh --force`.

### 4. Run Status Check
Use the `forge_plan_status` MCP tool (no arguments) to retrieve the latest run report.

Look for:
- Which slice(s) failed
- The exact gate error or exception
- Whether the run was aborted or timed out
- Token usage and cost at the point of failure

> **If no run history found**: Skip to Step 6 (Code Quality).

### 5. Diagnose the Failure
Based on the failure type from Step 4:

#### Gate Error (build/test failed)
1. Show the exact failing command from the gate
2. Run `forge_sweep` to check for stubs or TODOs that may have caused the failure
3. Suggest the fix (fill stub, fix import, resolve conflict)
4. Advise: `forge_run_plan` with `resumeFrom: <failed-slice-number>` after fixing

#### CLI Worker Not Found
1. Check if `gh copilot`, `claude`, or `codex` CLI is installed
2. Suggest: install the missing CLI or switch to `mode: 'assisted'`

#### Cost Overrun / Token Limit
1. Show cost breakdown via `forge_cost_report`
2. Suggest: switch to a cheaper model, reduce slice scope, or split into smaller slices

#### MCP Tools Missing
1. Verify `pforge-mcp/` has dependencies installed (`npm install --prefix pforge-mcp`)
2. Verify `.vscode/mcp.json` is present and correctly configured
3. Suggest: re-run setup or manually start the MCP server

#### Slice Stalled / No Output
1. Check if the run is still active in `forge_plan_status`
2. Suggest: use `forge_abort` to stop the stalled run, then resume

### 6. Code Quality Scan
Use the `forge_sweep` MCP tool to detect deferred-work markers that may be blocking gate passage.

> **If sweep finds markers in production code**: List each one with file and line. These must be resolved before gates will pass.

### 7. Multi-Model Diagnosis (optional, high-complexity failures)
If the failure is ambiguous or the root cause is unclear, use the `forge_diagnose` MCP tool on the failing source file for multi-model root cause analysis.

Present:
- Consensus root cause
- Recommended fix
- Confidence level

### 8. Report & Fix Plan

```
Forge Troubleshoot Report:
  Symptom:      <what the user reported>
  Root Cause:   <identified cause>

  Environment:  PASS / FAIL (N issues)
  Setup:        PASS / FAIL (N issues)
  Last Run:     Slice N failed — <gate error>
  Sweep:        N deferred-work markers

  Fix Steps:
    1. <specific fix>
    2. <specific fix>
    3. Resume: forge_run_plan resumeFrom: N (if applicable)

  Overall: RESOLVED / NEEDS MANUAL ATTENTION
```

A RESOLVED status means all identified issues have actionable fixes. NEEDS MANUAL ATTENTION means there is a failure that requires human intervention (e.g., secrets missing, external service unreachable).

## Safety Rules
- This skill is DIAGNOSTIC — do NOT modify source files or plan files
- Only suggest file edits — do not apply them
- Never auto-resume a failed run without user confirmation
- Report all findings clearly with actionable next steps

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The error message is clear enough — skip the full diagnosis" | Surface errors often mask deeper issues. A gate failure might be caused by a missing dependency, not the code itself. Run the full diagnosis. |
| "I'll fix the code directly instead of diagnosing" | This skill is diagnostic-only. Fixing without understanding the root cause risks introducing new failures. Diagnose first, fix second. |
| "The environment scan passed, so it's a code problem" | Environment scans check tools and config, not runtime state. A passing environment check doesn't rule out MCP issues, stale caches, or port conflicts. |
| "I'll auto-resume the failed run after the fix" | Never auto-resume — the user must confirm the fix is correct and choose to continue. Auto-resuming risks running on partially broken state. |

## Warning Signs

- Source files modified during a troubleshoot session (this skill is read-only)
- Failed run resumed without user confirmation
- Diagnosis skipped steps (jumped from symptom to fix without environment/setup checks)
- Root cause labeled as "unknown" without attempting multi-model diagnosis
- Fix suggestions don't include the specific command or file to change

## Exit Proof

After completing this skill, confirm:
- [ ] All 6+ diagnostic steps executed (symptom → environment → setup → run status → diagnosis → sweep)
- [ ] Root cause identified with specific error and affected file/slice
- [ ] Fix steps are actionable (specific commands, not vague advice)
- [ ] Report shows overall status: RESOLVED or NEEDS MANUAL ATTENTION
- [ ] No source files were modified during diagnosis

## Persistent Memory (if OpenBrain is configured)

- **Before diagnosing**: `search_thoughts("forge failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load prior forge failures and recurring issues to avoid repeating diagnoses
- **After diagnosis**: `capture_thought("Forge troubleshoot: <symptom> → <root cause> → <fix>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-forge-troubleshoot")` — persist findings for future diagnostics
