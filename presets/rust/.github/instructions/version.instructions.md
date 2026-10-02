---
description: Version management — Semantic versioning, Cargo metadata, release tagging, API deprecation
applyTo: '**/Cargo.toml,**/Cargo.lock'
---

# Version Management (Rust)

## Versioning Scheme

```
MAJOR.MINOR.PATCH
  3  .  7  .  2
```

Use [Semantic Versioning 2.0.0](https://semver.org/) for crates and service releases.

| Segment | When to Increment | Trigger |
|---------|-------------------|---------|
| **MAJOR** | Breaking API or data contract changes | Manual approval required |
| **MINOR** | Backward-compatible features | `feat:` commit prefix |
| **PATCH** | Bug fixes, performance, refactors | `fix:` / `perf:` / `refactor:` prefix |

## Commit Message → Version Bump

| Commit Prefix | Version Impact | Example |
|---|---|---|
| `feat:` | MINOR +1 | 3.6.0 → 3.7.0 |
| `fix:` / `perf:` / `refactor:` | PATCH +1 | 3.6.5 → 3.6.6 |
| `docs:` / `chore:` / `test:` / `style:` / `ci:` | No version bump | — |
| `feat!:` / `BREAKING CHANGE:` | MAJOR +1 | 3.6.5 → 4.0.0 |

## Implementation with Cargo

```toml
[package]
name = "contoso-api"
version = "3.7.2"
edition = "2024"
rust-version = "1.98"
```

For workspaces, keep package versions explicit unless the repository has adopted `[workspace.package]` intentionally.

```toml
[workspace.package]
version = "3.7.2"
edition = "2024"
rust-version = "1.98"
```

## Automated Versioning

```bash
cargo install cargo-edit
cargo set-version 3.8.0
cargo build --locked
```

CI can derive the next version from conventional commits, update `Cargo.toml`, regenerate `Cargo.lock`, and tag the release.

## Version Endpoint

```rust
#[derive(serde::Serialize)]
pub struct VersionResponse {
    pub version: &'static str,
    pub environment: String,
    pub commit: String,
}

pub async fn version(
    axum::extract::State(state): axum::extract::State<crate::state::AppState>,
) -> axum::Json<VersionResponse> {
    axum::Json(VersionResponse {
        version: env!("CARGO_PKG_VERSION"),
        environment: format!("{:?}", state.settings.environment),
        commit: std::env::var("GIT_COMMIT_SHA").unwrap_or_else(|_| "unknown".to_owned()),
    })
}
```

## Rules

- Do not hand-edit release versions during normal development; use the release tool or CI job.
- Keep `Cargo.lock` committed for applications and services.
- Use conventional commit prefixes to drive version bumps.
- Tag releases as `vMAJOR.MINOR.PATCH`.
- MAJOR bumps require explicit approval and migration notes.
- Keep runtime version endpoints sanitized: never include secrets or raw environment dumps.

## Git Tag Workflow

```bash
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
```

## Changelog Generation

Generate changelogs from conventional commits.

```bash
git cliff --tag v3.7.0 --output CHANGELOG.md
```

### Changelog Format

```markdown
## [3.7.0] - 2026-01-15
### Features
- Added producer bulk import endpoint (#142)
- Added tenant-scoped caching for catalog queries (#138)
### Bug Fixes
- Fixed race condition in order processing (#145)
### Dependencies
- Updated Axum to 0.8.9 (#140)
```

### Rules
- Generate or update the changelog before tagging.
- Link issue or PR numbers in entries for traceability.
- Include database and API compatibility notes for any migration-bearing release.

## Pre-release Versioning

Use SemVer pre-release identifiers:

```
3.7.0-alpha.1
3.7.0-beta.1
3.7.0-rc.1
3.7.0
```

```toml
[package]
version = "3.7.0-rc.1"
```

```bash
cargo publish --dry-run
```

### Rules
- Pre-release builds deploy only to non-production environments.
- Treat release candidate artifacts as immutable.
- Do not use mutable `latest` container tags as deployment inputs.

## API Version Deprecation Timeline

Coordinate API deprecation with `api-patterns.instructions.md`.

| Phase | Timeline | Action |
|-------|----------|--------|
| **Announce** | v(N+1) release | Add `Sunset` header to v(N), update OpenAPI |
| **Warn** | +3 months | Log warnings for v(N) consumers |
| **Deprecate** | +6 months | Return `Deprecation` header |
| **Remove** | +12 months | Return `410 Gone` for v(N) endpoints |

### Deprecation Header Layer

```rust
use axum::{body::Body, http::Response};
use tower_http::set_header::SetResponseHeaderLayer;

pub fn deprecation_layer() -> SetResponseHeaderLayer<http::HeaderValue> {
    SetResponseHeaderLayer::overriding(
        http::header::HeaderName::from_static("deprecation"),
        http::HeaderValue::from_static("true"),
    )
}

pub fn attach_successor_link(mut response: Response<Body>) -> Response<Body> {
    response.headers_mut().insert(
        http::header::LINK,
        http::HeaderValue::from_static("</api/v2/docs>; rel=\"successor-version\""),
    );
    response
}
```

## See Also

- `api-patterns.instructions.md` — API versioning strategy
- `deploy.instructions.md` — Release to production
- `testing.instructions.md` — Pre-release validation checklist
