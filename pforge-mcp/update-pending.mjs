/**
 * Plan Forge — pending guidance updates (#302).
 *
 * When `pforge update` keeps a guidance file the project edited, it writes the
 * new version to .forge/update-pending/<path> (update-guard.mjs). This module
 * lists those copies and lets the user compare, take or drop each one, so both
 * CLI shells share one implementation:
 *
 *   node update-pending.mjs list    --project <dir>
 *   node update-pending.mjs count   --project <dir>
 *   node update-pending.mjs diff    --project <dir> [<path>]
 *   node update-pending.mjs apply   --project <dir> (<path> | --all) [--yes]
 *   node update-pending.mjs discard --project <dir> (<path> | --all) [--yes]
 *
 * apply and discard only describe what they would do until --yes is given.
 * apply backs the project's copy up under .forge/update-backups/<stamp>/, the
 * same place `pforge update --overwrite-customized` uses.
 *
 * @module update-pending
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_DIR, normalizeText, PENDING_DIR } from "./update-guard.mjs";

const DAY_MS = 86_400_000;
export const EXIT_OK = 0;
export const EXIT_NOT_PENDING = 1;
export const EXIT_USAGE = 2;
const MODES = Object.freeze(["list", "count", "diff", "apply", "discard"]);
const USAGE = "usage: pforge pending [list | diff [<path>] | apply (<path>|--all) [--yes] | discard (<path>|--all) [--yes]]\n";

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walkFiles(p) : [p];
  });
}

/**
 * Pending copies, oldest first.
 * @returns {{ path: string, pending: string, ageDays: number, projectExists: boolean, identical: boolean }[]}
 */
export function listPending(projectRoot, { now = Date.now() } = {}) {
  const pendingRoot = join(projectRoot, PENDING_DIR);
  return walkFiles(pendingRoot)
    .map((file) => {
      const path = relative(pendingRoot, file).split(/[\\/]/).join("/");
      const target = join(projectRoot, path);
      const projectExists = existsSync(target);
      const identical = projectExists && normalizeText(readFileSync(target, "utf8")) === normalizeText(readFileSync(file, "utf8"));
      // Clamp: a file written moments ago can carry an mtime a hair ahead of Date.now().
      const ageDays = Math.max(0, Math.floor((now - statSync(file).mtimeMs) / DAY_MS));
      return { path, pending: `${PENDING_DIR}/${path}`, ageDays, projectExists, identical };
    })
    .sort((a, b) => b.ageDays - a.ageDays || a.path.localeCompare(b.path));
}

/**
 * The project-relative path of a pending copy, from either form the user may type
 * (".github/x.md" or ".forge/update-pending/.github/x.md"). Null when there is no
 * such pending copy or the path leaves the pending directory.
 */
export function resolvePendingPath(projectRoot, input) {
  const clean = posix.normalize(String(input).replace(/\\/g, "/")).replace(/^\.\//, "");
  const rel = clean.startsWith(`${PENDING_DIR}/`) ? clean.slice(PENDING_DIR.length + 1) : clean;
  const pendingRoot = resolve(projectRoot, PENDING_DIR);
  const file = resolve(pendingRoot, rel);
  const inside = relative(pendingRoot, file);
  if (!inside || inside.startsWith("..") || resolve(inside) === inside) return null;
  return existsSync(file) && statSync(file).isFile() ? inside.split(/[\\/]/).join("/") : null;
}

/** `git diff --no-index` of the project's file against its pending copy. */
export function diffPending(projectRoot, path) {
  const project = existsSync(join(projectRoot, path)) ? path : "/dev/null";
  const r = spawnSync("git", ["diff", "--no-index", "--no-color", "--", project, `${PENDING_DIR}/${path}`], { cwd: projectRoot, encoding: "utf8" });
  if (r.error) throw new Error(`git is needed to show the diff: ${r.error.message}`);
  // Exit 1 means the files differ; anything above that is an error.
  if (r.status > 1) throw new Error(r.stderr.trim());
  return r.stdout;
}

function removeEmptyParents(dir, stopAt) {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt && existsSync(current) && readdirSync(current).length === 0) {
    rmdirSync(current);
    current = dirname(current);
  }
}

function dropPendingCopy(projectRoot, path) {
  const file = join(projectRoot, PENDING_DIR, path);
  rmSync(file, { force: true });
  const pendingRoot = join(projectRoot, PENDING_DIR);
  removeEmptyParents(dirname(file), pendingRoot);
  if (existsSync(pendingRoot) && readdirSync(pendingRoot).length === 0) rmdirSync(pendingRoot);
}

