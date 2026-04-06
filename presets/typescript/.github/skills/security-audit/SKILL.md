---
name: security-audit
description: "Comprehensive TypeScript/Node.js security audit — OWASP vulnerability scan, npm audit, secrets detection, and combined severity report."
argument-hint: "[optional: 'full' (default), 'owasp', 'dependencies', 'secrets']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - forge_sweep
---

# Security Audit Skill (TypeScript / Node.js)

## Trigger
"Run a security audit" / "Check for vulnerabilities" / "Scan for secrets" / "OWASP check"

## Overview

4-phase security audit tailored for TypeScript/Node.js projects. See `presets/shared/.github/skills/security-audit/SKILL.md` for the full report format and secrets detection patterns.

---

## Phase 1: OWASP Vulnerability Scan (Node.js Specific)

### A1: Broken Access Control
- Check Express/Fastify routes for missing auth middleware (`requireAuth`, `passport.authenticate`, `express-jwt`)
- Search for direct database lookups using `req.params.id` without ownership validation

### A3: Injection
- Search for template literals in SQL: `` `SELECT ... ${` `` — must use parameterized queries (`$1`, `?`)
- Check for `eval()`, `Function()`, `vm.runInContext()`, `vm.runInNewContext()`
- Check for `child_process.exec()` with user input (use `execFile` or `spawn` instead)
- Check for prototype pollution: `Object.assign({}, userInput)` or spread of unvalidated input

### A5: Security Misconfiguration
- Check for CORS wildcard: `cors({ origin: '*' })` or missing CORS config
- Check for `helmet` or equivalent security headers middleware
- Check for `DEBUG`, `NODE_ENV=development` in production config
- Check for verbose error handlers that expose stack traces

### A7: Authentication Failures
- Check password hashing uses `bcrypt` or `argon2` (not `crypto.createHash('md5')`)
- Check JWT uses `RS256` or `ES256` (not `HS256` with weak secrets)
- Check for rate limiting on `/login`, `/auth`, `/token` endpoints

### A8: Software and Data Integrity
- Check `package-lock.json` is committed (integrity hashes)
- Check for `eval()` or dynamic `require()` / `import()` with user input
- Check for missing SRI on CDN `<script>` tags

> Rate each finding: **CRITICAL** (exploitable), **HIGH** (exploitable with effort), **MEDIUM** (defense-in-depth gap), **LOW** (hardening).

---

## Phase 2: Dependency Audit (npm)

```bash
npm audit --audit-level high
```

If using pnpm:
```bash
pnpm audit --audit-level high
```

If using yarn:
```bash
yarn audit --level high
```

Then check for outdated packages:
```bash
npm outdated
```

Check for license issues:
```bash
npx license-checker --summary --failOn "GPL-3.0;AGPL-3.0"
```

> **If npm audit is not available**: Report and continue. Do NOT fail the entire audit.

---

## Phase 3: Secrets Detection

Use the patterns from the shared skill (`presets/shared/.github/skills/security-audit/SKILL.md` Phase 3).

**Additional Node.js patterns**:
- `.env` files with real values (check if `.env` is in `.gitignore`)
- `process.env.` assignments with hardcoded fallback secrets
- Firebase config objects with `apiKey` values
- Supabase/Prisma connection strings in source code

Exclude: `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `coverage/`

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
- **After audit**: `capture_thought("Security audit (Node.js): <summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-security-audit", type: "bug")`
