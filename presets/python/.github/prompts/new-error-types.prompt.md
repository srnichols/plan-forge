---
description: "Scaffold custom exception classes with HTTP status mapping, error codes, and FastAPI exception handlers."
agent: "agent"
tools: [read, edit, search]
---
# Create New Error Types

Scaffold a custom exception hierarchy with HTTP status mapping and structured error responses.

## Required Pattern

### Base Application Error
```python
class AppError(Exception):
    """Base exception for all application errors."""

    def __init__(self, message: str, status_code: int, error_code: str) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
```

### Domain Exception Types
```python
class NotFoundError(AppError):
    def __init__(self, entity: str, entity_id: str) -> None:
        super().__init__(
            message=f"{entity} with id '{entity_id}' was not found.",
            status_code=404,
            error_code="NOT_FOUND",
        )

class ConflictError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message=message, status_code=409, error_code="CONFLICT")

class ValidationError(AppError):
    def __init__(self, field_errors: dict[str, list[str]]) -> None:
        super().__init__(
            message="One or more validation errors occurred.",
            status_code=422,
            error_code="VALIDATION_FAILED",
        )
        self.field_errors = field_errors

class ForbiddenError(AppError):
    def __init__(
        self, message: str = "You do not have permission to perform this action."
    ) -> None:
        super().__init__(message=message, status_code=403, error_code="FORBIDDEN")
```

### FastAPI Exception Handler
```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        body: dict = {
            "status": exc.status_code,
            "error": exc.error_code,
            "message": exc.message,
        }
        if isinstance(exc, ValidationError):
            body["field_errors"] = exc.field_errors
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(Exception)
    async def unhandled_error_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        import logging

        logging.exception("Unhandled exception")
        return JSONResponse(
            status_code=500,
            content={
                "status": 500,
                "error": "INTERNAL_ERROR",
                "message": "An unexpected error occurred.",
            },
        )
```

### Registration
```python
app = FastAPI()
register_exception_handlers(app)
```

### Usage in Services
```python
async def get_by_id(self, item_id: UUID) -> Item:
    item = await self.repository.find_by_id(item_id)
    if item is None:
        raise NotFoundError("Item", str(item_id))
    return item
```

## Rules

- NEVER raise raw `Exception` — always use typed exceptions inheriting `AppError`
- NEVER leak tracebacks or internal details in production responses
- Register exception handlers at app startup via `register_exception_handlers()`
- Log the full exception server-side; return sanitized details to the client
- Keep exception classes in `src/exceptions/` or `src/errors/`
- Use `str | None` syntax (Python 3.10+)

## Reference Files

- [Architecture principles](../instructions/architecture-principles.instructions.md)
- [API patterns](../instructions/api-patterns.instructions.md)
