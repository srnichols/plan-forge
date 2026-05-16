/**
 * 07-lattice-callers-accuracy.test.mjs — Scenario 7: Lattice callers accuracy.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 7):
 *   MUST: After seeding chunks.jsonl + edges.jsonl from the tiny-project call graph,
 *         latticeCallers({ name }) returns the expected caller chunks per
 *         fixtures/expected-callers.json.
 *   MUST: latticeCallers returns total:0 for a symbol with no callers (wumble is an
 *         entry point — nothing calls it).
 *   MUST: latticeCallers with limit cap returns at most limit chunks and sets
 *         truncated:true when more callers exist.
 *   MUST: latticeCallers with an unknown symbol returns total:0 and a non-empty message.
 *   MUST: calling latticeCallers without a name returns total:0, chunks:[], non-empty message.
 *
 * Pure latticeCallers unit tests — no network, no git, no latticeIndex needed.
 * All file I/O is isolated to tmp via useTmpForgeHome.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { latticeCallers } from "../../../lattice.mjs";
import { createTmpForgeHome, useTmpForgeHome } from "./helpers/with-tmp-forge-home.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CALLERS_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures", "expected-callers.json"), "utf-8")
);

// ─── Seeded JSONL data: mirrors tiny-project call graph ───────────────────────
// These records represent the known edges documented in fixtures/expected-callers.json.
// IDs are simple strings — latticeCallers joins edges.callerChunkId → chunks.id,
// so the values just need to be internally consistent.

const SEEDED_CHUNKS = [
  { id: "chunk-wumble",       filePath: "src/zeta.mjs",     kind: "function", name: "wumble",       language: "mjs" },
  { id: "chunk-frobnicate",   filePath: "src/alpha.mjs",    kind: "function", name: "frobnicate",   language: "mjs" },
  { id: "chunk-combulate",    filePath: "src/beta.mjs",     kind: "function", name: "combulate",    language: "mjs" },
  { id: "chunk-flibbert",     filePath: "src/gamma.mjs",    kind: "function", name: "flibbert",     language: "mjs" },
  { id: "chunk-quibblate",    filePath: "src/delta.mjs",    kind: "function", name: "quibblate",    language: "mjs" },
  { id: "chunk-snargle",      filePath: "src/epsilon.mjs",  kind: "function", name: "snargle",      language: "mjs" },
  { id: "chunk-make_fixture", filePath: "utils/helpers.py", kind: "function", name: "make_fixture", language: "py"  },
  { id: "chunk-parse_record", filePath: "utils/helpers.py", kind: "function", name: "parse_record", language: "py"  },
];

const SEEDED_EDGES = [
  { callerChunkId: "chunk-wumble",       calleeName: "frobnicate"   },
  { callerChunkId: "chunk-frobnicate",   calleeName: "combulate"    },
  { callerChunkId: "chunk-combulate",    calleeName: "flibbert"     },
  { callerChunkId: "chunk-flibbert",     calleeName: "quibblate"    },
  { callerChunkId: "chunk-quibblate",    calleeName: "snargle"      },
  { callerChunkId: "chunk-make_fixture", calleeName: "parse_record" },
];

/**
 * Write chunks.jsonl and edges.jsonl into <home>/.forge/lattice/.
 * @param {{ forge: Function, mkForgeDir: Function }} home
 */
function seedLattice(home) {
  const dir = home.mkForgeDir("lattice");
  writeFileSync(
    join(dir, "chunks.jsonl"),
    SEEDED_CHUNKS.map((c) => JSON.stringify(c)).join("\n") + "\n",
    "utf-8",
  );
  writeFileSync(
    join(dir, "edges.jsonl"),
    SEEDED_EDGES.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf-8",
  );
}

// ─── Scenario 7a — known single-caller cases (happy path) ─────────────────────

