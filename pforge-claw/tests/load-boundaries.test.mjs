import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const source = (...parts) => readFileSync(path.join(sourceRoot, ...parts), "utf8");

describe("Guard: start help and invalid arguments do not load dispatcher composition", () => {
  it.each([
    { args: ["--help"], status: 0 },
    { args: ["--unsupported-start-option"], status: 2 },
  ])("returns $status for $args without loading app or runtime dependencies", ({ args, status }) => {
    const appUrl = new URL("../src/app.mjs", import.meta.url).href;
    const loader = `export async function resolve(specifier, context, next) {
      const resolved = await next(specifier, context);
      if (resolved.url === ${JSON.stringify(appUrl)}) throw new Error("DISPATCHER_IMPORTED_BEFORE_START");
      return resolved;
    }`;
    const root = path.resolve(sourceRoot, "..");
    const result = spawnSync(process.execPath, [
      "--experimental-loader", `data:text/javascript,${encodeURIComponent(loader)}`,
      path.join(root, "cli.mjs"), "start", ...args,
    ], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, PFORGE_CLAW_HOME: path.join(root, "tests", "fixtures", "missing-start-home") },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(status);
    expect(result.stdout + result.stderr).toContain("Usage: pforge claw start");
    expect(result.stderr).not.toContain("Error: DISPATCHER_IMPORTED_BEFORE_START");
  });
});

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
