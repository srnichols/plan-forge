/**
 * Phase 40 S4 — Observer narrations card.
 *
 * Tests HTML markup, JS wiring, and JSDOM render behavior for the observer
 * narrations card in the Forge-Master tab.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const js = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;

describe("S4 — observer-narrations-card HTML markup", () => {
  it("renders the observer narrations card in tab-forge-master", () => {
    const section = document.getElementById("tab-forge-master");
    expect(section, "tab-forge-master section must exist").not.toBeNull();
    const card = section.querySelector('[data-testid="observer-narrations-card"]');
    expect(card, "observer-narrations-card must exist inside tab-forge-master").not.toBeNull();
  });

  it("declares #observer-narrations-list with data-event-type='observer:narration'", () => {
    const list = document.getElementById("observer-narrations-list");
    expect(list, "#observer-narrations-list must exist").not.toBeNull();
    expect(list.getAttribute("data-event-type")).toBe("observer:narration");
  });

  it("contains a visible 'Observer Narrations' heading", () => {
    expect(html).toContain("Observer Narrations");
  });

  it("has an empty-state element #observer-narrations-empty", () => {
    const empty = document.getElementById("observer-narrations-empty");
    expect(empty, "#observer-narrations-empty must exist").not.toBeNull();
    expect(empty.textContent).toContain("Observer disabled");
  });

  it("empty-state deep-links to the settings-forgemaster tab", () => {
    const empty = document.getElementById("observer-narrations-empty");
    const link = empty.querySelector("a");
    expect(link, "deep-link anchor must exist in empty state").not.toBeNull();
    expect(link.getAttribute("onclick") || link.textContent).toMatch(/settings-forgemaster/);
  });

  it("has a refresh button calling loadObserverNarrations()", () => {
    const card = document.querySelector('[data-testid="observer-narrations-card"]');
    const btn = card.querySelector("button[title='Refresh']");
    expect(btn, "Refresh button must exist").not.toBeNull();
    expect(btn.getAttribute("onclick")).toContain("loadObserverNarrations");
  });
});

describe("S4 — observer-narrations-card JS wiring", () => {
  it("defines loadObserverNarrations function", () => {
    expect(js).toContain("function loadObserverNarrations(");
  });

  it("fetches /api/brain/recall?source=observer&limit=20", () => {
    expect(js).toContain("/api/brain/recall?source=observer&limit=20");
  });

  it("defines renderObserverNarration function", () => {
    expect(js).toContain("function renderObserverNarration(");
  });

  it("handles observer:narration WebSocket events", () => {
    expect(js).toContain(`case "observer:narration"`);
  });

  it("exposes loadObserverNarrations on window", () => {
    expect(js).toContain("window.loadObserverNarrations = loadObserverNarrations");
  });

  it("forge-master tabLoadHook calls loadObserverNarrations", () => {
    expect(js).toMatch(/'forge-master'[\s\S]*loadObserverNarrations/);
  });
});
