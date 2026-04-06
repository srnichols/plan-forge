---
name: dependency-audit
description: Scan Swift Package Manager dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
argument-hint: "[optional: specific package to audit]"
tools:
  - run_in_terminal
  - read_file
  - forge_sweep
---

# Dependency Audit Skill (Swift)

## Trigger
"Audit dependencies" / "Check for vulnerabilities" / "Are my packages up to date?"

## Steps

### 1. Check for Known Vulnerabilities
```bash
swift package audit
```
> **If this step fails** (`swift package audit` requires Swift 5.9+ / Xcode 15+): Report that the tool is unavailable and manually review dependencies against the [Swift Security Advisories](https://github.com/nicowillis/swift-security-advisories) or [OSV database](https://osv.dev).

> **If no Package.swift found**: Stop and report "No Swift Package Manager project found in this directory."

### 2. Check for Outdated Packages
```bash
swift package show-dependencies
```
Review each dependency and check if newer versions are available on GitHub/Swift Package Index.

### 3. Verify Package Integrity
```bash
swift package resolve
```
> **If this step fails**: Package cache may be corrupted. Run `swift package clean` and then `swift package resolve` to recover.

### 4. Check for License Issues
Review `Package.resolved` for each dependency URL. Check the license on the GitHub repository for each package.

Focus on packages with restrictive licenses (GPL, AGPL) that may conflict with your project license or App Store distribution.

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

Package Integrity:  PASS / FAIL
License Issues:     N
Sweep Markers:      N (TODO/FIXME from prior changes)

Overall: PASS / FAIL
```

## Safety Rules
- NEVER auto-upgrade major versions without human approval
- ALWAYS check the package changelog for breaking changes before upgrading
- Run `swift test` after any dependency change
- Document any accepted vulnerabilities with justification

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions