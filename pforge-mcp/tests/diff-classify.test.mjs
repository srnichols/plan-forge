/**
 * Plan Forge — diff-classify.test.mjs (Phase WORKER-GUARDRAILS Slice A2)
 *
 * Tests for the diff-classify module:
 *   - classifyFile: per-file category detection
 *   - classifyFiles: batch classification
 *   - classifyDiff: git-backed diff classification (execSync mocked)
 *   - runDiffClassifyCheck: preCommit chain result shape
 */

import { describe, it, expect, afterEach, vi } from "vitest";

// ─── Mock child_process ─────────────────────────────────────────────────────

const mockExecSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, execSync: (...args) => mockExecSync(...args) };
});

// ─── Test subjects (imported AFTER vi.mock) ─────────────────────────────────

import {
  classifyFile,
  classifyFiles,
  classifyDiff,
  runDiffClassifyCheck,
} from "../../pforge-mcp/diff-classify.mjs";

// ─── classifyFile ────────────────────────────────────────────────────────────

describe("classifyFile — plan category", () => {
  it("classifies docs/plans/ files as plan", () => {
    expect(classifyFile("docs/plans/Phase-1-AUTH-PLAN.md")).toBe("plan");
  });

  it("classifies nested docs/plans/ files as plan", () => {
    expect(classifyFile("docs/plans/Phase-28/slice-3.md")).toBe("plan");
  });
});

describe("classifyFile — test category", () => {
  it("classifies .test.mjs files as test", () => {
    expect(classifyFile("pforge-mcp/tests/baselines.test.mjs")).toBe("test");
  });

  it("classifies .spec.ts files as test", () => {
    expect(classifyFile("src/auth.spec.ts")).toBe("test");
  });

  it("classifies files under __tests__ as test", () => {
    expect(classifyFile("src/__tests__/auth.js")).toBe("test");
  });

  it("classifies files under tests/ directory as test", () => {
    expect(classifyFile("tests/unit/auth.test.js")).toBe("test");
  });
});

describe("classifyFile — docs category", () => {
  it("classifies .md files as docs", () => {
    expect(classifyFile("README.md")).toBe("docs");
  });

  it("classifies .rst files as docs", () => {
    expect(classifyFile("docs/api.rst")).toBe("docs");
  });

  it("classifies .txt files as docs", () => {
    expect(classifyFile("CHANGELOG.txt")).toBe("docs");
  });

  it("does NOT classify docs/plans/ .md as docs (plan takes precedence)", () => {
    expect(classifyFile("docs/plans/Phase-1-PLAN.md")).toBe("plan");
  });
});

describe("classifyFile — config category", () => {
  it("classifies .env files as config", () => {
    expect(classifyFile(".env")).toBe("config");
  });

  it("classifies .env.staging as config", () => {
    expect(classifyFile(".env.staging")).toBe("config");
  });

  it("classifies .github/ files as config", () => {
    expect(classifyFile(".github/workflows/ci.yml")).toBe("config");
  });

  it("classifies .vscode/ files as config", () => {
    expect(classifyFile(".vscode/mcp.json")).toBe("config");
  });

  it("classifies .forge.json as config", () => {
    expect(classifyFile(".forge.json")).toBe("config");
  });

  it("classifies tsconfig.json as config", () => {
    expect(classifyFile("tsconfig.json")).toBe("config");
  });

  it("classifies vitest.config.mjs as config", () => {
    expect(classifyFile("vitest.config.mjs")).toBe("config");
  });

  it("classifies Dockerfile as config", () => {
    expect(classifyFile("Dockerfile")).toBe("config");
  });
});

describe("classifyFile — chore category", () => {
  it("classifies package.json as chore", () => {
    expect(classifyFile("package.json")).toBe("chore");
  });

  it("classifies package-lock.json as chore", () => {
    expect(classifyFile("package-lock.json")).toBe("chore");
  });

  it("classifies yarn.lock as chore", () => {
    expect(classifyFile("yarn.lock")).toBe("chore");
  });

  it("classifies .sh scripts as chore", () => {
    expect(classifyFile("setup.sh")).toBe("chore");
  });

  it("classifies .ps1 scripts as chore", () => {
    expect(classifyFile("validate-setup.ps1")).toBe("chore");
  });
});

describe("classifyFile — scope category", () => {
  it("classifies .mjs files as scope", () => {
    expect(classifyFile("pforge-mcp/server.mjs")).toBe("scope");
  });

  it("classifies .ts files as scope", () => {
    expect(classifyFile("src/auth/service.ts")).toBe("scope");
  });

  it("classifies .py files as scope", () => {
    expect(classifyFile("app/main.py")).toBe("scope");
  });

  it("classifies .go files as scope", () => {
    expect(classifyFile("cmd/main.go")).toBe("scope");
  });

  it("classifies .cs files as scope", () => {
    expect(classifyFile("src/Controllers/UserController.cs")).toBe("scope");
  });
});

describe("classifyFile — unknown category", () => {
  it("classifies unknown extensions as unknown", () => {
    expect(classifyFile("assets/logo.webp")).toBe("unknown");
  });

  it("classifies binary-like files as unknown", () => {
    expect(classifyFile("dist/bundle.wasm")).toBe("unknown");
  });
});

// ─── classifyFiles ───────────────────────────────────────────────────────────

