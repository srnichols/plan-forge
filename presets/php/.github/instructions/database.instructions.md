---
description: PHP/Laravel database patterns — Eloquent models, migrations, repositories, transactions, pagination, and tests
applyTo: 'app/Models/**/*.php,app/Repositories/**/*.php,database/migrations/**/*.php,database/factories/**/*.php,tests/**/*Repository*.php,tests/Feature/**/*Database*.php'
---

# PHP Database Patterns

## ORM Strategy

Use Eloquent for aggregate persistence, repositories for query composition, and services for business decisions. Controllers, resources, policies, and jobs must not build ad hoc SQL.

### Eloquent model baseline

```php
declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class Invoice extends Model
{
    use BelongsToTenant;
    use HasFactory;
    use HasUuids;

    protected $fillable = ['tenant_id', 'customer_id', 'external_id', 'number', 'status', 'total_cents'];

    protected function casts(): array
    {
        return [
            'total_cents' => 'integer',
            'issued_at' => 'immutable_datetime',
            'metadata' => 'array',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
```

Enable lazy-loading protection during application boot so N+1 mistakes fail in local and test environments:

```php
declare(strict_types=1);

namespace App\Providers;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Model::preventLazyLoading(! $this->app->isProduction());
    }
}
```

## Non-Negotiable Rules

### Parameterized Queries

```php
declare(strict_types=1);

use Illuminate\Support\Facades\DB;

$rows = DB::select(
    'select id, number, total_cents from invoices where tenant_id = ? and status = ?',
    [$tenantId, $status],
);
```

- Never interpolate request input into SQL, table names, column names, or `order by` clauses.
- Prefer Eloquent query builder methods. Use raw SQL only with bindings and a measured reason.
- Tenant ids come from authenticated context, not headers, query strings, or request bodies.

### Repository Boundary

```php
declare(strict_types=1);

namespace App\Repositories;

use App\Models\Invoice;
use App\Repositories\Contracts\InvoiceRepository;
use Illuminate\Contracts\Pagination\CursorPaginator as InvoiceCursorPaginator;
use Illuminate\Support\Collection;

final readonly class EloquentInvoiceRepository implements InvoiceRepository
{
    public function findPageForTenant(string $tenantId, int $perPage): InvoiceCursorPaginator
    {
        return Invoice::query()
            ->select(['id', 'tenant_id', 'customer_id', 'number', 'status', 'created_at'])
            ->with(['customer:id,name'])
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($perPage);
    }

    public function importStatuses(Collection $rows): int
    {
        return Invoice::query()->upsert(
            $rows->all(),
            ['tenant_id', 'external_id'],
            ['status', 'updated_at'],
        );
    }
}
```

Cursor pagination must use a unique, stable ordering. `created_at` alone is not unique; pair it with `id` or another unique column.

### Canonical Order Schema

The running Order example uses one enum and one tenant-owned table shape across repositories, resources, factories, and tests:

```php
declare(strict_types=1);

namespace App\Enums;

enum OrderStatus: string
{
    case Pending = 'pending';
    case Paid = 'paid';
    case Cancelled = 'cancelled';
}
```

```php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('reference');
            $table->string('status');
            $table->char('currency', 3);
            $table->unsignedBigInteger('total_cents')->default(0);
            $table->text('notes')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'reference']);
            $table->index(['tenant_id', 'created_at', 'id']);
        });
    }
};
```

### Transactions Belong in Services

```php
declare(strict_types=1);

namespace App\Services;

use App\Data\CaptureInvoicePaymentData;
use App\Events\InvoicePaid;
use App\Repositories\Contracts\InvoiceRepository;
use Illuminate\Support\Facades\DB;

final readonly class InvoicePaymentService
{
    public function __construct(private InvoiceRepository $invoices) {}

    public function capture(CaptureInvoicePaymentData $data): void
    {
        DB::transaction(function () use ($data): void {
            $invoice = $this->invoices->lockForTenant($data->tenantId, $data->invoiceId);
            $invoice->markPaid($data->paymentReference);
            $invoice->save();

            InvoicePaid::dispatch($invoice->id, $data->tenantId);
        }, attempts: 3);
    }
}
```

`InvoicePaid` must implement `Illuminate\Contracts\Events\ShouldDispatchAfterCommit` because it is dispatched inside the transaction.

Do not place `DB::transaction()` in controllers or repository methods that only perform a single persistence operation.

## Migration Strategy

Laravel migrations must define both `up()` and `down()` and be backward-compatible for rolling deploys.

