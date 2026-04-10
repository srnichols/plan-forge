---
description: API patterns for Java — REST conventions, Spring Web, Bean Validation, pagination, error handling
applyTo: '**/*Controller*.java,**/*Rest*.java,**/controller/**,**/dto/**'
---

# Java API Patterns

## REST Conventions

### Controller Structure
```java
@RestController
@RequestMapping("/api/producers")
public class ProducerController {
    private final ProducerService service;

    public ProducerController(ProducerService service) {
        this.service = service;
    }

    @GetMapping
    public PagedResult<ProducerResponse> getAll(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "25") int pageSize) {
        return service.getPaged(page, pageSize);
    }

    @GetMapping("/{id}")
    public ProducerResponse getById(@PathVariable UUID id) {
        return service.getById(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProducerResponse create(@Valid @RequestBody CreateProducerRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void update(@PathVariable UUID id, @Valid @RequestBody UpdateProducerRequest request) {
        service.update(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }
}
```

## Error Handling (RFC 9457 Problem Details)
```java
// Spring Boot 3.x — ProblemDetail is built-in
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(NotFoundException.class)
    public ProblemDetail handleNotFound(NotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("Not Found");
        pd.setType(URI.create("https://tools.ietf.org/html/rfc9110#section-15.5.5"));
        return pd;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail pd = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        pd.setTitle("Validation Failed");
        Map<String, String> errors = ex.getBindingResult().getFieldErrors().stream()
            .collect(Collectors.toMap(FieldError::getField, FieldError::getDefaultMessage));
        pd.setProperty("errors", errors);
        return pd;
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail handleGeneric(Exception ex) {
        // Never expose internal details
        return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR,
            "An unexpected error occurred");
    }
}
```

## Request Validation (Bean Validation)
```java
public record CreateProducerRequest(
    @NotBlank @Size(max = 200) String name,
    @NotBlank @Email String contactEmail,
    @DecimalMin("-90") @DecimalMax("90") BigDecimal latitude,
    @DecimalMin("-180") @DecimalMax("180") BigDecimal longitude
) {}
```

## Pagination
```java
public record PagedResult<T>(
    List<T> items,
    int page,
    int pageSize,
    long totalCount
) {
    public int totalPages() {
        return (int) Math.ceil((double) totalCount / pageSize);
    }
    public boolean hasNext() {
        return page < totalPages();
    }
    public boolean hasPrevious() {
        return page > 1;
    }
}

// Spring Data JPA
Page<Producer> page = producerRepository.findAll(PageRequest.of(pageNum - 1, pageSize));
```

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, PUT/PATCH success with body |
| 201 Created | POST success |
| 204 No Content | PUT/DELETE success, no body |
| 400 Bad Request | Validation failure (@Valid) |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but insufficient permissions |
| 404 Not Found | Resource doesn't exist |
| 409 Conflict | Duplicate resource |
| 422 Unprocessable | Valid syntax but business rule violation |
| 500 Internal Server | Unhandled exception (never expose details) |

## API Versioning

### URL-based Versioning (Recommended)
```java
// v1 controller
@RestController
@RequestMapping("/api/v1/producers")
public class ProducerV1Controller {
    @GetMapping
    public List<ProducerResponseV1> getAll() {
        return service.getAllV1();
    }
}

// v2 controller (expanded fields, new behavior)
@RestController
@RequestMapping("/api/v2/producers")
public class ProducerV2Controller {
    @GetMapping
    public List<ProducerResponseV2> getAll() {
        return service.getAllV2();
    }
}
```

### Header-based Versioning
```java
@RestController
@RequestMapping("/api/producers")
public class ProducerController {
    @GetMapping
    public ResponseEntity<?> getAll(
            @RequestHeader(value = "API-Version", defaultValue = "1") int version) {
        return version >= 2
            ? ResponseEntity.ok(service.getAllV2())
            : ResponseEntity.ok(service.getAllV1());
    }
}
```

