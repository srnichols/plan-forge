/**
 * The orchestrator self-test (`node pforge-mcp/orchestrator.mjs --test`) is
 * the gate generated incident plans use, but nothing ran it, so a model
 * refresh broke one of its cost checks unnoticed. Run it here. It calls
 * process.exit, so it runs in a child process.
 */

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const ORCHESTRATOR = fileURLToPath(new URL("../orchestrator.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../", import.meta.url));

describe("orchestrator --test", () => {
  it("passes every self-test check", async () => {
    let stdout = "";
    let exitCode = 0;
    try {
      ({ stdout } = await run(process.execPath, [ORCHESTRATOR, "--test"], { cwd: REPO, maxBuffer: 10 * 1024 * 1024 }));
    } catch (err) {
      stdout = err.stdout ?? "";
      exitCode = err.code ?? 1;
    }
    const failures = stdout.split("\n").filter((line) => line.includes("❌")).map((line) => line.trim());
    expect(failures).toEqual([]);
    expect(stdout).toMatch(/Results: \d+ passed, 0 failed/);
    expect(exitCode).toBe(0);
  }, 120_000);
});
