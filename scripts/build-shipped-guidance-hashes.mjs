#!/usr/bin/env node
/**
 * Build pforge-mcp/shipped-guidance-hashes.json — the content hashes of every
 * guidance file version Plan Forge has shipped (#280).
 *
 * `pforge update` (via pforge-mcp/update-guard.mjs) replaces a project's
 * instruction/prompt/agent/skill/hook/runbook file only when its content
 * matches one of these hashes; anything else is a customization and is kept.
 *
 * Sources: every release tag (v*) plus the current working tree, so the
 * release being prepared is included. Output is deterministic (sorted, no
 * timestamps) so an unchanged history produces an unchanged file.
 *
 * Usage:
 *   node scripts/build-shipped-guidance-hashes.mjs           # write the index
 *   node scripts/build-shipped-guidance-hashes.mjs --check   # exit 1 if a current file is missing
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { contentHash, INDEX_FILE } = await import(pathToFileURL(join(ROOT, "pforge-mcp", "update-guard.mjs")).href);
const INDEX_PATH = join(ROOT, "pforge-mcp", INDEX_FILE);

/** Directories whose files `pforge update` manages as guidance. */
export const GUIDANCE_ROOTS = Object.freeze([
  ".github/prompts",
  ".github/instructions",
  ".github/agents",
  ".github/skills",
  ".github/hooks",
  "presets",
  "templates",
  "docs/plans",
]);

const GIT_MAX_BUFFER = 268_435_456; // 256 MiB
const CAT_FILE_MAX_BUFFER = 536_870_912; // 512 MiB
const NEWLINE_BYTE = 0x0a;
const MAX_MISSING_LISTED = 20;

/** Development-only plan material never ships to projects. */
const DEV_ONLY = /^docs\/plans\/(Phase-|PHASE-|archive\/|cleanup-findings\/|testbed-)/;

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER, ...opts });
}

function isGuidancePath(path) {
  return !DEV_ONLY.test(path);
}

/** Blob ids of guidance files in every release tag. */
function taggedBlobIds() {
  const ids = new Set();
  const tags = git(["tag", "--list", "v*"]).split("\n").filter(Boolean);
  for (const tag of tags) {
    for (const entry of git(["ls-tree", "-r", "-z", tag, "--", ...GUIDANCE_ROOTS]).split("\0")) {
      const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
      if (match && isGuidancePath(match[2])) ids.add(match[1]);
    }
  }
  return { ids: [...ids], tags: tags.length };
}

/** Read blob contents in one `git cat-file --batch` call. */
function blobTexts(ids) {
  if (ids.length === 0) return [];
  const out = execFileSync("git", ["cat-file", "--batch"], { cwd: ROOT, input: ids.join("\n") + "\n", maxBuffer: CAT_FILE_MAX_BUFFER });
  const texts = [];
  let offset = 0;
  while (offset < out.length) {
    const headerEnd = out.indexOf(NEWLINE_BYTE, offset);
    const [, , size] = out.subarray(offset, headerEnd).toString("utf8").split(" ");
    const start = headerEnd + 1;
    texts.push(out.subarray(start, start + Number(size)).toString("utf8"));
    offset = start + Number(size) + 1;
  }
  return texts;
}

/** Hashes of the guidance files in the working tree, keyed by path. */
export function workingTreeHashes() {
  const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...GUIDANCE_ROOTS])
    .split("\0")
    .filter((p) => p && isGuidancePath(p) && existsSync(join(ROOT, p)));
  return new Map(files.map((p) => [p, contentHash(readFileSync(join(ROOT, p), "utf8"))]));
}

export function buildIndex() {
  const { ids, tags } = taggedBlobIds();
  const hashes = new Set(blobTexts(ids).map((text) => contentHash(text)));
  for (const hash of workingTreeHashes().values()) hashes.add(hash);
  return {
    about: "Content hashes of every guidance file version Plan Forge has shipped. pforge update replaces a project file only when its content matches one of these; see pforge-mcp/update-guard.mjs.",
    algorithm: "sha256 of UTF-8 text with BOM and CR removed, first 16 hex chars",
    releaseTags: tags,
    hashes: [...hashes].sort(),
  };
}

/** Current guidance files whose hash is missing from the committed index. */
export function missingFromIndex() {
  const indexed = new Set(JSON.parse(readFileSync(INDEX_PATH, "utf8")).hashes);
  return [...workingTreeHashes()].filter(([, hash]) => !indexed.has(hash)).map(([path]) => path);
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  if (process.argv.includes("--check")) {
    const missing = existsSync(INDEX_PATH) ? missingFromIndex() : ["(index file missing)"];
    if (missing.length) {
      console.error(`${INDEX_FILE} is stale; ${missing.length} current guidance file(s) are not indexed:`);
      for (const path of missing.slice(0, MAX_MISSING_LISTED)) console.error(`  ${path}`);
      console.error("Regenerate with: node scripts/build-shipped-guidance-hashes.mjs");
      process.exit(1);
    }
    console.log(`${INDEX_FILE} is current.`);
  } else {
    const index = buildIndex();
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
    console.log(`wrote ${INDEX_FILE}: ${index.hashes.length} hashes from ${index.releaseTags} release tags + working tree`);
  }
}
