/**
 * A baseline test compares with the committed baseline; it does not rewrite it.
 *
 * update-plan-baseline.test.mjs recorded what each shell reported by writing the result over its committed
 * fixture before it checked anything. A run left five tracked files modified. On a machine that could run only one
 * shell (Linux has no PowerShell 5.1) the write also dropped the other shell's entry, and update-plan.test.mjs,
 * which reads the same files, then compared the planner with whatever the last run had written.
 *
 * checkBaseline compares. A run re-records only when PFORGE_UPDATE_BASELINES=1, and then keeps the entry of any
 * shell that did not run.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UPDATE_BASELINES_ENV, checkBaseline } from "./helpers/baseline-file.mjs";

const FILE = "case/case.baseline.json";
const SH = ["KEEP a", "NEW b", "NEW c"];
const PS = ["KEEP a", "NEW b", "NEW c"];
const committed = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** An in-memory stand-in for the files, counting how often something is written. */
function memory(initial = {}) {
  const files = new Map(Object.entries(initial));
  const writes = [];
  return {
    files,
    writes,
    io: {
      exists: (file) => files.has(file),
      read: (file) => files.get(file),
      write: (file, text) => { writes.push(file); files.set(file, text); },
    },
  };
}

describe("checkBaseline without PFORGE_UPDATE_BASELINES", () => {
  it("reports no mismatch and writes nothing when every shell matches the committed lines", () => {
    const store = memory({ [FILE]: committed({ "pforge.sh": SH, "pforge.ps1": PS }) });
    const check = checkBaseline({ file: FILE, results: { "pforge.sh": SH, "pforge.ps1": PS }, env: {}, io: store.io });
    expect(check).toEqual({ updated: false, mismatches: [] });
    expect(store.writes).toEqual([]);
  });

  it("names a shell whose lines differ, with the lines it lost and the lines it gained, and writes nothing", () => {
    const store = memory({ [FILE]: committed({ "pforge.sh": SH, "pforge.ps1": PS }) });
    const results = { "pforge.sh": ["KEEP a", "NEW b", "NEW d"], "pforge.ps1": PS };
    const check = checkBaseline({ file: FILE, results, env: {}, io: store.io });
    expect(check.mismatches).toEqual([{ shell: "pforge.sh", missing: ["NEW c"], unexpected: ["NEW d"] }]);
    expect(check.updated).toBe(false);
    expect(store.writes).toEqual([]);
  });

  it("checks only the shells that ran, so a machine with one shell does not fail for the other", () => {
    const store = memory({ [FILE]: committed({ "pforge.sh": SH, "pforge.ps1": ["NEW only-on-windows"] }) });
    const check = checkBaseline({ file: FILE, results: { "pforge.sh": SH }, env: {}, io: store.io });
    expect(check.mismatches).toEqual([]);
  });

  it("counts a shell the baseline never recorded as a mismatch", () => {
    const store = memory({ [FILE]: committed({ "pforge.sh": SH }) });
    const check = checkBaseline({ file: FILE, results: { "pforge.sh": SH, "pforge.ps1": PS }, env: {}, io: store.io });
    expect(check.mismatches).toEqual([{ shell: "pforge.ps1", missing: [], unexpected: PS }]);
  });

  it("counts a missing baseline file as a mismatch and does not create it", () => {
    const store = memory();
    const check = checkBaseline({ file: FILE, results: { "pforge.sh": SH }, env: {}, io: store.io });
    expect(check.mismatches).toHaveLength(1);
    expect(store.writes).toEqual([]);
    expect(store.files.has(FILE)).toBe(false);
  });

  it.each(["0", "true", "yes", "", undefined])("does not treat %j as the request to re-record", (value) => {
    const store = memory({ [FILE]: committed({ "pforge.sh": SH }) });
    checkBaseline({ file: FILE, results: { "pforge.sh": ["NEW other"] }, env: { [UPDATE_BASELINES_ENV]: value }, io: store.io });
    expect(store.writes).toEqual([]);
  });
});

describe("checkBaseline with PFORGE_UPDATE_BASELINES=1", () => {
  const ask = { [UPDATE_BASELINES_ENV]: "1" };

  it("writes the record, reports no mismatch, and says it updated", () => {
    const store = memory({ [FILE]: committed({ "pforge.sh": SH }) });
    const results = { "pforge.sh": ["NEW other"] };
    expect(checkBaseline({ file: FILE, results, env: ask, io: store.io })).toEqual({ updated: true, mismatches: [] });
    expect(store.files.get(FILE)).toBe(committed(results));
  });

  it("keeps the entry of a shell that did not run", () => {
    const store = memory({ [FILE]: committed({ "pforge.sh": SH, "pforge.ps1": PS }) });
    checkBaseline({ file: FILE, results: { "pforge.sh": ["NEW other"] }, env: ask, io: store.io });
    expect(JSON.parse(store.files.get(FILE))).toEqual({ "pforge.sh": ["NEW other"], "pforge.ps1": PS });
  });

  it("creates the file when there is no baseline yet", () => {
    const store = memory();
    checkBaseline({ file: FILE, results: { "pforge.sh": SH }, env: ask, io: store.io });
    expect(JSON.parse(store.files.get(FILE))).toEqual({ "pforge.sh": SH });
  });

  it("writes the way the committed baselines are written: two-space JSON and a final newline", () => {
    const store = memory();
    checkBaseline({ file: FILE, results: { "pforge.sh": SH }, env: ask, io: store.io });
    expect(store.files.get(FILE)).toBe(`${JSON.stringify({ "pforge.sh": SH }, null, 2)}\n`);
  });
});

describe("Guard: update-plan-baseline.test.mjs records only through checkBaseline", () => {
  const source = readFileSync(resolve(import.meta.dirname, "update-plan-baseline.test.mjs"), "utf8");

  it("does not write a file itself", () => {
    expect(source).not.toMatch(/\bwriteFileSync\b/);
  });

  it("compares with the committed baseline through the helper", () => {
    expect(source).toContain("checkBaseline");
    expect(source).toContain('from "./helpers/baseline-file.mjs"');
  });

  it("is backed by a helper that exports what the guard names", () => {
    const helper = readFileSync(join(import.meta.dirname, "helpers", "baseline-file.mjs"), "utf8");
    expect(helper).toContain("export function checkBaseline");
    expect(helper).toContain("export const UPDATE_BASELINES_ENV");
  });
});
