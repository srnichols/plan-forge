import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SOURCE_ONLY_EXCLUDES } from "../vitest.config.mjs";

// Guard for #249. `pforge self-update` ships pforge-mcp/tests/** but not the source-repo
// tooling those suites exercise, so vitest.config.mjs excludes a suite when its asset is
// absent. The danger is the inverse: a typo'd asset path reads as "missing" in THIS repo
// and silently drops real coverage. These tests make that loud.
describe("consumer test surface (#249)", () => {
  it("excludes nothing in the source repo — every mapped asset is present", () => {
    expect(
      SOURCE_ONLY_EXCLUDES,
      `vitest.config.mjs excluded suites in the source repo, which means a mapped asset ` +
        `path is wrong. Excluded: ${SOURCE_ONLY_EXCLUDES.join(", ")}`,
    ).toEqual([]);
  });

  it("every suite named in the exclusion map actually exists", () => {
    // Re-derive the full list independent of which assets are present, so a renamed or
    // deleted test file cannot rot in the map unnoticed.
    const cfgSrc = fileURLToPath(new URL("../vitest.config.mjs", import.meta.url));
    const src = readFileSync(cfgSrc, "utf8");
    const specs = [...src.matchAll(/"(tests\/[A-Za-z0-9_.\-]+\.test\.mjs)"/g)].map(m => m[1]);
    expect(specs.length, "exclusion map should not be empty").toBeGreaterThan(0);

    const missing = specs.filter(
      s => !existsSync(fileURLToPath(new URL(`../${s}`, import.meta.url))),
    );
    expect(missing, `exclusion map references test files that do not exist`).toEqual([]);
  });
});
