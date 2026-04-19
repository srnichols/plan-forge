/**
 * Plan Forge — TEMPER-05 Slice 05.2: Mutation scanner tests.
 *
 * ~30 assertions covering all scanner result paths: disabled, schedule-
 * skipped, stack-not-supported, tool-not-installed, budget-exceeded,
 * above/below minimum, per-layer minima, no-mutants, captureMemory,
 * hub events, fullMutation override, adapter delegation, result shape,
 * JSON parse fallback.
 */

import { describe, it, expect, vi } from "vitest";
import { runMutationScan, MUTATION_DEFAULTS } from "../tempering/scanners/mutation.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeHub() {
  const events = [];
  return {
    events,
    broadcast(evt) { events.push(evt); },
  };
}

function makeConfig(overrides = {}) {
  return {
    scanners: { mutation: { ...MUTATION_DEFAULTS, ...overrides } },
    runtimeBudgets: { mutationMaxMs: 600_000 },
    _detectedStack: "typescript",
  };
}

function fakeSpawn(result) {
  return async () => ({
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.exitCode ?? 0,
    timedOut: result.timedOut || false,
  });
}

function fakeImportFn(adapter) {
  return async () => ({ temperingAdapter: adapter });
}

const passingAdapter = {
  mutation: {
    supported: true,
    cmd: ["stryker", "run"],
    parseOutput: () => ({ mutationScore: 85, killed: 85, survived: 15, timeout: 0, noCoverage: 0, layers: null }),
  },
};

const failingAdapter = {
  mutation: {
    supported: true,
    cmd: ["stryker", "run"],
    parseOutput: () => ({ mutationScore: 40, killed: 40, survived: 60, timeout: 0, noCoverage: 0, layers: null }),
  },
};

const perLayerAdapter = {
  mutation: {
    supported: true,
    cmd: ["stryker", "run"],
    parseOutput: () => ({
      mutationScore: 65,
      killed: 65,
      survived: 35,
      timeout: 0,
      noCoverage: 0,
      layers: { domain: 80, integration: 40, overall: 65 },
    }),
  },
};

const unsupportedAdapter = {
  mutation: { supported: false },
};

const noMutationAdapter = {
  unit: { supported: true },
};

// ─── MUTATION_DEFAULTS shape ─────────────────────────────────────────

describe("MUTATION_DEFAULTS", () => {
  it("has expected shape", () => {
    expect(MUTATION_DEFAULTS.enabled).toBe(true);
    expect(MUTATION_DEFAULTS.minima.domain).toBe(70);
    expect(MUTATION_DEFAULTS.minima.integration).toBe(50);
    expect(MUTATION_DEFAULTS.minima.overall).toBe(60);
    expect(MUTATION_DEFAULTS.criticalPaths).toEqual([]);
    expect(MUTATION_DEFAULTS.fullMutation).toBe(false);
    expect(MUTATION_DEFAULTS.nightlyOnly).toBe(true);
    expect(MUTATION_DEFAULTS.mutationMaxMs).toBe(600_000);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(MUTATION_DEFAULTS)).toBe(true);
  });
});

// ─── Scanner disabled ────────────────────────────────────────────────

describe("runMutationScan — scanner disabled", () => {
  it("returns skipped/scanner-disabled when config.scanners.mutation === false", async () => {
    const result = await runMutationScan({
      config: { scanners: { mutation: false } },
      projectDir: "/tmp/fake",
    });
    expect(result.verdict).toBe("skipped");
    expect(result.reason).toBe("scanner-disabled");
    expect(result.scanner).toBe("mutation");
  });
});

// ─── Schedule skipped ────────────────────────────────────────────────

describe("runMutationScan — schedule skipped", () => {
  it("returns skipped/schedule-skipped for post-slice without critical path", async () => {
    const result = await runMutationScan({
      config: makeConfig({ criticalPaths: ["src/core/**"] }),
      projectDir: "/tmp/fake",
      trigger: "post-slice",
      touchedFiles: ["tests/foo.test.ts"],
      importFn: fakeImportFn(passingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("skipped");
    expect(result.reason).toBe("schedule-skipped");
    expect(result.scheduleReason).toBe("non-critical-post-slice");
  });
});

// ─── Stack not supported ─────────────────────────────────────────────

describe("runMutationScan — stack not supported", () => {
  it("returns skipped/stack-not-supported when adapter has no mutation entry", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(noMutationAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("skipped");
    expect(result.reason).toBe("stack-not-supported");
  });

  it("returns skipped/stack-not-supported when adapter.mutation.supported is false", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(unsupportedAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("skipped");
    expect(result.reason).toBe("stack-not-supported");
  });
});

// ─── Tool not installed ──────────────────────────────────────────────

describe("runMutationScan — tool not installed", () => {
  it("returns skipped/tool-not-installed when no spawnFn provided", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(passingAdapter),
      spawnFn: null,
    });
    expect(result.verdict).toBe("skipped");
    expect(result.reason).toBe("tool-not-installed");
  });
});

// ─── Budget exceeded ─────────────────────────────────────────────────

