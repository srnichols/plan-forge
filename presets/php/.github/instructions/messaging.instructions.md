---
description: PHP messaging patterns — Laravel queues, jobs, retries, idempotent consumers, failed jobs, and Horizon
applyTo: 'app/Jobs/**/*.php,app/Events/**/*.php,app/Listeners/**/*.php,config/queue.php,config/horizon.php,database/migrations/**/*message*.php,database/migrations/**/*failed_jobs*.php'
---

# PHP Messaging & Pub/Sub Patterns

Use Laravel queues for durable asynchronous work. Jobs carry scalar identifiers, the `tenantId`, and enough correlation metadata to retry safely.

## Job Shape

Jobs define explicit retry behavior, set tenant context at the start of `handle()`, and use `failed()` for final failure handling.

```php
<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\OrderService;
use App\Support\CurrentTenant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

final class CapturePayment implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 5;

    public function __construct(
        public readonly string $tenantId,
        public readonly string $orderId,
    ) {
        $this->onQueue('payments');
    }

    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    public function handle(CurrentTenant $currentTenant, OrderService $orders): void
    {
        $currentTenant->set($this->tenantId);
        $orders->capturePayment($this->orderId);
    }

    public function failed(Throwable $exception): void
    {
        report($exception);
    }
}
```

## Concurrency Controls

Use `ShouldBeUnique` to suppress duplicate queued work and `WithoutOverlapping` to serialize critical sections.

```php
<?php

declare(strict_types=1);

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

final class RebuildTenantSearchIndex implements \Illuminate\Contracts\Queue\ShouldQueue, \Illuminate\Contracts\Queue\ShouldBeUnique
{
    use Queueable;

    public int $uniqueFor = 1800;

    public function __construct(public readonly string $tenantId)
    {
    }

    public function uniqueId(): string
    {
        return 'search-index:'.$this->tenantId;
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping($this->uniqueId()))->releaseAfter(60)];
    }
}
```

## Dispatch After Commit

Dispatch jobs after the database transaction commits so workers never observe rolled-back data.

```php
<?php

declare(strict_types=1);

use App\Jobs\CapturePayment;
use Illuminate\Support\Facades\DB;

DB::transaction(function () use ($data): void {
    $order = $this->orders->create($data);

    CapturePayment::dispatch(
        tenantId: (string) $order->tenant_id,
        orderId: (string) $order->id,
    )->afterCommit();
});
```

Set `after_commit` to `true` on queue connections that process domain events from persisted records.

## Idempotent Consumers

Use a `processed_messages` table with a unique `message_id`. The idempotency row and business work must happen in the same transaction. Insert the processed-message row with `insertOrIgnore()` and return only when that insert reports zero rows; exceptions from the work are real failures and must retry or fail.

```php
<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

final readonly class MessageConsumer
{
    public function consume(string $messageId, string $tenantId, callable $work): void
    {
        DB::transaction(function () use ($messageId, $tenantId, $work): void {
            $inserted = DB::table('processed_messages')->insertOrIgnore([
                'message_id' => $messageId,
                'tenant_id' => $tenantId,
                'processed_at' => now(),
            ]);

            if ($inserted === 0) {
                return;
            }

            $work();
        });
    }
}
```

The migration must include a unique index that matches the duplicate definition used by the consumer.

## Failed Jobs and Dead Letters

Laravel's `failed_jobs` table is the dead-letter store. Configure it, alert on growth, and inspect payloads before retrying.

```bash
php artisan queue:failed
php artisan queue:retry all
php artisan queue:forget {id}
```

Do not automatically retry poison messages forever. Fix the handler or data, then retry specific failed job IDs.

## Horizon

Use Horizon for Redis queues in production. Keep queue names explicit, isolate long-running work from latency-sensitive jobs, and set balancing rules per environment.

```php
<?php

declare(strict_types=1);

return [
    'environments' => [
        'production' => [
            'payments' => [
                'connection' => 'redis',
                'queue' => ['payments'],
                'balance' => 'auto',
                'maxProcesses' => 10,
                'tries' => 5,
            ],
        ],
    ],
];
```

## Event Payload Rules

- Events and jobs carry IDs, `tenantId`, correlation IDs, and timestamps; they do not serialize Eloquent models.
- Handlers are idempotent and safe to replay.
- Tenant context is set at the worker boundary before repositories are called.
- Transient failures throw so Laravel retry/backoff can run.
- Permanent validation failures are recorded and sent to `failed_jobs`.

## Anti-Patterns

```text
Passing Eloquent models to queued jobs instead of IDs.
Dispatching from inside a transaction without afterCommit().
Treating every database exception as a duplicate message.
Letting jobs retry indefinitely with no failed() path.
Putting tenant_id in optional payload metadata rather than constructor arguments.
Running all queues through one worker pool.
```

## See Also

- `dapr.instructions.md` — sidecar pub/sub and subscription endpoints
- `observability.instructions.md` — correlation IDs, traces, queue metrics
- `database.instructions.md` — transactions, unique constraints, repository boundaries
