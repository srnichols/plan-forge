# Plan Forge — SSO Extension Point

> **Phase**: Phase-AUTH-RBAC-SCAFFOLD  
> **Status**: Interface defined — stub shipped, first real provider deferred to Phase-ENTRA-SSO  
> **Source**: `docs/research/enterprise-fleet-readiness.md` §8.1, Required Decision #5

---

## Overview

Plan Forge defines a minimal SSO provider interface that allows enterprise identity providers (Entra ID, Okta, GitHub OIDC, etc.) to be plugged in without modifying the core auth module. This document describes the contract, lifecycle, error handling, and how to implement a real provider from the scaffold shipped in this phase.

---

## Provider Interface

An SSO provider is a module that exports two functions:

```ts
interface SsoProvider {
  /**
   * Authenticate an incoming request.
   * Returns an AuthResult on success or failure.
   * MUST NOT throw — return ok:false with an error message instead.
   */
  authenticate(req: Request, opts?: SsoOptions): AuthResult;

  /**
   * Probe the IdP endpoint to verify connectivity.
   * Called at process start and by health-check routes.
   * Returns true if the IdP is reachable, false otherwise.
   */
  healthCheck(): Promise<boolean>;
}
```

### AuthResult shape

```ts
interface AuthResult {
  ok:       boolean;    // true on successful authentication
  token:    string;     // subject identifier (user ID, email, or claim value)
  provider: string;     // provider name for logging
  error?:   string;     // human-readable reason on failure
}
```

The `token` field on a successful SSO result carries the subject identifier that becomes the RBAC principal key (used as the key into `assignments` in `.forge/rbac.json`).

---

## Current Provider

`pforge-mcp/auth/providers/entra-oidc.mjs` ships a full Entra ID OIDC implementation (Phase-ENTRA-SSO):

```js
export async function authenticateEntraOidc(req, opts = {}) { ... }
export async function healthCheck(tenantId = "common") { ... }
```

The legacy `sso-stub.mjs` remains for backward compatibility but is deprecated. Operators using `provider: "sso"` should migrate to `provider: "entra-oidc"`.

---

## Legacy Stub

`pforge-mcp/auth/providers/sso-stub.mjs` is a retained placeholder:

```js
export function authenticateSso(_req, _opts = {}) {
  return {
    ok:    false,
    token: "",
    error: "SSO provider not yet implemented — use bearer token authentication",
  };
}
```

Requesting `provider: "sso"` still returns `ok: false`. Migrate to `provider: "entra-oidc"`.

---

## Implementing a Real Provider

Replace the body of `authenticateSso` (or create a new module and register it) following these steps:

### Step 1 — Create the provider module

```js
// pforge-mcp/auth/providers/entra-oidc.mjs

export async function authenticateEntraOidc(req, opts = {}) {
  const headers = req?.headers ?? {};
  const authHeader = headers["authorization"] ?? headers["Authorization"] ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());

  if (!match) {
    return { ok: false, token: "", error: "No bearer token provided" };
  }

  const rawToken = match[1];

  try {
    const claims = await verifyEntraToken(rawToken, opts);
    return { ok: true, token: claims.sub ?? claims.oid, provider: "entra-oidc" };
  } catch (err) {
    return { ok: false, token: "", error: `Token verification failed: ${err.message}` };
  }
}

export async function healthCheck() {
  try {
    const res = await fetch(`${ENTRA_METADATA_URL}/.well-known/openid-configuration`);
    return res.ok;
  } catch {
    return false;
  }
}
```

### Step 2 — Register in index.mjs

Add a `case` branch to the `authenticate()` switch:

```js
case "entra-oidc": {
  const result = await authenticateEntraOidc(req, opts);
  return { ...result, provider: "entra-oidc" };
}
```

### Step 3 — Wire the config

Add the provider name to `.forge/config.json`:

```json
{
  "auth": {
    "provider": "entra-oidc",
    "entraOidc": {
      "tenantId": "<AZURE_TENANT_ID>",
      "clientId": "<AZURE_CLIENT_ID>",
      "audience": "api://<APP_ID>"
    }
  }
}
```

### Step 4 — Map identities to RBAC roles

In `.forge/rbac.json`, use the subject claim value (`sub` or `oid`) as the assignment key:

```json
{
  "assignments": {
    "00000000-0000-0000-0000-000000000001": ["developer"],
    "00000000-0000-0000-0000-000000000002": ["admin"]
  }
}
```

---

## Lifecycle

### Process startup

1. `server.mjs` reads `.forge/config.json` to determine the configured provider.
2. If the provider exports `healthCheck`, it is called once. A `false` result logs a warning but does NOT prevent startup — the provider may become healthy after a brief IdP cold start.
3. The resolved provider is set for the process lifetime. Hot-reload is not supported; restart Plan Forge to change the active provider.

### Per-request flow

```
Request arrives
  └─► withAuth(handler, opts)
        ├─ authenticate(req, opts)  ← provider dispatched here
        │     ├─ Bearer: extract + match token
        │     ├─ SSO:    verify JWT / OIDC claims with IdP
        │     └─ None:   always ok (local bypass)
        ├─ resolveRoles(principal, rbacConfig)
        ├─ hasScope(roles, requiredScope, rbacConfig)
        └─ req.auth = authResult → handler
```

---

## Error Handling

### Provider MUST NOT throw

Providers should catch all internal errors and return `{ ok: false, error: "..." }`. An unhandled exception in an auth provider is treated as a `500 Internal Server Error` by the middleware.

### Error response shapes

| Condition | HTTP status | Response body |
|---|---|---|
| No token / bad format | 401 | `{ "ok": false, "error": "No bearer token provided" }` |
| Token invalid / expired | 401 | `{ "ok": false, "error": "Token verification failed: ..." }` |
| Scope not granted | 403 | `{ "ok": false, "error": "Forbidden: scope \"plans:write\" is required" }` |
| RBAC config missing when scope required | 500 | `{ "ok": false, "error": "Server configuration error: RBAC config required when scope is set" }` |

### Auth decision events

Every 401 and 403 outcome emits an `auth-decision` event to `events.log`:

```json
{
  "source": "auth",
  "security_risk": "high",
  "result": "denied",
  "reason": "Token verification failed: signature invalid",
  "provider": "entra-oidc",
  "scope": "bridge:edit"
}
```

Token values are never logged. Use `redactSecrets` from `pforge-mcp/secrets.mjs` if any auth event data might contain token fragments.

---

## Constraints

- **No required npm dependencies in this phase.** The first real provider (`Phase-ENTRA-SSO`) will introduce `@azure/identity` as an optional dep, following the pattern established by the Foundry provider.
- **`@azure/identity` is already available as an optional dep** (added by Phase-FOUNDRY-PROVIDER). SSO providers that use Entra / Managed Identity may import it dynamically without a new `package.json` entry.
- **The `claims` object on the identity shape is open for extension.** SSO providers may attach arbitrary claims without breaking the `AuthResult` contract.
- **SSO providers should be stateless per request.** Caching JWKS keys or token introspection results is allowed (and encouraged for performance) but must be safe for concurrent calls.

---

## Future Providers (Planned)

| Phase | Provider | Notes |
|---|---|---|
| Phase-ENTRA-SSO | Entra ID / Azure AD OIDC | ✅ Shipped — `pforge-mcp/auth/providers/entra-oidc.mjs` |
| Phase-OKTA-SSO | Okta OIDC | Standard OIDC discovery doc |
| Phase-GITHUB-OIDC | GitHub Actions OIDC | Validates `sub` claim for CI/CD automation |
