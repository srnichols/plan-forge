---
name: dependency-audit
description: Scan project dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
argument-hint: "[optional: specific package to audit]"
---

# Dependency Audit Skill

## Trigger
"Audit dependencies" / "Check for vulnerabilities" / "Are my packages up to date?"

## Steps

### 1. Identify Package Manager
```bash
# Detect which package manager is in use
# .NET: *.csproj → dotnet list package
# Node: package.json → npm audit / pnpm audit
# Python: requirements.txt / pyproject.toml → pip-audit / safety
# Go: go.mod → govulncheck
# Java: pom.xml → mvn dependency-check:check
```

### 2. Check for Known Vulnerabilities
```bash
# .NET
dotnet list package --vulnerable --include-transitive

# Node
pnpm audit --audit-level high

# Python
pip-audit

# Go
govulncheck ./...
```

### 3. Check for Outdated Packages
```bash
# .NET
dotnet list package --outdated

# Node
pnpm outdated

# Python
pip list --outdated

# Go
go list -u -m all
```

### 4. Review Findings
For each finding:
- **Critical/High CVE**: Upgrade immediately or document accepted risk
- **Outdated (major version behind)**: Plan upgrade in next phase
- **Outdated (minor/patch)**: Update now if safe
- **License conflict**: Flag for human review

### 5. Report
```
Vulnerability Summary:
  🔴 Critical: N
  🟡 High: N
  🔵 Medium/Low: N

Outdated Packages:
  Major behind: N (plan upgrade)
  Minor/Patch behind: N (update now)

License Issues: N
```

## Safety Rules
- NEVER auto-upgrade major versions without human approval
- ALWAYS check if the upgrade has breaking changes
- Run full test suite after any dependency change
- Document any accepted vulnerabilities with justification

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<project>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<project>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions
