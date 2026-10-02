---
name: security-audit
description: "Comprehensive PHP/Laravel security audit — OWASP review, Composer audit, secrets detection, GraphQL checks, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets', 'graphql']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (PHP / Laravel)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

Six-phase security audit tailored for PHP 8.5, Laravel 13.x, Sanctum, queues, and Lighthouse.

---

## Steps

### 1. Review Laravel Access Control
Inspect `routes/api.php`, controllers, Form Requests, policies, middleware, and GraphQL SDL.

```bash
php artisan route:list --path=v1
```

Check for missing `auth:sanctum`, missing policy calls, tenant IDs read from client input, and Lighthouse fields without `@guard` plus current policy directives.

> **If no Laravel project is found**: Stop and report "No Laravel project found in this directory."

### 2. Check Validation, Injection, and Output Encoding
Search for unvalidated boundary input, mass assignment, interpolated SQL, unsafe Blade output, and upload shortcuts.

```bash
grep -R "request()->all()\\|->all()\\|DB::raw\\|{!!" app resources routes database --exclude-dir=vendor
```

Review each hit manually; a hit is not automatically a finding unless it is reachable with untrusted input.

### 3. Run Composer Vulnerability Audit
```bash
composer audit
```

> **If composer.lock is missing**: Run `composer install` first if appropriate, otherwise report that dependency advisories could not be resolved.

### 4. Review Outdated Direct Dependencies
```bash
composer outdated --direct
```

Flag abandoned packages, unmaintained security tooling, and major-version lag that blocks security updates.

### 5. Scan for Secrets and Misconfiguration
Search for committed keys, unsafe CORS, debug mode, exposed stack traces, and production GraphQL introspection without printing secret values.

```bash
grep -RIl "APP_KEY=\\|password\\|secret\\|token\\|CORS_ALLOWED_ORIGINS=\\*\\|LIGHTHOUSE_DISABLE_INTROSPECTION=false" . \
  --exclude-dir=vendor --exclude-dir=node_modules --exclude-dir=storage --exclude-dir=.git \
  --exclude=".env" --exclude=".env.*"
```

Report only redacted secret prefixes: first 8 characters followed by `***`.

### 6. Produce Combined Security Report
Classify each confirmed issue by OWASP category, CWE when available, severity, confidence, and remediation path.

```text
Security Audit Summary:
  Critical: N
  High:     N
  Medium:   N
  Low:      N

Dependency Advisories: N
Secret Findings:      N
GraphQL Findings:     N
Overall: PASS / FAIL
```

## Safety Rules
- READ-ONLY — do not modify application files during the audit.
- Do not print full secret values; redact to the first 8 characters plus `***`.
- Do not recommend disabling CSRF, auth middleware, policies, or validation as fixes.
- Treat tenant identity from headers, query strings, or bodies as a high-severity finding unless independently authenticated and authorized.
- If a scanner is missing, report that gap and continue the remaining phases.

## Temper Guards

| Shortcut | Why It Breaks |
| --- | --- |
| "The route is internal" | Internal Laravel routes are often exposed by proxies, queues, or future refactors. Audit them. |
| "The model scope handles authorization" | Tenant scopes limit data; policies decide action permission. Both must exist. |
| "Composer audit is enough" | Dependency scans do not detect IDOR, tenant leakage, CORS mistakes, or unsafe GraphQL. |
| "The secret is from a test fixture" | Test secrets are copied into production examples and logs. Review at least as LOW unless proven fake. |

## Warning Signs

- Security audit skips one of the six phases.
- Findings have no file:line evidence.
- Critical or high findings are present but the verdict says PASS.
- GraphQL policy directives are not checked.
- Missing dependency scanner is silently ignored.

## Exit Proof

After completing this skill, confirm:
- [ ] `php artisan route:list --path=v1` reviewed for protected routes.
- [ ] Boundary validation, SQL, Blade, upload, and mass-assignment patterns reviewed.
- [ ] `composer audit` result included.
- [ ] `composer outdated --direct` reviewed for direct package risk.
- [ ] Secrets and security configuration scanned with redacted output.
- [ ] Combined report includes severity, confidence, OWASP/CWE mapping, and PASS/FAIL.

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("security audit php laravel", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After audit**: `capture_thought("Security audit (PHP): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