describe("Scenario 7a — latticeCallers returns the expected caller for each callee", () => {
  const home = useTmpForgeHome();

  beforeEach(() => {
    seedLattice(home);
  });

  const singleCallerCases = [
    { callee: "frobnicate",   callerName: "wumble",       callerFile: "src/zeta.mjs"     },
    { callee: "combulate",    callerName: "frobnicate",   callerFile: "src/alpha.mjs"    },
    { callee: "flibbert",     callerName: "combulate",    callerFile: "src/beta.mjs"     },
    { callee: "quibblate",    callerName: "flibbert",     callerFile: "src/gamma.mjs"    },
    { callee: "snargle",      callerName: "quibblate",    callerFile: "src/delta.mjs"    },
    { callee: "parse_record", callerName: "make_fixture", callerFile: "utils/helpers.py" },
  ];

  for (const { callee, callerName, callerFile } of singleCallerCases) {
    it(`callers of "${callee}" → chunk named "${callerName}" in "${callerFile}"`, () => {
      const result = latticeCallers({ name: callee, deps: { cwd: home.cwd } });
      expect(result.total).toBe(1);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].name).toBe(callerName);
      expect(result.chunks[0].filePath).toBe(callerFile);
    });
  }

  it("result has the standard ACI shape: chunks, total, truncated, message", () => {
    const result = latticeCallers({ name: "frobnicate", deps: { cwd: home.cwd } });
    expect(result).toHaveProperty("chunks");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("truncated");
    expect(result).toHaveProperty("message");
  });

  it("truncated is false when results fit within default limit", () => {
    const result = latticeCallers({ name: "frobnicate", deps: { cwd: home.cwd } });
    expect(result.truncated).toBe(false);
  });

  it("message is a non-empty string on a successful match", () => {
    const result = latticeCallers({ name: "frobnicate", deps: { cwd: home.cwd } });
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("returned chunk carries filePath, kind, name, and language fields", () => {
    const result = latticeCallers({ name: "frobnicate", deps: { cwd: home.cwd } });
    const chunk = result.chunks[0];
    expect(typeof chunk.filePath).toBe("string");
    expect(typeof chunk.kind).toBe("string");
    expect(typeof chunk.name).toBe("string");
    expect(typeof chunk.language).toBe("string");
  });
});

// ─── Scenario 7b — entry-point symbols have no callers ────────────────────────

describe("Scenario 7b — latticeCallers returns total:0 for entry-point functions", () => {
  const home = useTmpForgeHome();

  beforeEach(() => {
    seedLattice(home);
  });

  it("wumble has no callers (top-level entry point)", () => {
    const result = latticeCallers({ name: "wumble", deps: { cwd: home.cwd } });
    expect(result.total).toBe(0);
    expect(result.chunks).toHaveLength(0);
  });

  it("wumble result.truncated is false", () => {
    const result = latticeCallers({ name: "wumble", deps: { cwd: home.cwd } });
    expect(result.truncated).toBe(false);
  });

  it("wumble result.message mentions the symbol name", () => {
    const result = latticeCallers({ name: "wumble", deps: { cwd: home.cwd } });
    expect(result.message).toContain("wumble");
  });

  it("matches expected-callers.json: wumble.total === 0", () => {
    const result = latticeCallers({ name: "wumble", deps: { cwd: home.cwd } });
    expect(result.total).toBe(CALLERS_FIXTURE.wumble.total);
  });
});

// ─── Scenario 7c — unknown / missing symbol ───────────────────────────────────

