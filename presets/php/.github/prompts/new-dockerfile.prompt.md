---
description: "Scaffold a production Dockerfile for Laravel 13 using PHP 8.5 FPM, Composer 2, nginx sidecar compose, health checks, and queue workers."
agent: "agent"
tools: [read, edit, search, execute]
---
# Create New Dockerfile

Scaffold the standard PHP deployment design: **php-fpm application image plus nginx sidecar**.

## Required application Dockerfile

```dockerfile
FROM composer:2 AS build
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-scripts --no-autoloader
COPY . .
RUN rm -f bootstrap/cache/*.php \
    && composer dump-autoload --optimize --no-dev

FROM php:8.5-fpm-alpine AS runtime
WORKDIR /var/www/html

RUN apk add --no-cache icu-libs libpq bash \
    && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS icu-dev libpq-dev \
    && docker-php-ext-install intl pdo_pgsql \
    && apk del .build-deps

COPY --from=build --chown=www-data:www-data /app .
RUN chmod +x docker/entrypoint.sh \
    && chown -R www-data:www-data storage bootstrap/cache

USER www-data
EXPOSE 9000
ENTRYPOINT ["docker/entrypoint.sh"]
CMD ["php-fpm"]
```

## Required entrypoint

```sh
#!/bin/sh
set -eu

php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan optimize

exec "$@"
```

## Required .dockerignore

```dockerignore
.git
.github
.env
.env.*
node_modules
storage/logs/*
storage/framework/cache/*
storage/framework/sessions/*
storage/framework/views/*
bootstrap/cache/*.php
vendor
Dockerfile*
docker-compose*.yml
```

## Required compose services

The generated compose file must include:

- `web`: `nginx:1.29-alpine`, serving `public/` and forwarding PHP to `app:9000`
- `app`: the Dockerfile above, with `/up` liveness and an artisan readiness command
- `queue`: same image, `php artisan queue:work redis --sleep=3 --tries=3 --timeout=90`
- `scheduler`: same image, `php artisan schedule:work`
- `postgres`: `postgres:18-alpine`, volume mounted at `/var/lib/postgresql`
- `redis`: `redis:8-alpine`

## Adaptation checklist

When creating files, set:

- The compose service names that match the project (`web`, `app`, `queue`, `scheduler` by default).
- The host port nginx exposes for local development.
- The local PostgreSQL database name, username, and password.
- The registry and immutable image tag only if the project already publishes images.

## Rules

- Use PHP-FPM plus nginx, matching `deploy.instructions.md`; switching to Apache or FrankenPHP is a project-wide decision, not a per-Dockerfile one.
- Do not run `php artisan optimize` during image build.
- Do not install `opcache`; PHP 8.5 already includes it.
- Do not copy secrets or `.env` into the image.
- Keep `COPY --chown=www-data:www-data` on application files.
- Use `php artisan migrate --force` as a separate release step, not as the web container command.

## Reference Files

- [Deploy patterns](../instructions/deploy.instructions.md)
- [Security instructions](../instructions/security.instructions.md)
