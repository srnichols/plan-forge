/**
 * Dependency advisory floors.
 *
 * zod before 4.6.6 can be made to exhaust memory while validating oversized constrained collections
 * (GHSA-mrhx-c7xc-m3w5). @github/copilot-sdk pins zod to exactly 4.3.6, through its latest release, so
 * only an `overrides` entry moves it. The SDK calls `toJSONSchema()` on a schema it is handed and imports
 * no zod of its own; the zod that runs is the one @modelcontextprotocol/sdk validates with, and it
 * accepts `^3.25 || ^4.0`.
 *
 * Remove the override, and this floor, once @github/copilot-sdk depends on zod 4.6.6 or later.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ZOD_FLOOR = "4.6.6";
const LOCKS = ["package-lock.json", "pforge-mcp/package-lock.json"];
const MANIFESTS = ["package.json", "pforge-mcp/package.json"];

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

describe(`zod stays at a release without GHSA-mrhx-c7xc-m3w5 (${ZOD_FLOOR} or later)`, () => {
  it.each(LOCKS)("%s resolves every zod at or above the floor", (lock) => {
    const zods = Object.entries(readJson(lock).packages).filter(([key]) => /(^|\/)node_modules\/zod$/.test(key));
    expect(zods.length).toBeGreaterThan(0);
    for (const [key, entry] of zods) {
      expect(atLeast(entry.version, ZOD_FLOOR), `${lock} ${key} is ${entry.version}`).toBe(true);
    }
  });

  it.each(MANIFESTS)("%s overrides zod, so the SDK's exact pin cannot hold it below the floor", (manifest) => {
    const spec = readJson(manifest).overrides?.zod;
    expect(spec, `${manifest} needs "overrides": { "zod": "^${ZOD_FLOOR}" } while @github/copilot-sdk pins zod`).toBeTypeOf("string");
    expect(atLeast(spec, ZOD_FLOOR), `${manifest} overrides zod to ${spec}`).toBe(true);
  });
});
