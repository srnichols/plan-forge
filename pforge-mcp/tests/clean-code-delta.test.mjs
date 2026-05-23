/**
 * clean-code-delta.test.mjs — PostSliceCleanCode delta runner unit tests
 *
 * Exercises the standalone scripts/audit/clean-code-delta.mjs helper:
 *   - commit-message skip patterns (docs / ci / merge / --no-verify / non-conventional)
 *   - config-disabled gate
 *   - first-run baseline initialization
 *   - silent path (deltas within threshold)
 *   - advisory path (LOC growth crosses locIncrease threshold)
 *   - warning path (new long-param-list)
 *   - warning path (new module crosses high-LOC ceiling)
 *   - history append behaviour
 *   - --no-write opt-out
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCleanCodeDelta } from "../../scripts/audit/clean-code-delta.mjs";

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-cleancode-delta-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeForgeConfig(dir, postSliceCleanCode = { enabled: true }) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify({
    hooks: { postSliceCleanCode: postSliceCleanCode },
  }, null, 2));
}

function writeSrcFile(dir, relPath, content) {
  const abs = resolve(dir, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function writeBaseline(dir, totals) {
  const baselineDir = resolve(dir, ".forge");
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(
    resolve(baselineDir, "clean-code-baseline.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), totals }, null, 2),
  );
}

// ─── commit-message skip patterns ───────────────────────────────────────

describe("runCleanCodeDelta — commit-message skip gating", () => {
  it("skips on docs: commit", () => {
    writeForgeConfig(tempDir);
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "docs: update readme" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toMatch(/skip-pattern/);
  });

  it("skips on ci: commit", () => {
    writeForgeConfig(tempDir);
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "ci: pin node version" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toMatch(/skip-pattern/);
  });

  it("skips on Merge commit", () => {
    writeForgeConfig(tempDir);
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "Merge branch 'topic' into main" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toMatch(/skip-pattern/);
  });

  it("skips on --no-verify commit", () => {
    writeForgeConfig(tempDir);
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "feat(api): quick patch --no-verify" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toMatch(/skip-pattern/);
  });

  it("skips on non-conventional commit", () => {
    writeForgeConfig(tempDir);
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "just some words" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("not-conventional-commit");
  });

  it("skips when commitMessage is empty", () => {
    writeForgeConfig(tempDir);
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("no-commit-message");
  });
});

// ─── config gate ────────────────────────────────────────────────────────

describe("runCleanCodeDelta — config gate", () => {
  it("skips with config-disabled when .forge.json is absent", () => {
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "feat(api): x" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("config-disabled");
  });

  it("skips with config-disabled when hooks.postSliceCleanCode.enabled is false", () => {
    writeForgeConfig(tempDir, { enabled: false });
    const r = runCleanCodeDelta({ cwd: tempDir, commitMessage: "feat(api): x" });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("config-disabled");
  });

  it("opts.force bypasses config-disabled", () => {
    // No config, no scope changes — but force=true means we still proceed
    // until the scope filter, which then returns "no-scoped-files-changed".
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): x",
      changedFiles: [],
      force: true,
    });
    expect(r.skippedReason).toBe("no-scoped-files-changed");
  });
});

// ─── scope filter ───────────────────────────────────────────────────────

describe("runCleanCodeDelta — scope filter", () => {
  it("skips when no scoped files changed", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs: ["src/**/*.mjs"] });
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): x",
      changedFiles: ["README.md", "docs/foo.md"],
    });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("no-scoped-files-changed");
  });

  it("proceeds when at least one scoped file changed", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs: ["src/**/*.mjs"] });
    writeSrcFile(tempDir, "src/a.mjs", "export const a = 1;\n");
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): x",
      changedFiles: ["src/a.mjs"],
      write: false,
    });
    expect(r.triggered).toBe(true);
    expect(r.scope).toContain("src/a.mjs");
  });
});

// ─── baseline initialization ────────────────────────────────────────────

describe("runCleanCodeDelta — baseline lifecycle", () => {
  it("first run initializes baseline (no prior)", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs: ["src/**/*.mjs"] });
    writeSrcFile(tempDir, "src/a.mjs", "export const a = 1;\nexport const b = 2;\n");
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): initial work",
      changedFiles: ["src/a.mjs"],
    });
    expect(r.action).toBe("baseline-initialized");
    expect(r.prior).toBeNull();
    expect(r.totals.loc).toBeGreaterThan(0);
    expect(existsSync(resolve(tempDir, ".forge", "clean-code-baseline.json"))).toBe(true);
  });

  it("writes a history entry on every (non-skipped) run", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs: ["src/**/*.mjs"] });
    writeSrcFile(tempDir, "src/a.mjs", "export const a = 1;\n");
    runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): one",
      changedFiles: ["src/a.mjs"],
    });
    const history = readFileSync(resolve(tempDir, ".forge", "clean-code-history.jsonl"), "utf-8");
    const lines = history.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.action).toBe("baseline-initialized");
    expect(entry.scope).toContain("src/a.mjs");
  });

  it("--no-write does not create baseline or history files", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs: ["src/**/*.mjs"] });
    writeSrcFile(tempDir, "src/a.mjs", "export const a = 1;\n");
    runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): dry",
      changedFiles: ["src/a.mjs"],
      write: false,
    });
    expect(existsSync(resolve(tempDir, ".forge", "clean-code-baseline.json"))).toBe(false);
    expect(existsSync(resolve(tempDir, ".forge", "clean-code-history.jsonl"))).toBe(false);
  });
});

// ─── delta classification ───────────────────────────────────────────────

