---
name: dependency-audit
description: Scan Go module dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
argument-hint: "[optional: specific module to audit]"
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
govulncheck ./...
```
> **If this step fails** (govulncheck not installed): Run `go install golang.org/x/vuln/cmd/govulncheck@latest` and retry.

> **If no go.mod found**: Stop and report "No Go module found in this directory."

### 2. Check for Outdated Modules
```bash
go list -u -m all
```

### 3. Verify Module Integrity
```bash
go mod verify
```
> **If this step fails**: Module cache may be corrupted. Run `go clean -modcache` and `go mod download` to recover.

### 4. Check for License Issues
```bash
go-licenses report ./...
```
> **If this step fails** (go-licenses not installed): Run `go install github.com/google/go-licenses@latest` and retry.

Review output for any modules with restrictive licenses (GPL, AGPL) that conflict with your project license.

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

Outdated Modules:
  Major behind:    N (plan upgrade)
  Minor/Patch:     N (update now)

Module Integrity:  PASS / FAIL
License Issues:    N
Sweep Markers:     N (TODO/FIXME from prior changes)

Overall: PASS / FAIL
```

## Safety Rules
- NEVER auto-upgrade major versions without human approval
- ALWAYS check if the upgrade has breaking changes
- Run `go test ./...` after any dependency change
- Document any accepted vulnerabilities with justification

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions
