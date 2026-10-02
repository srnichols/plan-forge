---
description: Naming conventions — Laravel folders, PHP symbols, database, APIs, third-party integration prefixing
applyTo: 'app/**/*.php,routes/**/*.php,database/migrations/**/*.php,config/**/*.php,composer.json'
---

# Naming Conventions

> **Priority**: Apply consistently across all new PHP and Laravel code.

---

## Universal Rules

### Folder & File Naming

| Context | Convention | Example |
|---------|-----------|---------|
| Project folders | `kebab-case` | `user-auth/`, `payment-gateway/` |
| Laravel app folders | Framework casing | `app/Http/Controllers/Api/V1/` |
| Third-party tooling folders | Prefix with tool/org name | `pforge-mcp/`, `grafana-dashboards/` |
| Config files | Dot-prefix for hidden | `.env.example`, `.forge.json` |
| Documentation | Root docs in `UPPER-KEBAB.md` | `README.md`, `CHANGELOG.md` |

### Third-Party Integration Prefixing

External tool assets must be prefixed so they do not collide with application domains:

```
✅ pforge-mcp/
✅ datadog-monitors/
❌ mcp/
❌ monitors/
```

---

## Laravel and PHP Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Namespace | PSR-4 under `App\` | `App\Services\BillingService` |
| PHP files | `PascalCase.php` for classes | `OrderService.php` |
| Classes / enums | `PascalCase` | `InvoicePolicy`, `OrderStatus` |
| Interfaces | Capability name, no `I` prefix | `OrderRepository` |
| Methods | `camelCase` verb phrases | `createForTenant()` |
| Variables / parameters | `camelCase` | `$tenantId`, `$createdAfter` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_ATTEMPTS` |
| DTO classes | `{Action}{Entity}Data` | `CreateOrderData` |
| Form Requests | `{Action}{Entity}Request` | `StoreOrderRequest` |
| API Resources | `{Entity}Resource` | `OrderResource` |
| Controllers | `{Entity}Controller` | `OrderController` |
| Services | `{Entity}Service` | `OrderService` |
| Repository interfaces | `{Entity}Repository` | `OrderRepository` |
| Eloquent repositories | `Eloquent{Entity}Repository` | `EloquentOrderRepository` |
| Policies | `{Entity}Policy` | `OrderPolicy` |
| Jobs | Imperative verb phrase | `CapturePayment` |
| Events | Past-tense domain fact | `OrderPlaced` |
| Listeners | Imperative verb phrase | `SendOrderReceipt` |

## Database Naming

| Context | Convention | Example |
|---------|-----------|---------|
| Tables | `snake_case`, plural | `orders`, `invoice_lines` |
| Columns | `snake_case` | `tenant_id`, `created_at` |
| Primary keys | `id` UUID | `id` |
| Foreign keys | `{singular_model}_id` | `customer_id` |
| Indexes | `{table}_{columns}_{suffix}` | `orders_tenant_id_created_at_index` |
| Unique constraints | `{table}_{columns}_unique` | `orders_tenant_id_number_unique` |

## API Endpoint Naming

| Convention | Example |
|-----------|---------|
| Version prefix | `/api/v1` |
| Plural resource nouns | `/api/v1/orders` |
| Kebab-case words | `/api/v1/invoice-lines` |
| Nested resources when ownership is real | `/api/v1/customers/{customer}/orders` |

## Decision Framework

When naming anything new, ask:

1. **Will this collide?** Generic names such as `Helper`, `Manager`, and `ServiceProvider2` are not acceptable.
2. **Can someone infer the layer?** `StoreOrderRequest`, `CreateOrderData`, and `OrderResource` each reveal their role.
3. **Does it match Laravel discovery?** Policies, factories, casts, and resources should follow framework conventions.
4. **Is it searchable?** Avoid abbreviations such as `OrdSvc`, `cfg`, and `tmp`.

## Anti-Patterns

```
❌ App\Helpers\GeneralHelper
❌ IOrderRepository
❌ OrderManager
❌ getData()
❌ process()
❌ /api/v1/orderStuff
❌ tenantId database column
```

## See Also

- `api-patterns.instructions.md` — Controller, request, resource, and route names
- `database.instructions.md` — Migration and repository naming
- `testing.instructions.md` — Test class and method naming
