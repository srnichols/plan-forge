---
name: code-review
description: Plan-Forge-tuned comprehensive code review — runs public-surface diff, forge analysis, architecture / security / testing / patterns checks, plus Plan-Forge-specific gates (ACI compliance, dual-shell parity, branch model). Use before merging features or at the end of a phase. With --quorum, dispatches multi-model analysis.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill — Plan Forge

> **Run `/clean-code-review` FIRST.** That skill is the mechanical/quantitative pass (LOC, complexity, params, duplication, ESLint, Boy Scout delta). This skill is the qualitative/judgment pass. Mechanical findings clear the noise so this review can focus on what actually requires judgment.

## Trigger
"Review my code" / "Run code review" / "Check before merge" / "Code review --quorum"

## Steps

### 0. Forge Analysis
Use the `forge_analyze` MCP tool with the current plan (if available) to get a structured consistency score. Use the `forge_diff` MCP tool to detect scope drift and forbidden file edits.

**If `--quorum` was specified**: Use `forge_analyze` with `quorum: true` to dispatch multi-model analysis. Each changed file is independently reviewed by multiple AI models, and findings are synthesized with consensus confidence levels.

### 1. Identify Changed Files
```powershell
# What changed since the merge-base with planning/main?
git diff --name-only origin/planning/main...HEAD

# Or since last commit
git diff --name-only HEAD~1
```

### 2. Public Surface Diff (consumer impact)

```powershell
node scripts/audit/surface-diff.mjs
node scripts/audit/surface-diff.mjs --base origin/master
```

Parse `docs/plans/cleanup-findings/raw/surface-diff-report.json`. Three layers are diffed against the merge-base:

| Layer | Source | What's compared |
|-------|--------|----------------|
| Module exports | every `.mjs` outside `tests/` | added/removed named exports |
| MCP tools | `pforge-mcp/server.mjs` `TOOLS` array | added/removed tool names + `inputSchema` property keys |
| CLI commands | `pforge.ps1`, `pforge.sh` | added/removed top-level dispatch branches |

Each finding is categorised:

- **`additive`** — new export / tool / flag / schema field. Safe; ensure it's documented in CHANGELOG and (for tools) appears in `capabilities.mjs` `TOOL_METADATA`.
- **`breaking`** — removed export / tool / flag, or removed `inputSchema` field. **Must be intentional.** Verify:
  - It's documented in CHANGELOG with a clear migration note
  - The version is bumped per `version.instructions.md`
  - For MCP tool removals: `capabilities.mjs` and all `.github/instructions/*.md` references are updated
  - For CLI command removals: `pforge.ps1`, `pforge.sh`, and the matching test files all drop the command together

**Why this step is first** — Plan Forge has hundreds of consumers (every project that runs `setup.ps1`). Silent breaking changes propagate to all of them on next update. Catch them here before architecture/security review, because consumer impact is the only thing the merge-base ground-truth can give us.

> **Plan-Forge-specific**: changes to `enums.mjs` arrays (`HOOK_NAMES`, `QUORUM_MODES`, `MODEL_TIERS`, etc.) are also breaking even though they're not tool/CLI/export changes — the frozen arrays act as a contract checked by CI guards. Flag any addition/removal there too.

