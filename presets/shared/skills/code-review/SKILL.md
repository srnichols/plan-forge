---
name: code-review
description: Run a comprehensive code review across architecture, security, testing, naming, and patterns. Invokes relevant reviewer agents in sequence. Use before merging features or at the end of a phase. With --quorum, dispatches multi-model analysis for higher confidence.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill

> **Run `/clean-code-review` first.** That skill is the mechanical/quantitative pass — module size, function complexity, parameter counts, duplication (jscpd + literal/regex scanners), engineering hygiene (empty catches, magic numbers, dead imports, TODO/FIXME markers, hardcoded secrets, SQL-injection patterns), shell-parity (PS/Bash twins), and ESLint/linter violations. This skill is the qualitative/judgment pass — architecture, security model, test design, patterns. Running them in order means mechanical findings clear the noise so the qualitative review can focus on what actually needs judgment.

> **Stack-neutral fallback.** This file ships from `presets/shared/` and applies to any project. Stacks that have a preset (typescript, python, dotnet, java, go, rust, php, swift) ship a preset-specific override of this skill — the preset version always wins. If you're seeing this content, your project either chose a custom preset or uses a stack we don't yet have first-class support for.

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
- Layer separation respected (Controller → Service → Repository, or equivalent for your stack)
- No business logic in controllers / routes / handlers
- No data access in service / domain layers
- Dependencies flow inward only (Dependency Rule)
- Proper use of dependency injection or composition root

### 3. Security Review
Run the security reviewer checklist:
- SQL injection (parameterized queries only — never string interpolation into SQL)
- Authorization on all sensitive endpoints / commands
- No secrets in code (use environment variables, secret manager, or gitignored config)
- Input validation at system boundaries (HTTP handlers, CLI args, message consumers)
- CORS / CSRF / clickjacking headers properly configured (web stacks)
- No `eval` / dynamic code execution of untrusted input
- Shell-out uses argument arrays, not constructed strings (command-injection)

### 4. Testing Review
- New features have corresponding tests
- Test names describe behavior, not implementation
- No commented-out tests
- Mocks are for external dependencies (network, DB, file system at edge), NOT for internal classes
- Edge cases AND error paths covered, not just the happy path
- Time-sensitive tests use fake timers or explicit tolerance (no bare `setTimeout` / `Date.now()` racing)

### 5. Code Quality
- Naming follows project conventions
- Types are explicit where the language supports it (no untyped escape hatches when the type is known)
- Error handling comprehensive (no empty catch blocks — `/clean-code-review` should have caught these mechanically)
- No TODO/FIXME/HACK without a tracked issue
- No dead code or unused imports

### 6. Patterns & Consistency
- Follows existing patterns from `.github/instructions/`
- Matches coding style of adjacent code
- No reinvented patterns when existing ones apply
- Configuration via DI/environment, not hardcoded
- Project Principles (`docs/plans/PROJECT-PRINCIPLES.md` if it exists) respected — no forbidden patterns introduced

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
| "Skip `/clean-code-review` since this is a small change" | The mechanical pass takes <60s. Skipping it means complexity, duplication, and hygiene violations slip through and resurface as production bugs or review noise. |

## Warning Signs

- Review skipped one or more sections — not all 6 review areas (architecture, security, testing, quality, patterns, consistency) evaluated
- No findings reported at all — suspiciously clean review with zero suggestions
- Findings lack specific rule citations — vague comments like "looks off" without referencing a convention
- Review completed in under 2 minutes — insufficient time for meaningful review
- `forge_analyze` score not included — consistency analysis was skipped
- `/clean-code-review` was skipped — mechanical findings will surface as qualitative noise

## Exit Proof

After completing this skill, confirm:
- [ ] `/clean-code-review` was run first (mechanical findings reviewed)
- [ ] All 6 review sections completed (architecture, security, testing, code quality, patterns, consistency)
- [ ] Findings table generated with severity levels (critical / warning / info)
- [ ] `forge_analyze` score included (if plan exists)
- [ ] `forge_diff` scope drift check completed (if plan exists)
- [ ] Every finding cites a specific rule or convention

## Persistent Memory (if OpenBrain is configured)

- **Before reviewing**: `search_thoughts("code review findings", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load prior review findings and recurring violation patterns to check proactively
- **After review**: `capture_thought("Review: <N findings — key issues summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-code-review")` — persist recurring patterns so future reviews catch them earlier
