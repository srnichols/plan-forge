---
description: PHP/Laravel observability patterns — OpenTelemetry SDK, OTLP export, Monolog JSON logs, correlation IDs, metrics, and health signals.
applyTo: '**/app/**/*.php,**/bootstrap/app.php,**/config/logging.php,**/config/otel.php,**/routes/*.php,**/composer.json'
---

# PHP Observability Patterns

## Structured logging

Use Laravel's `stderr` channel with `Monolog\Formatter\JsonFormatter` for production logs. Keep all logs queryable and safe: no tokens, passwords, session IDs, raw request bodies, or full authorization headers.

```php
use Monolog\Formatter\JsonFormatter;
use Monolog\Handler\StreamHandler;
use Monolog\Logger;

return [
    'channels' => [
        'stderr' => [
            'driver' => 'monolog',
            'handler' => StreamHandler::class,
            'formatter' => JsonFormatter::class,
            'with' => ['stream' => 'php://stderr'],
            'level' => env('LOG_LEVEL', 'info'),
        ],
    ],
];
```

Application code should log events, not string-concatenated prose:

```php
use Illuminate\Support\Facades\Log;

Log::info('order.created', [
    'order_id' => $order->id,
    'tenant_id' => $order->tenant_id,
    'status' => $order->status->value,
]);
```

## Correlation IDs

Generate a correlation ID at the HTTP boundary, add it to Laravel's logging context, and echo it back to the caller. Do not trust tenant or user identity from headers; those come from authenticated Sanctum users and `CurrentTenant`.

```php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

final class CorrelateRequests
{
    public function handle(Request $request, Closure $next): Response
    {
        $correlationId = $request->headers->get('X-Correlation-ID') ?: (string) Str::uuid();

        Context::add('correlation_id', $correlationId);
        Log::withContext(['correlation_id' => $correlationId]);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set('X-Correlation-ID', $correlationId);

        return $response;
    }
}
```

Register the middleware in `bootstrap/app.php`, not in `Kernel.php`.

## OpenTelemetry PHP

Use `open-telemetry/sdk` 1.15.0 with the OTLP exporter. Auto-instrumentation exists for common HTTP/client surfaces when the OpenTelemetry PHP extension and relevant instrumentation packages are installed; keep manual spans around business operations that matter to the domain.

Composer packages:

```bash
composer require open-telemetry/sdk:^1.15 open-telemetry/exporter-otlp:^1.4
```

Environment:

```bash
OTEL_SERVICE_NAME=laravel-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_PROPAGATORS=baggage,tracecontext
OTEL_PHP_AUTOLOAD_ENABLED=true
```

Bind OpenTelemetry collaborators in `AppServiceProvider::register()` before injecting them:

```php
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Metrics\MeterInterface;
use OpenTelemetry\API\Trace\TracerInterface;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(
            TracerInterface::class,
            fn (): TracerInterface => Globals::tracerProvider()->getTracer('app'),
        );

        $this->app->singleton(
            MeterInterface::class,
            fn (): MeterInterface => Globals::meterProvider()->getMeter('app'),
        );
    }
}
```

Manual span on a collaborator:

```php
namespace App\Observability;

use App\Models\Order;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\API\Trace\TracerInterface;
use Psr\Log\LoggerInterface;

final readonly class OrderAuditTrail
{
    public function __construct(
        private TracerInterface $tracer,
        private LoggerInterface $logger,
    ) {
    }

    public function recordCreated(Order $order): void
    {
        $span = $this->tracer->spanBuilder('order.audit.created')->startSpan();

        try {
            $span->setAttribute('tenant.id', $order->tenant_id);
            $span->setAttribute('order.id', $order->id);
            $this->logger->info('order.audit_created', ['order_id' => $order->id]);
        } catch (\Throwable $exception) {
            $span->recordException($exception);
            $span->setStatus(StatusCode::STATUS_ERROR);
            throw $exception;
        } finally {
            $span->end();
        }
    }
}
```

## Metrics

Expose metrics through the OpenTelemetry metrics SDK or a Prometheus bridge. Use low-cardinality attributes such as route name, status class, queue name, and job class. Never tag metrics with user IDs, UUIDs, email addresses, or full URLs.

```php
use OpenTelemetry\API\Metrics\MeterInterface;

final readonly class CheckoutMetrics
{
    public function __construct(private MeterInterface $meter)
    {
    }

    public function recordCompleted(string $queue, int $durationMs): void
    {
        $counter = $this->meter->createCounter('checkout.completed');
        $histogram = $this->meter->createHistogram('checkout.duration_ms');

        $counter->add(1, ['queue' => $queue]);
        $histogram->record($durationMs, ['queue' => $queue]);
    }
}
```

## Queues and jobs

Queued jobs must carry `tenantId` and rehydrate `CurrentTenant` at the beginning of `handle()`. Include `correlation_id` in the job payload when the job is dispatched from an HTTP request so traces and logs can be stitched together.

```php
namespace App\Jobs;

use App\Support\CurrentTenant;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Log;

final class SendOrderReceipt
{
    public function __construct(
        private readonly string $tenantId,
        private readonly string $correlationId,
    ) {
    }

    public function handle(CurrentTenant $currentTenant): void
    {
        $currentTenant->set($this->tenantId);
        Context::add('correlation_id', $this->correlationId);
        Log::withContext([
            'correlation_id' => $this->correlationId,
            'tenant_id' => $this->tenantId,
            'job' => static::class,
        ]);
    }
}
```

## Health checks

- `/up` is liveness and should remain cheap.
- `/ready` is readiness and should check PostgreSQL, Redis, required external clients, and migration state where appropriate.
- Failed readiness should return HTTP 503 with dependency names, not exception internals.

## Audit logging

Audit entries belong in durable storage and should also emit a structured log event.

```php
use Illuminate\Support\Facades\Log;

Log::notice('audit.entity_updated', [
    'actor_id' => $user->id,
    'tenant_id' => $user->tenant_id,
    'entity_type' => 'Order',
    'entity_id' => $order->id,
    'changed_fields' => array_keys($changes),
]);
```

## Anti-patterns

- `error_log()`, `var_dump()`, or `dump()` in production paths.
- Logging secrets, raw headers, complete request bodies, or PII-heavy model arrays.
- Missing `Log::withContext()` for request and queue boundaries.
- Metrics with high-cardinality labels.
- A health check that only proves PHP-FPM started.
- Manual spans that swallow exceptions instead of rethrowing.

## See Also

- `deploy.instructions.md` — liveness/readiness and container health checks
- `errorhandling.instructions.md` — problem details and trace IDs
- `performance.instructions.md` — profiling and latency metrics
