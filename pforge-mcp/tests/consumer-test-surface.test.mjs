import { describe, it, expect, vi } from "vitest";
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

  it("excludes maintainer guidance checks only when their source assets are absent", async () => {
    const missingAssets = new Set([
      fileURLToPath(new URL("../../templates/.github/agents/specifier.agent.md", import.meta.url)),
      fileURLToPath(new URL("../../presets/shared/skills/code-review/SKILL.md", import.meta.url)),
    ]);
    vi.doMock("node:fs", async (importOriginal) => {
      const original = await importOriginal();
      return {
        ...original,
        existsSync: (file) => missingAssets.has(file) ? false : original.existsSync(file),
      };
    });
    vi.resetModules();
    try {
      const { SOURCE_ONLY_EXCLUDES: consumerExcludes } = await import("../vitest.config.mjs");
      expect(consumerExcludes).toContain("tests/planning-guidance.test.mjs");
      expect(consumerExcludes).toContain("tests/review-guidance.test.mjs");
      expect(consumerExcludes).not.toContain("tests/forge-master-ask-schema-parity.test.mjs");
      expect(consumerExcludes).not.toContain("tests/forge-master-observe-proxy.test.mjs");
      expect(consumerExcludes).not.toContain("tests/memory-provenance.test.mjs");
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
