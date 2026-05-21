/**
 * Okta OIDC authentication provider for Plan Forge MCP.
 *
 * Validates RS256-signed JWTs issued by Okta using JWKS discovery.
 * Supports both the Okta Org authorization server and custom authorization
 * servers. The JWKS key set is cached in-process for 5 minutes.
 *
 * Provider options (via opts.oktaOidc):
 *   domain       — Okta domain, e.g. "dev-12345.okta.com" (required)
 *   authServerId — "default" (default) for the default custom auth server,
 *                  or another custom server ID, or "org" for the Org server
 *   clientId     — Okta application client ID for `aud` / `cid` validation
 *   audience     — Explicit audience string; overrides clientId for aud checks
 *   issuer       — Override the expected issuer URL
 *
 * JWKS endpoints:
 *   Custom auth server: https://{domain}/oauth2/{authServerId}/v1/keys
 *   Org auth server:    https://{domain}/oauth2/v1/keys
 *
 * @module auth/providers/okta-oidc
 */

import { createPublicKey, createVerify } from "node:crypto";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// in-process JWKS cache: cacheKey → { keys: Array, fetchedAt: number }
const _jwksCache = new Map();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

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
 * Build the JWKS URL for the given Okta domain and auth server ID.
 * @param {string} domain
 * @param {string} authServerId
 * @returns {string}
 */
function buildJwksUrl(domain, authServerId) {
  if (authServerId === "org") {
    return `https://${domain}/oauth2/v1/keys`;
  }
  return `https://${domain}/oauth2/${authServerId}/v1/keys`;
}

/**
 * Build the default issuer URL for the given domain and auth server ID.
 * @param {string} domain
 * @param {string} authServerId
 * @returns {string}
 */
function buildIssuerUrl(domain, authServerId) {
  if (authServerId === "org") {
    return `https://${domain}`;
  }
  return `https://${domain}/oauth2/${authServerId}`;
}

/**
 * Fetch and cache the JWKS for the given domain + authServerId.
 * @param {string} domain
 * @param {string} authServerId
 * @returns {Promise<Array>} Array of JWK objects
 */
async function fetchJwks(domain, authServerId) {
  const cacheKey = `${domain}::${authServerId}`;
  const cached = _jwksCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }
  const url = buildJwksUrl(domain, authServerId);
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
  _jwksCache.set(cacheKey, { keys, fetchedAt: now });
  return keys;
}

function verifySignature(headerB64, payloadB64, signatureB64, jwk) {
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signature = base64urlDecode(signatureB64);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  return verifier.verify(publicKey, signature);
}

/**
 * Validate standard JWT claims (exp, nbf, iss, aud/cid).
 * Okta custom auth servers put the audience in `aud`; the Org server uses `cid`.
 */
function validateClaims(payload, resolvedOpts) {
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === "number" && now > payload.exp) {
    throw new Error("Token has expired");
  }
  if (typeof payload.nbf === "number" && now < payload.nbf) {
    throw new Error("Token is not yet valid (nbf)");
  }

  const { domain, authServerId, clientId, audience, issuer } = resolvedOpts;

  // Issuer validation
  if (domain && payload.iss) {
    const defaultIssuer = buildIssuerUrl(domain, authServerId);
    const expectedIssuers = new Set([defaultIssuer]);
    if (issuer) expectedIssuers.add(issuer);
    if (!expectedIssuers.has(payload.iss)) {
      throw new Error(`Issuer not trusted: ${payload.iss}`);
    }
  }

  // Audience validation — prefer explicit audience, then clientId
  const expectedAud = audience ?? clientId;
  if (expectedAud) {
    // Okta custom auth servers: `aud` is a string or string array
    if (payload.aud !== undefined) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(expectedAud)) {
        throw new Error(
          `Audience mismatch: expected "${expectedAud}", got "${JSON.stringify(payload.aud)}"`
        );
      }
    } else if (payload.cid !== undefined) {
      // Org auth server uses cid instead of aud for client identification
      if (payload.cid !== expectedAud) {
        throw new Error(
          `Client ID mismatch: expected "${expectedAud}", got "${payload.cid}"`
        );
      }
    }
  }
}

