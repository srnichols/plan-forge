/**
 * Tests for the Entra ID OIDC authentication provider.
 *
 * Covers:
 *   - auth/providers/entra-oidc.mjs → authenticateEntraOidc, healthCheck
 *   - auth/index.mjs                → authenticate({ provider: "entra-oidc" })
 *
 * All tests mock `fetch` globally to avoid real network calls. RSA key pairs
 * are generated once per suite using Node.js built-in crypto.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateKeyPairSync,
  createSign,
  createPublicKey,
} from "node:crypto";
import {
  authenticateEntraOidc,
  healthCheck,
  _testHooks,
} from "../auth/providers/entra-oidc.mjs";
import { authenticate } from "../auth/index.mjs";

// ─── Test key pair (generated once for the suite) ────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const TEST_KID = "test-kid-1";
const TEST_TENANT = "00000000-0000-0000-0000-000000000001";
const TEST_CLIENT_ID = "api://test-app";

// ─── JWT test helpers ─────────────────────────────────────────────────────────

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function buildJwt(payload, { kid = TEST_KID, alg = "RS256" } = {}) {
  const header = { alg, kid, typ: "JWT" };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = base64url(signer.sign(privateKey));
  return `${headerB64}.${payloadB64}.${signature}`;
}

function buildJwks({ kid = TEST_KID } = {}) {
  const jwk = publicKey.export({ format: "jwk" });
  return { keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }] };
}

function nowSecs() {
  return Math.floor(Date.now() / 1000);
}

function validPayload(overrides = {}) {
  return {
    sub: "user-subject-001",
    oid: "oid-001",
    iss: `https://login.microsoftonline.com/${TEST_TENANT}/v2.0`,
    aud: TEST_CLIENT_ID,
    iat: nowSecs() - 60,
    exp: nowSecs() + 3600,
    ...overrides,
  };
}

// ─── Shared fetch mock helpers ────────────────────────────────────────────────

function mockFetchJwks(jwks = buildJwks()) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jwks,
    })
  );
}

// ─── authenticateEntraOidc ───────────────────────────────────────────────────

describe("authenticateEntraOidc", () => {
  beforeEach(() => {
    // Flush JWKS cache between tests so fetch is always called
    _testHooks.jwksCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:true with sub claim for a valid JWT", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload());
    const opts = { entraOidc: { tenantId: TEST_TENANT, clientId: TEST_CLIENT_ID } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("user-subject-001");
  });

  it("falls back to oid claim when sub is absent", async () => {
    mockFetchJwks();
    const payload = validPayload({ sub: undefined, oid: "oid-from-entra" });
    const token = buildJwt(payload);
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("oid-from-entra");
  });

  it("returns ok:false when no Authorization header is present", async () => {
    const result = await authenticateEntraOidc({ headers: {} }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no bearer token/i);
  });

  it("returns ok:false for an expired token", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload({ exp: nowSecs() - 10 }));
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it("returns ok:false for a not-yet-valid token (nbf in future)", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload({ nbf: nowSecs() + 300 }));
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not yet valid/i);
  });

  it("returns ok:false when audience does not match", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload({ aud: "wrong-audience" }));
    const opts = {
      entraOidc: { tenantId: TEST_TENANT, clientId: TEST_CLIENT_ID },
    };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/audience mismatch/i);
  });

  it("returns ok:false when issuer is not trusted", async () => {
    mockFetchJwks();
    const token = buildJwt(
      validPayload({ iss: "https://evil.example.com/v2.0" })
    );
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/issuer not trusted/i);
  });

  it("accepts v1.0 Entra ID issuer (sts.windows.net format)", async () => {
    mockFetchJwks();
    const token = buildJwt(
      validPayload({ iss: `https://sts.windows.net/${TEST_TENANT}/` })
    );
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when JWKS fetch fails (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );
    const token = buildJwt(validPayload());
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unreachable/i);
  });

  it("returns ok:false when JWKS returns HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );
    const token = buildJwt(validPayload());
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 503/);
  });

  it("returns ok:false when no JWK matches the token kid", async () => {
    mockFetchJwks(buildJwks({ kid: "different-kid" }));
    const token = buildJwt(validPayload(), { kid: "my-kid" });
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no jwk found/i);
  });

  it("returns ok:false when signed with a different private key", async () => {
    // JWKS has the *real* public key, but JWT was signed with a different key
    mockFetchJwks();
    const { privateKey: wrongKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const header = { alg: "RS256", kid: TEST_KID, typ: "JWT" };
    const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64url(Buffer.from(JSON.stringify(validPayload())));
    const signer = createSign("RSA-SHA256");
    signer.update(`${headerB64}.${payloadB64}`);
    const sig = base64url(signer.sign(wrongKey));
    const token = `${headerB64}.${payloadB64}.${sig}`;

    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it("returns ok:false when tenantId is missing from opts", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload());
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      { entraOidc: {} } // tenantId omitted
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tenantId is required/i);
  });

  it("returns ok:false for a non-RS256 algorithm header", async () => {
    mockFetchJwks();
    // Build a JWT with alg: HS256 in the header (signature would be invalid
    // anyway, but we want to see the algorithm check fires first)
    const header = { alg: "HS256", kid: TEST_KID, typ: "JWT" };
    const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64url(Buffer.from(JSON.stringify(validPayload())));
    const token = `${headerB64}.${payloadB64}.fakesig`;
    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported.*algorithm/i);
  });

  it("uses explicit audience option when provided", async () => {
    mockFetchJwks();
    const explicitAud = "https://myapi.example.com";
    const token = buildJwt(validPayload({ aud: explicitAud }));
    const opts = {
      entraOidc: {
        tenantId: TEST_TENANT,
        audience: explicitAud, // explicit audience, not clientId
      },
    };
    const result = await authenticateEntraOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
  });

  it("caches the JWKS and does not fetch twice within TTL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => buildJwks() });
    vi.stubGlobal("fetch", fetchMock);

    const opts = { entraOidc: { tenantId: TEST_TENANT } };
    const token = buildJwt(validPayload());
    const req = { headers: { authorization: `Bearer ${token}` } };

    await authenticateEntraOidc(req, opts);
    await authenticateEntraOidc(req, opts);

    // Second call should hit the cache — fetch called only once
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ─── healthCheck ─────────────────────────────────────────────────────────────

describe("healthCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the IdP OpenID configuration endpoint is reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true })
    );
    const result = await healthCheck(TEST_TENANT);
    expect(result).toBe(true);
  });

  it("returns false when the IdP endpoint returns a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );
    const result = await healthCheck(TEST_TENANT);
    expect(result).toBe(false);
  });

  it("returns false when the IdP endpoint is unreachable (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );
    const result = await healthCheck(TEST_TENANT);
    expect(result).toBe(false);
  });

  it("probes the 'common' endpoint when no tenantId is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await healthCheck();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/common/")
    );
  });
});

// ─── authenticate dispatch (provider: "entra-oidc") ──────────────────────────

describe("authenticate with provider entra-oidc", () => {
  beforeEach(() => {
    _testHooks.jwksCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches to entra-oidc and tags provider in the result", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload());
    const result = await authenticate(
      { headers: { authorization: `Bearer ${token}` } },
      { provider: "entra-oidc", entraOidc: { tenantId: TEST_TENANT } }
    );
    expect(result.provider).toBe("entra-oidc");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with provider tag when the JWT is invalid", async () => {
    mockFetchJwks();
    const result = await authenticate(
      { headers: { authorization: "Bearer not.a.jwt" } },
      { provider: "entra-oidc", entraOidc: { tenantId: TEST_TENANT } }
    );
    expect(result.provider).toBe("entra-oidc");
    expect(result.ok).toBe(false);
  });
});
