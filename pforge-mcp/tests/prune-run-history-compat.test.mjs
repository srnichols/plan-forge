import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as telemetry from "../telemetry.mjs";

describe("release compatibility - pruneRunHistory", () => {
  let cwd;
  let runsDir;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-prune-compat-"));
    runsDir = join(cwd, ".forge", "runs");
    mkdirSync(runsDir, { recursive: true });
    const entries = ["run-1", "run-2", "run-3"];
    for (const entry of entries) {
      const directory = join(runsDir, entry);
      mkdirSync(directory);
      utimesSync(directory, 0, 0);
    }
    writeFileSync(join(runsDir, "index.jsonl"), entries.map((dir) => JSON.stringify({ dir })).join("\n") + "\n");
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  function prune(limit) {
    expect(telemetry.pruneRunHistory).toBeTypeOf("function");
    return telemetry.pruneRunHistory(cwd, limit);
  }

  function directories() {
    return readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  it("preserves the synchronous count-only signature and return value", () => {
    expect(prune(2)).toBeUndefined();
    expect(directories()).toEqual(["run-2", "run-3"]);
    const index = readFileSync(join(runsDir, "index.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(index.map(({ dir }) => dir)).toEqual(["run-2", "run-3"]);
  });

  it("does not introduce age expiration into the legacy count-only API", () => {
    prune(3);
    expect(directories()).toEqual(["run-1", "run-2", "run-3"]);
  });

  it("preserves an explicit zero retention count", () => {
    prune(0);
    expect(directories()).toEqual([]);
  });
});
