/**
 * ui-playwright manifest write tests (Phase-28.5 Slice 3).
 *
 * Verifies that the ui-playwright scanner writes a valid
 * screenshot-manifest.json at end of each run and overwrites
 * (not appends) prior manifests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runUiSweep, writeScreenshotManifest } from "../tempering/scanners/ui-playwright.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-uipw-manifest-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * Build a minimal fake Playwright that records navigated URLs and
 * fakes screenshot capture by writing a small file to disk.
 */
function fakePlaywright(pages) {
  return {
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => {
            let currentUrl = "";
            return {
              goto: async (url) => {
                currentUrl = url;
                const entry = pages.find((p) => p.url === url) || { status: 200 };
                return { status: () => entry.status };
              },
              $$eval: async () => (pages.find((p) => p.url === currentUrl) || {}).links || [],
              screenshot: async ({ path }) => {
                // Write a small file to simulate a screenshot
                mkdirSync(resolve(path, ".."), { recursive: true });
                writeFileSync(path, Buffer.from("FAKE_PNG"));
              },
              on: () => {},
              close: async () => {},
            };
          },
        }),
        close: async () => {},
      }),
    },
  };
}

function readManifest(tmp) {
  const p = resolve(tmp, ".forge", "tempering", "screenshot-manifest.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("ui-playwright manifest write", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("writes manifest with entries for all scanned URLs", async () => {
    const testUrl = "http://localhost:3100/dashboard";
    const pw = fakePlaywright([{ url: testUrl, status: 200, links: [] }]);

    const result = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: testUrl, captureScreenshots: true, runAccessibility: false },
      },
      projectDir: tmp,
      runId: "run-manifest-test",
      importFn: async (spec) => {
        if (spec === "playwright") return pw;
        throw new Error("not found");
      },
      env: {},
    });

    expect(result.verdict).not.toBe("skipped");

    const manifest = readManifest(tmp);
    expect(manifest).not.toBeNull();
    expect(Array.isArray(manifest)).toBe(true);
    expect(manifest.length).toBeGreaterThan(0);

    // Each entry has the expected shape
    for (const entry of manifest) {
      expect(entry).toHaveProperty("url");
      expect(entry).toHaveProperty("urlHash");
      expect(entry).toHaveProperty("path");
      expect(typeof entry.url).toBe("string");
      expect(typeof entry.urlHash).toBe("string");
      expect(typeof entry.path).toBe("string");
    }
  });

  it("overwrites prior manifest (not appends)", async () => {
    // Seed an old manifest with different entries
    const oldEntries = [
      { url: "http://old.example.com", urlHash: "oldhash", path: "/old/path.png" },
      { url: "http://old2.example.com", urlHash: "oldhash2", path: "/old/path2.png" },
    ];
    const manifestDir = resolve(tmp, ".forge", "tempering");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      resolve(manifestDir, "screenshot-manifest.json"),
      JSON.stringify(oldEntries),
      "utf-8",
    );

    // Run scanner with a single new URL
    const testUrl = "http://localhost:3100/page";
    const pw = fakePlaywright([{ url: testUrl, status: 200, links: [] }]);

    await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: testUrl, captureScreenshots: true, runAccessibility: false },
      },
      projectDir: tmp,
      runId: "run-overwrite-test",
      importFn: async (spec) => {
        if (spec === "playwright") return pw;
        throw new Error("not found");
      },
      env: {},
    });

    const manifest = readManifest(tmp);
    expect(manifest).not.toBeNull();
    // Must contain only entries from the new run, not old ones
    const oldUrls = manifest.filter((e) => e.url.includes("old.example.com"));
    expect(oldUrls).toHaveLength(0);
    expect(manifest.length).toBeGreaterThan(0);
    expect(manifest[0].url).toContain("localhost:3100");
  });
});

describe("writeScreenshotManifest", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("writes empty array to clear stale manifest", () => {
    // Seed an old manifest
    const manifestDir = resolve(tmp, ".forge", "tempering");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      resolve(manifestDir, "screenshot-manifest.json"),
      JSON.stringify([{ url: "http://old.com", urlHash: "h", path: "/p" }]),
      "utf-8",
    );

    writeScreenshotManifest(tmp, [], "run-clear");

    const manifest = readManifest(tmp);
    expect(manifest).toEqual([]);
  });

  it("creates manifest directory if missing", () => {
    writeScreenshotManifest(tmp, [{ url: "http://x.com", urlHash: "h", path: "/p" }], "run-1");

    const manifest = readManifest(tmp);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].url).toBe("http://x.com");
  });
});
