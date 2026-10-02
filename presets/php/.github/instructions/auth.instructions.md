---
description: PHP authentication and authorization — Laravel Sanctum, external OIDC guard, policies, tenant resolution, throttling, and tests
applyTo: 'app/Providers/AppServiceProvider.php,app/Http/Middleware/ResolveTenant.php,app/Models/User.php,app/Policies/**/*.php,routes/api.php,tests/Feature/**/*Auth*.php,tests/Feature/**/*Policy*.php'
---

# PHP Authentication & Authorization

Target PHP 8.5 and Laravel 13.x. API routes use Sanctum by default; external OIDC tokens use a custom request guard that verifies JWTs against a cached JWKS.

## Request Pipeline Order

`auth:sanctum` or the OIDC guard authenticates first. `App\Http\Middleware\ResolveTenant` runs after authentication and stores the tenant from `$request->user()->tenant_id` in `App\Support\CurrentTenant`.

The `User` model must use `Laravel\Sanctum\HasApiTokens`; without it, `Sanctum::actingAs()` and personal access tokens cannot attach abilities to the authenticated user.

```php
<?php

declare(strict_types=1);

use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')
    ->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])
    ->group(function (): void {
        Route::get('/orders', [OrderController::class, 'index']);
    });
```

Never read tenant identity from headers, query strings, request bodies, jobs, or GraphQL arguments unless it has already been derived from an authenticated principal and authorized.

## Sanctum API Tokens

Issue first-party API tokens with narrow ability sets. Store only the returned plain-text token at creation time; Sanctum hashes it before persistence.

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;

final readonly class TokenIssuer
{
    public function issueOrderToken(User $user, string $deviceName): string
    {
        return $user->createToken(
            name: $deviceName,
            abilities: ['orders:read', 'orders:write'],
        )->plainTextToken;
    }
}
```

Route abilities must be checked close to the route definition so missing authorization is visible during review.

```php
<?php

declare(strict_types=1);

use App\Http\Controllers\Api\V1\OrderController;
use Illuminate\Support\Facades\Route;

Route::post('/orders', [OrderController::class, 'store'])
    ->middleware(['auth:sanctum', 'abilities:orders:write']);
```

## External OIDC Guard with Cached JWKS

Register the guard in `App\Providers\AppServiceProvider::boot()` and configure it in `config/auth.php`. Cache the JWKS by issuer; reject tokens without a bearer credential, issuer, audience, subject, or tenant claim. The tenant claim is used to locate the user, but `ResolveTenant` still sets `CurrentTenant` from the authenticated user record.

```php
<?php

declare(strict_types=1);

return [
    'guards' => [
        'oidc' => ['driver' => 'oidc'],
    ],
    'oidc' => [
        'issuer' => env('OIDC_ISSUER'),
        'audience' => env('OIDC_AUDIENCE'),
    ],
];
```

```php
<?php

declare(strict_types=1);

namespace App\Providers;

use App\Models\User;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Throwable;

