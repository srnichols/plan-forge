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

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes)
❌ Expose stack traces to clients (use @RestControllerAdvice)
❌ Business logic in controllers (delegate to @Service classes)
❌ Accept raw Map<String, Object> instead of typed DTOs
❌ Return JPA entities directly (use response records/DTOs)
❌ Missing @Valid on @RequestBody (validation silently skipped)
```
