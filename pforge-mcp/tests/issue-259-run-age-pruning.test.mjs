/**
 * Issue #259 — `.forge/runs/` never expires by age.
 *
 * Two pruners with overlapping responsibility shipped, and only the older
 * count-only one was ever wired:
 *
 *   telemetry.mjs::pruneRunHistory(cwd, maxRunHistory)     count only, WIRED
 *   forge-io.mjs::pruneForgeRuns(cwd, {maxAgeDays,maxRuns}) count + age, DEAD
 *
 * `pruneForgeRuns` was exported, re-exported through orchestrator.mjs,
 * imported into run-plan.mjs, listed in the capability surface and covered by
 * five tests — but never invoked. The age cutoff had never run once.
 *
 * The tell is arithmetic: an exactly-50 run count means the count cap is
 * enforced and the age cap is not. Measured in this repo at report time —
 * 50 dirs, 35 of them older than 30 days, oldest 3.5 months, 21.8 MB.
 * The reporter measured the same shape at 50 / 36 / 4 months / 163.7 MB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pruneForgeRuns } from "../orchestrator.mjs";

let cwd;
let runsDir;

beforeEach(() => {
  cwd = mkdtempSync(resolve(tmpdir(), "pf-259-"));
  runsDir = resolve(cwd, ".forge", "runs");
  mkdirSync(runsDir, { recursive: true });
});
afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

/** Create run dir `id`, aged `ageDays` days, and return its name. */
function makeRun(id, ageDays) {
  const dir = resolve(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "summary.json"), "{}", "utf-8");
  const when = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  utimesSync(dir, when, when);
  return id;
}

function indexLines() {
  const p = resolve(runsDir, "index.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

describe("pruneForgeRuns compacts index.jsonl (#259)", () => {
  it("drops index entries for directories it pruned", () => {
    // pruneRunHistory compacted the index; pruneForgeRuns did not. Swapping
    // the call site naively would have left orphaned index entries behind.
    makeRun("run-2026-01-01", 200);
    makeRun("run-2026-08-01", 40);
    makeRun("run-2026-09-01", 0);
    writeFileSync(
      resolve(runsDir, "index.jsonl"),
      ["run-2026-01-01", "run-2026-08-01", "run-2026-09-01"]
        .map((d) => JSON.stringify({ dir: d, runId: d }))
        .join("\n") + "\n",
      "utf-8",
    );

    const result = pruneForgeRuns(cwd, { maxAgeDays: 30, maxRuns: 50 });
    expect(result.pruned.sort()).toEqual(["run-2026-01-01", "run-2026-08-01"]);
    expect(indexLines().map((e) => e.dir)).toEqual(["run-2026-09-01"]);
  });

  it("leaves index entries that never had a directory alone", () => {
    // The index and the directory set are already allowed to drift — the
    // reporter measured 39 entries against 50 dirs. Compaction should remove
    // what it deleted, not everything it cannot account for.
    makeRun("run-2026-09-01", 0);
    writeFileSync(
      resolve(runsDir, "index.jsonl"),
      [{ dir: "run-2026-09-01" }, { dir: "run-never-existed" }]
        .map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );
    pruneForgeRuns(cwd, { maxAgeDays: 30, maxRuns: 50 });
    expect(indexLines().map((e) => e.dir).sort()).toEqual(["run-2026-09-01", "run-never-existed"]);
  });

  it("does not touch the index on a dry run", () => {
    makeRun("run-2026-01-01", 200);
    makeRun("run-2026-09-01", 0);
    writeFileSync(
      resolve(runsDir, "index.jsonl"),
      [{ dir: "run-2026-01-01" }, { dir: "run-2026-09-01" }]
        .map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );
    const result = pruneForgeRuns(cwd, { maxAgeDays: 30, dryRun: true });
    expect(result.pruned).toEqual(["run-2026-01-01"]);
    expect(indexLines()).toHaveLength(2);
    expect(existsSync(resolve(runsDir, "run-2026-01-01"))).toBe(true);
  });

  it("is a no-op when there is no index file", () => {
    makeRun("run-2026-01-01", 200);
    makeRun("run-2026-09-01", 0);
    expect(() => pruneForgeRuns(cwd, { maxAgeDays: 30 })).not.toThrow();
    expect(readdirSync(runsDir)).toEqual(["run-2026-09-01"]);
  });
});

describe("the age dimension is actually wired (#259)", () => {
  it("run-plan calls pruneForgeRuns, not the count-only pruner", async () => {
    const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf-8");
    expect(src).toMatch(/pruneForgeRuns\(\s*cwd/);
    expect(src, "the count-only pruner is still wired").not.toMatch(/pruneRunHistory\(/);
  });

  it("passes both retention dimensions from config", async () => {
    const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf-8");
    expect(src).toMatch(/maxRuns:\s*loadMaxRunHistory\(cwd\)/);
    expect(src).toMatch(/maxAgeDays:\s*loadMaxRunAgeDays\(cwd\)/);
    expect(src).toMatch(/function loadMaxRunAgeDays/);
  });

  it("maxRunAgeDays is declared in the config schema", async () => {
    const { CONFIG_SCHEMA } = await import("../capabilities/schemas.mjs");
    const flat = JSON.stringify(CONFIG_SCHEMA);
    expect(flat).toContain("maxRunAgeDays");
  });

  it("the documented retention contract mentions age, not just count", async () => {
    const src = readFileSync(resolve(import.meta.dirname, "..", "capabilities", "surface.mjs"), "utf-8");
    const line = src.split(/\r?\n/).find((l) => /maxRunHistory/.test(l) && /prune/i.test(l));
    expect(line, "retention description not found").toBeTruthy();
    expect(line).toMatch(/maxRunAgeDays/);
  });
});
