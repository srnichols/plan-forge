---
description: Version management — Semantic versioning, auto-increment, commit-driven version bumps, release tagging
applyTo: '**/go.mod,**/version.go'
---

# Version Management (Go)

## Versioning Scheme

```
MAJOR.MINOR.PATCH
  3  .  7  .  2
```

Go modules use [Semantic Versioning 2.0.0](https://semver.org/) with special import path rules for v2+.

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

```go
// internal/version/version.go
package version

var (
    Version   = "dev"     // Set via -ldflags
    Commit    = "unknown"
    BuildDate = "unknown"
)
```

```bash
# Build with version info injected
go build -ldflags "-X internal/version.Version=3.7.2 \
  -X internal/version.Commit=$(git rev-parse --short HEAD) \
  -X internal/version.BuildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o bin/server ./cmd/server
```

### Go Module Versioning (v2+)

```
# go.mod — MAJOR v2+ requires /v2 suffix in module path
module github.com/contoso/api-service/v4

# Import path must match:
import "github.com/contoso/api-service/v4/pkg/auth"
```

## Version Endpoint

```go
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
- **ALWAYS** use `v` prefix on Git tags: `v3.7.0` (Go toolchain requires it)
- MAJOR bumps change the module import path (`/v2`, `/v3`, etc.)
- Use `goreleaser` for cross-platform builds and GitHub releases
- Store version in `internal/version/` — never in `go.mod` comments

## Git Tag Workflow

```bash
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
```

## See Also

- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
