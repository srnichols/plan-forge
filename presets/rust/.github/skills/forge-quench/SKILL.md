---
name: forge-quench
description: "Systematically simplify Rust code while preserving behavior — measure, understand, propose, prove, report. Use after a feature works and tests pass, when Axum services, SQLx repositories, or async workflows are harder to maintain than necessary."
argument-hint: "[optional: specific files or directories to simplify, e.g. 'src/services/' or 'src/services/order_service.rs']"
tools:
  - run_in_terminal
  - read_file
  - grep_search
  - replace_string_in_file
  - forge_sweep
---

# Forge Quench — Rust Code Simplification Skill

> Named after the metallurgical quenching process — rapidly cooling hot metal simplifies its crystal structure and hardens it.

## Trigger
"Simplify this code" / "Reduce complexity" / "Clean up before review" / "Quench this module" / "Code is too complex"

## Steps

### 1. Measure Complexity

Identify the most complex Rust functions in the target.

```bash
cargo clippy --workspace --all-targets --all-features -- -D warnings
grep -rn "async fn\\|fn " <target> --include="*.rs" | head -40
grep -rn "match \\|if \\|else if\\|while \\|loop " <target> --include="*.rs" | wc -l
```

List the top 3-5 candidates by:
- Long function bodies.
- Deeply nested `match` or `if` chains.
- Repeated validation branches.
- Too many parameters instead of a request/options struct.
- Mixed concerns across handler, service, repository, and telemetry logic.

> **If no candidates exceed thresholds**: report "No simplification candidates found" and stop with a PASS.

### 2. Understand First (Chesterton's Fence)

Before simplifying any function, explain why the complexity exists:

1. Use `git blame` to find when the branchy code appeared.
2. Check tests for edge cases protected by the current shape.
3. Identify tenant, transaction, and retry semantics that must survive.
4. Note whether the complexity belongs in the current layer.

```markdown
| Function | Why Complex | Still Valid? | Proposed Action |
|----------|-------------|--------------|-----------------|
| place_order | Opens transaction and emits audit event | Yes | Extract transaction body into private service helper |
| build_filters | Builds optional SQL predicates | Yes | Replace branch chain with QueryBuilder helper |
```

> **If the reason is still valid and extraction would obscure the rule**: leave it alone and document the rationale.

### 3. Propose Simplifications

Common Rust-friendly moves:
- Extract guard functions returning typed `AppError`.
- Replace repeated `match` arms with small strategy structs or lookup tables.
- Move SQL construction from services to repositories.
- Split DTO validation from domain state transitions.
- Convert long argument lists into an options struct.
- Extract shutdown or telemetry setup from `main` into a focused module.

For each proposal, state the preserved behavior, test coverage, and rollback path. Stop for user approval before editing.

### 4. Apply and Prove (One at a Time)

For each approved simplification:

1. Apply one refactor.
2. Run targeted tests immediately.
3. Run the broader Rust gate.

```bash
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo nextest run --all-targets
```

If any test fails, revert the simplification. Do not "fix" tests to match changed behavior unless the user explicitly accepts a behavior change.

### 5. Report

```
Forge Quench Report:
  Target:             <files/directories analyzed>
  Candidates Found:   N
  Understood:         N
  Proposed:           N
  Approved:           N
  Applied:            N
  Reverted:           N
  Skipped:            N

  Complexity Before:  <metric or qualitative summary>
  Complexity After:   <metric or qualitative summary>
  Tests:              PASS / FAIL
  Sweep:              N markers

  Overall: PASS / PARTIAL / BLOCKED
```

## Safety Rules

- Never simplify Rust code you cannot explain through Chesterton's Fence.
- Keep refactors separate from feature or migration changes.
- Run tests after each approved simplification.
- Revert immediately if behavior changes unexpectedly.
- Preserve tenant scoping, transaction boundaries, and typed errors.
- Ask before changing public API, database schema, or error contracts.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This match arm is impossible" | Domain invariants drift. Prove impossibility with types or tests before deleting a branch. |
| "I can move SQL into the service to shorten the repository" | That swaps line count for architectural debt and breaks unit-test seams. |
| "A helper with `anyhow::Result` is simpler" | Generic errors can erase RFC 9457 mapping and conflict semantics. |
| "One large refactor commit is faster" | Rust compile errors and behavior regressions become hard to isolate. |
| "Clippy is enough proof" | Clippy does not verify business behavior, tenant filters, or migrations. |

## Warning Signs

- Extracted helpers need many mutable references.
- Simplification removes an explicit tenant or transaction argument.
- New generic utilities hide domain vocabulary.
- Tests are updated before proving the old behavior.
- Refactor introduces new `.unwrap()` in production code.

## Exit Proof

After completing this skill, confirm:
- [ ] Candidate rationale documented
- [ ] Approved simplifications applied one at a time
- [ ] `cargo nextest run --all-targets` passes after the last change
- [ ] No behavior changes unless explicitly approved
- [ ] `forge_sweep` shows no new TODO/FIXME/HACK markers
- [ ] Skipped complex functions have a reason

## Persistent Memory — simplification

- **Before simplifying**: recall intentionally complex Rust modules and successful extraction patterns.
- **After simplifying**: capture what changed, what stayed complex, and the tests that proved behavior.
