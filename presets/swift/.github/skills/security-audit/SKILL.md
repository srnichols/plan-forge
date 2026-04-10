---
name: security-audit
description: "Comprehensive Swift security audit — OWASP vulnerability scan, force-unwrap detection, ATS exception check, secrets detection, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (Swift)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

4-phase security audit tailored for Swift/iOS projects. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and secrets detection patterns.

---

## Phase 1: OWASP Vulnerability Scan (Swift Specific)

### A1: Broken Access Control
- Check Vapor route groups for missing auth middleware on protected routes
- Check for direct use of URL parameters in database lookups without ownership validation
- Check for missing RBAC checks before data mutation (verify `.guard(AuthMiddleware())` on sensitive routes)

### A3: Injection
- Search for string interpolation in raw SQL: `"SELECT ... \(variable)"`, `"WHERE id = '\(id)'"`
- Must use Fluent query builders or parameterized raw SQL with `SQLQueryString`
- Check for `Process()` or `shell()` calls with user input
- Check for unsafe use of `eval`-like constructs in server-side templates

### A4: Insecure Design / Force-Unwraps
- Search for force-unwraps (`!`) outside of test targets:
  ```bash
  grep -rn '![^=]' --include="*.swift" Sources/ App/
  ```
- Search for force-try in production code:
  ```bash
  grep -rn 'try!' --include="*.swift" Sources/ App/
  ```
- Force-unwraps can cause runtime crashes (denial of service). Each instance must be justified.

### A5: Security Misconfiguration
- Check CORS for wildcard origins in `CORSMiddleware` configuration (must specify explicit origins)
- Check for TLS configuration in production — `app.http.server.configuration.tlsConfiguration` must be set
- Check for rate limiting on auth endpoints (`RateLimitMiddleware` or similar)
- Check for verbose error messages exposing stack traces (must use `app.middleware.use(ErrorMiddleware.default(environment: app.environment))`)
- **ATS Exceptions**: Check `Info.plist` for `NSAppTransportSecurity` weakening:
  - `NSAllowsArbitraryLoads: true` — HIGH severity, must be justified
  - `NSExceptionAllowsInsecureHTTPLoads: true` per domain — MEDIUM, document why
  - `NSTemporaryExceptionAllowsInsecureHTTPLoads` — must have expiry plan

### A7: Authentication Failures
- Check password hashing uses `swift-crypto` BCrypt or Vapor's `Bcrypt` (not custom hashing)
- Check JWT uses `JWTKit` (Vapor) with proper algorithm validation (RS256/ES256 preferred over HS256)
- Check for timing-safe token comparison (`CryptoKit.secureCompare` or constant-time comparison)
- Check for rate limiting on login endpoints
- Check that `Authorization` header is stripped in logs

### A8: Software and Data Integrity
- Check `Package.resolved` is committed (integrity verification for SPM dependencies)
- Check for unsafe pointer operations (`UnsafeRawPointer`, `UnsafeMutablePointer`) with user-controlled sizes
- Check for `Codable` deserialization of untrusted data without size limits or validation

### Swift/iOS-Specific: Thread Safety
- Check for shared mutable state in classes without `actor` isolation or proper synchronization
- Check for `@Published` properties modified off the main thread (must use `@MainActor`)
- Recommend `swift test --sanitize=thread` for race detection

---

## Phase 2: Dependency Audit (swift package audit)

```bash
swift package audit
```

> **If `swift package audit` is not available** (requires Swift 5.9+ / Xcode 15+): Report and continue. Do NOT fail the entire audit.

Check for outdated packages:
```bash
swift package show-dependencies
```

Verify package integrity:
```bash
swift package resolve
```

> **If this step fails**: Package cache may be corrupted. Run `swift package clean` and `swift package resolve` to recover.

---

## Phase 3: Secrets Detection

Use the patterns from the shared skill (`presets/shared/.github/skills/security-audit/SKILL.md` Phase 3).

**Additional Swift patterns**:
- Hardcoded API keys in `let` constants: `let apiKey = "sk-..."`, `let secret = "..."`
- Hardcoded database connection strings: `"postgresql://user:password@host/db"`
- Keychain items with hardcoded passwords
- `.xcconfig` files with real secrets not in `.gitignore`
- `Info.plist` with embedded API keys or secrets

Exclude: `.build/`, `.git/`, `Tests/` (unless `Tests/` contains real secrets), `*.resolved`

---

## Phase 4: Combined Report

Follow the shared skill report format. See `presets/shared/.github/skills/security-audit/SKILL.md` Phase 4.

---

## Safety Rules
- READ-ONLY — do NOT modify any files
- Do NOT log actual secret values — show only first 8 characters + `***`
- Do NOT recommend disabling ATS or security features as a fix

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
- **After audit**: `capture_thought("Security audit (Swift): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`