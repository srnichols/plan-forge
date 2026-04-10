---
name: dependency-audit
description: Scan .NET project dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
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
dotnet list package --vulnerable --include-transitive
```
> **If this step fails** (no .csproj found): Stop and report "No .NET project found in this directory."

### 2. Check for Outdated Packages
```bash
dotnet list package --outdated
```

### 3. Check for License Issues
```bash
dotnet list package --include-transitive --format json
```
Review output for any packages with restrictive licenses (GPL, AGPL) that conflict with your project license.

### 4. Completeness Scan
Use the `forge_sweep` MCP tool to check for TODO/FIXME markers that may have been left by prior dependency changes.

### 5. Review Findings
For each finding:
- **Critical/High CVE**: Upgrade immediately or document accepted risk
- **Outdated (major version behind)**: Plan upgrade in next phase
- **Outdated (minor/patch)**: Update now if safe
- **License conflict**: Flag for human review

### 6. Report
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
- Run `dotnet test` after any dependency change
- Document any accepted vulnerabilities with justification


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "These are all false positives" | Dismissing findings without verification creates a blind spot. Each finding needs individual assessment. |
| "We'll update after the release" | Post-release updates never happen. Vulnerable dependencies ship to production and stay there. |
| "Dev dependencies don't matter" | Build-time dependencies can inject malicious code. Supply chain attacks target dev tooling. |
| "The vulnerability doesn't apply to our usage" | Usage analysis requires proof. Document exactly which code paths are safe and why. |

## Warning Signs

- Findings dismissed without verification — CVEs marked "won't fix" without written justification
- Critical/high CVEs with no resolution plan — severe vulnerabilities acknowledged but not addressed
- Audit not run on all package managers — only one ecosystem scanned when project uses multiple
- Outdated transitive dependencies ignored — direct deps updated but vulnerable transitives remain
- License violations not flagged — incompatible licenses in dependencies not identified

## Exit Proof

After completing this skill, confirm:
- [ ] All package managers scanned — `dotnet list package --vulnerable --include-transitive`
- [ ] Outdated packages reviewed — `dotnet list package --outdated`
- [ ] Every critical/high finding has a resolution plan (upgrade, patch, or documented acceptance)
- [ ] `dotnet test` passes after any dependency changes
- [ ] Audit report generated with overall PASS/FAIL status
## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions
