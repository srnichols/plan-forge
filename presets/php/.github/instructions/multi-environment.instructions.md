---
description: Multi-environment configuration — Laravel environment files, config validation, deploy-safe settings
applyTo: 'config/**/*.php,.env*,bootstrap/app.php'
---

# Multi-Environment Configuration (PHP/Laravel)

## Environment Hierarchy

| Environment | Purpose | Config Source | Detection |
|-------------|---------|---------------|-----------|
| `local` | Developer machines | `.env`, `.env.local` | `APP_ENV=local` |
| `testing` | Automated tests | `.env.testing` | `APP_ENV=testing` |
| `staging` | Pre-production validation | runtime env vars | `APP_ENV=staging` |
| `production` | Live traffic | runtime env vars / secret store | `APP_ENV=production` |

## Configuration Loading Order

```
config/*.php defaults        ← Committed, no secrets
.env.example                 ← Document required keys, no secret values
.env / .env.testing          ← Local or test-only values
Environment variables        ← Infrastructure overrides
Secret manager               ← Production secrets
```

## Rules

- Never commit `.env` with secrets; commit `.env.example` only.
- Never read environment variables outside config files after bootstrap.
- Always access settings through `config('section.key')`.
- Always validate critical config at startup or in a health check.
- Keep `APP_DEBUG=false` in production.
- Do not run `php artisan config:cache` until all runtime env vars are present.

## Typed Access Through Config

```php
<?php

declare(strict_types=1);

return [
    'environment' => env('APP_ENV', 'local'),
    'public_url' => env('APP_URL', 'http://localhost'),
    'orders' => [
        'timeout_seconds' => (int) env('BILLING_TIMEOUT_SECONDS', 30),
        'retry_count' => (int) env('BILLING_RETRY_COUNT', 3),
    ],
];
```

Use a small value object when configuration is consumed by services:

```php
<?php

declare(strict_types=1);

namespace App\Support\Config;

final readonly class BillingClientConfig
{
    public function __construct(
        public string $baseUrl,
        public int $timeoutSeconds,
        public int $retryCount,
    ) {
        if ($this->baseUrl === '') {
            throw new \InvalidArgumentException('Billing base URL is required.');
        }
    }

    public static function fromConfig(): self
    {
        return new self(
            baseUrl: (string) config('services.billing.base_url'),
            timeoutSeconds: (int) config('app_settings.billing.timeout_seconds'),
            retryCount: (int) config('app_settings.billing.retry_count'),
        );
    }
}
```

## Per-Environment Settings

```bash
# .env.example
APP_ENV=local
APP_DEBUG=false
APP_URL=http://localhost
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=app
DB_USERNAME=
DB_PASSWORD=
REDIS_HOST=127.0.0.1
BILLING_TIMEOUT_SECONDS=30
BILLING_RETRY_COUNT=3
```

Production overrides should be injected by the platform:

```bash
APP_ENV=production
APP_DEBUG=false
APP_URL=https://api.example.com
LOG_CHANNEL=stderr
LOG_STDERR_FORMATTER=Monolog\Formatter\JsonFormatter
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis
CACHE_STORE=redis
```

## Environment-Conditional Code

```php
<?php

declare(strict_types=1);

use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Route;

if (App::environment('local')) {
    Route::get('/dev/preview-mail', App\Http\Controllers\Dev\MailPreviewController::class);
}
```

Prefer environment-specific service providers or config values over scattered checks.

## Health Checks

Laravel exposes liveness at `/up`; add a separate readiness route at `/ready` that returns 503 when a dependency is down.

```php
<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Route;

Route::get('/ready', function () {
    try {
        DB::select('select 1');
        Redis::connection()->ping();

        return response()->json(['status' => 'ok', 'database' => true, 'redis' => true]);
    } catch (Throwable) {
        return response()->json(['status' => 'degraded', 'database' => false, 'redis' => false], 503);
    }
});
```

## Database Migrations Per Environment

| Environment | Migration Strategy | Who Runs | Approval |
|-------------|--------------------|----------|---------|
| `local` | `php artisan migrate` | Developer | None |
| `testing` | `php artisan migrate --env=testing` | Test bootstrap / CI | Automatic |
| `staging` | `php artisan migrate --force` | Pipeline | Automatic after tests |
| `production` | Reviewed migration plan, then `--force` | Pipeline | Manual approval |

Use these checks before production migration:

```bash
php artisan migrate --pretend
php artisan migrate:status
php artisan route:list --path=v1
```

## See Also

- `database.instructions.md` — Expand-contract migration strategy
- `deploy.instructions.md` — Container config and entrypoint rules
- `observability.instructions.md` — Per-environment logging and metrics
- `security.instructions.md` — Secret handling and auth configuration
