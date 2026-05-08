/**
 * Bearer token authentication provider for Plan Forge MCP.
 *
 * Extracts and validates a bearer token from the Authorization header
 * (preferred) or the PFORGE_AUTH_TOKEN environment variable (fallback).
 *
 * @module auth/providers/bearer
 */

const AUTH_HEADER = "authorization";
const ENV_TOKEN_KEY = "PFORGE_AUTH_TOKEN";

/**
 * @typedef {Object} AuthResult
 * @property {boolean} ok       - Whether authentication succeeded
 * @property {string}  token    - The validated token (empty string on failure)
 * @property {string}  [error]  - Human-readable reason for failure
 */

/**
 * Authenticate a request using a bearer token.
 *
 * Accepts tokens via:
 *   - `Authorization: Bearer <token>` header (headers map or object)
 *   - `PFORGE_AUTH_TOKEN` environment variable (when no header is present)
 *
 * When `opts.token` is provided (pre-configured secret) the extracted
 * token must match exactly. If no configured token is set, any non-empty
 * token is accepted (permissive mode — useful in local / dev environments).
 *
 * @param {Object} req                        - Incoming request context
 * @param {Record<string,string>} [req.headers] - HTTP-style headers map
 * @param {Object} [opts]                     - Provider options
 * @param {string} [opts.token]               - Expected token for validation
 * @returns {AuthResult}
 */
export function authenticateBearer(req, opts = {}) {
  const headers = req?.headers ?? {};

  // Normalise header lookup — keys may be lower- or mixed-case
  const authHeader =
    headers[AUTH_HEADER] ??
    headers["Authorization"] ??
    headers["AUTHORIZATION"] ??
    "";

  let extracted = "";
  if (authHeader) {
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    if (match) {
      extracted = match[1];
    }
  }

  // Fallback to environment variable when no header was supplied
  if (!extracted) {
    extracted = process.env[ENV_TOKEN_KEY] ?? "";
  }

  if (!extracted) {
    return { ok: false, token: "", error: "No bearer token provided" };
  }

  // When a configured token is set, require an exact match
  if (opts.token && extracted !== opts.token) {
    return { ok: false, token: "", error: "Bearer token mismatch" };
  }

  return { ok: true, token: extracted };
}
