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

## See Also

- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```
