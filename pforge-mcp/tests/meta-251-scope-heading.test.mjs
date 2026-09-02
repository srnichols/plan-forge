/**
 * Plan Forge — meta-bug #251: a prose bullet "- **Scope violation** — ..." was
 * parsed as a scope declaration, so every following bullet was collected as
 * scope. Because a slice body ran to the next "### Slice" header — and therefore
 * to EOF on the last slice — the plan-level "## Stop Conditions" section was
 * swallowed, and paths the plan listed under Forbidden Actions were added to the
 * last slice's scope. Scope is an allowlist in auto mode, so the final slice was
 * authorized to edit the money path the plan explicitly forbids.
 *
 * Two independent causes, both fixed here:
 *   (a) the bold-heading regex accepted any bold span starting "files"/"scope"
 *   (b) nothing terminated a slice body at a plan-level heading
 *
 * Corpus-driven: across docs/plans the legitimate declaration forms are
 * **Files** (143), **Files in scope** (43), **Scope** (48); the prose
 * false-positives are **Scope violation**, **Scope drift** (x2),
 * **Scope drift / content quality**, **Scope clarification by cost path:**.
 * Note the last one carries a colon INSIDE the bold span — so a colon-based
 * rule does not separate these. The separator is the vocabulary.
 */

import { describe, it, expect } from "vitest";
import { parseSlices } from "../orchestrator/plan-parser.mjs";

function parseOne(lines) {
  const slices = parseSlices(lines.join("\n").split("\n"));
  return slices[slices.length - 1];
}

describe("meta #251 — prose bold spans are not scope declarations", () => {
  it("(a) does not collect Stop Conditions bullets into the last slice's scope", () => {
    const slice = parseOne([
      "### Slice 9: Final slice",
      "**Files**: `src/a.ts`, `src/b.ts`",
      "",
      "## Stop Conditions",
      "- **Scope violation** — halt immediately",
      "- `checkout/`",
      "- `orders/`",
      "- `payouts/`",
    ]);
    expect(slice.scope).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it.each([
    ["**Scope violation** — halt immediately"],
    ["**Scope drift** — reassess the plan"],
    ["**Scope drift / content quality** — escalate"],
    ["**Scope clarification by cost path:** see appendix"],
  ])("(a) rejects the prose bold span %s", (bullet) => {
    const slice = parseOne([
      "### Slice 1: Only slice",
      "**Files**: `src/a.ts`",
      "",
      `- ${bullet}`,
      "- `forbidden/path.ts`",
    ]);
    expect(slice.scope).toEqual(["src/a.ts"]);
  });

  it.each([
    ["**Files**: `src/a.ts`", ["src/a.ts"]],
    ["**Scope**: `src/a.ts`", ["src/a.ts"]],
    ["**Files in scope**: `src/a.ts`", ["src/a.ts"]],
    ["**Scope (files):** `src/a.ts`", ["src/a.ts"]],
    ["**Scope** (files in scope): `src/a.ts`", ["src/a.ts"]],
  ])("still accepts the declaration form %s", (heading, expected) => {
    const slice = parseOne(["### Slice 1: Only slice", heading]);
    expect(slice.scope).toEqual(expected);
  });

  it("still collects bullet-list scope under a bare declaration heading", () => {
    const slice = parseOne([
      "### Slice 1: Only slice",
      "**Files in scope**:",
      "- `src/a.ts`",
      "- `src/b.ts`",
    ]);
    expect(slice.scope).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("(b) terminates the slice body at a plan-level heading", () => {
    const slice = parseOne([
      "### Slice 1: Only slice",
      "**Files**: `src/a.ts`",
      "**Stop Condition**: real slice stop condition",
      "",
      "## Stop Conditions",
      "**Stop Condition**: plan-level text that belongs to no slice",
      "**Depends On**: Slice 7",
    ]);
    expect(slice.stopCondition).toBe("real slice stop condition");
    expect(slice.depends).toEqual([]);
  });

  it("(b) does not terminate on a deeper sub-heading inside a slice body", () => {
    const slice = parseOne([
      "### Slice 1: Only slice",
      "#### Implementation notes",
      "**Files**: `src/a.ts`",
    ]);
    expect(slice.scope).toEqual(["src/a.ts"]);
  });
});
