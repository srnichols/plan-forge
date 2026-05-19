/**
 * Tests for pforge-mcp/foundry-quota.mjs
 * Phase-FOUNDRY-QUOTA-PREFLIGHT Slice 4.
 *
 * Covers:
 *   quotaCacheGet / quotaCacheSet — TTL cache behaviour
 *   getDeploymentQuota           — fail-open REST fetch with cache integration
 *   compareSliceEstimate         — synchronous comparator thresholds
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  quotaCacheGet,
  quotaCacheSet,
  getDeploymentQuota,
  compareSliceEstimate,
} from "../foundry-quota.mjs";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal ok-quota object for use in compareSliceEstimate tests. */
function makeQuota(overrides = {}) {
  return {
    ok: true,
    deploymentName: "test-deployment",
    model: "gpt-4.1",
    tpmCapacity: 100_000,
    tpmUsage: 0,
    ptuCapacity: null,
    ptuUsage: null,
    sku: "Standard",
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal ok-credential that returns a token. */
function makeCredential(token = "test-token") {
  return {
    getToken: vi.fn().mockResolvedValue({ token }),
  };
}

// ─── quotaCacheGet / quotaCacheSet ───────────────────────────────────────────

describe("quotaCacheGet / quotaCacheSet — TTL cache", () => {
  const key = `sub/rg/acct/deploy-cache-test-${Date.now()}`;

  it("returns null for a key that was never set", () => {
    expect(quotaCacheGet("non-existent-key-xyz-abc")).toBeNull();
  });

  it("returns the stored value immediately after set", () => {
    const value = { ok: true, deploymentName: "my-dep", model: "gpt-4.1" };
    quotaCacheSet(key, value, 60_000);
    expect(quotaCacheGet(key)).toEqual(value);
  });

  it("returns null after the TTL has expired", async () => {
    const shortKey = `sub/rg/acct/expire-test-${Date.now()}`;
    quotaCacheSet(shortKey, { ok: true }, 1); // 1 ms TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(quotaCacheGet(shortKey)).toBeNull();
  });

  it("overwrites an existing entry with the new value on re-set", () => {
    const overwriteKey = `sub/rg/acct/overwrite-${Date.now()}`;
    quotaCacheSet(overwriteKey, { ok: true, model: "old" }, 60_000);
    quotaCacheSet(overwriteKey, { ok: true, model: "new" }, 60_000);
    expect(quotaCacheGet(overwriteKey)?.model).toBe("new");
  });

  it("default TTL is 5 minutes (entry still present after 1 second)", async () => {
    const defaultKey = `sub/rg/acct/default-ttl-${Date.now()}`;
    quotaCacheSet(defaultKey, { ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(quotaCacheGet(defaultKey)).not.toBeNull();
  });
});

// ─── getDeploymentQuota — parameter validation ───────────────────────────────

describe("getDeploymentQuota — missing required params", () => {
  it("returns ok:false / missing_required_params when subscriptionId absent", async () => {
    const r = await getDeploymentQuota({
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: "dep",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing_required_params");
  });

  it("returns ok:false / missing_required_params when deploymentName absent", async () => {
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing_required_params");
  });

  it("returns ok:false / no_credential when credential not provided", async () => {
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: "dep",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_credential");
  });
});

// ─── getDeploymentQuota — credential / token errors ──────────────────────────

describe("getDeploymentQuota — credential / token errors", () => {
  it("returns ok:false / token_error when credential.getToken throws", async () => {
    const credential = {
      getToken: vi.fn().mockRejectedValue(new Error("identity failure")),
    };
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: "dep",
      credential,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("token_error");
  });

  it("returns ok:false / no_token when credential returns null token", async () => {
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token: null }),
    };
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: "dep",
      credential,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_token");
  });
});

// ─── getDeploymentQuota — HTTP status handling (fetch mocked) ────────────────

describe("getDeploymentQuota — HTTP error codes", () => {
  let origFetch;

  beforeEach(() => {
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  function mockFetch(status, body = {}) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  }

  it("returns ok:false / rate_limited on HTTP 429", async () => {
    mockFetch(429);
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: `dep-429-${Date.now()}`,
      credential: makeCredential(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("rate_limited");
  });

  it("returns ok:false / forbidden on HTTP 401", async () => {
    mockFetch(401);
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: `dep-401-${Date.now()}`,
      credential: makeCredential(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("forbidden");
  });

  it("returns ok:false / forbidden on HTTP 403", async () => {
    mockFetch(403);
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: `dep-403-${Date.now()}`,
      credential: makeCredential(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("forbidden");
  });

  it("returns ok:false / service_unavailable on HTTP 503", async () => {
    mockFetch(503);
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: `dep-503-${Date.now()}`,
      credential: makeCredential(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("service_unavailable");
  });

  it("returns ok:false / http_<code> for an unrecognised error status", async () => {
    mockFetch(502);
    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: `dep-502-${Date.now()}`,
      credential: makeCredential(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("http_502");
  });
});

// ─── getDeploymentQuota — success path ───────────────────────────────────────

describe("getDeploymentQuota — success path", () => {
  it("returns ok:true with parsed quota fields on 200", async () => {
    const depName = `dep-ok-${Date.now()}`;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: depName,
        sku: { name: "Standard" },
        properties: {
          model: { name: "gpt-4.1" },
          capacity: { deploymentCapacity: 50_000 },
        },
      }),
    });

    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: depName,
      credential: makeCredential(),
      ttlMs: 1, // short TTL so it doesn't pollute subsequent tests
      _fetchFn: mockFetch,
    });

    expect(r.ok).toBe(true);
    expect(r.deploymentName).toBe(depName);
    expect(r.model).toBe("gpt-4.1");
    expect(r.tpmCapacity).toBe(50_000);
    expect(r.sku).toBe("Standard");
    expect(r.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("caches the result so a second call skips fetch", async () => {
    const depName = `dep-cache-hit-${Date.now()}`;
    const body = {
      name: depName,
      sku: { name: "Standard" },
      properties: { model: { name: "gpt-4.1" }, capacity: { deploymentCapacity: 10_000 } },
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });

    const opts = {
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: depName,
      credential: makeCredential(),
      ttlMs: 60_000,
      _fetchFn: mockFetch,
    };

    await getDeploymentQuota(opts);
    await getDeploymentQuota(opts);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── getDeploymentQuota — network failure paths ───────────────────────────────

describe("getDeploymentQuota — network failures", () => {
  let origFetch;

  beforeEach(() => {
    origFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it("returns ok:false / timeout on AbortSignal timeout", async () => {
    const err = new Error("The operation was aborted");
    err.name = "TimeoutError";
    global.fetch = vi.fn().mockRejectedValue(err);

    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: `dep-timeout-${Date.now()}`,
      credential: makeCredential(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("timeout");
  });

  it("returns ok:false / network_error on generic fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const r = await getDeploymentQuota({
      subscriptionId: "sub",
      resourceGroup: "rg",
      accountName: "acct",
      deploymentName: `dep-neterr-${Date.now()}`,
      credential: makeCredential(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("network_error");
  });
});

// ─── compareSliceEstimate — unknown quota paths ───────────────────────────────

describe("compareSliceEstimate — unknown status", () => {
  it("returns status:unknown when quota is null", () => {
    const r = compareSliceEstimate(null, { tokens_in: 1000, tokens_out: 500 });
    expect(r.status).toBe("unknown");
    expect(r.headroomPct).toBeNull();
    expect(r.message).toMatch(/Quota unavailable/i);
  });

  it("returns status:unknown when quota.ok is false", () => {
    const r = compareSliceEstimate(
      { ok: false, reason: "rate_limited" },
      { tokens_in: 1000, tokens_out: 500 },
    );
    expect(r.status).toBe("unknown");
    expect(r.message).toContain("rate_limited");
  });

  it("returns status:unknown when tpmCapacity is null", () => {
    const quota = makeQuota({ tpmCapacity: null });
    const r = compareSliceEstimate(quota, { tokens_in: 1000, tokens_out: 500 });
    expect(r.status).toBe("unknown");
    expect(r.headroomPct).toBeNull();
  });

  it("returns status:unknown when tpmCapacity is 0", () => {
    const quota = makeQuota({ tpmCapacity: 0 });
    const r = compareSliceEstimate(quota, { tokens_in: 1000, tokens_out: 500 });
    expect(r.status).toBe("unknown");
  });
});

// ─── compareSliceEstimate — threshold classification ─────────────────────────

describe("compareSliceEstimate — threshold classification", () => {
  it("returns status:safe when headroom >= 30%", () => {
    // capacity=100k, usage=0, slice=0 → 100% headroom
    const r = compareSliceEstimate(makeQuota({ tpmCapacity: 100_000, tpmUsage: 0 }), {
      tokens_in: 0,
      tokens_out: 0,
    });
    expect(r.status).toBe("safe");
    expect(r.headroomPct).toBe(100);
  });

  it("returns status:safe at exactly 30% headroom", () => {
    // capacity=100k, usage=0, slice=70k → 30% headroom
    const r = compareSliceEstimate(makeQuota({ tpmCapacity: 100_000, tpmUsage: 0 }), {
      tokens_in: 70_000,
      tokens_out: 0,
    });
    expect(r.status).toBe("safe");
    expect(r.headroomPct).toBe(30);
  });

  it("returns status:warning when headroom is 10–30%", () => {
    // capacity=100k, usage=0, slice=80k → 20% headroom
    const r = compareSliceEstimate(makeQuota({ tpmCapacity: 100_000, tpmUsage: 0 }), {
      tokens_in: 80_000,
      tokens_out: 0,
    });
    expect(r.status).toBe("warning");
    expect(r.headroomPct).toBe(20);
  });

  it("returns status:warning at exactly 10% headroom", () => {
    // capacity=100k, usage=0, slice=90k → 10% headroom
    const r = compareSliceEstimate(makeQuota({ tpmCapacity: 100_000, tpmUsage: 0 }), {
      tokens_in: 90_000,
      tokens_out: 0,
    });
    expect(r.status).toBe("warning");
    expect(r.headroomPct).toBe(10);
  });

  it("returns status:critical when headroom < 10%", () => {
    // capacity=100k, usage=0, slice=95k → 5% headroom
    const r = compareSliceEstimate(makeQuota({ tpmCapacity: 100_000, tpmUsage: 0 }), {
      tokens_in: 95_000,
      tokens_out: 0,
    });
    expect(r.status).toBe("critical");
    expect(r.headroomPct).toBe(5);
  });

  it("returns status:critical when headroom is negative (over-budget)", () => {
    // capacity=100k, usage=80k, slice=30k → -10% headroom
    const r = compareSliceEstimate(
      makeQuota({ tpmCapacity: 100_000, tpmUsage: 80_000 }),
      { tokens_in: 30_000, tokens_out: 0 },
    );
    expect(r.status).toBe("critical");
    expect(r.headroomPct).toBeLessThan(0);
  });
});

// ─── compareSliceEstimate — message shape ────────────────────────────────────

describe("compareSliceEstimate — message shape", () => {
  it("message includes deployment name, capacity, and status", () => {
    const quota = makeQuota({ tpmCapacity: 100_000, tpmUsage: 0, deploymentName: "my-dep" });
    const r = compareSliceEstimate(quota, { tokens_in: 0, tokens_out: 0 });
    expect(r.message).toContain("[foundry-quota]");
    expect(r.message).toContain("safe");
    expect(r.message).toContain("my-dep");
    expect(r.message).toContain("100.0%");
  });

  it("accounts for both tokens_in and tokens_out in slice estimate", () => {
    // capacity=100k, slice = 40k + 30k = 70k → 30% headroom → safe
    const r = compareSliceEstimate(makeQuota({ tpmCapacity: 100_000, tpmUsage: 0 }), {
      tokens_in: 40_000,
      tokens_out: 30_000,
    });
    expect(r.status).toBe("safe");
    expect(r.headroomPct).toBe(30);
    expect(r.message).toContain("70,000 tokens");
  });

  it("treats undefined sliceEstimate gracefully (counts as 0 tokens)", () => {
    const r = compareSliceEstimate(makeQuota({ tpmCapacity: 100_000 }), undefined);
    expect(r.status).toBe("safe");
    expect(r.headroomPct).toBe(100);
  });

  it("uses tpmUsage from quota when non-null", () => {
    // capacity=100k, usage=50k, slice=20k → 30% headroom → safe
    const quota = makeQuota({ tpmCapacity: 100_000, tpmUsage: 50_000 });
    const r = compareSliceEstimate(quota, { tokens_in: 20_000, tokens_out: 0 });
    expect(r.status).toBe("safe");
    expect(r.headroomPct).toBe(30);
  });

  it("defaults tpmUsage to 0 when null in quota", () => {
    // usage=null → treated as 0; slice=10k → 90% headroom
    const quota = makeQuota({ tpmCapacity: 100_000, tpmUsage: null });
    const r = compareSliceEstimate(quota, { tokens_in: 10_000, tokens_out: 0 });
    expect(r.status).toBe("safe");
    expect(r.headroomPct).toBe(90);
  });
});
