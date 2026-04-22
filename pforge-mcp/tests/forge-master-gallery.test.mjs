/* @vitest-environment jsdom */
/**
 * Tests for Forge-Master gallery event delegation (Phase-32, Slice 1).
 *
 * Verifies that clicking a gallery button (with data-prompt-id) fills
 * #fm-composer with the matching prompt template — no inline onclick needed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CATALOG = {
  categories: [
    {
      label: "Test Category",
      prompts: [
        { id: "test-prompt-1", title: "Test Prompt", description: "A test prompt", template: "Hello from test prompt!" },
        { id: "test-prompt-2", title: "Another Prompt", description: "Another test", template: "Another template value" },
      ],
    },
  ],
};

function seedDOM() {
  document.body.innerHTML = `
    <div id="fm-gallery-list"></div>
    <textarea id="fm-composer"></textarea>
  `;
}

function mockFetch(catalog) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => catalog,
  });
}

async function loadModule() {
  // Dynamic import ensures the module runs after DOM is seeded
  const src = readFileSync(resolve(__dirname, "../dashboard/forge-master.js"), "utf-8");
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "fetch", src);
  fn(window, document, global.fetch);
}

describe("forge-master gallery — event delegation", () => {
  beforeEach(() => {
    seedDOM();
    mockFetch(CATALOG);
    // Provide a no-op forgeMasterFilterGallery placeholder on window
    window.forgeMasterFilterGallery = () => {};
  });

  it("renders buttons with data-prompt-id (no inline onclick)", async () => {
    await loadModule();
    // Trigger init via the tab activate global
    await window.forgeMasterOnTabActivate();
    // Allow microtasks (fetch mock) to settle
    await new Promise(r => setTimeout(r, 0));

    const buttons = document.querySelectorAll("#fm-gallery-list button[data-prompt-id]");
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.hasAttribute("onclick")).toBe(false);
    }
  });

  it("clicking a gallery button sets composer value to its template", async () => {
    await loadModule();
    await window.forgeMasterOnTabActivate();
    await new Promise(r => setTimeout(r, 0));

    const btn = document.querySelector('[data-prompt-id="test-prompt-1"]');
    expect(btn).not.toBeNull();

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const composer = document.getElementById("fm-composer");
    expect(composer.value).toBe("Hello from test prompt!");
  });

  it("focuses the composer after picking a prompt", async () => {
    await loadModule();
    await window.forgeMasterOnTabActivate();
    await new Promise(r => setTimeout(r, 0));

    const btn = document.querySelector('[data-prompt-id="test-prompt-2"]');
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.activeElement.id).toBe("fm-composer");
  });

  it("second button sets a different template value", async () => {
    await loadModule();
    await window.forgeMasterOnTabActivate();
    await new Promise(r => setTimeout(r, 0));

    document.querySelector('[data-prompt-id="test-prompt-2"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.getElementById("fm-composer").value).toBe("Another template value");
  });
});
