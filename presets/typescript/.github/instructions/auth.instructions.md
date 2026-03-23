---
description: TypeScript authentication & authorization — JWT/JWKS, middleware guards, multi-tenant, API keys, testing
applyTo: '**/*.ts'
---

# TypeScript Authentication & Authorization

## Middleware Pipeline Order

```typescript
// ⚠️ ORDER MATTERS — incorrect ordering breaks auth silently
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(authMiddleware);          // 1. WHO are you? (parses token → req.user)
app.use(tenantMiddleware);        // 2. WHICH tenant? (extracts tenant context)
app.use('/api', rateLimiter);     // 3. Rate limiting (after auth for per-user limits)
app.use('/api', routes);          // 4. Routes (authorization checked per-route)
app.use(errorHandler);            // Last — catches auth errors too
```

## JWT / JWKS Validation

### Express JWT Middleware (JWKS-based)
```typescript
import { expressjwt, GetVerificationKey } from 'express-jwt';
import jwksRsa from 'jwks-rsa';

export const authMiddleware = expressjwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `${process.env.AUTH_ISSUER}/.well-known/jwks.json`,
  }) as GetVerificationKey,
  audience: process.env.AUTH_AUDIENCE,
  issuer: process.env.AUTH_ISSUER,
  algorithms: ['RS256'],
  requestProperty: 'auth', // Populates req.auth (not req.user)
});

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      auth?: {
        sub: string;
        email?: string;
        roles?: string[];
        scope?: string;
        tenant_id?: string;
        [key: string]: unknown;
      };
    }
  }
}
```

### Optional Auth (Public + Authenticated Routes)
```typescript
export const optionalAuth = expressjwt({
  secret: jwksRsa.expressJwtSecret({
    jwksUri: `${process.env.AUTH_ISSUER}/.well-known/jwks.json`,
  }) as GetVerificationKey,
  audience: process.env.AUTH_AUDIENCE,
  issuer: process.env.AUTH_ISSUER,
  algorithms: ['RS256'],
  credentialsRequired: false, // Don't reject unauthenticated requests
  requestProperty: 'auth',
});
```

## Authorization Guards

### Role Guard
```typescript
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new UnauthorizedError('Authentication required');
    }

    const userRoles = req.auth.roles ?? [];
    const hasRole = roles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      throw new ForbiddenError(`Requires one of: ${roles.join(', ')}`);
    }

    next();
  };
}

// Usage
router.delete('/:id', requireRole('admin'), deleteProduct);
```

### Scope Guard (OAuth2 Scopes)
```typescript
export function requireScope(...scopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new UnauthorizedError('Authentication required');
    }

    const tokenScopes = req.auth.scope?.split(' ') ?? [];
    const hasScope = scopes.every((s) => tokenScopes.includes(s));

    if (!hasScope) {
      throw new ForbiddenError(`Requires scopes: ${scopes.join(', ')}`);
    }

    next();
  };
}

// Usage
router.get('/products', requireScope('products:read'), listProducts);
router.post('/products', requireScope('products:write'), createProduct);
```

### Resource-Level Guard
```typescript
export function requireOwnerOrAdmin(getResourceOwnerId: (req: Request) => Promise<string>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw new UnauthorizedError('Authentication required');

    const isAdmin = req.auth.roles?.includes('admin') ?? false;
    if (isAdmin) return next();

    const ownerId = await getResourceOwnerId(req);
    if (ownerId !== req.auth.sub) {
      throw new ForbiddenError('You can only access your own resources');
    }

    next();
  };
}
```

## Multi-Tenant Isolation

### Tenant Middleware
```typescript
export interface TenantContext {
  tenantId: string;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

export function tenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(); // Unauthenticated routes skip tenant

  const tenantId = req.auth.tenant_id ?? req.headers['x-tenant-id'];

  if (!tenantId || typeof tenantId !== 'string') {
    throw new ForbiddenError('Missing tenant context');
  }

  req.tenant = { tenantId };
  next();
}
```

