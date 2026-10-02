/**
 * `pforge smith` Node.js support check (node-support.mjs): the floor comes from
 * plan-forge-mcp's engines.node, and end-of-life Node lines are flagged.
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assessNode, compareVersions, FALLBACK_FLOOR, NODE_EOL, readFloor } from "../node-support.mjs";

const MCP = resolve(import.meta.dirname, "..");
const DAY_MS = 86_400_000;
const dir = mkdtempSync(join(tmpdir(), "pf-node-support-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("readFloor", () => {
  it("reads plan-forge-mcp's engines.node", () => {
    const pkg = JSON.parse(readFileSync(join(MCP, "package.json"), "utf8"));
    expect(`>=${readFloor(join(MCP, "package.json"))}`).toBe(pkg.engines.node);
  });

  it("falls back when engines.node is missing or not a plain >=X.Y.Z", () => {
    const f = join(dir, "package.json");
    writeFileSync(f, JSON.stringify({ engines: { node: "^20 || >=22" } }));
    expect(readFloor(f)).toBe(FALLBACK_FLOOR);
    expect(readFloor(join(dir, "missing.json"))).toBe(FALLBACK_FLOOR);
  });
});

describe("assessNode", () => {
  const now = Date.parse("2026-10-02T00:00:00Z");

  it("fails a version below the floor (Node 20 here, which is also end of life)", () => {
    expect(assessNode({ version: "v20.19.5", floor: "22.12.0", now }).status).toBe("below-floor");
    expect(assessNode({ version: "22.11.0", floor: "22.12.0", now }).status).toBe("below-floor");
  });

  it("passes a supported LTS that is not near end of life", () => {
    expect(assessNode({ version: "24.11.1", floor: "22.12.0", now })).toMatchObject({ status: "ok", eol: NODE_EOL[24] });
  });

  it("warns within 180 days of end of life, then flags it once passed", () => {
    const eol22 = Date.parse(NODE_EOL[22]);
    expect(assessNode({ version: "22.12.0", floor: "22.12.0", now: eol22 - 100 * DAY_MS })).toMatchObject({ status: "eol-soon", daysLeft: 100 });
    expect(assessNode({ version: "22.20.0", floor: "22.12.0", now: eol22 + 2 * DAY_MS }).status).toBe("eol");
  });

  it("does not guess for a release line it has no date for", () => {
    expect(assessNode({ version: "25.1.0", floor: "22.12.0", now })).toMatchObject({ status: "ok", eol: null, daysLeft: null });
  });
});

describe("compareVersions", () => {
  it("compares numerically and ignores pre-release tags", () => {
    expect(compareVersions("22.12.0", "22.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v24.0.0-nightly2026", "24.0.0")).toBe(0);
  });
});

describe("CLI", () => {
  it("prints JSON, or status|floor|eol|daysLeft with --fields, for the running Node", () => {
    const json = JSON.parse(spawnSync(process.execPath, [join(MCP, "node-support.mjs")], { encoding: "utf8" }).stdout);
    expect(json.version).toBe(process.versions.node);
    const fields = spawnSync(process.execPath, [join(MCP, "node-support.mjs"), "--fields"], { encoding: "utf8" }).stdout.trim().split("|");
    expect(fields).toHaveLength(4);
    expect(fields[0]).toBe(json.status);
    expect(fields[1]).toBe(json.floor);
  });
});
