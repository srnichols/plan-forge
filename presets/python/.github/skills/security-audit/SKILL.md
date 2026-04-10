---
name: security-audit
description: "Comprehensive Python security audit — OWASP vulnerability scan, pip audit, secrets detection, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (Python)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

4-phase security audit tailored for Python projects. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and secrets detection patterns.

---

## Phase 1: OWASP Vulnerability Scan (Python Specific)

### A1: Broken Access Control
- Check FastAPI routes for missing `Depends(get_current_user)` dependency injection
- Check Django views for missing `@login_required` or `@permission_required` decorators
- Check Flask routes for missing `@login_required` from flask-login

### A3: Injection
- Search for f-strings or `.format()` in SQL: `f"SELECT ... {variable}"`, `"SELECT ... %s" % variable`
- Check for `eval()`, `exec()`, `__import__()`, `compile()` with user input
- Check for `os.system()`, `subprocess.call(..., shell=True)` with user input
- Check for `pickle.loads()` or `yaml.load()` (unsafe) on untrusted data — use `yaml.safe_load()`

### A5: Security Misconfiguration
- Check for `DEBUG = True` in production Django settings
- Check for `SECRET_KEY` hardcoded in settings files
- Check CORS configuration for wildcard origins
- Check for verbose tracebacks in production error handlers

### A7: Authentication Failures
- Check password hashing uses `passlib` (bcrypt/argon2) not `hashlib.md5` / `hashlib.sha1`
- Check JWT configuration for expiry and algorithm
- Check for rate limiting on auth endpoints (django-ratelimit, slowapi)

### A8: Software and Data Integrity
- Check for pinned dependencies in `requirements.txt` (exact versions, not ranges)
- Check for `pickle.loads()` on untrusted data (deserialization attack)
- Check for `subprocess` with `shell=True` (command injection)

---

## Phase 2: Dependency Audit (pip)

```bash
pip-audit
```

If pip-audit is not installed:
```bash
pip install pip-audit && pip-audit
```

Alternative with safety:
```bash
safety check
```

Check for outdated packages:
```bash
pip list --outdated
```

> **If scanners not available**: Report and continue. Do NOT fail the entire audit.

---

## Phase 3: Secrets Detection

Use the patterns from the shared skill (`presets/shared/.github/skills/security-audit/SKILL.md` Phase 3).

**Additional Python patterns**:
- Django `SECRET_KEY` hardcoded in `settings.py`
- Database URLs with passwords in `settings.py` or `config.py`
- `.env` files with real values (check if `.env` is in `.gitignore`)
- `ALLOWED_HOSTS = ['*']` in Django settings (misconfiguration, not secret)

Exclude: `__pycache__/`, `.git/`, `venv/`, `.venv/`, `env/`, `.tox/`, `.eggs/`, `*.egg-info/`

---

## Phase 4: Combined Report

Follow the shared skill report format. See `presets/shared/.github/skills/security-audit/SKILL.md` Phase 4.

---

## Safety Rules
- READ-ONLY — do NOT modify any files
- Do NOT log actual secret values — show only first 8 characters + `***`
- Do NOT recommend disabling security features as a fix

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This scan is probably all false positives" | False positives exist, but dismissing findings without investigation misses real vulnerabilities. Verify each finding individually. |
| "We'll fix the medium-severity findings later" | Medium findings compound. An XSS + a missing header + an unvalidated input = a real exploit chain. Fix or explicitly accept the risk with documentation. |
| "Test files don't need security review" | Test files contain connection strings, mock credentials, and API patterns that leak into production via copy-paste. Review them at INFO level. |
| "The dependency scanner isn't installed, skip Phase 2" | Report the missing scanner and continue with other phases. Don't fail the entire audit — partial results are better than none. |
| "This is an internal API, OWASP doesn't apply" | Internal APIs get exposed through misconfiguration. OWASP applies to all HTTP surfaces regardless of intended audience. |

## Warning Signs

- Audit completed without running all 4 phases (OWASP + deps + secrets + report)
- Findings dismissed without individual verification
- Secret values logged in full instead of first 8 chars + `***`
- Severity ratings assigned subjectively instead of using OWASP/CWE classification
- CRITICAL findings present but overall verdict is PASS
- Dependency scanner missing but not reported

## Exit Proof

After completing this skill, confirm:
- [ ] All 4 phases executed (OWASP, dependency audit, secrets scan, combined report)
- [ ] Every finding has severity, location (file:line), and classification (CWE or pattern)
- [ ] No actual secret values appear in the report (first 8 chars + `***` only)
- [ ] Combined report includes total counts by severity (Critical, High, Medium, Low)
- [ ] Overall verdict is PASS (zero critical, zero high secrets) or FAIL with specifics
- [ ] If scanner was missing, it's reported in the output (not silently skipped)

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("security audit", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After audit**: `capture_thought("Security audit (Python): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