```php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained()->restrictOnDelete();
            $table->string('external_id', 80);
            $table->string('number', 40);
            $table->string('status', 32);
            $table->unsignedBigInteger('total_cents');
            $table->timestampTz('issued_at')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'number']);
            $table->unique(['tenant_id', 'external_id']);
            $table->index(['tenant_id', 'status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoices');
    }
};
```

### Zero-Downtime Column Changes

| Operation | Risk | Laravel approach |
|-----------|------|------------------|
| Add nullable column | Low | Add directly, deploy readers later |
| Add required column | Medium | Add nullable, backfill with `chunkById()`, then add constraint |
| Rename column | High | Add new column, dual-write, backfill, switch reads, drop old column later |
| Drop column | High | Stop code references first, verify production, drop in a later release |
| Large backfill | Medium | Use queued chunks or `chunkById()`; avoid one transaction for the full table |

```php
declare(strict_types=1);

use App\Models\Invoice;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table): void {
            $table->string('status_v2', 32)->nullable()->after('status');
        });

    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table): void {
            $table->dropColumn('status_v2');
        });
    }
};
```

For large tables, run the backfill from an Artisan command or queued job after the expand migration so it does not hold migration locks for the full table:

```php
declare(strict_types=1);

use Illuminate\Support\Facades\DB;

DB::table('invoices')
    ->select(['id', 'status'])
    ->orderBy('id')
    ->chunkById(500, function ($invoices): void {
        foreach ($invoices as $invoice) {
            DB::table('invoices')
                ->where('id', $invoice->id)
                ->update(['status_v2' => $invoice->status]);
        }
    });
```

## Bulk Work

- Use `chunkById()` or `lazyById()` for maintenance and exports; never load every model with `all()`.
- Use `upsert()` for idempotent imports.
- Use `lockForUpdate()` inside a service transaction when enforcing a balance, inventory, or uniqueness rule beyond a database constraint.
- Select the columns needed by the caller; avoid full models in read-heavy projections.

## Repository Tests

Repository tests should run against the migrated database and prove tenancy, eager loading, pagination order, and write behavior.

```php
declare(strict_types=1);

namespace Tests\Feature\Repositories;

use App\Models\Invoice;
use App\Models\Tenant;
use App\Repositories\EloquentInvoiceRepository;
use App\Support\CurrentTenant;
use Illuminate\Foundation\Testing\RefreshDatabase as RefreshesDatabase;
use Tests\TestCase;

final class EloquentInvoiceRepositoryTest extends TestCase
{
    use RefreshesDatabase;

    public function test_it_returns_tenant_scoped_cursor_page_with_customers(): void
    {
        $tenant = Tenant::factory()->create();
        $otherTenant = Tenant::factory()->create();
        Invoice::factory()->count(3)->forTenant($tenant)->create();
        Invoice::factory()->forTenant($otherTenant)->create();
        app(CurrentTenant::class)->set($tenant->id);

        $page = app(EloquentInvoiceRepository::class)->findPageForTenant($tenant->id, 2);

        $this->assertCount(2, $page->items());
        $this->assertTrue(collect($page->items())->every(
            fn (Invoice $invoice): bool => $invoice->tenant_id === $tenant->id && $invoice->relationLoaded('customer'),
        ));
    }
}
```

## Production Migration Checklist

- Run `php artisan migrate --pretend` and review generated SQL.
- Check `php artisan migrate:status` before and after deployment.
- Confirm indexes exist for new tenant filters, joins, and cursor order columns.
- Verify old application code can run after the expand migration.
- Keep destructive contract migrations in a separate release.
- Back up production or confirm point-in-time recovery before high-risk schema changes.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll read the tenant from `X-Tenant-Id`." | Client-controlled tenancy breaks isolation. Resolve tenant from the authenticated user and `CurrentTenant`. |
| "Lazy loading only happens in development." | It becomes an outage when a resource serializes a collection. Eager-load required relations in repositories. |
| "Offset pagination is simpler." | Deep offsets slow down and can skip rows during concurrent writes. Use cursor pagination with a unique order for APIs. |
| "A nullable column is enough forever." | Temporary expand columns become permanent ambiguity. Plan the contract migration before shipping the expand step. |
| "Repository tests can mock Eloquent." | Mocked query builders do not prove scopes, indexes, eager loading, or migrations. Use `RefreshDatabase`. |

## Warning Signs

- Query building in controllers, resources, policies, listeners, or Blade views.
- `whereRaw()` with variables embedded into the SQL string.
- List queries without tenant filtering or policy-backed authorization.
- `cursorPaginate()` without a unique order.
- `Schema::table()` dropping or renaming columns in the same release that code changes read/write behavior.
- Factories that omit `tenant_id` for tenant-scoped models.
