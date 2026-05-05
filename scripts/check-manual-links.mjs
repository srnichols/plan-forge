#!/usr/bin/env node
/**
 * Plan Forge — Manual internal-link checker
 *
 * Phase MANUAL-RESTRUCTURE Slice 1
 *
 * Walks every docs/manual/*.html file, extracts <a href> navigation links,
 * and verifies that every internal link resolves to an existing file/anchor.
 *
 * NOTE: Only <a href> links are checked (navigation links). Script/link/img
 * assets are excluded — those are managed separately from navigation integrity.
 *
 * Exit codes:
 *   0  — no broken internal links (or only pre-existing baseline issues)
 *   1  — one or more NEW broken links found (beyond baseline)
 *
 * Usage:
 *   node scripts/check-manual-links.mjs                  # check vs baseline
 *   node scripts/check-manual-links.mjs --save-baseline  # record current state as baseline
 *   node scripts/check-manual-links.mjs --include-external  # also warn on dead external hrefs (best-effort)
 *   node scripts/check-manual-links.mjs --verbose        # print every link checked
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MANUAL_DIR = join(ROOT, "docs", "manual");

const INCLUDE_EXTERNAL = process.argv.includes("--include-external");
const VERBOSE = process.argv.includes("--verbose");
const SAVE_BASELINE = process.argv.includes("--save-baseline");

const BASELINE_FILE = join(ROOT, ".check-manual-links-baseline.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(...args) {
  if (VERBOSE) console.log(...args);
}

/** Extract only <a href="..."> navigation link values from an HTML string. */
function extractLinks(html) {
  const links = [];
  // Only match href inside <a> tags — exclude <link>, <script src>, <img src>
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    links.push(m[1]);
  }
  return links;
}

/** Extract all id="..." values from an HTML string (for anchor resolution). */
function extractIds(html) {
  const ids = new Set();
  const re = /\bid=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return ids;
}

/** Determine whether a URL is external (http/https/mailto/etc). */
function isExternal(href) {
  return /^(https?:|mailto:|ftp:|\/\/)/i.test(href);
}

/** Determine whether a URL is an asset CDN (tailwind, fonts, etc.) — always skip. */
function isCdnOrFont(href) {
  return /cdn\.tailwindcss|fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/i.test(href);
}

// ─── Cache: id sets per HTML file ─────────────────────────────────────────────
const idCache = new Map();

function getIds(filePath) {
  if (idCache.has(filePath)) return idCache.get(filePath);
  if (!existsSync(filePath)) return new Set();
  const html = readFileSync(filePath, "utf8");
  const ids = extractIds(html);
  idCache.set(filePath, ids);
  return ids;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const htmlFiles = readdirSync(MANUAL_DIR)
  .filter((f) => extname(f) === ".html")
  .map((f) => join(MANUAL_DIR, f));

let brokenCount = 0;
const findings = [];

for (const filePath of htmlFiles) {
  const html = readFileSync(filePath, "utf8");
  const links = extractLinks(html);
  const fileDir = dirname(filePath);
  const fileName = filePath.replace(MANUAL_DIR + "\\", "").replace(MANUAL_DIR + "/", "");

  for (const href of links) {
    // Skip data URIs and empty
    if (!href || href.startsWith("data:")) continue;

    if (isCdnOrFont(href)) {
      log(`  [SKIP CDN] ${href}`);
      continue;
    }

    if (isExternal(href)) {
      log(`  [EXTERNAL] ${href}`);
      // external link checking is best-effort and not currently implemented
      // (--include-external is a placeholder for future HTTP HEAD requests)
      continue;
    }

    // Pure anchor link (#something) — resolve against current file
    if (href.startsWith("#")) {
      const anchor = href.slice(1);
      const ids = getIds(filePath);
      if (!ids.has(anchor)) {
        const msg = `${fileName}: broken anchor "${href}" (id not found in same file)`;
        findings.push(msg);
        brokenCount++;
        console.warn(`  ✗ ${msg}`);
      } else {
        log(`  [OK anchor] ${fileName}${href}`);
      }
      continue;
    }

    // Split path from fragment
    const hashIdx = href.indexOf("#");
    const path = hashIdx === -1 ? href : href.slice(0, hashIdx);
    const anchor = hashIdx === -1 ? null : href.slice(hashIdx + 1);

    // Resolve the path relative to the current file's directory
    const resolvedPath = resolve(fileDir, path);

    if (!existsSync(resolvedPath)) {
      const msg = `${fileName}: broken link "${href}" (file not found: ${resolvedPath.replace(ROOT, "")})`;
      findings.push(msg);
      brokenCount++;
      console.warn(`  ✗ ${msg}`);
      continue;
    }

    log(`  [OK file] ${href}`);

    // Check anchor in target file (only for .html targets)
    if (anchor && extname(resolvedPath) === ".html") {
      const targetIds = getIds(resolvedPath);
      if (!targetIds.has(anchor)) {
        const msg = `${fileName}: broken anchor "${href}" (id "${anchor}" not found in ${path})`;
        findings.push(msg);
        brokenCount++;
        console.warn(`  ✗ ${msg}`);
      } else {
        log(`  [OK anchor] ${href}`);
      }
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("");
console.log(`Manual link check complete — ${htmlFiles.length} files scanned`);

if (SAVE_BASELINE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(findings, null, 2), "utf8");
  console.log(`✓ Baseline saved to ${BASELINE_FILE.replace(ROOT, ".")} (${findings.length} known issue(s))`);
  process.exit(0);
}

// Load baseline to filter out known pre-existing issues
let baseline = [];
if (existsSync(BASELINE_FILE)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  } catch {
    console.warn("Warning: could not parse baseline file — treating all issues as new.");
  }
}

const baselineSet = new Set(baseline);
const newFindings = findings.filter((f) => !baselineSet.has(f));

if (baseline.length > 0 && findings.length > newFindings.length) {
  const knownCount = findings.length - newFindings.length;
  console.log(`  (${knownCount} pre-existing baseline issue(s) suppressed)`);
}

if (newFindings.length === 0) {
  console.log("✓ No broken internal links found.");
  process.exit(0);
} else {
  console.log(`✗ ${newFindings.length} broken link(s) found:`);
  for (const f of newFindings) console.log(`  • ${f}`);
  process.exit(1);
}
