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
