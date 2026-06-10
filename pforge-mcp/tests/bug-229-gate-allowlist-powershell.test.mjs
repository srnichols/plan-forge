import { describe, it, expect } from "vitest";
import { lintGateCommands, isGateCommandAllowed } from "../orchestrator.mjs";
import { resolveGateCommandToken, isGatePrefixAllowed } from "../orchestrator/constants.mjs";

/**
 * Issue #229 — the gate-lint allowlist rejected the exact Windows-portable
 * gate forms the Plan Hardener itself emits: PowerShell `$var = ...`
 * assignments, `Test-Path`, and `pnpm`. A correctly-hardened plan could not
 * be executed via the orchestrator on a PowerShell host.
 */

function makePlan(validationGate, sliceNumber = "1") {
  return { slices: [{ number: sliceNumber, title: "Test Slice", validationGate }] };
}

function blockedFindings(result) {
  return [...result.errors, ...result.warnings].filter(f => f.rule === "blocked-command");
}

describe("resolveGateCommandToken — skips leading assignments (#229)", () => {
  it("skips POSIX env-var assignment", () => {
    expect(resolveGateCommandToken("NODE_ENV=test npm test")).toBe("npm");
  });

  it("skips a spaced PowerShell variable assignment", () => {
    expect(resolveGateCommandToken("$p = Get-Content foo.ts")).toBe("get-content");
  });

  it("skips a non-spaced PowerShell variable assignment", () => {
    expect(resolveGateCommandToken("$p=Get-Content foo.ts")).toBe("get-content");
  });

  it("returns the bare command token when there is no assignment", () => {
    expect(resolveGateCommandToken("Test-Path -LiteralPath x")).toBe("test-path");
  });
});

describe("isGatePrefixAllowed — newly allowed gate forms (#229)", () => {
  it("allows Test-Path", () => {
    expect(isGatePrefixAllowed(resolveGateCommandToken("Test-Path -LiteralPath x"))).toBe(true);
  });

  it("allows pnpm", () => {
    expect(isGatePrefixAllowed(resolveGateCommandToken("pnpm --filter web exec tsc"))).toBe(true);
  });

  it("allows the RHS cmdlet of a PowerShell assignment", () => {
    expect(isGatePrefixAllowed(resolveGateCommandToken("$p = Get-Content foo.ts"))).toBe(true);
  });
});

describe("isGateCommandAllowed — PowerShell-hardened gates (#229)", () => {
  it("permits a $var = Get-Content gate", () => {
    expect(isGateCommandAllowed("$p = Get-Content apps/web/page.tsx")).toBe(true);
  });

  it("permits a Test-Path gate", () => {
    expect(isGateCommandAllowed("Test-Path -LiteralPath apps/web/page.tsx")).toBe(true);
  });

  it("permits a pnpm exec gate", () => {
    expect(isGateCommandAllowed("pnpm --filter web exec tsc --noEmit")).toBe(true);
  });

  it("still blocks a dangerous RHS cmdlet (not on the allowlist)", () => {
    expect(isGateCommandAllowed("$x = Remove-Item -Recurse -Force build")).toBe(false);
  });

  it("still blocks rm -rf / regardless of an assignment prefix", () => {
    expect(isGateCommandAllowed("$x = rm -rf /")).toBe(false);
  });
});

describe("lintGateCommands — no false blocked-command for PS gates (#229)", () => {
  it("does not flag $var = Get-Content / Test-Path / pnpm gates", () => {
    const gate = [
      "$p = Get-Content apps/web/src/app/page.tsx -Raw",
      "Test-Path -LiteralPath apps/web/src/app/account/page.tsx",
      "pnpm --filter web exec tsc --noEmit",
    ].join("\n");
    const result = lintGateCommands(makePlan(gate));
    expect(blockedFindings(result)).toHaveLength(0);
  });

  it("still flags a genuinely unknown command", () => {
    const result = lintGateCommands(makePlan("frobnicate --all"));
    expect(blockedFindings(result).length).toBeGreaterThan(0);
  });
});
