/**
 * Issue #255 — the plan status rewriter only recognised a *bolded*
 * `> **Status**: **HARDENED…`, while step2-harden-plan.prompt.md instructs
 * the agent to write it unbolded (`> **Status**: HARDENED — awaiting
 * Execution Hold lift`). Those shapes cannot ever match, so a completed plan
 * kept advertising itself as hardened-but-unexecuted. Because the rewriter is
 * documented as idempotent and no-ops when it finds no marker, a total miss
 * was indistinguishable from "already complete" and reported success.
 *
 * The fixtures below are the *measured* corpus of this repo's docs/plans/,
 * not invented shapes — 96 plans, 59 with a quote-status line:
 *
 *      11  Hardened, ready for execution (Step 3)
 *       8  🟡 HARDENED — Ready for execution
 *       5  **HARDENED — cleared for execution <date>**   <- only these matched
 *       4  Hardened, ready for execution
 *       2  STUB — not yet hardened                       <- must NOT match
 *       4  Drafted, awaiting hardening (Step 2)          <- must NOT match
 *       1  🟢 HARDENED — ready for Step 3 (execute slices)
 *       1  hardened draft · awaiting execution
 *
 * 30 of 59 lines describe a hardened plan; 5 were recognised. The report says
 * "ZERO match" — true of the reporting repo, not universally, and the
 * difference matters: the bolded form is real and must keep working.
 *
 * The two "must NOT match" shapes are why this cannot be a bare /hardened/i.
 * "STUB — not yet hardened" contains the word and means the opposite.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rewritePlanStatusOnSuccess } from "../orchestrator.mjs";

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(resolve(tmpdir(), "pf-255-")); });
afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

/** Build a plan whose quote-status line is `statusText`, run the rewriter, return the new line. */
function rewriteStatusLine(statusText, { yaml = "" } = {}) {
  const body = `${yaml}# Phase 1 — TEST\n\n> **Status**: ${statusText}\n> **Source**: something\n\n---\n\n## Slices\n`;
  const path = resolve(tmpDir, "plan.md");
  writeFileSync(path, body, "utf-8");
  rewritePlanStatusOnSuccess({
    planPath: path,
    cwd: tmpDir,
    shippedAt: "2026-09-02T00:00:00.000Z",
    version: "v9.9.9",
  });
  const out = readFileSync(path, "utf-8");
  return out.split(/\r?\n/).find((l) => l.startsWith("> **Status**:"));
}

describe("quote-status rewrite covers the shapes plans actually use (#255)", () => {
  const rewritten = [
    ["the prompt's own unbolded form", "HARDENED — awaiting Execution Hold lift"],
    ["the bolded form that already worked", "**HARDENED — cleared for execution 2026-05-21.** Step-2 hardening completed."],
    ["an emoji-prefixed form", "🟡 HARDENED — Ready for execution"],
    ["a green-emoji form", "🟢 HARDENED — ready for Step 3 (execute slices)"],
    ["title case with a comma", "Hardened, ready for execution (Step 3)"],
    ["lower case", "hardened draft · awaiting execution"],
  ];

  for (const [label, statusText] of rewritten) {
    it(`rewrites ${label}`, () => {
      const line = rewriteStatusLine(statusText);
      expect(line).toMatch(/^> \*\*Status\*\*: \*\*✅ Complete — shipped 2026-09-02 \(v9\.9\.9\)\.\*\*/);
    });
  }

  it("consumes the whole line, leaving no orphaned bold markers", () => {
    const line = rewriteStatusLine("**HARDENED — cleared for execution 2026-05-21**");
    expect(line.endsWith("**")).toBe(false);
    // exactly two bold spans: the ✅ Complete run and the `## What actually shipped` code span is not bold
    expect(line.match(/\*\*/g)).toHaveLength(4); // **Status** + **✅ Complete…**
  });
});

