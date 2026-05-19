/**
 * Plan Forge — precommit-chain.test.mjs (A3)
 *
 * Tests for the PreCommit chain framework:
 *   - loadChainConfig: reads chain from plan-forge.json / .forge.json
 *   - runPreCommitChain: empty chain (no-op/fallback), one-entry chain,
 *     two-entry chain with second denying, master-reject as first entry,
 *     command entries, skip-when-not-in-run-plan
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Mock child_process ──────────────────────────────────────────────

const mockExecSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: (...args) => mockExecSync(...args),
  };
});

// ─── Test subjects (imported AFTER vi.mock) ──────────────────────────

import {
  checkPreCommit,
  loadChainConfig,
  loadPreCommitConfig,
  runPreCommitChain,
  runCommandEntry,
} from "../../.github/hooks/PreCommit.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-chain-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir, config) {
  writeFileSync(resolve(dir, "plan-forge.json"), JSON.stringify(config, null, 2));
}

function writeForgeJson(dir, config) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify(config, null, 2));
}

// ─── loadChainConfig ─────────────────────────────────────────────────

describe("loadChainConfig", () => {
  it("returns chain from explicit configPath", () => {
    const dir = makeTmpDir();
    const chain = [{ name: "master-reject", type: "builtin" }];
    writeConfig(dir, { hooks: { preCommit: { chain } } });

    const result = loadChainConfig({ configPath: resolve(dir, "plan-forge.json") });
    expect(result).toEqual(chain);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when configPath has no chain", () => {
    const dir = makeTmpDir();
    writeConfig(dir, { hooks: {} });

    const result = loadChainConfig({ configPath: resolve(dir, "plan-forge.json") });
    expect(result).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when configPath file is missing", () => {
    const result = loadChainConfig({ configPath: "/nonexistent/plan-forge.json" });
    expect(result).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const dir = makeTmpDir();
    writeFileSync(resolve(dir, "plan-forge.json"), "not json");

    const result = loadChainConfig({ configPath: resolve(dir, "plan-forge.json") });
    expect(result).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── runPreCommitChain — empty chain ─────────────────────────────────

describe("runPreCommitChain — empty chain (fallback)", () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.PFORGE_RUN_PLAN_ACTIVE = process.env.PFORGE_RUN_PLAN_ACTIVE;
    savedEnv.PFORGE_ALLOW_MASTER_COMMIT = process.env.PFORGE_ALLOW_MASTER_COMMIT;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    mockExecSync.mockReset();
  });

  it("falls back to legacy master-reject when no chain configured", () => {
    const dir = makeTmpDir();
    // No plan-forge.json, no .forge.json
    delete process.env.PFORGE_RUN_PLAN_ACTIVE;

    const result = runPreCommitChain({ cwd: dir, configPath: "/nonexistent/nope.json" });
    // Legacy behavior: not blocked when not in run-plan
    expect(result.blocked).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── runPreCommitChain — one-entry chain (builtin) ───────────────────

describe("runPreCommitChain — one-entry chain", () => {
  const savedEnv = {};
  let tmpDir;

  beforeEach(() => {
    savedEnv.PFORGE_RUN_PLAN_ACTIVE = process.env.PFORGE_RUN_PLAN_ACTIVE;
    savedEnv.PFORGE_ALLOW_MASTER_COMMIT = process.env.PFORGE_ALLOW_MASTER_COMMIT;
    tmpDir = makeTmpDir();
    writeConfig(tmpDir, {
      hooks: {
        preCommit: {
          chain: [{ name: "master-reject", type: "builtin" }],
        },
      },
    });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    mockExecSync.mockReset();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips builtin entries when not in run-plan", () => {
    delete process.env.PFORGE_RUN_PLAN_ACTIVE;

    const result = runPreCommitChain({
      cwd: tmpDir,
      configPath: resolve(tmpDir, "plan-forge.json"),
    });
    expect(result.blocked).toBe(false);
    expect(result.results).toBeDefined();
    expect(result.results[0].skipped).toBe(true);
  });

  it("blocks when master-reject fires during run-plan on master", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    delete process.env.PFORGE_ALLOW_MASTER_COMMIT;
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "master\n";
      throw new Error("unmocked");
    });

    const result = runPreCommitChain({
      cwd: tmpDir,
      configPath: resolve(tmpDir, "plan-forge.json"),
    });
    expect(result.blocked).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/PreCommit blocked/);
    expect(result.results).toHaveLength(1);
  });

  it("allows when on feature branch during run-plan", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "feat/my-feature\n";
      throw new Error("unmocked");
    });

    const result = runPreCommitChain({
      cwd: tmpDir,
      configPath: resolve(tmpDir, "plan-forge.json"),
    });
    expect(result.blocked).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].blocked).toBe(false);
  });
});

// ─── runPreCommitChain — two-entry chain with second denying ─────────

describe("runPreCommitChain — two-entry chain", () => {
  const savedEnv = {};
  let tmpDir;

  beforeEach(() => {
    savedEnv.PFORGE_RUN_PLAN_ACTIVE = process.env.PFORGE_RUN_PLAN_ACTIVE;
    savedEnv.PFORGE_ALLOW_MASTER_COMMIT = process.env.PFORGE_ALLOW_MASTER_COMMIT;
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    mockExecSync.mockReset();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("aborts on second entry deny — first entry passes", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";

    writeConfig(tmpDir, {
      hooks: {
        preCommit: {
          chain: [
            { name: "master-reject", type: "builtin" },
            { name: "custom-check", type: "command", command: "echo deny-cmd" },
          ],
        },
      },
    });

    // master-reject passes (on feature branch)
    // custom-check command returns deny JSON
    mockExecSync.mockImplementation((cmd, opts) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "feat/ok\n";
      if (cmd === "echo deny-cmd") return JSON.stringify({ blocked: true, message: "Custom deny" });
      throw new Error(`unmocked: ${cmd}`);
    });

    const result = runPreCommitChain({
      cwd: tmpDir,
      configPath: resolve(tmpDir, "plan-forge.json"),
    });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe("Custom deny");
    expect(result.results).toHaveLength(2);
    expect(result.results[0].blocked).toBe(false);
    expect(result.results[1].blocked).toBe(true);
  });

  it("aborts on first entry deny — second entry never runs", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    delete process.env.PFORGE_ALLOW_MASTER_COMMIT;

    writeConfig(tmpDir, {
      hooks: {
        preCommit: {
          chain: [
            { name: "master-reject", type: "builtin" },
            { name: "never-reached", type: "command", command: "echo should-not-run" },
          ],
        },
      },
    });

    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "master\n";
      if (cmd === "echo should-not-run") throw new Error("Should not be called");
      throw new Error(`unmocked: ${cmd}`);
    });

    const result = runPreCommitChain({
      cwd: tmpDir,
      configPath: resolve(tmpDir, "plan-forge.json"),
    });
    expect(result.blocked).toBe(true);
    // Only 1 result — second entry never ran
    expect(result.results).toHaveLength(1);
  });

  it("passes when both entries allow", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";

    writeConfig(tmpDir, {
      hooks: {
        preCommit: {
          chain: [
            { name: "master-reject", type: "builtin" },
            { name: "pass-check", type: "command", command: "echo pass-cmd" },
          ],
        },
      },
    });

    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "feat/ok\n";
      if (cmd === "echo pass-cmd") return JSON.stringify({ blocked: false, advisory: "All good" });
      throw new Error(`unmocked: ${cmd}`);
    });

    const result = runPreCommitChain({
      cwd: tmpDir,
      configPath: resolve(tmpDir, "plan-forge.json"),
    });
    expect(result.blocked).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.advisory).toMatch(/All good/);
  });
});

// ─── runCommandEntry ─────────────────────────────────────────────────

describe("runCommandEntry", () => {
  afterEach(() => {
    mockExecSync.mockReset();
  });

  it("returns not-blocked for empty stdout", () => {
    mockExecSync.mockReturnValue("");
    const result = runCommandEntry({ name: "test", command: "echo" });
    expect(result.blocked).toBe(false);
  });

  it("parses JSON allow response", () => {
    mockExecSync.mockReturnValue(JSON.stringify({ blocked: false, advisory: "info" }));
    const result = runCommandEntry({ name: "test", command: "test-cmd" });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toBe("info");
  });

  it("parses JSON deny response", () => {
    mockExecSync.mockReturnValue(JSON.stringify({ blocked: true, message: "denied" }));
    const result = runCommandEntry({ name: "test", command: "test-cmd" });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe("denied");
  });

  it("treats non-zero exit as deny (fail-closed)", () => {
    const err = new Error("exit 1");
    err.status = 1;
    err.stdout = "";
    mockExecSync.mockImplementation(() => { throw err; });

    const result = runCommandEntry({ name: "test", command: "test-cmd" });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/exited with code 1/);
  });

  it("parses JSON from non-zero exit stdout", () => {
    const err = new Error("exit 1");
    err.status = 1;
    err.stdout = JSON.stringify({ blocked: true, message: "Custom error" });
    mockExecSync.mockImplementation(() => { throw err; });

    const result = runCommandEntry({ name: "test", command: "test-cmd" });
    expect(result.blocked).toBe(true);
    expect(result.message).toBe("Custom error");
  });

  it("returns advisory on timeout (not blocked)", () => {
    const err = new Error("ETIMEDOUT");
    mockExecSync.mockImplementation(() => { throw err; });

    const result = runCommandEntry({ name: "slow", command: "sleep 999" });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toMatch(/error/i);
  });

  it("returns advisory when no command for platform", () => {
    const result = runCommandEntry({ name: "test" });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toMatch(/no command/i);
  });
});

// ─── Unknown types ───────────────────────────────────────────────────

describe("runPreCommitChain — unknown entry type", () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.PFORGE_RUN_PLAN_ACTIVE = process.env.PFORGE_RUN_PLAN_ACTIVE;
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
  });

  afterEach(() => {
    if (savedEnv.PFORGE_RUN_PLAN_ACTIVE === undefined) delete process.env.PFORGE_RUN_PLAN_ACTIVE;
    else process.env.PFORGE_RUN_PLAN_ACTIVE = savedEnv.PFORGE_RUN_PLAN_ACTIVE;
    mockExecSync.mockReset();
  });

  it("skips entries with unknown type", () => {
    const dir = makeTmpDir();
    writeConfig(dir, {
      hooks: {
        preCommit: {
          chain: [{ name: "mystery", type: "webhook" }],
        },
      },
    });

    const result = runPreCommitChain({
      cwd: dir,
      configPath: resolve(dir, "plan-forge.json"),
    });
    expect(result.blocked).toBe(false);
    expect(result.results[0].skipped).toBe(true);
    expect(result.results[0].reason).toMatch(/unknown type/);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── master-reject is first entry in shipped template ────────────────

describe("shipped plan-forge.json template", () => {
  it("has master-reject as the first chain entry", () => {
    const templatePath = resolve(
      import.meta.dirname, "..", "..", "templates", ".github", "hooks", "plan-forge.json"
    );
    const cfg = JSON.parse(readFileSync(templatePath, "utf-8"));
    expect(cfg.hooks.preCommit).toBeDefined();
    expect(cfg.hooks.preCommit.chain).toBeDefined();
    expect(Array.isArray(cfg.hooks.preCommit.chain)).toBe(true);
    expect(cfg.hooks.preCommit.chain.length).toBeGreaterThanOrEqual(1);
    expect(cfg.hooks.preCommit.chain[0].name).toBe("master-reject");
    expect(cfg.hooks.preCommit.chain[0].type).toBe("builtin");
  });
});

// Need readFileSync for template check
import { readFileSync } from "node:fs";
