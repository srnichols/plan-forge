/**
 * Entra ID / Azure AD OIDC authentication provider for Plan Forge MCP.
 *
 * Validates RS256-signed JWTs issued by Microsoft Entra ID (Azure AD) using
 * JWKS discovery. The JWKS key set is cached in-process for 5 minutes to
 * avoid per-request network calls to the IdP.
 *
 * Provider options (via opts.entraOidc):
 *   tenantId  — Azure AD tenant GUID or "common" / "organizations" / "consumers" (required)
 *   clientId  — Application (client) ID used as the expected `aud` claim (optional)
 *   audience  — Explicit audience string; overrides clientId for aud validation (optional)
 *   issuer    — Override the expected issuer URL (optional; defaults to v2.0 + v1.0 Entra issuers)
 *
 * @module auth/providers/entra-oidc
 */

import { createPublicKey, createVerify } from "node:crypto";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// in-process JWKS cache: tenantId → { keys: Array, fetchedAt: number }
const _jwksCache = new Map();

/**
 * Decode a base64url-encoded string to a Buffer.
 * @param {string} str
 * @returns {Buffer}
 */
function base64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

/**
 * Split and decode a raw JWT string into its constituent parts.
 * @param {string} rawToken
 * @returns {{ header: Object, payload: Object, headerB64: string, payloadB64: string, signatureB64: string }}
 */
function parseJwt(rawToken) {
  const parts = rawToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format: expected 3 parts separated by '.'");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new Error("JWT header or payload is not valid JSON");
  }
  return { header, payload, headerB64, payloadB64, signatureB64 };
}

/**
 * Fetch and cache the JWKS for the given tenant.
 * @param {string} tenantId
 * @returns {Promise<Array>} Array of JWK objects
 */
async function fetchJwks(tenantId) {
  const cached = _jwksCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }
  const url = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`JWKS endpoint unreachable: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  }
  const { keys } = await res.json();
  _jwksCache.set(tenantId, { keys, fetchedAt: now });
  return keys;
}

/**
 * Verify an RS256 JWT signature against a JWK public key.
 * @param {string} headerB64
 * @param {string} payloadB64
 * @param {string} signatureB64
 * @param {Object} jwk — JWK object (RSA public key)
 * @returns {boolean}
 */
function verifySignature(headerB64, payloadB64, signatureB64, jwk) {
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signature = base64urlDecode(signatureB64);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  return verifier.verify(publicKey, signature);
}

/**
 * Validate the standard JWT claims (exp, nbf, iss, aud).
 * @param {Object} payload - Decoded JWT payload
 * @param {Object} opts    - Provider opts (opts.entraOidc)
 */
function validateClaims(payload, opts) {
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === "number" && now > payload.exp) {
    throw new Error("Token has expired");
  }
  if (typeof payload.nbf === "number" && now < payload.nbf) {
    throw new Error("Token is not yet valid (nbf)");
  }

  const { tenantId, clientId, audience, issuer } = opts.entraOidc ?? {};

  // Accept both v2.0 and v1.0 Entra ID issuer formats
  if (tenantId && payload.iss) {
    const expectedIssuers = new Set([
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ]);
    if (issuer) expectedIssuers.add(issuer);
    if (!expectedIssuers.has(payload.iss)) {
      throw new Error(`Issuer not trusted: ${payload.iss}`);
    }
  }

  // Audience validation — prefer explicit audience over clientId
  const expectedAud = audience ?? clientId;
  if (expectedAud && payload.aud !== undefined) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(expectedAud)) {
      throw new Error(
        `Audience mismatch: expected "${expectedAud}", got "${JSON.stringify(payload.aud)}"`
      );
    }
  }
}

/**
 * Fetch JWKS, find the matching key by `kid`, verify the RS256 signature,
 * and validate standard claims.
 * @param {string} rawToken
 * @param {Object} opts
 * @returns {Promise<Object>} Decoded and validated payload claims
 */
async function verifyEntraToken(rawToken, opts) {
  const { header, payload, headerB64, payloadB64, signatureB64 } =
    parseJwt(rawToken);

  if (header.alg !== "RS256") {
    throw new Error(
      `Unsupported JWT algorithm: ${header.alg} (expected RS256)`
    );
  }

  const tenantId = opts.entraOidc?.tenantId;
  if (!tenantId) {
    throw new Error(
      "opts.entraOidc.tenantId is required for entra-oidc provider"
    );
  }

  const keys = await fetchJwks(tenantId);
  // Match by kid when present; fall back to first key
  const matchingKey = header.kid
    ? keys.find((k) => k.kid === header.kid)
    : keys[0];

  if (!matchingKey) {
    throw new Error(
      `No JWK found for kid="${header.kid}" — JWKS may need to be refreshed`
    );
  }

  const valid = verifySignature(headerB64, payloadB64, signatureB64, matchingKey);
  if (!valid) {
    throw new Error("JWT signature verification failed");
  }

  validateClaims(payload, opts);

  return payload;
}

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AuthResult
 * @property {boolean} ok      - Whether authentication succeeded
 * @property {string}  token   - Subject identifier on success; empty string on failure
 * @property {string}  [error] - Human-readable reason for failure
 */

/**
 * Authenticate a request using an Entra ID / Azure AD OIDC JWT.
 *
 * Extracts the Bearer token from `Authorization: Bearer <jwt>`, validates
 * the RS256 signature against Entra ID's JWKS, and checks standard claims
 * (`exp`, `nbf`, `iss`, `aud`). On success the `token` field carries the
 * `sub` (or `oid`) claim value, which becomes the RBAC principal key.
 *
 * MUST NOT throw — all errors are returned as `{ ok: false, error: "..." }`.
 *
 * @param {Object} req  - Incoming request context (must have `headers` map)
 * @param {Object} opts - Provider options
 * @param {Object} opts.entraOidc
 * @param {string} opts.entraOidc.tenantId    - Azure AD tenant ID (required)
 * @param {string} [opts.entraOidc.clientId]  - App client ID for aud validation
 * @param {string} [opts.entraOidc.audience]  - Explicit audience (overrides clientId)
 * @param {string} [opts.entraOidc.issuer]    - Override expected issuer URL
 * @returns {Promise<AuthResult>}
 */
export async function authenticateEntraOidc(req, opts = {}) {
  const headers = req?.headers ?? {};
  const authHeader =
    headers["authorization"] ??
    headers["Authorization"] ??
    headers["AUTHORIZATION"] ??
    "";

  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match) {
    return { ok: false, token: "", error: "No bearer token provided" };
  }

  const rawToken = match[1];

  try {
    const claims = await verifyEntraToken(rawToken, opts);
    const subject = claims.sub ?? claims.oid ?? "";
    return { ok: true, token: subject };
  } catch (err) {
    return {
      ok: false,
      token: "",
      error: `Token verification failed: ${err.message}`,
    };
  }
}

/**
 * Probe the Entra ID OpenID Connect discovery endpoint.
 *
 * Called at process start and by health-check routes. A `false` result logs
 * a warning but does NOT prevent startup — the IdP may be briefly cold.
 *
 * @param {string} [tenantId="common"] - Tenant ID to probe
 * @returns {Promise<boolean>}
 */
export async function healthCheck(tenantId = "common") {
  const url = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/** Exposed for test isolation (flush the in-process JWKS cache). @internal */
export const _testHooks = { jwksCache: _jwksCache };
