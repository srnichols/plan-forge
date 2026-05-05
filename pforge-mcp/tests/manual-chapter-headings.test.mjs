/**
 * Regression tests for Appendix H ("Plan Forge on the GitHub Stack") chapter headings.
 *
 * Locks in four decisions made in Phase-GITHUB-C-CHAPTER-CONTENT Slice 6:
 *
 *  1. Top-level section order (h2 IDs 1–8 in document order).
 *  2. Section 8 sub-section order is depth-first (Claude Code → Cursor → Codex),
 *     NOT alphabetical (which would place Codex before Cursor).
 *  3. Section 5 "Copilot Spaces sync" uses automated-command references / links
 *     rather than inline manual-copy instructions.
 *  4. Dogfood capture (Section 1 testbed screenshot) uses a local assets/ path,
 *     not a public https:// URL — keeping the screenshot self-contained.
 *  5. Section 8 Spec-Kit positioning is reserved for Phase GITHUB-D; the
 *     `spec-kit` ID must be absent until that phase lands.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(
  __dirname,
  "../../docs/manual/plan-forge-on-the-github-stack.html"
);
const html = readFileSync(HTML_PATH, "utf8");

// Extract all id="" values in document order
function extractIds(content) {
  const ids = [];
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) ids.push(m[1]);
  return ids;
}

const allIds = extractIds(html);

// ─── 1. Top-level section order (h2 IDs 1–8) ───────────────────────────────

const EXPECTED_H2_IDS = [
  "readiness-check",      // § 1
  "eight-primitives",     // § 2
  "coding-agent-dispatch", // § 3
  "ghas-remediation",     // § 4
  "spaces-sync",          // § 5
  "metrics-leaderboard",  // § 6
  "byok-model-picker",    // § 7
  "other-agent-platforms", // § 8
];

describe("Appendix H — top-level section order (h2)", () => {
  it("all eight h2 section IDs are present in the document", () => {
    for (const id of EXPECTED_H2_IDS) {
      expect(allIds, `expected h2 id="${id}" to be present`).toContain(id);
    }
  });

  it("h2 IDs appear in the documented section order (§ 1 … § 8)", () => {
    const positions = EXPECTED_H2_IDS.map((id) => allIds.indexOf(id));
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `"${EXPECTED_H2_IDS[i]}" must appear after "${EXPECTED_H2_IDS[i - 1]}" in the document`
      ).toBeGreaterThan(positions[i - 1]);
    }
  });
});

// ─── 2. Section 8 sub-section order — depth-first, not alphabetical ─────────
//
//  Depth-first  (by Plan-Forge integration depth): Claude Code → Cursor → Codex
//  Alphabetical (rejected):                        Claude Code → Codex  → Cursor
//
//  The key assertion is that `cursor` precedes `codex`.

const S8_ORDERED_IDS = [
  "cross-platform-baseline",
  "claude-code",
  "cursor",
  "codex",
  "platform-comparison",
];

describe("Section 8 — sub-section order is depth-first (Claude Code → Cursor → Codex)", () => {
  it("all Section 8 platform sub-section IDs are present", () => {
    for (const id of S8_ORDERED_IDS) {
      expect(allIds, `expected id="${id}" in Section 8`).toContain(id);
    }
  });

  it("depth-first order: cross-platform-baseline → claude-code → cursor → codex → platform-comparison", () => {
    const positions = S8_ORDERED_IDS.map((id) => allIds.indexOf(id));
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `"${S8_ORDERED_IDS[i]}" must appear after "${S8_ORDERED_IDS[i - 1]}"`
      ).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("cursor appears BEFORE codex — depth-first, not alphabetical", () => {
    const cursorPos = allIds.indexOf("cursor");
    const codexPos = allIds.indexOf("codex");
    expect(cursorPos, "cursor must come before codex (depth-first beats alphabetical)").toBeLessThan(
      codexPos
    );
  });
});

// ─── 3. Section 5 — command / link approach, not inline manual-copy text ─────
//
//  Decision: Section 5 uses `pforge sync-spaces` automated commands and links
//  (e.g. to github.com/copilot/spaces) rather than inlining step-by-step
//  manual copy instructions for instruction files.

describe("Section 5 — Copilot Spaces sync uses automated commands, not inline manual-copy text", () => {
  const section5Start = html.indexOf('id="spaces-sync"');
  const section6Start = html.indexOf('id="metrics-leaderboard"');

  it("Section 5 bounds are found in the document", () => {
    expect(section5Start).toBeGreaterThan(-1);
    expect(section6Start).toBeGreaterThan(section5Start);
  });

  it("Section 5 references pforge sync-spaces as the sync mechanism", () => {
    const section5Html = html.slice(section5Start, section6Start);
    expect(section5Html).toContain("pforge sync-spaces");
  });

  it("Section 5 contains links for external references (not inline-only prose)", () => {
    const section5Html = html.slice(section5Start, section6Start);
    expect(section5Html).toMatch(/href="[^"]+"/);
  });

  it("Section 5 does NOT contain a manual step-by-step copy block for instruction files", () => {
    const section5Html = html.slice(section5Start, section6Start);
    // Manual-copy instructions would typically say "copy the file to …" as prose.
    // The automation path uses pforge sync-spaces, not cp/copy commands.
    expect(section5Html).not.toMatch(/\bcp\s+\.github\/instructions\b/);
    expect(section5Html).not.toMatch(/\bcopy\s+\.github\\instructions\b/i);
  });
});

// ─── 4. Dogfood capture — local screenshot, not a public URL ──────────────────
//
//  Decision: the testbed screenshot in Section 1 is a locally-served file at
//  assets/screenshots/ — NOT a live https:// URL that could change or go dark.

describe("Section 1 — dogfood screenshot uses a local assets/ path, not a public URL", () => {
  const section1Start = html.indexOf('id="readiness-check"');
  const section2Start = html.indexOf('id="eight-primitives"');

  it("Section 1 bounds are found in the document", () => {
    expect(section1Start).toBeGreaterThan(-1);
    expect(section2Start).toBeGreaterThan(section1Start);
  });

  it("the testbed screenshot src uses the local assets/screenshots/ path", () => {
    const section1Html = html.slice(section1Start, section2Start);
    expect(section1Html).toMatch(/src="assets\/screenshots\//);
  });

  it("the testbed screenshot src is NOT a public https:// URL", () => {
    const section1Html = html.slice(section1Start, section2Start);
    // All <img src="https://…"> patterns are banned in Section 1 dogfood capture.
    const imgPublicUrl = /<img[^>]+src="https?:\/\/[^"]+"/;
    expect(section1Html).not.toMatch(imgPublicUrl);
  });
});

// ─── 5. Section 8 Spec-Kit — reserved for Phase GITHUB-D, absent until then ───
//
//  Decision: the Spec-Kit sub-section will be appended AFTER platform-comparison
//  when Phase GITHUB-D lands. Until then, id="spec-kit" must be absent so
//  Phase GITHUB-D owns the addition cleanly.

describe("Section 8 — Spec-Kit positioning (reserved for Phase GITHUB-D)", () => {
  it('id="spec-kit" is absent — Spec-Kit has not yet landed (Phase GITHUB-D)', () => {
    expect(allIds).not.toContain("spec-kit");
  });

  it("platform-comparison is the last named sub-section ID inside Section 8 (before Section 9)", () => {
    const s8Start = allIds.indexOf("other-agent-platforms");
    expect(s8Start, 'id="other-agent-platforms" must exist').toBeGreaterThan(-1);
    const idsFromS8 = allIds.slice(s8Start);
    // Section 8 ends where Section 9 (built-with-plan-forge) begins. Fall back
    // to chapter-prev-next for plans that haven't added Section 9 yet.
    const s9Idx = idsFromS8.indexOf("built-with-plan-forge");
    const endIdx = s9Idx >= 0 ? s9Idx : idsFromS8.indexOf("chapter-prev-next");
    const s8Ids = endIdx >= 0 ? idsFromS8.slice(0, endIdx) : idsFromS8;
    expect(s8Ids[s8Ids.length - 1]).toBe("platform-comparison");
  });
});
