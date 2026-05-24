/**
 * Phase-43 — principles.mjs "+ @baseline" alias guard.
 *
 * Project-Principles + Scott-voice CTO overlay must compose without
 * duplicating UNIVERSAL_BASELINE in JSON config. The "+ @baseline" alias
 * keeps a single source of truth for the ten Scott-voice principles.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrinciples, UNIVERSAL_BASELINE, _clearCache } from "../src/principles.mjs";

let cwd;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pforge-principles-"));
  _clearCache();
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), "utf-8");
}

function writePrinciplesMd(cwd, body) {
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, "docs", "plans", "PROJECT-PRINCIPLES.md"), body, "utf-8");
}

describe('principles: "+ @baseline" alias', () => {
  it("appends UNIVERSAL_BASELINE after a PROJECT-PRINCIPLES.md block", () => {
    writePrinciplesMd(cwd, "# My project principles\n\nBe nice.");
    writeJson(join(cwd, ".forge.json"), {
      forgeMaster: { philosophy: "+ @baseline" },
    });

    const { block, sources } = loadPrinciples({ cwd });

    expect(block).toContain("Be nice.");
    expect(block).toContain("Vibe Coding Is a Trap");
    expect(block.indexOf("Be nice.")).toBeLessThan(block.indexOf("Vibe Coding Is a Trap"));
    expect(sources).toEqual([
      "docs/plans/PROJECT-PRINCIPLES.md",
      ".forge.json#forgeMaster.philosophy (append: @baseline)",
    ]);
  });

  it("appends UNIVERSAL_BASELINE on top of the baseline itself when no project principles exist", () => {
    writeJson(join(cwd, ".forge.json"), {
      forgeMaster: { philosophy: "+ @baseline" },
    });

    const { block } = loadPrinciples({ cwd });
    // UNIVERSAL_BASELINE is also the fallback "base" → block should contain
    // Scott-voice principles (no crash, no duplicate logic).
    expect(block).toContain(UNIVERSAL_BASELINE);
  });

  it('still appends literal text for non-"@baseline" "+ " usage', () => {
    writePrinciplesMd(cwd, "Project rules.");
    writeJson(join(cwd, ".forge.json"), {
      forgeMaster: { philosophy: "+ Custom extra rule." },
    });

    const { block } = loadPrinciples({ cwd });
    expect(block).toContain("Project rules.");
    expect(block).toContain("Custom extra rule.");
    expect(block).not.toContain("Vibe Coding Is a Trap");
  });
});
