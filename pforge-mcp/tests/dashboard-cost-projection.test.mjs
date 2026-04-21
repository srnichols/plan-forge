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
