/**
 * #309 Slice 1 — preset build manifest & extractor.
 *
 * scripts/audit/preset-build/extract.mjs reads a stack's manifest.json,
 * confirms every main-language block in presets/<stack> is mapped or
 * explicitly skipped, then copies scaffold/ and writes each mapped block
 * into place. This suite exercises the Shared Contract (#308) against a
 * fixture stack, then checks every manifest actually shipped under
 * scripts/audit/preset-build/ still covers its preset.
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractStack, loadManifest, validateManifest } from "../../scripts/audit/preset-build/extract.mjs";
import { indexDockerfileBlocks, loadDockerManifest, validateDockerManifest } from "../../scripts/audit/preset-build/run.mjs";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXTRACT_SCRIPT = join(REPO, "scripts", "audit", "preset-build", "extract.mjs");

const tmp = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(dir);
  return dir;
}

function writeFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A fixture preset with two files and four `rust` blocks, plus a scaffold. */
function fixtureStack({ manifest, extraBlock = false } = {}) {
  const repo = tempDir("pf-preset-build-");
  const presetDir = join(repo, "presets", "fixture-stack");

  writeFile(
    join(presetDir, "one.md"),
    [
      "# One",
      "",
      "```rust",
      "fn lib() {}",
      "```",
      "",
      "```rust",
      "fn first() {}",
      "```",
      "",
    ].join("\n"),
  );

  const twoBody = [
    "# Two",
    "",
    "```rust",
    "fn {{NAME}}() {}",
    "```",
    "",
    "```rust",
    "const N: u32 = {{N}};",
    "```",
    "",
  ];
  if (extraBlock) twoBody.push("```rust", "fn orphan() {}", "```", "");
  writeFile(join(presetDir, "two.md"), twoBody.join("\n"));

  const buildDir = join(repo, "scripts", "audit", "preset-build", "fixture-stack");
  writeFile(join(buildDir, "scaffold", "Cargo.toml"), '[package]\nname = "fixture"\n');
  writeFile(join(buildDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return { repo, presetsRoot: join(repo, "presets"), buildDir };
}

const CLEAN_MANIFEST = {
  stack: "fixture-stack",
  language: "rust",
  image: "rust:1.98-slim-bookworm",
  check: "cargo check",
  blocks: [
    { file: "one.md", index: 0, lang: "rust", to: "src/lib.rs", mode: "replace" },
    { file: "one.md", index: 1, lang: "rust", to: "src/main.rs", mode: "append" },
    { file: "two.md", index: 0, lang: "rust", to: "src/main.rs", mode: "append", fill: { "{{NAME}}": "second" } },
    { file: "two.md", index: 1, lang: "rust", to: "src/extra.rs", mode: "replace", fill: { "{{N}}": "9" } },
  ],
  skip: [],
};

describe("extractStack — happy path", () => {
  it("copies the scaffold and writes replace/append/fill blocks", () => {
    const { presetsRoot, buildDir } = fixtureStack({ manifest: CLEAN_MANIFEST });
    const outDir = tempDir("pf-preset-build-out-");

    const result = extractStack({ buildDir, presetsRoot, outDir });

    expect(result).toEqual({ ok: true });
    expect(readFileSync(join(outDir, "Cargo.toml"), "utf8")).toContain("fixture");
    expect(readFileSync(join(outDir, "src", "lib.rs"), "utf8")).toBe("fn lib() {}\n");
    expect(readFileSync(join(outDir, "src", "main.rs"), "utf8")).toBe("fn first() {}\nfn second() {}\n");
    expect(readFileSync(join(outDir, "src", "extra.rs"), "utf8")).toBe("const N: u32 = 9;\n");
  });
});

describe("validateManifest — stale and unmapped entries", () => {
  it("reports a stale entry when a manifest block index no longer exists", () => {
    const manifest = {
      ...CLEAN_MANIFEST,
      blocks: [...CLEAN_MANIFEST.blocks.slice(0, 3), { file: "two.md", index: 5, lang: "rust", to: "src/extra.rs", mode: "replace" }],
    };
    const { presetsRoot } = fixtureStack({ manifest });

    const { unmapped, stale } = validateManifest(manifest, presetsRoot);

    expect(stale).toEqual(["blocks: two.md\trust:5"]);
    expect(unmapped).toEqual(["two.md\trust:1"]);
  });

  it("reports an unmapped block when the preset has one the manifest does not cover", () => {
    const { presetsRoot } = fixtureStack({ manifest: CLEAN_MANIFEST, extraBlock: true });

    const { unmapped, stale } = validateManifest(CLEAN_MANIFEST, presetsRoot);

    expect(stale).toEqual([]);
    expect(unmapped).toEqual(["two.md\trust:2"]);
  });

  it("treats a skip entry missing a reason as stale", () => {
    const manifest = { ...CLEAN_MANIFEST, blocks: CLEAN_MANIFEST.blocks.slice(0, 3), skip: [{ file: "two.md", index: 1 }] };
    const { presetsRoot } = fixtureStack({ manifest });

    const { unmapped, stale } = validateManifest(manifest, presetsRoot);

    expect(stale).toEqual(["skip: two.md\trust:1 (missing reason)"]);
    expect(unmapped).toEqual(["two.md\trust:1"]);
  });

  it("maps a skipped block when it carries a reason", () => {
    const manifest = {
      ...CLEAN_MANIFEST,
      blocks: CLEAN_MANIFEST.blocks.slice(0, 3),
      skip: [{ file: "two.md", index: 1, reason: "illustrates a deliberately broken sample" }],
    };
    const { presetsRoot } = fixtureStack({ manifest });

    expect(validateManifest(manifest, presetsRoot)).toEqual({ unmapped: [], stale: [] });
  });
});

describe("extractStack — exits without writing on a bad manifest", () => {
  it("returns ok:false and does not create outDir for a stale index", () => {
    const manifest = {
      ...CLEAN_MANIFEST,
      blocks: [...CLEAN_MANIFEST.blocks.slice(0, 3), { file: "two.md", index: 5, lang: "rust", to: "src/extra.rs", mode: "replace" }],
    };
    const { presetsRoot, buildDir } = fixtureStack({ manifest });
    const outDir = join(tempDir("pf-preset-build-out-"), "nested");

    const result = extractStack({ buildDir, presetsRoot, outDir });

    expect(result.ok).toBe(false);
    expect(result.stale).toEqual(["blocks: two.md\trust:5"]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("returns ok:false and does not create outDir for an unmapped block", () => {
    const { presetsRoot, buildDir } = fixtureStack({ manifest: CLEAN_MANIFEST, extraBlock: true });
    const outDir = join(tempDir("pf-preset-build-out-"), "nested");

    const result = extractStack({ buildDir, presetsRoot, outDir });

    expect(result.ok).toBe(false);
    expect(result.unmapped).toEqual(["two.md\trust:2"]);
    expect(existsSync(outDir)).toBe(false);
  });
});

describe("extract.mjs CLI", () => {
  it("exits 0 and writes files for a clean manifest", () => {
    const { repo } = fixtureStack({ manifest: CLEAN_MANIFEST });
    const outDir = tempDir("pf-preset-build-out-");

    const r = spawnSync("node", [EXTRACT_SCRIPT, "--stack", "fixture-stack", "--out", outDir, "--repo", repo], { encoding: "utf8" });

    expect(r.status).toBe(0);
    expect(readFileSync(join(outDir, "src", "lib.rs"), "utf8")).toBe("fn lib() {}\n");
  });

  it("exits 1 and lists the stale entry without writing outDir", () => {
    const manifest = {
      ...CLEAN_MANIFEST,
      blocks: [...CLEAN_MANIFEST.blocks.slice(0, 3), { file: "two.md", index: 5, lang: "rust", to: "src/extra.rs", mode: "replace" }],
    };
    const { repo } = fixtureStack({ manifest });
    const outDir = join(tempDir("pf-preset-build-out-"), "nested");

    const r = spawnSync("node", [EXTRACT_SCRIPT, "--stack", "fixture-stack", "--out", outDir, "--repo", repo], { encoding: "utf8" });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("stale\tblocks: two.md\trust:5");
    expect(existsSync(outDir)).toBe(false);
  });

  it("exits 1 and lists the unmapped block without writing outDir", () => {
    const { repo } = fixtureStack({ manifest: CLEAN_MANIFEST, extraBlock: true });
    const outDir = join(tempDir("pf-preset-build-out-"), "nested");

    const r = spawnSync("node", [EXTRACT_SCRIPT, "--stack", "fixture-stack", "--out", outDir, "--repo", repo], { encoding: "utf8" });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unmapped\ttwo.md\trust:2");
    expect(existsSync(outDir)).toBe(false);
  });
});

describe("shipped manifests — coverage", () => {
  const buildRoot = join(REPO, "scripts", "audit", "preset-build");
  const stacks = existsSync(buildRoot)
    ? readdirSync(buildRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(buildRoot, e.name, "manifest.json")))
        .map((e) => e.name)
    : [];

  it("includes the rust and swift compile harnesses", () => {
    expect(stacks).toEqual(expect.arrayContaining(["rust", "swift"]));
  });

  for (const stack of stacks) {
    it(`${stack}: every main-language block is mapped or skipped with a reason`, () => {
      const manifest = loadManifest(join(buildRoot, stack));
      const { unmapped, stale } = validateManifest(manifest, join(REPO, "presets"));
      expect({ unmapped, stale }).toEqual({ unmapped: [], stale: [] });
    });
  }
});

// run.mjs passes a stack with no docker/<stack>/manifest.json as "zero builds",
// which is how rust's and swift's documented Dockerfiles went unbuilt. Every
// preset that documents a Dockerfile must build it or skip it with a reason.
describe("docker manifests — coverage", () => {
  const presetStacks = readdirSync(join(REPO, "presets"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const stack of presetStacks) {
    const documented = indexDockerfileBlocks(stack).length;
    if (documented === 0) continue;
    it(`${stack}: every documented Dockerfile is built or skipped with a reason`, () => {
      const manifest = loadDockerManifest(stack);
      expect(manifest, `presets/${stack} documents ${documented} Dockerfile(s) but has no docker/${stack}/manifest.json`).not.toBeNull();
      const { unmapped, stale } = validateDockerManifest(stack, manifest);
      expect({ unmapped, stale }).toEqual({ unmapped: [], stale: [] });
    });
  }
});
