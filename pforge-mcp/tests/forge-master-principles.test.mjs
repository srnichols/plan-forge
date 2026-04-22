/**
 * Plan Forge — Forge-Master principles loader tests (Phase-32, Slice 3).
 *
 * Covers:
 *   (a) empty temp dir → UNIVERSAL_BASELINE returned
 *   (b) PROJECT-PRINCIPLES.md present → content included in block
 *   (c) .forge.json with philosophy: "Use X." → replaces file-based content
 *   (d) .forge.json with philosophy: "+ Use X." → appends to file-based content
 *   (e) mtime cache invalidation after file mutation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadPrinciples,
  UNIVERSAL_BASELINE,
  _clearCache,
} from "../../pforge-master/src/principles.mjs";

// ─── Helpers ────────────────────────────────────────────────────────

let tmpDir;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), "forge-master-principles-test-"));
}

function teardown() {
  rmSync(tmpDir, { recursive: true, force: true });
  _clearCache();
}

function writeProjectPrinciples(content) {
  const dir = join(tmpDir, "docs", "plans");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "PROJECT-PRINCIPLES.md"), content, "utf-8");
}

function writeCopilotInstructions(content) {
  const dir = join(tmpDir, ".github");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "copilot-instructions.md"), content, "utf-8");
}

function writeForgeJson(content) {
  writeFileSync(join(tmpDir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("principles loader", () => {
  beforeEach(() => { setup(); _clearCache(); });
  afterEach(() => teardown());

  // ── (a) No sources → universal baseline ──────────────────────────

  it("(a) returns UNIVERSAL_BASELINE when no source files exist", () => {
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toBe(UNIVERSAL_BASELINE);
    expect(result.sources).toContain("universal-baseline");
  });

  it("(a) universal baseline contains Architecture-First principle", () => {
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toContain("Architecture-First, Always");
  });

  it("(a) universal baseline contains all 10 principle names", () => {
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toContain("Vibe Coding Is a Trap");
    expect(result.block).toContain("Define What Shouldn't Be Built");
    expect(result.block).toContain("The Builder Must Never Review Its Own Work");
    expect(result.block).toContain("Slice Boundaries Are Non-Negotiable");
    expect(result.block).toContain("Enterprise Quality Is the Default");
    expect(result.block).toContain("Evidence Over Assumption");
    expect(result.block).toContain("When in Doubt, Say the Architectural Answer");
    expect(result.block).toContain("Work Triage Order");
    expect(result.block).toContain("Keep Gates Boring");
  });

  // ── (b) PROJECT-PRINCIPLES.md present ────────────────────────────

  it("(b) returns PROJECT-PRINCIPLES.md content when file is present", () => {
    writeProjectPrinciples("# My Principles\n\nBe concise. Be precise.");
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toContain("Be concise. Be precise.");
    expect(result.sources).toContain("docs/plans/PROJECT-PRINCIPLES.md");
  });

  it("(b) does NOT fall back to universal baseline when PROJECT-PRINCIPLES.md exists", () => {
    writeProjectPrinciples("Custom principles block.");
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).not.toBe(UNIVERSAL_BASELINE);
    expect(result.block).toContain("Custom principles block.");
  });

  it("(b) extracts Architecture Principles section from copilot-instructions.md when present", () => {
    writeCopilotInstructions(
      "# Instructions\n\n## Some Other Section\n\nIgnore me.\n\n## Architecture Principles\n\nAlways use interfaces.\n\n## Another Section\n\nAlso ignore.\n"
    );
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toContain("Always use interfaces.");
    expect(result.block).not.toContain("Ignore me.");
    expect(result.sources).toContain(".github/copilot-instructions.md (Architecture Principles)");
  });

  it("(b) PROJECT-PRINCIPLES.md takes precedence over copilot-instructions.md", () => {
    writeProjectPrinciples("Project-level principles.");
    writeCopilotInstructions("## Architecture Principles\n\nCopilot-level principles.\n");
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toContain("Project-level principles.");
    expect(result.block).not.toContain("Copilot-level principles.");
  });

  // ── (c) Replace semantics ─────────────────────────────────────────

  it("(c) .forge.json philosophy without '+ ' prefix replaces file-based content", () => {
    writeProjectPrinciples("File-based principles.");
    writeForgeJson({ forgeMaster: { philosophy: "Use X only. Simple rule." } });
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toBe("Use X only. Simple rule.");
    expect(result.block).not.toContain("File-based principles.");
    expect(result.sources).toContain(".forge.json#forgeMaster.philosophy");
  });

  it("(c) replace mode: only the philosophy source is listed, file sources are cleared", () => {
    writeProjectPrinciples("Some principles.");
    writeForgeJson({ forgeMaster: { philosophy: "Override everything." } });
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.sources).not.toContain("docs/plans/PROJECT-PRINCIPLES.md");
    expect(result.sources).toContain(".forge.json#forgeMaster.philosophy");
  });

  it("(c) replace mode works when no file-based sources exist", () => {
    writeForgeJson({ forgeMaster: { philosophy: "Standalone philosophy." } });
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toBe("Standalone philosophy.");
    expect(result.sources).toContain(".forge.json#forgeMaster.philosophy");
  });

  // ── (d) Append semantics ──────────────────────────────────────────

  it("(d) .forge.json philosophy with '+ ' prefix appends to file-based content", () => {
    writeProjectPrinciples("File-based principles.");
    writeForgeJson({ forgeMaster: { philosophy: "+ Also: never log PII." } });
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toContain("File-based principles.");
    expect(result.block).toContain("Also: never log PII.");
    expect(result.sources).toContain("docs/plans/PROJECT-PRINCIPLES.md");
    expect(result.sources).toContain(".forge.json#forgeMaster.philosophy (append)");
  });

  it("(d) append mode: separator is present between base and appended content", () => {
    writeProjectPrinciples("Base content.");
    writeForgeJson({ forgeMaster: { philosophy: "+ Appended content." } });
    const result = loadPrinciples({ cwd: tmpDir });
    const baseIdx = result.block.indexOf("Base content.");
    const appendIdx = result.block.indexOf("Appended content.");
    expect(baseIdx).toBeLessThan(appendIdx);
    expect(result.block).toContain("---");
  });

  it("(d) append mode with no file-based source uses UNIVERSAL_BASELINE as base", () => {
    writeForgeJson({ forgeMaster: { philosophy: "+ Additional rule." } });
    const result = loadPrinciples({ cwd: tmpDir });
    expect(result.block).toContain("Architecture-First, Always");
    expect(result.block).toContain("Additional rule.");
    expect(result.sources).toContain("universal-baseline");
    expect(result.sources).toContain(".forge.json#forgeMaster.philosophy (append)");
  });

  // ── (e) Cache invalidation ────────────────────────────────────────

  it("(e) returns cached result on repeated calls (same mtimes)", () => {
    writeProjectPrinciples("Original content.");
    const first = loadPrinciples({ cwd: tmpDir });
    const second = loadPrinciples({ cwd: tmpDir });
    expect(second.block).toBe(first.block);
    expect(second.block).toContain("Original content.");
  });

  it("(e) invalidates cache when PROJECT-PRINCIPLES.md is mutated", async () => {
    writeProjectPrinciples("Original content.");
    const first = loadPrinciples({ cwd: tmpDir });
    expect(first.block).toContain("Original content.");

    // Ensure mtime advances by waiting at least 10ms and re-writing
    await new Promise((r) => setTimeout(r, 20));
    writeProjectPrinciples("Updated content after mutation.");

    const second = loadPrinciples({ cwd: tmpDir });
    expect(second.block).toContain("Updated content after mutation.");
    expect(second.block).not.toContain("Original content.");
  });

  it("(e) invalidates cache when .forge.json philosophy is added after initial read", async () => {
    writeProjectPrinciples("Base principles.");
    const first = loadPrinciples({ cwd: tmpDir });
    expect(first.block).toContain("Base principles.");
    expect(first.block).not.toBe(UNIVERSAL_BASELINE);

    // Add .forge.json override (new file → mtime changes for forgeJsonPath)
    await new Promise((r) => setTimeout(r, 20));
    writeForgeJson({ forgeMaster: { philosophy: "New override." } });

    const second = loadPrinciples({ cwd: tmpDir });
    expect(second.block).toBe("New override.");
  });
});
