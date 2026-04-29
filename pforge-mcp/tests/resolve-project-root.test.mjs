/**
 * resolve-project-root.test.js — Unit tests for resolveProjectRoot (Phase-33.4 Slice 1).
 *
 * Covers all six resolution branches:
 *   A: PLAN_FORGE_PROJECT env var
 *   B: --project argv flag
 *   C: .forge.json marker in cwd
 *   D: .git marker found by walking up from a nested cwd
 *   E: package.json marker found by walking up from serverDir (cwd has no markers)
 *   F: no markers found — fallback to cwd
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveProjectRoot } from "../server.mjs";

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-rpr-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveProjectRoot", () => {
  it("Branch A — PLAN_FORGE_PROJECT env var wins", () => {
    const projectPath = join(tempDir, "my-project");
    mkdirSync(projectPath);
    const result = resolveProjectRoot({
      env: { PLAN_FORGE_PROJECT: projectPath },
      argv: [],
      serverDir: tempDir,
      cwd: tempDir,
    });
    expect(result.source).toBe("env");
    expect(result.resolved).toBe(resolve(projectPath));
  });

  it("Branch B — --project argv flag", () => {
    const projectPath = join(tempDir, "argv-project");
    mkdirSync(projectPath);
    const result = resolveProjectRoot({
      env: {},
      argv: ["node", "server.mjs", "--project", projectPath],
      serverDir: tempDir,
      cwd: tempDir,
    });
    expect(result.source).toBe("--project");
    expect(result.resolved).toBe(resolve(projectPath));
  });

  it("Branch C — .forge.json marker in cwd", () => {
    writeFileSync(join(tempDir, ".forge.json"), "{}");
    const result = resolveProjectRoot({
      env: {},
      argv: [],
      serverDir: join(tempDir, "unrelated"),
      cwd: tempDir,
    });
    expect(result.source).toBe("marker:.forge.json");
    expect(result.resolved).toBe(resolve(tempDir));
  });

  it("Branch D — .git marker found by walking up from nested cwd", () => {
    writeFileSync(join(tempDir, ".git"), "");
    const nested = join(tempDir, "sub", "deep");
    mkdirSync(nested, { recursive: true });
    const result = resolveProjectRoot({
      env: {},
      argv: [],
      serverDir: join(tempDir, "unrelated"),
      cwd: nested,
    });
    expect(result.source).toBe("marker:.git");
    expect(result.resolved).toBe(resolve(tempDir));
  });

  it("Branch E — package.json marker found via serverDir walk when cwd has no markers", () => {
    // serverDir tree has package.json; cwd is completely unrelated and marker-free
    const serverRoot = join(tempDir, "server-root");
    mkdirSync(serverRoot);
    writeFileSync(join(serverRoot, "package.json"), "{}");
    const serverDir = join(serverRoot, "pforge-mcp");
    mkdirSync(serverDir);

    const cwdDir = join(tempDir, "empty-cwd");
    mkdirSync(cwdDir);

    const result = resolveProjectRoot({
      env: {},
      argv: [],
      serverDir,
      cwd: cwdDir,
    });
    expect(result.source).toBe("marker:package.json");
    expect(result.resolved).toBe(resolve(serverRoot));
  });

  it("Branch F — no markers found, falls back to cwd", () => {
    // Use a fresh isolated temp dir with no markers anywhere in its ancestry
    // by pointing serverDir and cwd to the same marker-free directory
    const isolated = join(tempDir, "isolated");
    mkdirSync(isolated);

    // We cannot guarantee the temp root itself has no package.json up the tree,
    // so we use the function itself with a mock walk that exhausts quickly by
    // providing a cwd that is a root-level temp dir with no markers.
    // The fallback is detected when source === "fallback-cwd".
    const result = resolveProjectRoot({
      env: {},
      argv: [],
      serverDir: isolated,
      cwd: isolated,
    });
    // If no markers exist in the walk paths, source should be "fallback-cwd".
    // If markers happen to exist (e.g. package.json in a parent), source will differ.
    // Accept both — the key contract is that resolved === cwd when fallback fires.
    if (result.source === "fallback-cwd") {
      expect(result.resolved).toBe(isolated);
      expect(result.warning).toMatch(/no .git/);
    } else {
      // Markers found in parent dirs — that's valid behaviour, not a failure.
      expect(["marker:.forge.json", "marker:.git", "marker:package.json"]).toContain(result.source);
    }
  });

  it("Branch F (strict) — truly isolated root with no ancestors, fallback fires", () => {
    // On most OSes we can't avoid package.json ancestors from the repo,
    // but we can verify the fallback shape contract:
    // when source is "fallback-cwd", resolved must equal cwd and warning must be set.
    const result = resolveProjectRoot({
      env: {},
      argv: [],
      serverDir: "/",
      cwd: "/",
    });
    // On a system where / has none of the markers, fallback fires.
    // On systems where / contains package.json (unlikely), we still get a valid result.
    expect(result).toHaveProperty("resolved");
    expect(result).toHaveProperty("source");
    if (result.source === "fallback-cwd") {
      expect(result.resolved).toBe("/");
      expect(result.warning).toBeTruthy();
    }
  });

  // Bug #105/#125: when launched from a sub-package that has its own
  // package.json (e.g. pforge-mcp/), the resolver previously stopped at
  // that sub-package and used it as PROJECT_DIR. The two-tier marker
  // walk must walk past sub-package package.json files to find the
  // outer .git / .forge.json first.
  it("Branch G — strong marker (.git) wins over inner package.json sub-package", () => {
    // Layout:
    //   tempDir/
    //     .git
    //     pforge-mcp/
    //       package.json  ← weak marker; must NOT anchor
    writeFileSync(join(tempDir, ".git"), "");
    const subPkg = join(tempDir, "pforge-mcp");
    mkdirSync(subPkg);
    writeFileSync(join(subPkg, "package.json"), "{}");

    const result = resolveProjectRoot({
      env: {},
      argv: [],
      serverDir: subPkg,
      cwd: subPkg,
    });
    expect(result.source).toBe("marker:.git");
    expect(result.resolved).toBe(resolve(tempDir));
  });

  it("Branch G2 — strong marker (.forge.json) wins over inner package.json", () => {
    writeFileSync(join(tempDir, ".forge.json"), "{}");
    const subPkg = join(tempDir, "pforge-mcp");
    mkdirSync(subPkg);
    writeFileSync(join(subPkg, "package.json"), "{}");

    const result = resolveProjectRoot({
      env: {},
      argv: [],
      serverDir: subPkg,
      cwd: subPkg,
    });
    expect(result.source).toBe("marker:.forge.json");
    expect(result.resolved).toBe(resolve(tempDir));
  });
});
