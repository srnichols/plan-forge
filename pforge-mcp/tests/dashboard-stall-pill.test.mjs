/**
 * Plan Forge — Phase Hotfix-v2.90.8 Slice 3 tests
 *
 * dashboard/app.js source-contract tests for the `slice-output-stalled` pill.
 *
 * Uses file-contract pattern (read source, assert structure) identical to
 * dashboard-copilot-dispatch-badges.test.mjs — no DOM/vm execution needed
 * since the pill is purely template-driven from slice state.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(HERE, "..", "dashboard", "app.js");

let src = "";
beforeAll(() => {
  src = readFileSync(APP_JS, "utf-8");
});

// ─── Event routing ────────────────────────────────────────────────────────────

describe("slice-output-stalled event routing (Hotfix-v2.90.8 Slice 3)", () => {
  it("handleEvent switch includes slice-output-stalled case", () => {
    expect(src).toContain('case "slice-output-stalled":');
  });

  it("routes slice-output-stalled to handleSliceOutputStalled", () => {
    expect(src).toMatch(/case "slice-output-stalled"[\s\S]{0,120}handleSliceOutputStalled/);
  });
});

// ─── Handler function ─────────────────────────────────────────────────────────

describe("handleSliceOutputStalled function (Hotfix-v2.90.8 Slice 3)", () => {
  it("declares handleSliceOutputStalled function", () => {
    expect(src).toMatch(/function handleSliceOutputStalled\s*\(/);
  });

  it("sets slice.outputStalled = true on the matching slice", () => {
    expect(src).toMatch(/slice\.outputStalled\s*=\s*true/);
  });

  it("stores stallDuration when provided in event data", () => {
    expect(src).toMatch(/slice\.stallDuration\s*=\s*data\.stallDuration/);
  });

  it("calls renderSliceCards after updating the slice", () => {
    // The handler must trigger a re-render so the pill appears immediately
    const fnMatch = src.match(/function handleSliceOutputStalled[\s\S]+?^}/m);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch[0]).toContain("renderSliceCards()");
  });
});

// ─── Pill rendering ───────────────────────────────────────────────────────────

describe("stall pill HTML (Hotfix-v2.90.8 Slice 3)", () => {
  it("declares stallPillHtml variable initialised to empty string", () => {
    expect(src).toMatch(/let stallPillHtml\s*=\s*""/);
  });

  it("guards pill rendering on s.outputStalled", () => {
    expect(src).toMatch(/if\s*\(\s*s\.outputStalled\s*\)/);
  });

  it("pill element has data-testid='slice-output-stalled-pill'", () => {
    expect(src).toContain('data-testid="slice-output-stalled-pill"');
  });

  it("pill uses amber colour class", () => {
    expect(src).toMatch(/stallPillHtml[\s\S]{0,200}text-amber-400/);
  });

  it("pill renders the ⏸ stalled label", () => {
    expect(src).toMatch(/⏸ stalled/);
  });

  it("pill title mentions stallDuration when available", () => {
    expect(src).toMatch(/stallDuration[\s\S]{0,100}No output for/);
  });

  it("pill title falls back when stallDuration is absent", () => {
    expect(src).toContain("No output for extended period");
  });
});

// ─── Template wiring ──────────────────────────────────────────────────────────

describe("stall pill injected into slice-card template (Hotfix-v2.90.8 Slice 3)", () => {
  it("stallPillHtml is interpolated into the top-right badge row", () => {
    expect(src).toMatch(/\$\{retryHtml\}[\s\S]{0,100}\$\{stallPillHtml\}/);
  });

  it("stallPillHtml appears alongside temperingPillHtml in the same span", () => {
    expect(src).toMatch(/\$\{temperingPillHtml\}[\s\S]{0,40}\$\{stallPillHtml\}/);
  });
});
