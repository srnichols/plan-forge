# Agents & Automation Architecture

> **Project**: <YOUR PROJECT NAME>  
> **Stack**: PHP / Laravel  
> **Last Updated**: <DATE>

---

## AI Agent Development Standards

**BEFORE writing ANY agent code, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Architecture-First** — Follow proper layering (no business logic in controllers)
2. **TDD for Business Logic** — Red-Green-Refactor with PHPUnit / Pest
3. **Error Handling** — Use typed exceptions; never catch-all with empty blocks
4. **Type Safety** — Strict types, typed properties, return types on all methods

---

## Background Worker Pattern

### Template: Laravel Job (Queue Worker)

```php
<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ProcessPendingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $maxExceptions = 2;

    public function handle(MyService $service): void
    {
        $service->processPending();
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('ProcessPendingJob failed', ['error' => $exception->getMessage()]);
    }
}
```

### Template: Artisan Command (Scheduled Task)

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class SyncDataCommand extends Command
{
    protected $signature = 'app:sync-data';
    protected $description = 'Sync data from external source';

    public function handle(SyncService $service): int
    {
        $this->info('Starting data sync...');
        $service->sync();
        $this->info('Data sync complete.');
        return Command::SUCCESS;
    }
}
```

---

## Agent Categories

| Category | Purpose | Pattern |
|----------|---------|---------|
| **Queue Jobs** | Async processing | `ShouldQueue` + `php artisan queue:work` |
| **Scheduled Commands** | Periodic tasks | `Artisan Command` + `schedule()` |
| **Event Listeners** | Event-driven processing | `EventServiceProvider` + Listeners |
| **Health Monitors** | System health checks | `/health` + `php artisan health:check` |

---

## Communication Patterns

### Queue-Based (Laravel Queue)
```
dispatch(new Job) → Redis/SQS → Queue Worker
```

### Event-Driven (Laravel Events)
```
event(new OrderPlaced) → EventServiceProvider → OrderListener
```

### Request/Response (HTTP)
```
Route → Controller → Service → Repository → Eloquent/DB
```

---

## Quick Commands

```bash
# Run development server
php artisan serve

# Run tests
php artisan test
# or: vendor/bin/phpunit / vendor/bin/pest

# Run queue worker
php artisan queue:work

# Run scheduled tasks
php artisan schedule:run

# Lint
vendor/bin/phpstan analyse

# Format
vendor/bin/php-cs-fixer fix
```
