import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { classifyDiff, CATEGORIES, SEVERITY_ORDER, maxSeverity } from "../diff-classify.mjs";

const mockExecSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: (...args) => mockExecSync(...args),
  };
});

import { runPreCommitChain } from "../../.github/hooks/PreCommit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "fixtures", "diff-classify");
const RUNTIME_ROOT = resolve(FIXTURES, "runtime");

function loadFixture(name) {
  return readFileSync(resolve(FIXTURES, name), "utf-8");
}

function makeSandboxDir() {
  mkdirSync(RUNTIME_ROOT, { recursive: true });
  const dir = resolve(RUNTIME_ROOT, randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("diff-classify heuristics", () => {
  it("exports category and severity constants", () => {
    expect(CATEGORIES).toEqual([
      "leaked-secret",
      "prompt-injection-echo",
      "license-incompatible-paste",
      "eval-exec-introduced",
      "unexpected-network-call",
      "large-binary-dump",
    ]);
    expect(SEVERITY_ORDER).toEqual(["none", "low", "medium", "high", "critical"]);
  });

  it("returns none for a clean diff", () => {
    const result = classifyDiff(loadFixture("clean.diff"));
    expect(result.severity).toBe("none");
    expect(result.findings).toEqual([]);
    expect(result.totalAdded).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("detects leaked secrets as critical", () => {
    const result = classifyDiff(loadFixture("leaked-secret.diff"));
    expect(result.severity).toBe("critical");
    expect(result.findings.some((f) => f.category === "leaked-secret")).toBe(true);
  });

  it("detects prompt injection echo as high", () => {
    const result = classifyDiff(loadFixture("prompt-injection.diff"));
    expect(result.severity).toBe("high");
    expect(result.findings.some((f) => f.category === "prompt-injection-echo")).toBe(true);
  });

  it("detects eval-exec introduction as medium", () => {
    const result = classifyDiff(loadFixture("eval-exec.diff"));
    expect(result.severity).toBe("medium");
    expect(result.findings.some((f) => f.category === "eval-exec-introduced")).toBe(true);
  });

  it("detects GPL-family paste as high", () => {
    const result = classifyDiff(loadFixture("license-paste.diff"));
    expect(result.severity).toBe("high");
    expect(result.findings.some((f) => f.category === "license-incompatible-paste")).toBe(true);
  });

  it("detects unexpected network calls as low", () => {
    const result = classifyDiff(loadFixture("network-call.diff"));
    expect(result.severity).toBe("low");
    expect(result.findings.some((f) => f.category === "unexpected-network-call")).toBe(true);
  });

  it("detects large binary dumps as medium", () => {
    const result = classifyDiff(loadFixture("binary-dump.diff"));
    expect(result.severity).toBe("medium");
    expect(result.findings.some((f) => f.category === "large-binary-dump")).toBe(true);
  });

  it("returns none for an empty diff", () => {
    const result = classifyDiff("");
    expect(result).toEqual({ severity: "none", findings: [], totalAdded: 0, truncated: false });
  });

  it("uses the maximum severity across combined findings", () => {
    const combined = `${loadFixture("leaked-secret.diff")}\n${loadFixture("eval-exec.diff")}`;
    const result = classifyDiff(combined);
    expect(result.severity).toBe("critical");
    expect(result.findings.some((f) => f.category === "leaked-secret")).toBe(true);
    expect(result.findings.some((f) => f.category === "eval-exec-introduced")).toBe(true);
  });

  it("computes maxSeverity correctly", () => {
    expect(maxSeverity("none", "low")).toBe("low");
    expect(maxSeverity("medium", "high")).toBe("high");
    expect(maxSeverity("critical", "high")).toBe("critical");
    expect(maxSeverity("medium", "medium")).toBe("medium");
  });

  it("truncates input above the default maxLines", () => {
    const lines = [
      "diff --git a/src/huge.txt b/src/huge.txt",
      "index 1111111..2222222 100644",
      "--- a/src/huge.txt",
      "+++ b/src/huge.txt",
      "@@ -0,0 +1,3505 @@",
      ...Array.from({ length: 3505 }, (_, i) => `+line-${i}`),
    ];
    const result = classifyDiff(lines.join("\n"));
    expect(result.truncated).toBe(true);
    expect(result.totalAdded).toBeLessThan(3505);
  });

  it("honors maxLines option", () => {
    const result = classifyDiff(loadFixture("leaked-secret.diff"), { maxLines: 1 });
    expect(result.truncated).toBe(true);
    expect(result.totalAdded).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

describe("diff-classify precommit integration", () => {
  const savedEnv = {};

  beforeEach(() => {
    savedEnv.PFORGE_RUN_PLAN_ACTIVE = process.env.PFORGE_RUN_PLAN_ACTIVE;
    process.env.PFORGE_RUN_PLAN_ACTIVE = "1";
    mockExecSync.mockReset();
  });

  afterEach(() => {
    if (savedEnv.PFORGE_RUN_PLAN_ACTIVE === undefined) delete process.env.PFORGE_RUN_PLAN_ACTIVE;
    else process.env.PFORGE_RUN_PLAN_ACTIVE = savedEnv.PFORGE_RUN_PLAN_ACTIVE;
    mockExecSync.mockReset();
    rmSync(RUNTIME_ROOT, { recursive: true, force: true });
  });

  it("blocks the PreCommit chain on critical results", () => {
    const dir = makeSandboxDir();
    const configPath = resolve(dir, "plan-forge.json");
    writeFileSync(configPath, JSON.stringify({
      hooks: {
        preCommit: {
          chain: [
            { name: "diff-classify", type: "command", command: ".github/hooks/scripts/check-diff-classify.sh" },
          ],
        },
      },
    }, null, 2));

    mockExecSync.mockReturnValue(JSON.stringify({
      blocked: true,
      message: "diff-classify blocked [critical]: leaked-secret",
    }));

    const result = runPreCommitChain({ cwd: dir, configPath });
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("diff-classify blocked [critical]");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("diff-classify");
  });
});