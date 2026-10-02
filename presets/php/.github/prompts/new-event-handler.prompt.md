---
description: "Scaffold Laravel events, queued listeners, after-commit dispatch, and idempotent consumers."
agent: "agent"
tools: [read, edit, search]
---
# Create New Event Handler

Scaffold a Laravel domain event and listener for `{EntityName}`. Use scalar identifiers, include `tenantId`, and make the handler safe for at-least-once delivery.

## Required Pattern

### Event
```text
<?php

declare(strict_types=1);

namespace App\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Queue\SerializesModels;

final class {EntityName}{ActionName}ed implements ShouldDispatchAfterCommit
{
    use Dispatchable;
    use SerializesModels;

    public function __construct(
        public readonly string $eventId,
        public readonly string $tenantId,
        public readonly string ${entityName}Id,
        public readonly string $occurredAt,
    ) {
    }
}
```

### Queued Listener
```text
<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Events\{EntityName}{ActionName}ed;
use App\Services\{EntityName}Service;
use App\Support\CurrentTenant;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;
use Throwable;

final class Handle{EntityName}{ActionName}ed implements ShouldQueue
{
    use InteractsWithQueue;

    public int $tries = 5;

    public function __construct(
        private readonly {EntityName}Service $service,
        private readonly CurrentTenant $tenant,
    ) {
    }

    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    public function handle({EntityName}{ActionName}ed $event): void
    {
        $this->tenant->set($event->tenantId);
        $this->service->handle{ActionName}($event->eventId, $event->{entityName}Id);
    }

    public function failed({EntityName}{ActionName}ed $event, Throwable $exception): void
    {
        report($exception);
    }
}
```

### Publishing After Commit
```text
DB::transaction(function () use ($data): void {
    $entity = $this->{entityName}Repository->create($data);

    {EntityName}{ActionName}ed::dispatch(
        eventId: (string) Str::uuid(),
        tenantId: (string) $entity->tenant_id,
        {entityName}Id: (string) $entity->id,
        occurredAt: now()->toIso8601String(),
    );
});
```

### Idempotency Store
```text
Schema::create('processed_messages', function (Blueprint $table): void {
    $table->id();
    $table->uuid('message_id');
    $table->uuid('tenant_id');
    $table->timestampTz('processed_at');
    $table->unique(['message_id', 'tenant_id']);
});
```

## Rules

- Keep events immutable; pass IDs and tenant context, not Eloquent models.
- Events dispatched inside transactions implement `ShouldDispatchAfterCommit`.
- The listener must handle duplicates through a unique processed-message row and service-level idempotency.
- Only `UniqueConstraintViolationException` means the event was already processed.
- Put events in `app/Events/` and listeners in `app/Listeners/`.
- Cover dispatch and listener behavior with feature tests using the queue fake and a real transaction path.

## Reference Files

- [Messaging patterns](../instructions/messaging.instructions.md)
- [Authentication and tenant rules](../instructions/auth.instructions.md)
