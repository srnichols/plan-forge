import { describe, it, expect } from "vitest";
import {
  isDeletionSliceTitle,
  parseNameStatus,
  detectDeletionInversion,
} from "../orchestrator/git-safety.mjs";

/**
 * Issue #227 — the auto-executor committed the inverse of a deletion slice.
 * Phase-86 Slice 12 ("Delete redundant emoji donate page") was a pure-deletion
 * slice, but the worker commit RE-ADDED `donate/page.tsx` (+578) and
 * `donate/layout.tsx` (+30) while the commit message still claimed deletion.
 * The slice's own grep/Test-Path gate did not catch the inversion; it was only
 * detected later by a downstream phase's precondition.
 *
 * The fix adds a deletion-inversion detector: a slice whose title declares a
 * deletion but whose commit ADDS its declared target files is flagged and the
 * slice is failed so the rollback machinery restores the deleted state.
 */

function makeDeletionSlice(declaredPaths, title = "Delete redundant emoji donate page") {
  const rows = declaredPaths.map(p => `| ${p} | removed |`).join("\n");
  return {
    number: "12",
    title,
    rawLines: [
      "**Files Modified (Exhaustive)**:",
      "| File | Change |",
      "| --- | --- |",
      ...rows.split("\n"),
    ],
  };
}

describe("isDeletionSliceTitle (#227)", () => {
  it("matches a leading deletion verb", () => {
    expect(isDeletionSliceTitle("Delete redundant emoji donate page")).toBe(true);
    expect(isDeletionSliceTitle("Remove legacy donate flow")).toBe(true);
    expect(isDeletionSliceTitle("Drop unused campaigns route")).toBe(true);
  });

  it("matches 'remove redundant X' phrasing mid-title", () => {
    expect(isDeletionSliceTitle("Cleanup: remove obsolete donate page")).toBe(true);
  });

  it("does NOT match an additive slice", () => {
    expect(isDeletionSliceTitle("Add campaigns dashboard")).toBe(false);
    expect(isDeletionSliceTitle("Wire up donate redirect")).toBe(false);
  });
});

describe("parseNameStatus (#227)", () => {
  it("parses status + path pairs", () => {
    const out = parseNameStatus("A\tsrc/donate/page.tsx\nD\tsrc/old.tsx\nM\tsrc/x.tsx");
    expect(out).toEqual([
      { status: "A", path: "src/donate/page.tsx" },
      { status: "D", path: "src/old.tsx" },
      { status: "M", path: "src/x.tsx" },
    ]);
  });

  it("reports the new path for a rename", () => {
    const out = parseNameStatus("R100\tsrc/old.tsx\tsrc/new.tsx");
    expect(out).toEqual([{ status: "R", path: "src/new.tsx" }]);
  });

  it("returns [] for empty input", () => {
    expect(parseNameStatus("")).toEqual([]);
    expect(parseNameStatus(null)).toEqual([]);
  });
});

describe("detectDeletionInversion (#227)", () => {
  const declared = [
    "apps/web/app/campaigns/[slug]/donate/page.tsx",
    "apps/web/app/campaigns/[slug]/donate/layout.tsx",
  ];

  it("flags a deletion slice that ADDED its declared targets", () => {
    const slice = makeDeletionSlice(declared);
    const nameStatus = [
      { status: "A", path: "apps/web/app/campaigns/[slug]/donate/page.tsx" },
      { status: "A", path: "apps/web/app/campaigns/[slug]/donate/layout.tsx" },
    ];
    const result = detectDeletionInversion({ slice, nameStatus });
    expect(result.applicable).toBe(true);
    expect(result.inverted).toBe(true);
    expect(result.offending.map(o => o.path)).toEqual(declared);
  });

  it("does NOT flag a correct deletion (status D)", () => {
    const slice = makeDeletionSlice(declared);
    const nameStatus = declared.map(path => ({ status: "D", path }));
    const result = detectDeletionInversion({ slice, nameStatus });
    expect(result.applicable).toBe(true);
    expect(result.inverted).toBe(false);
    expect(result.offending).toEqual([]);
  });

  it("does NOT flag a non-deletion slice even if files are added", () => {
    const slice = makeDeletionSlice(declared, "Add donate page");
    const nameStatus = declared.map(path => ({ status: "A", path }));
    const result = detectDeletionInversion({ slice, nameStatus });
    expect(result.applicable).toBe(false);
    expect(result.inverted).toBe(false);
  });

  it("ignores added files that are not declared targets", () => {
    const slice = makeDeletionSlice(declared);
    const nameStatus = [{ status: "A", path: "apps/web/app/other/page.tsx" }];
    const result = detectDeletionInversion({ slice, nameStatus });
    expect(result.applicable).toBe(true);
    expect(result.inverted).toBe(false);
  });

  it("is not applicable when the slice declares no files", () => {
    const slice = { number: "12", title: "Delete redundant page", rawLines: [] };
    const result = detectDeletionInversion({ slice, nameStatus: [] });
    expect(result.applicable).toBe(false);
  });
});
