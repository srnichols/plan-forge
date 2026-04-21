/**
 * Tests for the Forge-Master prompt catalog (Phase-29).
 */

import { describe, it, expect } from "vitest";
import { getPromptCatalog, getPromptById } from "../src/prompts.mjs";
import { BASE_ALLOWLIST, WRITE_ALLOWLIST, PHASE29_FULL_ALLOWLIST } from "../src/allowlist.mjs";

const RESOLVED_ALLOWLIST_NAMES = new Set(PHASE29_FULL_ALLOWLIST);

// ─── Catalog structure ────────────────────────────────────────────────

describe("prompt catalog", () => {
  it("loads without error", () => {
    expect(() => getPromptCatalog()).not.toThrow();
  });

  it("has at least 30 prompts total", () => {
    const catalog = getPromptCatalog();
    const total = catalog.categories.reduce((n, c) => n + c.prompts.length, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });

  it("has at least 7 categories", () => {
    const catalog = getPromptCatalog();
    expect(catalog.categories.length).toBeGreaterThanOrEqual(7);
  });

  it("each category meets minimum prompt count", () => {
    const catalog = getPromptCatalog();
    const minimums = {
      "plan-status":  5,
      "troubleshooting": 5,
      "crucible":     4,
      "cost-quorum":  4,
      "testing":      4,
      "memory":       4,
      "extensions":   3,
    };
    for (const [catId, min] of Object.entries(minimums)) {
      const cat = catalog.categories.find(c => c.id === catId);
      expect(cat, `category ${catId} must exist`).toBeTruthy();
      expect(cat.prompts.length, `${catId} must have ≥ ${min} prompts`).toBeGreaterThanOrEqual(min);
    }
  });

  it("has no duplicate prompt IDs", () => {
    const catalog = getPromptCatalog();
    const ids = catalog.categories.flatMap(c => c.prompts.map(p => p.id));
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all suggestedTools are present in the Phase-29 resolved allowlist", () => {
    const catalog = getPromptCatalog();
    for (const cat of catalog.categories) {
      for (const p of cat.prompts) {
        for (const toolName of (p.suggestedTools || [])) {
          expect(
            RESOLVED_ALLOWLIST_NAMES.has(toolName),
            `Prompt "${p.id}" references "${toolName}" which is not in PHASE29_FULL_ALLOWLIST`,
          ).toBe(true);
        }
      }
    }
  });

  it("placeholder names appear in their template", () => {
    const catalog = getPromptCatalog();
    for (const cat of catalog.categories) {
      for (const p of cat.prompts) {
        for (const ph of (p.placeholders || [])) {
          const key = ph.key || ph.name;
          expect(
            p.template.includes(`{{${key}}}`),
            `Prompt "${p.id}" placeholder "${key}" not found in template`,
          ).toBe(true);
        }
      }
    }
  });

  it("write-tool prompts are flagged requiresApproval: true", () => {
    const writeNames = new Set(WRITE_ALLOWLIST.map(t => t.name));
    const catalog = getPromptCatalog();
    for (const cat of catalog.categories) {
      for (const p of cat.prompts) {
        const hasWriteTool = (p.suggestedTools || []).some(t => writeNames.has(t));
        if (hasWriteTool) {
          expect(
            p.requiresApproval,
            `Prompt "${p.id}" uses a write tool but is missing requiresApproval: true`,
          ).toBe(true);
        }
      }
    }
  });

  it("custom prompts file merge — catalog still valid when no custom file exists", () => {
    // Without a custom prompts file the catalog should still be a valid structure
    const catalog = getPromptCatalog();
    expect(catalog.version).toBeTruthy();
    expect(Array.isArray(catalog.categories)).toBe(true);
  });
});

// ─── getPromptById ────────────────────────────────────────────────────

describe("getPromptById", () => {
  it("returns a prompt for a valid ID", () => {
    const p = getPromptById("ps-current-status");
    expect(p).toBeTruthy();
    expect(p.id).toBe("ps-current-status");
  });

  it("returns null for an unknown ID", () => {
    expect(getPromptById("does-not-exist-xyz")).toBeNull();
  });
});
