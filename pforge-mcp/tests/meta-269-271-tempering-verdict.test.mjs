/**
 * Plan Forge — meta-bugs #271 and #269 (tempering false-green family).
 *
 * #271: `_runSpawnBasedScanner` called `loadAdapter(stack)` without awaiting an
 * async function. An unresolved Promise is always truthy, so the
 * SCANNER_UNAVAILABLE guard immediately below could never fire — callers got
 * `TypeError: adapter.unitTestCommand is not a function` instead of the
 * structured diagnostic written specifically to explain that failure.
 *
 * #269: `deriveOverallVerdict` ranked `pass` above `skipped`, so a run whose
 * unit AND integration scanners were both skipped (the consumer-repo default,
 * because the preset adapter is unreachable) reported `verdict: "pass"` off a
 * single passing cross-stack scanner — green for a codebase where zero tests ran.
 *
 * Only the verdict-semantics half of #269 is addressed here. The packaging half
 * (the typescript preset adapter being unreachable from an installed consumer
 * repo) is a separate change.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSingleScanner, deriveOverallVerdict } from "../tempering/runner.mjs";

describe("meta #271 — the SCANNER_UNAVAILABLE guard is reachable", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-271-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws a structured SCANNER_UNAVAILABLE error, not a TypeError", async () => {
    // An empty directory resolves to a stack with no adapter. Before the fix the
    // unresolved Promise sailed past the guard and died on adapter.unitTestCommand.
    let caught = null;
    try {
      await runSingleScanner("unit", { cwd: tempDir });
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught).not.toBeInstanceOf(TypeError);
    expect(caught.message).not.toMatch(/is not a function/);
    expect(caught.code).toBeTruthy();
    expect(caught.message).toMatch(/unavailable|does not provide/i);
  });
});

describe("meta #269 — a run that skipped its mandatory scanners cannot report pass", () => {
  it("returns skipped when unit and integration were both skipped", () => {
    const scanners = [
      { scanner: "unit", verdict: "skipped" },
      { scanner: "integration", verdict: "skipped" },
      { scanner: "flakiness", verdict: "pass" },
    ];
    expect(deriveOverallVerdict(scanners)).toBe("skipped");
  });

  it("still reports pass for legitimate partial adapter coverage", () => {
    // unit ran and passed; integration is skipped because this adapter has no
    // integration command. Something WAS measured, so this is not #269.
    const scanners = [
      { scanner: "unit", verdict: "pass" },
      { scanner: "integration", verdict: "skipped" },
    ];
    expect(deriveOverallVerdict(scanners)).toBe("pass");
  });

  it("still reports pass when the mandatory scanners actually ran", () => {
    const scanners = [
      { scanner: "unit", verdict: "pass" },
      { scanner: "integration", verdict: "pass" },
      { scanner: "flakiness", verdict: "pass" },
    ];
    expect(deriveOverallVerdict(scanners)).toBe("pass");
  });

  it("does not mask a worse verdict behind the downgrade", () => {
    expect(deriveOverallVerdict([
      { scanner: "unit", verdict: "skipped" },
      { scanner: "integration", verdict: "fail" },
    ])).toBe("fail");
    expect(deriveOverallVerdict([
      { scanner: "unit", verdict: "skipped" },
      { scanner: "integration", verdict: "error" },
    ])).toBe("error");
  });

  it("does not downgrade a run that never included a mandatory scanner", () => {
    // runSingleScanner('flakiness') must still be able to report pass.
    expect(deriveOverallVerdict([{ scanner: "flakiness", verdict: "pass" }])).toBe("pass");
  });

  it("preserves the existing precedence for entries with no scanner name", () => {
    expect(deriveOverallVerdict([{ verdict: "pass" }, { verdict: "fail" }])).toBe("fail");
    expect(deriveOverallVerdict([{ verdict: "error" }, { verdict: "pass" }])).toBe("error");
    expect(deriveOverallVerdict([{ verdict: "skipped" }])).toBe("skipped");
    expect(deriveOverallVerdict([])).toBe("skipped");
    expect(deriveOverallVerdict(null)).toBe("skipped");
  });
});
