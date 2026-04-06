---
name: dependency-audit
description: Scan Swift package dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
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
swift package audit
```
> **If this step fails** (older toolchain): Review `Package.resolved` manually against known CVE databases. Report and continue.

> **If no Package.swift found**: Stop and report "No Swift package found in this directory."

### 2. Check for Outdated Packages
```bash
swift package show-dependencies
```

### 3. Verify Package Integrity
```bash
swift package resolve
```
> **If this step fails**: Package cache may be corrupted. Run `swift package clean` and `swift package resolve` to recover.

### 4. Check Package.resolved is Committed
```bash
git status Package.resolved
```
> **If Package.resolved is in .gitignore**: Flag as a finding — it must be committed for reproducible builds.

### 5. Check for License Issues
Review `Package.swift` dependencies and check their GitHub repositories for license files.
Flag any dependencies with GPL, AGPL, or SSPL licenses that may conflict with your project license.

### 6. Completeness Scan
Use the `forge_sweep` MCP tool to check for TODO/FIXME markers that may have been left by prior dependency changes.

### 7. Review Findings
For each finding:
- **Critical/High CVE**: Upgrade immediately or document accepted risk
- **Outdated (major version behind)**: Plan upgrade in next phase
- **Outdated (minor/patch)**: Update now if safe
- **License conflict**: Flag for human review

### 8. Report
```
Dependency Audit Summary:
  🔴 Critical:     N vulnerabilities
  🟡 High:         N vulnerabilities
  🔵 Medium/Low:   N vulnerabilities

Outdated Packages:
  Major behind:    N (plan upgrade)
  Minor/Patch:     N (update now)

Package Integrity:  PASS / FAIL
License Issues:    N
Sweep Markers:     N (TODO/FIXME from prior changes)

Overall: PASS / FAIL
```

## Safety Rules
- NEVER auto-upgrade major versions without human approval
- ALWAYS check if the upgrade has breaking changes (Swift packages often have API changes between major versions)
- Run `swift test` after any dependency change
- Document any accepted vulnerabilities with justification

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions
