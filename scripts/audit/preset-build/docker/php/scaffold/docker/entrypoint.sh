#!/bin/sh
set -eu

php artisan config:cache
php artisan route:cache
php artisan view:cache
php artisan optimize

exec "$@"
