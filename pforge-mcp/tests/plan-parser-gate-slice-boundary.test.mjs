/**
 * A gate marker arms fence capture for its own slice only.
 *
 * Found while fixing meta-bugs #281/#285: after an inline gate
 * (`**Validation Gate**: \`npm test\``) or a prose-only gate, the parser left
 * `inValidationGate` armed across the next slice heading. The next slice's
 * first shell fence — typically an illustrative example inside its tasks —
 * became part of THAT slice's executed gate, e.g. `rm -rf build` running as a
 * gate command.
 */

import { describe, it, expect } from "vitest";
import { computeLockHash, parseSlices } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

const parse = (lines) => parseSlices(lines.join("\n").split("\n"));

function twoSlicePlan({ sliceOneGate, example = "rm -rf build", sliceTwoGate = ["**Validation Gate**:", "```bash", "npm run lint", "```"] }) {
  return [
    "## Execution Slices",
    "",
    "### Slice 1 — Build",
    "1. Build it.",
    sliceOneGate,
    "",
    "### Slice 2 — Lint",
    "1. Clean the output first, for example:",
    "```bash",
    example,
    "```",
    ...sliceTwoGate,
    "",
  ];
}

describe("gate capture stops at the slice boundary", () => {
  it("does not append the next slice's example fence to its gate after an inline gate", () => {
    const [one, two] = parse(twoSlicePlan({ sliceOneGate: "**Validation Gate**: `npm test`" }));
    expect(one.validationGate).toBe("npm test");
    expect(two.validationGate).toBe("npm run lint");
  });

  it("does not turn the next slice's example into a gate after a prose-only gate", () => {
    const [one, two] = parse(twoSlicePlan({ sliceOneGate: "**Validation Gate**: all builds pass", sliceTwoGate: [] }));
    expect(one.validationGate ?? null).toBeNull();
    expect(two.validationGate ?? null).toBeNull();
    const lint = lintGateCommands({ slices: [one, two] });
    expect(lint.errors.filter((e) => e.rule === "gate-declared-not-runnable").map((e) => e.slice)).toEqual(["1"]);
  });

  it("does not arm a fence after the last slice's plan-level heading", () => {
    const slices = parse([
      "### Slice 1 — Build",
      "1. Build it.",
      "**Validation Gate**: all builds pass",
      "",
      "## Definition of Done",
      "```bash",
      "rm -rf build",
      "```",
    ]);
    expect(slices).toHaveLength(1);
    expect(slices[0].validationGate ?? null).toBeNull();
  });

  it("keeps an illustrative example outside the lock hash", () => {
    const base = computeLockHash(twoSlicePlan({ sliceOneGate: "**Validation Gate**: `npm test`" }).join("\n"));
    const edited = computeLockHash(twoSlicePlan({ sliceOneGate: "**Validation Gate**: `npm test`", example: "rm -rf dist" }).join("\n"));
    expect(edited).toBe(base);
  });

  it("still captures a slice's own fence after a prose gate marker", () => {
    const [one] = parse([
      "### Slice 1 — Build",
      "1. Build it.",
      "**Validation Gate**: GET `/health` returns 200",
      "```bash",
      "npm test",
      "```",
    ]);
    expect(one.validationGate).toBe("npm test");
  });
});
