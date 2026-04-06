---
name: security-audit
description: "Comprehensive security audit — OWASP vulnerability scan, dependency audit, secrets detection, and combined severity report. Use before releases, after security incidents, or on a regular schedule."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets' — run a specific phase only]"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "Security review" / "OWASP check"

## Overview

This skill orchestrates a 4-phase security audit:
1. **OWASP Vulnerability Scan** — review source code for OWASP Top 10 vulnerabilities
2. **Dependency Audit** — scan packages for known CVEs
3. **Secrets Detection** — scan for leaked API keys, tokens, credentials
4. **Combined Report** — aggregate all findings with severity ratings

If an `argument-hint` phase is specified, run only that phase. Otherwise run all 4.

---

## Phase 1: OWASP Vulnerability Scan

Scan all source files for OWASP Top 10 (2021) vulnerabilities. Use grep/search to identify patterns.

### A1: Broken Access Control
Search for routes/endpoints missing authentication middleware:
- Grep for route definitions without `auth`, `authorize`, `requireAuth`, `[Authorize]`, or equivalent
- Check for direct object references using user-supplied IDs without ownership validation

### A2: Cryptographic Failures
- Search for hardcoded secrets: `password`, `secret`, `apikey`, `connectionString` in assignment statements
- Check for weak hashing: `md5`, `sha1` used for passwords (should be `bcrypt`, `argon2`, `PBKDF2`)
- Check for HTTP URLs in API calls (should be HTTPS)

### A3: Injection
- Search for string concatenation/interpolation in SQL queries (template literals, f-strings, string.Format)
- Check for `eval()`, `exec()`, `Function()`, `vm.runInContext()`, `os.system()`, `subprocess` with shell=True
- Check for unsanitized user input in HTML rendering

### A5: Security Misconfiguration
- Check CORS configuration for wildcard (`*`) origins
- Check for missing security headers (check for helmet, HSTS, CSP)
- Check for verbose error messages in production (stack traces exposed)
- Check for default credentials or admin routes without protection

### A7: Authentication Failures
- Check password storage (must be hashed, not plaintext or reversible)
- Check JWT configuration (expiry, algorithm, secret strength)
- Check for brute-force protection (rate limiting on auth endpoints)

### A8: Software and Data Integrity
- Check for `eval()` or dynamic imports with user input
- Check for missing integrity checks on external resources (SRI hashes)

### A9: Security Logging Failures
- Check if authentication events are logged (login, logout, failed attempts)
- Check if authorization failures are logged

> **If an OWASP finding is detected**: Record it with CWE ID, severity, file, line, and confidence level (DEFINITE / LIKELY / INVESTIGATE).

---

## Phase 2: Dependency Audit

Run the stack-appropriate dependency scanner. This phase is **stack-specific** — the preset variant overrides this section.

### Generic Fallback
If no stack-specific variant is available:
1. Check for `package.json` → run `npm audit --audit-level high`
2. Check for `requirements.txt` / `pyproject.toml` → run `pip audit` or `safety check`
3. Check for `*.csproj` → run `dotnet list package --vulnerable`
4. Check for `go.mod` → run `govulncheck ./...`
5. Check for `pom.xml` → run `mvn dependency-check:check`

For each vulnerability found, record:
- Package name and version
- CVE ID
- Severity (CRITICAL / HIGH / MEDIUM / LOW)
- Fixed version (if available)
- Whether an upgrade is breaking

> **If scanner is not installed**: Report which tool is needed and continue to Phase 3. Do NOT fail the entire audit.

---

## Phase 3: Secrets Detection

Scan all source files (excluding `node_modules/`, `.git/`, `vendor/`, `bin/`, `obj/`, `__pycache__/`, `target/`) for leaked credentials.

### Secret Patterns to Detect