final class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Auth::viaRequest('oidc', function (Request $request): ?User {
            $token = $request->bearerToken();
            if ($token === null) {
                return null;
            }

            $issuer = config('auth.oidc.issuer');
            $audience = config('auth.oidc.audience');
            if (! is_string($issuer) || $issuer === '' || ! is_string($audience) || $audience === '') {
                return null;
            }

            try {
                $jwks = Cache::remember(
                    key: 'oidc:jwks:'.hash('sha256', $issuer),
                    ttl: now()->addMinutes(15),
                    callback: fn (): array => json_decode(
                        file_get_contents($issuer.'/.well-known/jwks.json') ?: '{}',
                        true,
                        flags: JSON_THROW_ON_ERROR,
                    ),
                );

                $claims = JWT::decode($token, JWK::parseKeySet($jwks, 'RS256'));
                if (
                    ($claims->iss ?? null) !== $issuer
                    || ! in_array($audience, (array) ($claims->aud ?? []), true)
                    || ! isset($claims->sub, $claims->tenant_id)
                ) {
                    return null;
                }

                return User::query()
                    ->where('external_subject', (string) $claims->sub)
                    ->where('tenant_id', (string) $claims->tenant_id)
                    ->first();
            } catch (Throwable $exception) {
                Log::warning('oidc.token_rejected', ['reason' => $exception::class]);

                return null;
            }
        });
    }
}
```

## Tenant Resolution

`ResolveTenant` is the only request-time place that populates tenant context. It must fail closed when no authenticated user or tenant exists.

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\CurrentTenant;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use App\Exceptions\ForbiddenException;
use Symfony\Component\HttpFoundation\Response;

final class ResolveTenant
{
    public function __construct(private CurrentTenant $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user() ?? throw new AuthenticationException();
        if ($user->tenant_id === null) {
            throw new ForbiddenException('User is not assigned to a tenant.');
        }
        $this->tenant->set($user->tenant_id);
        try {
            return $next($request);
        } finally {
            $this->tenant->clear();
        }
    }
}
```

Queued jobs receive an explicit `tenantId` in their constructor and set `CurrentTenant` at the start of `handle()`. They must not rehydrate tenant context from serialized users or request headers.

## Policies and Gates

Policies protect Eloquent resources, and gates cover cross-resource abilities. Controllers call `Gate::authorize()` or Form Requests implement `authorize()`.

```php
<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\Order;
use App\Models\User;

final class OrderPolicy
{
    public function view(User $user, Order $order): bool
    {
        return $user->tenant_id === $order->tenant_id
            && ($user->can('orders:read') || $user->tokenCan('orders:read'));
    }

    public function update(User $user, Order $order): bool
    {
        return $user->tenant_id === $order->tenant_id
            && $user->tokenCan('orders:write');
    }
}
```

## Password Hashing

Use Argon2id for passwords. Keep cost values in configuration so production can tune them without code changes.

```php
<?php

declare(strict_types=1);

return [
    'driver' => 'argon2id',
    'argon' => [
        'memory' => (int) env('HASH_MEMORY', 65536),
        'time' => (int) env('HASH_TIME', 4),
        'threads' => (int) env('HASH_THREADS', 2),
    ],
];
```

## Rate Limiting

Define the `api` limiter in `App\Providers\AppServiceProvider::boot()`. Laravel 13 has no default `api` limiter, so `throttle:api` returns a 500 unless this is registered.

```php
<?php

declare(strict_types=1);

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

RateLimiter::for('api', function (Request $request): Limit {
    return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
});
```

## Feature Tests

Use Sanctum helpers or real bearer tokens. Do not disable middleware for auth tests.

```php
<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

final class OrderAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_denies_cross_tenant_order_access(): void
    {
        $userTenant = Tenant::factory()->create();
        $otherTenant = Tenant::factory()->create();
        $user = User::factory()->create(['tenant_id' => $userTenant->id]);
        $order = Order::factory()->create(['tenant_id' => $otherTenant->id]);

        Sanctum::actingAs($user, ['orders:read']);

        $this->getJson('/api/v1/orders/'.$order->id)
            ->assertNotFound();
    }
}
```

## Rules

- Use Sanctum abilities for API tokens and policies for resource ownership.
- Keep OIDC keys in a short-lived cache; refetching on every request is a reliability and latency bug.
- Validate issuer, audience, algorithm, subject, and tenant claim before resolving a user.
- Resolve tenants only from authenticated user state, then clear `CurrentTenant` in a `finally` block.
- Test 401, 403, cross-tenant 404, missing ability, expired token, and valid token paths.

## Warning Signs

- `X-Tenant-ID`, `tenant_id` request input, or route parameters decide tenant context.
- Routes under `v1` omit `auth:sanctum` or a documented public-access reason.
- Policies compare only IDs and skip tenant equality.
- Auth tests use `withoutMiddleware()` instead of exercising guards.
- OIDC verification accepts any algorithm or ignores `aud`.
