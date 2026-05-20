/**
 * Auth module for Plan Forge MCP.
 *
 * Provides a single `authenticate(req, opts)` entry point that delegates
 * to one of the registered providers based on `opts.provider`.
 *
 * Supported providers:
 *   - "bearer" (default)  — Authorization: Bearer <token> or PFORGE_AUTH_TOKEN env var
 *   - "entra-oidc"        — Entra ID / Azure AD OIDC JWT validation via JWKS
 *   - "sso"               — Legacy SSO stub alias (not yet a real provider)
 *   - "none"              — Bypass auth (local / trusted environments only)
 *
 * @module auth
 */

import { authenticateBearer } from "./providers/bearer.mjs";
import { authenticateSso } from "./providers/sso-stub.mjs";
import { authenticateEntraOidc } from "./providers/entra-oidc.mjs";

/**
 * @typedef {Object} AuthResult
 * @property {boolean} ok       - Whether authentication succeeded
 * @property {string}  token    - The validated token (empty string on failure)
 * @property {string}  provider - Which provider handled the request
 * @property {string}  [error]  - Human-readable reason for failure
 */

/**
 * @typedef {Object} AuthOptions
 * @property {"bearer"|"entra-oidc"|"sso"|"none"} [provider="bearer"] - Auth provider to use
 * @property {string}  [token]      - Expected token (bearer only)
 * @property {Object}  [entraOidc]  - Entra OIDC options (entra-oidc provider only)
 */

/**
 * Authenticate an incoming request.
 *
 * Returns a Promise in all cases so callers can uniformly `await` the result
 * regardless of which provider is active. Synchronous providers (bearer, sso,
 * none) resolve immediately.
 *
 * @param {Object}      req  - Incoming request context (must have `headers` map)
 * @param {AuthOptions} [opts]
 * @returns {Promise<AuthResult>}
 */
export async function authenticate(req, opts = {}) {
  const provider = opts.provider ?? "bearer";

  switch (provider) {
    case "none":
      return { ok: true, token: "", provider: "none" };

    case "entra-oidc": {
      const result = await authenticateEntraOidc(req, opts);
      return { ...result, provider: "entra-oidc" };
    }

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
