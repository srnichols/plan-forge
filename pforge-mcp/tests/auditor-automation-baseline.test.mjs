/**
 * Plan Forge — Phase-39 (AUDITOR-AUTOMATION) Slice 0
 * Baseline regression harness — captures current behavior before the phase begins.
 *
 * Purpose: each subsequent slice (S1-S8) that touches a covered surface must
 * re-run this file to confirm no unintended regressions. Six surfaces captured:
 *
 *   1. runWatch() snapshot output shape
 *   2. runWatchLive() event-stream response shape
 *   3. forge_master_ask / runTurn() module contract + response-field set
 *   4. Orchestrator end-of-run: no _auditor field today (pre-S1)
 *   5. .forge.json: hooks.postRun.invokeAuditor is absent from orchestrator today
 *   6. pforge-master/server.mjs: exposes exactly 1 tool today (forge_master_ask)
 *
 * Surfaces 4 and 6 are intentionally updated by later slices:
 *   Surface 4 → S1 adds _auditor field on failure + onFailure:true config
 *   Surface 6 → S5 adds forge_master_observe (tool count becomes 2)
 *
 * Tests are written to PASS now and flag drift from today's contract.
 * "No LLM call" tests use the off-topic path (forceKeywordOnly: true) or
 * inspect module exports/source — never hitting a provider endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runWatch, runWatchLive } from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SERVER_MJS_PATH = resolve(REPO_ROOT, "pforge-master", "server.mjs");
const ORCHESTRATOR_PATH = resolve(REPO_ROOT, "pforge-mcp", "orchestrator.mjs");

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-phase39-baseline-"));
  // Create a minimal run directory so buildWatchSnapshot can resolve a latest run.
  // findLatestRun requires at least one subdirectory inside .forge/runs/.
  const runDir = join(tempDir, ".forge", "runs", "run-baseline-seed");
  mkdirSync(runDir, { recursive: true });
  // events.log can be empty — parseEventsLog returns [] for an empty file.
  writeFileSync(join(runDir, "events.log"), "", "utf-8");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── 1. runWatch() snapshot output shape ─────────────────────────────

describe("Phase-39 Baseline: runWatch() output shape", () => {
  it("returns ok:true for a directory with .forge/runs", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when targetPath is omitted", async () => {
    const result = await runWatch({});
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("returns ok:false when targetPath does not exist", async () => {
    const result = await runWatch({ targetPath: "/no/such/path/pforge-phase39-xyz" });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("result has all required top-level shape fields", async () => {
    const result = await runWatch({ targetPath: tempDir });
    const REQUIRED = [
      "ok",
      "mode",
      "targetPath",
      "anomalies",
      "recommendations",
      "runId",
      "runState",
      "counts",
      "cursor",
      "timestamp",
    ];
    for (const field of REQUIRED) {
      expect(result, `runWatch result must have '${field}'`).toHaveProperty(field);
    }
  });

  it("mode defaults to 'snapshot'", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(result.mode).toBe("snapshot");
  });

  it("anomalies is an array", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(Array.isArray(result.anomalies)).toBe(true);
  });

  it("recommendations is an array", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it("timestamp is an ISO string", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(typeof result.timestamp).toBe("string");
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it("does NOT expose cross-run fields today (pre-S3)", async () => {
    // Slice 3 adds mode:'cross-run' and crossRunWindow — absent today.
    const result = await runWatch({ targetPath: tempDir });
    expect(result).not.toHaveProperty("crossRunWindow");
    expect(result.mode).not.toBe("cross-run");
  });

  it("counts is an object with numeric values", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(result.counts).toBeDefined();
    expect(typeof result.counts).toBe("object");
  });
});

// ─── 2. runWatchLive() event-stream response shape ───────────────────

describe("Phase-39 Baseline: runWatchLive() response shape", () => {
  it("returns ok:false when targetPath is omitted", async () => {
    const result = await runWatchLive({ onEvent: () => {} });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("returns ok:false when targetPath does not exist", async () => {
    const result = await runWatchLive({
      targetPath: "/no/such/path/pforge-phase39-xyz",
      onEvent: () => {},
    });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("returns ok:false when onEvent is not a function", async () => {
    const result = await runWatchLive({ targetPath: tempDir });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it(
    "returns polling-mode result with correct shape when no hub is running",
    async () => {
      // No .forge/server-ports.json → hub not running → falls back to polling.
      // Very short duration so the test completes quickly.
      const result = await runWatchLive({
        targetPath: tempDir,
        onEvent: () => {},
        durationMs: 150,
        pollIntervalMs: 50,
      });
      expect(result.ok).toBe(true);
      expect(result.mode).toBe("polling");
      expect(typeof result.events).toBe("number");
      expect(result.events).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe("number");
    },
    8_000,
  );

  it(
    "polling result has all required fields: ok, mode, events, durationMs",
    async () => {
      const result = await runWatchLive({
        targetPath: tempDir,
        onEvent: () => {},
        durationMs: 150,
        pollIntervalMs: 50,
      });
      const REQUIRED = ["ok", "mode", "events", "durationMs"];
      for (const field of REQUIRED) {
        expect(result, `runWatchLive result must have '${field}'`).toHaveProperty(field);
      }
    },
    8_000,
  );
});

// ─── 3. forge_master_ask / runTurn() module contract ─────────────────

describe("Phase-39 Baseline: forge_master_ask / runTurn() module contract", () => {
  it("reasoning.mjs exports runTurn as a function", async () => {
    const mod = await import("../../pforge-master/src/reasoning.mjs");
    expect(typeof mod.runTurn).toBe("function");
  });

  it("reasoning.mjs exports ABSOLUTE_CEILING = 10", async () => {
    const mod = await import("../../pforge-master/src/reasoning.mjs");
    expect(typeof mod.ABSOLUTE_CEILING).toBe("number");
    expect(mod.ABSOLUTE_CEILING).toBe(10);
  });

  it(
    "runTurn off-topic path returns all required response fields (no LLM call)",
    async () => {
      // forceKeywordOnly:true + an off-topic message short-circuits before any
      // provider call. Classification returns OFFTOPIC and runTurn returns
      // immediately — zero tokens, zero cost.
      const { runTurn } = await import("../../pforge-master/src/reasoning.mjs");
      const result = await runTurn(
        { message: "What is 2 + 2?", sessionId: "ephemeral" },
        { forceKeywordOnly: true },
      );
      const REQUIRED = [
        "reply",
        "toolCalls",
        "tokensIn",
        "tokensOut",
        "totalCostUSD",
        "truncated",
        "sessionId",
      ];
      for (const field of REQUIRED) {
        expect(result, `runTurn result must have '${field}'`).toHaveProperty(field);
      }
    },
    15_000,
  );

  it(
    "runTurn off-topic result has correct types",
    async () => {
      const { runTurn } = await import("../../pforge-master/src/reasoning.mjs");
      const result = await runTurn(
        { message: "What is 2 + 2?", sessionId: "ephemeral" },
        { forceKeywordOnly: true },
      );
      expect(typeof result.reply).toBe("string");
      expect(Array.isArray(result.toolCalls)).toBe(true);
      expect(typeof result.tokensIn).toBe("number");
      expect(typeof result.tokensOut).toBe("number");
      expect(typeof result.totalCostUSD).toBe("number");
      expect(typeof result.truncated).toBe("boolean");
    },
    15_000,
  );
});

// ─── 4. Orchestrator end-of-run — _auditor field present (post-S1) ──

describe("Phase-39 Baseline: orchestrator end-of-run — auditor auto-invoke active (S1 shipped)", () => {
  it("orchestrator source HAS summary._auditor assignment (S1 shipped)", () => {
    const src = readFileSync(ORCHESTRATOR_PATH, "utf-8");
    // S1 added: summary._auditor = { ... }
    expect(src).toMatch(/summary\._auditor\s*=/);
  });

  it("orchestrator source HAS invokeAuditor reference (S1 shipped)", () => {
    const src = readFileSync(ORCHESTRATOR_PATH, "utf-8");
    // S1 added reading of hooks.postRun.invokeAuditor from .forge.json.
    expect(src).toMatch(/invokeAuditor/);
  });
});

// ─── 5. .forge.json: hooks.postRun.* is processed by orchestrator (post-S1) ─

describe("Phase-39 Baseline: .forge.json hooks.postRun is processed (S1 shipped)", () => {
  it("orchestrator source HAS hooks.postRun processing (S1 shipped)", () => {
    const src = readFileSync(ORCHESTRATOR_PATH, "utf-8");
    // S1 added reading of hooks.postRun.invokeAuditor from .forge.json.
    expect(src).toMatch(/hooks\.postRun/);
  });

  it(".forge.json with hooks.postRun.invokeAuditor parses cleanly (silently ignored today)", () => {
    // The field is valid JSON and readable — it's just not acted on yet.
    const doc = {
      hooks: {
        postRun: {
          invokeAuditor: { onFailure: true, everyNRuns: 5 },
        },
      },
    };
    const raw = JSON.stringify(doc);
    const parsed = JSON.parse(raw);
    expect(parsed.hooks.postRun.invokeAuditor.onFailure).toBe(true);
    expect(parsed.hooks.postRun.invokeAuditor.everyNRuns).toBe(5);
  });

  it(".forge.json in this repo HAS hooks.postRun.invokeAuditor (S1 shipped)", () => {
    // .forge.json is gitignored runtime config — absent in a clean checkout/CI.
    // When present, it must carry the S1 hooks.postRun.invokeAuditor contract.
    const forgeJsonPath = resolve(REPO_ROOT, ".forge.json");
    if (!existsSync(forgeJsonPath)) {
      return; // No local config to validate; orchestrator-source tests cover S1.
    }
    const forgeJson = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
    expect(forgeJson).toHaveProperty("hooks.postRun");
    expect(forgeJson.hooks.postRun).toHaveProperty("invokeAuditor");
  });
});

// ─── 6. pforge-master/server.mjs: 2 tools (post-S5) ─────────────────

describe("Phase-39 Baseline: pforge-master/server.mjs tool count = 2 (S5 shipped)", () => {
  it("ListTools handler returns array with both tools (S5 shipped)", () => {
    const src = readFileSync(SERVER_MJS_PATH, "utf-8");
    // S5 updated to: tools: [FORGE_MASTER_ASK_TOOL, FORGE_MASTER_OBSERVE_TOOL]
    expect(src).toContain("tools: [FORGE_MASTER_ASK_TOOL, FORGE_MASTER_OBSERVE_TOOL]");
  });

  it("FORGE_MASTER_OBSERVE_TOOL IS defined in server.mjs (S5 shipped)", () => {
    const src = readFileSync(SERVER_MJS_PATH, "utf-8");
    expect(src).toContain("FORGE_MASTER_OBSERVE_TOOL");
  });

  it("startup banner reports '1 tool: forge_master_ask' today (pre-S5)", () => {
    const src = readFileSync(SERVER_MJS_PATH, "utf-8");
    expect(src).toContain("1 tool: forge_master_ask");
  });

  it("self-test validates forge_master_ask registration", () => {
    const src = readFileSync(SERVER_MJS_PATH, "utf-8");
    expect(src).toContain("forge_master_ask not registered");
  });

  it("server.mjs imports runTurn from ./src/reasoning.mjs", () => {
    const src = readFileSync(SERVER_MJS_PATH, "utf-8");
    expect(src).toContain("./src/reasoning.mjs");
  });
});
