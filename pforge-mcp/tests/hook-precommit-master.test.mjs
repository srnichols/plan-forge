/**
 * Plan Forge — Phase HOTFIX-2.50.1 Slice 3: PreCommit hook tests (#74).
 *
 * ~10 tests covering:
 *   - checkPreCommit: env-based blocking, bypass, config opt-out
 *   - detectDefaultBranch: fallback chain
 *   - spawnWorker env propagation via runPlanActive flag
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// Mock child_process at the module level so both PreCommit.mjs and orchestrator.mjs
// receive the mocked version.
const mockExecSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: (...args) => mockExecSync(...args),
    spawn: (...args) => mockSpawn(...args),
  };
});

// ─── Test subjects (imported AFTER vi.mock) ──────────────────────────

import {
  checkPreCommit,
  detectDefaultBranch,
  loadPreCommitConfig,
} from "../../.github/hooks/PreCommit.mjs";

import { spawnWorker } from "../orchestrator.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-precommit-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── detectDefaultBranch ─────────────────────────────────────────────

describe("detectDefaultBranch", () => {
  afterEach(() => {
    mockExecSync.mockReset();
  });

  it("returns branch from symbolic-ref when available", () => {
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("symbolic-ref")) return "refs/remotes/origin/main\n";
      throw new Error("not called");
    });
    expect(detectDefaultBranch("/tmp")).toBe("main");
  });

  it("falls back to git config init.defaultBranch", () => {
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("symbolic-ref")) throw new Error("no remote");
      if (cmd.includes("init.defaultBranch")) return "develop\n";
      throw new Error("not called");
    });
    expect(detectDefaultBranch("/tmp")).toBe("develop");
  });

  it("returns 'master' when all detection fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("nope");
    });
    expect(detectDefaultBranch("/tmp")).toBe("master");
  });
});

// ─── checkPreCommit ──────────────────────────────────────────────────

describe("checkPreCommit", () => {
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

  it("returns not blocked when PFORGE_RUN_PLAN_ACTIVE is absent", () => {
    delete process.env.PFORGE_RUN_PLAN_ACTIVE;
    const result = checkPreCommit({ cwd: tmpdir() });
    expect(result.blocked).toBe(false);
    expect(result.exitCode).toBeUndefined();
  });

  it("blocks when on master during run-plan", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    delete process.env.PFORGE_ALLOW_MASTER_COMMIT;
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "master\n";
      throw new Error("unmocked");
    });
    const result = checkPreCommit({ cwd: tmpdir() });
    expect(result.blocked).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/PreCommit blocked/);
    expect(result.message).toMatch(/master/);
  });

  it("allows commits on feature branch during run-plan", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "feat/my-feature\n";
      throw new Error("unmocked");
    });
    const result = checkPreCommit({ cwd: tmpdir() });
    expect(result.blocked).toBe(false);
  });

  it("allows with bypass + advisory when PFORGE_ALLOW_MASTER_COMMIT=1", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    process.env.PFORGE_ALLOW_MASTER_COMMIT = "1";
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "master\n";
      throw new Error("unmocked");
    });
    const result = checkPreCommit({ cwd: tmpdir() });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toMatch(/Bypass active/);
  });

  it("blocks when default branch is 'main' and current branch matches", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    delete process.env.PFORGE_ALLOW_MASTER_COMMIT;
    mockExecSync.mockImplementation((cmd) => {
      if (cmd.includes("rev-parse --abbrev-ref")) return "main\n";
      if (cmd.includes("symbolic-ref")) return "refs/remotes/origin/main\n";
      throw new Error("unmocked");
    });
    const result = checkPreCommit({ cwd: tmpdir() });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/main/);
  });

  it("returns advisory when config disables rejectMasterDuringRun", () => {
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    const dir = makeTmpDir();
    writeFileSync(
      resolve(dir, ".forge.json"),
      JSON.stringify({ hooks: { preCommit: { rejectMasterDuringRun: false } } })
    );
    const result = checkPreCommit({ cwd: dir });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toMatch(/disabled via config/);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ─── spawnWorker env propagation ─────────────────────────────────────

describe("spawnWorker runPlanActive env propagation", () => {
  let lastSpawnEnv;

  beforeEach(() => {
    lastSpawnEnv = undefined;
    mockSpawn.mockImplementation((_cmd, _args, opts) => {
      lastSpawnEnv = opts?.env;
      return {
        stdout: { setEncoding: vi.fn(), on: vi.fn() },
        stderr: { setEncoding: vi.fn(), on: vi.fn() },
        stdin: { end: vi.fn() },
        on: vi.fn((ev, cb) => {
          if (ev === "close") setTimeout(() => cb(0), 10);
        }),
        pid: 12345,
        kill: vi.fn(),
      };
    });
  });

  afterEach(() => {
    mockSpawn.mockReset();
  });

  it("includes PFORGE_RUN_PLAN_ACTIVE when runPlanActive=true", async () => {
    spawnWorker("test prompt", {
      runPlanActive: true,
      worker: "claude",
      timeout: 1000,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawn).toHaveBeenCalled();
    expect(lastSpawnEnv).toBeDefined();
    expect(lastSpawnEnv.PFORGE_RUN_PLAN_ACTIVE).toBe("1");
    expect(lastSpawnEnv.NO_COLOR).toBe("1");
  });

  it("does NOT include PFORGE_RUN_PLAN_ACTIVE by default", async () => {
    spawnWorker("test prompt", {
      worker: "claude",
      timeout: 1000,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawn).toHaveBeenCalled();
    expect(lastSpawnEnv).toBeDefined();
    expect(lastSpawnEnv.PFORGE_RUN_PLAN_ACTIVE).toBeUndefined();
  });
});
