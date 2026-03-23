---
description: "Scaffold FastAPI middleware with request/response hooks, Depends injection, and structured logging."
agent: "agent"
tools: [read, edit, search]
---
# Create New Middleware

Scaffold a FastAPI middleware or dependency for the HTTP request pipeline.

## Required Pattern

### BaseHTTPMiddleware (Request/Response Access)
```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
import time
import structlog

logger = structlog.get_logger()

class {Name}Middleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # Pre-processing
        start = time.perf_counter()

        response = await call_next(request)

        # Post-processing
        duration = time.perf_counter() - start
        logger.info(
            "{name}_complete",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration * 1000, 2),
        )
        return response
```

### Pure ASGI Middleware (High-Performance)
```python
from starlette.types import ASGIApp, Receive, Scope, Send

class {Name}Middleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Pre-processing on scope
        await self.app(scope, receive, send)
```

### Depends-Based Middleware (Per-Route)
```python
from fastapi import Depends, Request

async def require_tenant(request: Request) -> str:
    tenant_id = request.headers.get("X-Tenant-Id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Missing X-Tenant-Id header")
    return tenant_id

@router.get("/items")
async def list_items(tenant_id: str = Depends(require_tenant)):
    ...
```

## Registration Order (main.py)

```python
# Order matters! Last added = outermost = runs first
app.add_middleware({Name}Middleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"])
app.add_middleware(CorrelationIdMiddleware)
# Note: Middleware added LAST runs FIRST in FastAPI/Starlette
```

## Common Middleware Types

| Type | Purpose | Example |
|------|---------|---------|
| Correlation ID | Attach trace ID to every request | `contextvars` + `X-Correlation-Id` |
| Tenant Resolution | Extract tenant from JWT/header | `request.state.tenant_id = ...` |
| Request Logging | Log method, path, status, duration | `structlog` structured output |
| Exception Handler | Map exceptions to JSON responses | `@app.exception_handler(AppException)` |

## Rules

- Middleware handles cross-cutting concerns ONLY — no business logic
- Use `BaseHTTPMiddleware` for simple cases, raw ASGI for hot paths
- Use `Depends()` for per-route concerns (auth, tenant resolution)
- Store request-scoped state on `request.state` — not module globals
- Use `contextvars` for values that need to propagate to async tasks

## Reference Files

- [Security instructions](../instructions/security.instructions.md)
- [Observability instructions](../instructions/observability.instructions.md)
- [Architecture principles](../instructions/architecture-principles.instructions.md)
