---
name: security-audit
description: "Comprehensive Go security audit — OWASP vulnerability scan, govulncheck, secrets detection, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (Go)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

4-phase security audit tailored for Go projects. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and secrets detection patterns.

---

## Phase 1: OWASP Vulnerability Scan (Go Specific)

### A1: Broken Access Control
- Check HTTP handlers for missing auth middleware on protected routes
- Check for direct use of URL params/query strings in database lookups without ownership validation
- Check for missing RBAC checks before data mutation

### A3: Injection
- Search for string concatenation in SQL: `"SELECT ... " + variable`, `fmt.Sprintf("SELECT ... %s", variable)`
- Must use parameterized queries: `$1` (pgx), `?` (database/sql)
- Check for `os/exec.Command()` or `exec.CommandContext()` with user input
- Check for `text/template` used for HTML output (must use `html/template`)
- Check for `unsafe` package usage

### A5: Security Misconfiguration
- Check CORS for wildcard origins (must specify explicitly)
- Check for TLS configuration in production (no `InsecureSkipVerify: true`)
- Check for rate limiting on auth endpoints
- Check for verbose error messages exposing internal state

### A7: Authentication Failures
- Check password hashing uses `golang.org/x/crypto/bcrypt` (not custom hashing)
- Check JWT uses `golang-jwt` with proper algorithm validation
- Check for timing-safe comparison: `subtle.ConstantTimeCompare()` for tokens/secrets
- Check for rate limiting on login endpoints

### A8: Software and Data Integrity
- Check `go.sum` is committed (integrity verification)
- Check for `unsafe` package usage (type safety bypass)
- Check for `reflect` with user input
- Check for `encoding/gob` or `encoding/json` deserialization of untrusted data without validation

### Go-Specific: Race Conditions
- Check for shared mutable state without mutex/sync protection
- Check for goroutine leaks (unbuffered channels, missing context cancellation)
- Run `go vet -race` check recommendation

---

## Phase 2: Dependency Audit (govulncheck)

```bash
govulncheck ./...
```

If govulncheck is not installed:
```bash
go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...
```

Check for outdated modules:
```bash
go list -u -m all
```

> **If govulncheck is not available**: Report and continue. Do NOT fail the entire audit.

---

## Phase 3: Secrets Detection

Use the patterns from the shared skill (`presets/shared/.github/skills/security-audit/SKILL.md` Phase 3).

**Additional Go patterns**:
- Database DSN strings with passwords in source: `postgres://user:password@host/db`
- Hardcoded API keys in `const` or `var` declarations
- `.env` files with real values (check if `.env` is in `.gitignore`)

Exclude: `vendor/`, `.git/`, `bin/`, `testdata/` (unless `testdata/` contains real secrets)

---

## Phase 4: Combined Report

Follow the shared skill report format. See `presets/shared/.github/skills/security-audit/SKILL.md` Phase 4.

---

## Safety Rules
- READ-ONLY — do NOT modify any files
- Do NOT log actual secret values — show only first 8 characters + `***`
- Do NOT recommend disabling security features as a fix

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("security audit", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After audit**: `capture_thought("Security audit (Go): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
