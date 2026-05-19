/**
 * Phase 40 S4 — Observer narrations card DOM contract tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const js = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;

describe("S4 — observer narrations card markup", () => {
  it("declares #card-observer-narrations in tab-home", () => {
    const card = document.getElementById("card-observer-narrations");
    expect(card).not.toBeNull();
    const homeSection = document.getElementById("tab-home");
    expect(homeSection?.contains(card)).toBe(true);
  });

  it("has an #observer-narrations-list with role=log and aria-live=polite", () => {
    const list = document.getElementById("observer-narrations-list");
    expect(list).not.toBeNull();
    expect(list?.getAttribute("role")).toBe("log");
    expect(list?.getAttribute("aria-live")).toBe("polite");
  });

  it("has an empty state element with a deep-link to settings-forgemaster", () => {
    const empty = document.getElementById("observer-narrations-empty");
    expect(empty).not.toBeNull();
    const link = empty?.querySelector("a");
    expect(link).not.toBeNull();
  });

  it("has an 'Observer Narrations' heading", () => {
    expect(html).toContain("Observer Narrations");
  });
});

describe("S4 — observer narrations card wiring", () => {
  it("app.js handles observer:narration WebSocket events", () => {
    expect(js).toContain("observer:narration");
  });

  it("app.js calls /api/brain/recall?source=observer&limit=20", () => {
    expect(js).toContain("/api/brain/recall?source=observer&limit=20");
  });

  it("app.js declares loadObserverNarrations function", () => {
    expect(js).toContain("loadObserverNarrations");
  });

  it("app.js calls loadObserverNarrations on init", () => {
    const idx = js.indexOf("function loadObserverNarrations");
    const callIdx = js.indexOf("loadObserverNarrations()", idx);
    expect(callIdx).toBeGreaterThan(idx);
  });
});