/** Replace each project file with its pending copy, backing the project's copy up first. */
export function applyPending(projectRoot, paths, { dryRun = true, stamp = new Date().toISOString().replace(/[:.]/g, "-") } = {}) {
  return paths.map((path) => {
    const target = join(projectRoot, path);
    const backup = existsSync(target) ? `${BACKUP_DIR}/${stamp}/${path}` : null;
    if (!dryRun) {
      if (backup) {
        mkdirSync(dirname(join(projectRoot, backup)), { recursive: true });
        copyFileSync(target, join(projectRoot, backup));
      }
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(projectRoot, PENDING_DIR, path), target);
      dropPendingCopy(projectRoot, path);
    }
    return { path, backup, applied: !dryRun };
  });
}

/** Delete pending copies, keeping the project's own files. */
export function discardPending(projectRoot, paths, { dryRun = true } = {}) {
  return paths.map((path) => {
    if (!dryRun) dropPendingCopy(projectRoot, path);
    return { path, discarded: !dryRun };
  });
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const FLAGS = Object.freeze({ "--all": "all", "--yes": "yes", "-y": "yes" });

function parseArgs(argv) {
  const hasMode = argv.length > 0 && !argv[0].startsWith("-");
  const args = { mode: hasMode ? argv[0] : "list", project: process.cwd(), all: false, yes: false, paths: [] };
  const tokens = hasMode ? argv.slice(1) : argv;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--project") args.project = tokens[++i];
    else if (FLAGS[t]) args[FLAGS[t]] = true;
    else if (t.startsWith("-")) throw new Error(`unknown option ${t}`);
    else args.paths.push(t);
  }
  if (!MODES.includes(args.mode)) throw new Error(`unknown subcommand ${args.mode}`);
  if (!args.project) throw new Error("--project needs a directory");
  return args;
}

function printList(out, items) {
  if (items.length === 0) {
    out.write("No pending updates. `pforge update` saves one in .forge/update-pending/ when it keeps a guidance file you edited.\n");
    return;
  }
  out.write(`${items.length} pending update(s) — \`pforge update\` kept your edited copies and saved the new versions:\n`);
  for (const item of items) {
    const note = !item.projectExists ? "  (your copy was deleted)" : item.identical ? "  (already identical)" : "";
    out.write(`  ${item.path}  ${item.ageDays === 0 ? "today" : `${item.ageDays} day(s) old`}${note}\n`);
  }
  out.write("\nCompare:          pforge pending diff <path>\nTake new version: pforge pending apply <path> --yes   (backs your copy up)\nKeep yours:       pforge pending discard <path> --yes\n");
}

/** Resolve the paths an apply/discard call names; throws on an unknown path. */
function selectPaths(projectRoot, args) {
  if (args.all) return listPending(projectRoot).map((i) => i.path);
  if (args.paths.length === 0) throw new Error(`${args.mode} needs a <path> or --all`);
  return args.paths.map((p) => {
    const rel = resolvePendingPath(projectRoot, p);
    if (!rel) throw Object.assign(new Error(`no pending update for ${p} (see: pforge pending)`), { code: EXIT_NOT_PENDING });
    return rel;
  });
}

function runDiff(out, projectRoot, args) {
  const paths = args.paths.length ? selectPaths(projectRoot, args) : listPending(projectRoot).map((i) => i.path);
  if (paths.length === 0) printList(out, []);
  for (const p of paths) out.write(diffPending(projectRoot, p) || `${p}: your copy already matches the pending version\n`);
}

function runChange(out, projectRoot, args) {
  const paths = selectPaths(projectRoot, args);
  if (paths.length === 0) return printList(out, []);
  if (args.mode === "apply") {
    for (const r of applyPending(projectRoot, paths, { dryRun: !args.yes })) {
      const backup = r.backup ? ` (your copy backed up to ${r.backup})` : "";
      out.write(`${r.applied ? "APPLIED" : "WOULD APPLY"}  ${r.path}${backup}\n`);
    }
  } else {
    for (const r of discardPending(projectRoot, paths, { dryRun: !args.yes })) {
      out.write(`${r.discarded ? "DISCARDED" : "WOULD DISCARD"}  ${r.path} (your copy stays)\n`);
    }
  }
  if (!args.yes) out.write("Dry run. Re-run with --yes to make the change.\n");
}

export function runCli(argv, { out = process.stdout, err = process.stderr } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err.write(`${e.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const projectRoot = resolve(args.project);
  try {
    if (args.mode === "list") printList(out, listPending(projectRoot));
    else if (args.mode === "count") out.write(`${listPending(projectRoot).length}\n`);
    else if (args.mode === "diff") runDiff(out, projectRoot, args);
    else runChange(out, projectRoot, args);
    return EXIT_OK;
  } catch (e) {
    err.write(`${e.message}\n`);
    return e.code === EXIT_NOT_PENDING ? EXIT_NOT_PENDING : EXIT_USAGE;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
