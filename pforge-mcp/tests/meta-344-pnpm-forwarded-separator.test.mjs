import { describe, it, expect } from "vitest";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

/**
 * Meta-bug #344 — a plan gate `pnpm run test -- <six oracle files>` forwarded a
 * literal `--` to Vitest. Vitest's CLI moves everything after `--` into
 * pass-through options, so the file names stopped being filters and the whole
 * unit project was collected; the unrelated broad run then timed out on one test
 * before any source edit.
 *
 * Shipped as a mechanical rule because the form is version-independent and
 * textually exact, and it flags none of the gate lines in this repository's
 * plans (none of them use pnpm).
 */

const RULE = "pnpm-forwarded-separator";

function lintGate(command) {
  return lintGateCommands({ slices: [{ number: "1", validationGate: command }] });
}

const rulesFor = (command) => {
  const result = lintGate(command);
  return [...result.errors, ...result.warnings].map((finding) => finding.rule);
};

describe("pnpm <test script> -- <files> forwards the separator (#344)", () => {
  it.each([
    "pnpm run test -- tests/a.test.ts tests/b.test.ts",
    "pnpm test -- tests/a.test.ts",
    "pnpm run test:unit -- tests/a.test.ts",
    "pnpm --filter @acme/api run test -- tests/a.test.ts",
    "pnpm -F @acme/api test -- --run",
  ])("warns on %s", (command) => {
    expect(rulesFor(command)).toContain(RULE);
  });

  it("names the behaviour and the fix in the message", () => {
    const finding = lintGate("pnpm run test -- tests/a.test.ts").warnings.find((warning) => warning.rule === RULE);
    expect(finding.message).toMatch(/literal '--'/);
    expect(finding.message).toMatch(/pnpm exec vitest run/);
  });

  it.each([
    "pnpm exec vitest run tests/a.test.ts tests/b.test.ts",
    "pnpm run test",
    "pnpm test",
    "pnpm run build -- --mode production",
    "npm test -- tests/a.test.ts",
    "npx vitest run tests/a.test.ts",
  ])("does not warn on %s", (command) => {
    expect(rulesFor(command)).not.toContain(RULE);
  });
});