### 3. Architecture Review
Run the architecture reviewer checklist (see `.github/instructions/architecture-principles.instructions.md`):
- Layer separation respected — tool handlers don't reach into the orchestrator; the orchestrator doesn't shape tool responses
- Dependency Rule — source-code deps point inward; no outer-circle imports into inner circles
- ACI discipline — every new `forge_*` tool returns bounded payloads (~10 KB), paginates, describes empty states with a `message` field, documents every response field
- SOLID — no God objects (>10 public methods, >300 LOC), no fat interfaces, no `if/else` chains on type
- Plan-Forge-specific: dual-shell parity (every PowerShell entry point has a matching Bash one), no sync `child_process` in the orchestrator hot path, `path.join(...)` everywhere (no hardcoded `\` or `/`)

### 4. Security Review
Run the security reviewer checklist:
- Input validation at system boundaries (every `forge_*` handler validates its `inputSchema`)
- No secrets in code — use `.forge/secrets.json` (gitignored) or environment variables
- No `spawn(cmd, [stringWithInput])` — command-injection risk; use `spawn(cmd, [arg1, arg2])`
- No `eval` / `Function(...)` / dynamic `require` of user input
- File path inputs validated against directory traversal
- For MCP tools that mutate user repos: must dry-run + ask for confirmation (PROJECT-PRINCIPLES forbidden pattern)

### 5. Testing Review
- New features have corresponding tests (`pforge-mcp/tests/*.test.mjs` or `pforge-master/tests/*.test.mjs`)
- Tests describe behavior, not implementation (`describe("when X then Y")` not `describe("function buildEstimate")`)
- No commented-out tests
- No `Math.random()`, `Date.now()`, `setTimeout` without explicit tolerance in time-sensitive tests (caught us on Phase 41 S5 with the +5ms tolerance flake — bumped to +50ms)
- Edge cases AND error paths covered, not just the happy path
- Mocks are for external dependencies (network, gh CLI, file system at edge), NOT for internal classes

### 6. Code Quality
- Naming follows project conventions (kebab-case files, camelCase functions, `is`/`has`/`can` prefix for booleans, import enums from `pforge-mcp/enums.mjs` — never hand-type)
- No `any` / `unknown` when type is known
- Error handling comprehensive (no empty catch blocks, no swallowed promise rejections)
- No `TODO` / `FIXME` / `HACK` without a tracked issue
- No dead code or unused imports
- `console.log` is intentional CLI output — debug leakage removed

### 7. Patterns & Consistency
- Follows existing patterns from `.github/instructions/`
- Matches coding style of adjacent code
- No reinvented patterns when existing ones apply
- Configuration via `.forge.json` / env, not hardcoded
- For MCP tool authors: pattern-match against `forge_search` (the gold-standard ACI surface)

### 8. Branch Model Check (Plan Forge specific)
- Phase plan files (`Phase-*-PLAN.md`) **never** land on `master` — only `planning/main`
- Dev-only artifacts (`AGENTS.md`, `docs/plans/PROJECT-PRINCIPLES.md`, `docs/plans/archive/`) stay on `planning/main`
- Consumer-visible code that lands on `planning/main` must have a planned shipper slice or cherry-pick to `master`
- The PreCommit hook + `.gitattributes` enforce this; **also verify by eye** — hooks can be `--no-verify`'d

### 9. Report
```
Code Review Summary:
  🔴 Critical: N (must fix before merge)
  🟡 Warning: N (should fix)
  🔵 Info: N (suggestions)

Public Surface Impact:
  Breaking: N changes — list each with migration note status
  Additive: N changes — list each with CHANGELOG status

Files Reviewed: N
Findings by Category:
  Architecture: N
  Security: N
  Testing: N
  Code Quality: N
  Patterns: N
  Branch model: N

forge_analyze score: N/100
forge_diff scope drift: N files outside scope
```

## Safety Rules
- Review ONLY — do NOT modify files
- Every finding must cite the specific rule, instruction file, or convention violated
- Acknowledge what's done well, not just problems
- Flag anything that needs human judgment rather than prescribing a fix

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Tests pass so the code is fine" | Passing tests prove the happy path works. They don't prove the code is maintainable, secure, or architecturally sound. |
| "This change is too small to review" | Small changes accumulate. A "tiny" shortcut in one PR establishes a pattern that scales into a systemic problem. |
| "I wrote it, I can review it" | Self-review has blind spots. The author's mental model fills gaps that a reviewer would catch. Use a fresh agent session per `context-fuel.instructions.md`. |
| "No findings means the review is thorough" | A clean review with zero findings is suspicious — it usually means the review was superficial, not perfect. |
| "Skip the surface diff for refactor PRs" | The whole point of a refactor PR is that public surface should NOT change. The surface diff is the proof. A refactor PR with breaking surface changes is mis-scoped. |
| "Skip /clean-code-review since this is a small change" | The mechanical pass takes <60s. Skipping it means complexity/duplication/Boy Scout violations slip through and get caught in production. |

## Warning Signs

- Review skipped one or more sections — not all 7 review areas evaluated
- No findings reported at all — suspiciously clean review with zero suggestions
- Findings lack specific rule citations — vague comments like "looks off" without referencing a convention
- Surface diff shows breaking changes but CHANGELOG was not updated in the same PR
- New MCP tool added but `capabilities.mjs` `TOOL_METADATA` not updated
- New CLI command in `pforge.ps1` but no matching addition in `pforge.sh` (parity violation)
- `forge_analyze` score not included — consistency analysis was skipped

## Exit Proof

After completing this skill, confirm:
- [ ] `/clean-code-review` was run first (mechanical findings reviewed)
- [ ] All 7 review sections completed (surface diff, architecture, security, testing, code quality, patterns, branch model)
- [ ] Surface-diff report parsed; every `breaking` finding has CHANGELOG + version bump verified
- [ ] Findings table generated with severity levels
- [ ] `forge_analyze` score included (if plan exists)
- [ ] `forge_diff` scope drift check completed (if plan exists)
- [ ] Every finding cites a specific rule or convention

## Relationship to Other Tools

| Tool / Instruction | Relationship |
|-------------------|-------------|
| `/clean-code-review` | **Prerequisite.** Run mechanical pass first; this skill handles qualitative review only |
| `scripts/audit/surface-diff.mjs` | Generates the consumer-impact report this skill consumes in Step 2 |
| `.github/instructions/architecture-principles.instructions.md` | Defines the architectural rules Step 3 checks |
| `.github/instructions/security.instructions.md` | Defines the security rules Step 4 checks |
| `.github/instructions/testing.instructions.md` | Defines the test conventions Step 5 checks |
| `docs/plans/PROJECT-PRINCIPLES.md` | Non-negotiable principles + forbidden patterns checked throughout |
| `forge_analyze` | Programmatic consistency scoring against the plan |
| `forge_diff` | Programmatic scope-drift detection |

## Persistent Memory (if OpenBrain is configured)

- **Before reviewing**: `search_thoughts("code review findings", project: "plan-forge", created_by: "copilot-vscode", type: "bug")` — load prior review findings and recurring violation patterns to check proactively
- **After review**: `capture_thought("Review: <N findings — key issues summary>", project: "plan-forge", created_by: "copilot-vscode", source: "skill-code-review")` — persist recurring patterns so future reviews catch them earlier