### Version Discovery Endpoint
```java
@RestController
public class ApiVersionController {
    @GetMapping("/api/versions")
    public Map<String, Object> versions() {
        return Map.of(
            "supported", List.of("v1", "v2"),
            "current", "v2",
            "deprecated", List.of("v1"),
            "sunset", Map.of("v1", "2026-01-01")
        );
    }
}
```

### Deprecation Headers Filter
```java
@Component
public class DeprecationHeaderFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        chain.doFilter(request, response);
        if (request.getRequestURI().startsWith("/api/v1")) {
            response.setHeader("Sunset", "Sat, 01 Jan 2026 00:00:00 GMT");
            response.setHeader("Deprecation", "true");
            response.setHeader("Link",
                "</api/v2/docs>; rel=\"successor-version\"");
        }
    }
}
```

### Non-Negotiable Rules
- **ALWAYS** version APIs from day one — `/api/v1/`
- **NEVER** break existing consumers — add a new version instead
- Deprecation requires minimum 6-month sunset window
- Return `410 Gone` after sunset date, not `404`
- Document version differences in OpenAPI specs (springdoc-openapi)

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose stack traces to clients (use @RestControllerAdvice)
❌ Business logic in controllers (delegate to @Service classes)
❌ Accept raw Map<String, Object> instead of typed DTOs
❌ Return JPA entities directly (use response records/DTOs)
❌ Missing @Valid on @RequestBody (validation silently skipped)
```

## API Documentation (OpenAPI)

### SpringDoc OpenAPI (Recommended)
```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.7.0</version>
</dependency>
```

```java
// Swagger UI at /swagger-ui.html, spec at /v3/api-docs
@Operation(summary = "Get producer by ID")
@ApiResponses({
    @ApiResponse(responseCode = "200", description = "Producer found"),
    @ApiResponse(responseCode = "404", description = "Producer not found")
})
@GetMapping("/{id}")
public ProducerResponse getById(@PathVariable UUID id) {
    return service.getById(id);
}
```

```yaml
# application.yml
springdoc:
  api-docs:
    path: /v3/api-docs
  swagger-ui:
    path: /swagger-ui.html
    enabled: true     # Disable in production if needed
```

- **ALWAYS** annotate endpoints with `@Operation` and `@ApiResponse`
- **ALWAYS** use typed request/response records (drives schema generation)
- Group endpoints with `@Tag(name = "Producers")`

## See Also

- `version.instructions.md` — Semantic versioning, pre-release, deprecation timelines
- `graphql.instructions.md` — Spring GraphQL controllers, DataLoaders (for GraphQL APIs)
- `security.instructions.md` — Spring Security, input validation, CORS
- `errorhandling.instructions.md` — Error response format, @ControllerAdvice
- `performance.instructions.md` — Hot-path optimization, async patterns

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Nobody uses pagination yet" | Unbounded queries return all rows. The first large dataset crashes the client or times out. Add `Pageable` parameter from the first endpoint. |
| "API versioning can wait until v2" | Unversioned APIs break all consumers on the first change. Add `/api/v1/` from day one — it costs zero lines of logic. |
| "Error codes aren't needed for MVP" | API consumers parse error codes programmatically. Returning only string messages forces consumers to regex-match errors — brittle and untranslatable. |
| "Returning 200 OK for all responses simplifies the client" | HTTP semantics exist for a reason. Returning 200 for errors breaks caching, monitoring, and every HTTP-aware tool in the pipeline. |
| "This endpoint doesn't need request validation" | Every endpoint accepting input is an attack surface. Validate shape and constraints at the API boundary — `@Valid` with Bean Validation handles this with minimal code. |

---

## Warning Signs

- An endpoint returns an unbounded collection without `Pageable` or pagination parameters
- No `@Operation` / `@ApiResponse` annotations on controller methods (undocumented API contract)
- Route paths don't include a version segment (`/api/users` instead of `/api/v1/users`)
- HTTP 200 returned for error conditions instead of 4xx/5xx
- Request body accepted as `Map<String, Object>` or `JsonNode` instead of a typed DTO
- Missing `produces`/`consumes` media type on controller methods (clients can't negotiate content type)
