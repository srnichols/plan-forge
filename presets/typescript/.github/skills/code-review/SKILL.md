---
name: code-review
description: Run a comprehensive code review across architecture, security, testing, naming, and patterns. Invokes relevant reviewer agents in sequence. Use before merging features or at the end of a phase.
argument-hint: "[optional: specific files or areas to focus on]"
---

# Code Review Skill

## Trigger
"Review my code" / "Run code review" / "Check before merge"

## Steps

### 1. Identify Changed Files
```bash
# What changed since the branch point?
git diff --name-only main...HEAD

# Or since last commit
git diff --name-only HEAD~1
```

### 2. Architecture Review
Run the architecture reviewer checklist:
- Layer separation (Controller → Service → Repository)
- No business logic in controllers
- No data access in services
- Dependencies flow inward only
- Proper use of dependency injection

### 3. Security Review
Run the security reviewer checklist:
- SQL injection (parameterized queries only)
- Authorization on all sensitive endpoints
- No secrets in code
- Input validation at boundaries
- CORS properly configured

### 4. Testing Review
- New features have corresponding tests
- Test names describe behavior, not implementation
- No commented-out tests
- Mocks are for external dependencies, not internal classes
- Edge cases and error paths covered

### 5. Code Quality
- Naming follows project conventions
- No `any`/`dynamic`/`object` when type is known
- Error handling comprehensive (no empty catch blocks)
- No TODO/FIXME without linked issue
- No dead code or unused imports

### 6. Patterns & Consistency
- Follows existing patterns from `.github/instructions/`
- Matches coding style of adjacent code
- No reinvented patterns when existing ones apply
- Configuration via DI/environment, not hardcoded

### 7. Report
```
Code Review Summary:
  🔴 Critical: N (must fix before merge)
  🟡 Warning: N (should fix)
  🔵 Info: N (suggestions)

Files Reviewed: N
Findings by Category:
  Architecture: N
  Security: N
  Testing: N
  Code Quality: N
  Patterns: N
```

## Safety Rules
- Review ONLY — do NOT modify files
- Every finding must cite the specific rule or convention violated
- Acknowledge what's done well, not just problems
- Flag anything that needs human judgment rather than prescribing a fix

## Persistent Memory (if OpenBrain is configured)

- **Before reviewing**: `search_thoughts("code review findings", project: "<project>", created_by: "copilot-vscode", type: "bug")` — load prior review findings and recurring violation patterns to check proactively
- **After review**: `capture_thought("Review: <N findings — key issues summary>", project: "<project>", created_by: "copilot-vscode", source: "skill-code-review")` — persist recurring patterns so future reviews catch them earlier
