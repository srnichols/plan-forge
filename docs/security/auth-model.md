# Plan Forge — Authentication Model

> **Phase**: Phase-AUTH-RBAC-SCAFFOLD  
> **Status**: Scaffold shipped — bearer provider active, SSO provider interface defined, RBAC config-driven  
> **Source**: `docs/research/enterprise-fleet-readiness.md` §8.1

---

## Overview

Plan Forge uses a pluggable authentication model. A single `authenticate(req, opts)` entry point in `pforge-mcp/auth/index.mjs` delegates to a registered provider and returns a normalized `AuthResult`. All server-side auth decisions flow through this single gate.

### Current state

Out of the box, Plan Forge ships with one active provider:

| Provider | Status | Source |
|---|---|---|
| `bearer` | ✅ Active | `pforge-mcp/auth/providers/bearer.mjs` |
| `sso` | 🔲 Stub only | `pforge-mcp/auth/providers/sso-stub.mjs` |
| `none` | ✅ Local bypass | `pforge-mcp/auth/index.mjs` |

The **bearer** provider validates a secret token via `Authorization: Bearer <token>` or the `PFORGE_AUTH_TOKEN` environment variable. It is backward-compatible with the pre-Phase-AUTH-RBAC-SCAFFOLD `bridge.approvalSecret` flow.

---

## Identity Shape

A successful authentication returns an `AuthResult`:

```js
{
  ok:       true,
  token:    "<validated-token-string>",
  provider: "bearer" | "sso" | "none"
}
```

On failure:

```js
{
  ok:       false,
  token:    "",
  provider: "bearer" | "sso" | "none",
  error:    "Human-readable reason"
}
```

For SSO providers, the `token` field carries the subject identifier (user ID, email, or claim value) that is then used as the RBAC principal key.

---

## Provider Selection

The provider is selected via the `opts.provider` argument passed to `authenticate()`:

| Value | Provider |
|---|---|
| `"bearer"` (default) | Token from `Authorization` header or env var |
| `"sso"` | Enterprise SSO / OIDC (stub — not yet implemented) |
| `"none"` | Always succeeds — use only in trusted local environments |

When no `opts.provider` is specified, `"bearer"` is used.

---

## Bearer Provider

The bearer provider (`pforge-mcp/auth/providers/bearer.mjs`) validates tokens in two modes:

### Permissive mode (solo operator / local dev)

When no expected token is configured (`opts.token` is absent), any non-empty token is accepted. This preserves the pre-RBAC behavior for solo operators who have not set an approval secret.

### Strict mode (team / enterprise)

When `opts.token` is set (typically from `.forge/config.json` `bridge.approvalSecret` or `PFORGE_APPROVAL_SECRET`), the extracted token must match exactly.

**Token extraction order**:
1. `Authorization: Bearer <token>` header (case-insensitive `Bearer` prefix)
2. `PFORGE_AUTH_TOKEN` environment variable

---

## Middleware

`pforge-mcp/auth/middleware.mjs` exports `withAuth(handler, opts)` which wraps any `(req, res)` handler:

1. **Authentication** — calls `authenticate(req, opts)`. Returns `401` on failure.
2. **Authorization** — if `opts.scope` is set, resolves the principal's RBAC roles and checks the required scope. Returns `403` on failure.
3. **Context enrichment** — sets `req.auth = authResult` before invoking the original handler.

```js
import { withAuth } from "./auth/middleware.mjs";

// Read-only route — no scope required
router.get("/status", withAuth(statusHandler, { provider: "bearer", token: secret }));

// Write route — requires "plans:write" scope
router.post("/plans", withAuth(plansHandler, {
  provider: "bearer",
  token:    secret,
  scope:    "plans:write",
  rbac:     rbacConfig,
}));
```

---

## Security Boundaries

### What auth enforces

- Identity verification (token present and valid)
- RBAC scope checks (when `.forge/rbac.json` is present)
- `bridge:edit` authorization before allowing file edits

### What auth does NOT enforce

- Network-level controls (mTLS, IP allowlists) — operator/infra concern
- Encryption at rest for `.forge/secrets.json` — operator concern
- Multi-tenant data segregation — orthogonal; out of scope this phase
- Approval workflows (n-of-m human approvers) — planned for a future phase

### Backward compatibility

When `.forge/rbac.json` is absent, Plan Forge behaves identically to the pre-RBAC state: bearer-only, no scope enforcement. Scope checks are skipped entirely; any valid token is sufficient.

This invariant is non-negotiable. Solo operators must never be locked out by missing config.

---

## Auth Decision Events

Authentication and authorization outcomes are recorded as `auth-decision` events in `events.log` using the Phase-TRAJECTORY-SCHEMA-HARDENING schema:

```json
{
  "source": "auth",
  "security_risk": "medium",
  "result": "allowed",
  "provider": "bearer",
  "principal": "<token-hash>",
  "scope": "bridge:edit"
}
```

Denials use `security_risk: "high"` and `result: "denied"`. Tokens are never logged in plaintext; use `redactSecrets` from `pforge-mcp/secrets.mjs` when emitting any auth event that touches token values.

---

## Adding a New Provider

1. Create `pforge-mcp/auth/providers/<name>.mjs` that exports an `authenticate<Name>(req, opts)` function returning `AuthResult`.
2. Register the provider in `pforge-mcp/auth/index.mjs` by adding a `case "<name>":` branch.
3. Add `healthCheck()` if the provider connects to an external IdP.
4. Document the provider in `docs/security/sso-extension-point.md` if it is an enterprise SSO variant.
5. The new provider MUST NOT add required npm dependencies without a corresponding plan update.

See `docs/security/sso-extension-point.md` for the full SSO provider contract.

---

## Read-Only Tool Defaults

The following tools require no scope and succeed for any authenticated principal (or even unauthenticated callers when `rbac.json` is absent):

- `forge_capabilities`
- `forge_status`
- `forge_search`
- `forge_timeline`
- `forge_watch_live`
- `forge_home_snapshot`
- `forge_cost_report`
- `forge_plan_status`
- `forge_diff`

Operators can restrict any of these by adding explicit scope requirements in `.forge/rbac.json`. New tools added to `server.mjs` require an explicit scope decision before shipping — document the decision in the PR.