describe("quote-status rewrite leaves not-hardened plans alone (#255)", () => {
  const untouched = [
    ["a stub that merely mentions the word", "STUB — not yet hardened"],
    ["a draft awaiting hardening", "Drafted, awaiting hardening (Step 2)"],
    ["an already-complete plan", "**✅ Complete — shipped 2026-05-21 in v3.18.1** (retro commit)"],
    ["a plainly complete plan", "Complete"],
    ["an emoji-complete plan", "✅ Complete (2026-05-21)"],
    ["an in-progress plan", "in-progress"],
    ["a manual-operation plan", "Manual operation. **DO NOT run this as part of `pforge run-plan`**"],
  ];

  for (const [label, statusText] of untouched) {
    it(`leaves ${label} untouched`, () => {
      expect(rewriteStatusLine(statusText)).toBe(`> **Status**: ${statusText}`);
    });
  }
});

describe("yaml status rewrite (#255)", () => {
  function rewriteYaml(value) {
    const path = resolve(tmpDir, "plan.md");
    writeFileSync(path, `---\nphase: 1\nstatus: ${value}\n---\n\n# Phase 1\n`, "utf-8");
    rewritePlanStatusOnSuccess({ planPath: path, cwd: tmpDir, version: "v9.9.9" });
    return readFileSync(path, "utf-8").split(/\r?\n/).find((l) => l.startsWith("status:"));
  }

  it("rewrites the uppercase form", () => {
    expect(rewriteYaml("HARDENED")).toBe("status: COMPLETE");
  });

  it("rewrites the lowercase form that exists in the corpus", () => {
    expect(rewriteYaml("hardened")).toBe("status: COMPLETE");
  });

  it("rewrites the trailing-prose form the hardener prompt documents", () => {
    expect(rewriteYaml("HARDENED — awaiting Execution Hold lift")).toBe("status: COMPLETE");
  });

  it("leaves COMPLETE alone", () => {
    expect(rewriteYaml("COMPLETE")).toBe("status: COMPLETE");
  });

  it("leaves a draft alone", () => {
    expect(rewriteYaml("draft")).toBe("status: draft");
  });
});

describe("every hardened plan in docs/plans is now recognised (#255)", () => {
  it("matches the measured corpus shapes rather than one bolded variant", () => {
    // Guard against a future narrowing: these six lines are drawn verbatim from
    // the repo's own plan files. If a regex change stops matching any of them,
    // the rewriter has silently gone dark again for that whole shape.
    const shapes = [
      "HARDENED — awaiting Execution Hold lift",
      "**HARDENED — cleared for execution 2026-05-21.**",
      "🟡 HARDENED — Ready for execution",
      "🟢 HARDENED — ready for Step 3 (execute slices)",
      "Hardened, ready for execution (Step 3)",
      "hardened draft · awaiting execution",
    ];
    for (const s of shapes) {
      expect(rewriteStatusLine(s), `shape not recognised: ${s}`).toMatch(/✅ Complete/);
    }
  });
});

describe("the outcome is reportable, not silent (#255)", () => {
  function run(statusText) {
    const path = resolve(tmpDir, "plan.md");
    writeFileSync(path, `# Phase 1\n\n> **Status**: ${statusText}\n`, "utf-8");
    return rewritePlanStatusOnSuccess({ planPath: path, cwd: tmpDir, version: "v9.9.9" });
  }

  it("reports a rewrite", () => {
    const r = run("HARDENED — awaiting Execution Hold lift");
    expect(r.rewrote).toBe(true);
    expect(r.reason).toBe("rewritten");
    expect(r.quote).toBe(true);
  });

  it("distinguishes an unrecognised status line from already-complete", () => {
    const r = run("Shipped last Tuesday, honest");
    expect(r.rewrote).toBe(false);
    expect(r.reason).toBe("no-hardened-marker");
    // The line itself comes back, so a novel shape is diagnosable from the run
    // record instead of vanishing.
    expect(r.statusLine).toBe("> **Status**: Shipped last Tuesday, honest");
  });

  it("reports a missing file without throwing", () => {
    const r = rewritePlanStatusOnSuccess({ planPath: resolve(tmpDir, "nope.md"), cwd: tmpDir });
    expect(r).toEqual({ rewrote: false, reason: "file-missing" });
  });

  it("reports a missing planPath without throwing", () => {
    expect(rewritePlanStatusOnSuccess({ cwd: tmpDir })).toEqual({ rewrote: false, reason: "no-plan-path" });
  });
});
