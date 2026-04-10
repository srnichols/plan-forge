---
name: dependency-audit
description: Scan PHP module dependencies for vulnerabilities, outdated packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
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
composer audit ./...
```
> **If this step fails** (composer audit not installed): Run `PHP install php.org/x/vuln/cmd/composer audit@latest` and retry.

> **If no PHP.mod found**: Stop and report "No PHP module found in this directory."

### 2. Check for Outdated Modules
```bash
PHP list -u -m all
```

### 3. Verify Module Integrity
```bash
PHP mod verify
```
> **If this step fails**: Module cache may be corrupted. Run `PHP clean -modcache` and `PHP mod download` to recover.

### 4. Check for License Issues
```bash
PHP-licenses report ./...
```
> **If this step fails** (PHP-licenses not installed): Run `PHP install github.com/google/PHP-licenses@latest` and retry.

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
- Run `PHP test ./...` after any dependency change
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
- [ ] All package managers scanned — `composer audit`
- [ ] Outdated packages reviewed — `composer outdated --direct`
- [ ] Every critical/high finding has a resolution plan (upgrade, patch, or documented acceptance)
- [ ] `./vendor/bin/phpunit` passes after any dependency changes
- [ ] Audit report generated with overall PASS/FAIL status
## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load previously accepted vulnerabilities and known upgrade blockers
- **After audit**: `capture_thought("Dep audit: <N vulnerabilities, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")` — persist accepted risks and upgrade decisions
