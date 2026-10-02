---
description: PHP/Laravel deployment patterns — PHP-FPM app image, nginx front door, queues, migrations, health checks, and container-safe config.
applyTo: '**/Dockerfile,**/docker-compose*.yml,**/compose*.yml,**/.dockerignore,**/nginx/**,**/deploy/**,**/k8s/**'
---

# PHP Deployment Patterns

## Production container design

Use **php-fpm + nginx** as the standard production design:

- The application image is built from `php:8.5-fpm-alpine` and runs Laravel under PHP-FPM.
- nginx is the HTTP front door and forwards `.php` requests to the FPM service on port 9000.
- The same application image is reused for web, queue worker, scheduler, and one-off migration tasks.
- This design matches Laravel's process model and keeps the web server configuration explicit.

FrankenPHP (with Laravel Octane) is a valid alternative. If you adopt it, change every place that assumes PHP-FPM together: the Dockerfile, compose services, health checks, and the extension and cache-warmup steps below.

## Dockerfile contract

The application Dockerfile must:

- Use `composer:2` for the vendor stage and `php:8.5-fpm-alpine` for runtime.
- Run `composer install --no-dev --prefer-dist --no-scripts --no-autoloader` before copying the full source tree.
- Copy the application, then run `composer dump-autoload --optimize --no-dev`.
- Remove or exclude `bootstrap/cache/*.php` before optimized autoload discovery so dev-only package discovery from local builds is not copied into the production image.
- Install build libraries `icu-dev` and `libpq-dev` only in a virtual package, then remove them.
- Keep runtime libraries `icu-libs` and `libpq`.
- Install `intl` and `pdo_pgsql`; do **not** install `opcache` because it is built into PHP 8.5 images.
- Use `COPY --chown=www-data:www-data`.
- Run `php artisan optimize` in the entrypoint, not at image build time.
- Run as `www-data`.

Minimal entrypoint behavior: exit on errors, cache config/routes/views, run `php artisan optimize`, and finally `exec "$@"` so PHP-FPM receives signals directly. The full scaffold appears in the Dockerfile prompt.

## Docker Compose

Use the same application image for `app`, `queue`, `scheduler`, and `migrate`. PostgreSQL and Redis tags are pinned for this PHP stack.

```yaml
services:
  web:
    image: nginx:1.29-alpine
    ports:
      - "8080:80"
    volumes:
      - ./public:/var/www/html/public:ro
      - ./deploy/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      app:
        condition: service_healthy

  app:
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    environment:
      APP_ENV: production
      LOG_CHANNEL: stderr
      LOG_STDERR_FORMATTER: 'Monolog\Formatter\JsonFormatter'
      DB_CONNECTION: pgsql
      DB_HOST: postgres
      REDIS_HOST: redis
      QUEUE_CONNECTION: redis
    healthcheck:
      test: ["CMD-SHELL", "php artisan about --only=environment >/dev/null && php artisan route:list --path=up >/dev/null"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  queue:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["php", "artisan", "queue:work", "redis", "--sleep=3", "--tries=3", "--timeout=90"]
    env_file: .env
    depends_on:
      app:
        condition: service_healthy

  scheduler:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["php", "artisan", "schedule:work"]
    env_file: .env
    depends_on:
      app:
        condition: service_healthy

  migrate:
    build:
      context: .
      dockerfile: Dockerfile
    command: ["php", "artisan", "migrate", "--force"]
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres-data:
```

## nginx front door

```nginx
server {
    listen 80;
    server_name _;
    root /var/www/html/public;
    index index.php;

    location /up {
        try_files $uri /index.php?$query_string;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ ^/index\.php(/|$) {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $realpath_root/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
        fastcgi_param DOCUMENT_ROOT $realpath_root;
        fastcgi_pass app:9000;
    }

    location ~ ^/(?!index\.php).+\.php$ {
        return 404;
    }
}
```

## Build and release commands

| Command | Purpose |
|---------|---------|
| `composer install` | Install dependencies for local validation |
| `php artisan test` | Run PHPUnit 13 tests |
| `vendor/bin/phpstan analyse` | Run Larastan at the configured level |
| `vendor/bin/pint --test` | Verify PER formatting |
| `php artisan migrate --pretend` | Preview migration SQL |
| `php artisan migrate --force` | Apply migrations in deployed environments |
| `docker compose up -d --build` | Build and start local stack |

## Health and readiness

Laravel 13 ships `/up` for liveness. Add a readiness route that checks real dependencies before accepting traffic:

```php
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/ready', function () {
    $checks = [];

    try {
        DB::select('select 1');
        $checks['database'] = 'ok';
    } catch (\Throwable) {
        $checks['database'] = 'unavailable';
    }

    try {
        Cache::store('redis')->put('readiness', true, 10);
        $checks['redis'] = 'ok';
    } catch (\Throwable) {
        $checks['redis'] = 'unavailable';
    }

    if (in_array('unavailable', $checks, true)) {
        return response()->json(['status' => 'down', 'checks' => $checks], 503);
    }

    return response()->json(['status' => 'ready', 'checks' => $checks]);
});
```

Kubernetes probes should call `/up` for liveness and `/ready` for readiness. Do not use a database check as liveness; a short database outage should remove the pod from service, not restart PHP-FPM.

## Migration deployment

Use expand-contract migrations and run migrations before routing traffic to the new image:

1. Build image.
2. Run `php artisan test`, Larastan, Pint, and `composer audit`.
3. Run `php artisan migrate --pretend` and review SQL in CI.
4. Run `php artisan migrate --force` as a one-off task.
5. Deploy `app`, `queue`, and `scheduler`.
6. Verify `/up`, `/ready`, a version endpoint, and one authenticated smoke route.

## Graceful shutdown

- Set `stop_grace_period` or Kubernetes `terminationGracePeriodSeconds` above the longest queue job timeout.
- Queue workers must run with `--timeout` below the orchestrator kill window.
- Send `php artisan queue:restart` during deployments so old workers drain and exit.
- Never deploy code that requires a destructive schema change before all workers understand the old and new schema.

## See Also

- `database.instructions.md` — migration safety and repository patterns
- `observability.instructions.md` — logs, traces, metrics, and readiness signals
- `security.instructions.md` — secrets, auth, and boundary validation
