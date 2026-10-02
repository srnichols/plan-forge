/**
 * Plan Forge — which lifecycle hooks a project has, for `pforge smith`.
 *
 *   node hook-status.mjs --project <dir>
 *
 * Prints one "Hook|sources" line per hook in HOOK_PASCAL order. Sources are a
 * comma-separated subset of "file" (a file under .github/hooks whose name
 * contains the hook), ".forge.json" (hooks.<camelCase>) and
 * "hooks/plan-forge.json" (hooks.<PascalCase>); a missing hook has none. A
 * false or null entry counts as absent. Both shells call this, so the check
 * needs no jq and cannot drift between them.
 *
 * @module hook-status
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOK_NAMES, HOOK_PASCAL } from "./enums.mjs";

function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) : null;
  } catch {
    return null;
  }
}

function listFileStems(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listFileStems(p) : [basename(e.name, extname(e.name))];
  });
}

const present = (value) => value !== undefined && value !== null && value !== false;

/** @returns {{ hook: string, sources: string[] }[]} */
export function hookStatus(projectRoot) {
  const hooksDir = join(projectRoot, ".github", "hooks");
  const stems = listFileStems(hooksDir);
  const forgeHooks = readJson(join(projectRoot, ".forge.json"))?.hooks ?? {};
  const jsonHooks = readJson(join(hooksDir, "plan-forge.json"))?.hooks ?? {};
  return HOOK_PASCAL.map((hook) => {
    const sources = [];
    if (stems.some((s) => s.toLowerCase().includes(hook.toLowerCase()))) sources.push("file");
    if (present(forgeHooks[HOOK_NAMES[hook]])) sources.push(".forge.json");
    if (present(jsonHooks[hook])) sources.push("hooks/plan-forge.json");
    return { hook, sources };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--project");
  const rows = hookStatus(resolve(at > 0 ? process.argv[at + 1] : process.cwd()));
  process.stdout.write(`${rows.map((r) => `${r.hook}|${r.sources.join(",")}`).join("\n")}\n`);
}
