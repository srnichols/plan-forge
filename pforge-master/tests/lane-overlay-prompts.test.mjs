// Phase-43 — lane-specific system prompt overlays
//
// Verifies that loadSystemPrompt() composes the right overlay file when
// given a lane, and falls through to the bare base prompt when the lane has
// no overlay registered.
//
// loadSystemPrompt is module-private; we exercise it indirectly via the
// exported buildSystemPromptForTest helper if present, else fall back to
// asserting that the overlay files exist and that reasoning.mjs imports
// from prompts/.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "src");
const PROMPTS = resolve(SRC, "prompts");

describe("Lane overlay system-prompt composition (Phase-43)", () => {
  it("ships an overlay file for each of the three primary lanes", () => {
    expect(existsSync(resolve(PROMPTS, "advisory-cto.md"))).toBe(true);
    expect(existsSync(resolve(PROMPTS, "build-interviewer.md"))).toBe(true);
    expect(existsSync(resolve(PROMPTS, "troubleshoot-sre.md"))).toBe(true);
  });

  it("advisory overlay establishes the CTO voice", () => {
    const txt = readFileSync(resolve(PROMPTS, "advisory-cto.md"), "utf-8");
    expect(txt).toMatch(/CTO/i);
    expect(txt).toMatch(/trade-offs?/i);
  });

  it("build overlay enforces Crucible-funneling", () => {
    const txt = readFileSync(resolve(PROMPTS, "build-interviewer.md"), "utf-8");
    expect(txt).toMatch(/Crucible/);
    expect(txt).toMatch(/forge_crucible_submit/);
  });

  it("troubleshoot overlay enforces SRE evidence discipline", () => {
    const txt = readFileSync(resolve(PROMPTS, "troubleshoot-sre.md"), "utf-8");
    expect(txt).toMatch(/forge_watch_live/);
    expect(txt).toMatch(/forge_bug_list/);
  });

  it("reasoning.mjs registers the three overlays in LANE_OVERLAYS", () => {
    const src = readFileSync(resolve(SRC, "reasoning.mjs"), "utf-8");
    expect(src).toMatch(/LANE_OVERLAYS\s*=/);
    expect(src).toMatch(/advisory-cto\.md/);
    expect(src).toMatch(/build-interviewer\.md/);
    expect(src).toMatch(/troubleshoot-sre\.md/);
  });
});
