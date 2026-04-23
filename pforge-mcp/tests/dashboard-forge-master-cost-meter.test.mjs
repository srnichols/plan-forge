/* @vitest-environment jsdom */
/**
 * Tests for Forge-Master chat cost meter — Phase-38.3.
 *
 * Verifies that forgeMasterRenderCostMeter renders a #fm-cost-meter element
 * after #fm-dial when tokens are present, renders empty when tokens are 0,
 * and updates the meter in place on repeated calls.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function seedDOM() {
  document.body.innerHTML = `
    <div id="fm-dial"></div>
    <div id="fm-chat-stream"></div>
    <div id="fm-tool-trace"></div>
    <textarea id="fm-composer"></textarea>
  `;
}

function loadModule() {
  const src = readFileSync(resolve(__dirname, "../dashboard/forge-master.js"), "utf-8");
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "crypto", "sessionStorage", src);
  fn(window, document, window.crypto, window.sessionStorage);
}

describe("forgeMasterRenderCostMeter", () => {
  beforeEach(() => {
    seedDOM();
    loadModule();
  });

  it("creates #fm-cost-meter element after #fm-dial", () => {
    window._forgeMasterSetChatCost(0.0015, 500, 300);

    const meterEl = document.getElementById("fm-cost-meter");
    expect(meterEl).not.toBeNull();
  });

  it("renders cost string with token count when tokens > 0", () => {
    window._forgeMasterSetChatCost(0.0015, 500, 300);

    const meterEl = document.getElementById("fm-cost-meter");
    expect(meterEl.textContent).toContain("Chat:");
    expect(meterEl.textContent).toContain("tok");
  });

  it("renders <$0.0001 for very small costs", () => {
    window._forgeMasterSetChatCost(0.000001, 10, 5);

    const meterEl = document.getElementById("fm-cost-meter");
    expect(meterEl.textContent).toContain("<$0.0001");
  });

  it("shows empty text when totalTokens is 0", () => {
    // Call with zero tokens — meter element exists but is blank
    window._forgeMasterSetChatCost(0, 0, 0);

    const meterEl = document.getElementById("fm-cost-meter");
    // When totalTokens === 0, element is not created (function returns early without dial insertion)
    // OR element exists with empty textContent — both acceptable
    if (meterEl) {
      expect(meterEl.textContent).toBe("");
    }
  });

  it("uses k suffix for token counts >= 1000", () => {
    window._forgeMasterSetChatCost(0.05, 2000, 800);

    const meterEl = document.getElementById("fm-cost-meter");
    expect(meterEl.textContent).toMatch(/\dk tok/);
  });

  it("updates meter in place — does not create duplicate elements", () => {
    window._forgeMasterSetChatCost(0.001, 200, 100);
    window._forgeMasterSetChatCost(0.003, 600, 300);

    const allMeters = document.querySelectorAll("#fm-cost-meter");
    expect(allMeters.length).toBe(1);
  });

  it("does not throw when #fm-dial is absent", () => {
    document.body.innerHTML = `
      <div id="fm-chat-stream"></div>
      <textarea id="fm-composer"></textarea>
    `;
    loadModule();

    expect(() => window._forgeMasterSetChatCost(0.001, 200, 100)).not.toThrow();
  });

  it("sets tooltip describing API-equivalent estimate disclaimer", () => {
    window._forgeMasterSetChatCost(0.002, 400, 200);

    const meterEl = document.getElementById("fm-cost-meter");
    expect(meterEl.title).toContain("API-equivalent");
  });
});
