---
name: code-review
description: Run a Rust-focused review across Axum boundaries, services, repositories, async behavior, SQLx tenancy, Docker readiness, testing, and observability. Includes software entropy, knowledge-level DRY, changeability, contracts, and resource lifecycles. With --quorum, dispatch multi-model review.
argument-hint: "[optional: specific files or areas to focus on] [--quorum]"
tools: [read_file, forge_analyze, forge_diagnose, forge_diff]
---

# Code Review Skill

> **Run `/clean-code-review` first.** That pass catches duplicated blocks, size/complexity drift, stale TODOs, and hygiene issues. This review focuses on Rust architecture, security, async correctness, and production readiness.

## Trigger
"Review my code" / "Run code review" / "Check before merge" / "Code review --quorum"

## Steps

### 0. Forge Analysis
Use `forge_analyze` with the current plan when available. Use `forge_diff` to identify scope drift and forbidden files.

**If `--quorum` was specified**: call `forge_analyze` with `quorum: true` and synthesize consensus findings.

### 1. Identify Changed Rust Surfaces
```bash
git diff --name-only main...HEAD -- '*.rs' 'Cargo.toml' 'Cargo.lock' 'Dockerfile' 'docker-compose*.yml' '.sqlx/**' 'migrations/**'
```
> **If this step fails**: fall back to `git diff --name-only HEAD~1`.

### 2. Architecture Review
Check layer boundaries:
- `src/routes/` handlers are thin and return typed results.
- `src/services/` owns business rules and transactions, with no Axum extractors.
- `src/repositories/` owns SQLx queries and binds `tenant_id` on every method.
- `src/domain/` owns newtype IDs and invariants.
- `src/dto/` owns serde and validation types.
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
Inspect for:
- Tenant identity coming only from verified `AuthUser`.
- Parameterized SQL via `query!`, `query_as!`, or `QueryBuilder::push_bind`.
- No secrets in code, Docker layers, committed env files, logs, or examples.
- JWT issuer, audience, expiration, and not-before checks.
- RFC 9457 errors that hide internal database and anyhow details.

### 4. Async and Runtime Review
Verify:
- No blocking filesystem/network work on Tokio worker threads.
- CPU-heavy or blocking calls use `spawn_blocking`.
- Background tasks use `CancellationToken` and are joined on shutdown.
- `axum::serve(...).with_graceful_shutdown(...)` is wired in `main`.
- Telemetry provider flushes during shutdown.

### 5. Testing Review
- New service rules have unit tests.
- Router behavior is exercised through `tower::ServiceExt::oneshot`.
- Repository behavior has `#[sqlx::test]` or Testcontainers coverage.
- Mockall is used at repository trait seams, not to mock internal service methods.
- `cargo nextest run --all-targets` and coverage gates are documented.
- For fixes, explain the failure mechanism and verify a regression test fails before the fix and passes after. Check incidental timing, ordering, and environment assumptions; report missing reproduction evidence as a verification gap.
- For invariant-heavy transformations or state machines, consider property-based tests (round trips, pagination without omissions or duplicates, preserved state invariants). Use reproducible inputs and existing test tools; do not mandate a new framework.
- Where lifecycle or ordering matters, cover invalid call order, cancellation, cleanup after failure, concurrent interleavings, and repeated operations as applicable.

### 6. Deployment and Observability Review
- Dockerfile uses cargo-chef, `SQLX_OFFLINE=true`, and `cargo build --release --locked`.
- Runtime runs as non-root and exposes liveness/readiness endpoints.
- Compose uses `postgres:18-alpine`, `redis:8-alpine`, and service health checks.
- JSON logs include request IDs and avoid high-cardinality metric labels.

### 7. Report
```
Code Review Summary:
  Critical: N
  Warning:  N
  Info:     N

Files Reviewed: N
Findings by Category:
  Architecture:    N
  Security:        N
  Async Runtime:   N
  Testing:         N
  Deployment:      N
  Observability:   N
Forge Analysis Score: N/100
Scope Drift: N files outside scope
```

Include coverage for the maintainability checks: **checked** (evidence), **not applicable** (reason), or **not verified** (gap). Keep unverified areas separate from findings; an incomplete review is not a clean review. Separate introduced or worsened issues from pre-existing in-scope debt.

#### Design Concerns

For observed design friction, report evidence, owner, disposition (`fix now`, `plan later`, or `accept risk`), existing issue/smelt or proposed follow-up, revisit trigger, and closure validation. Current blockers still block approval and cannot become accepted debt. Do not create issues, plans, or unrelated refactors in this read-only review; future work needs owner approval. Fewer warnings alone do not prove closure, and zero concerns is valid with coverage stated.

## Safety Rules
- Review only; do not modify source while running this skill.
- Cite a code location, the rule or contract, and a concrete behavioral or maintenance risk behind every finding.
- Distinguish exploitable issues from maintainability concerns.
- Flag any recommendation requiring human product or migration judgment.
- Zero findings is valid after completed, evidence-backed checks. Never invent findings or require a minimum number.
- Do not demand unrelated cleanup or judge quality from a lint total alone. Existing blocking gates still apply.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The compiler accepted it" | Rust type safety does not prove tenancy, authorization, query filters, or rollout behavior. |
| "SQLx macros make SQL review unnecessary" | Macros verify shape, not authorization scope or business semantics. |
| "Async code is fine because it awaits" | Awaiting a blocking operation still starves the runtime. Check the called API. |
| "Docker builds prove deployment readiness" | A built image can still fail readiness, migrations, telemetry, or non-root runtime checks. |
| "The finding count proves review quality" | Zero findings can be legitimate; many findings can be noise. Require coverage and evidence, not a quota. |
| "Fewer lint warnings prove less entropy" | Counts can fall through suppression or moving code, while new coupling or broken contracts remain. Review the actual changes and per-rule severity. |

## Warning Signs

- Services import `axum::extract` or HTTP status types.
- Repositories accept a bare `Uuid` without identifying it as tenant-scoped.
- `unwrap()` appears in request paths.
- Tests call handlers directly instead of using the router.
- Dockerfile omits `--locked` or `SQLX_OFFLINE=true`.
- OpenTelemetry setup has no shutdown flush.

## Exit Proof

After completing this skill, confirm:
- [ ] All review sections completed
- [ ] Findings table includes severity and category
- [ ] Forge score included when a plan exists
- [ ] Scope drift checked when a plan exists
- [ ] Each finding names a concrete Rust file or symbol
- [ ] Maintainability checks have evidence or an explicit applicability / verification reason
- [ ] Findings distinguish change-related risks from pre-existing debt; no finding quota was used

## Persistent Memory — code review

- **Before reviewing**: recall recurring Rust review findings, unsafe deployment shortcuts, and tenancy defects.
- **After review**: capture the main finding categories and any convention that should become a guardrail.
