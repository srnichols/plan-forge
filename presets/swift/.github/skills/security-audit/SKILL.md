---
name: security-audit
description: "Comprehensive Swift security audit — OWASP vulnerability scan, swift package audit, force-unwrap detection, ATS exception check, and secrets detection."
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

4-phase security audit tailored for Swift projects. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and secrets detection patterns.

---

## Phase 1: OWASP Vulnerability Scan (Swift Specific)

### A1: Broken Access Control
- Check Vapor route groups for missing authentication middleware on protected routes
- Check for direct use of path parameters in database queries without ownership validation
- Check for missing role/permission checks before data mutation

### A3: Injection
- Search for string interpolation in raw SQL: `` `"SELECT ... \(variable)"` ``, `String(format: "SELECT ... %@", variable)`
- Fluent ORM queries are safe by default — check any `.raw()` query calls
- Check for `Process` / `Shell` calls with user input
- Check for `NSPredicate(format:)` with unsanitized user input (predicate injection)

### A5: Security Misconfiguration
- Check `Info.plist` for `NSAllowsArbitraryLoads = true` (ATS disabled) — must be justified
- Check `NSExceptionDomains` entries — each must have a documented reason
- Check for `URLSessionConfiguration` with `allowsCellularAccess` or custom TLS disabled
- Check for verbose error messages exposed to API clients

### A6: Vulnerable and Outdated Components
- Run `swift package audit` to check for known vulnerabilities
- Check `Package.resolved` is committed (dependency lock)

### A7: Authentication Failures
- Check passwords/tokens are stored in **Keychain**, not `UserDefaults` or files
- Check JWT uses proper audience/issuer validation (e.g., `vapor-jwt` or `JWTKit`)
- Check for timing-safe token comparison (avoid `==` for secrets; use constant-time compare)
- Check biometric authentication fallback paths

### A8: Software and Data Integrity
- Check `Package.resolved` is committed (integrity verification)
- Check for `UnsafeRawPointer` / `UnsafeMutablePointer` usage without justification
- Check for `NSCoding` / `Codable` deserialization of untrusted data without validation

### Swift-Specific: Force-Unwrap Audit
- Search for force-unwraps (`!`) in production code (not tests):
  ```bash
  grep -rn '![^=]' --include="*.swift" Sources/
  ```
  Each `!` must be justified — prefer `guard let`, `if let`, or `throw`
- Search for `try!` in production code:
  ```bash
  grep -rn 'try!' --include="*.swift" Sources/
  ```
- Search for `fatalError(` outside test/debug contexts:
  ```bash
  grep -rn 'fatalError(' --include="*.swift" Sources/
  ```

---

## Phase 2: Dependency Audit (swift package audit)

```bash
swift package audit
```

Check for outdated packages:
```bash
swift package show-dependencies
```

Verify package integrity:
```bash
swift package resolve
```

> **If swift package audit is not available** (older toolchain): Review `Package.resolved` manually against known CVE databases. Report and continue — do NOT fail the entire audit.

---

## Phase 3: Secrets Detection

Use the patterns from the shared skill (`presets/shared/.github/skills/security-audit/SKILL.md` Phase 3).

**Additional Swift patterns**:
- Hardcoded API keys in `let` constants: `let apiKey = "sk-..."`
- Connection strings with credentials: `"postgres://user:password@host/db"`
- Firebase/AWS config files with real keys committed (check `GoogleService-Info.plist`, `amplifyconfiguration.json`)
- Check `Info.plist` for hardcoded credentials

Exclude: `.build/`, `.git/`, `Tests/` (unless `Tests/` contains real secrets)

---

## Phase 4: ATS (App Transport Security) Check

Review `Info.plist` for:
- `NSAllowsArbitraryLoads` — must be `false` (or absent) in production builds
- `NSAllowsArbitraryLoadsForMedia` / `NSAllowsArbitraryLoadsInWebContent` — document justification
- `NSExceptionDomains` — each domain exception must be documented

---

## Phase 5: Combined Report

Follow the shared skill report format. See `presets/shared/.github/skills/security-audit/SKILL.md` Phase 4.

---

## Safety Rules
- READ-ONLY — do NOT modify any files
- Do NOT log actual secret values — show only first 8 characters + `***`
- Do NOT recommend disabling ATS as a fix

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("security audit", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After audit**: `capture_thought("Security audit (Swift): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
