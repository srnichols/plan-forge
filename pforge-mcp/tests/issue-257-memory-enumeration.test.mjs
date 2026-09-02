/**
 * Issue #257 — the hardener proved "no prior lessons exist" from a fixed
 * three-filename allowlist, and the shipper was told to write those same three
 * files. A closed loop that always reported absence: the write side is not
 * followed, because one unbounded append-only lessons-learned.md is unreadable
 * and authors reach for topic names instead.
 *
 * Plan Forge reproduces the defect on itself. /memories/repo/ in this repo
 * holds ~59 files, every one named by subject, and NOT ONE of the three
 * prescribed names. Several are exactly what a hardener would want before
 * writing gates:
 *
 *   plan-gate-command-rules.md
 *   plan-gate-portability-old-consumers.md
 *   plan-gate-node-e-pattern.md
 *   plan-gate-vitest-dot-reporter-trap.md
 *   nested-quotes-in-node-e-gates.md
 *   gate-execution-lessons.md
 *
 * A hardener following the old instruction would have opened none of them and
 * reported "no prior lessons exist" — the same false negative the reporter
 * measured verbatim in three separate hardened plans.
 *
 * These are content guards. The templates are markdown, so the only mechanical
 * check available is that the read side enumerates rather than name-checks and
 * the write side no longer prescribes the catch-alls.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const CATCH_ALLS = ["conventions.md", "lessons-learned.md", "forbidden-patterns.md"];

const READ_SIDE = [
  ".github/prompts/step2-harden-plan.prompt.md",
  "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md",
  "templates/.github/agents/plan-hardener.agent.md",
];

const WRITE_SIDE = [
  ".github/prompts/step6-ship.prompt.md",
  "templates/.github/agents/shipper.agent.md",
];

function read(rel) {
  const p = resolve(ROOT, rel);
  expect(existsSync(p), `${rel} not found`).toBe(true);
  return readFileSync(p, "utf-8");
}

describe("the read side enumerates memory instead of guessing filenames (#257)", () => {
  for (const rel of READ_SIDE) {
    it(`${rel} tells the hardener to enumerate /memories/repo/`, () => {
      const src = read(rel);
      expect(src).toMatch(/enumerate/i);
      expect(src).toMatch(/\/memories\/repo\//);
    });

    it(`${rel} also searches memory, not only the filesystem`, () => {
      // The check never consulted OpenBrain even where one is configured and
      // holds the lessons — the template's memory model predated it.
      const src = read(rel);
      expect(src).toMatch(/forge_search|brain_recall/);
      expect(src).toMatch(/sources.*memory|memory.*search/i);
    });

    it(`${rel} does not prescribe the three catch-all filenames`, () => {
      const src = read(rel);
      for (const name of CATCH_ALLS) {
        // Naming them as a thing NOT to rely on is fine; listing them as the
        // files to check is the defect.
        const asChecklist = new RegExp(`[-*]\\s*\`?/?memories/repo/${name.replace(".", "\\.")}`, "i");
        expect(src, `${rel} still lists ${name} as a file to check`).not.toMatch(asChecklist);
      }
    });

    it(`${rel} forbids reporting absence from a missing filename`, () => {
      const src = read(rel);
      expect(src).toMatch(/nothing relevant/i);
    });
  }
});

describe("the write side names files by subject (#257)", () => {
  for (const rel of WRITE_SIDE) {
    it(`${rel} tells the shipper to name memory files by subject`, () => {
      const src = read(rel);
      expect(src).toMatch(/name (each|memory) file/i);
      expect(src).toMatch(/subject/i);
    });

    it(`${rel} explicitly says not to create the three catch-alls`, () => {
      const src = read(rel);
      expect(src).toMatch(/do not create/i);
      for (const name of CATCH_ALLS) {
        expect(src).toContain(name);
      }
    });

    it(`${rel} no longer presents the catch-alls as a numbered instruction`, () => {
      const src = read(rel);
      for (const name of CATCH_ALLS) {
        const asInstruction = new RegExp(`^\\s*\\d+\\.\\s+\\*\\*\`?/?(?:memories/repo/)?${name.replace(".", "\\.")}`, "mi");
        expect(src, `${rel} still instructs writing ${name}`).not.toMatch(asInstruction);
      }
    });
  }
});

describe("read and write sides agree (#257)", () => {
  it("no template both forbids and prescribes the catch-alls", () => {
    for (const rel of [...READ_SIDE, ...WRITE_SIDE]) {
      const src = read(rel);
      const prescribes = /^\s*\d+\.\s+\*\*`?\/?(?:memories\/repo\/)?(conventions|lessons-learned|forbidden-patterns)\.md/mi.test(src);
      expect(prescribes, `${rel} still prescribes a catch-all`).toBe(false);
    }
  });
});
