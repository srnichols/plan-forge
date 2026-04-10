---
name: code-review
description: Run a comprehensive code review across architecture, security, testing, naming, and patterns. Invokes relevant reviewer agents in sequence. Use before merging features or at the end of a phase. With --quorum, dispatches multi-model analysis for higher confidence.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill

## Trigger
"Review my code" / "Run code review" / "Check before merge" / "Code review --quorum"

## Steps

### 0. Forge Analysis
Use the `forge_analyze` MCP tool with the current plan (if available) to get a structured consistency score. Use the `forge_diff` MCP tool to detect scope drift and forbidden file edits.

**If `--quorum` was specified**: Use `forge_analyze` with `quorum: true` to dispatch multi-model analysis. Each changed file is independently reviewed by multiple AI models (e.g., grok-3-mini, claude-sonnet-4.6, gpt-5.3-codex), and findings are synthesized with consensus confidence levels. This catches issues a single model misses.

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
Forge Analysis Score: N/100
Scope Drift: N files outside scope
```

## Safety Rules
- Review ONLY — do NOT modify files
- Every finding must cite the specific rule or convention violated
- Acknowledge what's done well, not just problems
- Flag anything that needs human judgment rather than prescribing a fix


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Tests pass so the code is fine" | Passing tests prove the happy path works. They don't prove the code is maintainable, secure, or architecturally sound. |
| "This change is too small to review" | Small changes accumulate. A "tiny" shortcut in one PR establishes a pattern that scales into a systemic problem. |
| "I wrote it, I can review it" | Self-review has blind spots. The author's mental model fills gaps that a reviewer would catch. |
| "No findings means the review is thorough" | A clean review with zero findings is suspicious — it usually means the review was superficial, not perfect. |

## Warning Signs

- Review skipped one or more sections — not all 6 review areas (architecture, security, testing, quality, patterns, consistency) evaluated
- No findings reported at all — suspiciously clean review with zero suggestions
- Findings lack specific rule citations — vague comments like "looks off" without referencing a convention
- Review completed in under 2 minutes — insufficient time for meaningful review
- `forge_analyze` score not included — consistency analysis was skipped

## Exit Proof

After completing this skill, confirm:
- [ ] All 6 review sections completed (architecture, security, testing, code quality, patterns, consistency)
- [ ] Findings table generated with severity levels (critical / warning / info)
- [ ] `forge_analyze` score included (if plan exists)
- [ ] `forge_diff` scope drift check completed (if plan exists)
- [ ] Every finding cites a specific rule or convention
## Persistent Memory (if OpenBrain is configured)

- **Before reviewing**: `search_thoughts("code review findings", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load prior review findings and recurring violation patterns to check proactively
- **After review**: `capture_thought("Review: <N findings — key issues summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-code-review")` — persist recurring patterns so future reviews catch them earlier
