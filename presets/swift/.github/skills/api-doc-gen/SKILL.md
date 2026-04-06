---
name: api-doc-gen
description: Generate or update OpenAPI specification and DocC documentation from Swift Vapor route registrations. Validate spec-to-code consistency. Use after adding or changing API endpoints.
argument-hint: "[optional: specific controller file to document]"
tools:
  - run_in_terminal
  - read_file
  - forge_analyze
---

# API Documentation Generation Skill (Swift)

## Trigger
"Generate API docs" / "Update OpenAPI spec" / "Document this endpoint" / "Generate DocC docs"

## Steps

### 1. Discover API Endpoints (Vapor)
```bash
grep -rn "\.get\|\.post\|\.put\|\.delete\|\.patch\|grouped\|\.on(" --include="*.swift" Sources/
```
> **If this step fails** (no matches): Try `grep -rn "RouteCollection\|boot(routes" --include="*.swift" Sources/` to find route controllers.

> **If no `.swift` files found**: Stop and report "No Swift project found in this directory."

### 2. Extract Endpoint Details
For each Vapor endpoint, document:
- HTTP method and path (from `router.get("path", use: handler)`)
- Request body schema (from `req.content.decode(MyRequest.self)`)
- Query parameters (from `req.query.get(String.self, at: "page")`)
- Path parameters (from `req.parameters.get("id")`)
- Response schema (from returned `Content`-conforming types)
- Authentication requirements (from middleware groups: `routes.grouped(JWTMiddleware())`)

### 3. Generate/Update OpenAPI Spec
```yaml
openapi: 3.1.0
info:
  title: (project name from Package.swift)
  version: (from VERSION file or Info.plist)
paths:
  /api/v1/items:
    get:
      summary: List items
      parameters:
        - in: query
          name: page
          schema: { type: integer }
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ItemListResponse' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /api/v1/items/{id}:
    get:
      summary: Get item by ID
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ItemResponse' }
        '404': { $ref: '#/components/responses/NotFound' }
```

### 4. DocC Documentation (Swift Package)
```bash
# Generate DocC documentation
swift package generate-documentation

# Preview in browser
swift package --disable-sandbox preview-documentation --target MyApp
```

Add `///` triple-slash comments to public APIs:
```swift
/// Fetches an item by its unique identifier.
///
/// - Parameter id: The UUID of the item to fetch.
/// - Returns: The item if found.
/// - Throws: `Abort(.notFound)` if the item does not exist.
func getItem(id: UUID) async throws -> Item
```

### 5. Validate Consistency
Use the `forge_analyze` MCP tool to verify spec-to-code consistency:
- [ ] Every Vapor route registration has a matching spec entry
- [ ] No spec entries without corresponding code (ghost endpoints)
- [ ] Request/response schemas match actual Swift `Content`-conforming types
- [ ] Status codes match `Abort(.statusCode)` throws in handlers
- [ ] Auth requirements match middleware groups

### 6. Report
```
API Documentation Status:
  Endpoints in code:    N
  Endpoints in spec:    N
  Missing from spec:    N (list them)
  Ghost entries:        N (in spec but not in code)
  Schema mismatches:    N
  DocC coverage:        N% of public APIs documented

Overall: PASS / FAIL
```

## Safety Rules
- NEVER invent endpoints not in the code
- ALWAYS preserve existing spec customizations (descriptions, examples)
- Validate against actual Vapor route registrations, not assumptions
- Flag breaking changes (removed endpoints, changed response schemas)
- Run `swift build` after any spec-related code changes

## Persistent Memory (if OpenBrain is configured)

- **Before generating docs**: `search_thoughts("API design", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")` — load API naming conventions, pagination patterns, and error response standards
- **After spec update**: `capture_thought("API doc: <endpoints added/changed summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-api-doc-gen")` — persist API evolution for breaking change tracking
