---
description: "Scaffold Laravel DTOs, Form Requests, and API Resources that keep HTTP contracts separate from Eloquent models."
agent: "agent"
tools: [read, edit, search]
---
# Create New DTO

Scaffold immutable data objects and request/response contracts for a Laravel API entity.

## Required Pattern

### Input DTO

```text
app/Data/Create{EntityName}Data.php

final readonly class Create{EntityName}Data
{
    public function __construct(
        public string $name,
        public string $sku,
        public int $priceCents,
    ) {
    }
}
```

### Form Request Conversion

```text
app/Http/Requests/Store{EntityName}Request.php

final class Store{EntityName}Request extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('create', {EntityName}::class) === true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:200'],
            'sku' => ['required', 'string', 'max:64'],
            'price_cents' => ['required', 'integer', 'min:0'],
        ];
    }

    public function toData(): Create{EntityName}Data
    {
        return new Create{EntityName}Data(
            name: (string) $this->validated('name'),
            sku: (string) $this->validated('sku'),
            priceCents: (int) $this->validated('price_cents'),
        );
    }
}
```

### API Resource

```text
app/Http/Resources/{EntityName}Resource.php

final class {EntityName}Resource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'sku' => $this->sku,
            'priceCents' => $this->price_cents,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
```

## Rules

- Use `final readonly class` for DTOs in `app/Data`.
- Do not pass Form Requests into services; convert with `toData()`.
- Do not return Eloquent models from controllers; use API Resources.
- Validate scalar shape in Form Requests; enforce domain rules in services.
- Keep response field names stable and consumer-oriented.
- Add update DTOs separately; do not overload create DTOs with nullable fields unless the API contract really permits partial input.

## Pagination Wrapper

Laravel Resource collections may wrap `CursorPaginator` results. Preserve cursor metadata and avoid exposing database column names that are not part of the API.

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Naming conventions](../instructions/naming.instructions.md)
- [Layering rules](../instructions/architecture-principles.instructions.md)
