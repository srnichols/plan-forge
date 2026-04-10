---
name: security-audit
description: "Comprehensive .NET security audit — OWASP vulnerability scan, NuGet vulnerability check, secrets detection, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (.NET / C#)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

4-phase security audit tailored for .NET projects. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and secrets detection patterns.

---

## Phase 1: OWASP Vulnerability Scan (.NET Specific)

### A1: Broken Access Control
- Check controllers for missing `[Authorize]` attribute on sensitive endpoints
- Check for `[AllowAnonymous]` on endpoints that should require auth
- Check for IDOR — direct use of route IDs without ownership validation (`User.FindFirst(ClaimTypes.NameIdentifier)`)

### A3: Injection
- Search for string interpolation in SQL: `$"SELECT ... {variable}"`, `string.Format("SELECT", variable)`, `"SELECT " + variable`
- Check for raw SQL via `FromSqlRaw()` / `ExecuteSqlRaw()` without parameters (use `FromSqlInterpolated()` or parameterized)
- Check for `Process.Start()` with user input
- Check for `XmlDocument` or `XslCompiledTransform` without disabling DTD processing (XXE)

### A4: Insecure Design
- Check for rate limiting on auth endpoints (use `Microsoft.AspNetCore.RateLimiting`)
- Check for account lockout after failed login attempts
- Check for input validation at controller level (`[Required]`, `[StringLength]`, FluentValidation)

### A5: Security Misconfiguration
- Check CORS for wildcard: `AllowAnyOrigin()` — should use `WithOrigins()`
- Check for `app.UseDeveloperExceptionPage()` without environment guard
- Check for missing HTTPS redirection: `app.UseHttpsRedirection()`
- Check for exposed Swagger in production

### A7: Authentication Failures
- Check password hashing uses ASP.NET Identity (bcrypt/PBKDF2) not custom hashing
- Check JWT configuration: `ValidateIssuerSigningKey`, `ValidateLifetime`, `ValidateAudience`
- Check for `[Authorize]` before `[HttpDelete]` and `[HttpPut]` actions

### A8: Software and Data Integrity
- Check for `BinaryFormatter` or `SoapFormatter` deserialization (banned in .NET 8+)
- Check for `System.Reflection` with user input
- Check CSRF protection: `[ValidateAntiForgeryToken]` on POST/PUT/DELETE (MVC)

---

## Phase 2: Dependency Audit (NuGet)

```bash
dotnet list package --vulnerable --include-transitive
```

Check for outdated packages:
```bash
dotnet list package --outdated
```

> **If dotnet CLI is not available**: Report and continue. Do NOT fail the entire audit.

---

## Phase 3: Secrets Detection

Use the patterns from the shared skill (`presets/shared/.github/skills/security-audit/SKILL.md` Phase 3).

**Additional .NET patterns**:
- Connection strings in `appsettings.json` or `appsettings.Development.json` with passwords
- `UserSecrets` ID present but secrets hardcoded in config anyway
- Kestrel HTTPS certificate passwords in configuration
- Azure Key Vault connection strings or managed identity misconfigurations

Exclude: `bin/`, `obj/`, `.git/`, `packages/`, `TestResults/`

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
- **After audit**: `capture_thought("Security audit (.NET): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
