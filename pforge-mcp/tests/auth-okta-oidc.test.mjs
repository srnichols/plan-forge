/**
 * Tests for the Okta OIDC authentication provider.
 *
 * Covers:
 *   - auth/providers/okta-oidc.mjs → authenticateOktaOidc, healthCheck
 *   - auth/index.mjs               → authenticate({ provider: "okta-oidc" })
 *
 * All tests mock `fetch` globally to avoid real network calls. RSA key pairs
 * are generated once per suite using Node.js built-in crypto.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateKeyPairSync,
  createSign,
} from "node:crypto";
import {
  authenticateOktaOidc,
  healthCheck,
  _testHooks,
} from "../auth/providers/okta-oidc.mjs";
import { authenticate } from "../auth/index.mjs";

// ─── Test key pair (generated once for the suite) ─────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const TEST_KID = "test-okta-kid-1";
const TEST_DOMAIN = "dev-12345.okta.com";
const TEST_AUTH_SERVER_ID = "default";
const TEST_CLIENT_ID = "0oa1bcde2fghijklm123";

// ─── JWT helpers ──────────────────────────────────────────────────────────────

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
    sub: "00u1bcde2fghijklm456",
    iss: `https://${TEST_DOMAIN}/oauth2/${TEST_AUTH_SERVER_ID}`,
    aud: TEST_CLIENT_ID,
    iat: nowSecs() - 60,
    exp: nowSecs() + 3600,
    ...overrides,
  };
}

// ─── Shared fetch mock ────────────────────────────────────────────────────────

function mockFetchJwks(jwks = buildJwks()) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jwks,
    })
  );
}

// ─── authenticateOktaOidc ─────────────────────────────────────────────────────

describe("authenticateOktaOidc", () => {
  beforeEach(() => {
    _testHooks.jwksCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:true with sub claim for a valid JWT", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload());
    const opts = {
      oktaOidc: { domain: TEST_DOMAIN, clientId: TEST_CLIENT_ID },
    };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("00u1bcde2fghijklm456");
  });

  it("returns ok:false when no Authorization header is present", async () => {
    const result = await authenticateOktaOidc({ headers: {} }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no bearer token/i);
  });

  it("returns ok:false for an expired token", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload({ exp: nowSecs() - 10 }));
    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
  });

  it("returns ok:false for a not-yet-valid token (nbf in future)", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload({ nbf: nowSecs() + 300 }));
    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not yet valid/i);
  });

  it("returns ok:false when audience does not match", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload({ aud: "wrong-client-id" }));
    const opts = {
      oktaOidc: { domain: TEST_DOMAIN, clientId: TEST_CLIENT_ID },
    };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/audience mismatch/i);
  });

  it("returns ok:false when issuer is not trusted", async () => {
    mockFetchJwks();
    const token = buildJwt(
      validPayload({ iss: "https://evil.example.com/oauth2/default" })
    );
    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/issuer not trusted/i);
  });

  it("returns ok:false when JWKS fetch fails (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );
    const token = buildJwt(validPayload());
    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
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
    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 503/);
  });

  it("returns ok:false when no JWK matches the token kid", async () => {
    mockFetchJwks(buildJwks({ kid: "different-kid" }));
    const token = buildJwt(validPayload(), { kid: "my-kid" });
    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no jwk found/i);
  });

  it("returns ok:false when signed with a different private key", async () => {
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

    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it("returns ok:false when domain is missing from opts", async () => {
    mockFetchJwks();
    const token = buildJwt(validPayload());
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      { oktaOidc: {} } // domain omitted
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/domain is required/i);
  });

  it("returns ok:false for a non-RS256 algorithm header", async () => {
    mockFetchJwks();
    const header = { alg: "HS256", kid: TEST_KID, typ: "JWT" };
    const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64url(Buffer.from(JSON.stringify(validPayload())));
    const token = `${headerB64}.${payloadB64}.fakesig`;
    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported.*algorithm/i);
  });

  it("uses explicit audience option when provided", async () => {
    mockFetchJwks();
    const explicitAud = "https://api.example.com/";
    const token = buildJwt(validPayload({ aud: explicitAud }));
    const opts = {
      oktaOidc: {
        domain: TEST_DOMAIN,
        audience: explicitAud,
      },
    };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
  });

  it("accepts an Org auth server issuer (no authServerId path segment)", async () => {
    mockFetchJwks();
    const orgPayload = validPayload({
      iss: `https://${TEST_DOMAIN}`,
    });
    const token = buildJwt(orgPayload);
    const opts = {
      oktaOidc: { domain: TEST_DOMAIN, authServerId: "org" },
    };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
  });

  it("validates cid claim when aud is absent (Org server token)", async () => {
    mockFetchJwks();
    // Org server tokens may have cid instead of aud
    const orgPayload = {
      sub: "00u1bcde2fghijklm456",
      iss: `https://${TEST_DOMAIN}`,
      cid: TEST_CLIENT_ID,
      iat: nowSecs() - 60,
      exp: nowSecs() + 3600,
    };
    const token = buildJwt(orgPayload);
    const opts = {
      oktaOidc: { domain: TEST_DOMAIN, authServerId: "org", clientId: TEST_CLIENT_ID },
    };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("00u1bcde2fghijklm456");
  });

  it("returns ok:false when cid does not match clientId", async () => {
    mockFetchJwks();
    const orgPayload = {
      sub: "00u1bcde2fghijklm456",
      iss: `https://${TEST_DOMAIN}`,
      cid: "wrong-client-id",
      iat: nowSecs() - 60,
      exp: nowSecs() + 3600,
    };
    const token = buildJwt(orgPayload);
    const opts = {
      oktaOidc: { domain: TEST_DOMAIN, authServerId: "org", clientId: TEST_CLIENT_ID },
    };
    const result = await authenticateOktaOidc(
      { headers: { authorization: `Bearer ${token}` } },
      opts
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/client id mismatch/i);
  });

  it("caches the JWKS and does not fetch twice within TTL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => buildJwks() });
    vi.stubGlobal("fetch", fetchMock);

    const opts = { oktaOidc: { domain: TEST_DOMAIN } };
    const token = buildJwt(validPayload());
    const req = { headers: { authorization: `Bearer ${token}` } };

    await authenticateOktaOidc(req, opts);
    await authenticateOktaOidc(req, opts);

    // Second call should hit the cache — fetch called only once
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses domain::authServerId as cache key (different servers get separate caches)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => buildJwks() });
    vi.stubGlobal("fetch", fetchMock);

    const token = buildJwt(validPayload());
    const req = { headers: { authorization: `Bearer ${token}` } };

    await authenticateOktaOidc(req, { oktaOidc: { domain: TEST_DOMAIN, authServerId: "default" } });
    await authenticateOktaOidc(req, { oktaOidc: { domain: TEST_DOMAIN, authServerId: "other" } });

    // Different authServerId → different cache keys → two fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── healthCheck ──────────────────────────────────────────────────────────────

describe("healthCheck (okta-oidc)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when the Okta discovery endpoint is reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const result = await healthCheck(TEST_DOMAIN);
    expect(result).toBe(true);
  });

  it("returns false when the discovery endpoint returns a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );
    const result = await healthCheck(TEST_DOMAIN);
    expect(result).toBe(false);
  });

  it("returns false when the discovery endpoint is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );
    const result = await healthCheck(TEST_DOMAIN);
    expect(result).toBe(false);
  });

  it("probes custom auth server discovery URL by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await healthCheck(TEST_DOMAIN, "default");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://${TEST_DOMAIN}/oauth2/default/.well-known/openid-configuration`
    );
  });

  it("probes Org auth server discovery URL when authServerId is 'org'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await healthCheck(TEST_DOMAIN, "org");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://${TEST_DOMAIN}/.well-known/openid-configuration`
    );
  });

  it("probes the demo domain when no domain is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await healthCheck();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("your-domain.okta.com")
    );
  });
});

// ─── authenticate dispatch (provider: "okta-oidc") ───────────────────────────

describe("authenticate with provider okta-oidc", () => {
  beforeEach(() => {
    _testHooks.jwksCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches to okta-oidc and tags provider in the result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => buildJwks() });
    vi.stubGlobal("fetch", fetchMock);

    const token = buildJwt(validPayload());
    const result = await authenticate(
      { headers: { authorization: `Bearer ${token}` } },
      { provider: "okta-oidc", oktaOidc: { domain: TEST_DOMAIN } }
    );
    expect(result.provider).toBe("okta-oidc");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with provider tag when the JWT is invalid", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => buildJwks() });
    vi.stubGlobal("fetch", fetchMock);

    const result = await authenticate(
      { headers: { authorization: "Bearer not.a.jwt" } },
      { provider: "okta-oidc", oktaOidc: { domain: TEST_DOMAIN } }
    );
    expect(result.provider).toBe("okta-oidc");
    expect(result.ok).toBe(false);
  });
});
