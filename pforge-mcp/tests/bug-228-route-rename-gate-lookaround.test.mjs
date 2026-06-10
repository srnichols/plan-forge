import { describe, it, expect } from "vitest";
import { lintGateCommands } from "../orchestrator.mjs";

/**
 * Issue #228 — route-rename count gates over-matched. The WEBROUTE_COUNT gate
 * used a negated-lookbehind regex `(?<!/v1)/campaigns` expecting 0, but the
 * default grep/ripgrep engine cannot evaluate look-around, so the count
 * silently reads wrong (a false pass) while the broad `/campaigns` substring
 * also catches legitimate component/lib imports and non-route API paths.
 *
 * The fix adds a `lookaround-unsupported` lint rule that flags any
 * grep/ripgrep gate using look-around without an explicit `-P` (PCRE) flag.
 */

function makePlan(validationGate, sliceNumber = "1") {
  return { slices: [{ number: sliceNumber, title: "Route rename", validationGate }] };
}

function lookaroundFindings(result) {
  return [...result.errors, ...result.warnings].filter(f => f.rule === "lookaround-unsupported");
}

describe("lookaround-unsupported lint rule (#228)", () => {
  it("flags a negated-lookbehind ripgrep count gate", () => {
    const result = lintGateCommands(makePlan('rg -c "(?<!/v1)/campaigns" src'));
    expect(lookaroundFindings(result).length).toBe(1);
  });

  it("flags a negated-lookbehind grep count gate", () => {
    const result = lintGateCommands(makePlan('grep -rc "(?<!/v1)/campaigns" src'));
    expect(lookaroundFindings(result).length).toBe(1);
  });

  it("flags a lookahead pattern too", () => {
    const result = lintGateCommands(makePlan('grep -c "/campaigns(?=/edit)" src'));
    expect(lookaroundFindings(result).length).toBe(1);
  });

  it("does NOT flag the same look-around when -P (PCRE) is passed", () => {
    const result = lintGateCommands(makePlan('grep -P -c "(?<!/v1)/campaigns" src'));
    expect(lookaroundFindings(result).length).toBe(0);
  });

  it("does NOT flag a look-around-free literal navigation gate", () => {
    const result = lintGateCommands(makePlan('grep -rc "href=./campaigns" src'));
    expect(lookaroundFindings(result).length).toBe(0);
  });

  it("does NOT flag look-around outside grep/ripgrep (node -e regex)", () => {
    const result = lintGateCommands(
      makePlan('node -e "const s=require(\'fs\').readFileSync(\'f\',\'utf8\'); if(/(?<!\\/v1)\\/campaigns/.test(s)){process.exit(1)}"'),
    );
    expect(lookaroundFindings(result).length).toBe(0);
  });
});
