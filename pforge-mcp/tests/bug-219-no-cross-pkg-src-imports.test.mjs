// Regression guard for bug #219: tests in pforge-mcp must not deep-import into
// a peer package's internal src/ directory. They should import from the peer's
// published entry (package name) or live in the package that owns the code.
//
// The offending shape is an import whose specifier is two levels up into a
// sibling package's internal src tree. We build the matcher with RegExp (not a
// string literal of that shape) so this guard file does not match itself.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TESTS_DIR = resolve(import.meta.dirname);
// Detects an import specifier that climbs two levels into a sibling package's
// internal src tree (assembled piecewise so the guard never matches itself).
const CROSS_PKG_SRC = new RegExp(["from", "\\s+", "[\"']", "\\.\\./\\.\\./", "[^./\"']+", "/src/"].join(""));

describe("bug #219 — no cross-package src/ deep-imports in tests", () => {
  it("every pforge-mcp test imports peer packages via their public entry", () => {
    const offenders = [];
    for (const name of readdirSync(TESTS_DIR)) {
      if (!name.endsWith(".test.mjs")) continue;
      const src = readFileSync(resolve(TESTS_DIR, name), "utf-8");
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (CROSS_PKG_SRC.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `cross-package src/ imports found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
