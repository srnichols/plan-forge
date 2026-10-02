---
name: onboarding
description: Walk a new developer through Rust/Axum project setup, Cargo tooling, architecture, Docker dependencies, tests, and first task. Use when someone new joins the team or needs to understand the codebase.
argument-hint: "[optional: specific area to focus on, e.g. 'API', 'database', or 'testing']"
tools:
  - run_in_terminal
  - read_file
  - forge_smith
---

# Developer Onboarding Skill

## Trigger
"Onboard me to this project" / "How does this codebase work?" / "New developer setup"

## Steps

### 1. Environment Setup
Verify prerequisites and the Rust toolchain:

```bash
git --version
rustc --version
cargo --version
docker version
```

> **If Rust is missing**: install with rustup and select the project toolchain declared in `rust-toolchain.toml` or `rust-version = "1.98"`.

Install project tools if they are not already available:

```bash
cargo install cargo-nextest --version 0.9.146 --locked
cargo install sqlx-cli --version 0.9.0 --locked --no-default-features --features rustls,postgres
cargo install cargo-llvm-cov --version 0.9.1 --locked
```

### 2. Verify Build and Tests
Use `forge_smith` for Plan Forge setup health, then run the Rust gates:

```bash
cargo build --locked
cargo nextest run --all-targets
```

> **If this step fails**: check for missing `.env`, Docker not running for Testcontainers, or stale SQLx offline data.

### 3. Architecture Overview
Read and explain:
1. `.github/copilot-instructions.md` — project overview and conventions.
2. `docs/plans/PROJECT-PRINCIPLES.md` — non-negotiable principles, if present.
3. `src/main.rs` — bootstrapping, telemetry, migrations, shutdown.
4. `src/lib.rs` — `app(state)` router factory used by production and tests.
5. The layer flow: routes -> services -> repositories -> SQLx.

### 4. Key Files Tour
Walk through:
- `Cargo.toml` and `Cargo.lock` for versions and feature flags.
- `src/config.rs` for environment settings and `secrecy::SecretString`.
- `src/state.rs` for `AppState`, trait objects, and `FromRef`.
- `src/error.rs` for RFC 9457 `AppError` mapping.
- `src/auth.rs` for verified JWT extraction and tenant identity.
- `migrations/` and `.sqlx/` for SQLx offline mode.
- `tests/` and `.config/nextest.toml` for test layout.
- `Dockerfile` and `docker-compose.yml` for cargo-chef, PostgreSQL 18, Redis 8, and probes.

### 5. Plan Forge Pipeline Tour
Explain:
1. Plans live in `docs/plans/`.
2. Guardrails live in `.github/instructions/`.
3. Prompts guide specify, harden, execute, review, and ship.
4. Skills automate review, testing, deploy, and documentation workflows.
5. Reviewer agents provide read-only specialist checks.

### 6. First Task Guidance
Suggest a small first task:
- Add or improve a router test using `tower::ServiceExt::oneshot`.
- Document one endpoint with `utoipa`.
- Add a repository test proving tenant scoping.
- Improve a readiness check or smoke test.

### 7. Report
```
Onboarding Status:
  Rust:             PASS / FAIL (version)
  Cargo tools:      PASS / FAIL
  Docker:           PASS / FAIL
  Dependencies:     PASS / FAIL
  Tests:            PASS / FAIL
  Forge Smith:      PASS / FAIL

Key files reviewed:  N
Architecture docs:   N

Overall: PASS / FAIL
```

## Safety Rules

- Keep onboarding read-only; do not modify project files.
- Explain Rust ownership, async, and SQLx concepts at the developer's level.
- Surface environment gotchas rather than assuming they are obvious.
- Point to source files and docs for follow-up reading.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Cargo build is enough setup validation" | Docker, SQLx offline data, nextest, and migrations fail in different ways than compilation. |
| "New developers can discover the layer model" | Rust module boundaries are deliberate; routes, services, and repositories need an explicit tour. |
| "Local Postgres is fine for onboarding" | Testcontainers and Compose prevent hidden machine-specific assumptions. |
| "Skip telemetry until later" | Request IDs, JSON logs, and shutdown flushing are part of production readiness from day one. |

## Warning Signs

- No one verifies Docker before integration tests.
- `.sqlx/` and migration flow are unexplained.
- Tenant identity rules are omitted from the architecture walkthrough.
- First task suggestion requires broad domain knowledge.
- Setup instructions depend on uncommitted local configuration.

## Exit Proof

After completing this skill, confirm:
- [ ] Prerequisite commands were run or explicitly skipped with a reason
- [ ] `cargo build --locked` outcome recorded
- [ ] `cargo nextest run --all-targets` outcome recorded
- [ ] Architecture walkthrough covered main, lib, routes, services, repositories, and state
- [ ] First task suggestion is concrete and small

## Persistent Memory — onboarding

- **Before onboarding**: recall known Rust setup blockers, Docker issues, and first-task guidance.
- **After onboarding**: capture environment status, blockers, and docs that need improvement.
