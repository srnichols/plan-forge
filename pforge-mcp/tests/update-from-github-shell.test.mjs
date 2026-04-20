/**
 * Shell integration tests for `pforge update --from-github` — Phase AUTO-UPDATE-01, Slice 1.
 *
 * These tests invoke the actual CLI entry point of update-from-github.mjs.
 * Skippable with CI_SKIP_NETWORK=1 when network is unavailable.
 *
 * Note: These test the Node.js CLI wrapper, not the full PS1/bash flow
 * (which requires tar + full project structure). The shell scripts delegate
 * to this module, so testing the module's CLI is the right boundary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const CLI_PATH = resolve(import.meta.dirname || ".", "..", "update-from-github.mjs");
const TMP_DIR = resolve(import.meta.dirname || ".", ".tmp-ufg-shell-test");

const SKIP = process.env.CI_SKIP_NETWORK === "1" || process.env.CI_SKIP_NETWORK === "true";

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

describe("update-from-github CLI", () => {
  it("resolve-tag with explicit tag returns it verbatim", async () => {
    const { stdout } = await execFileP("node", [CLI_PATH, "resolve-tag", "--tag", "v2.50.0"]);
    const result = JSON.parse(stdout.trim());
    expect(result.ok).toBe(true);
    expect(result.tag).toBe("v2.50.0");
  });

  it("resolve-tag rejects HEAD", async () => {
    try {
      await execFileP("node", [CLI_PATH, "resolve-tag", "--tag", "HEAD"]);
      expect.fail("Should have thrown");
    } catch (err) {
      const output = err.stdout || "";
      if (output) {
        const result = JSON.parse(output.trim());
        expect(result.ok).toBe(false);
        expect(result.code).toBe("ERR_NO_HEAD_TAG");
      } else {
        expect(err.code).not.toBe(0);
      }
    }
  });

  it("download requires --tag", async () => {
    try {
      await execFileP("node", [CLI_PATH, "download", "--project-dir", TMP_DIR]);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err.stderr || "").toContain("--tag required");
    }
  });

  it("audit appends log entry from stdin", async () => {
    const entry = JSON.stringify({ tag: "v2.50.0", sha256: "abc", sizeBytes: 100, outcome: "success", filesChanged: 3, source: "manual" });
    const { spawn } = await import("node:child_process");
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI_PATH, "audit", "--project-dir", TMP_DIR], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("close", (code) => resolve({ stdout, stderr, code }));
      child.on("error", reject);
      child.stdin.write(entry);
      child.stdin.end();
    });
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.ok).toBe(true);

    const logPath = join(TMP_DIR, ".forge", "update-audit.log");
    expect(existsSync(logPath)).toBe(true);
    const logged = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(logged.tag).toBe("v2.50.0");
    expect(logged.from).toBe("github");
  });

  it("unknown action returns error", async () => {
    try {
      await execFileP("node", [CLI_PATH, "bogus"]);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err.stderr || "").toContain("Unknown action");
    }
  });

  (SKIP ? it.skip : it)("resolve-tag without --tag hits GitHub API (network required)", async () => {
    const { stdout } = await execFileP("node", [CLI_PATH, "resolve-tag"], { timeout: 10_000 });
    const result = JSON.parse(stdout.trim());
    expect(result.ok).toBe(true);
    expect(result.tag).toMatch(/^v?\d+\.\d+/);
  });
});
