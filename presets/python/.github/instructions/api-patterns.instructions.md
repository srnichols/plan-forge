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

## API Versioning

### URL-based Versioning (Recommended)
```python
from fastapi import APIRouter, FastAPI

v1_router = APIRouter(prefix="/api/v1")
v2_router = APIRouter(prefix="/api/v2")

# v1 routes
@v1_router.get("/producers", response_model=list[ProducerResponseV1])
async def list_producers_v1():
    return await producer_service.get_all_v1()

# v2 routes (expanded fields)
@v2_router.get("/producers", response_model=list[ProducerResponseV2])
async def list_producers_v2():
    return await producer_service.get_all_v2()

app = FastAPI()
app.include_router(v1_router)
app.include_router(v2_router)
```

### Header-based Versioning
```python
from fastapi import Header, Depends

async def get_api_version(api_version: str = Header(default="1")) -> int:
    return int(api_version)

@router.get("/producers")
async def list_producers(version: int = Depends(get_api_version)):
    if version >= 2:
        return await producer_service.get_all_v2()
    return await producer_service.get_all_v1()
```

### Version Discovery Endpoint
```python
@app.get("/api/versions")
async def api_versions():
    return {
        "supported": ["v1", "v2"],
        "current": "v2",
        "deprecated": ["v1"],
        "sunset": {"v1": "2026-01-01"},
    }
```

### Deprecation Headers Middleware
```python
from starlette.middleware.base import BaseHTTPMiddleware

class DeprecationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/v1"):
            response.headers["Sunset"] = "Sat, 01 Jan 2026 00:00:00 GMT"
            response.headers["Deprecation"] = "true"
            response.headers["Link"] = '</api/v2/docs>; rel="successor-version"'
        return response

app.add_middleware(DeprecationMiddleware)
```

### Non-Negotiable Rules
- **ALWAYS** version APIs from day one — `/api/v1/`
- **NEVER** break existing consumers — add a new version instead
- Deprecation requires minimum 6-month sunset window
- Return `410 Gone` after sunset date, not `404`
- Document version differences in OpenAPI schema (`/docs`)

## Anti-Patterns

```
❌ Return 200 for errors (use proper status codes + HTTPException)
❌ Expose stack traces to clients (use exception handlers)
❌ Business logic in route functions (delegate to service layer)
❌ Accept raw dicts instead of Pydantic models (no validation)
❌ Return ORM models directly (return Pydantic response models)
❌ Bare except without logging (always log, then re-raise or handle)
```

## API Documentation (OpenAPI)

FastAPI generates OpenAPI 3.1 automatically from route definitions and Pydantic models.

```python
from fastapi import FastAPI

app = FastAPI(
    title="MyApp API",
    version="1.0.0",
    docs_url="/docs",       # Swagger UI
    redoc_url="/redoc",     # ReDoc
    openapi_url="/openapi.json",
)

# Enrich endpoints with response models and descriptions
@router.get(
    "/{producer_id}",
    response_model=ProducerResponse,
    responses={
        404: {"description": "Producer not found"},
    },
    summary="Get producer by ID",
)
async def get_producer(producer_id: UUID) -> ProducerResponse:
    ...
```

- **ALWAYS** set `response_model` on all endpoints (drives schema generation)
- **ALWAYS** document error responses in `responses={}` dict
- Use `tags=["producers"]` on routers to group endpoints
- Disable `/docs` in production: `docs_url=None if settings.ENVIRONMENT == "production" else "/docs"`

## See Also

- `version.instructions.md` — Semantic versioning, pre-release, deprecation timelines
- `graphql.instructions.md` — Strawberry schema, resolvers, DataLoaders (for GraphQL APIs)
- `security.instructions.md` — Auth middleware, input validation, CORS
- `errorhandling.instructions.md` — Error response format, exception handlers
- `performance.instructions.md` — Hot-path optimization, async patterns

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "Nobody uses pagination yet" | Unbounded queries return all rows. The first large dataset crashes the client or times out. Add `?page=1&size=20` from the first endpoint. |
| "API versioning can wait until v2" | Unversioned APIs break all consumers on the first change. Add `/api/v1/` router prefix from day one — it costs zero lines of logic. |
| "Error codes aren't needed for MVP" | API consumers parse error codes programmatically. Returning only string messages forces consumers to regex-match errors — brittle and untranslatable. |
| "Returning 200 OK for all responses simplifies the client" | HTTP semantics exist for a reason. Returning 200 for errors breaks caching, monitoring, and every HTTP-aware tool in the pipeline. |
| "This endpoint doesn't need request validation" | Every endpoint accepting input is an attack surface. Validate shape and constraints at the API boundary — Pydantic models handle this automatically in FastAPI. |

---

## Warning Signs

- An endpoint returns an unbounded collection without pagination parameters
- No type annotations or Pydantic response models on route handlers (undocumented API contract)
- Route paths don't include a version segment (`/api/users` instead of `/api/v1/users`)
- HTTP 200 returned for error conditions instead of 4xx/5xx
- Request body accepted as `dict` or `Any` instead of a typed Pydantic model
- Missing `response_model` on FastAPI endpoints (clients can't predict response shape)
