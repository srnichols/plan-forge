/**
 * Plan Forge — Issue #106 regression tests.
 *
 * Asserts that resolveFrameworkVersion() reads the install's own VERSION
 * file from a deterministic location (serverDir/../VERSION) and never
 * returns a stale literal or invented number.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFrameworkVersion } from "../update-check.mjs";

let root;
let serverDir;
let projectDir;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pforge-fwver-"));
  serverDir = join(root, "pforge-mcp");
  projectDir = join(root, "user-project");
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveFrameworkVersion", () => {
  it("reads VERSION at <serverDir>/../VERSION (install root)", () => {
    writeFileSync(join(root, "VERSION"), "2.81.0\n");
    expect(resolveFrameworkVersion({ serverDir })).toBe("2.81.0");
  });

  it("strips a leading 'v' prefix", () => {
    writeFileSync(join(root, "VERSION"), "v2.81.0\n");
    expect(resolveFrameworkVersion({ serverDir })).toBe("2.81.0");
  });

  it("preserves -dev / pre-release suffixes", () => {
    writeFileSync(join(root, "VERSION"), "2.82.0-dev\n");
    expect(resolveFrameworkVersion({ serverDir })).toBe("2.82.0-dev");
  });

  it("falls back to <serverDir>/VERSION when ../VERSION is missing", () => {
    writeFileSync(join(serverDir, "VERSION"), "3.0.0\n");
    expect(resolveFrameworkVersion({ serverDir })).toBe("3.0.0");
  });

  it("falls back to projectDir/VERSION as a last resort", () => {
    writeFileSync(join(projectDir, "VERSION"), "9.9.9\n");
    expect(resolveFrameworkVersion({ serverDir, projectDir })).toBe("9.9.9");
  });

  it("returns 'unknown' when no VERSION file exists anywhere", () => {
    expect(resolveFrameworkVersion({ serverDir, projectDir })).toBe("unknown");
  });

  it("returns 'unknown' when serverDir is missing", () => {
    expect(resolveFrameworkVersion({})).toBe("unknown");
    expect(resolveFrameworkVersion({ serverDir: null })).toBe("unknown");
  });

  it("ignores empty VERSION files (treated as missing)", () => {
    writeFileSync(join(root, "VERSION"), "   \n");
    writeFileSync(join(projectDir, "VERSION"), "1.2.3\n");
    expect(resolveFrameworkVersion({ serverDir, projectDir })).toBe("1.2.3");
  });

  it("prefers install VERSION over projectDir VERSION (no leak from cwd)", () => {
    // Issue #106 core invariant: the framework reports its own version,
    // not whatever VERSION happens to live in the user's project tree.
    writeFileSync(join(root, "VERSION"), "2.81.0\n");
    writeFileSync(join(projectDir, "VERSION"), "1.0.0\n");
    expect(resolveFrameworkVersion({ serverDir, projectDir })).toBe("2.81.0");
  });

  it("never returns a hardcoded fallback like '2.12.3' or '2.14.0'", () => {
    // Regression guard: the previous implementation embedded these literals
    // in server.mjs. Ensure no code path can resurrect them.
    const result = resolveFrameworkVersion({ serverDir, projectDir });
    expect(result).not.toBe("2.12.3");
    expect(result).not.toBe("2.14.0");
    expect(result).toBe("unknown");
  });
});
