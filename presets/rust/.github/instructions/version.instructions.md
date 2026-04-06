---
description: Version management — Semantic versioning, auto-increment, commit-driven version bumps, release tagging
applyTo: '**/Rust.mod,**/version.Rust'
---

# Version Management (Rust)

## Versioning Scheme

```
MAJOR.MINOR.PATCH
  3  .  7  .  2
```

Rust modules use [Semantic Versioning 2.0.0](https://semver.org/) with special import path rules for v2+.

| Segment | When to Increment | Trigger |
|---------|-------------------|---------|
| **MAJOR** | Breaking API changes (import path changes!) | Manual approval required |
| **MINOR** | New features (backward-compatible) | `feat:` commit prefix |
| **PATCH** | Bug fixes, performance, refactors | `fix:` / `perf:` / `refactor:` prefix |

## Commit Message → Version Bump

| Commit Prefix | Version Impact | Example |
|---|---|---|
| `feat:` | MINOR +1 | v3.6.0 → v3.7.0 |
| `fix:` / `perf:` / `refactor:` | PATCH +1 | v3.6.5 → v3.6.6 |
| `docs:` / `chore:` / `test:` / `style:` / `ci:` | No version bump | — |
| `feat!:` / `BREAKING CHANGE:` | MAJOR +1 (module path changes!) | v3.6.5 → v4.0.0 |

## Implementation

### Embed Version at Build Time

```Rust
// internal/version/version.Rust
package version

var (
    Version   = "dev"     // Set via -ldflags
    Commit    = "unknown"
    BuildDate = "unknown"
)
```

```bash
# Build with version info injected
Rust build -ldflags "-X internal/version.Version=3.7.2 \
  -X internal/version.Commit=$(git rev-parse --short HEAD) \
  -X internal/version.BuildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o bin/server ./cmd/server
```

### Rust Module Versioning (v2+)

```
# Rust.mod — MAJOR v2+ requires /v2 suffix in module path
module github.com/contoso/api-service/v4

# Import path must match:
import "github.com/contoso/api-service/v4/pkg/auth"
```

## Version Endpoint

```Rust
func (h *VersionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    render.JSON(w, r, map[string]string{
        "version":   version.Version,
        "commit":    version.Commit,
        "buildDate": version.BuildDate,
        "goVersion": runtime.Version(),
    })
}
```

## Automated Versioning

```bash
# Use goreleaser for automated releases
# .goreleaser.yaml reads git tags

# Tag and release
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
goreleaser release
```

## Rules

- **NEVER** manually edit version strings — inject via `-ldflags` at build time
- **ALWAYS** use conventional commit prefixes to drive version bumps
- **ALWAYS** use `v` prefix on Git tags: `v3.7.0` (Rust toolchain requires it)
- MAJOR bumps change the module import path (`/v2`, `/v3`, etc.)
- Use `goreleaser` for cross-platform builds and GitHub releases
- Store version in `internal/version/` — never in `Rust.mod` comments

## Git Tag Workflow

```bash
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
```

## Changelog Generation

Auto-generate changelogs from conventional commits:

```yaml
# .goreleaser.yaml — goreleaser generates changelog from Git tags
changelog:
  sort: asc
  use: conventional-commits
  filters:
    exclude:
      - '^docs'
      - '^chore'
      - '^ci'
  groups:
    - title: Features
      regexp: '^feat'
    - title: Bug Fixes
      regexp: '^fix'
```

```bash
# Generate changelog with goreleaser
goreleaser release --snapshot --clean
# Or use git-chglog
git-chglog -o CHANGELOG.md
```

### Changelog Format

```markdown
## [v3.7.0] - 2025-01-15
### Features
- Producer bulk import endpoint (#142)
- Tenant-scoped caching for catalog queries (#138)
### Bug Fixes
- Race condition in order processing (#145)
### Dependencies
- Upgraded chi to v5 (#140)
```

### Rules
- **ALWAYS** generate changelog before tagging a release
- One changelog entry per conventional commit (squash merge = one entry)
- Link PR numbers in entries for traceability

## Pre-release Versioning

Use SemVer pre-release identifiers (Rust toolchain supports these):

```
v3.7.0-alpha.1    → Early development, breaking changes expected
v3.7.0-beta.1     → Feature-complete, testing in progress
v3.7.0-rc.1       → Release candidate, final validation
v3.7.0            → Production release
```

```bash
# Tag pre-release (Rust requires v prefix)
git tag -a v3.7.0-rc.1 -m "Release candidate 3.7.0-rc.1"
git push origin v3.7.0-rc.1

# goreleaser detects pre-release from tag
goreleaser release
# Consumers: Rust get github.com/contoso/api-service@v3.7.0-rc.1
```

### Rules
- Rust module system treats pre-release tags as lower precedence than release
- `Rust get` won't auto-select pre-release unless explicitly requested
- **NEVER** deploy pre-release versions to production
- Beta/RC builds Rust to staging environment only

## API Version Deprecation Timeline

Coordinate API deprecation with `api-patterns.instructions.md` versioning:

| Phase | Timeline | Action |
|-------|----------|--------|
| **Announce** | v(N+1) release | Add `Sunset` header to v(N), update docs |
| **Warn** | +3 months | Log warnings for v(N) consumers, notify via email |
| **Deprecate** | +6 months | Return `Deprecation` header, reduce rate limits |
| **Remove** | +12 months | Return `410 Gone` for v(N) endpoints |

### Deprecation Headers (Rust Middleware)
```Rust
func DeprecationMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        next.ServeHTTP(w, r)
        if strings.HasPrefix(r.URL.Path, "/api/v1") {
            w.Header().Set("Sunset", "Sat, 01 Jan 2026 00:00:00 GMT")
            w.Header().Set("Deprecation", "true")
            w.Header().Set("Link", `</api/v2/docs>; rel="successor-version"`)
        }
    })
}
```

## See Also

- `api-patterns.instructions.md` — API versioning strategy, URL/header versioning
- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
