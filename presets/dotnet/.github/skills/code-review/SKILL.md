---
name: code-review
description: Run a comprehensive code review across architecture, security, testing, naming, patterns, software entropy, knowledge-level DRY, changeability, contracts, and resource lifecycles. Invokes relevant reviewer agents in sequence. Use before merging features or at the end of a phase. With --quorum, dispatches multi-model analysis for higher confidence.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill

> **Run `/clean-code-review` first.** That skill is the mechanical/quantitative pass — module size, function complexity, parameter counts, duplication (jscpd + literal/regex scanners), engineering hygiene (empty catches, magic numbers, dead imports, TODO/FIXME markers, hardcoded secrets, SQL-injection patterns), shell-parity (PS/Bash twins), and ESLint/linter violations. This skill is the qualitative/judgment pass — architecture, security model, test design, patterns. Running them in order means mechanical findings clear the noise so the qualitative review can focus on what actually needs judgment.

## Trigger
"Review my code" / "Run code review" / "Check before merge" / "Code review --quorum"

## Steps

### 0. Forge Analysis
Use the `forge_analyze` MCP tool with the current plan (if available) to get a structured consistency score. Pass the plan's `.md` path, not a source file: without `quorum: true`, `forge_analyze` scores plans only and rejects a source-file target. If the reviewed work has no plan, skip the score. Use the `forge_diff` MCP tool to detect scope drift and forbidden file edits.

**If `--quorum` was specified**: Use `forge_analyze` with `quorum: true` to dispatch multi-model analysis. Each changed file is independently reviewed by multiple AI models (e.g., claude-opus-5.5, gpt-6-sol, grok-4.7), and findings are synthesized with consensus confidence levels. This catches issues a single model misses.

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
- Orthogonality / change locality: changing one policy should not require unrelated responsibilities to change. Check hidden shared state and side effects; cite the actual coupling, not a touched-file-count threshold.
- Reversibility (external dependencies, persisted formats, defaults): verify replacement boundaries and migration or rollback provisions where needed. Do not demand speculative abstraction layers.
- Contracts: identify meaningful preconditions, postconditions, and state invariants; verify they are enforced through types, guards, or assertions and tested.
- Resource ownership / temporal coupling: make acquire/release ownership and required call ordering explicit. Check cleanup on failure or cancellation, concurrent access, and retry idempotency where applicable.
- Deep modules / information hiding: identify the coherent complexity a changed boundary hides and how callers become simpler. Preserve single responsibility, legitimate thin adapters, and size gates; more wrappers or lower LOC alone are not improvement.
- Contract Refs: compare affected boundaries with the plan's exact accepted contract/decision revisions and approval evidence. Report stale or missing consequential approval; unchanged boundaries may cite existing approved sources.

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
- For fixes, explain the failure mechanism and verify a regression test fails before the fix and passes after. Check incidental timing, ordering, and environment assumptions; report missing reproduction evidence as a verification gap.
- For invariant-heavy transformations or state machines, consider property-based tests (round trips, pagination without omissions or duplicates, preserved state invariants). Use reproducible inputs and existing test tools; do not mandate a new framework.
- Where lifecycle or ordering matters, cover invalid call order, cancellation, cleanup after failure, concurrent interleavings, and repeated operations as applicable.

### 5. Code Quality
- Naming follows project conventions
- No `any`/`dynamic`/`object` when type is known
- Error handling comprehensive (no empty catch blocks)
- No TODO/FIXME without linked issue
- No dead code or unused imports
- Software entropy / broken windows: identify new or spreading workarounds, unexplained convention exceptions, contradictory behavior, and weakened tests or gates. Fix deterioration introduced or worsened by the change; track unrelated debt without expanding scope.
- Fail early at the appropriate boundary: stop an unsafe operation with an explicit error rather than manufacture success or silently replace unknown state with a default.

### 6. Patterns & Consistency
- Follows existing patterns from `.github/instructions/`
- Matches coding style of adjacent code
- No reinvented patterns when existing ones apply
- Configuration via DI/environment, not hardcoded
- Knowledge-level DRY: identify the same business rule maintained across code, configuration, schemas, or documentation. Consolidate shared knowledge, not coincidentally similar syntax with independent reasons to change; keep test expectations independent of the implementation.
- Domain Language: check bounded-context meanings, invariants, and approved aliases across specification, APIs, code, and tests. Do not infer new business meanings or globally rename unrelated contexts.

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

Include coverage for the maintainability checks: **checked** (evidence), **not applicable** (reason), or **not verified** (gap). Keep unverified areas separate from findings; an incomplete review is not a clean review. Separate introduced or worsened issues from pre-existing in-scope debt.

#### Design Concerns

For observed design friction, report evidence, owner, disposition (`fix now`, `plan later`, or `accept risk`), existing issue/smelt or proposed follow-up, revisit trigger, and closure validation. Current blockers still block approval and cannot become accepted debt. Do not create issues, plans, or unrelated refactors in this read-only review; future work needs owner approval. Fewer warnings alone do not prove closure, and zero concerns is valid with coverage stated.

## Safety Rules
- Review ONLY — do NOT modify files
- Every finding must cite a code location, the specific rule or convention violated, and a concrete behavioral or maintenance risk
- Acknowledge what's done well, not just problems
- Flag anything that needs human judgment rather than prescribing a fix
- Zero findings is valid after completed, evidence-backed checks. Never invent findings or require a minimum number.
- Do not demand unrelated cleanup or judge quality from a lint total alone. Existing blocking gates still apply.


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Tests pass so the code is fine" | Passing tests prove the happy path works. They don't prove the code is maintainable, secure, or architecturally sound. |
| "This change is too small to review" | Small changes accumulate. A "tiny" shortcut in one PR establishes a pattern that scales into a systemic problem. |
| "I wrote it, I can review it" | Self-review has blind spots. The author's mental model fills gaps that a reviewer would catch. |
| "The finding count proves review quality" | Zero findings can be legitimate; many findings can be noise. Require coverage and evidence, not a quota. |
| "Fewer lint warnings prove less entropy" | Counts can fall through suppression or moving code, while new coupling or broken contracts remain. Review the actual changes and per-rule severity. |

## Warning Signs

- Review skipped one or more sections — not all 6 review areas (architecture, security, testing, quality, patterns, consistency) evaluated
- A clean conclusion without coverage evidence, or with unverified checks omitted
- Findings lack specific rule citations — vague comments like "looks off" without referencing a convention
- Review conclusions lack evidence for the claimed coverage
- `forge_analyze` score not included — consistency analysis was skipped

## Exit Proof

After completing this skill, confirm:
- [ ] All 6 review sections completed (architecture, security, testing, code quality, patterns, consistency)
- [ ] Findings table generated with severity levels (critical / warning / info)
- [ ] `forge_analyze` score included (if plan exists)
- [ ] `forge_diff` scope drift check completed (if plan exists)
- [ ] Every finding cites a specific rule or convention
- [ ] Maintainability checks have evidence or an explicit applicability / verification reason
- [ ] Findings distinguish change-related risks from pre-existing debt; no finding quota was used
## Persistent Memory (if OpenBrain is configured)

- **Before reviewing**: `search_thoughts("code review findings", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")` — load prior review findings and recurring violation patterns to check proactively
- **After review**: `capture_thought("Review: <N findings — key issues summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-code-review")` — persist recurring patterns so future reviews catch them earlier
