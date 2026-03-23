---
description: Version management — Semantic versioning, auto-increment, commit-driven version bumps, release tagging
applyTo: '**/package.json'
---

# Version Management (TypeScript/Node.js)

## Versioning Scheme

```
MAJOR.MINOR.PATCH
  3  .  7  .  2
```

Uses [Semantic Versioning 2.0.0](https://semver.org/):

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

## Implementation with package.json

```json
{
  "name": "@contoso/api-service",
  "version": "3.7.2"
}
```

## Automated Versioning Tools

```bash
# standard-version (conventional-changelog based)
npx standard-version              # Auto-detect bump from commits
npx standard-version --release-as minor  # Force minor bump

# Or use semantic-release for full CI automation
# .releaserc.json configures branches, plugins, changelog
```

## Version Endpoint

```typescript
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

app.get('/api/version', (_, res) => res.json({
  version: pkg.version,
  name: pkg.name,
  environment: config.NODE_ENV,
  commit: process.env.GIT_COMMIT_SHA ?? 'unknown',
}));
```

## Rules

- **NEVER** manually edit `version` in `package.json` — use tooling
- **ALWAYS** use conventional commit prefixes to drive version bumps
- **ALWAYS** tag releases: `git tag v3.7.0` after MINOR/MAJOR bumps
- MAJOR bumps require explicit approval in CI pipeline
- Use `npm version` or `standard-version` for consistent bumps
- Lock files (`package-lock.json`) must be committed

## Git Tag Workflow

```bash
# standard-version auto-tags, or manually:
git tag -a v3.7.0 -m "Release 3.7.0: feature description"
git push origin v3.7.0
```

## See Also

- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```
