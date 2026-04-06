---
name: dependency-audit
description: Scan Java/Maven project dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
argument-hint: "[optional: specific dependency to audit]"
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
mvn dependency-check:check
```
> **If this step fails** (no pom.xml found): Stop and report "No Maven project found in this directory."

> **If dependency-check plugin not configured**: Add `org.owasp:dependency-check-maven` plugin to pom.xml and retry.

### 2. Check for Outdated Dependencies
```bash
mvn versions:display-dependency-updates
```

### 3. Check for Outdated Plugins
```bash
mvn versions:display-plugin-updates
```

### 4. Check for License Issues
```bash
mvn license:third-party-report
```
> **If this step fails** (license plugin not configured): Review dependency licenses manually via `mvn dependency:tree`.

Review output for any dependencies with restrictive licenses (GPL, AGPL) that conflict with your project license.

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

Outdated Dependencies:
  Major behind:    N (plan upgrade)
  Minor/Patch:     N (update now)

Outdated Plugins:  N
License Issues:    N
Sweep Markers:     N (TODO/FIXME from prior changes)

Overall: PASS / FAIL
```

## Safety Rules
- NEVER auto-upgrade major versions without human approval
- ALWAYS check if the upgrade has breaking changes
- Run `mvn verify` after any dependency change
- Document any accepted vulnerabilities with justification

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions
