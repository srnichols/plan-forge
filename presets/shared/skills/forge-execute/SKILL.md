---
name: forge-execute
description: Guided plan execution — list available plans, estimate cost, choose mode, and execute with live progress. Use when you want to run a hardened plan through the orchestrator.
argument-hint: "[optional: plan file path, e.g. 'docs/plans/Phase-1-AUTH-PLAN.md']"
tools:
  - forge_status
  - forge_run_plan
  - forge_plan_status
  - forge_cost_report
  - forge_smith
---

# Forge Execute Skill

## Trigger
"Run my plan" / "Execute the plan" / "Start plan execution" / "Run phase N"

## Steps

### 1. Pre-flight Check
Use the `forge_smith` MCP tool to verify the environment is ready for plan execution.

Check for:
- Orchestrator present and ready
- CLI workers available (gh copilot, claude, or codex)
- MCP dependencies installed

> **If no CLI workers available**: STOP. Report that `gh copilot CLI`, `claude CLI`, or `codex CLI` must be installed. Suggest `mode: 'assisted'` as a fallback.

### 2. List Available Plans
Use the `forge_status` MCP tool to show all phases from DEPLOYMENT-ROADMAP.md with their current status.

Present to user:
- Phase name 
- Current status (planned, in-progress, complete, paused)
- Plan file path

> **If no plans found**: STOP. Report that no DEPLOYMENT-ROADMAP.md or plan files exist. Suggest running the Step 0 (Specify) pipeline prompt first.

### 3. Plan Selection
If the user didn't specify a plan in the argument:
- Present the list of available plans from Step 2
- Ask which plan to execute
- Confirm the selection

If the user specified a plan: verify the file exists and proceed.

### 4. Cost Estimate
Use the `forge_run_plan` MCP tool with `estimate: true` to get a cost preview without executing.

Present:
- Number of slices
- Estimated cost (USD)
- Model(s) to be used
- Confidence level of estimate

> **If estimated cost exceeds $5.00**: Warn the user and ask for explicit confirmation before proceeding.

### 5. Mode Selection
Ask the user to choose execution mode:
- **Auto** — CLI worker executes all slices autonomously with validation gates
- **Assisted** — Human reviews each slice output, gates run automatically

Also ask:
- Model preference (or accept default from `.forge.json`)
- Whether to enable Quorum mode for high-complexity slices

### 6. Execute
Use the `forge_run_plan` MCP tool with the selected parameters:
- `plan`: path from Step 3
- `mode`: from Step 5
- `model`: from Step 5 (or omit for default)
- `quorum`: from Step 5 (or "false")

Monitor execution progress. If the run fails at a slice:
- Report which slice failed and the gate error
- Ask if the user wants to fix and resume with `resumeFrom`

### 7. Results
Use the `forge_plan_status` MCP tool to get the final execution summary.

Use the `forge_cost_report` MCP tool to show cost breakdown.

### 8. Report
```
Plan Execution Summary:
  Plan:           <plan name>
  Mode:           auto / assisted
  Model:          <model used>
  Quorum:         on / off / auto

  Slices:         N total
  Passed:         N
  Failed:         N
  Skipped:        N

  Duration:       Ns
  Cost:           $N.NN

  Overall: PASS / FAIL
```

> **If FAIL**: Show failed slices with error details. Suggest `forge_run_plan` with `resumeFrom` to continue from the failed slice.

## Safety Rules
- ALWAYS show cost estimate before executing
- ALWAYS confirm mode and model selection with the user
- NEVER auto-execute if estimated cost exceeds $5.00 without explicit user confirmation
- Report failures immediately — do not silently continue past failed gates

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll skip the cost estimate — it's a small plan" | Small plans with quorum mode or expensive models can still cost $10+. Always estimate first. |
| "Auto mode is fine, no need to ask the user" | The user should always choose the execution mode. Auto mode modifies files autonomously — that decision belongs to the human. |
| "The last run passed, so I'll reuse the same settings" | Model availability, pricing, and project state change between runs. Always verify current settings. |
| "I'll ignore the failed slice and continue" | Failed gates exist for a reason. Continuing past a failure compounds the error into every subsequent slice. |

## Warning Signs

- Plan execution started without showing a cost estimate first
- Mode or model selected without user confirmation
- Failed slice not reported immediately (errors accumulated until end)
- Execution resumed from a failed slice without the user fixing the underlying issue
- Cost exceeded $5.00 without explicit user approval

## Exit Proof

After completing this skill, confirm:
- [ ] Cost estimate was shown and acknowledged before execution
- [ ] User confirmed mode (auto/assisted) and model selection
- [ ] All passing slices have gate results (build + test output)
- [ ] Failed slices (if any) have error details and suggested fix
- [ ] Final report includes slice count, pass/fail, duration, and cost
- [ ] `forge_cost_report` output matches expected spend

## Persistent Memory (if OpenBrain is configured)

- **Before executing**: `search_thoughts("plan execution failure", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "postmortem")` — load prior execution failures for this plan to avoid repeating mistakes
- **After execution**: `capture_thought("Plan execution: <plan name> — <outcome summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-forge-execute")` — persist execution results and any lessons learned
