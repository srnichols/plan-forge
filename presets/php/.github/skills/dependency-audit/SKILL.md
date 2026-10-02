---
name: dependency-audit
description: Scan PHP/Laravel Composer dependencies for vulnerabilities, outdated packages, abandoned packages, and license issues. Use before PRs, after adding packages, or on a regular schedule.
argument-hint: "[optional: specific Composer package to audit]"
tools:
  - run_in_terminal
  - read_file
  - forge_sweep
---

# Dependency Audit Skill

## Trigger
"Audit dependencies" / "Check for vulnerabilities" / "Are my packages up to date?"

## Steps

### 1. Confirm Composer Project
```bash
test -f composer.json && composer validate --strict
```
> **If this step fails**: Stop and report "No valid Composer project found in this directory."

### 2. Install or Verify Locked Dependencies
```bash
composer install --no-interaction --prefer-dist
```
> **If composer.lock is missing**: Report that the lock file must be created and reviewed before vulnerability results are trusted.

### 3. Check for Known Vulnerabilities
```bash
composer audit
```
Review all advisories, including transitive packages. Critical and high advisories require an upgrade, patch, replacement, or documented accepted risk.

### 4. Check Direct Package Freshness
```bash
composer outdated --direct
```
Separate major-version upgrades from minor and patch upgrades. Do not upgrade majors automatically.

### 5. Inspect Abandoned and Platform Packages
```bash
composer show --direct
composer check-platform-reqs
```
Flag abandoned packages, missing PHP extensions, and packages that cannot run on PHP 8.5.

### 6. Review Licenses
```bash
composer licenses
```
Escalate GPL, AGPL, proprietary, unknown, or custom licenses for human review when they conflict with project policy.

### 7. Completeness Scan
Use the `forge_sweep` MCP tool to check for TODO/FIXME markers left by dependency changes, upgrade notes, or temporary overrides.

## Safety Rules
- NEVER auto-upgrade major versions without human approval.
- ALWAYS run the Laravel test command after any dependency change.
- Do not ignore abandoned packages; replacement is part of the remediation plan.
- Document accepted vulnerabilities with package, advisory ID, affected path, and expiration date.
- Keep `composer.json` and `composer.lock` in sync.

## Review Findings

For each finding:
- **Critical/High CVE**: upgrade immediately or document accepted risk.
- **Outdated major version**: plan a compatibility upgrade.
- **Outdated minor/patch**: update now if tests pass.
- **Abandoned package**: choose replacement or isolate with a tracked risk.
- **License conflict**: stop and request human approval.

## Report

```text
Dependency Audit Summary:
  Critical advisories: N
  High advisories:     N
  Medium/Low:          N

Outdated Direct Packages:
  Major behind:        N
  Minor/Patch:         N

Abandoned Packages:    N
License Issues:        N
Platform Problems:     N
Sweep Markers:         N

Overall: PASS / FAIL
```

## Temper Guards

| Shortcut | Why It Breaks |
| --- | --- |
| "Composer audit passed, so dependencies are fine" | Audit does not flag stale direct dependencies, abandoned packages, or incompatible licenses. |
| "The vulnerable package is dev-only" | Composer plugins and dev tools execute during install, test, and CI. They are supply-chain risk. |
| "We'll update after release" | Vulnerable dependencies tend to remain pinned. Record a dated acceptance or fix now. |
| "Transitive advisories are outside our control" | Direct package upgrades or conflict rules often resolve transitive vulnerabilities. |

## Warning Signs

- `composer.lock` absent or not committed.
- `composer audit` skipped because install failed.
- Abandoned package warnings ignored.
- Major upgrades applied without reading release notes.
- License output not reviewed.

## Exit Proof

After completing this skill, confirm:
- [ ] `composer validate --strict` passed.
- [ ] `composer audit` completed and advisories were triaged.
- [ ] `composer outdated --direct` reviewed.
- [ ] Platform requirements checked for PHP 8.5.
- [ ] Licenses reviewed for incompatibilities.
- [ ] `php artisan test` passes after dependency changes, or not-run rationale is stated.

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("php composer dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After audit**: `capture_thought("Dep audit (PHP): <N advisories, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")`