| Pattern | Regex | Description |
|---------|-------|-------------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` | AWS IAM access key ID |
| AWS Secret Key | `(?i)(aws_secret_access_key\|aws_secret)\s*[=:]\s*[A-Za-z0-9/+=]{40}` | AWS secret access key |
| Azure Storage Key | `(?i)(AccountKey\|azure_storage_key)\s*[=:]\s*[A-Za-z0-9+/=]{88}` | Azure Storage account key |
| Azure AD Client Secret | `(?i)(client_secret\|clientSecret)\s*[=:]\s*[A-Za-z0-9~._-]{34,}` | Azure AD app secret |
| GitHub Token | `gh[pousr]_[A-Za-z0-9_]{36,}` | GitHub personal/OAuth/user/service token |
| GitHub Classic PAT | `ghp_[A-Za-z0-9]{36}` | GitHub classic personal access token |
| Generic API Key | `(?i)(api_key\|apikey\|api-key)\s*[=:]\s*["'][A-Za-z0-9_-]{20,}["']` | Generic API key assignment |
| JWT Secret | `(?i)(jwt_secret\|JWT_SECRET\|token_secret)\s*[=:]\s*["'][^"']{10,}["']` | JWT signing secret |
| Private Key | `-----BEGIN (RSA\|EC\|DSA\|OPENSSH) PRIVATE KEY-----` | PEM private key |
| Connection String | `(?i)(Server\|Data Source)=.*(Password\|Pwd)=` | Database connection string with password |
| Slack Token | `xox[bporas]-[0-9]{10,}-[A-Za-z0-9]{10,}` | Slack API token |
| SendGrid Key | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` | SendGrid API key |
| Stripe Key | `[sr]k_(test\|live)_[A-Za-z0-9]{24,}` | Stripe API key |

### Exclusion Rules
- **Ignore test/mock files**: Files matching `*test*`, `*spec*`, `*mock*`, `*fixture*` — log as INFO, not a finding
- **Ignore example/template files**: Files matching `*example*`, `*template*`, `*sample*` — log as INFO
- **Ignore environment files in .gitignore**: If `.env` is in `.gitignore`, report as INFO (good practice)
- **Ignore `.env.example`**: This is expected to have placeholder keys

> **For each secret found**: Record file, line, pattern matched, and whether the file is tracked by git (`git ls-files`). Secrets in git-tracked files are CRITICAL. Secrets in untracked files are MEDIUM.

---

## Phase 4: Combined Report

Aggregate all findings into a single structured report:

```
╔══════════════════════════════════════════════════════════════════════╗
║                    SECURITY AUDIT REPORT                            ║
║                    Date: YYYY-MM-DD HH:MM                           ║
║                    Project: <project name>                          ║
╠══════════════════════════════════════════════════════════════════════╣

Phase 1 — OWASP Vulnerability Scan
═══════════════════════════════════
  🔴 CRITICAL:  N findings
  🟠 HIGH:      N findings
  🟡 MEDIUM:    N findings
  🔵 LOW:       N findings

  [Table of findings: Severity | CWE | File:Line | Description | Confidence]

Phase 2 — Dependency Audit
══════════════════════════
  🔴 CRITICAL:  N packages
  🟠 HIGH:      N packages
  🟡 MEDIUM:    N packages

  [Table of findings: Severity | CVE | Package | Current | Fixed]

Phase 3 — Secrets Detection
════════════════════════════
  🔴 CRITICAL:  N secrets in tracked files
  🟡 MEDIUM:    N secrets in untracked files
  ℹ️  INFO:      N secrets in test/example files (acceptable)

  [Table of findings: Severity | File:Line | Pattern | Git Tracked]

══════════════════════════════════════════════════════════════════════
SUMMARY
══════════════════════════════════════════════════════════════════════
  Total Findings:   N
  Critical:         N  (must fix before release)
  High:             N  (fix in current sprint)
  Medium:           N  (fix in next sprint)
  Low:              N  (hardening — plan upgrade)

  Overall: 🔴 FAIL / 🟢 PASS

  PASS requires: Zero CRITICAL findings, Zero HIGH secrets
  NOTE: HIGH OWASP/dependency findings trigger WARNING, not FAIL
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Safety Rules

- This skill is **READ-ONLY** — do NOT modify any files
- Do NOT log actual secret values in the report — show only the first 8 characters + `***`
- Do NOT recommend disabling security features as a fix
- All severity ratings must use OWASP/CWE classification, not subjective judgment
- If unsure about a finding, classify as INVESTIGATE and let a human decide

## Quorum Integration

When run with `--quorum`:
- 3 models independently perform the OWASP scan (Phase 1)
- Reviewer synthesizes findings, removing false positives and escalating consensus issues
- Dependency audit (Phase 2) and secrets scan (Phase 3) run once (deterministic)

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("security audit findings", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load prior findings, accepted risks, and known false positives
- **After audit**: `capture_thought("Security audit: <N findings — N critical, N high — key issues>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")` — persist findings for compliance tracking and trend analysis
