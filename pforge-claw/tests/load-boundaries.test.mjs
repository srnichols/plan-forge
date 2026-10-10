import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const source = (...parts) => readFileSync(path.join(sourceRoot, ...parts), "utf8");

describe("Guard: canonical history does not depend on job workspace orchestration", () => {
  it("uses the shared path-safety boundary rather than importing the worktree manager", () => {
    expect(source("memory", "l2-sync.mjs")).not.toMatch(/from\s+["']\.\.\/jobs\/worktree\.mjs["']/);
    expect(source("memory", "l2-sync.mjs")).toContain("path-safety.mjs");
    expect(source("jobs", "worktree.mjs")).toContain("assertInside");
  });

  it("preserves the worktree path-safety exports as the exact shared implementations", async () => {
    const worktree = await import("../src/jobs/worktree.mjs");
    const paths = await import("../src/path-safety.mjs");
    for (const name of ["assertInside", "isInside", "realpathNearest"]) {
      expect(typeof paths[name]).toBe("function");
      expect(worktree[name]).toBe(paths[name]);
    }
  });
});

describe("Guard: signed lease preparation does not load the job executor", () => {
  it("resolves runtime metadata through the runtime domain rather than the executor composition", () => {
    expect(source("jobs", "lease-payload.mjs")).not.toMatch(/from\s+["']\.\/executor\.mjs["']/);
    expect(source("jobs", "lease-payload.mjs")).toContain("runtime/agent-runtime.mjs");
    expect(source("jobs", "executor.mjs")).toContain("resolveJobRuntime");
  });

  it("preserves the executor runtime-factory export as the shared resolver", async () => {
    const executor = await import("../src/jobs/executor.mjs");
    const runtime = await import("../src/runtime/agent-runtime.mjs");
    expect(typeof runtime.resolveJobRuntime).toBe("function");
    expect(executor.resolveJobRuntime).toBe(runtime.resolveJobRuntime);
  });
});
