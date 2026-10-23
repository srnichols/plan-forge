import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyByRules, MANUAL_SCANNER } from "../tempering/bug-classifier.mjs";
import { deriveBugType, resolveRoute } from "../tempering/agent-router.mjs";
import { loadBug } from "../tempering/bug-registry.mjs";
import { TOOLS } from "../server/tool-definitions.mjs";
import {
  _callToolHandler_036_forge_bug_register,
  _callToolHandler_039_forge_bug_validate_fix,
  buildBugFixSkillAdvisory,
} from "../server/tool-handlers/tempering.mjs";

/**
 * Meta-bug #328 — forge_bug_register accepted only automated scanner names, so
 * Slice 7 of the Forge-Claw plan had its `/bug` command file operator reports
 * as scanner "contract", the least wrong legal value. That sent a person's
 * report to the api-contracts analyst, showed contract-scanner advice while
 * fixing it, and would have re-run the contract scanner to "validate" it.
 * A person's report now has its own scanner value, "manual", and a defined
 * path through the bug lifecycle.
 */

const AUTOMATED_SCANNERS = [
  "unit", "integration", "ui-playwright", "visual-diff", "flakiness",
  "mutation", "load-stress", "contract", "performance-budget",
];

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-328-"));
  dirs.push(dir);
  return dir;
};

const call = async (handler, name, args) => {
  const response = await handler({ params: { name } }, args);
  return { isError: response.isError === true, body: JSON.parse(response.content[0].text) };
};

const operatorReport = {
  testName: "operator-report",
  assertionMessage: "The bot said 'saved' but no note was written",
  reportedVia: "pforge-claw",
};

describe("the scanner list (#328)", () => {
  const registerTool = TOOLS.find((tool) => tool.name === "forge_bug_register");
  const scanner = registerTool.inputSchema.properties.scanner;

  it("accepts a manual report as a scanner value", () => {
    expect(MANUAL_SCANNER).toBe("manual");
    expect(scanner.enum).toContain(MANUAL_SCANNER);
  });

  it("keeps every automated scanner", () => {
    expect(scanner.enum).toEqual(expect.arrayContaining(AUTOMATED_SCANNERS));
    expect(scanner.enum).toHaveLength(AUTOMATED_SCANNERS.length + 1);
  });

  it("says what a manual report is and that no scanner can re-run it", () => {
    expect(scanner.description).toMatch(/person|human|operator/i);
    expect(scanner.description).toMatch(/manual/);
  });
});

describe("classifying a manual report (#328)", () => {
  it("takes a person's report as a real bug", () => {
    const result = classifyByRules({ scanner: MANUAL_SCANNER, evidence: operatorReport });
    expect(result).toMatchObject({ classification: "real-bug", rule: "manual-report", source: "rule" });
  });

  it("does not let a stack trace through test code turn the report into infra noise", () => {
    const result = classifyByRules({
      scanner: MANUAL_SCANNER,
      evidence: { ...operatorReport, stackTrace: "at Object.<anonymous> (tests/notes.test.js:12:5)" },
    });
    expect(result.classification).toBe("real-bug");
  });

  it("leaves the automated scanners to their own rules", () => {
    const infra = classifyByRules({
      scanner: "unit",
      evidence: { testName: "x", stackTrace: "at Object.<anonymous> (tests/notes.test.js:12:5)" },
    });
    expect(infra.classification).toBe("infra");
    expect(classifyByRules({ scanner: "unit", evidence: operatorReport })).toBeNull();
  });
});

describe("routing a manual report (#328)", () => {
  it("never hands a person's report to an analyst agent", () => {
    expect(deriveBugType({ scanner: MANUAL_SCANNER })).toBeNull();
    expect(resolveRoute({ scanner: MANUAL_SCANNER, severity: "critical" })).toBeNull();
  });

  it("is the difference from the old workaround, which reached the api-contracts agent", () => {
    expect(resolveRoute({ scanner: "contract", severity: "critical" })).toMatchObject({ agent: "api-contracts" });
  });

  it("gives the generic fix advice, not the contract scanner's", () => {
    const advice = buildBugFixSkillAdvisory({ stage: "in-fix", bug: { scanner: MANUAL_SCANNER, classification: "real-bug" } });
    expect(advice).toMatch(/code-review/);
    expect(advice).not.toMatch(/contract/i);
  });
});

describe("registering and validating a manual report (#328)", () => {
  let cwd;
  beforeEach(() => { cwd = project(); });

  const register = (overrides = {}) => call(_callToolHandler_036_forge_bug_register, "forge_bug_register", {
    path: cwd, scanner: MANUAL_SCANNER, severity: "medium", evidence: operatorReport,
    reproSteps: ["Ask the bot to save a note", "List the notes"], ...overrides,
  });

  it("registers it as a real bug, with the scanner recorded as manual", async () => {
    const { isError, body } = await register();
    expect(isError).toBe(false);
    expect(body).toMatchObject({ ok: true, classification: "real-bug" });
    const bug = loadBug(cwd, body.bugId);
    expect(bug).toMatchObject({ scanner: MANUAL_SCANNER, status: "open", classification: "real-bug" });
    expect(bug.evidence.reportedVia).toBe("pforge-claw");
  });

  it("does not ask a scanner to re-run it: validation says to verify by hand", async () => {
    const { body: registered } = await register();
    const { isError, body } = await call(_callToolHandler_039_forge_bug_validate_fix, "forge_bug_validate_fix", { path: cwd, bugId: registered.bugId });
    expect(isError).toBe(false);
    expect(body.verdict).toBe("manual-verification-required");
    expect(body.message).toMatch(/forge_bug_update_status/);
    expect(body.message).toMatch(/scannerOverride/);
    expect(body.error).toBeUndefined();
  });

  it("leaves the bug open and records no validation attempt", async () => {
    const { body: registered } = await register();
    await call(_callToolHandler_039_forge_bug_validate_fix, "forge_bug_validate_fix", { path: cwd, bugId: registered.bugId });
    const bug = loadBug(cwd, registered.bugId);
    expect(bug.status).toBe("open");
    expect(bug.validationAttempts ?? []).toEqual([]);
  });

  it("still runs the scanner the caller names for it", async () => {
    const { body: registered } = await register();
    const { isError, body } = await call(_callToolHandler_039_forge_bug_validate_fix, "forge_bug_validate_fix", {
      path: cwd, bugId: registered.bugId, scannerOverride: ["no-such-scanner"],
    });
    expect(isError).toBe(true);
    expect(body.error).toBe("SCANNER_UNAVAILABLE");
    expect(body.scanner).toBe("no-such-scanner");
  });

  it("writes the bug under .forge/bugs and nowhere else in the project", async () => {
    await register();
    expect(readdirSync(join(cwd, ".forge", "bugs")).filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(existsSync(join(cwd, "docs"))).toBe(false);
  });
});
