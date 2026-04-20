/**
 * Plan Forge — Phase-26 Slice 14: best-defaults preset + dashboard-state API.
 *
 * Verifies two invariants:
 *   1. The preset writer shipped in setup.ps1/setup.sh keeps every inner-loop
 *      subsystem advisory by default and never clobbers an existing
 *      `.forge.json` on upgrade.
 *   2. `/api/dashboard-state` round-trips an arbitrary JSON object and merges
 *      partial writes instead of replacing the whole state.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Harness ────────────────────────────────────────────────────

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-best-defaults-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (savedCwd) process.chdir(savedCwd);
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

// ─── /api/dashboard-state GET/POST ──────────────────────────────

describe("GET /api/dashboard-state", () => {
  it("returns {} when the state file is absent", async () => {
    const stateFile = resolve(tmpProject, ".forge", "dashboard-state.json");
    if (existsSync(stateFile)) rmSync(stateFile);
    const res = await fetch(`${baseUrl}/api/dashboard-state`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("returns the parsed state when present", async () => {
    mkdirSync(resolve(tmpProject, ".forge"), { recursive: true });
    writeFileSync(
      resolve(tmpProject, ".forge", "dashboard-state.json"),
      JSON.stringify({ seenInnerLoop258: true, foo: "bar" }),
      "utf-8"
    );
    const res = await fetch(`${baseUrl}/api/dashboard-state`);
    expect(await res.json()).toEqual({ seenInnerLoop258: true, foo: "bar" });
  });
});

describe("POST /api/dashboard-state", () => {
  it("rejects non-object bodies with 400", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["not", "an", "object"]),
    });
    expect(res.status).toBe(400);
  });

  it("merges partial writes onto existing state", async () => {
    // Seed
    mkdirSync(resolve(tmpProject, ".forge"), { recursive: true });
    writeFileSync(
      resolve(tmpProject, ".forge", "dashboard-state.json"),
      JSON.stringify({ a: 1, b: 2 }),
      "utf-8"
    );
    // Patch
    const res = await fetch(`${baseUrl}/api/dashboard-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b: 99, c: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.state).toEqual({ a: 1, b: 99, c: 3 });
    // Disk matches
    const persisted = JSON.parse(readFileSync(resolve(tmpProject, ".forge", "dashboard-state.json"), "utf-8"));
    expect(persisted).toEqual({ a: 1, b: 99, c: 3 });
  });

  it("creates the .forge directory if missing", async () => {
    rmSync(resolve(tmpProject, ".forge"), { recursive: true, force: true });
    const res = await fetch(`${baseUrl}/api/dashboard-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seenInnerLoop258: true }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(resolve(tmpProject, ".forge", "dashboard-state.json"))).toBe(true);
  });
});

// ─── Best-defaults preset structural checks ─────────────────────

describe("best-defaults preset writers", () => {
  const repoRoot = resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "..", "..", "..");

  it("setup.ps1 gates .forge.json write on existence", () => {
    const txt = readFileSync(resolve(repoRoot, "setup.ps1"), "utf-8");
    expect(txt).toContain("function Write-BestDefaultsPreset");
    expect(txt).toMatch(/if\s*\(Test-Path\s+\$configPath\)/);
    expect(txt).toContain("preserving user config");
  });

  it("setup.sh gates .forge.json write on existence", () => {
    const txt = readFileSync(resolve(repoRoot, "setup.sh"), "utf-8");
    expect(txt).toContain("write_best_defaults_preset");
    expect(txt).toMatch(/if\s*\[\[\s*-f\s+"\$CONFIG_PATH"/);
    expect(txt).toContain("preserving user config");
  });

  it("both setup scripts ship inner-loop defaults in advisory posture", () => {
    const ps1 = readFileSync(resolve(repoRoot, "setup.ps1"), "utf-8");
    const sh = readFileSync(resolve(repoRoot, "setup.sh"), "utf-8");
    // Competitive must be off by default (opt-in).
    expect(ps1).toMatch(/competitive\s*=\s*@\{\s*enabled\s*=\s*\$false/);
    expect(sh).toMatch(/"competitive":\s*\{\s*"enabled":\s*false/);
    // AutoFix drafts patches but does NOT auto-apply.
    expect(ps1).toMatch(/applyWithoutReview\s*=\s*\$false/);
    expect(sh).toMatch(/"applyWithoutReview":\s*false/);
    // Federation starts disabled with empty repo list.
    expect(ps1).toMatch(/federation\s*=\s*@\{\s*enabled\s*=\s*\$false/);
    expect(sh).toMatch(/"federation":\s*\{\s*"enabled":\s*false/);
  });
});
