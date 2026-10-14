---
name: code-review
description: Plan-Forge-tuned comprehensive code review — public-surface diff, forge analysis, architecture, security, testing, patterns, software entropy, knowledge-level DRY, changeability, contracts, and resource lifecycles. Includes ACI compliance, dual-shell parity, and branch-model gates. Use before merging features or at the end of a phase. With --quorum, dispatches multi-model analysis.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill — Plan Forge

> **Run `/clean-code-review` FIRST.** That skill is the mechanical/quantitative pass: 44 CHECKS across 11 languages (JS/TS, Python, .NET, Java/Kotlin, Go, Rust, PHP, Swift, Ruby, PowerShell, Bicep) — module size, function complexity, parameter counts, duplication (jscpd + literal/regex scanners), engineering hygiene (empty catches, magic numbers, dead imports, TODO/FIXME, hardcoded secrets, SQL-injection, command-injection patterns), shell-parity (PS/Bash twins), enums-drift (`pforge-mcp/enums.mjs`), cross-package dependency boundaries, and ESLint. This skill is the qualitative/judgment pass. Mechanical findings clear the noise so this review can focus on what actually requires judgment.

## Trigger
"Review my code" / "Run code review" / "Check before merge" / "Code review --quorum"

## Steps

### 0. Forge Analysis
Use the `forge_analyze` MCP tool with the current plan (if available) to get a structured consistency score. Pass the plan's `.md` path, not a source file: without `quorum: true`, `forge_analyze` scores plans only and rejects a source-file target. If the reviewed work has no plan, skip the score. Use the `forge_diff` MCP tool to detect scope drift and forbidden file edits.

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
- Orthogonality / change locality: changing one policy should not require unrelated responsibilities to change. Check hidden shared state and side effects; cite the actual coupling, not a touched-file-count threshold.
- Reversibility (external dependencies, persisted formats, defaults): verify replacement boundaries and migration or rollback provisions where needed. Do not demand speculative abstraction layers.
- Contracts: identify meaningful preconditions, postconditions, and state invariants; verify they are enforced through types, guards, or assertions and tested.
- Resource ownership / temporal coupling: make acquire/release ownership and required call ordering explicit. Check cleanup on failure or cancellation, concurrent access, and retry idempotency where applicable.
- Deep modules / information hiding: identify the coherent complexity a changed boundary hides and how callers become simpler. Preserve single responsibility, legitimate thin adapters, and size gates; more wrappers or lower LOC alone are not improvement.
- Contract Refs: compare affected boundaries with the plan's exact accepted contract/decision revisions and approval evidence. Report stale or missing consequential approval; unchanged boundaries may cite existing approved sources.

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
- For fixes, explain the failure mechanism and verify a regression test fails before the fix and passes after. Check incidental timing, ordering, and environment assumptions; report missing reproduction evidence as a verification gap.
- For invariant-heavy transformations or state machines, consider property-based tests (round trips, pagination without omissions or duplicates, preserved state invariants). Use reproducible inputs and existing test tools; do not mandate a new framework.
- Where lifecycle or ordering matters, cover invalid call order, cancellation, cleanup after failure, concurrent interleavings, and repeated operations as applicable.

### 6. Code Quality
- Naming follows project conventions (kebab-case files, camelCase functions, `is`/`has`/`can` prefix for booleans, import enums from `pforge-mcp/enums.mjs` — never hand-type)
- No `any` / `unknown` when type is known
- Error handling comprehensive (no empty catch blocks, no swallowed promise rejections)
- No `TODO` / `FIXME` / `HACK` without a tracked issue
- No dead code or unused imports
- `console.log` is intentional CLI output — debug leakage removed
- Software entropy / broken windows: identify new or spreading workarounds, unexplained convention exceptions, contradictory behavior, and weakened tests or gates. Fix deterioration introduced or worsened by the change; track unrelated debt without expanding scope.
- Fail early at the appropriate boundary: stop an unsafe operation with an explicit error rather than manufacture success or silently replace unknown state with a default.

### 7. Patterns & Consistency
- Follows existing patterns from `.github/instructions/`
- Matches coding style of adjacent code
- No reinvented patterns when existing ones apply
- Configuration via `.forge.json` / env, not hardcoded
- For MCP tool authors: pattern-match against `forge_search` (the gold-standard ACI surface)
- Knowledge-level DRY: identify the same business rule maintained across code, configuration, schemas, or documentation. Consolidate shared knowledge, not coincidentally similar syntax with independent reasons to change; keep test expectations independent of the implementation.
- Domain Language: check bounded-context meanings, invariants, and approved aliases across specification, APIs, code, and tests. Do not infer new business meanings or globally rename unrelated contexts.

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
| "I wrote it, I can review it" | Self-review has blind spots. The author's mental model fills gaps that a reviewer would catch. Use a fresh agent session per `context-fuel.instructions.md`. |
| "The finding count proves review quality" | Zero findings can be legitimate; many findings can be noise. Require coverage and evidence, not a quota. |
| "Fewer lint warnings prove less entropy" | Counts can fall through suppression or moving code, while new coupling or broken contracts remain. Review the actual changes and per-rule severity. |
| "Skip the surface diff for refactor PRs" | The whole point of a refactor PR is that public surface should NOT change. The surface diff is the proof. A refactor PR with breaking surface changes is mis-scoped. |
| "Skip /clean-code-review since this is a small change" | The mechanical pass takes <60s. Skipping it means complexity/duplication/Boy Scout violations slip through and get caught in production. |

## Warning Signs

- Review skipped one or more sections — not all 7 review areas evaluated
- A clean conclusion without coverage evidence, or with unverified checks omitted
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
- [ ] Maintainability checks have evidence or an explicit applicability / verification reason
- [ ] Findings distinguish change-related risks from pre-existing debt; no finding quota was used

## Relationship to Other Tools

| Tool / Instruction | Relationship |
|-------------------|-------------|
| `/clean-code-review` | **Prerequisite — always run first.** Mechanical pass covering 44 CHECKS across 11 languages (incl. PowerShell + Bicep), DRY scanners (jscpd + literal/regex), engineering hygiene (empty catches, magic numbers, exec/SQL injection patterns, hardcoded secrets, dead imports), shell-parity for PS/Bash twins, enums-drift against `pforge-mcp/enums.mjs`, and cross-package dependency boundaries. Skipping it means complexity/dup/hygiene violations resurface as qualitative-review noise. |
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
