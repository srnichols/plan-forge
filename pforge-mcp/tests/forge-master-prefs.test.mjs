/**
 * Plan Forge — forge_master prefs REST endpoint tests (Phase-34, Slice 3).
 *
 * Covers:
 *   (1) loadPrefs returns defaults when .forge/fm-prefs.json is absent
 *   (2) savePrefs + loadPrefs round-trip preserves tier
 *   (3) savePrefs + loadPrefs round-trip preserves autoEscalate=true
 *   (4) loadPrefs returns null tier for an invalid tier value in the file
 *   (5) createHttpRoutes registers GET and PUT /api/forge-master/prefs
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadPrefs,
  savePrefs,
  createHttpRoutes,
} from "../../pforge-master/src/http-routes.mjs";

// ─── Helpers ────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "fm-prefs-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── loadPrefs / savePrefs ──────────────────────────────────────────────────

describe("loadPrefs / savePrefs — persistence", () => {
  it("(1) loadPrefs returns defaults when .forge/fm-prefs.json is missing", () => {
    const prefs = loadPrefs(tmpDir);
    expect(prefs).toEqual({ tier: null, autoEscalate: false, quorumAdvisory: "off", embeddingFallback: true });
  });

  it("(2) savePrefs + loadPrefs round-trip preserves tier='high'", () => {
    savePrefs({ tier: "high", autoEscalate: false }, tmpDir);
    const prefs = loadPrefs(tmpDir);
    expect(prefs.tier).toBe("high");
    expect(prefs.autoEscalate).toBe(false);
  });

  it("(3) savePrefs + loadPrefs round-trip preserves autoEscalate=true", () => {
    savePrefs({ tier: "medium", autoEscalate: true }, tmpDir);
    const prefs = loadPrefs(tmpDir);
    expect(prefs.tier).toBe("medium");
    expect(prefs.autoEscalate).toBe(true);
  });

  it("(4) loadPrefs returns null tier when saved tier value is invalid", () => {
    // Write the file manually with a bad tier value
    const forgeDir = join(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(
      join(forgeDir, "fm-prefs.json"),
      JSON.stringify({ tier: "turbo", autoEscalate: false }),
      "utf-8",
    );
    const prefs = loadPrefs(tmpDir);
    expect(prefs.tier).toBeNull();
  });
});

// ─── Route registration ─────────────────────────────────────────────────────

describe("createHttpRoutes — prefs route registration", () => {
  it("(5) registers GET and PUT /api/forge-master/prefs on express app", () => {
    const routes = [];
    const mockApp = {
      get(path) { routes.push({ method: "GET", path }); },
      put(path) { routes.push({ method: "PUT", path }); },
      post(path) { routes.push({ method: "POST", path }); },
      use(path) { routes.push({ method: "USE", path }); },
    };
    createHttpRoutes(mockApp);
    expect(routes.some(r => r.method === "GET" && r.path === "/api/forge-master/prefs")).toBe(true);
    expect(routes.some(r => r.method === "PUT" && r.path === "/api/forge-master/prefs")).toBe(true);
  });
});