describe("runCleanCodeDelta — delta classification", () => {
  const scopeGlobs = ["src/**/*.mjs"];

  it("returns silent when metrics improved", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs });
    writeSrcFile(tempDir, "src/a.mjs", "export const a = 1;\n");
    writeBaseline(tempDir, {
      loc: 9999, functions: 99, todos: 99, longParams: 9, modulesOverHighThreshold: 9, filesScanned: 1,
    });
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "refactor(api): trim",
      changedFiles: ["src/a.mjs"],
    });
    expect(r.action).toBe("silent");
    expect(r.message).toBeNull();
  });

  it("returns silent when deltas within thresholds", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs });
    writeSrcFile(tempDir, "src/a.mjs", "export const a = 1;\nexport const b = 2;\n");
    writeBaseline(tempDir, {
      loc: 2, functions: 2, todos: 0, longParams: 0, modulesOverHighThreshold: 0, filesScanned: 1,
    });
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): nudge",
      changedFiles: ["src/a.mjs"],
    });
    expect(r.action).toBe("silent");
  });

  it("returns advisory when LOC grows past locIncrease threshold", () => {
    writeForgeConfig(tempDir, {
      enabled: true,
      scopeGlobs,
      warnThresholds: { newTodos: 99, newLongParams: 99, newModulesOverHighThreshold: 99, locIncrease: 10 },
    });
    const bigBody = Array.from({ length: 50 }, (_, i) => `export const k${i} = ${i};`).join("\n");
    writeSrcFile(tempDir, "src/a.mjs", `${bigBody}\n`);
    writeBaseline(tempDir, {
      loc: 5, functions: 5, todos: 0, longParams: 0, modulesOverHighThreshold: 0, filesScanned: 1,
    });
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): grow",
      changedFiles: ["src/a.mjs"],
    });
    expect(r.action).toBe("advisory");
    expect(r.message).toMatch(/Clean-Code Advisory/);
    expect(r.delta.loc).toBeGreaterThanOrEqual(10);
  });

  it("returns warning when a new long-param-list is added", () => {
    writeForgeConfig(tempDir, {
      enabled: true,
      scopeGlobs,
      longParamThreshold: 5,
      warnThresholds: { newTodos: 99, newLongParams: 1, newModulesOverHighThreshold: 99, locIncrease: 99999 },
    });
    // function with 6 positional params → triggers
    writeSrcFile(
      tempDir,
      "src/a.mjs",
      "export function wide(a, b, c, d, e, f) { return a + b + c + d + e + f; }\n",
    );
    writeBaseline(tempDir, {
      loc: 1, functions: 1, todos: 0, longParams: 0, modulesOverHighThreshold: 0, filesScanned: 1,
    });
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): wide",
      changedFiles: ["src/a.mjs"],
    });
    expect(r.action).toBe("warning");
    expect(r.message).toMatch(/Clean-Code Warning/);
    expect(r.delta.longParams).toBeGreaterThanOrEqual(1);
  });

  it("returns warning when a new module crosses the high-LOC ceiling", () => {
    writeForgeConfig(tempDir, {
      enabled: true,
      scopeGlobs,
      highLocThreshold: 10,
      warnThresholds: { newTodos: 99, newLongParams: 99, newModulesOverHighThreshold: 1, locIncrease: 99999 },
    });
    const longBody = Array.from({ length: 20 }, (_, i) => `// line ${i}`).join("\n");
    writeSrcFile(tempDir, "src/a.mjs", `${longBody}\n`);
    writeBaseline(tempDir, {
      loc: 1, functions: 0, todos: 0, longParams: 0, modulesOverHighThreshold: 0, filesScanned: 1,
    });
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): bigfile",
      changedFiles: ["src/a.mjs"],
    });
    expect(r.action).toBe("warning");
    expect(r.delta.modulesOverHighThreshold).toBeGreaterThanOrEqual(1);
  });

  it("counts new TODOs against the newTodos threshold", () => {
    writeForgeConfig(tempDir, {
      enabled: true,
      scopeGlobs,
      warnThresholds: { newTodos: 1, newLongParams: 99, newModulesOverHighThreshold: 99, locIncrease: 99999 },
    });
    writeSrcFile(tempDir, "src/a.mjs", "// TODO: revisit\nexport const a = 1;\n");
    writeBaseline(tempDir, {
      loc: 1, functions: 1, todos: 0, longParams: 0, modulesOverHighThreshold: 0, filesScanned: 1,
    });
    const r = runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "feat(api): defer",
      changedFiles: ["src/a.mjs"],
    });
    expect(["advisory", "warning"]).toContain(r.action);
    expect(r.delta.todos).toBeGreaterThanOrEqual(1);
  });
});

// ─── baseline updates after run ─────────────────────────────────────────

describe("runCleanCodeDelta — baseline updates", () => {
  it("overwrites baseline with current totals after a measured run", () => {
    writeForgeConfig(tempDir, { enabled: true, scopeGlobs: ["src/**/*.mjs"] });
    writeSrcFile(tempDir, "src/a.mjs", "export const a = 1;\n");
    writeBaseline(tempDir, {
      loc: 9999, functions: 999, todos: 0, longParams: 0, modulesOverHighThreshold: 0, filesScanned: 1,
    });
    runCleanCodeDelta({
      cwd: tempDir,
      commitMessage: "refactor(api): shrink",
      changedFiles: ["src/a.mjs"],
    });
    const raw = JSON.parse(readFileSync(resolve(tempDir, ".forge", "clean-code-baseline.json"), "utf-8"));
    expect(raw.totals.loc).toBeLessThan(9999); // baseline was overwritten with the smaller measured value
  });
});
