---
description: API patterns for Python — REST conventions, FastAPI, Pydantic, pagination, error handling
applyTo: '**/*route*,**/*router*,**/*endpoint*,**/*api*,**/routers/**'
---

# Python API Patterns

## REST Conventions

### Route Structure (FastAPI)
```python
from fastapi import APIRouter, HTTPException, Query, status
from uuid import UUID

router = APIRouter(prefix="/api/producers", tags=["producers"])

@router.get("", response_model=PagedResult[ProducerResponse])
async def list_producers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    return await producer_service.get_paged(page, page_size)

@router.get("/{producer_id}", response_model=ProducerResponse)
async def get_producer(producer_id: UUID):
    producer = await producer_service.get_by_id(producer_id)
    if not producer:
        raise HTTPException(status_code=404, detail="Producer not found")
    return producer

@router.post("", response_model=ProducerResponse, status_code=status.HTTP_201_CREATED)
async def create_producer(request: CreateProducerRequest):
    return await producer_service.create(request)

@router.put("/{producer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def update_producer(producer_id: UUID, request: UpdateProducerRequest):
    await producer_service.update(producer_id, request)

@router.delete("/{producer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_producer(producer_id: UUID):
    await producer_service.delete(producer_id)
```

## Error Handling
```python
from fastapi import Request
from fastapi.responses import JSONResponse

class AppException(Exception):
    def __init__(self, status_code: int, title: str, detail: str):
        self.status_code = status_code
        self.title = title
        self.detail = detail

class NotFoundException(AppException):
    def __init__(self, detail: str = "Resource not found"):
        super().__init__(404, "Not Found", detail)

class ValidationException(AppException):
    def __init__(self, detail: str, errors: list[dict] | None = None):
        super().__init__(400, "Validation Failed", detail)
        self.errors = errors or []

# Global exception handler (RFC 9457 Problem Details)
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "type": f"https://tools.ietf.org/html/rfc9110#section-15.5.{exc.status_code - 399}",
            "title": exc.title,
            "status": exc.status_code,
            "detail": exc.detail,
            "instance": str(request.url),
        },
    )
```

## Request Validation (Pydantic)
```python
from pydantic import BaseModel, EmailStr, Field
from uuid import UUID

class CreateProducerRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    contact_email: EmailStr
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)

class UpdateProducerRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    contact_email: EmailStr | None = None
```

## Pagination
```python
from pydantic import BaseModel
from typing import Generic, TypeVar
from math import ceil

T = TypeVar("T")

class PagedResult(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total_count: int

    @property
    def total_pages(self) -> int:
        return ceil(self.total_count / self.page_size)

    @property
    def has_next(self) -> bool:
        return self.page < self.total_pages

    @property
    def has_previous(self) -> bool:
        return self.page > 1
```

## HTTP Status Code Guide

| Status | When to Use |
|--------|-------------|
| 200 OK | GET success, PUT/PATCH success with body |
| 201 Created | POST success |
| 204 No Content | PUT/DELETE success, no body |
| 400 Bad Request | Validation failure |
| 401 Unauthorized | Missing or invalid authentication |
| 403 Forbidden | Authenticated but insufficient permissions |
| 404 Not Found | Resource doesn't exist |
| 409 Conflict | Duplicate resource |
| 422 Unprocessable | Pydantic validation error (FastAPI default) |
| 500 Internal Server | Unhandled exception (never expose details) |

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes + HTTPException)
❌ Expose stack traces to clients (use exception handlers)
❌ Business logic in route functions (delegate to service layer)
❌ Accept raw dicts instead of Pydantic models (no validation)
❌ Return ORM models directly (return Pydantic response models)
❌ Bare except without logging (always log, then re-raise or handle)
```

## See Also

- `security.instructions.md` — Auth middleware, input validation, CORS
- `errorhandling.instructions.md` — Error response format, exception handlers
- `performance.instructions.md` — Hot-path optimization, async patterns
