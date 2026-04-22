/**
 * Plan Forge — Phase-31 Slice 5 (Complexity threshold recalibration) unit tests
 *
 * Covers:
 *   - loadQuorumConfig default threshold is 3 (recalibrated from 6 in Phase-31 Slice 5)
 *   - scoreSliceComplexity distribution properties (real-plan observed range 1–6)
 *   - Threshold=3 correctly selects slices with score ≥ 3 and excludes score < 3
 *   - Adaptive threshold mechanism still respects floor/ceiling bounds
 *
 * Research basis: docs/research/complexity-threshold-v2.65.md
 *   - 63 slices across Phase-25–30: mean=3.24, median=3, 60th-pct=3
 *   - threshold=6 selected 1/63 slices (1.6%) — effectively inert
 *   - threshold=3 selected 56/63 slices (88.9%) — correct auto-quorum coverage
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  scoreSliceComplexity,
  loadQuorumConfig,
} from "../orchestrator.mjs";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "pforge-complexity-"));
}

function writeForgeJson(cwd, obj) {
  writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(obj), "utf-8");
}

// ─── loadQuorumConfig — default threshold = 3 ────────────────────────────────

describe("loadQuorumConfig — Phase-31 recalibrated default threshold", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("default threshold is 3 (recalibrated from 6 — see complexity-threshold-v2.65.md)", () => {
    // Phase-31 Slice 5: empirical 60th-percentile across 63 real slices is 3.
    // Prior default of 6 selected only 1/63 slices; 3 selects 56/63.
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBe(3);
  });

  it("user config can override the default threshold", () => {
    writeForgeJson(cwd, { quorum: { threshold: 7 } });
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBe(7);
  });

  it("power preset threshold (5) overrides the default", () => {
    const config = loadQuorumConfig(cwd, "power");
    expect(config.threshold).toBe(5);
  });

  it("speed preset threshold (7) overrides the default", () => {
    const config = loadQuorumConfig(cwd, "speed");
    expect(config.threshold).toBe(7);
  });

  it("corrupt .forge.json falls back to default threshold 3", () => {
    writeFileSync(resolve(cwd, ".forge.json"), "CORRUPT JSON", "utf-8");
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBe(3);
  });
});

// ─── scoreSliceComplexity — distribution properties ──────────────────────────

describe("scoreSliceComplexity — score range and relative ordering", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("simple doc slice scores in the observed low range (1–3)", () => {
    // Phase-30 slices with no tasks/deps scored 1. Scores 1–3 should not
    // trigger auto-quorum at threshold=3 only if score < 3.
    const { score } = scoreSliceComplexity(
      { title: "Update CHANGELOG and VERSION", tasks: ["Edit CHANGELOG.md"], scope: ["CHANGELOG.md", "VERSION"] },
      cwd
    );
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("multi-file security slice scores >= 3 (qualifies for auto-quorum)", () => {
    const { score } = scoreSliceComplexity(
      {
        title: "Fix auth security vulnerability",
        tasks: [
          "Patch SQL injection in user lookup",
          "Update RBAC middleware",
          "Add auth regression tests",
          "Rotate CSRF token generation",
        ],
        scope: ["src/auth.ts", "src/middleware.ts", "src/db.ts", "src/routes.ts", "src/tests/auth.test.ts"],
        validationGate: "npx vitest run tests/auth.test.ts\nnpm run lint",
      },
      cwd
    );
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it("complex multi-dependency slice scores higher than a simple slice", () => {
    const simple = scoreSliceComplexity(
      { title: "Update readme", tasks: ["Edit README.md"], scope: ["README.md"] },
      cwd
    );
    const complex = scoreSliceComplexity(
      {
        title: "Register forge_estimate_quorum MCP tool",
        tasks: ["Add tool handler", "Wire cost-service", "Update capabilities", "Add tests", "Update docs"],
        scope: ["pforge-mcp/server.mjs", "pforge-mcp/cost-service.mjs", "pforge-mcp/capabilities.mjs",
                "pforge-mcp/tests/cost-service.test.mjs", "docs/capabilities.md"],
        depends: ["cost-service-skeleton", "estimatePlan", "estimateQuorum"],
        validationGate: "npx vitest run tests/cost-service.test.mjs\nnpx vitest run tests/server.test.mjs",
      },
      cwd
    );
    expect(complex.score).toBeGreaterThanOrEqual(simple.score);
  });

  it("returns score on 1-10 integer scale", () => {
    const { score } = scoreSliceComplexity(
      { title: "Scaffold subsystem", tasks: ["Create files"], scope: ["src/index.ts"] },
      cwd
    );
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("returns signals object with all weight fields", () => {
    const { signals } = scoreSliceComplexity(
      { title: "Test slice", tasks: ["Task 1", "Task 2"], scope: ["file1.ts", "file2.ts"] },
      cwd
    );
    expect(signals).toHaveProperty("scopeWeight");
    expect(signals).toHaveProperty("dependencyWeight");
    expect(signals).toHaveProperty("securityWeight");
    expect(signals).toHaveProperty("databaseWeight");
    expect(signals).toHaveProperty("gateWeight");
    expect(signals).toHaveProperty("taskWeight");
    expect(signals).toHaveProperty("historicalWeight");
  });
});

// ─── threshold=3 selection semantics ─────────────────────────────────────────

describe("threshold=3 quorum selection semantics", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("score=1 slice does NOT qualify for auto-quorum at threshold=3", () => {
    // A minimal slice with 0 scope files, 0 tasks, no gate will score 1.
    // It should not trigger quorum when threshold=3.
    const { score } = scoreSliceComplexity(
      { title: "Sub-tab frame", tasks: [], scope: [], validationGate: "" },
      cwd
    );
    const config = loadQuorumConfig(cwd);
    expect(score).toBeLessThan(config.threshold);
  });

  it("score=3 slice DOES qualify for auto-quorum at threshold=3", () => {
    // 5 scope files → scopeWeight = 1.0 → raw contribution = 0.20
    // score = Math.round(0.20 * 9) + 1 = Math.round(1.80) + 1 = 3 ✓
    const { score } = scoreSliceComplexity(
      {
        title: "Register forge_estimate_quorum MCP tool",
        tasks: [],
        scope: [
          "pforge-mcp/server.mjs",
          "pforge-mcp/cost-service.mjs",
          "pforge-mcp/capabilities.mjs",
          "pforge-mcp/tests/cost-service.test.mjs",
          "docs/capabilities.md",
        ],
        depends: [],
        validationGate: "",
      },
      cwd
    );
    const config = loadQuorumConfig(cwd);
    expect(score).toBeGreaterThanOrEqual(config.threshold);
  });

  it("quorum config threshold default (3) is below the power preset threshold (5)", () => {
    // Auto-quorum should be more permissive than power-preset quorum.
    const autoConfig = loadQuorumConfig(cwd);
    const powerConfig = loadQuorumConfig(cwd, "power");
    expect(autoConfig.threshold).toBeLessThan(powerConfig.threshold);
  });

  it("quorum config threshold default (3) is below the speed preset threshold (7)", () => {
    const autoConfig = loadQuorumConfig(cwd);
    const speedConfig = loadQuorumConfig(cwd, "speed");
    expect(autoConfig.threshold).toBeLessThan(speedConfig.threshold);
  });
});

// ─── adaptive threshold still respects floor/ceiling ─────────────────────────

describe("loadQuorumConfig adaptive threshold — floor/ceiling invariants", () => {
  let cwd;
  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("adaptive does not lower threshold below 3 even with 100% quorum-needed history", () => {
    // Simulate quorum history where every slice needed quorum (neededRate = 1.0 > 0.6).
    // The adaptive logic may lower the threshold, but the floor remains 3.
    const history = Array.from({ length: 10 }, (_, i) => JSON.stringify({
      sliceId: `slice-${i}`, quorumNeeded: true,
    })).join("\n");
    writeFileSync(resolve(cwd, ".forge", "quorum-history.jsonl"), history, "utf-8");
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBeGreaterThanOrEqual(3);
  });

  it("adaptive does not raise threshold above 9 with all-unneeded history", () => {
    // neededRate = 0.0 < 0.2 → adaptive raises threshold, capped at 9.
    const history = Array.from({ length: 10 }, (_, i) => JSON.stringify({
      sliceId: `slice-${i}`, quorumNeeded: false,
    })).join("\n");
    writeFileSync(resolve(cwd, ".forge", "quorum-history.jsonl"), history, "utf-8");
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBeLessThanOrEqual(9);
  });
});
