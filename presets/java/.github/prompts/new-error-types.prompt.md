---
description: "Scaffold custom exception classes with HTTP status mapping, error codes, and a Spring @ControllerAdvice handler."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold a custom exception hierarchy with HTTP status mapping and RFC 7807 Problem Details responses.

## Required Pattern

### Base Application Exception
```java
public abstract class AppException extends RuntimeException {
    private final int statusCode;
    private final String errorCode;

    protected AppException(String message, int statusCode, String errorCode) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
    }

    public int getStatusCode() { return statusCode; }
    public String getErrorCode() { return errorCode; }
}
```

### Domain Exception Types
```java
public class NotFoundException extends AppException {
    public NotFoundException(String entity, Object id) {
        super(entity + " with id '" + id + "' was not found.", 404, "NOT_FOUND");
    }
}

public class ConflictException extends AppException {
    public ConflictException(String message) {
        super(message, 409, "CONFLICT");
    }
}

public class ValidationException extends AppException {
    private final Map<String, List<String>> fieldErrors;

    public ValidationException(Map<String, List<String>> fieldErrors) {
        super("One or more validation errors occurred.", 422, "VALIDATION_FAILED");
        this.fieldErrors = fieldErrors;
    }

    public Map<String, List<String>> getFieldErrors() { return fieldErrors; }
}

public class ForbiddenException extends AppException {
    public ForbiddenException() {
        super("You do not have permission to perform this action.", 403, "FORBIDDEN");
    }
}
```

### Global Exception Handler (@ControllerAdvice)
```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AppException.class)
    public ResponseEntity<ProblemDetail> handleAppException(AppException ex) {
        var problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.valueOf(ex.getStatusCode()), ex.getMessage());
        problem.setTitle(ex.getErrorCode());

        if (ex instanceof ValidationException ve) {
            problem.setProperty("fieldErrors", ve.getFieldErrors());
        }

        return ResponseEntity.status(ex.getStatusCode()).body(problem);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> handleBeanValidation(
            MethodArgumentNotValidException ex) {
        Map<String, List<String>> errors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .collect(Collectors.groupingBy(
                FieldError::getField,
                Collectors.mapping(FieldError::getDefaultMessage, Collectors.toList())));

        var problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.UNPROCESSABLE_ENTITY, "Validation failed.");
        problem.setTitle("VALIDATION_FAILED");
        problem.setProperty("fieldErrors", errors);
        return ResponseEntity.unprocessableEntity().body(problem);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        var problem = ProblemDetail.forStatusAndDetail(
            HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred.");
        problem.setTitle("INTERNAL_ERROR");
        return ResponseEntity.internalServerError().body(problem);
    }
}
```

## Rules

- NEVER throw raw `RuntimeException` — always use typed exceptions extending `AppException`
- NEVER leak stack traces or internal details in production responses
- Use Spring 6 `ProblemDetail` (RFC 7807) for all error responses
- Catch Bean Validation errors separately in `@ControllerAdvice`
- Log the full exception server-side; return sanitized details to the client
- Keep exception classes in an `exception/` package

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
