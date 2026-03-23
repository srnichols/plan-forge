---
description: TypeScript security patterns — authentication, authorization, input validation, secrets
applyTo: '**/*.ts,**/*.tsx'
---

# TypeScript Security Patterns

## Input Validation (Zod)

```typescript
import { z } from 'zod';

// ✅ Validate all incoming data
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['user', 'admin']),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

// In route handler
const parsed = CreateUserSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ errors: parsed.error.flatten() });
}
```

## Authentication

### JWT Middleware (Express)
```typescript
import { expressjwt } from 'express-jwt';
import jwksRsa from 'jwks-rsa';

const authMiddleware = expressjwt({
  secret: jwksRsa.expressJwtSecret({
    jwksUri: `${process.env.AUTH_ISSUER}/.well-known/jwks.json`,
  }),
  audience: process.env.AUTH_AUDIENCE,
  issuer: process.env.AUTH_ISSUER,
  algorithms: ['RS256'],
});
```

## Secrets Management

```typescript
// ❌ NEVER: Hardcoded secrets
const dbPassword = 'secret123';

// ✅ ALWAYS: Environment variables
const dbPassword = process.env.DATABASE_PASSWORD;
if (!dbPassword) throw new Error('DATABASE_PASSWORD not set');

// ✅ BEST: Validated config
import { z } from 'zod';
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'production', 'test']),
});
const env = envSchema.parse(process.env);
```

## SQL Injection Prevention

```typescript
// ❌ NEVER: String interpolation
const result = await db.query(`SELECT * FROM users WHERE id = '${id}'`);

// ✅ ALWAYS: Parameterized
const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);

// ✅ BEST: Use ORM (Prisma prevents injection by default)
const user = await prisma.user.findUnique({ where: { id } });
```

## Type Safety

```typescript
// ❌ NEVER: `any` type
function processData(data: any) { ... }

// ✅ ALWAYS: Explicit types
function processData(data: UserInput): ProcessedUser { ... }

// ❌ NEVER: Type assertions to bypass safety
const user = rawData as User;

// ✅ ALWAYS: Runtime validation
const user = UserSchema.parse(rawData);
```

## CORS Configuration

```typescript
import cors from 'cors';

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
```

## Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 1000,            // per IP
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false,
  message: { title: 'Too Many Requests', status: 429 },
});
app.use(globalLimiter);

// Tenant-scoped rate limiter
const tenantLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.tenantId ?? req.ip,
});
app.use('/api/', tenantLimiter);
```

## Security Headers

```typescript
import helmet from 'helmet';

// Helmet sets secure headers automatically
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
// Sets: X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,
//       Content-Security-Policy, Referrer-Policy, X-XSS-Protection
```

## Common Vulnerabilities to Prevent

| Vulnerability | Prevention |
|--------------|------------|
| SQL Injection | Parameterized queries, Prisma ORM |
| XSS | Output encoding, CSP headers, Helmet middleware |
| CSRF | SameSite cookies, CSRF tokens for forms |
| Prototype Pollution | Validate input with Zod, avoid `Object.assign` on user input |
| SSRF | Validate/allowlist outbound URLs |
| Path Traversal | `path.resolve()` + validate against base dir |
| ReDoS | Avoid unbounded regex, use Zod for validation |

## OWASP Top 10 (2021) Alignment

| OWASP Category | How This File Addresses It |
|----------------|----------------------------|
| A01: Broken Access Control | JWT middleware, role-based route guards |
| A02: Cryptographic Failures | JWKS-based key resolution, env-based secrets |
| A03: Injection | Zod schema validation, parameterized SQL |
| A04: Insecure Design | Explicit types over `any`, runtime validation |
| A05: Security Misconfiguration | CORS allowlist from env, validated config schema |
| A07: Identification & Auth Failures | RS256 JWT, audience + issuer validation |

## See Also

- `auth.instructions.md` — JWT/JWKS, middleware guards, multi-tenant isolation, API keys
- `graphql.instructions.md` — GraphQL authorization, resolver-level auth context
- `dapr.instructions.md` — Dapr secrets management, component scoping, mTLS
- `database.instructions.md` — SQL injection prevention, parameterized queries
- `api-patterns.instructions.md` — Auth middleware, request validation
- `deploy.instructions.md` — Secrets management, TLS configuration
