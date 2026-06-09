/**
 * Testbed Scenario: memory-upgrade-e2e
 *
 * Phase-MEMORY-QA-PLAN Slice 6
 *
 * In-process happy-path scenario that validates the full memory-upgrade
 * pipeline: Anvil caching, Hallmark provenance capture, Lattice indexing,
 * and capability-aware brain writes — all against a mock-OpenBrain and a
 * temporary forge home.  No real git repo or external network is required.
 *
 * Registered via `pforge-mcp/testbed/scenarios/index.mjs` so
 * `forge_testbed_happypath` discovers it automatically.
 *
 * Summary shape returned from run():
 *   { anvilHits, anvilMisses, latticeChunks, hallmarkRecords, dlqCount }
 *
 * @module testbed/scenarios/memory-upgrade-e2e
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { withAnvil, anvilDlqList } from "../../anvil.mjs";
import { latticeIndex } from "../../lattice.mjs";
import { buildProvenance } from "../../../pforge-sdk/src/hallmark.mjs";
import { createMockOpenBrain } from "../../tests/integration/memory-upgrade/helpers/mock-openbrain.mjs";
import { createTmpForgeHome } from "../../tests/integration/memory-upgrade/helpers/with-tmp-forge-home.mjs";

// ─── Inline mock exec for latticeIndex (no real git required) ────────────────

function makeMockExec(fileList) {
  return function mockExec(file, args = []) {
    const cmd = [file, ...(args || [])].join(" ");
    if (cmd.startsWith("git ls-files")) return fileList.join("\n") + "\n";
    return "";
  };
}

// ─── Tiny inline chunker (no tree-sitter required) ──────────────────────────

async function testChunker({ filePath, content }) {
  return [
    {
      filePath,
      kind: "module",
      name: filePath,
      startByte: 0,
      endByte: content.length,
      references: [],
    },
  ];
}

// ─── Scenario definition ────────────────────────────────────────────────────

export const scenario = {
  scenarioId: "memory-upgrade-e2e",
  kind: "happy-path",
  description:
    "End-to-end validation of Hallmark provenance, Anvil caching, Lattice indexing, " +
    "and capability-aware brain writes against an in-process mock-OpenBrain.",

  /**
   * Run the scenario.
   *
   * Creates its own tmp forge home and mock-OpenBrain server; tears both
   * down in a `finally` block regardless of outcome.
   *
   * @param {object} [deps] - Optional injection points (hub, projectRoot).
   * @returns {Promise<{
   *   ok:           boolean,
   *   status:       "passed" | "failed" | "error",
   *   durationMs:   number,
   *   tmpDir:       string,
   *   tmpDirCleaned:boolean,
   *   summary: {
   *     anvilHits:      number,
   *     anvilMisses:    number,
   *     latticeChunks:  number,
   *     hallmarkRecords:number,
   *     dlqCount:       number,
   *   }
   * }>}
   */
  async run(deps = {}) {
    const t0 = Date.now();
    const home = createTmpForgeHome({ prefix: "pforge-memory-upgrade-e2e-" });
    const tmpDir = home.cwd;
    let ob = null;
    const findings = [];
    let result = null;

    try {
      // ── Boot mock-OpenBrain with provenance capability ────────────────────
      ob = await createMockOpenBrain({
        capabilities: ["provenance", "search", "write"],
      });

      // ── Create a tiny in-process project inside the tmp dir ────────────────
      const srcDir = join(home.cwd, "src");
      mkdirSync(srcDir, { recursive: true });

      writeFileSync(
        join(srcDir, "alpha.mjs"),
        'export function frobnicate(x) { return combulate(x); }\n',
        "utf-8",
      );
      writeFileSync(
        join(srcDir, "beta.mjs"),
        'export function combulate(x) { return x * 2; }\n',
        "utf-8",
      );
      writeFileSync(
        join(srcDir, "gamma.mjs"),
        'export function flibbert(x) { return x + 1; }\n',
        "utf-8",
      );

      const projectFiles = [
        "src/alpha.mjs",
        "src/beta.mjs",
        "src/gamma.mjs",
      ];

      // ── Slice 1: forge_analyze (Anvil-wrapped) — first call = miss ─────────
      let innerCallCount = 0;
      const analyzeFn = async (opts) => {
        innerCallCount++;
        return { findings: [], file: opts?.file ?? "unknown" };
      };

      const analyzeOpts1 = {
        toolName: "forge_analyze",
        inputs: { file: "src/alpha.mjs", line: 1 },
        codeHashSeed: "memory-upgrade-e2e:alpha@v1",
      };

      const miss1 = await withAnvil(analyzeFn, analyzeOpts1, { cwd: home.cwd });

      // ── Slice 2: forge_sweep (Anvil cache hit on same inputs) ───────────────
      const hit1 = await withAnvil(analyzeFn, analyzeOpts1, { cwd: home.cwd });

      // Second file: fresh miss
      const analyzeOpts2 = {
        toolName: "forge_analyze",
        inputs: { file: "src/beta.mjs", line: 1 },
        codeHashSeed: "memory-upgrade-e2e:beta@v1",
      };
      const miss2 = await withAnvil(analyzeFn, analyzeOpts2, { cwd: home.cwd });

      const anvilMisses = [miss1, miss2].filter((r) => !r.anvil?.hit).length;
      const anvilHits   = [hit1].filter((r) =>  r.anvil?.hit).length;

      if (anvilHits < 1) findings.push("anvil cache did not produce a hit on identical inputs");
      if (anvilMisses < 1) findings.push("anvil did not produce a miss on first call");

      // ── Slice 3: brain_capture — write Hallmark records to mock-OpenBrain ──
      const memoriesFetches = [];

      const writeMemory = async (content, toolName, sourceFile) => {
        const prov = buildProvenance({ toolName, sourceFile });
        const res = await fetch(`${ob.url}/memories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            metadata: { provenance: prov },
          }),
        });
        memoriesFetches.push(res.ok);
        return res.ok;
      };

      await writeMemory("Analysis of frobnicate in src/alpha.mjs", "forge_analyze", "src/alpha.mjs");
      await writeMemory("Analysis of combulate in src/beta.mjs",   "forge_analyze", "src/beta.mjs");
      await writeMemory("Sweep result for gamma.mjs",              "forge_sweep",   "src/gamma.mjs");

      const hallmarkRecords = ob.hitCounts.memories;
      if (hallmarkRecords < 3) findings.push(`expected ≥3 hallmark records, got ${hallmarkRecords}`);

      // ── Slice 4: forge_lattice_index ────────────────────────────────────────
      const mockExec = makeMockExec(projectFiles);
      const latticeResult = await latticeIndex({
        paths: ["."],
        deps: {
          cwd: home.cwd,
          exec: mockExec,
          chunker: testChunker,
          chunkerName: "test",
          chunkerVersion: "0.0.0",
        },
      });

      const latticeChunks = latticeResult.chunks ?? 0;
      if (latticeChunks < 1) findings.push(`lattice indexed ${latticeChunks} chunks — expected ≥1`);

      // ── Verify artifacts ────────────────────────────────────────────────────
      const anvilDirExists   = existsSync(home.forge("anvil"));
      const latticeDirExists = existsSync(home.forge("lattice"));

      if (!anvilDirExists)   findings.push(".forge/anvil directory not created");
      if (!latticeDirExists) findings.push(".forge/lattice directory not created");

      // ── DLQ count (should be 0 in the happy path) ──────────────────────────
      const { total: dlqCount } = anvilDlqList({}, { cwd: home.cwd });

      const summary = {
        anvilHits,
        anvilMisses,
        latticeChunks,
        hallmarkRecords,
        dlqCount,
      };

      const status = findings.length === 0 ? "passed" : "failed";

      result = {
        ok:     status === "passed",
        status,
        durationMs:    Date.now() - t0,
        tmpDir,
        tmpDirCleaned: false,
        findings,
        summary,
      };
    } catch (err) {
      result = {
        ok:     false,
        status: "error",
        durationMs:    Date.now() - t0,
        tmpDir,
        tmpDirCleaned: false,
        error:  err.message,
        findings,
        summary: {
          anvilHits:      0,
          anvilMisses:    0,
          latticeChunks:  0,
          hallmarkRecords:0,
          dlqCount:       0,
        },
      };
    } finally {
      if (ob) {
        try { await ob.close(); } catch { /* best-effort */ }
      }
      home.cleanup();
      if (result) result.tmpDirCleaned = !existsSync(tmpDir);
    }

    return result;
  },
};
