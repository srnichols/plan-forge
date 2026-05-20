/**
 * HTTP middleware factory for Plan Forge MCP authentication + authorization.
 *
 * `withAuth` wraps a Node.js-style `(req, res)` handler and enforces:
 *   1. Authentication  — delegates to `authenticate()` (bearer, sso, or none)
 *   2. Authorization   — optional RBAC scope check via `resolveRoles` / `hasScope`
 *
 * On failure the wrapper writes a JSON error body and calls `res.end()` so the
 * original handler is never invoked. On success the request context is enriched
 * with `req.auth` before the handler is called.
 *
 * @module auth/middleware
 */

import { authenticate } from "./index.mjs";
import { resolveRoles, hasScope } from "./rbac.mjs";

/**
 * @typedef {Object} WithAuthOptions
 * @property {"bearer"|"sso"|"none"} [provider="bearer"] - Auth provider
 * @property {string}  [token]   - Expected bearer token (bearer provider only)
 * @property {string}  [scope]   - Required RBAC scope (e.g. "plans:read")
 * @property {import("./rbac.mjs").RbacConfig} [rbac] - RBAC config (required when scope is set)
 */

/**
 * Wrap a `(req, res)` handler with authentication and optional authorization.
 *
 * @param {Function}        handler - The route handler to protect
 * @param {WithAuthOptions} [opts]
 * @returns {Function} A new handler that enforces auth before calling `handler`
 */
export function withAuth(handler, opts = {}) {
  return async function authGuard(req, res, ...rest) {
    // ── Step 1: Authentication ──────────────────────────────────────────
    const authResult = await authenticate(req, opts);

    if (!authResult.ok) {
      return sendAuthError(res, 401, authResult.error ?? "Unauthorized");
    }

    // ── Step 2: Authorization (RBAC scope check, if requested) ──────────
    if (opts.scope) {
      const rbac = opts.rbac;
      if (!rbac) {
        return sendAuthError(
          res,
          500,
          "Server configuration error: RBAC config required when scope is set"
        );
      }

      // Use the token as the principal key for role lookup
      const principal = authResult.token;
      const roles = resolveRoles(principal, rbac);

      if (!hasScope(roles, opts.scope, rbac)) {
        return sendAuthError(
          res,
          403,
          `Forbidden: scope "${opts.scope}" is required`
        );
      }
    }

    // ── Step 3: Enrich request context and invoke handler ───────────────
    req.auth = authResult;
    return handler(req, res, ...rest);
  };
}

/**
 * Write a JSON error response and end the response.
 *
 * @param {Object} res     - Node.js ServerResponse
 * @param {number} status  - HTTP status code (401, 403, 500, …)
 * @param {string} message - Human-readable error description
 */
function sendAuthError(res, status, message) {
  const body = JSON.stringify({ ok: false, error: message });
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
