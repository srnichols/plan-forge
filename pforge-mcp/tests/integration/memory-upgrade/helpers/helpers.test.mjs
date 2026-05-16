/**
 * helpers.test.mjs — Meta-tests that verify the Slice 1 testkit itself works.
 *
 * These tests exercise:
 *   - createTmpForgeHome / useTmpForgeHome  (with-tmp-forge-home.mjs)
 *   - createMockOpenBrain                   (mock-openbrain.mjs)
 *   - Fixture file existence and JSON validity
 *
 * If any of these fail, later slices that depend on the helpers will also fail.
 * Keeping this file fast is important — all assertions here are local I/O or
 * in-process HTTP; zero network calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { createTmpForgeHome, useTmpForgeHome } from "./with-tmp-forge-home.mjs";
import { createMockOpenBrain } from "./mock-openbrain.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "..", "fixtures");
const TINY_PROJECT_DIR = resolve(FIXTURES_DIR, "tiny-project");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simple GET using Node's built-in fetch (Node 18+). */
async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
}

/** Simple POST using Node's built-in fetch. */
async function postJson(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// createTmpForgeHome
// ═══════════════════════════════════════════════════════════════════════════════

describe("createTmpForgeHome", () => {
  it("creates a writable tmp directory", () => {
    const home = createTmpForgeHome();
    try {
      expect(existsSync(home.cwd)).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  it("cwd is outside the repository root (no .forge/ pollution)", () => {
    const home = createTmpForgeHome();
    try {
      // The tmp dir should not be inside the repo workspace
      const repoRoot = resolve(__dirname, "../../../../..");
      expect(home.cwd.startsWith(repoRoot)).toBe(false);
    } finally {
      home.cleanup();
    }
  });

  it("forge() resolves paths under .forge/", () => {
    const home = createTmpForgeHome();
    try {
      const anvilPath = home.forge("anvil");
      expect(anvilPath).toContain(".forge");
      expect(anvilPath).toContain("anvil");
      expect(anvilPath.startsWith(home.cwd)).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  it("mkForgeDir() creates the directory", () => {
    const home = createTmpForgeHome();
    try {
      const p = home.mkForgeDir("lattice");
      expect(existsSync(p)).toBe(true);
    } finally {
      home.cleanup();
    }
  });

  it("cleanup() removes the tmp directory", () => {
    const home = createTmpForgeHome();
    const { cwd } = home;
    expect(existsSync(cwd)).toBe(true);
    home.cleanup();
    expect(existsSync(cwd)).toBe(false);
  });

  it("cleanup() is idempotent (safe to call twice)", () => {
    const home = createTmpForgeHome();
    home.cleanup();
    expect(() => home.cleanup()).not.toThrow();
  });

  it("accepts a custom prefix", () => {
    const home = createTmpForgeHome({ prefix: "pforge-mytest-" });
    try {
      expect(home.cwd).toContain("pforge-mytest-");
    } finally {
      home.cleanup();
    }
  });

  it("each call returns a distinct directory", () => {
    const a = createTmpForgeHome();
    const b = createTmpForgeHome();
    try {
      expect(a.cwd).not.toBe(b.cwd);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useTmpForgeHome (vitest-scoped helper)
// ═══════════════════════════════════════════════════════════════════════════════

describe("useTmpForgeHome", () => {
  const home = useTmpForgeHome({ prefix: "pforge-usehome-" });

  it("cwd is accessible inside a test", () => {
    expect(typeof home.cwd).toBe("string");
    expect(existsSync(home.cwd)).toBe(true);
  });

  it("can write and read files through the tmp dir", () => {
    const filePath = join(home.cwd, "test.txt");
    writeFileSync(filePath, "hello");
    expect(readFileSync(filePath, "utf-8")).toBe("hello");
  });

  it("forge() path is under cwd", () => {
    expect(home.forge("anvil").startsWith(home.cwd)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createMockOpenBrain — server lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("createMockOpenBrain — lifecycle", () => {
  let ob;
  beforeEach(async () => { ob = await createMockOpenBrain(); });
  afterEach(async () => { await ob.close(); });

  it("starts on a local port and returns a url", () => {
    expect(ob.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(ob.port).toBeGreaterThan(0);
  });

  it("stops cleanly with close()", async () => {
    const ob2 = await createMockOpenBrain();
    await expect(ob2.close()).resolves.not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createMockOpenBrain — GET /health
// ═══════════════════════════════════════════════════════════════════════════════

describe("createMockOpenBrain — GET /health", () => {
  let ob;
  beforeEach(async () => { ob = await createMockOpenBrain(); });
  afterEach(async () => { await ob.close(); });

  it("returns 200 with capabilities and version by default", async () => {
    const { status, body } = await getJson(`${ob.url}/health`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities).toContain("provenance");
    expect(typeof body.version).toBe("string");
  });

  it("records the request in hitCounts.health", async () => {
    expect(ob.hitCounts.health).toBe(0);
    await getJson(`${ob.url}/health`);
    expect(ob.hitCounts.health).toBe(1);
    await getJson(`${ob.url}/health`);
    expect(ob.hitCounts.health).toBe(2);
  });

  it("returns configured capabilities", async () => {
    ob.state.capabilities = ["search"];
    const { body } = await getJson(`${ob.url}/health`);
    expect(body.capabilities).toEqual(["search"]);
  });

  it("returns configured healthStatus (e.g. 404 for old OpenBrain)", async () => {
    ob.state.healthStatus = 404;
    const { status } = await getJson(`${ob.url}/health`);
    expect(status).toBe(404);
  });

  it("returns 503 when healthStatus is set to 503", async () => {
    ob.state.healthStatus = 503;
    const { status } = await getJson(`${ob.url}/health`);
    expect(status).toBe(503);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createMockOpenBrain — POST /memories
// ═══════════════════════════════════════════════════════════════════════════════

describe("createMockOpenBrain — POST /memories", () => {
  let ob;
  beforeEach(async () => { ob = await createMockOpenBrain(); });
  afterEach(async () => { await ob.close(); });

  it("returns 201 and stores the memory", async () => {
    const payload = { content: "test thought", type: "decision", project: "test" };
    const { status, body } = await postJson(`${ob.url}/memories`, payload);
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("string");
  });

  it("increments hitCounts.memories", async () => {
    expect(ob.hitCounts.memories).toBe(0);
    await postJson(`${ob.url}/memories`, { content: "x" });
    await postJson(`${ob.url}/memories`, { content: "y" });
    expect(ob.hitCounts.memories).toBe(2);
  });

  it("records request bodies in requests.memories", async () => {
    await postJson(`${ob.url}/memories`, { content: "hello", project: "qa" });
    expect(ob.requests.memories).toHaveLength(1);
    expect(ob.requests.memories[0].body.content).toBe("hello");
  });

  it("returns 500 when nextFailCount > 0", async () => {
    ob.state.nextFailCount = 2;
    const r1 = await postJson(`${ob.url}/memories`, { content: "a" });
    const r2 = await postJson(`${ob.url}/memories`, { content: "b" });
    const r3 = await postJson(`${ob.url}/memories`, { content: "c" });
    expect(r1.status).toBe(500);
    expect(r2.status).toBe(500);
    expect(r3.status).toBe(201); // third succeeds — failCount exhausted
  });

  it("stores memories for later match_thoughts_by_source queries", async () => {
    const prov = {
      schemaVersion: "hallmark/v1",
      toolName: "forge_analyze",
      capturedAt: "2026-05-16T00:00:00Z",
      sourceFile: "src/alpha.mjs",
      contentHash: "sha256:" + "a".repeat(64),
    };
    await postJson(`${ob.url}/memories`, { content: "alpha memory", metadata: { provenance: prov } });
    expect(ob.state.storedMemories).toHaveLength(1);
    expect(ob.state.storedMemories[0].metadata.provenance.sourceFile).toBe("src/alpha.mjs");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createMockOpenBrain — POST /rpc/match_thoughts_by_source
// ═══════════════════════════════════════════════════════════════════════════════

describe("createMockOpenBrain — POST /rpc/match_thoughts_by_source", () => {
  let ob;
  beforeEach(async () => { ob = await createMockOpenBrain(); });
  afterEach(async () => { await ob.close(); });

  it("returns empty items when no memories stored", async () => {
    const { status, body } = await postJson(
      `${ob.url}/rpc/match_thoughts_by_source`,
      { file: "src/alpha.mjs", hash: "sha256:" + "a".repeat(64) }
    );
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns matching memories by sourceFile and contentHash", async () => {
    const hash = "sha256:" + "b".repeat(64);
    const prov = {
      schemaVersion: "hallmark/v1",
      toolName: "forge_analyze",
      capturedAt: "2026-05-16T00:00:00Z",
      sourceFile: "src/beta.mjs",
      contentHash: hash,
    };
    await postJson(`${ob.url}/memories`, { content: "beta note", metadata: { provenance: prov } });

    const { body } = await postJson(
      `${ob.url}/rpc/match_thoughts_by_source`,
      { file: "src/beta.mjs", hash }
    );
    expect(body.total).toBe(1);
    expect(body.items[0].content).toBe("beta note");
  });

  it("does NOT return memories that don't match the hash", async () => {
    const prov = {
      schemaVersion: "hallmark/v1",
      toolName: "forge_analyze",
      capturedAt: "2026-05-16T00:00:00Z",
      sourceFile: "src/alpha.mjs",
      contentHash: "sha256:" + "a".repeat(64),
    };
    await postJson(`${ob.url}/memories`, { content: "alpha", metadata: { provenance: prov } });

    const { body } = await postJson(
      `${ob.url}/rpc/match_thoughts_by_source`,
      { file: "src/alpha.mjs", hash: "sha256:" + "c".repeat(64) }
    );
    expect(body.items).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createMockOpenBrain — reset()
// ═══════════════════════════════════════════════════════════════════════════════

describe("createMockOpenBrain — reset()", () => {
  let ob;
  beforeEach(async () => { ob = await createMockOpenBrain(); });
  afterEach(async () => { await ob.close(); });

  it("clears counts and recorded requests", async () => {
    await getJson(`${ob.url}/health`);
    await postJson(`${ob.url}/memories`, { content: "x" });
    ob.reset();
    expect(ob.hitCounts.health).toBe(0);
    expect(ob.hitCounts.memories).toBe(0);
    expect(ob.requests.health).toHaveLength(0);
    expect(ob.requests.memories).toHaveLength(0);
    expect(ob.state.storedMemories).toHaveLength(0);
  });

  it("server continues to work after reset", async () => {
    ob.reset();
    const { status } = await getJson(`${ob.url}/health`);
    expect(status).toBe(200);
    expect(ob.hitCounts.health).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture files
// ═══════════════════════════════════════════════════════════════════════════════

describe("fixture files — existence and validity", () => {
  const mjsFiles = [
    "src/alpha.mjs",
    "src/beta.mjs",
    "src/gamma.mjs",
    "src/delta.mjs",
    "src/epsilon.mjs",
    "src/zeta.mjs",
  ];
  const pyFiles = [
    "utils/helpers.py",
    "utils/parser.py",
  ];

  for (const rel of mjsFiles) {
    it(`tiny-project/${rel} exists`, () => {
      expect(existsSync(resolve(TINY_PROJECT_DIR, rel))).toBe(true);
    });
  }

  for (const rel of pyFiles) {
    it(`tiny-project/${rel} exists`, () => {
      expect(existsSync(resolve(TINY_PROJECT_DIR, rel))).toBe(true);
    });
  }

  it("expected-callers.json is valid JSON with frobnicate entry", () => {
    const raw = readFileSync(resolve(FIXTURES_DIR, "expected-callers.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.frobnicate).toBeDefined();
    expect(data.frobnicate.callerChunks).toBeInstanceOf(Array);
    expect(data.frobnicate.callerChunks[0].callerName).toBe("wumble");
  });

  it("expected-callers.json wumble entry has no callers (leaf entry point)", () => {
    const raw = readFileSync(resolve(FIXTURES_DIR, "expected-callers.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.wumble.callerChunks).toEqual([]);
    expect(data.wumble.total).toBe(0);
  });

  it("expected-hallmark-records.json is valid JSON with required shapes", () => {
    const raw = readFileSync(resolve(FIXTURES_DIR, "expected-hallmark-records.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.minimalValid.schemaVersion).toBe("hallmark/v1");
    expect(data.withSourceAndRange.byteRange).toEqual([120, 180]);
    expect(data.tamperedFields.missingToolName.toolName).toBeUndefined();
  });

  it("alpha.mjs contains frobnicate and imports from beta.mjs", () => {
    const src = readFileSync(resolve(TINY_PROJECT_DIR, "src/alpha.mjs"), "utf-8");
    expect(src).toContain("export function frobnicate");
    expect(src).toContain("./beta.mjs");
  });

  it("zeta.mjs imports frobnicate from alpha.mjs (known caller edge)", () => {
    const src = readFileSync(resolve(TINY_PROJECT_DIR, "src/zeta.mjs"), "utf-8");
    expect(src).toContain("frobnicate");
    expect(src).toContain("./alpha.mjs");
  });

  it("epsilon.mjs is a leaf (no imports from other fixture files)", () => {
    const src = readFileSync(resolve(TINY_PROJECT_DIR, "src/epsilon.mjs"), "utf-8");
    // epsilon should not import from other fixture files
    expect(src).not.toContain("./alpha.mjs");
    expect(src).not.toContain("./beta.mjs");
    expect(src).not.toContain("./gamma.mjs");
    expect(src).not.toContain("./delta.mjs");
    expect(src).not.toContain("./zeta.mjs");
  });

  it("helpers.py contains make_fixture which calls parse_record", () => {
    const src = readFileSync(resolve(TINY_PROJECT_DIR, "utils/helpers.py"), "utf-8");
    expect(src).toContain("def make_fixture");
    expect(src).toContain("parse_record");
  });
});
