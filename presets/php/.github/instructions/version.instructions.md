---
description: Version management — Composer SemVer, conventional commits, release tagging, API sunset policy
applyTo: 'composer.json,composer.lock,CHANGELOG.md,routes/api.php,config/app.php'
---

# Version Management (PHP/Laravel)

## Versioning Scheme

```
MAJOR.MINOR.PATCH
  3  .  7  .  2
```

Use [Semantic Versioning 2.0.0](https://semver.org/) for application releases and Composer package versions.

| Segment | When to Increment | Trigger |
|---------|-------------------|---------|
| **MAJOR** | Breaking API or data contract changes | Manual approval required |
| **MINOR** | Backward-compatible features | `feat:` commit prefix |
| **PATCH** | Fixes, performance, refactors | `fix:`, `perf:`, `refactor:` |

## Commit Message to Version Bump

| Commit Prefix | Version Impact | Example |
|---|---|---|
| `feat:` | MINOR +1 | 3.6.0 → 3.7.0 |
| `fix:` / `perf:` / `refactor:` | PATCH +1 | 3.6.5 → 3.6.6 |
| `docs:` / `chore:` / `test:` / `style:` / `ci:` | No version bump | — |
| `feat!:` / `BREAKING CHANGE:` | MAJOR +1 | 3.6.5 → 4.0.0 |

## Implementation with Composer

```json
{
  "name": "contoso/catalog-api",
  "version": "3.7.2",
  "require": {
    "php": "^8.5",
    "laravel/framework": "^13.34"
  }
}
```

If the application is not distributed as a Composer package, keep the release version in one explicit config value:

```php
<?php

declare(strict_types=1);

return [
    'release' => env('APP_RELEASE', '0.0.0-dev'),
    'commit' => env('GIT_COMMIT_SHA', 'unknown'),
];
```

## Automated Versioning

Use a conventional-commit release tool or a CI step that edits only the single source of truth:

```bash
composer validate --strict
composer outdated --direct
composer audit
```

Rules:

- Never edit multiple version strings by hand.
- Always tag releases with `vMAJOR.MINOR.PATCH`.
- MAJOR bumps require explicit approval and migration notes.
- Dependency bumps must include `composer.lock` updates from Composer.
- Runtime version endpoints should read config, not parse Git output at request time.

## Version Endpoint

```php
<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;

Route::get('/v1/version', static fn (): array => [
    'version' => (string) config('release.release'),
    'commit' => (string) config('release.commit'),
    'environment' => (string) config('app.env'),
]);
```

## Git Tag Workflow

```bash
git tag -a v3.7.0 -m "Release 3.7.0: catalog import"
git push origin v3.7.0
```

## Changelog Format

```markdown
## [3.7.0] - 2026-01-15
### Features
- Order creation endpoint (#142)
- Tenant-scoped cursor pagination for catalog queries (#138)
### Bug Fixes
- Prevent duplicate order numbers during concurrent checkout (#145)
### Dependencies
- Upgrade Laravel framework constraint to ^13.34 (#140)
```

Rules:

- Generate changelog entries from conventional commits before tagging.
- Link issue or PR numbers in entries for traceability.
- Note migrations, queue changes, and API deprecations under a visible heading.

## Pre-release Versioning

Composer accepts SemVer pre-release identifiers:

```
3.7.0-alpha.1
3.7.0-beta.1
3.7.0-rc.1
3.7.0
```

```json
{
  "version": "3.7.0-rc.1",
  "minimum-stability": "stable",
  "prefer-stable": true
}
```

Rules:

- Do not deploy alpha, beta, or RC builds to production.
- Stage RC builds with production-like config and migrations.
- Tag pre-releases immutably; do not reuse a tag after validation fails.

## API Version Deprecation Timeline

Coordinate release versions with route versions from `api-patterns.instructions.md`:

| Phase | Timeline | Action |
|-------|----------|--------|
| **Announce** | v(N+1) release | Add `Sunset` header to v(N), update docs |
| **Warn** | +3 months | Log consumer warnings and notify owners |
| **Deprecate** | +6 months | Return `Deprecation` header and lower rate limits if needed |
| **Remove** | +12 months | Return `410 Gone` for v(N) endpoints |

### Deprecation Middleware

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AddApiDeprecationHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if ($request->is('api/v1/*')) {
            $response->headers->set('Sunset', 'Sat, 01 Jan 2027 00:00:00 GMT');
            $response->headers->set('Deprecation', 'true');
            $response->headers->set('Link', '</api/v2/docs>; rel="successor-version"');
        }

        return $response;
    }
}
```

## See Also

- `api-patterns.instructions.md` — URL versioning and route contracts
- `deploy.instructions.md` — Release gates and container rollout
- `testing.instructions.md` — Pre-release validation checklist
