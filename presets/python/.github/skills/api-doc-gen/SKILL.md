---
name: api-doc-gen
description: Generate or update OpenAPI specification from code. Validate spec-to-code consistency. Use after adding or changing API endpoints.
argument-hint: "[optional: specific endpoint or controller to document]"
---

# API Documentation Generation Skill

## Trigger
"Generate API docs" / "Update OpenAPI spec" / "Document this endpoint"

## Steps

### 1. Discover API Endpoints
```bash
# .NET — find controllers
grep -rn "\[Http\(Get\|Post\|Put\|Delete\|Patch\)\]" --include="*.cs" src/

# Node/Express — find route definitions
grep -rn "router\.\(get\|post\|put\|delete\|patch\)" --include="*.ts" src/

# Python/FastAPI — find route decorators
grep -rn "@app\.\(get\|post\|put\|delete\|patch\)" --include="*.py" src/

# Go — find handler registrations
grep -rn "\.Handle\|\.HandleFunc\|\.Get\|\.Post" --include="*.go" .
```

### 2. Extract Endpoint Details
For each endpoint, document:
- HTTP method and path
- Request body schema (if applicable)
- Query parameters
- Path parameters
- Response schema (success and error)
- Authentication requirements
- Rate limiting

### 3. Generate/Update OpenAPI Spec
```yaml
openapi: 3.1.0
info:
  title: (project name)
  version: (from VERSION file or package.json)
paths:
  /api/v1/resource:
    get:
      summary: Brief description
      parameters: [...]
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Resource' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
```

### 4. Validate Consistency
- [ ] Every code endpoint has a matching spec entry
- [ ] No spec entries without corresponding code (ghost endpoints)
- [ ] Request/response schemas match actual DTOs/models
- [ ] Status codes match error handling in code
- [ ] Auth requirements match actual middleware/attributes

### 5. Report
```
API Documentation Status:
  Endpoints in code: N
  Endpoints in spec: N
  Missing from spec: N (list them)
  Ghost entries: N (in spec but not in code)
  Schema mismatches: N
```

## Safety Rules
- NEVER invent endpoints not in the code
- ALWAYS preserve existing spec customizations (descriptions, examples)
- Validate against actual code, not assumptions
- Flag breaking changes (removed endpoints, changed schemas)

## Persistent Memory (if OpenBrain is configured)

- **Before generating docs**: `search_thoughts("API design", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")` — load API naming conventions, pagination patterns, and error response standards
- **After spec update**: `capture_thought("API doc: <endpoints added/changed summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-api-doc-gen")` — persist API evolution for breaking change tracking
