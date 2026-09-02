/**
 * Issue #260 part 1 — gate extraction treated every backticked span as a shell
 * command, and absorbed whatever fence followed the gate marker regardless of
 * language.
 *
 * Measured on Phase-148: 11 blocked-command errors, none of them real commands.
 * The four shapes below are that plan's, verbatim:
 *
 *   Slice 4   -> "/health"                 a URL path
 *   Slice 5   -> "url =", "datasource"     Prisma schema fragments
 *   Slice 6   -> "from '@prisma/client'"   an import specifier
 *   Slice 7.1 -> "migrate deploy"          prose naming a CLI verb
 *
 * Plus fence absorption: Slice 3's gate became a three-line vitest version
 * table and Slice 7's became two lines of TypeScript out of a ```ts block.
 * The author's only escapes were to drop backticks from prose or to accept
 * permanent false errors.
 *
 * Corpus measured before choosing the fence rule: across docs/plans, the fence
 * following a gate marker is `bash` 312 times and untagged once. Nothing else.
 * So restricting absorption to shell-tagged and untagged fences changes no
 * existing plan while removing the ```ts case entirely.
 */

import { describe, it, expect } from "vitest";
import { parseSlices } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

function slice(gateLine, extra = "") {
  return `# Phase 1 — TEST

## Slices

### Slice 1 — Example

**Scope** (files in scope):
- src/alpha.ts

${gateLine}
${extra}
`;
}

function parseOne(text) {
  const slices = parseSlices(text.split("\n"));
  expect(slices).toHaveLength(1);
  return slices[0];
}

describe("prose backticks on the gate line are not commands (#260)", () => {
  const prose = [
    ["a URL path", "**Validation Gate**: GET `/health` returns 200"],
    ["Prisma schema fragments", "**Validation Gate**: confirm `url =` is set under `datasource`"],
    ["an import specifier", "**Validation Gate**: no file imports `from '@prisma/client'`"],
    ["a CLI verb named in prose", "**Validation Gate**: the deploy step runs `migrate deploy`"],
  ];

  for (const [label, gateLine] of prose) {
    it(`does not turn ${label} into a gate command`, () => {
      const s = parseOne(slice(gateLine));
      expect(s.validationGate ?? "").toBe("");
      expect(s.validationGateDescription).toBeTruthy();
    });

    it(`produces no blocked-command error for ${label}`, () => {
      const s = parseOne(slice(gateLine));
      const result = lintGateCommands({ slices: [s] });
      const blocked = result.errors.filter((e) => e.rule === "blocked-command");
      expect(blocked.map((e) => e.command)).toEqual([]);
    });
  }

  it("still treats a real inline command as the gate", () => {
    const s = parseOne(slice("**Validation Gate**: `npm test`"));
    expect(s.validationGate).toBe("npm test");
  });

  it("keeps the runnable span and drops the prose one when both appear", () => {
    const s = parseOne(slice("**Validation Gate**: run `npm test`, then GET `/health`"));
    expect(s.validationGate).toBe("npm test");
  });

  it("leaves a gate line with no backticks as a description, as before", () => {
    const s = parseOne(slice("**Validation Gate**: the suite is green"));
    expect(s.validationGateDescription).toBe("the suite is green");
    expect(s.validationGate ?? "").toBe("");
  });
});

describe("only shell fences are absorbed as the gate (#260)", () => {
  it("does not absorb an illustrative ```ts block", () => {
    const s = parseOne(slice("**Validation Gate**:", [
      "```ts",
      "export const x: number = 1;",
      "const y = x + 1;",
      "```",
    ].join("\n")));
    expect(s.validationGate ?? "").not.toMatch(/export const/);
  });

  it("does not absorb an illustrative version table in a ```text block", () => {
    const s = parseOne(slice("**Validation Gate**:", [
      "```text",
      "vitest   3.2.4",
      "prisma   7.0.1",
      "node     24.11.1",
      "```",
    ].join("\n")));
    expect(s.validationGate ?? "").not.toMatch(/vitest\s+3\.2\.4/);
  });

  it("still lands the shell fence that follows a skipped non-shell fence", () => {
    const s = parseOne(slice("**Validation Gate**:", [
      "```ts",
      "export const x = 1;",
      "```",
      "",
      "```bash",
      "npm test",
      "```",
    ].join("\n")));
    expect(s.validationGate).toBe("npm test");
  });

  it("still absorbs an untagged fence — the pre-tagging gate form", () => {
    const s = parseOne(slice("**Validation Gate**:", ["```", "npm test", "```"].join("\n")));
    expect(s.validationGate).toBe("npm test");
  });

  it("absorbs a powershell fence", () => {
    const s = parseOne(slice("**Validation Gate**:", ["```powershell", "Test-Path src/alpha.ts", "```"].join("\n")));
    expect(s.validationGate).toBe("Test-Path src/alpha.ts");
  });

  it("absorbs the ordinary bash fence — 312 of 313 real gates", () => {
    const s = parseOne(slice("**Validation Gate**:", ["```bash", "npm test", "```"].join("\n")));
    expect(s.validationGate).toBe("npm test");
  });
});

describe("the Phase-148 slice shapes lint clean end to end (#260)", () => {
  it("prose on the marker line plus a real fenced gate yields no errors", () => {
    const s = parseOne(slice("**Validation Gate**: GET `/health` returns 200 and no file imports `from '@prisma/client'`", [
      "```bash",
      "npm test",
      "```",
    ].join("\n")));
    expect(s.validationGate).toBe("npm test");
    const result = lintGateCommands({ slices: [s] });
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
