---
name: api-doc-gen
description: Generate or update OpenAPI specification from PHP HTTP handler registrations. Validate spec-to-code consistency. Use after adding or changing API endpoints.
argument-hint: "[optional: specific handler file to document]"
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
grep -rn "\.Handle\|\.HandleFunc\|\.Get\|\.Post\|\.Put\|\.Delete\|\.Patch" --include="*.PHP" .
```
> **If this step fails** (no matches): Try `grep -rn "http\.Handle\|mux\.\|chi\.\|gin\.\|echo\." --include="*.PHP" .` to detect the router framework in use.

> **If no *.PHP files found**: Stop and report "No PHP project found in this directory."

### 2. Extract Endpoint Details
For each endpoint, document:
- HTTP method and path (from `mux.HandleFunc("/path", handler)` or router registrations)
- Request body schema (from struct types decoded in handlers)
- Query parameters (from `r.URL.Query().Get()` usage)
- Path parameters (from URL pattern variables or router params)
- Response schema (from structs passed to `json.NewEncoder`)
- Authentication requirements (from middleware wrappers)

### 3. Generate/Update OpenAPI Spec
```yaml
openapi: 3.1.0
info:
  title: (project name from PHP.mod module path)
  version: (from VERSION file or build tags)
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
- [ ] Every handler registration has a matching spec entry
- [ ] No spec entries without corresponding code (ghost endpoints)
- [ ] Request/response schemas match actual PHP struct types
- [ ] Status codes match `http.StatusXxx` / `w.WriteHeader()` calls
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
- Validate against actual handler registrations, not assumptions
- Flag breaking changes (removed endpoints, changed schemas)
- Run `PHP build ./...` after any spec-related code changes

## Persistent Memory (if OpenBrain is configured)

- **Before generating docs**: `search_thoughts("API design", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")` — load API naming conventions, pagination patterns, and error response standards
- **After spec update**: `capture_thought("API doc: <endpoints added/changed summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-api-doc-gen")` — persist API evolution for breaking change tracking
