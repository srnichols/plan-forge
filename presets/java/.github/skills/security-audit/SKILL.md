---
name: security-audit
description: "Comprehensive Java security audit — OWASP vulnerability scan, Maven dependency-check, secrets detection, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (Java / Spring Boot)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

4-phase security audit tailored for Java/Spring Boot projects. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and secrets detection patterns.

---

## Phase 1: OWASP Vulnerability Scan (Java Specific)

### A1: Broken Access Control
- Check controllers for missing `@PreAuthorize` or `@Secured` annotations on sensitive endpoints
- Check for `SecurityContextHolder.getContext().getAuthentication()` usage without null checks
- Check for IDOR — direct use of path variables in repository calls without ownership validation

### A3: Injection
- Search for string concatenation in JPQL/SQL: `"SELECT ... " + variable`, `String.format("SELECT ... %s", variable)`
- Must use JPA `@Query` with `:paramName` or Spring Data derived queries
- Check for `@Valid` on all `@RequestBody` parameters (Bean Validation)
- Check for `Runtime.getRuntime().exec()` or `ProcessBuilder` with user input
- Check for JNDI injection: `InitialContext.lookup()` with user input
- Check for `ObjectInputStream.readObject()` on untrusted data (deserialization)

### A4: Insecure Design
- Check for rate limiting on auth endpoints (Spring Boot rate limiter, Bucket4j)
- Check for input length validation on all string inputs
- Check for CSRF protection enabled (Spring Security default, but verify not disabled)

### A5: Security Misconfiguration
- Check CORS for wildcard: `allowedOrigins("*")` — must specify origins
- Check for Spring Actuator endpoints exposed without authentication
- Check for `spring.profiles.active=dev` in production deployments
- Check for `server.error.include-stacktrace=always` in production

### A7: Authentication Failures
- Check password encoding uses `BCryptPasswordEncoder` or `Argon2PasswordEncoder` (not `NoOpPasswordEncoder`)
- Check JWT configuration for expiry, issuer validation, audience validation
- Check for Spring Security filter chain configured on auth endpoints

### A8: Software and Data Integrity
- Check for `BOM` or `dependencyManagement` for consistent versions
- Check for `ObjectInputStream` deserialization (use allow-lists)
- Check for CSRF protection: `csrf().disable()` only on API endpoints with token auth (not session-based)

---

## Phase 2: Dependency Audit (Maven / Gradle)

For Maven:
```bash
mvn dependency-check:check
```

If OWASP dependency-check plugin not configured, use:
```bash
mvn versions:display-dependency-updates
```

For Gradle:
```bash
./gradlew dependencyCheckAnalyze
```

> **If scanner plugin is not available**: Report and continue. Recommend adding `dependency-check-maven` or `dependency-check-gradle` plugin.

---

## Phase 3: Secrets Detection

Use the patterns from the shared skill (`presets/shared/.github/skills/security-audit/SKILL.md` Phase 3).

**Additional Java patterns**:
- Database passwords in `application.properties` or `application.yml`: `spring.datasource.password=`
- Hardcoded secrets in `@Value("${}")` annotations with default values containing credentials
- Keystore passwords in configuration files
- AWS SDK credential chains with hardcoded keys

Exclude: `target/`, `.git/`, `.gradle/`, `build/`, `.idea/`

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
- **After audit**: `capture_thought("Security audit (Java): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
