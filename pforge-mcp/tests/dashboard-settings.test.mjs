// Phase-30 Slice 6 — Settings decomposition mapping invariants.
// Asserts that every element from the decomposition-mapping table in the plan
// lives inside the correct destination section, and that no legacy DOM remains.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
const js  = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

// ── helpers ────────────────────────────────────────────────────────────────

/** Extract the innerHTML of a `<section id="<id>">` element (single nesting level). */
function extractSection(sectionId) {
  const start = html.indexOf(`id="${sectionId}"`);
  if (start === -1) return null;
  const tagStart = html.lastIndexOf("<section", start);
  const tagEnd   = html.indexOf("</section>", start);
  if (tagStart === -1 || tagEnd === -1) return null;
  return html.slice(tagStart, tagEnd + "</section>".length);
}

/** Count occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) { count++; pos++; }
  return count;
}

// ── legacy DOM removal ─────────────────────────────────────────────────────

describe("Phase-30 legacy DOM removal (Slice 6 sweep)", () => {
  it("removes the legacy #tab-config section", () => {
    expect(html).not.toContain('id="tab-config"');
  });

  it("removes the cfg-subtab button row from HTML", () => {
    expect(html).not.toContain("cfg-subtab");
  });

  it("removes cfg-subtab references from app.js", () => {
    expect(js).not.toContain("cfg-subtab");
  });

  it("removes initConfigSubtabs from app.js", () => {
    expect(js).not.toContain("initConfigSubtabs");
  });

  it("removes the dead config: tabLoadHook from app.js", () => {
    // The 'config' key in tabLoadHooks was the hook for the now-retired data-tab="config".
    expect(js).not.toMatch(/\bconfig\s*:\s*\(\s*\)\s*=>/);
  });

  it("removes cfg-skeleton helper elements (were only in legacy tab-config)", () => {
    expect(html).not.toContain('id="cfg-skeleton"');
  });

  it("removes cfg-form-body helper element (was only in legacy tab-config)", () => {
    expect(html).not.toContain('id="cfg-form-body"');
  });

  it("removes cfg-general container element (was only in legacy tab-config)", () => {
    expect(html).not.toContain('id="cfg-general"');
  });
});

// ── destination sections exist ─────────────────────────────────────────────

describe("Phase-30 destination sections exist (Slice 6 sweep)", () => {
  const SETTINGS_SECTIONS = [
    "tab-settings-general",
    "tab-settings-models",
    "tab-settings-execution",
    "tab-settings-api-keys",
    "tab-settings-updates",
    "tab-settings-memory",
    "tab-settings-bridge",
    "tab-settings-crucible",
    "tab-settings-brain",
  ];

  for (const id of SETTINGS_SECTIONS) {
    it(`<section id="${id}"> exists`, () => {
      expect(html).toContain(`id="${id}"`);
    });
  }
});

// ── decomposition mapping invariants ──────────────────────────────────────

describe("Phase-30 decomposition mapping (Slice 6 sweep)", () => {
  const MAPPINGS = [
    // section-id              element-ids
    ["tab-settings-general",   ["cfg-preset", "cfg-version", "cfg-agents"]],
    ["tab-settings-models",    ["cfg-model-default", "cfg-model-image"]],
    ["tab-settings-execution", [
      "cfg-max-parallel", "cfg-max-retries", "cfg-max-history",
      "cfg-quorum-enabled", "cfg-quorum-preset", "cfg-quorum-threshold",
      "cfg-quorum-models", "cfg-workers",
    ]],
    ["tab-settings-api-keys",  ["cfg-api-keys", "cfg-api-providers"]],
    ["tab-settings-updates",   ["cfg-update-source"]],
    ["tab-settings-memory",    [
      "cfg-openbrain", "memory-search-panel",
      "memory-search-input", "memory-search-results", "memory-presets",
    ]],
    ["tab-settings-brain",     ["cfg-brain"]],
  ];

  for (const [sectionId, elementIds] of MAPPINGS) {
    const section = extractSection(sectionId);

    for (const elemId of elementIds) {
      it(`#${elemId} lives inside #${sectionId}`, () => {
        expect(section).not.toBeNull();
        expect(section).toContain(`id="${elemId}"`);
      });

      it(`#${elemId} appears exactly once in index.html (no orphaned duplicates)`, () => {
        expect(countOccurrences(html, `id="${elemId}"`)).toBe(1);
      });
    }
  }
});
