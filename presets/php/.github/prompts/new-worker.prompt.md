---
description: "Scaffold a Laravel queued worker job with retries, backoff, uniqueness, overlap protection, tenant context, and failure handling."
agent: "agent"
tools: [read, edit, search]
---
# Create New Background Worker

Scaffold a queued job for `{EntityName}` work. Prefer queue workers and Horizon over long-running manual loops.

## Required Pattern

### Job Class
```text
<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\{EntityName}Service;
use App\Support\CurrentTenant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Throwable;

final class Process{EntityName} implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 5;
    public int $uniqueFor = 1800;

    public function __construct(
        public readonly string $tenantId,
        public readonly string ${entityName}Id,
    ) {
        $this->onQueue('{queueName}');
    }

    public function uniqueId(): string
    {
        return '{entityName}:'.$this->tenantId.':'.$this->{entityName}Id;
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping($this->uniqueId()))->releaseAfter(60)];
    }

    public function backoff(): array
    {
        return [15, 60, 300, 900];
    }

    public function handle(CurrentTenant $tenant, {EntityName}Service $service): void
    {
        $tenant->set($this->tenantId);
        $service->process($this->{entityName}Id);
    }

    public function failed(Throwable $exception): void
    {
        report($exception);
    }
}
```

### Dispatch
```text
Process{EntityName}::dispatch(
    tenantId: (string) $model->tenant_id,
    {entityName}Id: (string) $model->id,
)->afterCommit();
```

### Horizon Configuration
```text
'{queueName}' => [
    'connection' => 'redis',
    'queue' => ['{queueName}'],
    'balance' => 'auto',
    'maxProcesses' => 5,
    'tries' => 5,
],
```

## Rules

- Jobs accept scalar IDs and `tenantId`; never serialize models.
- Set `CurrentTenant` before calling repositories or services.
- Use `tries`, `backoff()`, and `failed()` for every durable worker.
- Use `ShouldBeUnique` for duplicate suppression and `WithoutOverlapping` for critical sections.
- Dispatch jobs with `afterCommit()` when created from database writes.
- Add tests for successful handling, retryable exceptions, failed-job behavior, and duplicate suppression.

## Reference Files

- [Messaging instructions](../instructions/messaging.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
