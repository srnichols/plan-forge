---
description: "Scaffold a new Laravel entity end-to-end: migration, Eloquent model, DTOs, repository, service, controller, resource, policy, and tests."
agent: "agent"
tools: [read, edit, search, execute]
---

# Create New Database Entity

Scaffold a complete entity from PostgreSQL 18 to the `/api/v1` JSON API using the Laravel 13 layered architecture.

## Fill-In Inputs

- `{EntityName}`: PascalCase domain name, such as `Product`.
- `{entityName}`: camelCase variable name, such as `product`.
- `{entity_name}`: snake_case name, such as `product`.
- `{table}`: plural table name, such as `products`.
- `{resource}`: plural URL segment, such as `products`.

## Required Steps

1. **Create migration** with `php artisan make:migration create_{table}_table`.

   ```php
   declare(strict_types=1);

   use Illuminate\Database\Migrations\Migration;
   use Illuminate\Database\Schema\Blueprint;
   use Illuminate\Support\Facades\Schema;

   return new class extends Migration {
       public function up(): void
       {
           Schema::create('products', function (Blueprint $table): void {
               $table->uuid('id')->primary();
               $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
               $table->string('name', 200);
               $table->unsignedBigInteger('price_cents');
               $table->timestampsTz();

               $table->unique(['tenant_id', 'name']);
               $table->index(['tenant_id', 'created_at', 'id']);
           });
       }

       public function down(): void
       {
           Schema::dropIfExists('products');
       }
   };
   ```

2. **Create Eloquent model** at `app/Models/{EntityName}.php`.

   ```php
   declare(strict_types=1);

   namespace App\Models;

   use App\Models\Concerns\BelongsToTenant;
   use Illuminate\Database\Eloquent\Concerns\HasUuids;
   use Illuminate\Database\Eloquent\Factories\HasFactory;
   use Illuminate\Database\Eloquent\Model;

   final class Product extends Model
   {
       use BelongsToTenant;
       use HasFactory;
       use HasUuids;

       protected $fillable = ['tenant_id', 'name', 'price_cents'];

       protected function casts(): array
       {
           return [
               'price_cents' => 'integer',
           ];
       }
   }
   ```

3. **Create DTOs** under `app/Data/`, using `final readonly class` and promoted constructor properties.
4. **Create Form Requests** named `Store{EntityName}Request` and `Update{EntityName}Request`; `authorize()` must call the policy and `toData()` must return the DTO.
5. **Create repository contract and Eloquent implementation** under `app/Repositories/Contracts/` and `app/Repositories/`.
6. **Bind the repository interface** in `App\Providers\AppServiceProvider::register()`.
7. **Create service** at `app/Services/{EntityName}Service.php`; keep business rules and `DB::transaction()` here.
8. **Create controller and resource** under `app/Http/Controllers/Api/V1/` and `app/Http/Resources/`; controllers accept Form Requests and return Resources.
9. **Register routes** inside the authenticated `Route::prefix('v1')->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])` group. Define the `api` limiter in `AppServiceProvider::boot()` because Laravel 13 does not define it by default.
10. **Create policy, factory, and tests** for authorization, repository behavior with `RefreshDatabase`, service rules, and API responses.

## Route and Rate Limiter Shape

```php
declare(strict_types=1);

use App\Http\Controllers\Api\V1\ProductController;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')
    ->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])
    ->group(function (): void {
        Route::apiResource('products', ProductController::class);
    });
```

```php
declare(strict_types=1);

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        RateLimiter::for(
            'api',
            fn (Request $request): Limit => Limit::perMinute(60)->by($request->user()?->id ?: $request->ip()),
        );
    }
}
```

## Service and Controller Shape

```php
declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\StoreProductRequest;
use App\Http\Resources\ProductResource;
use App\Services\ProductService;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final readonly class ProductController
{
    public function __construct(private ProductService $products) {}

    public function index(): AnonymousResourceCollection
    {
        return ProductResource::collection($this->products->pageForCurrentTenant());
    }

    public function store(StoreProductRequest $request): ProductResource
    {
        return ProductResource::make($this->products->create($request->toData()));
    }
}
```

## Verification Commands

```bash
php artisan migrate --pretend
php artisan test --filter Product
vendor/bin/phpstan analyse
vendor/bin/pint --test
```

## Reference Files

- [Database instructions](../instructions/database.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
