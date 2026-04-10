---
name: api-doc-gen
description: Generate or update OpenAPI specification from TypeScript/Express route definitions. Validate spec-to-code consistency. Use after adding or changing API endpoints.
argument-hint: "[optional: specific router file to document]"
tools:
  - run_in_terminal
  - read_file
  - forge_analyze
---

# API Documentation Generation Skill

## Trigger
"Generate API docs" / "Update OpenAPI spec" / "Document this endpoint"

## Steps

### 1. Discover API Endpoints
```bash
grep -rn "router\.\(get\|post\|put\|delete\|patch\)" --include="*.ts" src/
```
> **If this step fails** (no matches): Try `grep -rn "app\.\(get\|post\|put\|delete\|patch\)" --include="*.ts" src/` for direct Express app routing.

> **If no *.ts files found**: Stop and report "No TypeScript project found in this directory."

### 2. Extract Endpoint Details
For each endpoint, document:
- HTTP method and path (from `router.get('/path', ...)`)
- Request body schema (from typed request interfaces or Zod schemas)
- Query parameters (from `req.query` usage)
- Path parameters (from `:param` in route patterns)
- Response schema (from typed response objects)
- Authentication requirements (from middleware like `authMiddleware`)

### 3. Generate/Update OpenAPI Spec
```yaml
openapi: 3.1.0
info:
  title: (project name from package.json)
  version: (from package.json version field)
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
Use the `forge_analyze` MCP tool to verify spec-to-code consistency:
- [ ] Every route handler has a matching spec entry
- [ ] No spec entries without corresponding code (ghost endpoints)
- [ ] Request/response schemas match actual TypeScript interfaces
- [ ] Status codes match `res.status()` calls in handlers
- [ ] Auth requirements match middleware chains

### 5. Report
```
API Documentation Status:
  Endpoints in code:    N
  Endpoints in spec:    N
  Missing from spec:    N (list them)
  Ghost entries:        N (in spec but not in code)
  Schema mismatches:    N

Overall: PASS / FAIL
```

## Safety Rules
- NEVER invent endpoints not in the code
- ALWAYS preserve existing spec customizations (descriptions, examples)
- Validate against actual route handlers, not assumptions
- Flag breaking changes (removed endpoints, changed schemas)
- Run `pnpm build` after any spec-related code changes


## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "The code is self-documenting" | Code shows implementation, not intent. API consumers need contracts, not source code. |
| "We'll add the OpenAPI spec later" | Specs drift from implementation immediately. Generate alongside code or they'll never match. |
| "Only internal consumers, no docs needed" | Internal APIs become external APIs. Undocumented internal APIs create onboarding bottlenecks. |
| "Examples aren't necessary" | Examples are the most-read section of any API doc. Abstract schemas don't show real usage. |

## Warning Signs

- Endpoints without response type annotations — returns untyped or generic responses
- Spec doesn't match actual routes — OpenAPI spec has different paths/methods than the running API
- No request/response examples — spec has schemas but no concrete usage examples
- Error responses undocumented — only success codes documented, error payloads missing
- Spec not validated against running API — generated once but never verified against live routes

## Exit Proof

After completing this skill, confirm:
- [ ] OpenAPI spec generated or updated (swagger-jsdoc / tsoa)
- [ ] Spec validates against actual endpoints — no ghost entries, no missing routes
- [ ] Request/response examples present for key routes
- [ ] Error responses documented (4xx/5xx with schemas)
- [ ] `npm run build` succeeds after any spec-related code changes
## Persistent Memory (if OpenBrain is configured)

- **Before generating docs**: `search_thoughts("API design", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")` — load API naming conventions, pagination patterns, and error response standards
- **After spec update**: `capture_thought("API doc: <endpoints added/changed summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-api-doc-gen")` — persist API evolution for breaking change tracking
