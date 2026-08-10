/**
 * `--check` mode contract: verify generated artifacts without writing them.
 *
 * Issue #240 landed because `--validate` regenerates tools.json as a side
 * effect, and it is the first line of the "Preferred gate pattern" in
 * step2-harden-plan.prompt.md — so the standard slice gate mutated tracked
 * source. `checkGeneratedArtifacts()` gives gates a read-only alternative.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { checkGeneratedArtifacts, writeToolsJson, writeCliSchema } from "../capabilities.mjs";
import { TOOLS } from "../server/tool-definitions.mjs";

function makeDir() {
  return mkdtempSync(resolve(tmpdir(), "pforge-check-"));
}

describe("checkGeneratedArtifacts", () => {
  it("reports ok when the on-disk artifacts match what would be generated", () => {
    const dir = makeDir();
    try {
      writeToolsJson(TOOLS, dir);
      writeCliSchema(dir);

      const result = checkGeneratedArtifacts(TOOLS, dir);
      expect(result.ok).toBe(true);
      expect(result.drift).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never writes — a missing artifact stays missing", () => {
    const dir = makeDir();
    try {
      const result = checkGeneratedArtifacts(TOOLS, dir);

      expect(result.ok).toBe(false);
      expect(result.drift.map((d) => d.file)).toContain("tools.json");
      expect(existsSync(resolve(dir, "tools.json")), "check must not create the file").toBe(false);
      expect(existsSync(resolve(dir, "cli-schema.json")), "check must not create the file").toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never repairs — a stale artifact stays stale", () => {
    const dir = makeDir();
    try {
      writeToolsJson(TOOLS, dir);
      writeCliSchema(dir);
      const toolsPath = resolve(dir, "tools.json");
      writeFileSync(toolsPath, JSON.stringify([{ name: "forge_bogus" }], null, 2));

      const result = checkGeneratedArtifacts(TOOLS, dir);
      expect(result.ok).toBe(false);
      const entry = result.drift.find((d) => d.file === "tools.json");
      expect(entry).toBeTruthy();
      expect(entry.reason).toBe("stale");

      // The tampered content must survive the check untouched.
      expect(readFileSync(toolsPath, "utf-8")).toContain("forge_bogus");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores line-ending differences so CRLF checkouts do not report false drift", () => {
    const dir = makeDir();
    try {
      writeToolsJson(TOOLS, dir);
      writeCliSchema(dir);
      const toolsPath = resolve(dir, "tools.json");
      const lf = readFileSync(toolsPath, "utf-8");
      writeFileSync(toolsPath, lf.replace(/\n/g, "\r\n"));

      expect(checkGeneratedArtifacts(TOOLS, dir).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names both generated artifacts", () => {
    const dir = makeDir();
    try {
      const files = checkGeneratedArtifacts(TOOLS, dir).drift.map((d) => d.file).sort();
      expect(files).toEqual(["cli-schema.json", "tools.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
