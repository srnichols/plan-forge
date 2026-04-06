# Phase 3: CLI Tool & Configuration Parser — Rust Example

> **Status**: 🟡 HARDENED — Ready for execution  
> **Estimated Effort**: 2 days (6 execution slices)  
> **Risk Level**: Low-Medium (structured error handling + config layering)

---

## Overview

Build a CLI tool with Clap for argument parsing and TOML/YAML config file support. Layered configuration (defaults → file → env → flags), structured error reporting with `thiserror`, and comprehensive integration tests.

---

## Prerequisites

- [ ] Phase 2 complete (core library crate structure established)
- [ ] Rust toolchain ≥ 1.75 (edition 2021)
- [ ] `cargo clippy` + `cargo fmt` configured in CI
- [ ] `cargo-nextest` installed for test runner

## Acceptance Criteria

- [ ] CLI parses subcommands: `init`, `run`, `validate`, `status`
- [ ] Config loaded from TOML with env var overrides
- [ ] Structured error types with `thiserror` — no `unwrap()` in library code
- [ ] All public functions documented with `///` doc comments
- [ ] `cargo test` + `cargo clippy -- -D warnings` pass with zero warnings
- [ ] `cargo doc --no-deps` builds cleanly

---

## Execution Slices

### Slice 3.1 — CLI Scaffold: Clap Derive + Config Types
**Build command**: `cargo build`  
**Test command**: `cargo test`

**Tasks**:
1. Add dependencies: `clap` (derive), `serde`, `toml`, `thiserror`
2. Define `Cli` struct with `#[derive(Parser)]` and subcommands
3. Define `Config` struct with `#[derive(Deserialize)]`
4. Unit tests: verify CLI parsing for each subcommand

```rust
use clap::{Parser, Subcommand};
use serde::Deserialize;

#[derive(Parser)]
#[command(name = "forge", about = "Plan execution CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// Path to config file
    #[arg(short, long, default_value = "forge.toml")]
    pub config: PathBuf,
}

#[derive(Subcommand)]
pub enum Commands {
    Init { name: String },
    Run { plan: PathBuf, #[arg(long)] dry_run: bool },
    Validate { plan: PathBuf },
    Status,
}

#[derive(Deserialize)]
pub struct Config {
    pub project_name: String,
    pub default_preset: String,
    pub parallel_slices: usize,
}
```

**Validation Gate**:
```bash
cargo build                                              # zero errors
cargo clippy -- -D warnings                              # zero warnings
cargo test                                               # all pass
grep -rn 'unwrap()' --include="*.rs" src/                # zero in lib code
```

**Stop Condition**: If clippy emits warnings or any `unwrap()` found in library code → STOP.

---

### Slice 3.2 — Error Types: Structured Error Hierarchy
**Build command**: `cargo build`  
**Test command**: `cargo test --lib`

**Tasks**:
1. Create `src/error.rs` with `thiserror::Error` derive
2. Error variants: `ConfigNotFound`, `ConfigParseError`, `PlanValidationError`, `IoError`
3. Implement `From<std::io::Error>` and `From<toml::de::Error>`
4. Use `Result<T, ForgeError>` throughout — no `unwrap()` or `expect()` in lib
5. Unit tests: verify error display messages and conversions

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ForgeError {
    #[error("Config file not found: {path}")]
    ConfigNotFound { path: PathBuf },

    #[error("Failed to parse config: {0}")]
    ConfigParse(#[from] toml::de::Error),

    #[error("Plan validation failed: {reason}")]
    PlanValidation { reason: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
```

---

### Slice 3.3 — Config Loader: Layered Configuration
**Build command**: `cargo build`  
**Test command**: `cargo test --test config_tests`

**Tasks**:
1. Create `src/config.rs` with `load_config(path: &Path) -> Result<Config, ForgeError>`
2. Layer order: hardcoded defaults → TOML file → environment variables
3. Env override prefix: `FORGE_` (e.g., `FORGE_PROJECT_NAME`)
4. Integration tests: verify layering precedence with temp files

---

### Slice 3.4 — Subcommand Handlers: Init + Validate
**Build command**: `cargo build`  
**Test command**: `cargo test`

**Tasks**:
1. `init` — create project directory with `forge.toml` template
2. `validate` — parse plan file, check required sections, report errors
3. Both handlers return `Result<(), ForgeError>` — no panics
4. Unit tests for each handler with mock filesystem (tempdir)

---

### Slice 3.5 — Run + Status Handlers
**Build command**: `cargo build`  
**Test command**: `cargo test`

**Tasks**:
1. `run` — parse plan, execute slices sequentially (stub executor), print progress
2. `status` — read last run state from `.forge/state.json`, display summary
3. `--dry-run` flag: validate plan without executing
4. Integration tests with temp project directory

---

### Slice 3.6 — Documentation & Final Sweep
**Test command**: `cargo test`

**Tasks**:
1. Add `///` doc comments to all public types and functions
2. Verify `cargo doc --no-deps` builds without warnings
3. Run `cargo clippy -- -D warnings` — zero issues
4. Run `cargo fmt --check` — zero formatting issues
5. Final test sweep: `cargo nextest run`

**Validation Gate**:
```bash
cargo build                                              # zero errors
cargo clippy -- -D warnings                              # zero warnings
cargo test                                               # all pass
cargo doc --no-deps                                      # builds cleanly
cargo fmt --check                                        # formatted
grep -rn 'unwrap()\|expect(' --include="*.rs" src/       # zero in lib code
```

---

## Forbidden Actions

- ❌ Do NOT use `unwrap()` or `expect()` in library code — use `?` operator
- ❌ Do NOT use `println!` for user output — use structured logging (`tracing`)
- ❌ Do NOT suppress clippy warnings with `#[allow()]` — fix the code
- ❌ Do NOT add `unsafe` blocks without explicit justification in plan
