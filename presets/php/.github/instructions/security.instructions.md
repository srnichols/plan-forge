---
description: PHP security patterns — Laravel validation, mass-assignment control, output encoding, CSRF, CORS, secrets, encryption, uploads, and audits
applyTo: 'app/Http/Requests/**/*.php,app/Models/**/*.php,app/Http/Middleware/**/*Security*.php,bootstrap/app.php,config/cors.php,config/filesystems.php,routes/web.php,routes/api.php,composer.json'
---

# PHP Security Patterns

Security defaults must be visible in Laravel configuration and enforced at system boundaries. Controllers stay thin: Form Requests validate input, policies authorize actions, services apply business rules, and repositories handle queries with bindings.

## Validate at the Boundary

All user input enters through a Form Request or a purpose-built validator. Convert validated data into a DTO before calling services.

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Data\CreateOrderData;
use App\Models\Order;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', Order::class) === true;
    }

    public function rules(): array
    {
        return [
            'reference' => ['required', 'string', 'max:64'],
            'currency' => ['required', Rule::in(['USD', 'EUR', 'GBP'])],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function toData(): CreateOrderData
    {
        $data = $this->validated();

        return new CreateOrderData(
            reference: $data['reference'],
            currency: $data['currency'],
            notes: $data['notes'] ?? null,
        );
    }
}
```

## Mass Assignment

Models declare `$fillable`. Never call `Model::create($request->all())`, and never set `$guarded = []` on tenant data.

```php
<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\OrderStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Concerns\HasUuids;

final class Order extends Model
{
    use BelongsToTenant;
    use HasUuids;

    protected $fillable = [
        'tenant_id',
        'reference',
        'status',
        'currency',
        'total_cents',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'status' => OrderStatus::class,
            'total_cents' => 'integer',
        ];
    }
}
```

## Output Escaping

Blade escapes with `{{ }}`. Use `{!! !!}` only for sanitized, trusted HTML produced by a server-side allow-list sanitizer.

```blade
<h1>{{ $order->reference }}</h1>
<p>{{ $order->notes }}</p>
```

API Resources return scalar response shapes and never expose raw Eloquent models.

## CSRF and Token APIs

Session-backed web routes keep CSRF enabled. Token-authenticated API routes use `auth:sanctum` and do not depend on cookies for authorization.

```php
<?php

declare(strict_types=1);

use App\Http\Middleware\ResolveTenant;
use Illuminate\Support\Facades\Route;

Route::middleware(['web', 'auth'])->group(function (): void {
    Route::post('/profile', [ProfileController::class, 'update']);
});

Route::prefix('v1')
    ->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])
    ->group(function (): void {
        Route::post('/orders', [OrderController::class, 'store']);
    });
```

## CORS

Allow specific origins from configuration; `supports_credentials` is allowed only when origins are explicit.

```php
<?php

declare(strict_types=1);

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => array_filter(explode(',', (string) env('CORS_ALLOWED_ORIGINS', ''))),
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['Content-Type', 'Authorization', 'X-Requested-With'],
    'exposed_headers' => [],
    'max_age' => 600,
    'supports_credentials' => false,
];
```

## Secrets and Encryption

Read secrets from environment variables, Dapr secret stores, or cloud secret managers. Do not put real values in source, tests, plan files, seeders, or `.env.example`.

Use encrypted casts for fields that must be unreadable at rest through normal database access, such as provider tokens or customer metadata. Rotate `APP_KEY` only with a planned re-encryption procedure.

## Security Headers

Register a middleware in `bootstrap/app.php` for browser-facing responses.

```php
<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AddSecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");

        if ($request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
```

## File Uploads

Validate size, extension, MIME type, and content. Store uploads outside the public disk unless they are meant to be public.

```php
<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class UploadDocumentRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'document' => [
                'required',
                'file',
                'mimetypes:application/pdf,image/png,image/jpeg',
                'extensions:pdf,png,jpg,jpeg',
                'max:10240',
            ],
        ];
    }
}
```

Generate server-side names and scan files with the platform's malware scanner before making them downloadable.

## Dependency and Secret Audits

Run:

```bash
composer audit
composer outdated --direct
vendor/bin/pint --test
vendor/bin/phpstan analyse
```

Treat direct and transitive Composer advisories as release blockers unless there is a written accepted-risk decision.

## Common Vulnerabilities to Prevent

| Vulnerability | Laravel control |
| --- | --- |
| SQL injection | Eloquent query builder with bindings; raw SQL only with bound parameters |
| XSS | Blade escaping, API Resources, CSP |
| CSRF | Web middleware CSRF tokens; token auth for stateless APIs |
| Mass assignment | `$fillable`, DTOs, Form Requests |
| Broken access control | Policies, gates, tenant scopes |
| Secret exposure | `env()`, secret stores, encrypted casts |

## Temper Guards

| Shortcut | Why It Breaks |
| --- | --- |
| "This is an admin-only screen, validation can be loose" | Admin endpoints are high-value targets and still receive untrusted input. |
| "The model has a tenant scope, so authorization is optional" | Scopes hide rows; policies decide whether the action is allowed. Both are required. |
| "A wildcard CORS origin is easier during staging" | Staging credentials and tokens are still useful to attackers. Use environment-specific allow-lists. |
| "The upload has the right extension" | Extensions lie. Validate MIME/content and store with server-generated names. |

## Warning Signs

- `request()->all()`, `$request->all()`, or `$model->fill($request->input())`.
- `{!! $value !!}` in Blade without a sanitizer.
- `DB::statement()` or `DB::select()` with interpolated variables.
- `CORS_ALLOWED_ORIGINS=*` on an environment with credentials.
- Uploaded files written directly to a public path.
