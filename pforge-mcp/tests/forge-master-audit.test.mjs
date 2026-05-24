/**
 * Phase-43 — forge_master_audit parser + handler contract guard.
 *
 * The audit handler's success path depends on the Forge-Master reasoning
 * model returning a structured Markdown block with four canonical sections.
 * This test pins the parser so structural drift in the response template
 * (renaming a section, swapping bullet syntax) fails CI before shipping.
 */

import { describe, it, expect } from "vitest";
import { _parseAuditMarkdown } from "../server/tool-handlers/platform.mjs";

describe("_parseAuditMarkdown", () => {
  it("extracts summary, risks, actions, and cost_note from a canonical report", () => {
    const md = [
      "## Summary",
      "Project is shipping but drift score dropped 8 points this week.",
      "",
      "## Top Risks",
      "- **Drift in server.mjs** — forge_drift_report: 3 ACI violations introduced in Slice 4",
      "- **Cost trending +12%** — forge_cost_report: $1.20→$1.34/day",
      "- **Open P0 bug** — forge_bug_list: bug #142 blocks production",
      "",
      "## Recommended Actions",
      "- [P0] Refactor server.mjs ACI violations — drift score will keep falling",
      "- [P1] Flip quorum to speed for non-blocking slices — reduces token spend ~20%",
      "- [P2] Backfill audit coverage for memory layer — known blind spot",
      "",
      "## Cost Note",
      "$1.34/day current vs $1.20/day baseline — within budget but trending up.",
    ].join("\n");

    const result = _parseAuditMarkdown(md);

    expect(result.summary).toContain("drift score dropped 8 points");
    expect(result.top_risks).toHaveLength(3);
    expect(result.top_risks[0]).toEqual({
      title: "Drift in server.mjs",
      evidence: "forge_drift_report: 3 ACI violations introduced in Slice 4",
    });
    expect(result.actions).toHaveLength(3);
    expect(result.actions[0]).toEqual({
      priority: "P0",
      action: "Refactor server.mjs ACI violations",
      why: "drift score will keep falling",
    });
    expect(result.cost_note).toContain("$1.34/day");
  });

  it("caps top_risks at 3 even when the model returns more", () => {
    const md = [
      "## Summary",
      "x",
      "## Top Risks",
      "- **a** — e",
      "- **b** — e",
      "- **c** — e",
      "- **d** — e",
      "- **e** — e",
    ].join("\n");
    expect(_parseAuditMarkdown(md).top_risks).toHaveLength(3);
  });

  it("caps actions at 5", () => {
    const md = [
      "## Recommended Actions",
      ...Array.from({ length: 8 }, (_, i) => `- [P1] action${i} — why${i}`),
    ].join("\n");
    expect(_parseAuditMarkdown(md).actions).toHaveLength(5);
  });

  it("returns empty fields on empty input (no crash)", () => {
    const r = _parseAuditMarkdown("");
    expect(r).toEqual({ summary: "", top_risks: [], actions: [], cost_note: "" });
  });

  it("returns empty fields on non-string input", () => {
    const r = _parseAuditMarkdown(null);
    expect(r).toEqual({ summary: "", top_risks: [], actions: [], cost_note: "" });
  });

  it('accepts "Actions" header as alias of "Recommended Actions"', () => {
    const md = "## Actions\n- [P0] ship it — because\n";
    expect(_parseAuditMarkdown(md).actions[0]).toEqual({
      priority: "P0",
      action: "ship it",
      why: "because",
    });
  });

  it('accepts "Top 3 Risks" header as alias of "Top Risks"', () => {
    const md = "## Top 3 Risks\n- **t** — e\n";
    expect(_parseAuditMarkdown(md).top_risks[0]).toEqual({ title: "t", evidence: "e" });
  });

  it("ignores malformed bullets gracefully", () => {
    const md = [
      "## Top Risks",
      "- this is not in the bullet format",
      "- **a** — good",
      "random text here",
      "- **b** — good",
    ].join("\n");
    expect(_parseAuditMarkdown(md).top_risks).toEqual([
      { title: "a", evidence: "good" },
      { title: "b", evidence: "good" },
    ]);
  });
});
