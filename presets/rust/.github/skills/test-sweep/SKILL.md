---
name: test-sweep
description: Run all Rust test suites and quality gates — formatting, clippy, nextest, SQLx offline metadata, docs, coverage, and completeness scan. Use after execution slices or before review.
argument-hint: "[optional: specific test category to run]"
tools: [run_in_terminal, read_file, forge_sweep]
---

# Test Sweep Skill

## Trigger
"Run all tests" / "Full test sweep" / "Check test health"

## Steps

### 1. Formatting and Lints
```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

### Conditional: Static Gate Failure
> If formatting or clippy fails, report the failing command and skip slower suites unless the user asks to continue.

### 2. Unit and Integration Tests
```bash
cargo nextest run --all-targets
```

### 3. SQLx Build Gate
```bash
cargo check --all-targets --locked
```

### 4. SQLx Metadata Staleness
Set `DATABASE_URL` to a PostgreSQL 18 database, then run:

```bash
sqlx migrate run
cargo sqlx prepare --check
```

### 5. Documentation Tests
```bash
cargo test --doc
```

### 6. Coverage
```bash
cargo llvm-cov --all-features --workspace --summary-only
```

### 7. Completeness Scan
Use `forge_sweep` to scan for TODO, FIXME, HACK, stub, placeholder, and mock-data markers.

### 8. Report
```
Rust Test Sweep:
  Format:       PASS / FAIL
  Clippy:       PASS / FAIL
  Nextest:      X passed, Y failed, Z skipped
  SQLx build:   PASS / FAIL
  SQLx stale:   PASS / FAIL
  Doc tests:    PASS / FAIL
  Coverage:     XX%
  Sweep:        N markers

Overall: PASS / FAIL
```

## On Failure
- Show failing command, exit status, and failing test names.
- Read the failing test source and nearby implementation.
- Classify the failure before suggesting a fix.
- Ask before editing code.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "cargo test is close enough to nextest" | nextest catches suite configuration and produces the same output CI expects. |
| "SQLx prepare is only a database task" | Offline metadata is part of the production Docker build contract. |
| "Coverage can be skipped for small changes" | Small untested branches accumulate into production incidents. |
| "Ignored tests are harmless" | Ignored tests need a reason and issue; otherwise they normalize broken behavior. |

## Warning Signs

- `cargo nextest run` is missing from the report.
- `cargo sqlx prepare --check` fails after migrations were applied to the database in `DATABASE_URL`.
- Testcontainers tests are skipped because Docker was not started.
- Coverage drops without explanation.
- `forge_sweep` finds new TODO/FIXME/HACK markers in production code.

## Exit Proof

After completing this skill, confirm:
- [ ] Formatting and clippy gates ran
- [ ] `cargo nextest run --all-targets` completed
- [ ] SQLx offline metadata check completed or was not applicable with a reason
- [ ] Coverage summary generated
- [ ] Completeness scan reported zero new production markers

## Persistent Memory — test sweep

- **Before running tests**: recall known flakes, Docker/Testcontainers issues, and SQLx metadata traps.
- **After the sweep**: capture counts, failures, skipped tests, and infrastructure problems.
