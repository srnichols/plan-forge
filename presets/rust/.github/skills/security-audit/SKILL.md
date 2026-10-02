---
name: security-audit
description: "Comprehensive Rust security audit — OWASP review, cargo audit/deny, secrets detection, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (Rust / Axum / Tokio / SQLx)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

4-phase security audit tailored for Rust services. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and shared secret patterns.

---

## Steps

### 1. OWASP Access-Control Review
- Check routes for `AuthUser` extractor usage on protected APIs.
- Check services for role or permission checks before state changes.
- Check repositories for `tenant_id` parameters and SQL filters on tenant-owned tables.
- Check GraphQL mutations for guards and service-level enforcement.
- Flag IDOR when a path, body, or GraphQL argument can select another tenant's record.

### 2. Injection and Validation Review
- Search SQL for `format!`, string concatenation, and `QueryBuilder::push` with user values.
- Confirm dynamic SQL uses `QueryBuilder::push_bind`.
- Check request DTOs for `validator::Validate` and `ValidatedJson`.
- Search shell-outs for command strings; `tokio::process::Command` must pass arguments separately.
- Check deserialization paths for typed DTOs instead of raw `serde_json::Value`.

### 3. Security Misconfiguration Review
- Confirm application crates use `#![forbid(unsafe_code)]`.
- Check CORS for explicit origins; reject `CorsLayer::permissive()` in production paths.
- Check `RequestBodyLimitLayer` and `TimeoutLayer` are applied to API routers.
- Check GraphQL schemas set depth/complexity limits and disable introspection in production.
- Confirm errors map internal/database failures to generic production responses.

### 4. Authentication and Crypto Review
- Confirm JWT validation covers issuer, audience, expiration, not-before, algorithm, and JWKS `kid`.
- Check JWKS caching and refresh behavior for unknown keys.
- Confirm passwords use `argon2` and secrets use `secrecy::SecretString`.
- Check auth endpoints for a Tower-compatible rate limiter such as `tower_governor` 0.8.0.
- Verify tests cover missing token, expired token, wrong role, and wrong tenant.

### 5. Dependency Audit
```bash
cargo audit
```
```bash
cargo deny check
```
```bash
cargo build --locked
```
> If `cargo-audit` or `cargo-deny` is missing, report the missing tool and continue with the remaining phases. Do not treat missing scanners as a clean result.

### 6. Secrets Detection
Use the shared skill's patterns plus Rust-specific checks:
- `SecretString::from("literal")` outside tests
- `DATABASE_URL`, `JWT_SECRET`, `API_KEY`, or `TOKEN` assigned string literals
- `tracing::*!(..., secret = ...)` or debug logs of config structs
- `.env` files committed without sample-only values
- private keys embedded in fixtures

Exclude: `target/`, `.git/`, `.cargo/registry/`, generated coverage output, and Docker build caches.

### 7. Combined Report
```text
Rust Security Audit Summary:
  Critical:      N findings
  High:          N findings
  Medium/Low:    N findings
  Dependency:    N advisories
  Secret hits:   N redacted candidates
  Sweep markers: N TODO/FIXME/HACK markers

Overall: PASS / FAIL
```

## Safety Rules
- READ-ONLY — do NOT modify source, lockfiles, manifests, or migrations.
- Do NOT print full secret values; show only the first 8 characters plus `***`.
- Do NOT recommend disabling auth, CORS, TLS, validation, audit gates, or tenant filters as remediation.
- Treat missing dependency scanners as incomplete evidence, not a pass.
- Mark exploitability separately from confidence.

## Temper Guards

| Shortcut | Why It Breaks |
| --- | --- |
| "Rust prevents security bugs" | Rust prevents many memory errors, not IDOR, bad CORS, weak JWT validation, or SQL misuse. |
| "The SQLx macro compiled, so access is safe" | SQLx proves query shape, not authorization or tenant scoping. |
| "Cargo audit is enough" | Dependency scans miss broken access control and secret exposure. |
| "Unsafe is in a dependency, so ignore it" | Direct unsafe in application code changes the review scope and needs explicit justification. |
| "Dev secrets are harmless" | Git history and logs preserve them after environments become real. |

## Warning Signs

- Audit completed without OWASP, dependencies, secrets, and report phases.
- Critical/high findings are listed but the verdict says PASS.
- CORS, auth, or tenant issues are downgraded because the API is "internal".
- Scanner failures are omitted from the final output.
- Findings lack file, line, severity, and CWE/RustSec classification.

## Exit Proof

After completing this skill, confirm:
- [ ] All 4 phases executed: OWASP review, dependency audit, secrets scan, combined report.
- [ ] Every finding has severity, confidence, location, and CWE or RustSec ID.
- [ ] No actual secret value appears in the report.
- [ ] The report totals Critical, High, Medium, Low, dependency, and secret counts.
- [ ] Overall verdict is PASS only when there are zero critical findings and zero high-confidence secrets.
- [ ] Missing tools or skipped scopes are called out explicitly.

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("security audit rust", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After audit**: `capture_thought("Security audit (Rust): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
