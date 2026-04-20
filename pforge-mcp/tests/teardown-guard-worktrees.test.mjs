/**
 * Phase-26 Slice 4 — Teardown Safety Guard exemption for worktrees.
 *
 * Covers:
 *   isWorktreeExemptPath   — pure predicate, platform-neutral normalization
 *   loadTeardownGuardConfig — defaults expose exemptPathPrefixes, config merges
 *   verifyBranchSafety      — filters branch-loss failures for exempt worktrees
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isWorktreeExemptPath,
  loadTeardownGuardConfig,
  verifyBranchSafety,
} from "../orchestrator.mjs";

function mkTemp() {
  const dir = join(tmpdir(), `pforge-guard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── isWorktreeExemptPath ─────────────────────────────────────────────

describe("isWorktreeExemptPath", () => {
  it("matches .forge/worktrees/ subpaths", () => {
    expect(isWorktreeExemptPath(".forge/worktrees/plan1/slice-1/variant-1")).toBe(true);
  });

  it("matches .forge/worktrees-archive/ subpaths", () => {
    expect(isWorktreeExemptPath(".forge/worktrees-archive/plan1/slice-1")).toBe(true);
  });

  it("matches exact prefix without trailing slash", () => {
    expect(isWorktreeExemptPath(".forge/worktrees")).toBe(true);
  });

  it("does not match sibling directories with shared stem", () => {
    expect(isWorktreeExemptPath(".forge/worktrees-other")).toBe(false);
    expect(isWorktreeExemptPath(".forge/worktreesome/stuff")).toBe(false);
  });

  it("normalizes Windows backslashes", () => {
    expect(isWorktreeExemptPath(".forge\\worktrees\\plan1\\variant-1")).toBe(true);
  });

  it("matches absolute paths containing the exempt segment", () => {
    expect(isWorktreeExemptPath("/home/u/proj/.forge/worktrees/p/s/v1")).toBe(true);
    expect(isWorktreeExemptPath("C:\\src\\proj\\.forge\\worktrees-archive\\p\\s\\v1")).toBe(true);
  });

  it("rejects unrelated paths", () => {
    expect(isWorktreeExemptPath("src/foo.js")).toBe(false);
    expect(isWorktreeExemptPath(".forge/other/file")).toBe(false);
  });

  it("returns false on empty / non-string input", () => {
    expect(isWorktreeExemptPath("")).toBe(false);
    expect(isWorktreeExemptPath(null)).toBe(false);
    expect(isWorktreeExemptPath(undefined)).toBe(false);
    expect(isWorktreeExemptPath(42)).toBe(false);
  });

  it("returns false when prefix list is empty", () => {
    expect(isWorktreeExemptPath(".forge/worktrees/x", [])).toBe(false);
  });

  it("honors caller-supplied custom prefix list", () => {
    expect(isWorktreeExemptPath(".scratch/tmp/x", [".scratch/tmp"])).toBe(true);
    expect(isWorktreeExemptPath(".forge/worktrees/x", [".scratch/tmp"])).toBe(false);
  });

  it("normalizes prefix with trailing slash", () => {
    expect(isWorktreeExemptPath(".forge/worktrees/x", [".forge/worktrees/"])).toBe(true);
  });
});

// ─── loadTeardownGuardConfig ──────────────────────────────────────────

describe("loadTeardownGuardConfig", () => {
  let cwd;
  beforeEach(() => { cwd = mkTemp(); });
  afterEach(() => { if (cwd && existsSync(cwd)) rmSync(cwd, { recursive: true, force: true }); });

  it("defaults include both exempt worktree prefixes", () => {
    const cfg = loadTeardownGuardConfig(cwd);
    expect(cfg.exemptPathPrefixes).toContain(".forge/worktrees");
    expect(cfg.exemptPathPrefixes).toContain(".forge/worktrees-archive");
  });

  it("defaults enabled true, blockOnBranchLoss true, checkRemote true", () => {
    const cfg = loadTeardownGuardConfig(cwd);
    expect(cfg.enabled).toBe(true);
    expect(cfg.blockOnBranchLoss).toBe(true);
    expect(cfg.checkRemote).toBe(true);
  });

  it("merges user-supplied exemptPathPrefixes override", () => {
    writeFileSync(join(cwd, ".forge.json"), JSON.stringify({
      orchestrator: { teardownGuard: { exemptPathPrefixes: [".custom/scratch"] } },
    }));
    const cfg = loadTeardownGuardConfig(cwd);
    expect(cfg.exemptPathPrefixes).toEqual([".custom/scratch"]);
  });

  it("tolerates malformed .forge.json by returning defaults", () => {
    writeFileSync(join(cwd, ".forge.json"), "{ not valid json");
    const cfg = loadTeardownGuardConfig(cwd);
    expect(cfg.enabled).toBe(true);
    expect(cfg.exemptPathPrefixes).toContain(".forge/worktrees");
  });
});

// ─── verifyBranchSafety exemption behavior ────────────────────────────

describe("verifyBranchSafety — worktree exemption", () => {
  const baseline = {
    branch: "variant-branch",
    headSha: "abc123",
    upstream: null,
    capturedAt: "2024-01-01T00:00:00.000Z",
  };
  const config = {
    checkRemote: false,
    exemptPathPrefixes: [".forge/worktrees", ".forge/worktrees-archive"],
  };

  it("filters local-branch-loss failure when branch's worktree is exempt", () => {
    const exec = (cmd) => {
      if (cmd.startsWith("git show-ref")) throw new Error("missing");
      if (cmd.startsWith("git cat-file")) return ""; // HEAD reachable
      if (cmd.startsWith("git worktree list --porcelain")) {
        return [
          "worktree /project/.forge/worktrees/plan1/slice-1/variant-1",
          "HEAD deadbeef",
          "branch refs/heads/variant-branch",
          "",
        ].join("\n");
      }
      return "";
    };
    const r = verifyBranchSafety(baseline, config, "/project", { exec });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("retains branch-loss failure when worktree path is NOT exempt", () => {
    const exec = (cmd) => {
      if (cmd.startsWith("git show-ref")) throw new Error("missing");
      if (cmd.startsWith("git cat-file")) return "";
      if (cmd.startsWith("git worktree list --porcelain")) {
        return [
          "worktree /project/src/feature-branch-wt",
          "HEAD deadbeef",
          "branch refs/heads/variant-branch",
          "",
        ].join("\n");
      }
      if (cmd.startsWith("git reflog")) return "sha1 reset\nsha2 commit\n";
      return "";
    };
    const r = verifyBranchSafety(baseline, config, "/project", { exec });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes("local branch ref"))).toBe(true);
  });

  it("retains branch-loss failure when branch has no worktree entry", () => {
    const exec = (cmd) => {
      if (cmd.startsWith("git show-ref")) throw new Error("missing");
      if (cmd.startsWith("git cat-file")) return "";
      if (cmd.startsWith("git worktree list --porcelain")) return "";
      if (cmd.startsWith("git reflog")) return "sha1 reset\n";
      return "";
    };
    const r = verifyBranchSafety(baseline, config, "/project", { exec });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes("local branch ref"))).toBe(true);
  });

  it("does not suppress HEAD-unreachable failure even when worktree is exempt", () => {
    const exec = (cmd) => {
      if (cmd.startsWith("git show-ref")) return ""; // branch OK
      if (cmd.startsWith("git cat-file")) throw new Error("gone");
      if (cmd.startsWith("git reflog")) return "sha1 gc\n";
      return "";
    };
    const r = verifyBranchSafety(baseline, config, "/project", { exec });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes("no longer reachable"))).toBe(true);
  });

  it("returns ok when both branch and HEAD are fine (no filtering needed)", () => {
    const exec = () => "";
    const r = verifyBranchSafety(baseline, config, "/project", { exec });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("uses default exempt prefixes when config omits the key", () => {
    const cfg = { checkRemote: false };
    const exec = (cmd) => {
      if (cmd.startsWith("git show-ref")) throw new Error("missing");
      if (cmd.startsWith("git cat-file")) return "";
      if (cmd.startsWith("git worktree list --porcelain")) {
        return [
          "worktree /project/.forge/worktrees-archive/plan1/slice-1/variant-2",
          "HEAD deadbeef",
          "branch refs/heads/variant-branch",
          "",
        ].join("\n");
      }
      return "";
    };
    const r = verifyBranchSafety(baseline, cfg, "/project", { exec });
    expect(r.ok).toBe(true);
  });
});
