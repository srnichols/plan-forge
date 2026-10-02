---
description: "Scaffold a Laravel API controller with Form Requests, API Resources, service delegation, and correct status codes."
agent: "agent"
tools: [read, edit, search]
---
# Create New Controller

Scaffold a controller that follows Laravel REST conventions and delegates all business behavior to a service.

## Required Pattern

```text
app/Http/Controllers/Api/V1/{EntityName}Controller.php

final class {EntityName}Controller extends Controller
{
    public function __construct(private readonly {EntityName}Service $service)
    {
    }

    public function index(): AnonymousResourceCollection
    {
        return {EntityName}Resource::collection($this->service->paginateForCurrentTenant());
    }

    public function show(string $id): {EntityName}Resource
    {
        return {EntityName}Resource::make($this->service->findForCurrentTenant($id));
    }

    public function store(Store{EntityName}Request $request): JsonResponse
    {
        $resource = {EntityName}Resource::make($this->service->create($request->toData()));

        return $resource->response()->setStatusCode(201);
    }

    public function update(string $id, Update{EntityName}Request $request): {EntityName}Resource
    {
        return {EntityName}Resource::make($this->service->update($id, $request->toData()));
    }

    public function destroy(string $id): Response
    {
        $this->service->delete($id);

        return response()->noContent();
    }
}
```

## Required Companion Files

- `app/Http/Requests/Store{EntityName}Request.php`
- `app/Http/Requests/Update{EntityName}Request.php`
- `app/Http/Resources/{EntityName}Resource.php`
- `app/Data/Create{EntityName}Data.php`
- `app/Data/Update{EntityName}Data.php`
- `app/Services/{EntityName}Service.php`
- `app/Repositories/Contracts/{EntityName}Repository.php`

## Route Registration

```text
routes/api.php

// Define RateLimiter::for('api', ...) in App\Providers\AppServiceProvider::boot().
Route::prefix('v1')
    ->middleware(['auth:sanctum', 'throttle:api', ResolveTenant::class])
    ->group(function (): void {
        Route::apiResource('{entity-kebab-plural}', {EntityName}Controller::class);
    });
```

`apiResource` must expose the collection index route as well as show, store, update, and destroy; tests for `GET /api/v1/{entity-kebab-plural}` should pass against this registration.

## Rules

- Controllers handle HTTP concerns only.
- Use Form Requests for validation, authorization, and conversion to DTOs.
- Return API Resources, not Eloquent models.
- Delegate all work to `{EntityName}Service`.
- Services call repositories; controllers never build queries.
- Use 200 for reads/updates with body, 201 for create, 204 for delete.

## Error Mapping

| Exception | HTTP Status |
|-----------|-------------|
| `ValidationException` | 422 Unprocessable Content |
| `AuthenticationException` | 401 Unauthorized |
| `HttpExceptionInterface` | 403/404/405/429 converted HTTP errors |
| `NotFoundException` | 404 Not Found |
| `ConflictException` | 409 Conflict |

## Reference Files

- [API patterns](../instructions/api-patterns.instructions.md)
- [Error handling](../instructions/errorhandling.instructions.md)
- [Architecture baseline](../instructions/architecture-principles.instructions.md)
