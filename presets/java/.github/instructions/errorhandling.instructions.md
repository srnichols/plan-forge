---
description: Error handling patterns — Exception hierarchy, @RestControllerAdvice, ProblemDetail responses, Spring error mapping
applyTo: '**/*.java'
---

# Error Handling Patterns (Java/Spring Boot)

## Exception Hierarchy

```java
public abstract class AppException extends RuntimeException {
    private final String code;
    private final int statusCode;
    
    protected AppException(String message, String code, int statusCode) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
    
    public String getCode() { return code; }
    public int getStatusCode() { return statusCode; }
}

public class NotFoundException extends AppException {
    public NotFoundException(String entity, String id) {
        super(entity + " with ID '" + id + "' not found", "NOT_FOUND", 404);
    }
}

public class ValidationException extends AppException {
    private final Map<String, List<String>> errors;
    
    public ValidationException(Map<String, List<String>> errors) {
        super("Validation failed", "VALIDATION_ERROR", 400);
        this.errors = errors;
    }
    
    public Map<String, List<String>> getErrors() { return errors; }
}

public class ConflictException extends AppException {
    public ConflictException(String message) {
        super(message, "CONFLICT", 409);
    }
}

public class ForbiddenException extends AppException {
    public ForbiddenException(String message) {
        super(message != null ? message : "Access denied", "FORBIDDEN", 403);
    }
}
```

## Global Exception Handler

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AppException.class)
    public ProblemDetail handleAppException(AppException ex, HttpServletRequest request) {
        log.warn("Application error: {} path={}", ex.getCode(), request.getRequestURI());
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
            HttpStatusCode.valueOf(ex.getStatusCode()), ex.getMessage());
        problem.setTitle(ex.getCode());
        problem.setType(URI.create("https://contoso.com/errors/" + ex.getCode().toLowerCase()));
        problem.setInstance(URI.create(request.getRequestURI()));
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getFieldErrors()
            .forEach(e -> errors.put(e.getField(), e.getDefaultMessage()));
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        problem.setProperty("errors", errors);
        return problem;
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception path={}", request.getRequestURI(), ex);
        return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred");
    }
}
```

## Rules

- **NEVER** use empty catch blocks — always log with context or rethrow
- **NEVER** leak stack traces in production responses
- **ALWAYS** use typed exceptions extending `AppException`
- **ALWAYS** return Spring `ProblemDetail` (RFC 9457) from REST endpoints
- Use `@RestControllerAdvice` for global exception mapping
- Service layer throws typed exceptions; advice maps them to HTTP
- Log at WARN for client errors (4xx), ERROR for server errors (5xx)

## Exception-to-HTTP Mapping

| Exception | HTTP Status | When |
|-----------|-------------|------|
| `MethodArgumentNotValidException` | 400 | Bean Validation failure |
| `AuthenticationException` | 401 | Missing/invalid auth |
| `ForbiddenException` | 403 | Insufficient permissions |
| `NotFoundException` | 404 | Entity not found |
| `ConflictException` | 409 | Duplicate/constraint violation |
| `Exception` (unhandled) | 500 | Unexpected error |

## See Also

- `observability.instructions.md` — Structured logging, error tracking
- `api-patterns.instructions.md` — Error response format, status codes
- `messaging.instructions.md` — Dead letter queues, retry strategies

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "This operation can't fail" | Every I/O operation can fail — network timeouts, disk full, permission denied. If it touches external state, it fails. |
| "A generic catch block is fine here" | Generic catches swallow specific failure signals. Catch the exception you expect, let the rest propagate to `@ControllerAdvice`. |
| "Logging the error is enough" | Logging without handling means the caller receives a cryptic 500. Return a structured ProblemDetail response so the consumer can act on it. |
| "The caller handles errors, I don't need to" | If the caller expected your method to succeed unconditionally, the unchecked exception is a surprise. Define your error contract explicitly. |
| "Returning `null` is simpler than throwing" | Null return values push error handling to every caller. Use `Optional<T>` or throw a specific exception with a clear message. |

---

## Warning Signs

- Empty catch blocks (`catch (Exception e) { }`) — silent failure
- All exceptions caught as base `Exception` instead of specific types
- Error responses expose stack traces or internal paths to API consumers
- Methods that return `null` on failure instead of throwing or using `Optional<T>`
- Missing timeout configuration on `RestTemplate` / `WebClient` calls (no way to cancel on timeout)
- Retry logic without `@Retryable` max attempts or exponential backoff (infinite retry loops)
