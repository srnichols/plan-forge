import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Meta-bug #413 — instructions and documents still stated tool counts from several releases ago ("36 forge
 * tools", "17 forge tools", "19 forge tools", "88 MCP tools", "all 77 tools"). scripts/check-metrics.ps1 looks
 * for a list of stale numbers in four phrasings in README.md and docs/, so "N forge tools" was never matched
 * and .github/, templates/ and AGENT-SETUP.md were never scanned. .github/copilot-instructions.md is also what
 * setup copies into a `custom` project, so its number reaches users.
 *
 * "N forge tools" always states the size of the whole tool surface, so any tracked file that says it must say
 * the registered count. The looser phrasings ("all N tools", "N MCP tools") are also family counts ("14 MCP
 * tools" for LiveGuard), so they are checked only in the files where every such number is a total.
 */

const REPO = resolve(import.meta.dirname, "..", "..");
const sourceRepo = existsSync(join(REPO, "scripts", "release", "release-checks.json"));

const PHRASES = {
  forge: /\b(\d+)\+?\s+forge\s+tools?\b/gi,
  all: /\ball\s+(\d+)\s+(?:MCP\s+|forge\s+)?tools\b/gi,
  mcp: /\b(\d+)\+?\s+MCP\s+tools?\b/gi,
};

/** The tool counts a text claims, as "line: text", for the phrasings in `kinds`. */
function toolCountClaims(text, kinds = ["forge"]) {
  const found = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const kind of kinds) {
      const pattern = new RegExp(PHRASES[kind].source, PHRASES[kind].flags);
      for (const match of line.matchAll(pattern)) {
        found.push({ line: index + 1, count: Number(match[1]), text: match[0] });
      }
    }
  });
  return found;
}

/** Dated or historical material that keeps the numbers it was written with. */
const HISTORY = /^(CHANGELOG\.md|docs\/(plans|research|blog)\/|docs\/V3-CAPABILITY-AUDIT\.md|docs\/MEMORY-ARCHITECTURE\.md|docs\/manual\/plan-forge-manual\.html|pforge-mcp\/tests\/|\.forge\/)/;
const SCANNED = /\.(md|html|txt|template|svg|mjs|js|ps1|sh|yml|yaml)$/i;

/** Files whose every "N MCP tools" or "all N tools" is a claim about the whole surface. */
const TOTALS = [
  ["AGENT-SETUP.md", ["forge", "all", "mcp"]],
  ["llms.txt", ["forge", "all", "mcp"]],
  [".github/copilot-instructions.md", ["forge", "all", "mcp"]],
  ["templates/.github/copilot-instructions.md", ["forge", "all", "mcp"]],
  ["templates/copilot-instructions.md.template", ["forge", "all", "mcp"]],
  ["docs/manual/mcp-server-reference.html", ["all"]],
];

const mismatches = (claims, registered) => claims.filter((claim) => claim.count !== registered);

describe("the tool count scan finds what it is meant to", () => {
  it("reads each phrasing, with a plus sign, in any case", () => {
    expect(toolCountClaims("exposes 17 forge tools as native MCP operations")).toEqual([{ line: 1, count: 17, text: "17 forge tools" }]);
    expect(toolCountClaims("Runs 105+ forge tools")).toEqual([{ line: 1, count: 105, text: "105+ forge tools" }]);
    expect(toolCountClaims("1 forge tool")).toHaveLength(1);
    expect(toolCountClaims("all 77 tools across 8 categories", ["all"])).toEqual([{ line: 1, count: 77, text: "all 77 tools" }]);
    expect(toolCountClaims("All 107 MCP tools, and all 5 forge tools", ["all"]).map((claim) => claim.count)).toEqual([107, 5]);
    expect(toolCountClaims("**88 MCP tools** (Core + LiveGuard)", ["mcp"])).toEqual([{ line: 1, count: 88, text: "88 MCP tools" }]);
  });

  it("reports the line of each claim, with Windows line endings too", () => {
    expect(toolCountClaims("one\r\ntwo 17 forge tools\r\nthree 18 forge tools").map((claim) => claim.line)).toEqual([2, 3]);
  });

  it("reads only the phrasings it was asked for", () => {
    expect(toolCountClaims("88 MCP tools and all 77 tools", ["forge"])).toEqual([]);
    expect(toolCountClaims("17 forge tools", ["all", "mcp"])).toEqual([]);
  });

  it("does not read a name, a tool without a count, or a family count in other words", () => {
    expect(toolCountClaims("the forge_run_plan tool and the forge tools above", ["forge", "all", "mcp"])).toEqual([]);
    expect(toolCountClaims("14 LiveGuard tools, 22 core tools", ["forge", "all", "mcp"])).toEqual([]);
  });

  it("leaves current files out of the history that keeps old numbers", () => {
    for (const current of ["README.md", "AGENT-SETUP.md", "docs/faq.html", "docs/docs.html", ".github/copilot-instructions.md", "templates/.github/copilot-instructions.md", "docs/manual/mcp-server-reference.html"]) {
      expect(HISTORY.test(current), current).toBe(false);
    }
    for (const dated of ["CHANGELOG.md", "docs/blog/guardrails-lessons-learned.html", "docs/plans/Phase-1-PLAN.md", "docs/V3-CAPABILITY-AUDIT.md"]) {
      expect(HISTORY.test(dated), dated).toBe(true);
    }
  });
});

describe.skipIf(!sourceRepo)("instructions and documents state the registered tool count (#413)", () => {
  it('no tracked file says "N forge tools" with a count that is not the registered one', async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean);
    const wrong = [];
    for (const file of tracked.filter((name) => SCANNED.test(name) && !HISTORY.test(name))) {
      let text;
      try {
        text = readFileSync(join(REPO, file), "utf8");
      } catch {
        continue;
      }
      for (const claim of mismatches(toolCountClaims(text), TOOLS.length)) wrong.push(`${file}:${claim.line} says "${claim.text}"`);
    }
    expect(wrong, `the server registers ${TOOLS.length} tools; say it without a number, or say ${TOOLS.length}`).toEqual([]);
  });

  it.each(TOTALS)("%s states no total other than the registered one", async (file, kinds) => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    expect(existsSync(join(REPO, file)), `${file} was renamed or removed: update TOTALS`).toBe(true);
    const wrong = mismatches(toolCountClaims(readFileSync(join(REPO, file), "utf8"), kinds), TOOLS.length);
    expect(wrong.map((claim) => `${file}:${claim.line} says "${claim.text}"`), `the server registers ${TOOLS.length} tools`).toEqual([]);
  });
});
