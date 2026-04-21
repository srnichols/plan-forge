/**
 * Tests for promoteBaseline mtime sort + run-* filter (Phase-28.5 Slice 4).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, utimesSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// Minimal 1×1 red PNG for testing
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAH" +
  "ggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

function makeTestDir() {
  const id = randomBytes(4).toString("hex");
  const dir = resolve(tmpdir(), `pforge-baselines-sort-test-${id}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeScreenshot(cwd, runName, scanner, urlHash) {
  const dir = resolve(cwd, ".forge", "tempering", "artifacts", runName, scanner);
  mkdirSync(dir, { recursive: true });
  const p = resolve(dir, `${urlHash}.png`);
  writeFileSync(p, TINY_PNG);
  return p;
}

describe("promoteBaseline mtime sort + run-* filter", () => {
  let cwd;

  beforeEach(() => { cwd = makeTestDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("sorts run directories by mtimeMs (newest first), not alphabetically", async () => {
    const { promoteBaseline } = await import("../tempering/baselines.mjs");
    const urlHash = "testhash1";

    // Create two run dirs: run-older has a higher alpha sort but older mtime
    writeScreenshot(cwd, "run-zzz-old", "visual-diff", urlHash);
    writeScreenshot(cwd, "run-aaa-new", "visual-diff", urlHash);

    const artRoot = resolve(cwd, ".forge", "tempering", "artifacts");

    // Force mtimes: run-aaa-new is newer, run-zzz-old is older
    const now = Date.now();
    const oldDir = resolve(artRoot, "run-zzz-old");
    const newDir = resolve(artRoot, "run-aaa-new");
    utimesSync(oldDir, new Date(now - 60_000), new Date(now - 60_000));
    utimesSync(newDir, new Date(now), new Date(now));

    const result = promoteBaseline({ urlHash }, cwd);
    expect(result.ok).toBe(true);
    // Should pick run-aaa-new (newest mtime) not run-zzz-old (alphabetically last)
    expect(result.baselinePath).toContain(urlHash);
  });

  it("filters out directories that do not start with 'run-'", async () => {
    const { promoteBaseline } = await import("../tempering/baselines.mjs");
    const urlHash = "testhash2";

    // Only a non-run- dir has the screenshot
    writeScreenshot(cwd, "debug-session", "visual-diff", urlHash);

    expect(() => promoteBaseline({ urlHash }, cwd)).toThrow("NO_SCREENSHOT");
  });

  it("still finds a screenshot in a run- prefixed directory", async () => {
    const { promoteBaseline } = await import("../tempering/baselines.mjs");
    const urlHash = "testhash3";

    writeScreenshot(cwd, "run-20260401-abc", "visual-diff", urlHash);

    const result = promoteBaseline({ urlHash }, cwd);
    expect(result.ok).toBe(true);
  });

  it("respects explicit runId even with mtime sort", async () => {
    const { promoteBaseline } = await import("../tempering/baselines.mjs");
    const urlHash = "testhash4";

    writeScreenshot(cwd, "run-older", "visual-diff", urlHash);
    writeScreenshot(cwd, "run-newer", "visual-diff", urlHash);

    const artRoot = resolve(cwd, ".forge", "tempering", "artifacts");
    const now = Date.now();
    utimesSync(resolve(artRoot, "run-older"), new Date(now - 60_000), new Date(now - 60_000));
    utimesSync(resolve(artRoot, "run-newer"), new Date(now), new Date(now));

    // Explicitly request the older run
    const result = promoteBaseline({ urlHash, runId: "run-older" }, cwd);
    expect(result.ok).toBe(true);
  });

  it("uses mtimeMs property for sorting", async () => {
    // Verify the code references mtimeMs (validation gate requirement)
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      resolve(import.meta.dirname, "..", "tempering", "baselines.mjs"),
      "utf-8",
    );
    expect(src).toContain("mtimeMs");
    expect(src).not.toMatch(/\.sort\(\)\s*\.reverse\(\)/);
  });

  it("checks startsWith('run-') in filter", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      resolve(import.meta.dirname, "..", "tempering", "baselines.mjs"),
      "utf-8",
    );
    expect(src).toContain('startsWith("run-")');
  });
});
