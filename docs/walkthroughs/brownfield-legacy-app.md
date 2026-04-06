# Walkthrough: Add Plan Forge to a Legacy Express App

> **Time**: ~30 minutes  
> **Stack**: TypeScript / Node.js / Express (brownfield)  
> **What you'll fix**: SQL injection, hardcoded secrets, missing tests in an existing app  
> **What you'll learn**: How Plan Forge improves existing codebases incrementally

---

## Prerequisites

- An existing Node.js/Express project (or follow along with the example below)
- VS Code with GitHub Copilot
- Plan Forge setup scripts available

---

## The Legacy App

Imagine you've inherited `legacy-orders`, a 2-year-old Express app for managing customer orders. It works, but:

```
legacy-orders/
├── package.json
├── .env                    ← committed to git with real API keys
├── server.js               ← 800 lines, no TypeScript
├── routes/
│   ├── orders.js           ← raw SQL with string interpolation
│   └── customers.js        ← no auth checks
├── db.js                   ← hardcoded connection string
└── (no tests directory)
```

Here's a sample of the problems:

```javascript
// routes/orders.js — SQL injection vulnerability
app.get('/orders', (req, res) => {
  const status = req.query.status;
  // ⚠️ VULNERABLE: String interpolation in SQL
  db.query(`SELECT * FROM orders WHERE status = '${status}'`)
    .then(rows => res.json(rows));
});
```

```javascript
// db.js — hardcoded credentials
// ⚠️ VULNERABLE: Credentials in source code
const pool = new Pool({
  host: 'prod-db.internal.company.com',
  user: 'admin',
  password: 'Sup3rS3cret!',
  database: 'orders_prod',
});
```

```bash
# .env — committed to git with real keys
# ⚠️ VULNERABLE: Secrets in version control
STRIPE_SECRET_KEY=sk_test_EXAMPLE_DO_NOT_USE_deadbeef1234
DATABASE_URL=postgres://admin:Sup3rS3cret!@prod-db.internal.company.com/orders_prod
```

No tests. No types. No auth middleware. This is a typical "it works, don't touch it" codebase.

---

## 1. Install Plan Forge

```powershell
cd legacy-orders

# Auto-detect finds package.json → typescript preset
.\setup.ps1 -AutoDetect -ProjectName "Legacy Orders" -Agent all
```

Output:
```
  AUTO-DETECT  Found TypeScript/Node project markers
Step 1: Core template files
  CREATE .github/copilot-instructions.md
  ...
Step 3: typescript preset files
  CREATE .github/instructions/security.instructions.md
  CREATE .github/skills/security-audit/SKILL.md
  ...
Step 6b: Agent adapters (claude, cursor, codex, gemini)
  ...

Setup complete! Run 'pforge smith' to inspect the forge.
```

---

## 2. Diagnose with Smith

```bash
pforge smith
```

```
╔═══════════════════════════════════════════════════╗
║           ⚒️  PLAN FORGE — SMITH REPORT           ║
╚═══════════════════════════════════════════════════╝

Environment:
  ✅ git 2.44.0
  ✅ Node.js 22.4.0

Setup Health:
  ✅ 17 instruction files installed
  ✅ 13 agents installed
  ⚠️  No tsconfig.json found (JavaScript project — TypeScript guardrails may not fully apply)

Version & Changelog:
  ⚠️  CHANGELOG.md not found
  ⚠️  No docs/plans/ directory found

  Summary: 18 passed, 0 failed, 3 warnings
```

Smith shows the project is functional but missing structure. That's expected for brownfield.

---

## 3. Security Audit — Find the Real Problems

This is where Plan Forge earns its keep. Open Copilot Chat and type:

> "Run /security-audit on this project"

Or attach the security-audit skill manually. The audit runs 3 phases:

### Phase 1: OWASP Scan Results

```
Phase 1 — OWASP Vulnerability Scan
═══════════════════════════════════
  🔴 CRITICAL:  2 findings
  🟠 HIGH:      1 finding
  🟡 MEDIUM:    2 findings

  🔴 CRITICAL | CWE-89  | routes/orders.js:4   | SQL Injection (DEFINITE)
     String interpolation in SQL query: `WHERE status = '${status}'`
     Fix: Use parameterized query with $1 placeholder

  🔴 CRITICAL | CWE-89  | routes/orders.js:18  | SQL Injection (DEFINITE)
     String interpolation: `WHERE customer_id = '${req.params.id}'`
     Fix: Use parameterized query

  🟠 HIGH     | CWE-862 | routes/customers.js:1 | Missing Auth (LIKELY)
     No authentication middleware on customer routes
     Fix: Add requireAuth middleware

  🟡 MEDIUM   | CWE-942 | server.js:12          | CORS Wildcard (DEFINITE)
     cors({ origin: '*' }) allows any origin
     Fix: Specify allowed origins

  🟡 MEDIUM   | CWE-209 | server.js:45          | Verbose Errors (LIKELY)
     Stack traces exposed in error handler
     Fix: Use structured error responses in production
```

### Phase 2: Dependency Audit

```
Phase 2 — Dependency Audit
══════════════════════════
  🔴 CRITICAL:  1 package (express 4.17.1 — CVE-2024-XXXXX)
  🟠 HIGH:      0 packages
  🟡 MEDIUM:    3 packages (outdated by 2+ major versions)
```

### Phase 3: Secrets Detection

