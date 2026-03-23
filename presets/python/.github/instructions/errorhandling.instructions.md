---
description: Error handling patterns — Custom exception hierarchy, FastAPI exception handlers, ProblemDetails responses
applyTo: '**/*.py'
---

# Error Handling Patterns (Python)

## Exception Hierarchy

```python
class AppError(Exception):
    """Base application error."""
    def __init__(self, message: str, code: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code

class NotFoundError(AppError):
    def __init__(self, entity: str, entity_id: str):
        super().__init__(f"{entity} with ID '{entity_id}' not found", "NOT_FOUND", 404)

class ValidationError(AppError):
    def __init__(self, errors: dict[str, list[str]]):
        super().__init__("Validation failed", "VALIDATION_ERROR", 400)
        self.errors = errors

class ConflictError(AppError):
    def __init__(self, message: str):
        super().__init__(message, "CONFLICT", 409)

class ForbiddenError(AppError):
    def __init__(self, message: str = "Access denied"):
        super().__init__(message, "FORBIDDEN", 403)
```

## FastAPI Exception Handlers

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        logger.warning("Application error: %s path=%s", exc.code, request.url.path)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "type": f"https://contoso.com/errors/{exc.code.lower()}",
                "title": exc.code,
                "status": exc.status_code,
                "detail": exc.message,
                "instance": str(request.url.path),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception path=%s", request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "type": "https://contoso.com/errors/internal",
                "title": "INTERNAL_ERROR",
                "status": 500,
                "detail": "An unexpected error occurred",
                "instance": str(request.url.path),
            },
        )
```

## Rules

- **NEVER** use bare `except:` or `except Exception: pass` — always log or reraise
- **NEVER** leak stack traces in production responses
- **ALWAYS** use typed exceptions — no bare `raise Exception()`
- **ALWAYS** return ProblemDetails-style JSON from API endpoints
- Service layer raises typed exceptions; FastAPI handlers map them
- Use `structlog` for structured error logging with context
- Log at `warning` for client errors (4xx), `error` for server errors (5xx)

## Exception-to-HTTP Mapping

| Exception | HTTP Status | When |
|-----------|-------------|------|
| `ValidationError` | 400 | Invalid input / Pydantic failure |
| `NotAuthenticatedError` | 401 | Missing/invalid auth token |
| `ForbiddenError` | 403 | Insufficient permissions |
| `NotFoundError` | 404 | Entity not found |
| `ConflictError` | 409 | Duplicate/constraint violation |
| `Exception` (unhandled) | 500 | Unexpected error |

## See Also

- `observability.instructions.md` — Structured logging, error tracking
- `api-patterns.instructions.md` — Error response format, status codes
- `messaging.instructions.md` — Dead letter queues, retry strategies
