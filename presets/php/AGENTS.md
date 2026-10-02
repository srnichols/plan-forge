# Agents & Automation Architecture

> **Project**: <YOUR PROJECT NAME>
> **Stack**: PHP 8.5 / Laravel 13.x
> **Last Updated**: <DATE>

---

## AI Agent Development Standards

**BEFORE writing ANY agent, queue, or scheduled code, read:** `.github/instructions/architecture-principles.instructions.md`

### Priority
1. **Architecture-First** — Workers orchestrate; services hold business rules
2. **TDD for Business Logic** — Unit-test the service before wiring jobs/listeners
3. **Typed Error Handling** — Use `AppException` subclasses and retryable exception boundaries
4. **Tenant Safety** — Jobs and listeners set `CurrentTenant` before touching tenant-scoped models

---

## Background Worker Pattern

### Template: Tenant-Aware Queue Job

```php
<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\AccountBalanceService;
use App\Support\CurrentTenant;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

final class RecalculateAccountBalance implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $tenantId,
        public readonly string $accountId,
    ) {
    }

    public function handle(CurrentTenant $currentTenant, AccountBalanceService $balances): void
    {
        $currentTenant->set($this->tenantId);

        $balances->recalculate($this->accountId);
    }
}
```

### Template: Scheduled Command

```php
<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\InvoiceService;
use Illuminate\Console\Command;

final class SendInvoiceReminders extends Command
{
    protected $signature = 'billing:send-invoice-reminders';

    protected $description = 'Send reminder emails for invoices that are due soon.';

    public function handle(InvoiceService $invoices): int
    {
        $sent = $invoices->sendDueSoonReminders();

        $this->info("Sent {$sent} invoice reminders.");

        return self::SUCCESS;
    }
}
```

---

## Agent Categories

| Category | Purpose | Laravel Pattern |
|----------|---------|-----------------|
| **Queued Jobs** | Durable background work | `ShouldQueue`, Horizon, explicit retries |
| **Event Listeners** | React to domain events | Register in `AppServiceProvider::boot()` or use event discovery |
| **Scheduled Tasks** | Periodic processing | `routes/console.php` scheduler or commands |
| **Health Monitors** | Runtime readiness checks | HTTP health route plus service probes |

---

## Communication Patterns

### Event-Driven
```
Controller → Service → Domain event → Queued listener → Repository update
```

### Request/Response
```
Client → Form Request → Controller → Service → Repository → API Resource
```

### Queue Processing
```
Service dispatches job with tenantId → worker sets CurrentTenant → service executes
```

---

## Quick Commands

```bash
php artisan queue:work
php artisan horizon
php artisan schedule:list
php artisan test --filter=Job
vendor/bin/phpstan analyse
vendor/bin/pint --test
```

---

## Review Checks for Agents

- [ ] Jobs carry tenant context explicitly and set `CurrentTenant` before model access
- [ ] Workers call services instead of embedding business rules
- [ ] Retry settings are finite and idempotency is documented
- [ ] Queue payloads contain identifiers, not serialized Eloquent models
- [ ] Failures surface through logs or failed jobs, not swallowed catches
- [ ] Commands and listeners have focused tests around side effects