### Tenant-Scoped Repository
```typescript
export class ProductRepository {
  constructor(
    private readonly db: Database,
    private readonly tenantId: string,
  ) {}

  async findById(id: string): Promise<Product | null> {
    // ✅ ALWAYS scope queries to tenant
    return this.db.query(
      'SELECT * FROM products WHERE id = $1 AND tenant_id = $2',
      [id, this.tenantId],
    );
  }

  // ❌ NEVER: Unscoped query
  // return this.db.query('SELECT * FROM products WHERE id = $1', [id]);
}
```

## API Key Authentication (Machine-to-Machine)

```typescript
import crypto from 'crypto';

export async function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || typeof apiKey !== 'string') return next(); // Fall through to JWT

  // Constant-time comparison to prevent timing attacks
  const client = await apiKeyService.findByKey(apiKey);
  if (!client) {
    throw new UnauthorizedError('Invalid API key');
  }

  // Populate req.auth with client identity
  req.auth = {
    sub: client.clientId,
    tenant_id: client.tenantId,
    roles: client.roles,
    scope: client.scopes.join(' '),
  };

  next();
}

// Validate keys using constant-time comparison
function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Register: API key checked first, then JWT
app.use(apiKeyAuth);
app.use(authMiddleware);
```

## Current User Helper

```typescript
export interface CurrentUser {
  id: string;
  email: string | undefined;
  tenantId: string;
  roles: string[];
  hasRole(role: string): boolean;
  hasScope(scope: string): boolean;
}

export function getCurrentUser(req: Request): CurrentUser {
  if (!req.auth) throw new UnauthorizedError('Not authenticated');

  const scopes = req.auth.scope?.split(' ') ?? [];
  const roles = req.auth.roles ?? [];

  return {
    id: req.auth.sub,
    email: req.auth.email,
    tenantId: req.tenant?.tenantId ?? '',
    roles,
    hasRole: (role: string) => roles.includes(role),
    hasScope: (scope: string) => scopes.includes(scope),
  };
}
```

## Cookie-Based Sessions (Web Apps)

```typescript
import session from 'express-session';
import RedisStore from 'connect-redis';

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
    httpOnly: true,       // Not accessible via JavaScript
    sameSite: 'strict',   // CSRF protection
    maxAge: 30 * 60 * 1000, // 30 minutes
  },
}));
```

## Testing Auth

### Mock Auth Middleware for Tests
```typescript
export function mockAuth(overrides: Partial<Express.Request['auth']> = {}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      sub: 'test-user-id',
      email: 'test@example.com',
      roles: ['user'],
      scope: 'products:read products:write',
      tenant_id: 'test-tenant',
      ...overrides,
    };
    req.tenant = { tenantId: overrides.tenant_id ?? 'test-tenant' };
    next();
  };
}

// In test setup
const app = createApp();
app.use(mockAuth({ roles: ['admin'] }));  // Instead of real JWT validation
app.use('/api', routes);
```

### Supertest with Auth
```typescript
describe('GET /api/products', () => {
  it('returns 401 without token', async () => {
    await request(app).get('/api/products').expect(401);
  });

  it('returns 403 without required scope', async () => {
    await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenWithoutScope}`)
      .expect(403);
  });

  it('returns products for authenticated user', async () => {
    await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
  });
});
```

## Rules

- ALWAYS validate JWT with JWKS (key rotation) — never hardcode secrets for RS256
- ALWAYS use `algorithms: ['RS256']` — never allow `none` or weak algorithms
- NEVER trust client headers for tenant ID without JWT claim validation
- NEVER store tokens in `localStorage` — use HttpOnly secure cookies
- NEVER skip tenant filtering in queries — every data query must be scoped
- Use middleware guards for route-level auth — never check roles inside services
- Use `crypto.timingSafeEqual` for API key comparison — never `===`
- Keep auth middleware separate from business logic — inject `CurrentUser` into services
- Test all auth boundary cases: missing token, expired token, wrong role, wrong tenant

## See Also

- `security.instructions.md` — Input validation, secrets management, CORS, rate limiting
- `graphql.instructions.md` — GraphQL resolver-level auth context
- `api-patterns.instructions.md` — Auth middleware in route pipelines
