#!/usr/bin/env node
/**
 * Preset build extractor (#309 Slice 1 — Shared Contract).
 *
 *   node scripts/audit/preset-build/extract.mjs --stack <name> --out <dir>
 *
 * Reads scripts/audit/preset-build/<stack>/manifest.json, validates that
 * every main-language block in presets/<stack> is mapped (`blocks`) or
 * explicitly skipped (`skip`, with a reason) and that every manifest entry
 * points at a block that still exists, then copies <stack>/scaffold/ to
 * <dir> and writes each mapped block to its target file: `replace` writes
 * the block as the whole file, `append` adds it to the end. `fill` token
 * substitutions run before the block is written.
 *
 * Exits 0 on success. Exits 1 and lists every unmapped or stale entry
 * instead of writing anything when validation fails.
 */

import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codeBlocks, readPreset } from "../preset-quality.mjs";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

// ─── Manifest ───────────────────────────────────────────────────────────────

/** Read and parse a stack's manifest.json. */
export function loadManifest(buildDir) {
  const path = join(buildDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (!manifest.stack) throw new Error(`${path}: missing "stack"`);
  return manifest;
}

/** A manifest's main language: `language` if set, else `stack`. */
function mainLanguage(manifest) {
  return manifest.language ?? manifest.stack;
}

/** Every fenced block of presets/<stack>, indexed per file+lang from 0. */
function indexPresetBlocks(presetDir) {
  const files = readPreset(presetDir);
  const index = [];
  for (const file of files) {
    const perLang = new Map();
    for (const block of codeBlocks(file.text)) {
      const i = perLang.get(block.lang) ?? 0;
      index.push({ file: file.rel, lang: block.lang, index: i, block });
      perLang.set(block.lang, i + 1);
    }
  }
  return index;
}

/** `file\tlang:index` key shared by manifest entries and indexed blocks. */
function entryKey(file, lang, index) {
  return `${file}\t${lang}:${index}`;
}

/**
 * Validate a manifest against presets/<stack>: every `blocks`/`skip` entry
 * must resolve to a real block (else it is "stale"), and every main-language
 * block in the preset must appear in `blocks` or `skip` (else "unmapped").
 * Every `skip` entry must carry a `reason`.
 */
export function validateManifest(manifest, presetsRoot = join(REPO, "presets")) {
  const presetDir = join(presetsRoot, manifest.stack);
  const indexed = indexPresetBlocks(presetDir);
  const byKey = new Map(indexed.map((e) => [entryKey(e.file, e.lang, e.index), e]));
  const lang = mainLanguage(manifest);
  const mapped = new Set();
  const stale = [];

  for (const entry of manifest.blocks ?? []) {
    const key = entryKey(entry.file, entry.lang, entry.index);
    if (!byKey.has(key)) {
      stale.push(`blocks: ${key}`);
      continue;
    }
    mapped.add(key);
  }
  for (const entry of manifest.skip ?? []) {
    const key = entryKey(entry.file, entry.lang ?? lang, entry.index);
    if (!entry.reason) {
      stale.push(`skip: ${key} (missing reason)`);
      continue;
    }
    if (!byKey.has(key)) {
      stale.push(`skip: ${key}`);
      continue;
    }
    mapped.add(key);
  }

  const unmapped = indexed
    .filter((e) => e.lang === lang)
    .map((e) => entryKey(e.file, e.lang, e.index))
    .filter((key) => !mapped.has(key));

  return { unmapped, stale };
}

function applyFill(body, fill) {
  if (!fill) return body;
  return Object.entries(fill).reduce((out, [token, value]) => out.split(token).join(value), body);
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Validate `manifest.json` in `buildDir`, then copy `buildDir/scaffold` to
 * `outDir` and write every mapped block over it. Returns `{ ok: true }` on
 * success, or `{ ok: false, unmapped, stale }` without touching `outDir`.
 */
export function extractStack({ buildDir, presetsRoot = join(REPO, "presets"), outDir }) {
  const manifest = loadManifest(buildDir);
  const { unmapped, stale } = validateManifest(manifest, presetsRoot);
  if (unmapped.length || stale.length) return { ok: false, unmapped, stale };

  const presetDir = join(presetsRoot, manifest.stack);
  const indexed = indexPresetBlocks(presetDir);
  const byKey = new Map(indexed.map((e) => [entryKey(e.file, e.lang, e.index), e.block]));

  mkdirSync(outDir, { recursive: true });
  cpSync(join(buildDir, "scaffold"), outDir, { recursive: true });

  for (const entry of manifest.blocks ?? []) {
    const block = byKey.get(entryKey(entry.file, entry.lang, entry.index));
    const body = applyFill(block.body, entry.fill);
    const target = join(outDir, entry.to);
    mkdirSync(dirname(target), { recursive: true });
    if (entry.mode === "append") appendFileSync(target, body);
    else writeFileSync(target, body);
  }

  return { ok: true };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--stack") out.stack = argv[++i];
    else if (key === "--out") out.out = argv[++i];
    else if (key === "--repo") out.repo = argv[++i]; // test-only override of the repo root
  }
  return out;
}

function main() {
  const { stack, out, repo } = parseArgs(process.argv.slice(2));
  if (!stack || !out) {
    console.error("usage: extract.mjs --stack <name> --out <dir>");
    return 2;
  }
  const root = repo ? resolve(repo) : REPO;
  const buildDir = join(root, "scripts", "audit", "preset-build", stack);
  const presetsRoot = join(root, "presets");
  const result = extractStack({ buildDir, presetsRoot, outDir: resolve(out) });
  if (!result.ok) {
    for (const e of result.stale) console.error(`stale\t${e}`);
    for (const e of result.unmapped) console.error(`unmapped\t${e}`);
    console.error(`${stack}: ${result.stale.length} stale, ${result.unmapped.length} unmapped entr${result.unmapped.length === 1 ? "y" : "ies"}`);
    return 1;
  }
  console.log(`extracted ${stack} -> ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`extract: ${err.message}`);
    process.exitCode = 2;
  }
}
