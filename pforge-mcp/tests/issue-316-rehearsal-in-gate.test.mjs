/**
 * Issue #316 — Phase-UPDATE-CORE slice 6 gated on
 * `node scripts/release/rehearse.mjs --release-ref HEAD`. On planning/main,
 * VERSION is always X.Y.Z-dev between releases, and rehearse.mjs refuses a
 * -dev ref by design (pforge update refuses -dev sources), so the gate could
 * never pass. Release rehearsal belongs in the release checklist, run on the
 * release commit; flag it when a plan puts it in a slice gate.
 */

import { describe, it, expect } from "vitest";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

function rulesFor(command) {
  const r = lintGateCommands({ slices: [{ number: "1", validationGate: command }] });
  return [...r.errors, ...r.warnings].map((f) => f.rule);
}

describe("release rehearsal in a slice gate (#316)", () => {
  it("warns on rehearse.mjs", () => {
    expect(rulesFor("node scripts/release/rehearse.mjs --release-ref HEAD --previous-tag v3.29.0")).toContain("release-rehearsal-in-gate");
  });

  it("warns on Windows-style paths too", () => {
    expect(rulesFor("node scripts\\release\\rehearse.mjs --release-ref HEAD")).toContain("release-rehearsal-in-gate");
  });

  it("does not warn on other release scripts or plain mentions", () => {
    expect(rulesFor("node scripts/release/verify-public.mjs --expected-version 3.30.0")).not.toContain("release-rehearsal-in-gate");
    expect(rulesFor("npx vitest run pforge-mcp/tests/rehearse-helpers.test.mjs")).not.toContain("release-rehearsal-in-gate");
  });

  it("explains where rehearsal belongs", () => {
    const r = lintGateCommands({ slices: [{ number: "6", validationGate: "node scripts/release/rehearse.mjs --release-ref HEAD" }] });
    const finding = r.warnings.find((f) => f.rule === "release-rehearsal-in-gate");
    expect(finding.severity).toBe("warn");
    expect(finding.message).toMatch(/-dev/);
    expect(finding.message).toMatch(/release checklist/i);
  });
});
