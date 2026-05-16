/**
 * 09-backward-compat-old-openbrain.test.mjs — Scenario 9: Backward compatibility
 * with old/incompatible OpenBrain servers.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 9):
 *   MUST: When GET /health returns 404 (old server without a health endpoint), the write
 *         function proceeds without provenance and emits a console.warn containing
 *         "openbrain-too-old".
 *   MUST: When GET /health returns 500 (server error), the write proceeds without
 *         provenance and emits the warning.
 *   MUST: When GET /health returns capabilities=[] (old server, endpoint present but no
 *         provenance capability), the write proceeds without provenance and warns.
 *   MUST: When GET /health returns capabilities that do not include "provenance" (e.g.
 *         ["search", "write"]), the write proceeds without provenance and warns.
 *   MUST: POST /memories succeeds (ok: true) in ALL old-server scenarios.
 *   MUST: Resetting the capability cache causes a fresh probe on the next write,
 *         enabling detection of a server upgrade.
 *
 * NOTE: like 02 and 03, this file implements the capability-aware write function inline
 * as the specification for future production code (Phase-PROVENANCE not yet shipped).
 * When Phase-PROVENANCE ships, replace the inline helpers with production imports.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockOpenBrain } from "./helpers/mock-openbrain.mjs";
import { buildProvenance, validateProvenance } from "../../../../pforge-sdk/src/hallmark.mjs";

// ─── Inline capability-aware write (backward-compat specification) ────────────
// Replace with production imports when Phase-PROVENANCE ships.

let _backCompatCache = null;

function _resetBackCompatCache() {
  _backCompatCache = null;
}

/**
 * Write a memory to OpenBrain.
 *
 * - Probes GET /health on the first call (result cached for subsequent calls).
 * - When capabilities includes "provenance": attaches Hallmark provenance to metadata.
 * - When capabilities lacks "provenance" (old server): omits provenance, emits
 *   console.warn("openbrain-too-old: ...").
 * - Always attempts POST /memories even when the health probe fails.
 *
 * @param {string} url — OpenBrain base URL
 * @param {{ content: string, toolName?: string, sourceFile?: string, byteRange?: number[], contentHash?: string, metadata?: object }} thought
 * @returns {Promise<{ ok: boolean, status: number, capabilities: string[] }>}
 */
async function writeWithBackCompat(url, thought) {
  // Probe capabilities (cached)
  if (_backCompatCache === null) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        const body = await res.json();
        _backCompatCache = Array.isArray(body.capabilities) ? body.capabilities : [];
      } else {
        // 4xx / 5xx — old server without functional /health
        _backCompatCache = [];
      }
    } catch {
      // Network error — treat as no capabilities
      _backCompatCache = [];
    }
  }

  const caps = _backCompatCache;
  const metadata = { ...(thought.metadata ?? {}) };

  if (caps.includes("provenance")) {
    metadata.provenance = buildProvenance({
      toolName:    thought.toolName    ?? "test",
      sourceFile:  thought.sourceFile  ?? undefined,
      byteRange:   thought.byteRange   ?? undefined,
      contentHash: thought.contentHash ?? undefined,
    });
    // Remove undefined keys from provenance object
    Object.keys(metadata.provenance).forEach(
      (k) => metadata.provenance[k] === undefined && delete metadata.provenance[k],
    );
  } else {
    console.warn(
      "openbrain-too-old: server lacks provenance capability; metadata.provenance omitted",
    );
  }

  const res = await fetch(`${url}/memories`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ content: thought.content, metadata }),
  });

  return { ok: res.ok, status: res.status, capabilities: caps };
}

// ─── Scenario 9a — /health returns 404 (old server, no health endpoint) ───────

