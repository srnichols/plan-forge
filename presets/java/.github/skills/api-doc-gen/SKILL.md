---
name: api-doc-gen
description: Generate or update OpenAPI specification from Java/Spring controller annotations. Validate spec-to-code consistency. Use after adding or changing API endpoints.
argument-hint: "[optional: specific controller class to document]"
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
grep -rn "@\(GetMapping\|PostMapping\|PutMapping\|DeleteMapping\|PatchMapping\|RequestMapping\)" --include="*.java" src/
```
> **If this step fails** (no matches): Try `grep -rn "@RestController\|@Controller" --include="*.java" src/` to locate controller classes first.

> **If no *.java files found**: Stop and report "No Java project found in this directory."

### 2. Extract Endpoint Details
For each endpoint, document:
- HTTP method and path (from `@GetMapping("/path")` annotations)
- Request body schema (from `@RequestBody` parameter types)
- Query parameters (from `@RequestParam` annotations)
- Path parameters (from `@PathVariable` annotations)
- Response schema (from `ResponseEntity<T>` return types)
- Authentication requirements (from `@PreAuthorize` or Spring Security config)

### 3. Generate/Update OpenAPI Spec
```yaml
openapi: 3.1.0
info:
  title: (project name from pom.xml)
  version: (from pom.xml version or VERSION file)
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
> **If springdoc-openapi is configured**: Run `mvn spring-boot:run` and fetch from `/v3/api-docs` to get the auto-generated spec.

### 4. Validate Consistency
Use the `forge_analyze` MCP tool to verify spec-to-code consistency:
- [ ] Every mapping annotation has a matching spec entry
- [ ] No spec entries without corresponding code (ghost endpoints)
- [ ] Request/response schemas match actual Java DTO classes
- [ ] Status codes match `ResponseEntity` and `@ResponseStatus` annotations
- [ ] Auth requirements match `@PreAuthorize` / `@Secured` annotations

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
- Validate against actual controller annotations, not assumptions
- Flag breaking changes (removed endpoints, changed schemas)
- Run `mvn verify` after any spec-related code changes

## Persistent Memory (if OpenBrain is configured)

- **Before generating docs**: `search_thoughts("API design", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", type: "convention")` — load API naming conventions, pagination patterns, and error response standards
- **After spec update**: `capture_thought("API doc: <endpoints added/changed summary>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-api-doc-gen")` — persist API evolution for breaking change tracking
