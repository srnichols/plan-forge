#!/usr/bin/env node
/**
 * Keeps npm lockfiles resolving from the public registry (#414).
 *
 * npm writes each tarball's URL into `resolved` as the registry it asked reported it. Behind a package
 * mirror that is the mirror's host, and `npm ci` then fails for everyone outside the mirror's network.
 *
 *   node scripts/lock-registry.mjs                       # check every tracked lockfile; exit 1 if one resolves elsewhere
 *   node scripts/lock-registry.mjs --write               # rewrite a mirror's URL for a tarball to the public URL
 *   node scripts/lock-registry.mjs [--write] <file>...   # these lockfiles instead of the tracked ones
 *
 * A rewrite is made only where the URL ends the way the public one does, `/<name>/-/<file>.tgz`, which
 * names the same tarball, so `integrity` stays as npm wrote it. Anything else (a git or file dependency,
 * a URL that names another package) is reported and left for a person. Only the URLs change; the rest of
 * the file, line endings included, is kept as it is. A lockfile with no `packages` map (npm 6's
 * lockfileVersion 1) is refused, because a check that read nothing in it would pass it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const NODE_MODULES = "node_modules/";

const unscoped = (name) => name.split("/").pop();

/** The public registry's URL for a package's tarball. */
export function publicTarballUrl(name, version) {
  return `${PUBLIC_REGISTRY}${name}/-/${unscoped(name)}-${version}.tgz`;
}

function packageName(key, entry) {
  if (entry.name) return entry.name;
  const at = key.lastIndexOf(NODE_MODULES);
  return at < 0 ? key : key.slice(at + NODE_MODULES.length);
}

/** The entries npm fetched from a registry: not a workspace link, and with a resolved URL (the root has none). */
function fetchedEntries(lock) {
  return Object.entries(lock.packages).filter(([, entry]) => !entry.link && typeof entry.resolved === "string");
}

/**
 * @param {object} lock - a parsed lockfile
 * @returns {{ key: string, resolved: string }[]} the entries whose tarball is not on the public registry
 */
export function nonPublicResolved(lock) {
  return fetchedEntries(lock)
    .filter(([, entry]) => !entry.resolved.startsWith(PUBLIC_REGISTRY))
    .map(([key, entry]) => ({ key, resolved: entry.resolved }));
}

/** Does the URL name this package's tarball at this version, the way a registry does? */
function namesTarball({ resolved, version }, name) {
  return resolved.startsWith("https://") && resolved.endsWith(`/${name}/-/${unscoped(name)}-${version}.tgz`);
}

/** The rewrites for the entries that can be rewritten, one per URL, and the entries that cannot. */
function planRewrites(lock) {
  const fixes = new Map();
  const unfixable = [];
  for (const { key, resolved } of nonPublicResolved(lock)) {
    const entry = lock.packages[key];
    const name = packageName(key, entry);
    if (!namesTarball(entry, name)) {
      unfixable.push({ key, resolved });
      continue;
    }
    const fix = fixes.get(resolved) ?? { name, version: entry.version, from: resolved, to: publicTarballUrl(name, entry.version), keys: [] };
    fix.keys.push(key);
    fixes.set(resolved, fix);
  }
  return { fixes: [...fixes.values()], unfixable };
}

/**
 * @param {string} text - a lockfile's text
 * @returns {{ text: string, changed: { name: string, version: string, from: string, to: string }[], unfixable: { key: string, resolved: string }[] }}
 *   the text with a mirror's URLs rewritten to the public ones, what was rewritten, and what could not be
 */
export function normalizeLockText(text) {
  const { fixes, unfixable } = planRewrites(JSON.parse(text));
  const changed = [];
  let out = text;
  for (const fix of fixes) {
    const from = JSON.stringify(fix.from);
    if (out.includes(from)) {
      out = out.split(from).join(JSON.stringify(fix.to));
      changed.push(fix);
    } else {
      unfixable.push(...fix.keys.map((key) => ({ key, resolved: fix.from })));
    }
  }
  return { text: out, changed: changed.map(({ name, version, from, to }) => ({ name, version, from, to })), unfixable };
}

/** The lockfiles a git repository tracks, nested ones included. */
export function trackedLockfiles(root = REPO) {
  return execFileSync("git", ["ls-files", "*package-lock.json", "*npm-shrinkwrap.json"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean);
}

const listEntries = (entries) => entries.map(({ key, resolved }) => `  ${key}  ${resolved}`);

/** One lockfile: what it resolves from and, with `write`, what was rewritten. */
function processFile({ path, label }, write) {
  let text;
  let lock;
  try {
    text = readFileSync(path, "utf8");
    lock = JSON.parse(text);
    if (typeof lock?.packages !== "object" || lock.packages === null) {
      throw new Error('it has no "packages" map (npm 7 and later write one: lockfileVersion 2 or 3)');
    }
  } catch (err) {
    return { ok: false, lines: [`${label}: cannot read it as a lockfile: ${err.message}`] };
  }
  const found = nonPublicResolved(lock);
  if (found.length === 0) return { ok: true, lines: [`${label}: resolves only from the public registry`] };
  if (!write) {
    return { ok: false, lines: [`${label}: ${found.length} package(s) resolve from elsewhere; --write rewrites a mirror's URLs:`, ...listEntries(found)] };
  }
  const { text: fixed, changed, unfixable } = normalizeLockText(text);
  if (changed.length > 0) writeFileSync(path, fixed);
  const lines = [`${label}: rewrote ${changed.length} URL(s): ${changed.map(({ name, version }) => `${name}@${version}`).join(", ") || "none"}`];
  if (unfixable.length > 0) lines.push("  these cannot be rewritten (the URL is not that package's own tarball, or is written out differently in the file) and are left for a person:", ...listEntries(unfixable));
  return { ok: unfixable.length === 0, lines };
}

/** @returns {number} the exit status */
export function main(argv) {
  const unknown = argv.filter((arg) => arg.startsWith("--") && arg !== "--write");
  if (unknown.length > 0) {
    console.error(`unknown option: ${unknown.join(", ")}\nusage: node scripts/lock-registry.mjs [--write] [lockfile...]`);
    return 1;
  }
  const files = argv.filter((arg) => !arg.startsWith("--"));
  const targets = files.length > 0
    ? files.map((file) => ({ path: resolve(file), label: file }))
    : trackedLockfiles().map((name) => ({ path: join(REPO, name), label: name }));
  const results = targets.map((target) => processFile(target, argv.includes("--write")));
  for (const { lines } of results) console.log(lines.join("\n"));
  return results.every(({ ok }) => ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
