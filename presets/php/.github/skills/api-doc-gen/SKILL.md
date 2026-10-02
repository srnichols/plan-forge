---
name: api-doc-gen
description: Generate or update OpenAPI documentation from Laravel routes, controllers, Form Requests, API Resources, policies, and RFC 9457 error responses. Use after adding or changing API endpoints.
argument-hint: "[optional: specific route, controller, or resource to document]"
tools:
  - run_in_terminal
  - read_file
  - forge_analyze
---

# API Documentation Generation Skill

## Trigger
"Generate API docs" / "Update OpenAPI spec" / "Document this endpoint"

## Steps

### 1. Discover API Routes
```bash
php artisan route:list --path=v1
grep -rn "Route::" routes app/Http/Controllers --include="*.php"
```
> **If this step fails**: Report that no Laravel route surface was found and stop.

### 2. Extract Endpoint Details
For each route, document:

- HTTP method and URI from `php artisan route:list`
- Controller action and route name
- Authentication middleware such as `auth:sanctum` and `throttle:api`
- Request schema from the Form Request `rules()`
- Authorization from `authorize()` and policies
- Response schema from the API Resource
- Pagination style, including cursor pagination order
- Error responses from `bootstrap/app.php` problem-details rendering

### 3. Generate or Update OpenAPI
```yaml
openapi: 3.1.0
info:
  title: Laravel API
  version: 1.0.0
paths:
  /api/v1/orders:
    get:
      security:
        - sanctum: []
      responses:
        '200':
          description: Cursor-paginated orders
        '401':
          $ref: '#/components/responses/UnauthorizedProblem'
        '422':
          $ref: '#/components/responses/ValidationProblem'
components:
  securitySchemes:
    sanctum:
      type: http
      scheme: bearer
```

### 4. Validate Consistency
Use `forge_analyze` to compare spec and code:

- [ ] Every versioned route has a spec entry
- [ ] No ghost endpoints remain in the spec
- [ ] Form Request rules match request schemas
- [ ] API Resource fields match response schemas
- [ ] Error responses use `{type,title,status,detail,instance}`
- [ ] Auth requirements match middleware and policies

### 5. Verify Generated Contract
```bash
php artisan route:list --path=v1
php artisan test --filter=Api
vendor/bin/phpstan analyse
```

### 6. Report
```text
API Documentation Status:
  Routes in Laravel:    N
  Routes in OpenAPI:    N
  Missing from spec:    N
  Ghost entries:        N
  Schema mismatches:    N
  Problem responses:    PASS / FAIL
```

## Safety Rules

- NEVER invent endpoints that are not in `php artisan route:list`.
- ALWAYS preserve hand-written descriptions and examples unless they are wrong.
- ALWAYS document authentication, authorization, pagination, and problem responses.
- Flag breaking changes when paths, methods, request fields, response fields, or status codes change.
- Run tests after changing generated spec code or API annotations.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Route names are enough documentation" | Consumers need request and response contracts, not only route inventory. |
| "Only success responses matter" | Client SDKs and support teams depend on documented validation, auth, and conflict payloads. |
| "Resources can be inferred from models" | API Resources intentionally hide fields and transform names; Eloquent models are not the wire contract. |
| "Internal APIs do not need examples" | Internal consumers still need stable contracts and migration notes. |

## Warning Signs

- OpenAPI schemas mention database column names that API Resources do not expose.
- Tenant IDs appear as client-supplied parameters.
- Removed routes are still present in the spec.
- Validation errors are documented as generic 400 responses instead of RFC 9457 422.

## Exit Proof

After completing this skill, confirm:

- [ ] Spec entries match `php artisan route:list --path=v1`
- [ ] Request schemas came from Form Requests
- [ ] Response schemas came from API Resources
- [ ] Problem responses documented for 401, 403, 404, 409, and 422
- [ ] `php artisan test --filter=Api` result included

## Persistent Memory for API Documentation

- **Before generating docs**: `search_thoughts("Laravel API design", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")`
- **After spec update**: `capture_thought("Laravel API docs: <routes changed, breaking changes>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-api-doc-gen")`
