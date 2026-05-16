/**
 * 03-provenance-conditional-write.test.mjs — Scenario 3: provenance conditional write.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 3):
 *   MUST: when /health returns capabilities=["provenance"], POST /memories body includes
 *         metadata.provenance with a valid Hallmark shape (validateProvenance === { ok: true })
 *   MUST: when /health returns capabilities=[], POST /memories body does NOT contain
 *         metadata.provenance
 *   MUST: the no-provenance path emits console.warn containing "openbrain-too-old"
 *
 * NOTE: like 02, this file implements the capability-conditional write inline per
 * Plan Decision 5 (Phase-PROVENANCE HTTP integration not yet in production).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMockOpenBrain } from "./helpers/mock-openbrain.mjs";
import { buildProvenance, validateProvenance } from "../../../../pforge-sdk/src/hallmark.mjs";

// ─── Inline capability-conditional write (Phase-PROVENANCE placeholder) ───────
// When Phase-PROVENANCE ships, import writeWithProvenance from production memory.mjs.

let _provCache = null;

function _resetProvCapCache() {
  _provCache = null;
}

async function writeWithProvenance(url, thought) {
  if (_provCache === null) {
    const res = await fetch(`${url}/health`);
    const body = res.ok ? await res.json() : { capabilities: [] };
    _provCache = Array.isArray(body.capabilities) ? body.capabilities : [];
  }

  const metadata = { ...(thought.metadata ?? {}) };

  if (_provCache.includes("provenance")) {
    metadata.provenance = buildProvenance({
      toolName: thought.toolName ?? "test",
      ...(thought.sourceFile ? { sourceFile: thought.sourceFile } : {}),
      ...(thought.byteRange ? { byteRange: thought.byteRange } : {}),
      ...(thought.contentHash ? { contentHash: thought.contentHash } : {}),
    });
  } else {
    console.warn(
      "openbrain-too-old: server lacks provenance capability; metadata.provenance omitted"
    );
  }

  const payload = { content: thought.content, metadata };
  const res = await fetch(`${url}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status };
}

// ─── Scenario 3a — Server supports provenance ─────────────────────────────────

describe("Scenario 3a — POST /memories includes metadata.provenance (capabilities includes 'provenance')", () => {
  let ob;

  beforeEach(async () => {
    _resetProvCapCache();
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("POST /memories body contains metadata.provenance", async () => {
    await writeWithProvenance(ob.url, { content: "analysis result" });
    const recorded = ob.requests.memories[0].body;
    expect(recorded?.metadata?.provenance).toBeDefined();
  });

  it("metadata.provenance passes validateProvenance (full Hallmark validation)", async () => {
    await writeWithProvenance(ob.url, { content: "analysis result" });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(validateProvenance(prov)).toEqual({ ok: true });
  });

  it("metadata.provenance has schemaVersion 'hallmark/v1'", async () => {
    await writeWithProvenance(ob.url, { content: "analysis result" });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(prov?.schemaVersion).toBe("hallmark/v1");
  });

  it("metadata.provenance carries toolName from thought", async () => {
    await writeWithProvenance(ob.url, { content: "x", toolName: "forge_analyze" });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(prov?.toolName).toBe("forge_analyze");
  });

  it("metadata.provenance has a capturedAt in ISO UTC format", async () => {
    await writeWithProvenance(ob.url, { content: "x", toolName: "t" });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(prov?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("metadata.provenance carries optional sourceFile and byteRange when supplied", async () => {
    await writeWithProvenance(ob.url, {
      content: "x",
      toolName: "forge_analyze",
      sourceFile: "src/alpha.mjs",
      byteRange: [120, 180],
    });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(prov?.sourceFile).toBe("src/alpha.mjs");
    expect(prov?.byteRange).toEqual([120, 180]);
  });

  it("metadata.provenance carries optional contentHash when supplied", async () => {
    const hash = "sha256:" + "a".repeat(64);
    await writeWithProvenance(ob.url, { content: "x", toolName: "t", contentHash: hash });
    const prov = ob.requests.memories[0].body?.metadata?.provenance;
    expect(prov?.contentHash).toBe(hash);
  });

  it("does NOT emit console.warn('openbrain-too-old') when provenance is supported", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithProvenance(ob.url, { content: "clean", toolName: "t" });
      const warnedOldBrain = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old"))
      );
      expect(warnedOldBrain).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("POST /memories still succeeds (ok: true) when provenance is included", async () => {
    const result = await writeWithProvenance(ob.url, { content: "x", toolName: "t" });
    expect(result.ok).toBe(true);
  });
});

// ─── Scenario 3b — Server lacks provenance capability ─────────────────────────

describe("Scenario 3b — POST /memories omits metadata.provenance (capabilities=[])", () => {
  let ob;

  beforeEach(async () => {
    _resetProvCapCache();
    ob = await createMockOpenBrain({ capabilities: [] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("POST /memories body does NOT contain metadata.provenance", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithProvenance(ob.url, { content: "some thought", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    const recorded = ob.requests.memories[0].body;
    expect(recorded?.metadata?.provenance).toBeUndefined();
  });

  it("emits console.warn containing 'openbrain-too-old'", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithProvenance(ob.url, { content: "some thought", toolName: "t" });
      const didWarn = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old"))
      );
      expect(didWarn).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("POST /memories still succeeds (ok: true) even without provenance", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await writeWithProvenance(ob.url, { content: "some thought", toolName: "t" });
      expect(result.ok).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("POST /memories body content field is present and correct", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithProvenance(ob.url, { content: "specific content here", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    const recorded = ob.requests.memories[0].body;
    expect(recorded?.content).toBe("specific content here");
  });

  it("warning is emitted for each write when capabilities=[]", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Second write still warns (cache holds [], still no provenance)
      await writeWithProvenance(ob.url, { content: "write-1", toolName: "t" });
      await writeWithProvenance(ob.url, { content: "write-2", toolName: "t" });
      const oldBrainWarns = warnSpy.mock.calls.filter((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old"))
      );
      expect(oldBrainWarns.length).toBe(2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ─── Scenario 3c — Capability toggle (server upgrade simulation) ───────────────

describe("Scenario 3c — capability toggle between writes (cache reset simulates server upgrade)", () => {
  it("after cache reset, upgrading server capabilities causes provenance to be included", async () => {
    // First write: server has no capabilities
    _resetProvCapCache();
    const ob1 = await createMockOpenBrain({ capabilities: [] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithProvenance(ob1.url, { content: "pre-upgrade", toolName: "t" });
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob1.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
    await ob1.close();

    // Second write: new server instance with provenance capability + cache reset
    _resetProvCapCache();
    const ob2 = await createMockOpenBrain({ capabilities: ["provenance"] });
    await writeWithProvenance(ob2.url, { content: "post-upgrade", toolName: "t" });
    const prov = ob2.requests.memories[0].body?.metadata?.provenance;
    expect(validateProvenance(prov)).toEqual({ ok: true });
    await ob2.close();
  });

  it("downgrading server (cache reset + empty capabilities) suppresses provenance and warns", async () => {
    // First write: server supports provenance
    _resetProvCapCache();
    const ob1 = await createMockOpenBrain({ capabilities: ["provenance"] });
    await writeWithProvenance(ob1.url, { content: "pre-downgrade", toolName: "t" });
    const provBefore = ob1.requests.memories[0].body?.metadata?.provenance;
    expect(validateProvenance(provBefore)).toEqual({ ok: true });
    await ob1.close();

    // Second write: server degraded, no capabilities
    _resetProvCapCache();
    const ob2 = await createMockOpenBrain({ capabilities: [] });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeWithProvenance(ob2.url, { content: "post-downgrade", toolName: "t" });
      const didWarn = warnSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("openbrain-too-old"))
      );
      expect(didWarn).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
    expect(ob2.requests.memories[0].body?.metadata?.provenance).toBeUndefined();
    await ob2.close();
  });
});
