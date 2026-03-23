---
description: Python authentication & authorization — JWT/OIDC, dependency guards, multi-tenant, API keys, testing
applyTo: '**/*.py'
---

# Python Authentication & Authorization

## Middleware / Dependency Order

```python
# ⚠️ ORDER MATTERS — FastAPI dependencies execute in declaration order
app = FastAPI()
app.add_middleware(CORSMiddleware, ...)       # 1. CORS
app.add_middleware(TrustedHostMiddleware, ...) # 2. Trusted hosts
app.add_middleware(TenantMiddleware)           # 3. Tenant extraction (after auth)
# Auth is enforced per-route via Depends(), not global middleware
```

## JWT / OIDC Validation

### FastAPI OAuth2 with JWKS
```python
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from functools import lru_cache
import httpx

security = HTTPBearer()

@lru_cache(maxsize=1)
def get_jwks_client() -> dict:
    """Fetch JWKS from issuer — cached in memory."""
    response = httpx.get(f"{settings.AUTH_ISSUER}/.well-known/jwks.json")
    response.raise_for_status()
    return response.json()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """Validate JWT and return claims. Used as FastAPI dependency."""
    token = credentials.credentials

    try:
        jwks = get_jwks_client()
        unverified_header = jwt.get_unverified_header(token)
        key = next(
            (k for k in jwks["keys"] if k["kid"] == unverified_header.get("kid")),
            None,
        )
        if key is None:
            raise HTTPException(status_code=401, detail="Invalid signing key")

        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.AUTH_AUDIENCE,
            issuer=settings.AUTH_ISSUER,
        )
        return payload

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
```

### Optional Authentication (Public + Authenticated)
```python
from fastapi.security import HTTPBearer

optional_security = HTTPBearer(auto_error=False)

async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Security(optional_security),
) -> dict | None:
    """Returns claims if token present, None otherwise."""
    if credentials is None:
        return None
    return await get_current_user(credentials)
```

## Authorization Guards

### Role Guard
```python
from typing import Callable

def require_role(*roles: str) -> Callable:
    """Dependency that checks the user has at least one of the specified roles."""
    async def guard(user: dict = Depends(get_current_user)) -> dict:
        user_roles = user.get("roles", [])
        if not any(role in user_roles for role in roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(roles)}",
            )
        return user
    return guard


# Usage
@router.delete("/{product_id}", dependencies=[Depends(require_role("admin"))])
async def delete_product(product_id: UUID) -> None:
    ...
```

### Scope Guard (OAuth2 Scopes)
```python
def require_scope(*scopes: str) -> Callable:
    """Dependency that checks the token has all specified scopes."""
    async def guard(user: dict = Depends(get_current_user)) -> dict:
        token_scopes = set(user.get("scope", "").split())
        required = set(scopes)
        if not required.issubset(token_scopes):
            missing = required - token_scopes
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing scopes: {', '.join(missing)}",
            )
        return user
    return guard


# Usage
@router.get("/products", dependencies=[Depends(require_scope("products:read"))])
async def list_products() -> list[ProductResponse]:
    ...
```

### Resource Owner Guard
```python
async def require_owner_or_admin(
    product_id: UUID,
    user: dict = Depends(get_current_user),
    product_service: ProductService = Depends(get_product_service),
) -> dict:
    """Allow access only if the user owns the resource or is an admin."""
    is_admin = "admin" in user.get("roles", [])
    if is_admin:
        return user

    product = await product_service.get_by_id(product_id)
    if product is None or product.owner_id != user["sub"]:
        raise HTTPException(status_code=403, detail="Access denied")

    return user
```

## Multi-Tenant Isolation

### Tenant Middleware
```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Prefer JWT claim, fall back to header
        tenant_id = getattr(request.state, "user", {}).get("tenant_id")
        if not tenant_id:
            tenant_id = request.headers.get("X-Tenant-ID")

        request.state.tenant_id = tenant_id
        response = await call_next(request)
        return response
```

### Tenant Dependency
```python
async def get_tenant_id(
    request: Request,
    user: dict = Depends(get_current_user),
) -> str:
    """Extract and validate tenant context."""
    tenant_id = user.get("tenant_id") or request.headers.get("X-Tenant-ID")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Missing tenant context")
    return tenant_id
```

