---
name: code-review
description: Run a comprehensive Laravel code review across architecture, security, testing, database access, deployment, observability, naming, and consistency. Includes software entropy, knowledge-level DRY, changeability, contracts, and resource lifecycles. Use before merging features or at the end of a phase. With --quorum, dispatch multi-model analysis for higher confidence.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill

> **Run `/clean-code-review` first.** That pass catches quantitative issues. This skill focuses on Laravel architecture and judgment calls.

## Trigger
"Review my code" / "Run code review" / "Check before merge" / "Code review --quorum"

## Steps

### 0. Forge Analysis
Use `forge_analyze` with the current plan when available. Use `forge_diff` to detect scope drift and forbidden edits.

If `--quorum` was specified, run `forge_analyze` with `quorum: true` and synthesize consensus findings.

### 1. Identify Changed Files
```bash
git diff --name-only main...HEAD
git diff --name-only HEAD~1
```

### 2. Architecture Review
Check Laravel layer separation:

- Controllers are thin: Form Request in, service call, API Resource out.
- Services own business rules and transactions.
- Repositories own Eloquent query construction.
- Models do not become service locators.
- `bootstrap/app.php` owns routing, middleware, and exception rendering.
- Orthogonality / change locality: changing one policy should not require unrelated responsibilities to change. Check hidden shared state and side effects; cite the actual coupling, not a touched-file-count threshold.
- Reversibility (external dependencies, persisted formats, defaults): verify replacement boundaries and migration or rollback provisions where needed. Do not demand speculative abstraction layers.
- Contracts: identify meaningful preconditions, postconditions, and state invariants; verify they are enforced through types, guards, or assertions and tested.
- Resource ownership / temporal coupling: make acquire/release ownership and required call ordering explicit. Check cleanup on failure or cancellation, concurrent access, and retry idempotency where applicable.
- Deep modules / information hiding: identify the coherent complexity a changed boundary hides and how callers become simpler. Preserve single responsibility, legitimate thin adapters, and size gates; more wrappers or lower LOC alone are not improvement.
- Contract Refs: compare affected boundaries with the plan's exact accepted contract/decision revisions and approval evidence. Report stale or missing consequential approval; unchanged boundaries may cite existing approved sources.
- Software entropy / broken windows: identify new or spreading workarounds, unexplained convention exceptions, contradictory behavior, and weakened tests or gates. Fix deterioration introduced or worsened by the change; track unrelated debt without expanding scope.
- Fail early at the appropriate boundary: stop an unsafe operation with an explicit error rather than manufacture success or silently replace unknown state with a default.
- Knowledge-level DRY: identify the same business rule maintained across code, configuration, schemas, or documentation. Consolidate shared knowledge, not coincidentally similar syntax with independent reasons to change; keep test expectations independent of the implementation.
- Domain Language: check bounded-context meanings, invariants, and approved aliases across specification, APIs, code, and tests. Do not infer new business meanings or globally rename unrelated contexts.

### 3. Security Review
Review:

- Tenant comes only from authenticated user context.
- Policies or Gates protect sensitive operations.
- Sanctum or verified OIDC guards protect API routes.
- Raw SQL uses bindings.
- No secrets in code, config committed to git, logs, or Docker images.
- Validation happens at HTTP and job boundaries.

### 4. Database Review
Look for:

- `with()` on relationships needed by resources.
- Cursor pagination with unique ordering.
- `DB::transaction()` around multi-write operations.
- No lazy-loading regressions in non-production.
- Unique constraint handling maps only true unique violations to 409.

### 5. Testing Review
Verify:

- Feature tests cover route, middleware, policy, request validation, resource shape, and tenant isolation.
- Unit tests cover services, DTOs, policies, and job handlers.
- PostgreSQL-specific behavior uses Testcontainers.
- Fakes are asserted and scoped to the test.
- Coverage command is documented for new critical paths.
- For fixes, explain the failure mechanism and verify a regression test fails before the fix and passes after. Check incidental timing, ordering, and environment assumptions; report missing reproduction evidence as a verification gap.
- For invariant-heavy transformations or state machines, consider property-based tests (round trips, pagination without omissions or duplicates, preserved state invariants). Use reproducible inputs and existing test tools; do not mandate a new framework.
- Where lifecycle or ordering matters, cover invalid call order, cancellation, cleanup after failure, concurrent interleavings, and repeated operations as applicable.

### 6. Deployment and Observability Review
Check:

- Dockerfile follows the php-fpm + nginx sidecar contract.
- Queue worker and scheduler deployments are updated with web changes.
- `/up` and `/ready` are both present where needed.
- Logs use JSON Monolog and `Log::withContext`.
- OpenTelemetry spans do not swallow exceptions.

### 7. Report
```text
Code Review Summary:
  Critical: N
  Warning:  N
  Info:     N

Files Reviewed: N
Findings by Category:
  Architecture: N
  Security:     N
  Database:     N
  Testing:      N
  Deploy/Ops:   N
  Observability:N
Forge Analysis Score: N/100
Scope Drift: N files outside scope
```

Include coverage for the maintainability checks: **checked** (evidence), **not applicable** (reason), or **not verified** (gap). Keep unverified areas separate from findings; an incomplete review is not a clean review. Separate introduced or worsened issues from pre-existing in-scope debt.

#### Design Concerns

For observed design friction, report evidence, owner, disposition (`fix now`, `plan later`, or `accept risk`), existing issue/smelt or proposed follow-up, revisit trigger, and closure validation. Current blockers still block approval and cannot become accepted debt. Do not create issues, plans, or unrelated refactors in this read-only review; future work needs owner approval. Fewer warnings alone do not prove closure, and zero concerns is valid with coverage stated.

## Safety Rules

- Review only; do not modify files.
- Cite a code location, the rule or Laravel convention, and a concrete behavioral or maintenance risk behind each finding.
- Separate blockers from maintainability suggestions.
- Flag uncertain framework behavior for human confirmation.
- Zero findings is valid after completed, evidence-backed checks. Never invent findings or require a minimum number.
- Do not demand unrelated cleanup or judge quality from a lint total alone. Existing blocking gates still apply.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Laravel makes this magic, so it is fine" | Magic still needs explicit boundaries, authorization, and tests. |
| "The route works locally" | Local success says little about tenant isolation, queues, migrations, or production config. |
| "Eloquent queries are safe by default" | Raw expressions, scopes, and missing tenant filters can still leak data. |
| "The finding count proves review quality" | Zero findings can be legitimate; many findings can be noise. Require coverage and evidence, not a quota. |
| "Fewer lint warnings prove less entropy" | Counts can fall through suppression or moving code, while new coupling or broken contracts remain. Review the actual changes and per-rule severity. |

## Warning Signs

- Controller returns an Eloquent model directly.
- Service imports `Request` or returns `JsonResponse`.
- Repository applies business decisions instead of query constraints.
- Tests authenticate by setting client-controlled identity headers.
- Queue job does not set `CurrentTenant`.

## Exit Proof

After completing this skill, confirm:

- [ ] Architecture, security, database, testing, deploy, and observability sections completed
- [ ] Findings table includes severity and file references
- [ ] `forge_analyze` score included if a plan exists
- [ ] `forge_diff` scope check included if a plan exists
- [ ] Every blocker has a concrete validation path
- [ ] Maintainability checks have evidence or an explicit applicability / verification reason
- [ ] Findings distinguish change-related risks from pre-existing debt; no finding quota was used

## Persistent Memory for Reviews

- **Before reviewing**: `search_thoughts("Laravel code review findings", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After review**: `capture_thought("Laravel review: <N findings, key recurring patterns>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-code-review")`
