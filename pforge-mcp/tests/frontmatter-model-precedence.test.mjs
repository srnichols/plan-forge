/**
 * frontmatter-model-precedence.test.mjs — Bug #127: Frontmatter model: precedence + resolution log
 *
 * Verifies:
 *   (a) options.model wins over frontmatter model:
 *   (b) frontmatter model: wins over .forge.json modelRouting.default
 *   (c) .forge.json modelRouting.default wins when frontmatter absent
 *   (d) all empty → effectiveModel === null, source "default"
 *   (e) frontmatter model: 123 (non-string YAML) is ignored AND console.warn observed
 *   (f) [model] resolved=... log line emitted with correct source tag in (a)–(d)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parsePlan, runPlan } from "../orchestrator.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "pforge-fm-model-"));
}

/**
 * Write a minimal single-slice plan. Pass `modelLine` to inject a `model:` frontmatter entry.
 * crucibleId is always included so the Crucible gate passes via manualImport.
 */
function writePlan(dir, { modelLine = "", name = "plan.md" } = {}) {
  const fm = modelLine
    ? `---\ncrucibleId: fm-model-test\n${modelLine}\n---\n`
    : `---\ncrucibleId: fm-model-test\n---\n`;
  const content = fm + "# FM Model Test Plan\n\n### Slice 1: Only Slice\n\nTask.\n";
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

/** Extract the first [model] resolved= log line from console.error spy calls. */
function findModelLogLine(errSpy) {
  return errSpy.mock.calls
    .map((args) => (typeof args[0] === "string" ? args[0] : ""))
    .find((msg) => msg.startsWith("[model] resolved=")) ?? null;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Bug #127 — frontmatter model: precedence + resolution log", () => {
  let tmpDir;
  let errSpy;
  let warnSpy;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── (a) options.model wins over frontmatter ────────────────────────────────

  it("(a) options.model wins over frontmatter model:", async () => {
    const planPath = writePlan(tmpDir, { modelLine: "model: gpt-4o" });

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      model: "claude-opus-4.6",
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });

    expect(result.status).not.toBe("error");

    const line = findModelLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("resolved=claude-opus-4.6");
    expect(line).toContain("source=options");
  });

  // ── (b) frontmatter wins over .forge.json modelRouting.default ─────────────

  it("(b) frontmatter model: wins over .forge.json modelRouting.default", async () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ modelRouting: { default: "gpt-4o" } }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir, { modelLine: "model: claude-opus-4.7" });

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });

    expect(result.status).not.toBe("error");

    const line = findModelLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("resolved=claude-opus-4.7");
    expect(line).toContain("source=frontmatter");
  });

  // ── (c) .forge.json wins when frontmatter absent ───────────────────────────

  it("(c) .forge.json modelRouting.default wins when frontmatter model: absent", async () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ modelRouting: { default: "gpt-4o" } }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir); // no model: in frontmatter

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });

    expect(result.status).not.toBe("error");

    const line = findModelLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("resolved=gpt-4o");
    expect(line).toContain("source=config");
  });

  // ── (d) all empty → effectiveModel=null, source=default ───────────────────

  it("(d) all empty (no options.model, no frontmatter, empty modelRouting) → null, source=default", async () => {
    // Set .forge.json with empty modelRouting so no default is set
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ modelRouting: {} }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir); // no model: in frontmatter

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });

    expect(result.status).not.toBe("error");

    const line = findModelLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("resolved=null");
    expect(line).toContain("source=default");
  });

  // ── (e) frontmatter model: 123 is ignored, console.warn observed ───────────

  it("(e) frontmatter model: 123 (non-string YAML) is ignored, console.warn emitted", () => {
    const planPath = writePlan(tmpDir, { modelLine: "model: 123" });

    const result = parsePlan(planPath, tmpDir);

    // Non-string value must not be assigned
    expect(result.meta.model).toBeUndefined();

    // console.warn must have been called with the expected message
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = warnSpy.mock.calls
      .map((args) => (typeof args[0] === "string" ? args[0] : ""))
      .find((msg) => msg.includes("[model] frontmatter model: ignored"));
    expect(warnMsg).toBeTruthy();
  });

  // ── (f) [model] resolved= log line source tags ─────────────────────────────

  it("(f-a) [model] log line source=options when options.model set", async () => {
    const planPath = writePlan(tmpDir, { modelLine: "model: some-model" });
    await runPlan(planPath, {
      cwd: tmpDir,
      model: "override-model",
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });
    const line = findModelLogLine(errSpy);
    expect(line).toMatch(/source=options/);
  });

  it("(f-b) [model] log line source=frontmatter when only frontmatter model set", async () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ modelRouting: {} }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir, { modelLine: "model: fm-only-model" });
    await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });
    const line = findModelLogLine(errSpy);
    expect(line).toMatch(/source=frontmatter/);
  });

  it("(f-c) [model] log line source=config when only .forge.json default set", async () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ modelRouting: { default: "config-model" } }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir);
    await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });
    const line = findModelLogLine(errSpy);
    expect(line).toMatch(/source=config/);
  });

  it("(f-d) [model] log line source=default when all sources empty", async () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ modelRouting: {} }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir);
    await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      noTempering: true,
      quorum: false,
      dryRun: true,
    });
    const line = findModelLogLine(errSpy);
    expect(line).toMatch(/source=default/);
  });
});