### Tenant-Scoped Queries
```python
class ProductRepository:
    def __init__(self, session: AsyncSession, tenant_id: str):
        self.session = session
        self.tenant_id = tenant_id

    async def get_by_id(self, product_id: UUID) -> Product | None:
        # ✅ ALWAYS scope queries to tenant
        stmt = select(Product).where(
            Product.id == product_id,
            Product.tenant_id == self.tenant_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    # ❌ NEVER: Unscoped query
    # stmt = select(Product).where(Product.id == product_id)
```

## API Key Authentication (Machine-to-Machine)

```python
import hmac
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def api_key_auth(
    api_key: str | None = Security(api_key_header),
) -> dict | None:
    """Validate API key, return client identity or None."""
    if api_key is None:
        return None

    client = await api_key_service.find_by_key(api_key)
    if client is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    return {
        "sub": client.client_id,
        "tenant_id": client.tenant_id,
        "roles": client.roles,
        "scope": " ".join(client.scopes),
    }


def secure_compare(a: str, b: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    return hmac.compare_digest(a.encode(), b.encode())


# Combined: API key OR JWT
async def get_authenticated_user(
    api_user: dict | None = Depends(api_key_auth),
    jwt_user: dict | None = Depends(get_optional_user),
) -> dict:
    user = api_user or jwt_user
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
```

## Current User Model

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    tenant_id: str
    roles: list[str]
    scopes: list[str]

    def has_role(self, role: str) -> bool:
        return role in self.roles

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes


def to_current_user(claims: dict, tenant_id: str) -> CurrentUser:
    return CurrentUser(
        id=claims["sub"],
        email=claims.get("email"),
        tenant_id=tenant_id,
        roles=claims.get("roles", []),
        scopes=claims.get("scope", "").split(),
    )
```

## Session Authentication (Web Apps)

```python
from starlette.middleware.sessions import SessionMiddleware

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_SECRET,
    session_cookie="session",
    max_age=30 * 60,         # 30 minutes
    same_site="strict",
    https_only=True,         # Secure flag in production
)
```

## Testing Auth

### Override Dependencies in Tests
```python
import pytest
from httpx import AsyncClient, ASGITransport

def make_test_user(**overrides) -> dict:
    """Create mock JWT claims for testing."""
    return {
        "sub": "test-user-id",
        "email": "test@example.com",
        "roles": ["user"],
        "scope": "products:read products:write",
        "tenant_id": "test-tenant",
        **overrides,
    }


@pytest.fixture
def authenticated_client(app: FastAPI) -> AsyncClient:
    """Client with mocked auth dependency."""
    app.dependency_overrides[get_current_user] = lambda: make_test_user()
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def admin_client(app: FastAPI) -> AsyncClient:
    """Client with admin role."""
    app.dependency_overrides[get_current_user] = lambda: make_test_user(roles=["admin"])
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    yield client
    app.dependency_overrides.clear()
```

### Test Authorization Boundaries
```python
class TestProductEndpoints:
    async def test_returns_401_without_token(self, unauthenticated_client):
        response = await unauthenticated_client.get("/api/products")
        assert response.status_code == 401

    async def test_returns_403_without_scope(self, no_scope_client):
        response = await no_scope_client.get("/api/products")
        assert response.status_code == 403

    async def test_returns_products_for_authenticated_user(self, authenticated_client):
        response = await authenticated_client.get("/api/products")
        assert response.status_code == 200

    async def test_tenant_isolation(self, authenticated_client):
        """Ensure user cannot access another tenant's resources."""
        response = await authenticated_client.get("/api/products/other-tenant-product-id")
        assert response.status_code == 404  # Not 403 — don't reveal existence
```

## Rules

- ALWAYS use `python-jose` or `PyJWT` with explicit `algorithms=["RS256"]` — never allow `none`
- ALWAYS validate `aud` and `iss` claims — never skip audience/issuer checks
- NEVER trust client headers for tenant ID without JWT claim validation
- NEVER store tokens in browser `localStorage` — use HttpOnly secure cookies
- NEVER skip tenant filtering in queries — every ORM query must be scoped
- Use FastAPI `Depends()` for auth — never check roles inside service methods
- Use `hmac.compare_digest` for API key comparison — never `==`
- Use `dependency_overrides` in tests — never disable auth middleware globally
- Test all auth boundary cases: missing token, expired token, wrong role, wrong tenant

## See Also

- `security.instructions.md` — Input validation, secrets management, CORS, rate limiting
- `api-patterns.instructions.md` — Auth dependencies in route pipelines
- `testing.instructions.md` — Fixture patterns for auth overrides
