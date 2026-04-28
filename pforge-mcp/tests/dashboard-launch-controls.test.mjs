/**
 * dashboard-launch-controls.test.mjs — Phase-33.1 Slice 2 dashboard controls tests
 *
 * Verifies that the dashboard static files contain the new launch controls:
 *   - index.html has #launch-only-slices text input
 *   - index.html has #launch-no-tempering checkbox
 *   - app.js reads and forwards --only-slices and --no-tempering in submitLaunch
 *
 * Uses readFileSync against real files — no mocks.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dashboardDir = resolve(__dirname, "../dashboard");
const indexHtml = readFileSync(resolve(dashboardDir, "index.html"), "utf-8");
const appJs = readFileSync(resolve(dashboardDir, "app.js"), "utf-8");

// ─── index.html controls ─────────────────────────────────────────────────────

describe("dashboard/index.html launch modal controls", () => {
  it("contains #launch-only-slices input", () => {
    expect(indexHtml).toContain("launch-only-slices");
  });

  it("contains #launch-no-tempering checkbox", () => {
    expect(indexHtml).toContain("launch-no-tempering");
  });

  it("launch-only-slices has placeholder 'e.g. 2,4-6'", () => {
    expect(indexHtml).toContain("e.g. 2,4-6");
  });

  it("launch-no-tempering label text is 'Skip tempering'", () => {
    expect(indexHtml).toContain("Skip tempering");
  });
});

// ─── app.js wiring ───────────────────────────────────────────────────────────

describe("dashboard/app.js submitLaunch wiring", () => {
  it("forwards --only-slices flag", () => {
    expect(appJs).toContain("--only-slices");
  });

  it("forwards --no-tempering flag", () => {
    expect(appJs).toContain("--no-tempering");
  });

  it("reads launch-only-slices element", () => {
    expect(appJs).toContain("launch-only-slices");
  });

  it("reads launch-no-tempering element", () => {
    expect(appJs).toContain("launch-no-tempering");
  });
});
