/**
 * SSO authentication provider stub for Plan Forge MCP.
 *
 * Placeholder for future enterprise SSO / OIDC integration (e.g., Entra ID,
 * Okta, GitHub OIDC). Always returns ok:false with a clear not-implemented
 * message so callers get a predictable, actionable error rather than a crash.
 *
 * Replace the body of `authenticateSso` when a real SSO provider is wired in.
 *
 * @module auth/providers/sso-stub
 */

/**
 * @typedef {Object} AuthResult
 * @property {boolean} ok       - Whether authentication succeeded
 * @property {string}  token    - The validated token (empty string on failure)
 * @property {string}  [error]  - Human-readable reason for failure
 */

/**
 * SSO authentication — not yet implemented.
 *
 * @param {Object} _req  - Incoming request context (unused)
 * @param {Object} _opts - Provider options (unused)
 * @returns {AuthResult}
 */
export function authenticateSso(_req, _opts = {}) {
  return {
    ok: false,
    token: "",
    error: "SSO provider not yet implemented — use bearer token authentication",
  };
}
