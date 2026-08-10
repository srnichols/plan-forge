// Regression guard for self-repair issue #224: a file in an INNER layer
// (packages/) importing from an OUTER layer (apps/) violates the Clean
// Architecture Dependency Rule. scripts/audit/dependency-direction.mjs must
// flag exactly that shape and stay silent on the allowed direction.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  scanDependencyDirection,
  layerOf,
  loadDirectionPolicy,
  parseArgs,
} from "../../scripts/audit/dependency-direction.mjs";

const LAYERS = ["apps", "packages"];
const EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function mkTmp() {
  return mkdtempSync(join(tmpdir(), "pf-depdir-"));
}

function write(root, rel, content) {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

describe("dependency-direction guard — issue #224", () => {
  let root;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* cleanup */ } });

  it("flags a packages/* file importing from apps/* (the Phase-79 regression shape)", () => {
    write(root, "apps/api/src/test-support/constants.ts", "export const FOO = 1;\n");
    write(
      root,
      "packages/persona-fixtures/src/personas.ts",
      "import { FOO } from '../../../apps/api/src/test-support/constants';\nexport const p = FOO;\n",
    );

    const result = scanDependencyDirection(root, LAYERS, EXT);
    expect(result.violations).toHaveLength(1);
    const v = result.violations[0];
    expect(v.sourceLayer).toBe("packages");
    expect(v.targetLayer).toBe("apps");
    expect(v.source).toBe("packages/persona-fixtures/src/personas.ts");
    expect(v.specifier).toContain("apps/api/src/test-support/constants");
  });

  it("allows the inward direction: apps/* importing from packages/*", () => {
    write(root, "packages/types/src/index.ts", "export const BAR = 2;\n");
    write(
      root,
      "apps/api/src/server.ts",
      "import { BAR } from '../../../packages/types/src/index';\nexport const x = BAR;\n",
    );

    const result = scanDependencyDirection(root, LAYERS, EXT);
    expect(result.violations).toHaveLength(0);
  });

  it("ignores intra-layer and external (bare) imports", () => {
    write(root, "packages/a/src/x.ts", "import { z } from './y';\nimport fs from 'node:fs';\nexport const x = z;\n");
    write(root, "packages/a/src/y.ts", "export const z = 3;\n");

    const result = scanDependencyDirection(root, LAYERS, EXT);
    expect(result.violations).toHaveLength(0);
  });

  it("detects dynamic import() and require() forms, not just static import", () => {
    write(root, "apps/web/src/conf.ts", "export const C = 4;\n");
    write(
      root,
      "packages/ui/src/load.ts",
      "export async function load() { return import('../../../apps/web/src/conf'); }\n",
    );
    write(
      root,
      "packages/ui/src/req.cjs",
      "const c = require('../../../apps/web/src/conf');\nmodule.exports = c;\n",
    );

    const result = scanDependencyDirection(root, LAYERS, EXT);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.every((v) => v.targetLayer === "apps")).toBe(true);
  });
});

describe("dependency-direction helpers", () => {
  it("layerOf classes a path by its outermost matching segment", () => {
    expect(layerOf("packages/x/src/a.ts", LAYERS)).toEqual({ name: "packages", index: 1 });
    expect(layerOf("apps/api/packages/mock.ts", LAYERS)).toEqual({ name: "apps", index: 0 });
    expect(layerOf("scripts/tool.mjs", LAYERS)).toBeNull();
  });

  it("parseArgs reads --root and --gate", () => {
    const args = parseArgs(["--root", "/tmp/x", "--gate"]);
    expect(args.root).toBe("/tmp/x");
    expect(args.gate).toBe(true);
  });

  it("loadDirectionPolicy falls back to defaults when no policy file exists", () => {
    const empty = mkTmp();
    try {
      const { layers, extensions } = loadDirectionPolicy(empty);
      expect(layers).toEqual(["apps", "packages"]);
      expect(extensions).toContain(".ts");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
