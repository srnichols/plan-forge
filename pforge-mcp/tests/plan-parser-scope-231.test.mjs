// Meta-bug #231 regression guard:
// The plan parser silently dropped the Scope Contract when it was expressed
// as a Markdown table (yielding an empty inScope allowlist), failed to
// recognize the per-slice `**Scope (files):**` marker, and polluted a
// slice's editable scope with `**Context Files:**` reference docs. Together
// these let doc-only edits slip past scope enforcement (compounding #230).
import { describe, it, expect } from "vitest";
import { parseScopeContract, parseSlices } from "../orchestrator/plan-parser.mjs";

describe("plan-parser #231 — table-based Scope Contract", () => {
  const tableContract = [
    "# Phase-99-PLAN",
    "",
    "## Scope Contract",
    "",
    "| Category     | Files                                          |",
    "| ------------ | ---------------------------------------------- |",
    "| In Scope     | `apps/api/src/server.ts`, `apps/web/src/app.tsx` |",
    "| Out of Scope | `apps/api/legacy/**`                           |",
    "| Forbidden    | `.github/instructions/**`                      |",
    "",
    "## Slices",
  ];

  it("captures inScope paths from a table Scope Contract", () => {
    const contract = parseScopeContract(tableContract);
    expect(contract.inScope).toEqual([
      "apps/api/src/server.ts",
      "apps/web/src/app.tsx",
    ]);
  });

  it("captures outOfScope and forbidden rows without category collision", () => {
    const contract = parseScopeContract(tableContract);
    expect(contract.outOfScope).toEqual(["apps/api/legacy/**"]);
    expect(contract.forbidden).toEqual([".github/instructions/**"]);
  });

  it("still parses the classic header + bullet Scope Contract", () => {
    const lines = [
      "## Scope Contract",
      "",
      "### In Scope",
      "- `src/a.ts`",
      "",
      "### Out of Scope",
      "- `src/b.ts`",
      "",
      "### Forbidden",
      "- `secrets/**`",
    ];
    const contract = parseScopeContract(lines);
    expect(contract.inScope).toEqual(["`src/a.ts`"]);
    expect(contract.outOfScope).toEqual(["`src/b.ts`"]);
    expect(contract.forbidden).toEqual(["`secrets/**`"]);
  });

  it("ignores tables outside the Scope Contract section", () => {
    const lines = [
      "## Overview",
      "",
      "| Metric | In Scope value |",
      "| ------ | -------------- |",
      "| rows   | `should/not/leak.ts` |",
    ];
    const contract = parseScopeContract(lines);
    expect(contract.inScope).toEqual([]);
  });
});

describe("plan-parser #231 — per-slice scope marker", () => {
  it("recognizes the `**Scope (files):**` marker (colon inside bold)", () => {
    const lines = [
      "### Slice 1: Implement endpoint",
      "",
      "**Scope (files):** `apps/api/src/server.ts`",
      "",
      "1. Add the route handler.",
    ];
    const [slice] = parseSlices(lines);
    expect(slice.scope).toEqual(["apps/api/src/server.ts"]);
  });

  it("recognizes the `**Scope** (files in scope):` marker", () => {
    const lines = [
      "### Slice 2: Wire web",
      "",
      "**Scope** (files in scope): `apps/web/src/app.tsx`",
      "",
      "1. Render the page.",
    ];
    const [slice] = parseSlices(lines);
    expect(slice.scope).toEqual(["apps/web/src/app.tsx"]);
  });
});

describe("plan-parser #231 — Context Files do not pollute scope", () => {
  const lines = [
    "### Slice 1: Implement endpoint",
    "",
    "**Scope (files):** `apps/api/src/server.ts`",
    "",
    "**Context Files:** `.github/instructions/architecture-principles.instructions.md`, `docs/guide.md`",
    "",
    "1. Add the route handler.",
  ];

  it("keeps Context Files out of the editable scope allowlist", () => {
    const [slice] = parseSlices(lines);
    expect(slice.scope).toEqual(["apps/api/src/server.ts"]);
    expect(slice.scope).not.toContain(
      ".github/instructions/architecture-principles.instructions.md"
    );
  });

  it("records Context Files in a dedicated contextFiles field", () => {
    const [slice] = parseSlices(lines);
    expect(slice.contextFiles).toEqual([
      ".github/instructions/architecture-principles.instructions.md",
      "docs/guide.md",
    ]);
  });
});