describe("classifyFiles", () => {
  it("returns an array of { file, category } objects", () => {
    const result = classifyFiles(["src/main.ts", "README.md", "package.json"]);
    expect(result).toEqual([
      { file: "src/main.ts", category: "scope" },
      { file: "README.md", category: "docs" },
      { file: "package.json", category: "chore" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(classifyFiles([])).toEqual([]);
  });

  it("handles mixed categories correctly", () => {
    const paths = [
      "docs/plans/Phase-1-PLAN.md",
      "src/auth.test.ts",
      "CHANGELOG.md",
      ".forge.json",
      "setup.sh",
      "src/api.ts",
      "assets/logo.png",
    ];
    const categories = classifyFiles(paths).map((r) => r.category);
    expect(categories).toEqual(["plan", "test", "docs", "config", "chore", "scope", "unknown"]);
  });
});

// ─── classifyDiff ────────────────────────────────────────────────────────────

describe("classifyDiff — git unavailable", () => {
  afterEach(() => { mockExecSync.mockReset(); });

  it("returns ok: false when git diff throws", () => {
    mockExecSync.mockImplementation(() => { throw new Error("not a git repo"); });

    const result = classifyDiff({ cwd: "/tmp/no-git" });
    expect(result.ok).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.summary).toEqual({});
    expect(result.total).toBe(0);
    expect(result.error).toMatch(/git diff failed/);
  });
});

describe("classifyDiff — empty staged diff", () => {
  afterEach(() => { mockExecSync.mockReset(); });

  it("returns ok: true with empty files when no staged changes", () => {
    mockExecSync.mockReturnValue("");

    const result = classifyDiff({ cwd: "/some/project" });
    expect(result.ok).toBe(true);
    expect(result.files).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.advisory).toMatch(/No staged changes/);
  });
});

describe("classifyDiff — staged changes", () => {
  afterEach(() => { mockExecSync.mockReset(); });

  it("classifies staged files and builds summary", () => {
    mockExecSync.mockReturnValue(
      "src/api.ts\npforge-mcp/tests/auth.test.mjs\nREADME.md\n"
    );

    const result = classifyDiff({ cwd: "/project" });
    expect(result.ok).toBe(true);
    expect(result.total).toBe(3);
    expect(result.summary.scope).toBe(1);
    expect(result.summary.test).toBe(1);
    expect(result.summary.docs).toBe(1);
    expect(result.advisory).toMatch(/3 file/);
    expect(result.advisory).toMatch(/scope: 1/);
    expect(result.advisory).toMatch(/test: 1/);
    expect(result.advisory).toMatch(/docs: 1/);
  });

  it("uses 'since' option when provided", () => {
    mockExecSync.mockReturnValue("src/auth.ts\n");

    classifyDiff({ cwd: "/project", since: "HEAD~1" });
    const [cmd] = mockExecSync.mock.calls[0];
    expect(cmd).toMatch(/git diff --name-only HEAD~1/);
  });

  it("uses staged diff by default", () => {
    mockExecSync.mockReturnValue("src/auth.ts\n");

    classifyDiff({ cwd: "/project" });
    const [cmd] = mockExecSync.mock.calls[0];
    expect(cmd).toMatch(/--staged/);
  });

  it("builds advisory text with sorted categories", () => {
    mockExecSync.mockReturnValue(
      "src/main.ts\nsrc/lib.ts\ndocs/plans/Phase-1.md\nREADME.md\n"
    );

    const result = classifyDiff({ cwd: "/project" });
    expect(result.advisory).toMatch(/4 file/);
    expect(result.summary.scope).toBe(2);
    expect(result.summary.plan).toBe(1);
    expect(result.summary.docs).toBe(1);
  });
});

// ─── runDiffClassifyCheck ────────────────────────────────────────────────────

describe("runDiffClassifyCheck — git unavailable", () => {
  afterEach(() => { mockExecSync.mockReset(); });

  it("returns blocked: false with advisory when git fails", () => {
    mockExecSync.mockImplementation(() => { throw new Error("not a git repo"); });

    const result = runDiffClassifyCheck({ cwd: "/no-git" });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toMatch(/diff-classify/);
  });
});

describe("runDiffClassifyCheck — no staged changes", () => {
  afterEach(() => { mockExecSync.mockReset(); });

  it("returns blocked: false with advisory when no changes", () => {
    mockExecSync.mockReturnValue("");

    const result = runDiffClassifyCheck({ cwd: "/project" });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toMatch(/No staged changes/);
    expect(result.classification).toBeDefined();
    expect(result.classification.total).toBe(0);
  });
});

describe("runDiffClassifyCheck — with staged changes", () => {
  afterEach(() => { mockExecSync.mockReset(); });

  it("returns blocked: false with classification payload", () => {
    mockExecSync.mockReturnValue("src/api.ts\nREADME.md\n");

    const result = runDiffClassifyCheck({ cwd: "/project" });
    expect(result.blocked).toBe(false);
    expect(result.advisory).toBeDefined();
    expect(result.classification).toBeDefined();
    expect(result.classification.total).toBe(2);
    expect(result.classification.files).toHaveLength(2);
    expect(result.classification.summary.scope).toBe(1);
    expect(result.classification.summary.docs).toBe(1);
  });

  it("never returns blocked: true (always advisory)", () => {
    // Even with only scope changes, never blocks
    mockExecSync.mockReturnValue("src/api.ts\nsrc/auth.ts\nsrc/utils.ts\n");

    const result = runDiffClassifyCheck({ cwd: "/project" });
    expect(result.blocked).toBe(false);
  });
});