/**
 * Fetch JWKS, find matching key by kid, verify RS256 signature, validate claims.
 * @param {string} rawToken
 * @param {Object} opts
 * @returns {Promise<Object>} Decoded and validated payload
 */
async function verifyOktaToken(rawToken, opts) {
  const { header, payload, headerB64, payloadB64, signatureB64 } =
    parseJwt(rawToken);

  if (header.alg !== "RS256") {
    throw new Error(
      `Unsupported JWT algorithm: ${header.alg} (expected RS256)`
    );
  }

  const oktaOpts = opts.oktaOidc ?? {};
  const { domain } = oktaOpts;
  if (!domain) {
    throw new Error("opts.oktaOidc.domain is required for okta-oidc provider");
  }
  const authServerId = oktaOpts.authServerId ?? "default";

  const keys = await fetchJwks(domain, authServerId);
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

  validateClaims(payload, { ...oktaOpts, authServerId });

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
 * Authenticate a request using an Okta OIDC JWT.
 *
 * Extracts the Bearer token from `Authorization: Bearer <jwt>`, validates
 * the RS256 signature against Okta's JWKS, and checks standard claims
 * (`exp`, `nbf`, `iss`, `aud`). On success the `token` field carries the
 * `sub` claim value, which becomes the RBAC principal key.
 *
 * MUST NOT throw — all errors are returned as `{ ok: false, error: "..." }`.
 *
 * @param {Object} req  - Incoming request context (must have `headers` map)
 * @param {Object} opts - Provider options
 * @param {Object} opts.oktaOidc
 * @param {string} opts.oktaOidc.domain        - Okta domain (required), e.g. "dev-12345.okta.com"
 * @param {string} [opts.oktaOidc.authServerId] - Auth server ID; defaults to "default". Use "org" for the Org server
 * @param {string} [opts.oktaOidc.clientId]    - Okta client ID for aud/cid validation
 * @param {string} [opts.oktaOidc.audience]    - Explicit audience (overrides clientId)
 * @param {string} [opts.oktaOidc.issuer]      - Override expected issuer URL
 * @returns {Promise<AuthResult>}
 */
export async function authenticateOktaOidc(req, opts = {}) {
  const headers = req?.headers ?? {};
  const authHeader =
    headers["authorization"] ??
    headers["Authorization"] ??
    headers["AUTHORIZATION"] ??
    "";

  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, token: "", error: "No bearer token in Authorization header" };
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    return { ok: false, token: "", error: "No bearer token in Authorization header" };
  }

  try {
    const payload = await verifyOktaToken(rawToken, opts);
    const subject = payload.sub ?? "";
    return { ok: true, token: subject };
  } catch (err) {
    return { ok: false, token: "", error: err.message };
  }
}

/**
 * Health-check the Okta OIDC discovery endpoint.
 *
 * Probes `https://{domain}/oauth2/{authServerId}/.well-known/openid-configuration`
 * (or the Org server equivalent). Returns `true` if the IdP is reachable.
 *
 * @param {string} [domain]       - Okta domain (probes "your-domain.okta.com" demo if absent)
 * @param {string} [authServerId] - Auth server ID; defaults to "default"
 * @returns {Promise<boolean>}
 */
export async function healthCheck(domain = "your-domain.okta.com", authServerId = "default") {
  const discoveryUrl =
    authServerId === "org"
      ? `https://${domain}/.well-known/openid-configuration`
      : `https://${domain}/oauth2/${authServerId}/.well-known/openid-configuration`;
  try {
    const res = await fetch(discoveryUrl);
    return res.ok;
  } catch {
    return false;
  }
}

// Expose internals for testing (cache clear etc.)
export const _testHooks = { jwksCache: _jwksCache };