describe("Scenario 7c — latticeCallers for an unknown symbol or missing name", () => {
  const home = useTmpForgeHome();

  beforeEach(() => {
    seedLattice(home);
  });

  it("unknown symbol returns total:0 and chunks:[]", () => {
    const result = latticeCallers({ name: "nonExistentFn", deps: { cwd: home.cwd } });
    expect(result.total).toBe(0);
    expect(result.chunks).toEqual([]);
  });

  it("unknown symbol has a non-empty message", () => {
    const result = latticeCallers({ name: "nonExistentFn", deps: { cwd: home.cwd } });
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("calling without name returns total:0, chunks:[], non-empty message", () => {
    const result = latticeCallers({ deps: { cwd: home.cwd } });
    expect(result.total).toBe(0);
    expect(result.chunks).toEqual([]);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("empty index (no JSONL files) returns total:0 for any name", () => {
    const emptyHome = createTmpForgeHome();
    try {
      const result = latticeCallers({ name: "frobnicate", deps: { cwd: emptyHome.cwd } });
      expect(result.total).toBe(0);
      expect(result.chunks).toEqual([]);
    } finally {
      emptyHome.cleanup();
    }
  });
});

// ─── Scenario 7d — limit cap on results ───────────────────────────────────────

describe("Scenario 7d — latticeCallers respects the limit cap", () => {
  const home = useTmpForgeHome();

  beforeEach(() => {
    // Seed 5 callers for a single callee "targetFn"
    const dir = home.mkForgeDir("lattice");
    const chunks = [];
    const edges = [];
    for (let i = 0; i < 5; i++) {
      const id = `multi-caller-${i}`;
      chunks.push({ id, filePath: `src/file${i}.mjs`, kind: "function", name: `callerFn${i}`, language: "mjs" });
      edges.push({ callerChunkId: id, calleeName: "targetFn" });
    }
    writeFileSync(
      join(dir, "chunks.jsonl"),
      chunks.map((c) => JSON.stringify(c)).join("\n") + "\n",
      "utf-8",
    );
    writeFileSync(
      join(dir, "edges.jsonl"),
      edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );
  });

  it("returns at most limit chunks when more callers exist", () => {
    const result = latticeCallers({ name: "targetFn", limit: 2, deps: { cwd: home.cwd } });
    expect(result.chunks.length).toBeLessThanOrEqual(2);
  });

  it("total reflects the full caller count even when truncated", () => {
    const result = latticeCallers({ name: "targetFn", limit: 2, deps: { cwd: home.cwd } });
    expect(result.total).toBe(5);
  });

  it("truncated is true when limit < total callers", () => {
    const result = latticeCallers({ name: "targetFn", limit: 2, deps: { cwd: home.cwd } });
    expect(result.truncated).toBe(true);
  });

  it("truncated is false when limit >= total callers", () => {
    const result = latticeCallers({ name: "targetFn", limit: 10, deps: { cwd: home.cwd } });
    expect(result.truncated).toBe(false);
    expect(result.chunks.length).toBe(5);
  });

  it("chunks returned with limit:2 are a subset of the full result", () => {
    const full   = latticeCallers({ name: "targetFn", limit: 10, deps: { cwd: home.cwd } });
    const capped = latticeCallers({ name: "targetFn", limit: 2,  deps: { cwd: home.cwd } });
    const fullIds   = new Set(full.chunks.map((c) => c.id));
    for (const c of capped.chunks) {
      expect(fullIds.has(c.id)).toBe(true);
    }
  });
});

// ─── Scenario 7e — full cross-validation against expected-callers.json ────────

describe("Scenario 7e — latticeCallers results match expected-callers.json fixture", () => {
  const home = useTmpForgeHome();

  beforeEach(() => {
    seedLattice(home);
  });

  const fixtureEntries = Object.entries(CALLERS_FIXTURE).filter(([k]) => !k.startsWith("_"));

  for (const [callee, expected] of fixtureEntries) {
    it(`fixture "${callee}": result.total === ${expected.total}`, () => {
      const result = latticeCallers({ name: callee, deps: { cwd: home.cwd } });
      expect(result.total).toBe(expected.total);
    });

    for (const expectedCaller of expected.callerChunks) {
      it(`fixture "${callee}": chunk "${expectedCaller.callerName}" (${expectedCaller.callerFile}) is in results`, () => {
        const result = latticeCallers({ name: callee, deps: { cwd: home.cwd } });
        const match = result.chunks.find(
          (c) => c.name === expectedCaller.callerName && c.filePath === expectedCaller.callerFile,
        );
        expect(match).toBeDefined();
      });
    }
  }
});
