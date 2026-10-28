/**
 * Dependency advisory floors.
 *
 * zod before 4.6.6 can be made to exhaust memory while validating oversized constrained collections
 * (GHSA-mrhx-c7xc-m3w5). @github/copilot-sdk pins zod to exactly 4.3.6, through its latest release, so
 * only an `overrides` entry moves it. The SDK calls `toJSONSchema()` on a schema it is handed and imports
 * no zod of its own; the zod that runs is the one @modelcontextprotocol/sdk validates with, and it
 * accepts `^3.25 || ^4.0`. Remove the override, and this floor, once @github/copilot-sdk depends on zod
 * 4.6.6 or later.
 *
 * body-parser before 2.4.0 (or 1.20.9 on the 1.x line) is open to denial of service through trailing bytes
 * after a compressed request body (GHSA-27r3-jxmh-p828). express and the MCP SDK ask for `^2`, so a lock
 * update is enough and needs no override.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ZOD_FLOOR = "4.6.6";
const LOCKS = ["package-lock.json", "pforge-mcp/package-lock.json"];
const MANIFESTS = ["package.json", "pforge-mcp/package.json"];

/** `patched` lists the first fixed release of each major line the advisory covers. */
const ADVISORIES = [
  { id: "GHSA-mrhx-c7xc-m3w5", pkg: "zod", patched: [ZOD_FLOOR] },
  { id: "GHSA-27r3-jxmh-p828", pkg: "body-parser", patched: ["1.20.9", "2.4.0"] },
];

const readJson = (relative) => JSON.parse(readFileSync(join(REPO, relative), "utf8"));
const numbers = (version) => version.replace(/^[^\d]*/, "").split(".").map(Number);

/** Is `version` at least `floor`? A range counts by its lower bound; a prerelease counts as below. */
function atLeast(version, floor) {
  const have = numbers(version);
  const want = numbers(floor);
  for (let i = 0; i < want.length; i++) {
    if (have[i] !== want[i]) return have[i] > want[i];
  }
  return true;
}

/** Is `version` at or past the fix for its own major line? A major the advisory does not list is not patched. */
function isPatched(version, patched) {
  const fix = patched.find((candidate) => numbers(candidate)[0] === numbers(version)[0]);
  return fix !== undefined && atLeast(version, fix);
}

describe("atLeast", () => {
  it("compares a number at a time, not as text", () => {
    expect(atLeast("4.10.0", "4.6.6")).toBe(true);
    expect(atLeast("4.6.6", "4.6.6")).toBe(true);
    expect(atLeast("4.6.5", "4.6.6")).toBe(false);
    expect(atLeast("4.3.6", "4.6.6")).toBe(false);
    expect(atLeast("5.0.0", "4.6.6")).toBe(true);
  });

  it("takes a range's lower bound and counts a prerelease as below", () => {
    expect(atLeast("^4.6.6", "4.6.6")).toBe(true);
    expect(atLeast(">=4.6.7", "4.6.6")).toBe(true);
    expect(atLeast("^4.3.6", "4.6.6")).toBe(false);
    expect(atLeast("4.6.6-beta.1", "4.6.6")).toBe(false);
  });
});

describe("isPatched", () => {
  it("holds a version to the fix of its own major line", () => {
    const patched = ["1.20.9", "2.4.0"];
    expect(isPatched("2.4.0", patched)).toBe(true);
    expect(isPatched("2.3.0", patched)).toBe(false);
    expect(isPatched("1.20.9", patched)).toBe(true);
    expect(isPatched("1.20.8", patched)).toBe(false);
    expect(isPatched("3.0.0", patched), "a major the advisory does not name is not known to be fixed").toBe(false);
  });
});

describe.each(ADVISORIES)("$pkg stays at a release without $id", ({ pkg, patched }) => {
  it.each(LOCKS)(`%s resolves every ${pkg} at or past the fix (${patched.join(" or ")})`, (lock) => {
    const entries = Object.entries(readJson(lock).packages).filter(([key]) => key === `node_modules/${pkg}` || key.endsWith(`/node_modules/${pkg}`));
    expect(entries.length, `${lock} has no ${pkg}`).toBeGreaterThan(0);
    for (const [key, entry] of entries) {
      expect(isPatched(entry.version, patched), `${lock} ${key} is ${entry.version}`).toBe(true);
    }
  });
});

describe(`zod is held at ${ZOD_FLOOR} or later by an override`, () => {
  it.each(MANIFESTS)("%s overrides zod, so the SDK's exact pin cannot hold it below the floor", (manifest) => {
    const spec = readJson(manifest).overrides?.zod;
    expect(spec, `${manifest} needs "overrides": { "zod": "^${ZOD_FLOOR}" } while @github/copilot-sdk pins zod`).toBeTypeOf("string");
    expect(atLeast(spec, ZOD_FLOOR), `${manifest} overrides zod to ${spec}`).toBe(true);
  });
});