```
Phase 3 — Secrets Detection
════════════════════════════
  🔴 CRITICAL:  3 secrets in git-tracked files
     db.js:4          | Connection String  | postgres://a*****
     .env:2           | Stripe Key         | sk_test_*****
     .env:3           | Connection String  | postgres://a*****

  ℹ️  INFO: .env is NOT in .gitignore — this is a critical misconfiguration
```

### Combined Summary

```
══════════════════════════════════════════════════════════════
SUMMARY
══════════════════════════════════════════════════════════════
  Total Findings:   11
  Critical:          6 (2 SQL injection + 1 CVE + 3 secrets)
  High:              1 (missing auth)
  Medium:            4

  Overall: 🔴 FAIL

  Top Priority:
  1. Fix SQL injection in routes/orders.js (exploitable NOW)
  2. Rotate all exposed secrets (Stripe key, database password)
  3. Add .env to .gitignore and remove from git history
  4. Update express to latest
╚══════════════════════════════════════════════════════════════╝
```

---

## 4. Plan the Fix

Now create a hardening plan. Open Copilot Chat, attach `step0-specify-feature.prompt.md`:

> **Feature**: "Legacy Security Hardening"  
> **Problem**: "The app has SQL injection vulnerabilities, hardcoded secrets, and no authentication on sensitive routes."  
> **Acceptance Criteria**: "Zero SQL injection. All secrets in .env (gitignored). Auth middleware on all routes. Basic test coverage."

Then harden it (Step 2). The agent creates 3 slices:

| Slice | What | Risk |
|-------|------|------|
| 1 | Fix SQL injection → parameterized queries | Critical |
| 2 | Move secrets to .env, add .gitignore, rotate credentials | Critical |
| 3 | Add auth middleware + basic test suite | High |

---

## 5. Execute the Fix

```bash
pforge run-plan docs/plans/Phase-1-SECURITY-HARDENING-PLAN.md
```

### Slice 1: Fix SQL Injection

**Before** (vulnerable):
```javascript
db.query(`SELECT * FROM orders WHERE status = '${status}'`)
```

**After** (parameterized):
```javascript
db.query('SELECT * FROM orders WHERE status = $1', [status])
```

The `security.instructions.md` guardrail auto-loaded and enforced parameterized queries. The AI couldn't use string interpolation even if it wanted to — the instruction file explicitly bans it.

Gate: `node -c routes/orders.js` → ✅

### Slice 2: Secrets Management

```bash
# Add .env to .gitignore
echo ".env" >> .gitignore

# Remove .env from git tracking (keeps local file)
git rm --cached .env
```

**Before** (db.js):
```javascript
const pool = new Pool({
  host: 'prod-db.internal.company.com',
  password: 'Sup3rS3cret!',
});
```

**After** (db.js):
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

Gate: `grep -r "password\|Sup3r\|sk_test" --include="*.js" routes/ db.js` returns 0 matches → ✅

### Slice 3: Auth Middleware + Tests

The AI adds `express-jwt` middleware and creates a basic test suite:

```javascript
// middleware/auth.js
const { expressjwt: jwt } = require('express-jwt');

module.exports = jwt({
  secret: process.env.JWT_SECRET,
  algorithms: ['HS256'],
});
```

```javascript
// tests/orders.test.js
const request = require('supertest');
const app = require('../server');

describe('GET /orders', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/orders');
    expect(res.status).toBe(401);
  });

  it('returns orders for authenticated user', async () => {
    const res = await request(app)
      .get('/orders')
      .set('Authorization', `Bearer ${validToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

Gate: `npx jest --passWithNoTests` → ✅

---

## 6. Measure the Improvement

Re-run the security audit:

```
Phase 1 — OWASP Vulnerability Scan
  🔴 CRITICAL:  0 findings  (was 2)
  🟠 HIGH:      0 findings  (was 1)
  🟡 MEDIUM:    1 finding   (was 2) — CORS still wildcard

Phase 3 — Secrets Detection
  🔴 CRITICAL:  0 secrets   (was 3)
  ℹ️  INFO:     .env in .gitignore ✅

Overall: 🟢 PASS (1 medium warning)
```

Run the consistency analysis:

```bash
pforge analyze docs/plans/Phase-1-SECURITY-HARDENING-PLAN.md
```

```
Consistency Score: 88/100
  - Traceability:   25/25
  - Coverage:       23/25 (CORS fix deferred)
  - Test Coverage:  20/25 (basic tests, not comprehensive)
  - Gates:          20/25 (manual gate on Slice 2)
```

From **zero** (no plan, no tests, 6 criticals) to **88/100** in one session.

---

## What You Learned

| Concept | How You Experienced It |
|---------|----------------------|
| **Plan Forge works on existing code** | Auto-detect found the project, smith diagnosed it |
| **Security audit finds real bugs** | SQL injection and leaked secrets found automatically |
| **Guardrails enforce fixes** | The AI couldn't re-introduce SQL injection — security.instructions.md prevents it |
| **Incremental improvement works** | Three focused slices, each validated, each measurable |
| **Consistency scoring tracks progress** | From 0 to 88 — concrete evidence of improvement |

---

## Next Steps

- **Fix the remaining CORS warning** — create Phase 2 with a single slice
- **Add TypeScript** — migrate `.js` → `.ts` with a Plan Forge plan (the guardrails will enforce strict types)
- **Set up CI** — add `plan-forge-validate` to block PRs without a plan
- **Try the greenfield walkthrough** — see how Plan Forge works from scratch
