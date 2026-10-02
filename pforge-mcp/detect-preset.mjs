/**
 * Plan Forge — detect a project's stack preset from its files.
 *
 *   node detect-preset.mjs --project <dir> [--fields]
 *
 * Prints the preset (dotnet, go, swift, rust, java, python, typescript, php,
 * azure-iac, or custom), or "preset|marker" with --fields. Uses the markers and
 * precedence of `setup -AutoDetect` (Find-Preset in setup.ps1, detect_preset in
 * setup.sh), plus .slnx solutions. `pforge update` calls it when .forge.json is
 * missing or names no preset, so it never mistakes a stack project for "custom".
 *
 * @module detect-preset
 */

import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", ".forge", "bin", "obj", "dist", "target", "vendor"]);

/**
 * In setup's order. `depth` is how many directory levels below the project
 * root a match may sit (0 = root only), matching setup's -Depth limits.
 */
const RULES = Object.freeze([
  { preset: "dotnet", depth: 2, test: (n) => /\.(csproj|fsproj)$/i.test(n) },
  { preset: "dotnet", depth: 1, test: (n) => /\.slnx?$/i.test(n) },
  { preset: "go", depth: 0, test: (n) => n === "go.mod" },
  { preset: "swift", depth: 0, test: (n) => n === "Package.swift" },
  { preset: "swift", depth: 1, test: (n) => /\.(xcodeproj|xcworkspace)$/i.test(n) },
  { preset: "rust", depth: 0, test: (n) => n === "Cargo.toml" },
  { preset: "java", depth: 0, test: (n) => ["pom.xml", "build.gradle", "build.gradle.kts"].includes(n) },
  { preset: "python", depth: 0, test: (n) => ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"].includes(n) },
  { preset: "typescript", depth: 0, test: (n) => ["package.json", "tsconfig.json"].includes(n) },
  { preset: "php", depth: 0, test: (n) => ["composer.json", "artisan"].includes(n) },
  { preset: "azure-iac", depth: 3, test: (n) => /\.(bicep|tf)$/i.test(n) },
  { preset: "azure-iac", depth: 0, test: (n) => ["azure.yaml", "bicepconfig.json"].includes(n) },
]);
const MAX_DEPTH = Math.max(...RULES.map((r) => r.depth));

/** Every entry (files and directories, which .xcodeproj bundles are) down to MAX_DEPTH. */
function listEntries(root) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = resolve(dir, e.name);
      out.push({ name: e.name, depth, rel: relative(root, path).replace(/\\/g, "/") });
      if (e.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(e.name)) walk(path, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** @returns {{ preset: string, marker: string|null }} */
export function detectPreset(projectRoot) {
  const entries = listEntries(resolve(projectRoot));
  for (const rule of RULES) {
    const hit = entries.find((e) => e.depth <= rule.depth && rule.test(e.name));
    if (hit) return { preset: rule.preset, marker: hit.rel };
  }
  return { preset: "custom", marker: null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--project");
  const r = detectPreset(at > 0 ? process.argv[at + 1] : process.cwd());
  process.stdout.write(`${process.argv.includes("--fields") ? `${r.preset}|${r.marker ?? ""}` : r.preset}\n`);
}
