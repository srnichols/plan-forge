---
name: dependency-audit
description: Scan Python project dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
argument-hint: "[optional: specific package to audit]"
tools:
  - run_in_terminal
  - read_file
  - forge_sweep
---

# Dependency Audit Skill

## Trigger
"Audit dependencies" / "Check for vulnerabilities" / "Are my packages up to date?"

## Steps

### 1. Check for Known Vulnerabilities
```bash
pip-audit
```
> **If this step fails** (pip-audit not installed): Run `pip install pip-audit` and retry.

> **If no requirements.txt or pyproject.toml found**: Stop and report "No Python project found in this directory."

### 2. Run Safety Check
```bash
safety check
```
> **If this step fails** (safety not installed): Run `pip install safety` and retry.

### 3. Check for Outdated Packages
```bash
pip list --outdated
```

### 4. Check for License Issues
```bash
pip-licenses --summary
```
> **If this step fails** (pip-licenses not installed): Run `pip install pip-licenses` and retry.

Review output for any packages with restrictive licenses (GPL, AGPL) that conflict with your project license.

### 5. Completeness Scan
Use the `forge_sweep` MCP tool to check for TODO/FIXME markers that may have been left by prior dependency changes.

### 6. Review Findings
For each finding:
- **Critical/High CVE**: Upgrade immediately or document accepted risk
- **Outdated (major version behind)**: Plan upgrade in next phase
- **Outdated (minor/patch)**: Update now if safe
- **License conflict**: Flag for human review

### 7. Report
```
Dependency Audit Summary:
  🔴 Critical:     N vulnerabilities
  🟡 High:         N vulnerabilities
  🔵 Medium/Low:   N vulnerabilities

Outdated Packages:
  Major behind:    N (plan upgrade)
  Minor/Patch:     N (update now)

License Issues:    N
Sweep Markers:     N (TODO/FIXME from prior changes)

Overall: PASS / FAIL
```

## Safety Rules
- NEVER auto-upgrade major versions without human approval
- ALWAYS check if the upgrade has breaking changes
- Run `pytest` after any dependency change
- Document any accepted vulnerabilities with justification

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions
