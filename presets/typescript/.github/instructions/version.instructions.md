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

## Changelog Generation

Auto-generate changelogs from conventional commits:

```bash
# standard-version generates CHANGELOG.md automatically
npx standard-version           # Auto-detect bump + changelog
npx standard-version --dry-run # Preview without writing

# Or with semantic-release (fully automated in CI)
# .releaserc.json:
{
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/git"
  ]
}
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
- Upgraded express to v5 (#140)
```

### Rules
- **ALWAYS** generate changelog before tagging a release
- One changelog entry per conventional commit (squash merge = one entry)
- Link PR numbers in entries for traceability

## Pre-release Versioning

Use SemVer pre-release identifiers for non-production builds:

```
3.7.0-alpha.1    → Early development, breaking changes expected
3.7.0-beta.1     → Feature-complete, testing in progress
3.7.0-rc.1       → Release candidate, final validation
3.7.0            → Production release
```

```bash
# Bump to pre-release
npm version 3.7.0-alpha.1
npx standard-version --prerelease alpha

# Publish pre-release to npm
npm publish --tag next   # Consumers: npm install @contoso/api@next
```

### Rules
- Pre-release tags sort correctly: `alpha.1 < beta.1 < rc.1 < release`
- **NEVER** deploy pre-release versions to production
- Use `--tag next` for npm to avoid making pre-release the `latest` tag
- Beta/RC builds go to staging environment only

## API Version Deprecation Timeline

Coordinate API deprecation with `api-patterns.instructions.md` versioning:

| Phase | Timeline | Action |
|-------|----------|--------|
| **Announce** | v(N+1) release | Add `Sunset` header to v(N), update docs |
| **Warn** | +3 months | Log warnings for v(N) consumers, notify via email |
| **Deprecate** | +6 months | Return `Deprecation` header, reduce rate limits |
| **Remove** | +12 months | Return `410 Gone` for v(N) endpoints |

### Deprecation Headers (Express)
```typescript
// Middleware for deprecated API versions
function deprecationHeaders(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/v1')) {
    res.set('Sunset', 'Sat, 01 Jan 2026 00:00:00 GMT');
    res.set('Deprecation', 'true');
    res.set('Link', '</api/v2/docs>; rel="successor-version"');
  }
  next();
}
app.use(deprecationHeaders);
```

## See Also

- `api-patterns.instructions.md` — API versioning strategy, URL/header versioning
- `frontend.instructions.md` — UI version display, build-time version injection
- `deploy.instructions.md` — Release to production, container config
- `testing.instructions.md` — Pre-release validation checklist
```
