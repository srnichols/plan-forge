/**
 * Auth module for Plan Forge MCP.
 *
 * Provides a single `authenticate(req, opts)` entry point that delegates
 * to one of the registered providers based on `opts.provider`.
 *
 * Supported providers:
 *   - "bearer" (default) — Authorization: Bearer <token> or PFORGE_AUTH_TOKEN env var
 *   - "sso"              — Enterprise SSO / OIDC stub (not yet implemented)
 *   - "none"             — Bypass auth (local / trusted environments only)
 *
 * @module auth
 */

import { authenticateBearer } from "./providers/bearer.mjs";
import { authenticateSso } from "./providers/sso-stub.mjs";

/**
 * @typedef {Object} AuthResult
 * @property {boolean} ok       - Whether authentication succeeded
 * @property {string}  token    - The validated token (empty string on failure)
 * @property {string}  provider - Which provider handled the request
 * @property {string}  [error]  - Human-readable reason for failure
 */

/**
 * @typedef {Object} AuthOptions
 * @property {"bearer"|"sso"|"none"} [provider="bearer"] - Auth provider to use
 * @property {string}  [token]                           - Expected token (bearer only)
 */

/**
 * Authenticate an incoming request.
 *
 * @param {Object}      req  - Incoming request context (must have `headers` map)
 * @param {AuthOptions} [opts]
 * @returns {AuthResult}
 */
export function authenticate(req, opts = {}) {
  const provider = opts.provider ?? "bearer";

  switch (provider) {
    case "none":
      return { ok: true, token: "", provider: "none" };

    case "sso": {
      const result = authenticateSso(req, opts);
      return { ...result, provider: "sso" };
    }

    case "bearer":
    default: {
      const result = authenticateBearer(req, opts);
      return { ...result, provider: "bearer" };
    }
  }
}