describe("runMutationScan — budget exceeded", () => {
  it("returns budget-exceeded when spawn times out", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(passingAdapter),
      spawnFn: fakeSpawn({ timedOut: true }),
    });
    expect(result.verdict).toBe("budget-exceeded");
    expect(result.reason).toBe("budget-exceeded");
  });
});

// ─── Passing scan ────────────────────────────────────────────────────

describe("runMutationScan — passing scan", () => {
  it("returns pass with correct mutation score when above minimum", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(passingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("pass");
    expect(result.mutationScore).toBe(85);
    expect(result.killed).toBe(85);
    expect(result.survived).toBe(15);
    expect(result.scanner).toBe("mutation");
  });
});

// ─── Failing scan (below minimum) ───────────────────────────────────

describe("runMutationScan — failing scan", () => {
  it("returns fail when mutation score is below overall minimum", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(failingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("fail");
    expect(result.mutationScore).toBe(40);
  });

  it("emits tempering-mutation-below-minimum hub event on fail", async () => {
    const hub = makeHub();
    await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(failingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
      hub,
    });
    const evt = hub.events.find((e) => e.type === "tempering-mutation-below-minimum");
    expect(evt).toBeDefined();
    expect(evt.data.overallScore).toBe(40);
  });

  it("calls captureMemory with correct tags on fail", async () => {
    const capture = vi.fn();
    await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(failingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
      captureMemory: capture,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toBe("lesson");
    expect(capture.mock.calls[0][2]).toBe("tempering/mutation-gap");
  });
});

// ─── Per-layer minima ────────────────────────────────────────────────

describe("runMutationScan — per-layer minima", () => {
  it("detects layers below their per-layer minimum", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(perLayerAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("fail");
    expect(result.layers).toBeInstanceOf(Array);
    const integrationLayer = result.layers.find((l) => l.layer === "integration");
    expect(integrationLayer.pass).toBe(false);
    expect(integrationLayer.score).toBe(40);
  });
});

// ─── No mutants generated ───────────────────────────────────────────

describe("runMutationScan — no mutants", () => {
  it("returns skipped/no-mutants-generated when adapter returns zeros", async () => {
    const emptyAdapter = {
      mutation: {
        supported: true,
        cmd: ["stryker", "run"],
        parseOutput: () => ({ mutationScore: null, killed: 0, survived: 0, timeout: 0, noCoverage: 0, layers: null }),
      },
    };
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(emptyAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("skipped");
    expect(result.reason).toBe("no-mutants-generated");
  });
});

// ─── fullMutation override ──────────────────────────────────────────

describe("runMutationScan — fullMutation override", () => {
  it("runs even on post-slice when fullMutation is set", async () => {
    const result = await runMutationScan({
      config: makeConfig({ fullMutation: true }),
      projectDir: "/tmp/fake",
      trigger: "post-slice",
      touchedFiles: [],
      importFn: fakeImportFn(passingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result.verdict).toBe("pass");
  });
});

// ─── Result shape validation ─────────────────────────────────────────

describe("runMutationScan — result shape", () => {
  it("contains all required fields", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(passingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    expect(result).toHaveProperty("scanner", "mutation");
    expect(result).toHaveProperty("startedAt");
    expect(result).toHaveProperty("completedAt");
    expect(result).toHaveProperty("verdict");
    expect(result).toHaveProperty("pass");
    expect(result).toHaveProperty("fail");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("mutationScore");
    expect(result).toHaveProperty("killed");
    expect(result).toHaveProperty("survived");
  });
});

// ─── JSON parse fallback ─────────────────────────────────────────────

describe("runMutationScan — parse degraded", () => {
  it("falls back gracefully when parseOutput throws", async () => {
    const throwingAdapter = {
      mutation: {
        supported: true,
        cmd: ["stryker", "run"],
        parseOutput: () => { throw new Error("parse boom"); },
      },
    };
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(throwingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
    });
    // With exitCode 0 and parse failure, should get mutationScore 100 (degraded)
    expect(result.reason).toBe("parse-degraded");
    expect(result.mutationScore).toBe(100);
    expect(result.verdict).toBe("pass");
  });
});

// ─── Spawn error ─────────────────────────────────────────────────────

describe("runMutationScan — spawn error", () => {
  it("returns error verdict when spawn throws", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(passingAdapter),
      spawnFn: async () => { throw new Error("ENOENT"); },
    });
    expect(result.verdict).toBe("error");
    expect(result.reason).toContain("spawn-error");
  });
});

// ─── captureMemory null guard ────────────────────────────────────────

describe("runMutationScan — captureMemory null guard", () => {
  it("does not crash when captureMemory is null and scan fails", async () => {
    const result = await runMutationScan({
      config: makeConfig(),
      projectDir: "/tmp/fake",
      trigger: "manual",
      importFn: fakeImportFn(failingAdapter),
      spawnFn: fakeSpawn({ exitCode: 0 }),
      captureMemory: null,
    });
    expect(result.verdict).toBe("fail");
  });
});
