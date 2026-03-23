---
description: Version management — Semantic versioning, auto-increment, commit-driven version bumps, release tagging
applyTo: '**/pyproject.toml,**/setup.cfg'
---

# Version Management (Python)

## Versioning Scheme

```
MAJOR.MINOR.PATCH
  3  .  7  .  2
```

Uses [Semantic Versioning 2.0.0](https://semver.org/) via [PEP 440](https://peps.python.org/pep-0440/):

| Segment | When to Increment | Trigger |
|---------|-------------------|---------|
| **MAJOR** | Breaking API changes | Manual approval required |
| **MINOR** | New features (backward-compatible) | `feat:` commit prefix |
| **PATCH** | Bug fixes, performance, refactors | `fix:` / `perf:` / `refactor:` prefix |

## Commit Message → Version Bump

| Commit Prefix | Version Impact | Example |
|---|---|---|
| `feat:` | MINOR +1 | 3.6.0 → 3.7.0 |
| `fix:` / `perf:` / `refactor:` | PATCH +1 | 3.6.5 → 3.6.6 |
| `docs:` / `chore:` / `test:` / `style:` / `ci:` | No version bump | — |
| `feat!:` / `BREAKING CHANGE:` | MAJOR +1 | 3.6.5 → 4.0.0 |

## Implementation with pyproject.toml

```toml
[project]
name = "contoso-api"
version = "3.7.2"

# Or use dynamic versioning
[tool.setuptools.dynamic]
version = {attr = "contoso_api.__version__"}
```

## Automated Versioning

```bash
# python-semantic-release (reads conventional commits)
pip install python-semantic-release

# pyproject.toml config
[tool.semantic_release]
version_toml = ["pyproject.toml:project.version"]
branch = "main"
commit_message = "chore(release): v{version}"
```

## Version Endpoint

```python
from importlib.metadata import version as pkg_version

@app.get("/api/version")
async def get_version():
    return {
        "version": pkg_version("contoso-api"),
        "environment": settings.app_env,
        "commit": os.getenv("GIT_COMMIT_SHA", "unknown"),
    }
```

## Rules

- **NEVER** manually edit version strings — use `python-semantic-release` or `bump2version`
- **ALWAYS** use conventional commit prefixes to drive version bumps
- **ALWAYS** tag releases: `git tag v3.7.0`
- MAJOR bumps require explicit approval
- Single source of truth for version: `pyproject.toml`
- CI reads commit history and auto-bumps

## Git Tag Workflow

```bash
# semantic-release auto-tags, or manually:
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
```

## Changelog Generation

Auto-generate changelogs from conventional commits:

```bash
# python-semantic-release generates changelog automatically
pip install python-semantic-release
semantic-release changelog

# pyproject.toml config:
[tool.semantic_release.changelog]
changelog_file = "CHANGELOG.md"
exclude_commit_patterns = ["^chore", "^ci"]
```

### Changelog Format

```markdown
## [3.7.0] - 2025-01-15
### Features
- Producer bulk import endpoint (#142)
- Tenant-scoped caching for catalog queries (#138)
### Bug Fixes
- Race condition in order processing (#145)
### Dependencies
- Upgraded FastAPI to 0.115 (#140)
```

### Rules
- **ALWAYS** generate changelog before tagging a release
- One changelog entry per conventional commit (squash merge = one entry)
- Link PR numbers in entries for traceability

## Pre-release Versioning

Use SemVer pre-release identifiers following [PEP 440](https://peps.python.org/pep-0440/):

```
3.7.0a1     → Alpha (PEP 440 format, equivalent to 3.7.0-alpha.1)
3.7.0b1     → Beta
3.7.0rc1    → Release candidate
3.7.0       → Production release
```

```toml
# pyproject.toml
[project]
version = "3.7.0rc1"

# python-semantic-release config
[tool.semantic_release]
prerelease = true
prerelease_tag = "rc"
```

```bash
# Publish pre-release to PyPI
pip install twine
twine upload dist/* --repository testpypi  # Test first
# Consumers: pip install contoso-api==3.7.0rc1
```

### Rules
- Use PEP 440 pre-release format: `a1`, `b1`, `rc1` (not `-alpha.1`)
- **NEVER** deploy pre-release versions to production
- Beta/RC builds go to staging environment only

## API Version Deprecation Timeline

Coordinate API deprecation with `api-patterns.instructions.md` versioning:

| Phase | Timeline | Action |
|-------|----------|--------|
| **Announce** | v(N+1) release | Add `Sunset` header to v(N), update docs |
| **Warn** | +3 months | Log warnings for v(N) consumers, notify via email |
| **Deprecate** | +6 months | Return `Deprecation` header, reduce rate limits |
| **Remove** | +12 months | Return `410 Gone` for v(N) endpoints |

### Deprecation Headers (FastAPI)
```python
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

class DeprecationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        if request.url.path.startswith("/api/v1"):
            response.headers["Sunset"] = "Sat, 01 Jan 2026 00:00:00 GMT"
            response.headers["Deprecation"] = "true"
            response.headers["Link"] = '</api/v2/docs>; rel="successor-version"'
        return response

app.add_middleware(DeprecationMiddleware)
```

## See Also

- `api-patterns.instructions.md` — API versioning strategy, URL/header versioning
- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```
