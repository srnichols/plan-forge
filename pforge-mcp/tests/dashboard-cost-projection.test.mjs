/**
 * Plan-Forge — Phase-27.2 Slice 4 tests
 *
 * Dashboard projected-cost badge + state ingestion.
 *
 * These are file-contract tests: they parse dashboard/app.js source and
 * assert the required symbols, state shape, badge markup, and hydration
 * logic are present. A full DOM runtime is not required for the scope
 * of this slice — the same pattern other dashboard UI tests use
 * (forge-shop-home-ui.test.mjs, tempering-dashboard.test.mjs).
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

describe("dashboard cost projection state (Phase-27.2 Slice 4)", () => {
  it("state declares planProjection, projectionMode, projectionPlanPath", () => {
    expect(src).toMatch(/planProjection:\s*null/);
    expect(src).toMatch(/projectionMode:\s*"recommended"/);
    expect(src).toMatch(/projectionPlanPath:\s*null/);
  });

  it("defines fetchPlanProjection() that POSTs to /api/tool/forge_estimate_quorum", () => {
    expect(src).toMatch(/async function fetchPlanProjection\s*\(\s*planPath\s*\)/);
    expect(src).toMatch(/\/api\/tool\/forge_estimate_quorum/);
    // Must send planPath in the body
    expect(src).toMatch(/JSON\.stringify\(\s*\{\s*planPath\s*\}\s*\)/);
  });

  it("defines hydrateSliceProjections() that indexes slices by projectedCostUSD", () => {
    expect(src).toMatch(/function hydrateSliceProjections\s*\(\s*\)/);
    expect(src).toMatch(/projectedCostUSD/);
    // Maps onto state.slices[].projectedCost
    expect(src).toMatch(/s\.projectedCost\s*=\s*match\.projectedCostUSD/);
  });

  it("handleRunStarted triggers fetchPlanProjection on plan-open", () => {
    // Plan-open hook — regardless of exact surrounding syntax, fetchPlanProjection
    // must be called from handleRunStarted with data.plan.
    const handlerIdx = src.indexOf("function handleRunStarted");
    expect(handlerIdx, "handleRunStarted must exist").toBeGreaterThan(-1);
    const handlerBody = src.slice(handlerIdx, handlerIdx + 3000);
    expect(handlerBody).toMatch(/fetchPlanProjection\(/);
  });

  it("resolves 'recommended' projectionMode through planProjection.recommended", () => {
    // hydrateSliceProjections must honour the "recommended" sentinel.
    expect(src).toMatch(/projectionMode\s*===\s*"recommended"/);
    expect(src).toMatch(/planProjection\.recommended/);
  });
});

describe("dashboard projected-cost badge markup (Phase-27.2 Slice 4)", () => {
  it("renders a 💵 ~$0.xxxx badge when s.projectedCost is set", () => {
    // Badge string literal (the 💵 emoji and ~$ prefix distinguish it from spend)
    expect(src).toMatch(/💵 ~\$\$\{s\.projectedCost\.toFixed\(4\)\}/);
  });

  it("omits the projectedBadge when s.projectedCost is not a positive number", () => {
    // Guard: typeof s.projectedCost === "number" && s.projectedCost > 0
    expect(src).toMatch(/typeof s\.projectedCost === "number"\s*&&\s*s\.projectedCost\s*>\s*0/);
  });

  it("renders projected badge between complexity and spend (left-to-right)", () => {
    // The slice-card container line must list badges in complexity → projected → spend order.
    const containerLine = src.split("\n").find((l) => l.includes("complexityBadge") && l.includes("spendBadge"));
    expect(containerLine, "slice-card badge container row must exist").toBeTruthy();
    const iComplex = containerLine.indexOf("complexityBadge");
    const iProjected = containerLine.indexOf("projectedBadge");
    const iSpend = containerLine.indexOf("spendBadge");
    expect(iComplex).toBeGreaterThan(-1);
    expect(iProjected).toBeGreaterThan(-1);
    expect(iSpend).toBeGreaterThan(-1);
    expect(iComplex).toBeLessThan(iProjected);
    expect(iProjected).toBeLessThan(iSpend);
  });

  it("container renders when ANY of complexity / projected / spend are present", () => {
    expect(src).toMatch(/\(complexityBadge\s*\|\|\s*projectedBadge\s*\|\|\s*spendBadge\)/);
  });

  it("tooltip on projected badge names the active mode", () => {
    expect(src).toMatch(/title="Projected cost \(mode: \$\{modeLabel\}\)"/);
  });
});

describe("dashboard plan-projection strip (Phase-27.2 Slice 5)", () => {
  let indexHtml = "";
  beforeAll(() => {
    const INDEX = resolve(HERE, "..", "dashboard", "index.html");
    indexHtml = readFileSync(INDEX, "utf-8");
  });

  it("index.html declares a #plan-projection-strip details element (hidden by default)", () => {
    expect(indexHtml).toMatch(/id="plan-projection-strip"/);
    expect(indexHtml).toMatch(/id="plan-projection-strip"[^>]*hidden/);
    expect(indexHtml).toMatch(/data-testid="plan-projection-strip"/);
  });

  it("strip exposes four mode spans + recommended span + details container", () => {
    for (const id of ["projection-auto", "projection-power", "projection-speed", "projection-false", "projection-recommended", "projection-details"]) {
      expect(indexHtml, `missing #${id}`).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it("app.js defines hydratePlanProjectionStrip() and calls it from fetchPlanProjection", () => {
    expect(src).toMatch(/function hydratePlanProjectionStrip\s*\(/);
    // Must be called after planProjection is set
    const fetchIdx = src.indexOf("async function fetchPlanProjection");
    expect(fetchIdx).toBeGreaterThan(-1);
    const body = src.slice(fetchIdx, fetchIdx + 3000);
    expect(body).toMatch(/hydratePlanProjectionStrip\(\)/);
  });

  it("strip un-hides on hydrate and re-hides when projection is cleared", () => {
    const hydIdx = src.indexOf("function hydratePlanProjectionStrip");
    const body = src.slice(hydIdx, hydIdx + 4000);
    expect(body).toMatch(/classList\.remove\(\s*"hidden"\s*\)/);
    expect(body).toMatch(/classList\.add\(\s*"hidden"\s*\)/);
  });

  it("budget-cap highlighting: over-budget modes render text-red-400", () => {
    const hydIdx = src.indexOf("function hydratePlanProjectionStrip");
    const body = src.slice(hydIdx, hydIdx + 4000);
    expect(body).toMatch(/text-red-400/);
    // Over-budget guard must check budgetCapUSD
    expect(body).toMatch(/budgetCapUSD/);
  });

  it("recommended label reads from planProjection.recommended", () => {
    const hydIdx = src.indexOf("function hydratePlanProjectionStrip");
    const body = src.slice(hydIdx, hydIdx + 4000);
    expect(body).toMatch(/proj\.recommended/);
  });
});

describe("dashboard projected→actual flourish (Phase-27.2 Slice 6)", () => {
  it("handleSliceCompleted marks slice.flourishUntil and schedules a clear", () => {
    const idx = src.indexOf("function handleSliceCompleted");
    const body = src.slice(idx, idx + 2000);
    expect(body).toMatch(/flourishUntil\s*=\s*Date\.now\(\)\s*\+\s*5000/);
    expect(body).toMatch(/scheduleFlourishClear\(/);
  });

  it("handleSliceFailed also marks flourishUntil (failed slices still have a projection)", () => {
    const idx = src.indexOf("function handleSliceFailed");
    const body = src.slice(idx, idx + 2000);
    expect(body).toMatch(/flourishUntil\s*=\s*Date\.now\(\)\s*\+\s*5000/);
  });

  it("scheduleFlourishClear() re-renders after window expires", () => {
    const idx = src.indexOf("function scheduleFlourishClear");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 1000);
    expect(body).toMatch(/setTimeout\(/);
    expect(body).toMatch(/renderSliceCards\(\)/);
    expect(body).toMatch(/delete slice\.flourishUntil/);
  });

  it("projected badge is suppressed when actual cost present AND not flourishing", () => {
    // Guard expression: actual present → hide unless flourishing
    expect(src).toMatch(/const\s+actualCostPresent\s*=\s*typeof s\.cost === "number"\s*&&\s*s\.cost\s*>\s*0/);
    expect(src).toMatch(/const\s+flourishing\s*=\s*typeof s\.flourishUntil === "number"\s*&&\s*s\.flourishUntil\s*>\s*Date\.now\(\)/);
    expect(src).toMatch(/!actualCostPresent\s*\|\|\s*flourishing/);
  });

  it("projected badge uses a CSS opacity transition when flourishing", () => {
    expect(src).toMatch(/transition-opacity/);
    expect(src).toMatch(/opacity-70/);
  });
});
