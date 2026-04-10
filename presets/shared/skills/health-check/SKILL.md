---
name: health-check
description: Run a full Plan Forge health diagnostic — environment, setup validation, and completeness scan. Use to verify your forge is properly configured and code is clean.
argument-hint: "[optional: specific check to focus on — 'environment', 'setup', or 'sweep']"
tools:
  - forge_smith
  - forge_validate
  - forge_sweep
---

# Health Check Skill

## Trigger
"Check my setup" / "Is my forge healthy?" / "Run health check" / "Diagnose my project"

## Steps

### 1. Environment Diagnostics
Use the `forge_smith` MCP tool to inspect the forge — diagnose environment, VS Code config, setup health, version currency, and common problems.

Review the output for:
- Required tools installed (git, VS Code, PowerShell/Bash, gh CLI)
- VS Code settings for Copilot agent mode
- .forge.json validity and version currency
- MCP server status
- Orchestrator readiness

> **If forge_smith reports failures**: List each failure with its FIX recommendation. Continue to Step 2 regardless.

### 2. Setup Validation
Use the `forge_validate` MCP tool (or run `pforge check`) to verify that all required Plan Forge files exist, file counts match preset expectations, and no unresolved placeholders remain.

Review the output for:
- Required files present (instructions, agents, prompts, skills)
- File counts match preset expectations
- No unresolved `<YOUR PROJECT NAME>` placeholders
- AGENTS.md and copilot-instructions.md configured

> **If validate reports missing files**: Flag as CRITICAL — setup may need to be re-run.

### 3. Completeness Scan
Use the `forge_sweep` MCP tool to scan code files for TODO, FIXME, HACK, stub, placeholder, and mock data markers.

Review the output for:
- Count of deferred-work markers
- Location of each marker
- Whether markers are in production code vs. test/config files

> **If sweep finds markers in production code**: Flag as WARNING — these should be resolved before the Review Gate (Step 5).

### 4. Report

```
Plan Forge Health Check:
  Environment:   N passed, N failed, N warnings
  Setup:         N passed, N failed
  Sweep:         N deferred-work markers found

  Critical Issues: (list any)
  Warnings:        (list any)
  Recommendations: (list any)

  Overall: PASS / FAIL
```

A PASS requires:
- Zero environment failures (warnings OK)
- Zero setup failures
- Zero sweep markers in production code (markers in tests/config are OK)

## Safety Rules
- This skill is READ-ONLY — do NOT modify any files
- Report findings clearly with actionable fix recommendations
- Distinguish between critical issues (must fix) and warnings (should fix)

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Smith passed, so everything is fine" | Smith checks environment and config, not code quality or plan state. A passing smith doesn't mean your sweep is clean or your plans are valid. |
| "The sweep found markers but they're just TODOs in tests" | Sweep markers in test files are INFO-level, but markers in production code block gate passage. Report them separately — don't dismiss the whole sweep. |
| "Setup validation isn't needed — I ran setup recently" | File counts drift when files are manually deleted or instructions updated. Always validate after any change to the `.github/` directory. |

## Warning Signs

- Health check skipped one or more diagnostic steps (environment, setup, sweep)
- Sweep markers in production code reported as OK
- Setup validation failures dismissed without running `pforge check` or re-running setup
- Report shows PASS when critical issues were found but downgraded

## Exit Proof

After completing this skill, confirm:
- [ ] `forge_smith` output reviewed — zero environment failures
- [ ] `forge_validate` output reviewed — zero setup failures
- [ ] `forge_sweep` output reviewed — zero markers in production code
- [ ] Final report includes counts for each category (environment, setup, sweep)
- [ ] Overall status is PASS or FAIL with clear justification

## Persistent Memory (if OpenBrain is configured)

- **Before checking**: `search_thoughts("setup issue", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load prior setup issues and recurring health check failures
- **After check**: `capture_thought("Health check: <summary of findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-health-check")` — persist environment issues for future diagnostics
