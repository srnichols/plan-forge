---
name: code-review
description: Run a Rust-focused review across Axum boundaries, services, repositories, async behavior, SQLx tenancy, Docker readiness, testing, and observability. With --quorum, dispatch multi-model review.
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

## Safety Rules
- Review only; do not modify source while running this skill.
- Cite the rule, contract, or file convention behind every finding.
- Distinguish exploitable issues from maintainability concerns.
- Flag any recommendation requiring human product or migration judgment.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The compiler accepted it" | Rust type safety does not prove tenancy, authorization, query filters, or rollout behavior. |
| "SQLx macros make SQL review unnecessary" | Macros verify shape, not authorization scope or business semantics. |
| "Async code is fine because it awaits" | Awaiting a blocking operation still starves the runtime. Check the called API. |
| "Docker builds prove deployment readiness" | A built image can still fail readiness, migrations, telemetry, or non-root runtime checks. |

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

## Persistent Memory — code review

- **Before reviewing**: recall recurring Rust review findings, unsafe deployment shortcuts, and tenancy defects.
- **After review**: capture the main finding categories and any convention that should become a guardrail.
