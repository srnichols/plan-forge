#!/usr/bin/env node
/**
 * Keep every Plan Forge package version in step with VERSION (#306).
 *
 *   node scripts/sync-versions.mjs 3.29.0      # write VERSION, then sync the packages
 *   node scripts/sync-versions.mjs             # sync the packages to the current VERSION
 *   node scripts/sync-versions.mjs --check     # exit 1 when anything disagrees with VERSION
 *
 * Synced: the root, pforge-mcp and pforge-master package.json files and their
 * entries in package-lock.json and pforge-mcp/package-lock.json. pforge-sdk is
 * versioned independently and is left alone. Only version values change; key
 * order, indentation and line endings are preserved.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE_FILES = ["package.json", "pforge-mcp/package.json", "pforge-master/package.json"];
// Lockfile → package keys whose version must follow VERSION ("" is the lockfile's own root).
const LOCKFILES = {
  "package-lock.json": ["", "pforge-mcp", "pforge-master"],
  "pforge-mcp/package-lock.json": [""],
};
const TOP_LEVEL_VERSION = /^(\s*"version"\s*:\s*")[^"]*(")/m;

function readText(file) {
  return readFileSync(file, "utf8");
}

function writeText(file, text, original) {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(file, text.replace(/\r?\n/g, eol));
}

/** Version fields that disagree with `version`, as `{ file, field, found }`. */
function packageJsonDrift(root, version) {
  const drift = [];
  for (const rel of PACKAGE_FILES) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    const found = JSON.parse(readText(file)).version;
    if (found !== version) drift.push({ file: rel, field: "version", found });
  }
  return drift;
}

function lockfileDrift(root, version) {
  const drift = [];
  for (const [rel, keys] of Object.entries(LOCKFILES)) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    const lock = JSON.parse(readText(file));
    if (lock.version !== version) drift.push({ file: rel, field: "version", found: lock.version });
    for (const key of keys) {
      const entry = lock.packages?.[key];
      if (entry && entry.version !== version) drift.push({ file: rel, field: `packages["${key}"].version`, found: entry.version });
    }
  }
  return drift;
}

export function findDrift(root, version) {
  return [...packageJsonDrift(root, version), ...lockfileDrift(root, version)];
}

function syncPackageJson(file, version) {
  const original = readText(file);
  // The first "version" key in an npm package.json is the top-level one.
  if (!TOP_LEVEL_VERSION.test(original)) throw new Error(`${file}: no "version" field`);
  const updated = original.replace(TOP_LEVEL_VERSION, `$1${version}$2`);
  if (updated === original) return false;
  writeFileSync(file, updated);
  return true;
}

function syncLockfile(file, keys, version) {
  const original = readText(file);
  const lock = JSON.parse(original);
  lock.version = version;
  for (const key of keys) {
    if (lock.packages?.[key]) lock.packages[key].version = version;
  }
  const updated = `${JSON.stringify(lock, null, 2)}\n`;
  if (updated === original.replace(/\r\n/g, "\n")) return false;
  writeText(file, updated, original);
  return true;
}

/** Set every package version to `version`; returns the files that changed. */
export function syncVersions(root, version) {
  const changed = [];
  for (const rel of PACKAGE_FILES) {
    const file = join(root, rel);
    if (existsSync(file) && syncPackageJson(file, version)) changed.push(rel);
  }
  for (const [rel, keys] of Object.entries(LOCKFILES)) {
    const file = join(root, rel);
    if (existsSync(file) && syncLockfile(file, keys, version)) changed.push(rel);
  }
  return changed;
}

function parseArgs(argv) {
  const args = { root: resolve(fileURLToPath(new URL("..", import.meta.url))), check: false, version: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--root") args.root = resolve(argv[++i] ?? "");
    else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else args.version = arg.replace(/^v/i, "");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const versionFile = join(args.root, "VERSION");
  if (args.version && !SEMVER.test(args.version)) throw new Error(`not a version: ${args.version}`);
  if (args.version && !args.check) writeFileSync(versionFile, args.version);
  const version = args.version ?? readText(versionFile).trim();

  if (args.check) {
    const drift = findDrift(args.root, version);
    for (const d of drift) console.error(`  ${d.file} ${d.field} is ${d.found}, expected ${version}`);
    console.log(drift.length ? `Version drift: ${drift.length} field(s) disagree with ${version}` : `All package versions match ${version}`);
    return drift.length ? 1 : 0;
  }

  const changed = syncVersions(args.root, version);
  console.log(changed.length ? `Set ${version} in: ${changed.join(", ")}` : `All package versions already ${version}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`sync-versions: ${err.message}`);
    process.exitCode = 2;
  }
}
