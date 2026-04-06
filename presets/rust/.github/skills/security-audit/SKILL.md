---
name: security-audit
description: "Comprehensive Rust security audit — OWASP scan, cargo-audit, secrets detection, severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (Rust)

## Phase 1: OWASP (Rust Specific)
- Check `unsafe` blocks for SAFETY comments and user-controlled data
- Search for `format!` in SQL strings — use `sqlx::query!` or diesel macros
- Check `std::process::Command` for user input injection
- Check for `.unwrap()` / `.expect()` in production code
- Check CORS wildcard in tower-http/actix-cors
- Check password hashing uses `argon2`/`bcrypt` crate
- Check JWT uses `jsonwebtoken` with algorithm validation

## Phase 2: Dependency Audit
```bash
cargo audit
cargo outdated
```

## Phase 3: Secrets Detection
See shared skill. Exclude: `target/`, `.git/`

## Phase 4: Report
Follow shared skill format.
