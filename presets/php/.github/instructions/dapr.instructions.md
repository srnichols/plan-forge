---
description: PHP Dapr patterns — Laravel HTTP sidecar client, state, pub/sub, service invocation, secrets, components, and subscriptions
applyTo: 'app/Services/**/*Dapr*.php,app/Http/Controllers/**/*Dapr*.php,routes/api.php,dapr/components/**/*.yaml,dapr/components/**/*.yml'
---

# PHP Dapr Patterns

Laravel 13 cannot use `dapr/php-sdk` because of a Monolog conflict. Use Laravel's HTTP client against the Dapr sidecar API.

## Sidecar Client

Read the sidecar base URL from `DAPR_HTTP_ENDPOINT`, defaulting to the local Dapr HTTP port. Every request sets JSON headers and lets Laravel's HTTP client handle timeouts and retries.

```php
<?php

declare(strict_types=1);

namespace App\Services\Dapr;

use Illuminate\Http\Client\Factory as HttpFactory;

final readonly class DaprClient
{
    public function __construct(private HttpFactory $http)
    {
    }

    private function endpoint(string $path): string
    {
        $base = rtrim((string) config('services.dapr.http_endpoint', 'http://127.0.0.1:3500'), '/');

        return $base.'/v1.0/'.ltrim($path, '/');
    }

    public function saveState(string $store, string $key, array $value): void
    {
        $this->http->timeout(5)->retry(3, 100)
            ->post($this->endpoint("state/{$store}"), [[
                'key' => $key,
                'value' => $value,
                'metadata' => ['contentType' => 'application/json'],
            ]])
            ->throw();
    }

    public function publish(string $pubsub, string $topic, array $event): void
    {
        $this->http->timeout(5)
            ->withHeaders(['Content-Type' => 'application/json'])
            ->post($this->endpoint("publish/{$pubsub}/{$topic}"), $event)
            ->throw();
    }

    public function invoke(string $appId, string $method, array $payload): array
    {
        return $this->http->timeout(10)
            ->post($this->endpoint("invoke/{$appId}/method/{$method}"), $payload)
            ->throw()
            ->json();
    }

    public function secret(string $store, string $key): array
    {
        return $this->http->timeout(5)
            ->get($this->endpoint("secrets/{$store}/{$key}"))
            ->throw()
            ->json();
    }
}
```

## State Keys

Prefix state keys with the authenticated tenant from `CurrentTenant`. Do not accept a tenant argument from an HTTP request.

```php
<?php

declare(strict_types=1);

namespace App\Services\Dapr;

use App\Support\CurrentTenant;

final readonly class TenantStateStore
{
    public function __construct(
        private DaprClient $dapr,
        private CurrentTenant $tenant,
    ) {
    }

    public function putOrderSnapshot(string $orderId, array $snapshot): void
    {
        $key = $this->tenant->id().':order:'.$orderId;
        $this->dapr->saveState('statestore', $key, $snapshot);
    }
}
```

## Pub/Sub and `/dapr/subscribe`

Dapr discovers subscriptions from a route that returns component/topic/route mappings. Dapr pub/sub events carry no authenticity proof, so the route must be reachable only from the sidecar, must require the sidecar's app API token, and must treat tenant data in the event as untrusted until the consumer authorizes or validates it.

```php
<?php

declare(strict_types=1);

use App\Http\Controllers\Dapr\OrderEventsController;
use App\Http\Middleware\EnsureDaprAppApiToken;
use Illuminate\Support\Facades\Route;

Route::middleware([EnsureDaprAppApiToken::class])->group(function (): void {
    Route::get('/dapr/subscribe', function (): array {
        return [[
            'pubsubname' => 'pubsub',
            'topic' => 'orders.placed',
            'route' => '/dapr/orders/placed',
            'metadata' => ['rawPayload' => 'false'],
        ]];
    });

    Route::post('/dapr/orders/placed', [OrderEventsController::class, 'placed']);
});
```

Register those routes in a dedicated route file or route group without the `web` middleware so CSRF does not apply and without the `api` prefix so Dapr can call `/dapr/subscribe`.

```php
<?php

declare(strict_types=1);

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            Route::group([], base_path('routes/dapr.php'));
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
```

The middleware compares Dapr's app API token in constant time.

Set `APP_API_TOKEN` on the Dapr sidecar process and expose the same value to Laravel as `DAPR_APP_API_TOKEN`. On Kubernetes, prefer the `dapr.io/app-token-secret` annotation so the sidecar reads the token from a secret.

```php
<?php

declare(strict_types=1);

return [
    'dapr' => [
        'http_endpoint' => env('DAPR_HTTP_ENDPOINT', 'http://127.0.0.1:3500'),
        'app_api_token' => env('DAPR_APP_API_TOKEN'),
    ],
];
```

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureDaprAppApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.dapr.app_api_token');
        $actual = (string) $request->header('dapr-api-token');

        abort_unless($expected !== '' && hash_equals($expected, $actual), 403);

        return $next($request);
    }
}
```

Also block the path at the edge so public traffic cannot reach it.

```nginx
location ~ ^/(index\.php/)?dapr/ {
    allow 127.0.0.1;
    deny all;
    try_files $uri /index.php?$query_string;
}
```

Place this Dapr location before the `location ~ ^/index\.php(/|$)` PHP-FPM block; otherwise `/index.php/dapr/subscribe` reaches the generic front-controller location instead of the edge deny rule.

Return 2xx only after durable acceptance. A 5xx response asks Dapr to retry according to the component's resiliency policy.

## Component YAML

Components are scoped to the Laravel app and use secret references for credentials.

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: pubsub
spec:
  type: pubsub.redis
  version: v1
  metadata:
    - name: redisHost
      value: redis:6379
    - name: redisPassword
      secretKeyRef:
        name: redis-password
        key: redis-password
auth:
  secretStore: secretstore
scopes:
  - php-api
```

Define separate component directories per environment and require `scopes` on every component.

## Service Invocation

Use Dapr service invocation for internal service calls that need sidecar mTLS, retries, and tracing. Use normal Laravel HTTP clients for public third-party APIs.

```php
<?php

declare(strict_types=1);

$inventory = $dapr->invoke(
    appId: 'inventory-service',
    method: 'api/v1/inventory/check',
    payload: ['sku' => $sku, 'quantity' => $quantity],
);
```

## Health Check

```php
<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Http;

$healthy = Http::timeout(2)
    ->get(rtrim((string) config('services.dapr.http_endpoint'), '/').'/v1.0/healthz')
    ->successful();
```

## Rules

- Use the sidecar endpoints `/v1.0/state/{store}`, `/v1.0/publish/{pubsub}/{topic}`, `/v1.0/invoke/{app-id}/method/{method}`, and `/v1.0/secrets/{store}/{key}`.
- Components must be scoped and must not inline passwords or connection strings.
- Include tenant and correlation identifiers in events, then enforce idempotency in consumers.
- Treat Dapr retries as at-least-once delivery.
- Keep sidecar endpoint configuration in `config/services.php`.

## Anti-Patterns

```text
Installing dapr/php-sdk into this application.
Hardcoding localhost:3500 instead of DAPR_HTTP_ENDPOINT.
Publishing tenant events without tenant context.
Leaving component scopes empty.
Returning success from subscription handlers before persistence.
Logging secret values returned by the secrets API.
```

## See Also

- `messaging.instructions.md` — idempotent consumers and failed jobs
- `security.instructions.md` — secret handling and tenant boundaries
- `observability.instructions.md` — trace propagation through sidecars
