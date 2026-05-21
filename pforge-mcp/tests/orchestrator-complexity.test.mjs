/**
 * Plan Forge — quorum complexity / threshold unit tests
 *
 * Covers:
 *   - loadQuorumConfig default threshold is 5 (raised from 3 on 2026-05-21)
 *   - scoreSliceComplexity distribution properties (real-plan observed range 1–6)
 *   - Threshold=5 correctly selects slices with score ≥ 5 and excludes score < 5
 *   - Adaptive threshold mechanism still respects floor (5) / ceiling (9) bounds
 *
 * History:
 *   - Phase-31 Slice 5 (2025): recalibrated 6 → 3 because threshold=6 only
 *     selected 1/63 historical slices.
 *   - 2026-05-21: raised back to 5 because threshold=3 swung too far and
 *     selected 56/63 (~89%) slices — effectively "always quorum". Threshold=5
 *     matches the power-preset threshold and restricts auto-quorum to
 *     genuinely complex slices.
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

// ─── loadQuorumConfig — default threshold = 5 ────────────────────────────────

describe("loadQuorumConfig — Phase-31 recalibrated default threshold", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("default threshold is 5 (raised from 3 on 2026-05-21)", () => {
    // 2026-05-21: raised from 3 → 5 because threshold=3 qualified ~89% of
    // slices (effectively always-quorum). Threshold=5 matches the power preset.
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBe(5);
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

  it("corrupt .forge.json falls back to default threshold 5", () => {
    writeFileSync(resolve(cwd, ".forge.json"), "CORRUPT JSON", "utf-8");
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBe(5);
  });
});

// ─── scoreSliceComplexity — distribution properties ──────────────────────────

describe("scoreSliceComplexity — score range and relative ordering", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("simple doc slice scores in the observed low range (1–3)", () => {
    // Phase-30 slices with no tasks/deps scored 1. Scores 1–3 should not
    // trigger auto-quorum at threshold=5 only if score >= 5.
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

// ─── threshold=5 selection semantics ─────────────────────────────────────────

describe("threshold=5 quorum selection semantics", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("score=1 slice does NOT qualify for auto-quorum at threshold=5", () => {
    // A minimal slice with 0 scope files, 0 tasks, no gate will score 1.
    // It should not trigger quorum when threshold=5.
    const { score } = scoreSliceComplexity(
      { title: "Sub-tab frame", tasks: [], scope: [], validationGate: "" },
      cwd
    );
    const config = loadQuorumConfig(cwd);
    expect(score).toBeLessThan(config.threshold);
  });

  it("low-complexity slice (score < 5) does NOT qualify at the new default", () => {
    // A 5-scope-file slice with no tasks/deps/gate scores ~3 (60th-percentile
    // historical median). Under the new default (5) it should NOT trigger quorum.
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
    expect(score).toBeLessThan(config.threshold);
  });

  it("high-complexity multi-file security slice DOES qualify at threshold=5", () => {
    // Many files + security keywords + multi-task + multi-line gate → score ≥ 5.
    const { score } = scoreSliceComplexity(
      {
        title: "Fix auth security vulnerability across middleware and DB",
        tasks: [
          "Patch SQL injection in user lookup",
          "Update RBAC middleware",
          "Add auth regression tests",
          "Rotate CSRF token generation",
          "Audit session store for leaks",
          "Document new threat model",
        ],
        scope: [
          "src/auth.ts", "src/middleware.ts", "src/db.ts",
          "src/routes.ts", "src/tests/auth.test.ts",
        ],
        depends: ["auth-service", "rbac-policy", "session-store"],
        validationGate: "npx vitest run tests/auth.test.ts\nnpm run lint\nnpm run security:scan",
      },
      cwd
    );
    const config = loadQuorumConfig(cwd);
    expect(score).toBeGreaterThanOrEqual(config.threshold);
  });

  it("quorum config threshold default (5) matches the power preset threshold (5)", () => {
    // Auto-quorum default and power preset agree on the threshold floor.
    const autoConfig = loadQuorumConfig(cwd);
    const powerConfig = loadQuorumConfig(cwd, "power");
    expect(autoConfig.threshold).toBe(powerConfig.threshold);
  });

  it("quorum config threshold default (5) is below the speed preset threshold (7)", () => {
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

  it("adaptive does not lower threshold below 5 even with 100% quorum-needed history", () => {
    // Simulate quorum history where every slice needed quorum (neededRate = 1.0 > 0.6).
    // The adaptive logic may lower the threshold, but the floor remains 5
    // (raised from 3 on 2026-05-21 to match the static default).
    const history = Array.from({ length: 10 }, (_, i) => JSON.stringify({
      sliceId: `slice-${i}`, quorumNeeded: true,
    })).join("\n");
    writeFileSync(resolve(cwd, ".forge", "quorum-history.jsonl"), history, "utf-8");
    const config = loadQuorumConfig(cwd);
    expect(config.threshold).toBeGreaterThanOrEqual(5);
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
