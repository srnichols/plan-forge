---
name: dependency-audit
description: Scan Rust Cargo dependencies for vulnerabilities, yanked crates, outdated versions, duplicate dependency trees, and license issues.
argument-hint: "[optional: specific crate to audit]"
tools:
  - run_in_terminal
  - read_file
  - forge_sweep
---

# Dependency Audit Skill (Rust / Cargo)

## Trigger
"Audit dependencies" / "Check for vulnerabilities" / "Are my crates up to date?"

## Steps

### 1. Check for Known Vulnerabilities
```bash
cargo audit
```
> If this step fails because `Cargo.toml` is missing, stop and report "No Rust Cargo project found in this directory."

> If `cargo-audit` is not installed, install it with `cargo install cargo-audit --locked` and retry when allowed by the user or project policy.

### 2. Enforce Dependency Policy
```bash
cargo deny check
```
> If `deny.toml` is missing, report that policy coverage is incomplete and recommend adding license, advisory, ban, and source rules.

### 3. Check for Outdated Crates
```bash
cargo outdated
```
> If `cargo-outdated` is unavailable, install with `cargo install cargo-outdated --locked` or report the gap.

### 4. Inspect Duplicate Versions
```bash
cargo tree --duplicates
```
Review duplicate crypto, TLS, HTTP, and async runtime crates first; duplicates there commonly increase binary size and patch exposure.

### 5. Verify Locked Build
```bash
cargo build --locked
```
This proves `Cargo.lock` is present and the resolver does not need network-time version changes.

### 6. Completeness Scan
Use the `forge_sweep` MCP tool to find TODO/FIXME/HACK markers left near dependency work, version exceptions, or disabled checks.

### 7. Review Findings
For each finding:
- **Critical/High RustSec advisory**: upgrade, patch, or document accepted risk immediately.
- **Yanked crate**: replace or pin to a non-yanked release.
- **Outdated major version**: plan an upgrade with changelog review and compatibility tests.
- **Duplicate version**: consolidate when it affects security-sensitive crates or large transitive trees.
- **License conflict**: flag for human approval before release.

### 8. Report
```text
Dependency Audit Summary:
  Critical RustSec: N advisories
  High RustSec:     N advisories
  Medium/Low:       N advisories

Outdated Crates:
  Major behind:     N (plan upgrade)
  Minor/Patch:      N (update when safe)

Yanked Crates:      N
Duplicate Trees:    N
License Issues:     N
Sweep Markers:      N

Overall: PASS / FAIL
```

## Safety Rules
- NEVER auto-upgrade major versions without human approval.
- ALWAYS read release notes for security-sensitive crates before changing versions.
- Run `cargo test` or `cargo nextest run` after any dependency change.
- Keep application `Cargo.lock` committed; do not delete it to resolve conflicts blindly.
- Document accepted advisories with scope, exploitability, owner, and revisit date.

## Temper Guards

| Shortcut | Why It Breaks |
| --- | --- |
| "The vulnerable crate is transitive" | Transitive code still ships in the binary and can be reachable through public APIs. |
| "A yanked crate compiled, so it is okay" | Yanked releases often indicate correctness or security problems; treat them as release blockers until triaged. |
| "Cargo update everything is faster" | Broad updates mix unrelated risk and make rollback difficult. Prefer targeted upgrades. |
| "Dev dependencies don't ship" | Build scripts and test tools run on developer and CI machines where supply-chain attacks happen. |

## Warning Signs

- `cargo audit` or `cargo deny` failed to run but the report says PASS.
- `Cargo.lock` changed without a clear list of upgraded crates.
- Critical/high advisories have no owner or remediation path.
- License conflicts are marked informational without legal review.
- Duplicate TLS or crypto stacks appear after adding one crate.

## Exit Proof

After completing this skill, confirm:
- [ ] All Cargo package managers/workspaces scanned.
- [ ] `cargo audit`, `cargo deny check`, `cargo outdated`, and `cargo tree --duplicates` were run or explicitly reported unavailable.
- [ ] Every critical/high advisory has a resolution plan.
- [ ] Tests pass after any dependency change.
- [ ] The audit report includes overall PASS/FAIL status.

## Persistent Memory (if OpenBrain is configured)

- **Before auditing**: `search_thoughts("Rust dependency vulnerability", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "bug")`
- **After audit**: `capture_thought("Rust dep audit: <N advisories, N outdated — key findings>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-dependency-audit")`
