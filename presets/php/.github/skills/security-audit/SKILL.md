---
name: security-audit
description: "Comprehensive PHP/Laravel security audit — OWASP scan, composer audit, secrets detection, severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (PHP / Laravel)

## Phase 1: OWASP (PHP/Laravel Specific)
- Check controllers for missing `auth` middleware or `$this->authorize()`
- Search for raw SQL: `DB::raw()`, `DB::select("SELECT ... $var")` — use Eloquent or parameterized
- Check for `eval()`, `exec()`, `system()`, `shell_exec()`, `passthru()` with user input
- Check for `unserialize()` on untrusted data
- Check CORS in `config/cors.php` for wildcard origins
- Check `APP_DEBUG=true` in production `.env`
- Check password hashing uses `Hash::make()` (bcrypt/argon2, not md5/sha1)
- Check for mass assignment protection (`$fillable` / `$guarded` on models)
- Check CSRF middleware enabled on non-API routes

## Phase 2: Dependency Audit
```bash
composer audit
composer outdated
```

## Phase 3: Secrets Detection
See shared skill. Exclude: `vendor/`, `.git/`, `storage/`, `bootstrap/cache/`
Additional: Check `.env` has real credentials and is in `.gitignore`

## Phase 4: Report
Follow shared skill format.

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