describe("Scenario 9a — GET /health returns 404 (old server without health endpoint)", () => {
  let ob;

  beforeEach(async () => {
    _resetBackCompatCache();
    ob = await createMockOpenBrain({ capabilities: [] });
    ob.state.healthStatus = 404; // Simulate old server: /health not found
  });

  afterEach(async () => {
    await ob.close();
  });

  it("POST /memories still succeeds (ok: true)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await writeWithBackCompat(ob.url, { content: "thought-404", toolName: "t" });
      expect(result.ok).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("POST /memories body does NOT contain metadata.provenance", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "thought-404", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
  });

  it("emits console.warn containing 'openbrain-too-old'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "thought-404", toolName: "t" });
      const warned = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old")),
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("capabilities returned is an empty array", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { capabilities } = await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      expect(capabilities).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ─── Scenario 9b — /health returns 500 (server error) ─────────────────────────

describe("Scenario 9b — GET /health returns 500 (server error on probe)", () => {
  let ob;

  beforeEach(async () => {
    _resetBackCompatCache();
    ob = await createMockOpenBrain({ capabilities: [] });
    ob.state.healthStatus = 500;
  });

  afterEach(async () => {
    await ob.close();
  });

  it("POST /memories still succeeds when /health errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      expect(result.ok).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("no metadata.provenance in POST body when /health errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
  });

  it("emits 'openbrain-too-old' warning when /health returns 500", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      const warned = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old")),
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ─── Scenario 9c — capabilities=[] (old server, endpoint present but empty caps) ─

describe("Scenario 9c — GET /health returns capabilities=[] (provenance not supported)", () => {
  let ob;

  beforeEach(async () => {
    _resetBackCompatCache();
    ob = await createMockOpenBrain({ capabilities: [] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("POST /memories succeeds without provenance", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      expect(result.ok).toBe(true);
      expect(ob.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("emits 'openbrain-too-old' warning for capabilities=[]", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      const warned = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old")),
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("content field is still correct in POST body", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "specific-payload", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob.requests.memories[0].body?.content).toBe("specific-payload");
  });

  it("warning is emitted on every write (cache holds empty capabilities)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "w1", toolName: "t" });
      await writeWithBackCompat(ob.url, { content: "w2", toolName: "t" });
      const oldBrainWarns = warnSpy.mock.calls.filter((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old")),
      );
      expect(oldBrainWarns.length).toBe(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("/health is probed exactly once even across multiple writes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "w1", toolName: "t" });
      await writeWithBackCompat(ob.url, { content: "w2", toolName: "t" });
      await writeWithBackCompat(ob.url, { content: "w3", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob.hitCounts.health).toBe(1);
    expect(ob.hitCounts.memories).toBe(3);
  });
});

// ─── Scenario 9d — capabilities present but "provenance" not in the list ───────

describe("Scenario 9d — capabilities includes other keys but not 'provenance'", () => {
  let ob;

  beforeEach(async () => {
    _resetBackCompatCache();
    ob = await createMockOpenBrain({ capabilities: ["search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("no metadata.provenance in POST body when 'provenance' not in capabilities", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
  });

  it("emits 'openbrain-too-old' when 'provenance' is absent from capability list", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      const warned = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old")),
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("capabilities==['search','write'] → POST /memories still succeeds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      expect(result.ok).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("only the 'provenance' key in capabilities enables provenance — version field is irrelevant", async () => {
    // healthVersion is set but capabilities still omits "provenance"
    ob.state.healthVersion = "9.9.9";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    // Still no provenance — version number doesn't enable it
    expect(ob.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
  });
});

// ─── Scenario 9e — server "upgrade" detected after cache reset ────────────────

describe("Scenario 9e — capability cache reset enables detection of server upgrade", () => {
  it("after cache reset, upgrading server enables provenance in next write", async () => {
    // Old server: no provenance
    _resetBackCompatCache();
    const ob1 = await createMockOpenBrain({ capabilities: [] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob1.url, { content: "pre-upgrade", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob1.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
    await ob1.close();

    // New server after upgrade: provenance supported
    _resetBackCompatCache();
    const ob2 = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
    await writeWithBackCompat(ob2.url, { content: "post-upgrade", toolName: "t" });
    const prov = ob2.requests.memories[0].body?.metadata?.provenance;
    expect(validateProvenance(prov)).toEqual({ ok: true });
    await ob2.close();
  });

  it("after cache reset, downgrading server removes provenance and resumes warning", async () => {
    // New server: provenance
    _resetBackCompatCache();
    const ob1 = await createMockOpenBrain({ capabilities: ["provenance"] });
    await writeWithBackCompat(ob1.url, { content: "pre-downgrade", toolName: "t" });
    expect(validateProvenance(ob1.requests.memories[0].body?.metadata?.provenance)).toEqual({ ok: true });
    await ob1.close();

    // Old server after downgrade
    _resetBackCompatCache();
    const ob2 = await createMockOpenBrain({ capabilities: [] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob2.url, { content: "post-downgrade", toolName: "t" });
      const warned = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old")),
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob2.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
    await ob2.close();
  });

  it("multiple cache-reset cycles each trigger exactly one fresh /health probe", async () => {
    const ob = await createMockOpenBrain({ capabilities: ["provenance"] });
    try {
      for (let i = 1; i <= 3; i++) {
        _resetBackCompatCache();
        await writeWithBackCompat(ob.url, { content: `cycle-${i}`, toolName: "t" });
        expect(ob.hitCounts.health).toBe(i);
      }
      expect(ob.hitCounts.memories).toBe(3);
    } finally {
      await ob.close();
    }
  });
});

// ─── Scenario 9f — current server (has provenance capability) ─────────────────

describe("Scenario 9f — current server with provenance capability sends valid provenance", () => {
  let ob;

  beforeEach(async () => {
    _resetBackCompatCache();
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("metadata.provenance is present in POST body", async () => {
    await writeWithBackCompat(ob.url, { content: "x", toolName: "forge_analyze" });
    expect(ob.requests.memories[0].body?.metadata?.provenance).toBeDefined();
  });

  it("metadata.provenance passes validateProvenance", async () => {
    await writeWithBackCompat(ob.url, { content: "x", toolName: "forge_analyze" });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(validateProvenance(prov)).toEqual({ ok: true });
  });

  it("does NOT emit 'openbrain-too-old' warning when provenance is supported", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithBackCompat(ob.url, { content: "x", toolName: "t" });
      const warned = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old")),
      );
      expect(warned).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("N writes only probe /health once when capabilities are cached", async () => {
    const N = 4;
    for (let i = 0; i < N; i++) {
      await writeWithBackCompat(ob.url, { content: `thought-${i}`, toolName: "t" });
    }
    expect(ob.hitCounts.health).toBe(1);
    expect(ob.hitCounts.memories).toBe(N);
  });

  it("provenance carries optional source fields when supplied", async () => {
    const hash = "sha256:" + "e".repeat(64);
    await writeWithBackCompat(ob.url, {
      content:     "x",
      toolName:    "forge_analyze",
      sourceFile:  "src/alpha.mjs",
      byteRange:   [0, 100],
      contentHash: hash,
    });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(prov?.sourceFile).toBe("src/alpha.mjs");
    expect(prov?.byteRange).toEqual([0, 100]);
    expect(prov?.contentHash).toBe(hash);
  });
});
