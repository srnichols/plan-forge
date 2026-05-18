#!/usr/bin/env node
/**
 * Plan Forge Manual — Maintenance Script
 *
 * Run after adding or editing any chapter to keep everything in sync.
 *
 *   node docs/manual/maintain.mjs            # Audit + regenerate book-index.html
 *   node docs/manual/maintain.mjs --audit    # Audit only (no writes)
 *   node docs/manual/maintain.mjs --quiet    # Suppress progress, only show issues
 *
 * Adapted from TheBook's maintain.js. Checks:
 *   1. Every HTML file in docs/manual/ is registered in CHAPTERS (assets/manual.js)
 *   2. Every internal href="...html" link points to an existing file
 *   3. Each chapter has the standard shell (lang="en", #manual-sidebar,
 *      .chapter-content, manual.js include)
 *   3b. Chapter numbers in <title>, in-body badges, and cross-references
 *       match the canonical num/act in assets/manual.js (audit-only — never
 *       auto-rewrites; chapter numbers carry narrative meaning).
 *   3c. Glossary tooltip terms — parses glossary.html tables, regenerates
 *       assets/glossary-terms.js so hover-tooltips stay in sync. In --audit
 *       mode, warns on drift; in normal mode, rewrites unconditionally.
 *   4. Substitutes <!--c:KEY-->VALUE<!--/c--> tokens against MANUAL_COUNTS
 *      so chapter prose stays in sync with a single source of truth.
 *   5. Re-generates the A–Z body of book-index.html from CHAPTERS + SEARCH_SECTIONS
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUAL_DIR = __dirname;
const ASSETS_DIR = path.join(MANUAL_DIR, "assets");
const MANUAL_JS = path.join(ASSETS_DIR, "manual.js");
const BOOK_INDEX = path.join(MANUAL_DIR, "book-index.html");

const args = process.argv.slice(2);
const auditOnly = args.includes("--audit");
const quiet = args.includes("--quiet");

const log = (...m) => { if (!quiet) console.log(...m); };
const issues = [];

log("\n┌──────────────────────────────────────────────────────┐");
log("│  Plan Forge Manual — Maintenance                    │");
log("│  Mode: " + (auditOnly ? "AUDIT ONLY" : "AUDIT + REGENERATE") + (auditOnly ? "                              " : "                       ") + "│");
log("└──────────────────────────────────────────────────────┘\n");

// ─── Step 1: Extract CHAPTERS + SEARCH_SECTIONS from manual.js ───
log("1. Parsing assets/manual.js…");
const manualJsSrc = fs.readFileSync(MANUAL_JS, "utf8");

// Run the IIFE inside a VM context with a minimal browser shim so the arrays
// inside the closure can be captured.
let CHAPTERS = [];
let SEARCH_SECTIONS = [];
let MANUAL_COUNTS = {};
try {
  // Inject an export hook INSIDE the IIFE (right before the final '})();' so
  // CHAPTERS / SEARCH_SECTIONS / MANUAL_COUNTS are still in scope) so we can capture them.
  const exportLine =
    '\n  globalThis.__PFORGE_CHAPTERS = CHAPTERS;' +
    '\n  globalThis.__PFORGE_SECTIONS = SEARCH_SECTIONS;' +
    '\n  globalThis.__PFORGE_COUNTS = (typeof MANUAL_COUNTS !== "undefined") ? MANUAL_COUNTS : {};\n';
  const iifeCloseRe = /\}\)\(\);\s*$/;
  if (!iifeCloseRe.test(manualJsSrc)) {
    throw new Error("Could not locate IIFE close '})();' at end of manual.js");
  }
  const patched = manualJsSrc.replace(iifeCloseRe, exportLine + "})();\n");
  const ctx = {
    document: {
      addEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ className: "", innerHTML: "", appendChild: () => {}, setAttribute: () => {}, addEventListener: () => {} }),
      createDocumentFragment: () => ({ appendChild: () => {} }),
    },
    window: {},
    location: { pathname: "/" },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(patched, ctx, { filename: "manual.js" });
  CHAPTERS = ctx.__PFORGE_CHAPTERS || [];
  SEARCH_SECTIONS = ctx.__PFORGE_SECTIONS || [];
  MANUAL_COUNTS = ctx.__PFORGE_COUNTS || {};
} catch (err) {
  console.error("   ✗ Failed to evaluate manual.js:", err.message);
  process.exit(1);
}
log(`   ✓ Parsed ${CHAPTERS.length} chapters, ${SEARCH_SECTIONS.length} indexed sections, ${Object.keys(MANUAL_COUNTS).length} count keys`);

// ─── Step 2: Scan HTML files ───
log("\n2. Scanning docs/manual/*.html…");
const allHtml = fs
  .readdirSync(MANUAL_DIR)
  .filter((f) => f.endsWith(".html"))
  .sort();
log(`   Found ${allHtml.length} HTML files`);

const knownFiles = new Set(CHAPTERS.map((c) => c.file));

// ─── Step 3: Sidebar coverage ───
log("\n3. Checking sidebar nav coverage…");
let navMissing = 0;
for (const file of allHtml) {
  if (file === "index.html") continue;
  if (!knownFiles.has(file)) {
    issues.push({ severity: "HIGH", type: "NAV", file, msg: "Not registered in CHAPTERS — won't appear in the sidebar" });
    navMissing++;
  }
}
log(`   ${navMissing === 0 ? "✓ All HTML files registered" : "✗ " + navMissing + " files missing from CHAPTERS"}`);

// ─── Step 4: Validate internal links ───
log("\n4. Validating internal links…");
const existing = new Set(allHtml);
let totalLinks = 0;
let brokenLinks = 0;
const linkRegex = /href="([^"#]+\.html)(?:#[^"]*)?"/g;
for (const file of allHtml) {
  const content = fs.readFileSync(path.join(MANUAL_DIR, file), "utf8");
  let m;
  while ((m = linkRegex.exec(content)) !== null) {
    totalLinks++;
    const target = m[1];
    if (target.startsWith("http") || target.startsWith("//") || target.startsWith("../")) continue;
    const base = target.includes("/") ? path.basename(target) : target;
    if (!existing.has(base) && !fs.existsSync(path.join(MANUAL_DIR, target))) {
      issues.push({ severity: "HIGH", type: "LINK", file, msg: `Broken link: href="${target}"` });
      brokenLinks++;
    }
  }
}
log(`   Checked ${totalLinks} internal links`);
log(`   ${brokenLinks === 0 ? "✓ All internal links resolve" : "✗ " + brokenLinks + " broken links"}`);

// ─── Step 4b: Forbid local-relative .md links (manual is HTML for end users) ───
log("\n4b. Checking for local .md links (manual is HTML for users)…");
let mdLinks = 0;
const mdRegex = /href="(?!https?:|mailto:)([^"#]+\.md(?:#[^"]*)?)"/g;
for (const file of allHtml) {
  const content = fs.readFileSync(path.join(MANUAL_DIR, file), "utf8");
  let m;
  while ((m = mdRegex.exec(content)) !== null) {
    issues.push({
      severity: "HIGH",
      type: "MD-LINK",
      file,
      msg: `Local .md link: href="${m[1]}" — link to an HTML page in the manual or use a full https://github.com/ URL labelled 'on GitHub'`,
    });
    mdLinks++;
  }
}
log(`   ${mdLinks === 0 ? "✓ No local .md links — all user-facing links go to HTML" : "✗ " + mdLinks + " local .md links found"}`);

// ─── Step 5: Chapter shell sanity ───
log("\n5. Checking chapter shell…");
let shellIssues = 0;
const SHELL_CHECKS = [
  { needle: 'lang="en"', what: 'lang="en" on <html>', sev: "LOW" },
  { needle: 'id="manual-sidebar"', what: "manual-sidebar aside", sev: "MEDIUM" },
  { needle: "chapter-content", what: ".chapter-content wrapper", sev: "MEDIUM" },
  { needle: "assets/manual.js", what: "manual.js include", sev: "HIGH" },
];
for (const file of allHtml) {
  if (file === "index.html") continue;
  const content = fs.readFileSync(path.join(MANUAL_DIR, file), "utf8");
  for (const check of SHELL_CHECKS) {
    if (!content.includes(check.needle)) {
      issues.push({ severity: check.sev, type: "SHELL", file, msg: `Missing ${check.what}` });
      shellIssues++;
    }
  }
}
log(`   ${shellIssues === 0 ? "✓ All chapters have the standard shell" : "✗ " + shellIssues + " shell issues"}`);

// ─── Step 5b: Chapter-number consistency ───
//
// Detects drift between manual.js (source of truth for chapter numbers) and:
//   (a) <title>Chapter N: ...</title>
//   (b) in-body badge   <div class="...uppercase tracking-wider...">Chapter N</div>
//                       (also: "Act III — Guard · Chapter N", "Chapter N · Settings Group")
//   (c) cross-refs      <a href="X.html">Chapter N — ...</a>
//
// AUDIT-ONLY (never auto-rewrites). Chapter numbers carry narrative meaning;
// a mismatch could mean manual.js is wrong, the badge is wrong, or the cross-ref
// is wrong. Surface the discrepancy and let a human decide.
//
// This step exists because earlier renumbers (Part IV memory-first reorder,
// Crucible/Writing-Plans swap) updated manual.js + sidebar but left chapter
// pages and cross-refs with stale labels — and prior --audit runs didn't notice.
log("\n5b. Checking chapter-number consistency (titles, badges, cross-refs)…");
const fileToChapter = new Map(CHAPTERS.map((c) => [c.file, c]));
const TITLE_CHAPTER_RE = /<title>\s*Chapter\s+(\d+)\s*[:·]/i;
const BADGE_RE = /<div\s+class="[^"]*\buppercase\s+tracking-wider\b[^"]*"[^>]*>([^<]*?Chapter\s+(\d+)[^<]*)<\/div>/gi;
const XREF_RE = /<a\s+href="([a-z0-9-]+)\.html(?:#[^"]*)?"[^>]*>\s*Chapter\s+(\d+)\b/gi;
let titleDrifts = 0;
let badgeDrifts = 0;
let xrefDrifts = 0;
const knownNums = new Set(CHAPTERS.map((c) => String(c.num)).filter(Boolean));
for (const file of allHtml) {
  if (file === "index.html") continue;
  const chapter = fileToChapter.get(file);
  if (!chapter) continue;
  const content = fs.readFileSync(path.join(MANUAL_DIR, file), "utf8");

  // (a) <title> tag — only validate for numbered chapters
  if (chapter.num) {
    const titleMatch = TITLE_CHAPTER_RE.exec(content);
    if (titleMatch && titleMatch[1] !== String(chapter.num)) {
      issues.push({ severity: "HIGH", type: "CHNUM", file,
        msg: `<title> says "Chapter ${titleMatch[1]}" but manual.js has num="${chapter.num}" — update <title> or assets/manual.js` });
      titleDrifts++;
    }
  }

  // (b) in-body badge
  const badgeRe = new RegExp(BADGE_RE.source, BADGE_RE.flags);
  let bm;
  while ((bm = badgeRe.exec(content)) !== null) {
    const badgeText = bm[1].trim();
    const badgeNum = bm[2];
    if (chapter.num) {
      // Numbered chapter: badge must match own num exactly
      if (badgeNum !== String(chapter.num)) {
        issues.push({ severity: "HIGH", type: "CHNUM", file,
          msg: `Badge "${badgeText}" says "Chapter ${badgeNum}" but manual.js has num="${chapter.num}"` });
        badgeDrifts++;
      }
    } else {
      // Sub-chapter (num=""): badge references the parent chapter's num.
      // Surface drift only if no registered chapter has that number at all
      // (catches stale references to deleted/renumbered parents).
      if (!knownNums.has(badgeNum)) {
        issues.push({ severity: "MEDIUM", type: "CHNUM", file,
          msg: `Sub-chapter badge "${badgeText}" references Chapter ${badgeNum}, but no chapter in manual.js has num="${badgeNum}"` });
        badgeDrifts++;
      }
    }
  }

  // (c) cross-references — link text starting with "Chapter N"
  const xrefRe = new RegExp(XREF_RE.source, XREF_RE.flags);
  let xm;
  while ((xm = xrefRe.exec(content)) !== null) {
    const targetFile = xm[1] + ".html";
    const xrefNum = xm[2];
    const target = fileToChapter.get(targetFile);
    if (!target || !target.num) continue; // unknown target or sub-chapter target → skip
    if (xrefNum !== String(target.num)) {
      issues.push({ severity: "HIGH", type: "CHNUM", file,
        msg: `Cross-ref "Chapter ${xrefNum} → ${targetFile}" but manual.js says ${targetFile} has num="${target.num}"` });
      xrefDrifts++;
    }
  }
}
const totalChnumDrifts = titleDrifts + badgeDrifts + xrefDrifts;
log(`   ${totalChnumDrifts === 0 ? "✓ All chapter numbers in sync" : `✗ ${totalChnumDrifts} drift(s) — ${titleDrifts} <title>, ${badgeDrifts} badge, ${xrefDrifts} cross-ref`}`);

// ─── Step 5c: Act consistency (Roman numeral in badge vs manual.js act) ───
//
// When a badge includes "Act <ROMAN> — <name>", the roman must match the
// chapter's `act` field in manual.js. Catches the Part III ↔ Part IV mix-up
// (e.g. LiveGuard chapters labeled "Act IV — Guard" when LiveGuard is Part III).
log("\n5c. Checking Act/Part consistency in badges…");
const ACT_IN_BADGE_RE = /<div\s+class="[^"]*\buppercase\s+tracking-wider\b[^"]*"[^>]*>([^<]*?Act\s+(I{1,3}|IV|V)\b[^<]*)<\/div>/gi;
let actDrifts = 0;
for (const file of allHtml) {
  if (file === "index.html") continue;
  const chapter = fileToChapter.get(file);
  if (!chapter || !chapter.act) continue;
  // Only validate when chapter.act is a Roman numeral (skip "Appendix", "Quickstart")
  if (!/^(I{1,3}|IV|V)$/.test(chapter.act)) continue;
  const content = fs.readFileSync(path.join(MANUAL_DIR, file), "utf8");
  const actRe = new RegExp(ACT_IN_BADGE_RE.source, ACT_IN_BADGE_RE.flags);
  let am;
  while ((am = actRe.exec(content)) !== null) {
    const badgeText = am[1].trim();
    const badgeAct = am[2];
    if (badgeAct !== chapter.act) {
      issues.push({ severity: "HIGH", type: "ACT", file,
        msg: `Badge "${badgeText}" says "Act ${badgeAct}" but manual.js has act="${chapter.act}"` });
      actDrifts++;
    }
  }
}
log(`   ${actDrifts === 0 ? "✓ All Act labels match manual.js" : `✗ ${actDrifts} Act drift(s)`}`);

// ─── Step 5d: Glossary tooltip terms sync ───
//
// Source of truth: docs/manual/glossary.html — the curated glossary tables.
// Generated artifact: docs/manual/assets/glossary-terms.js — `window.GLOSSARY_TERMS`
// dictionary consumed at runtime by assets/glossary-tooltips.js.
//
// In --audit mode: warns on drift (MEDIUM GLOSSARY issue) and does not write.
// In normal mode: regenerates the file unconditionally (idempotent).
//
// Skip list: common-English words that share names with Plan Forge concepts
// (Run, Hub, Span, Index, Trace, Smith, Sweep, Bridge, Step, Act, Forge,
// Plan). These remain in the glossary itself but are excluded from
// auto-tooltipping to prevent false-positive highlights in prose.
log("\n5d. Syncing glossary tooltip terms (glossary.html → assets/glossary-terms.js)…");
const glossaryHtmlPath = path.join(MANUAL_DIR, "glossary.html");
const glossaryTermsPath = path.join(ASSETS_DIR, "glossary-terms.js");
const ROW_RE = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
const STRONG_RE = /<strong>([\s\S]*?)<\/strong>/i;
const HTML_TAG_RE = /<[^>]+>/g;
const HTML_ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&mdash;": "—", "&ndash;": "–", "&hellip;": "…", "&nbsp;": " ",
  "&ldquo;": '"', "&rdquo;": '"', "&lsquo;": "'", "&rsquo;": "'",
};
const stripHtml = (s) =>
  s.replace(HTML_TAG_RE, "")
   .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m] ?? m)
   .replace(/\s+/g, " ")
   .trim();

const SKIP_TERMS = [
  "Run", "Index", "Hub", "Span", "Trace", "Smith", "Sweep",
  "Bridge", "Step", "Act", "Forge", "Plan",
];

const terms = {};
let rowMatch;
if (fs.existsSync(glossaryHtmlPath)) {
  const glossaryHtml = fs.readFileSync(glossaryHtmlPath, "utf8");
  while ((rowMatch = ROW_RE.exec(glossaryHtml)) !== null) {
    const termCell = rowMatch[1];
    const defCell = rowMatch[2];
    const sm = STRONG_RE.exec(termCell);
    if (!sm) continue;
    const term = stripHtml(sm[1]);
    if (!term) continue;
    const definition = stripHtml(defCell);
    if (!definition) continue;
    // Truncate very long definitions for tooltip readability (~300 chars).
    const truncated = definition.length > 300
      ? definition.slice(0, 297).trim() + "…"
      : definition;
    // First occurrence wins (in case of duplicate term entries across sections).
    if (!(term in terms)) terms[term] = truncated;
  }
} else {
  issues.push({ severity: "HIGH", type: "GLOSSARY", file: "glossary.html",
    msg: "glossary.html not found — cannot generate tooltip terms" });
}

const generated =
  "/* AUTO-GENERATED by docs/manual/maintain.mjs (Step 5d). DO NOT EDIT BY HAND.\n" +
  " * Source of truth: docs/manual/glossary.html\n" +
  " * Re-generate:    node docs/manual/maintain.mjs\n" +
  " * Terms:          " + Object.keys(terms).length + "\n" +
  " * Skipped:        " + SKIP_TERMS.length + " (common-word collisions)\n" +
  " */\n" +
  "window.GLOSSARY_TERMS = " + JSON.stringify(terms, null, 2) + ";\n" +
  "window.GLOSSARY_TERM_OPTS = { skip: " + JSON.stringify(SKIP_TERMS) + " };\n";

const existingTerms = fs.existsSync(glossaryTermsPath)
  ? fs.readFileSync(glossaryTermsPath, "utf8")
  : null;

if (existingTerms === generated) {
  log(`   ✓ glossary-terms.js up to date (${Object.keys(terms).length} terms)`);
} else if (auditOnly) {
  issues.push({ severity: "MEDIUM", type: "GLOSSARY", file: "assets/glossary-terms.js",
    msg: `Drift between glossary.html and assets/glossary-terms.js — run 'node docs/manual/maintain.mjs' to regenerate (${Object.keys(terms).length} source terms)` });
  log(`   ✗ Drift — would regenerate (${Object.keys(terms).length} terms)`);
} else {
  fs.writeFileSync(glossaryTermsPath, generated, "utf8");
  log(`   ✓ Regenerated glossary-terms.js (${Object.keys(terms).length} terms, ${SKIP_TERMS.length} skipped)`);
}

// ─── Step 6: Substitute count tokens (single source of truth) ───
//
// Token format in HTML chapter files:
//   <!--c:KEY-->VALUE<!--/c-->
// where KEY is a property name in MANUAL_COUNTS (assets/manual.js).
// Example:
//   The MCP server ships <!--c:tools-->74<!--/c--> tools today.
//
// In audit mode (--audit) drift is flagged but no files are written. In normal
// mode the VALUE between the tokens is rewritten in-place to MANUAL_COUNTS[KEY].
log("\n6. Substituting count tokens (<!--c:KEY-->...<!--/c-->)…");
const COUNT_TOKEN_RE = /<!--c:([a-zA-Z][a-zA-Z0-9_]*)-->([^<]*)<!--\/c-->/g;
let countTokensSeen = 0;
let countTokensRewritten = 0;
let countFilesTouched = 0;
let unknownKeys = 0;
for (const file of allHtml) {
  const filePath = path.join(MANUAL_DIR, file);
  let content = fs.readFileSync(filePath, "utf8");
  let fileChanged = false;
  const replaced = content.replace(COUNT_TOKEN_RE, (match, key, oldValue) => {
    countTokensSeen++;
    if (!(key in MANUAL_COUNTS)) {
      issues.push({ severity: "MEDIUM", type: "COUNT", file, msg: `Unknown count key '<!--c:${key}-->' — add it to MANUAL_COUNTS in assets/manual.js or fix the typo` });
      unknownKeys++;
      return match;
    }
    const newValue = String(MANUAL_COUNTS[key]);
    if (oldValue === newValue) return match;
    countTokensRewritten++;
    fileChanged = true;
    if (auditOnly) {
      issues.push({ severity: "LOW", type: "COUNT", file, msg: `Drift in <!--c:${key}-->: file has '${oldValue}', source-of-truth says '${newValue}' (run without --audit to fix)` });
    }
    return `<!--c:${key}-->${newValue}<!--/c-->`;
  });
  if (fileChanged && !auditOnly) {
    fs.writeFileSync(filePath, replaced, "utf8");
    countFilesTouched++;
  }
}
if (auditOnly) {
  log(`   Inspected ${countTokensSeen} token(s) across ${allHtml.length} files — ${countTokensRewritten} drift, ${unknownKeys} unknown key(s)`);
} else {
  log(`   ${countTokensSeen === 0 ? "✓ No count tokens yet" : "✓ " + countTokensSeen + " token(s) processed"}` +
      (countTokensRewritten > 0 ? ` — ${countTokensRewritten} rewritten across ${countFilesTouched} file(s)` : "") +
      (unknownKeys > 0 ? ` — ${unknownKeys} unknown key(s) (see issues)` : ""));
}

// ─── Step 6b: Wrap bare diagram images in <figure> with derived caption ───
//
// Apress-style numbered figure plumbing lands in Phase 2. For now we just give
// every diagram a visible one-line caption derived from the alt text title clause
// (everything before the first colon or sentence-stop).
//
// Figures already wrapped manually are left alone. Auto-derived captions carry a
// <!--cap:auto-->...<!--/cap--> marker so future re-runs can refresh them when
// the alt text changes.
log("\n6b. Wrapping bare diagram images in <figure>+<figcaption>…");
const DIAGRAM_IMG_RE = /<img\b([^>]*\bclass="[^"]*\bdiagram-img\b[^"]*"[^>]*?)\/?>/gi;
const FIGURE_BLOCK_RE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi;
const ALT_ATTR_RE = /\balt="([^"]*)"/i;
const AUTO_CAP_RE = /<figcaption\b([^>]*)>\s*<!--cap:auto-->[\s\S]*?<!--\/cap-->\s*<\/figcaption>/i;
let figuresWrapped = 0;
let captionsRefreshed = 0;
let figureFilesTouched = 0;
function deriveCaption(alt) {
  if (!alt) return null;
  // Cut at first colon or sentence-stop (period followed by whitespace/end)
  const colonIdx = alt.indexOf(":");
  const periodMatch = alt.match(/\.(\s|$)/);
  const periodIdx = periodMatch ? periodMatch.index : -1;
  let cut = -1;
  if (colonIdx !== -1 && periodIdx !== -1) cut = Math.min(colonIdx, periodIdx);
  else if (colonIdx !== -1) cut = colonIdx;
  else if (periodIdx !== -1) cut = periodIdx;
  let title = cut === -1 ? alt : alt.slice(0, cut);
  title = title.trim();
  // Tail-trim to keep things tight; ellipsize if still long
  if (title.length > 90) title = title.slice(0, 87).trimEnd() + "…";
  if (title.length < 5) return null;
  return title;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
for (const file of allHtml) {
  if (file === "index.html") continue;
  const filePath = path.join(MANUAL_DIR, file);
  let content = fs.readFileSync(filePath, "utf8");
  const before = content;

  // Pass A: refresh existing auto-captions inside <figure> blocks containing a diagram-img
  content = content.replace(FIGURE_BLOCK_RE, (whole, figAttrs, inner) => {
    const imgMatch = /<img\b([^>]*\bclass="[^"]*\bdiagram-img\b[^"]*"[^>]*?)\/?>/i.exec(inner);
    if (!imgMatch) return whole;
    const altMatch = ALT_ATTR_RE.exec(imgMatch[1]);
    if (!altMatch) return whole;
    const caption = deriveCaption(altMatch[1]);
    if (!caption) return whole;
    if (!AUTO_CAP_RE.test(inner)) return whole; // hand-authored caption — never touch
    const newInner = inner.replace(AUTO_CAP_RE, (_, capAttrs) => {
      const re = new RegExp(`<!--cap:auto-->([\\s\\S]*?)<!--\\/cap-->`);
      const existing = re.exec(_); // _ is the matched figcaption
      const oldText = existing ? existing[1] : "";
      if (oldText === escapeHtml(caption)) return _; // no change
      captionsRefreshed++;
      return `<figcaption${capAttrs}><!--cap:auto-->${escapeHtml(caption)}<!--/cap--></figcaption>`;
    });
    return `<figure${figAttrs}>${newInner}</figure>`;
  });

  // Pass B: wrap bare diagram-img tags that aren't already inside a <figure>
  const figureRanges = [];
  {
    let m;
    const reScan = /<figure\b[\s\S]*?<\/figure>/gi;
    while ((m = reScan.exec(content)) !== null) figureRanges.push([m.index, m.index + m[0].length]);
  }
  const inFigure = (pos) => figureRanges.some(([s, e]) => pos >= s && pos < e);

  let out = "";
  let lastEnd = 0;
  let m;
  // Reset the lastIndex; we share DIAGRAM_IMG_RE across iterations of the outer file loop.
  DIAGRAM_IMG_RE.lastIndex = 0;
  while ((m = DIAGRAM_IMG_RE.exec(content)) !== null) {
    if (inFigure(m.index)) continue;
    const altMatch = ALT_ATTR_RE.exec(m[1]);
    if (!altMatch) continue;
    const caption = deriveCaption(altMatch[1]);
    if (!caption) continue;
    const figureBlock = `<figure class="manual-figure">${m[0]}<figcaption class="manual-figcaption"><!--cap:auto-->${escapeHtml(caption)}<!--/cap--></figcaption></figure>`;
    out += content.slice(lastEnd, m.index) + figureBlock;
    lastEnd = m.index + m[0].length;
    figuresWrapped++;
  }
  out += content.slice(lastEnd);
  content = out;

  if (content !== before) {
    if (!auditOnly) fs.writeFileSync(filePath, content, "utf8");
    figureFilesTouched++;
    if (auditOnly) {
      issues.push({ severity: "LOW", type: "FIG", file, msg: `Diagram caption updates pending (run without --audit to apply)` });
    }
  }
}
log(`   ${(figuresWrapped + captionsRefreshed) === 0 ? "✓ All diagrams already captioned" : "✓ " + figuresWrapped + " new wrap(s), " + captionsRefreshed + " refresh(es) across " + figureFilesTouched + " file(s)"}` + (auditOnly ? " (audit-only — no writes)" : ""));

// ─── Step 6c: Number figures (Apress-style) and collect for List of Figures ───
//
// Each <figure class="manual-figure"> in a numbered chapter (chapter.num !== "")
// gets a "Figure {chapter.num}-{counter}." prefix injected at the start of its
// figcaption, plus a stable id="fig-{chapter.num}-{counter}" attribute on the
// <figure> tag. Idempotent via the <!--fignum-->...<!--/fignum--> marker:
// re-runs strip the existing prefix and re-emit from the current counter.
//
// Figures in unnumbered chapters (sub-chapters, deep dives, front matter) are
// left un-numbered — they're still wrapped and captioned, just not enrolled in
// the Figure x-y scheme.
log("\n6c. Numbering figures and collecting List of Figures…");
const FIG_BLOCK_RE = /<figure\b([^>]*\bclass="[^"]*\bmanual-figure\b[^"]*")([^>]*?)>([\s\S]*?)<\/figure>/gi;
const FIGCAP_RE = /<figcaption\b([^>]*)>([\s\S]*?)<\/figcaption>/i;
const FIGNUM_PREFIX_RE = /^\s*<!--fignum-->[\s\S]*?<!--\/fignum-->\s*/i;
// fileToChapter is declared earlier in Step 5b
const figureRegistry = []; // { number, chapterNum, chapterTitle, file, anchor, caption }
let figuresNumbered = 0;
let figureFilesNumbered = 0;
for (const file of allHtml) {
  if (file === "index.html") continue;
  const chapter = fileToChapter.get(file);
  if (!chapter || !chapter.num) continue; // only number figures in numbered chapters
  const filePath = path.join(MANUAL_DIR, file);
  const fileBefore = fs.readFileSync(filePath, "utf8");
  let counter = 0;
  const updated = fileBefore.replace(FIG_BLOCK_RE, (whole, classAttrs, otherAttrs, inner) => {
    const capMatch = FIGCAP_RE.exec(inner);
    if (!capMatch) return whole; // no caption to prefix; skip
    counter++;
    const figNum = `${chapter.num}-${counter}`;
    const figId = `fig-${figNum}`;
    // Re-emit the figcaption with a fresh fignum prefix
    const oldCapInner = capMatch[2];
    const cleanedCapInner = oldCapInner.replace(FIGNUM_PREFIX_RE, "");
    const newCapInner = `<!--fignum--><span class="manual-fignum">Figure ${figNum}.</span><!--/fignum--> ${cleanedCapInner}`;
    const newInner = inner.replace(FIGCAP_RE, `<figcaption${capMatch[1]}>${newCapInner}</figcaption>`);
    // Ensure stable id attribute (idempotent: replace if present, else inject)
    let newOtherAttrs;
    if (/\bid="[^"]*"/i.test(otherAttrs)) {
      newOtherAttrs = otherAttrs.replace(/\bid="[^"]*"/i, `id="${figId}"`);
    } else {
      newOtherAttrs = otherAttrs + ` id="${figId}"`;
    }
    // Capture caption text for the registry — strip our markers + any HTML tags
    const captionText = cleanedCapInner
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&thinsp;/g, " ")
      .trim();
    figureRegistry.push({
      number: figNum,
      chapterNum: chapter.num,
      chapterTitle: chapter.title,
      file,
      anchor: figId,
      caption: captionText,
    });
    return `<figure${classAttrs}${newOtherAttrs}>${newInner}</figure>`;
  });
  if (updated !== fileBefore) {
    if (!auditOnly) fs.writeFileSync(filePath, updated, "utf8");
    figureFilesNumbered++;
  }
  figuresNumbered += counter;
}
log(`   ✓ ${figuresNumbered} figure(s) numbered across ${figureFilesNumbered} file(s)`);

// ─── Step 7: Regenerate book-index.html ───
if (!auditOnly) {
  log("\n7. Regenerating book-index.html…");
  if (!fs.existsSync(BOOK_INDEX)) {
    log("   ⚠ book-index.html not found — skipping regeneration");
  } else {
    // Build A–Z entries from chapter titles + curated section titles
    const entries = [];
    for (const ch of CHAPTERS) {
      if (ch.id === "index" || ch.id === "book-index") continue;
      entries.push({ display: ch.title, page: (ch.num ? "Ch " + ch.num + " · " : "") + ch.title, href: ch.file });
    }
    for (const s of SEARCH_SECTIONS) {
      // Skip duplicates of chapter titles
      entries.push({ display: s.t, page: prettyPageRef(s.u, CHAPTERS), href: s.u });
    }
    // De-dupe by (display + href)
    const seen = new Set();
    const unique = [];
    for (const e of entries) {
      const k = e.display.toLowerCase() + "|" + e.href;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(e);
    }
    unique.sort((a, b) => a.display.localeCompare(b.display, "en", { sensitivity: "base" }));

    // Group by first letter (A–Z, others under "#")
    const groups = {};
    for (const e of unique) {
      const c = e.display.replace(/^[^A-Za-z0-9]+/, "")[0] || "#";
      const letter = /[A-Z]/i.test(c) ? c.toUpperCase() : "#";
      (groups[letter] = groups[letter] || []).push(e);
    }
    const letters = Object.keys(groups).sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));

    // Render
    const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const lettersHtml =
      '<div class="bg-slate-900/40 border border-slate-700/40 rounded-xl p-4 text-center">' +
      '<div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Jump to letter</div>' +
      '<div class="flex flex-wrap gap-1.5 justify-center">' +
      letters.map((L) =>
        `<a href="#idx-${L}" class="inline-block w-7 h-7 leading-7 text-center rounded text-sm font-bold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 no-underline">${L}</a>`
      ).join("") +
      "</div></div>";

    let bodyHtml = "";
    for (const L of letters) {
      bodyHtml += `<h2 id="idx-${L}" class="!mt-10">${L}</h2>\n`;
      bodyHtml += '<div class="space-y-1 my-4">\n';
      for (const e of groups[L]) {
        const cleanHref = e.href.replace(/"/g, "&quot;");
        bodyHtml += `  <div class="flex items-baseline gap-3 py-1 border-b border-slate-800/50">\n`;
        bodyHtml += `    <div class="font-semibold text-slate-200 min-w-[14rem] text-sm">${escape(e.display)}</div>\n`;
        bodyHtml += `    <div class="text-sm"><a href="${cleanHref}" class="text-amber-400 hover:underline">${escape(e.page)}</a></div>\n`;
        bodyHtml += `  </div>\n`;
      }
      bodyHtml += "</div>\n";
    }

    // Patch book-index.html — replace contents of #book-index-letters and #book-index-body
    let html = fs.readFileSync(BOOK_INDEX, "utf8");
    html = replaceById(html, "book-index-letters", lettersHtml);
    html = replaceById(html, "book-index-body", bodyHtml);
    fs.writeFileSync(BOOK_INDEX, html, "utf8");
    log(`   ✓ Regenerated book-index.html (${unique.length} entries across ${letters.length} letters)`);
  }

  // ─── Step 8: Regenerate list-of-figures.html ───
  const LOF_PATH = path.join(MANUAL_DIR, "list-of-figures.html");
  if (fs.existsSync(LOF_PATH)) {
    log("\n8. Regenerating list-of-figures.html…");
    // Group by chapter (preserve CHAPTERS order)
    const chapterOrder = CHAPTERS.filter((c) => c.num).map((c) => c.file);
    const byChapter = new Map();
    for (const fig of figureRegistry) {
      if (!byChapter.has(fig.file)) byChapter.set(fig.file, []);
      byChapter.get(fig.file).push(fig);
    }
    let lofBody = "";
    let renderedChapters = 0;
    for (const file of chapterOrder) {
      const figs = byChapter.get(file);
      if (!figs || figs.length === 0) continue;
      const chapter = fileToChapter.get(file);
      const escapedTitle = escapeHtml(chapter.title);
      const partLabel = (chapter.act === "I" || chapter.act === "II" || chapter.act === "III" || chapter.act === "IV")
        ? `Chapter ${chapter.num}` : chapter.act === "Appendix" ? `Appendix ${chapter.num}` : chapter.act === "Quickstart" ? `Quickstart ${chapter.num}` : chapter.num;
      lofBody += `        <h3 class="!mt-8 !mb-3 text-amber-400">${partLabel} &mdash; <a href="${escapeHtml(file)}" class="hover:underline">${escapedTitle}</a></h3>\n`;
      lofBody += `        <div class="space-y-1">\n`;
      for (const fig of figs) {
        lofBody += `          <div class="flex items-baseline gap-3 py-1 border-b border-slate-800/40">\n`;
        lofBody += `            <div class="font-mono text-xs text-amber-500 min-w-[5rem]">Figure ${fig.number}</div>\n`;
        lofBody += `            <div class="text-sm flex-1"><a href="${escapeHtml(file)}#${escapeHtml(fig.anchor)}" class="text-slate-200 hover:text-amber-400 hover:underline">${escapeHtml(fig.caption)}</a></div>\n`;
        lofBody += `          </div>\n`;
      }
      lofBody += `        </div>\n`;
      renderedChapters++;
    }
    let lofHtml = fs.readFileSync(LOF_PATH, "utf8");
    lofHtml = replaceById(lofHtml, "list-of-figures-body", lofBody);
    fs.writeFileSync(LOF_PATH, lofHtml, "utf8");
    log(`   ✓ Regenerated list-of-figures.html (${figureRegistry.length} figures across ${renderedChapters} chapters)`);
  }
} else {
  log("\n7. Skipping regeneration (--audit mode)");
}

// ─── Report ───
log("\n┌──────────────────────────────────────────────────────┐");
log("│  RESULTS                                            │");
log("└──────────────────────────────────────────────────────┘\n");
if (issues.length === 0) {
  console.log("  ✓ All checks passed — manual is in sync.\n");
  process.exit(0);
}
const bySev = { HIGH: [], MEDIUM: [], LOW: [] };
for (const i of issues) bySev[i.severity].push(i);
console.log(`  ⚠ ${issues.length} issue(s) found:\n`);
for (const sev of ["HIGH", "MEDIUM", "LOW"]) {
  if (!bySev[sev].length) continue;
  console.log(`  [${sev}] — ${bySev[sev].length}`);
  for (const i of bySev[sev]) console.log(`    · ${i.type.padEnd(5)} ${i.file.padEnd(38)} ${i.msg}`);
  console.log("");
}
console.log("  Fix:");
console.log("    NAV   → Add the page to CHAPTERS in assets/manual.js");
console.log("    LINK  → Fix or remove the broken href");
console.log("    SHELL → Use an existing chapter as a shell template");
console.log("    CHNUM → Update either the chapter page (<title> + badge + cross-ref) or num in assets/manual.js. Source of truth is manual.js; pick one direction and align.");
console.log("    ACT   → Update the badge's 'Act <ROMAN>' to match the chapter's act field in assets/manual.js (or update manual.js if the badge is correct).");
console.log("    GLOSSARY → Run 'node docs/manual/maintain.mjs' (without --audit) to regenerate assets/glossary-terms.js from glossary.html.");
console.log("    COUNT → Add the key to MANUAL_COUNTS in assets/manual.js, or run without --audit to rewrite drift");
process.exit(bySev.HIGH.length > 0 ? 1 : 0);

// ─── Helpers ───
function prettyPageRef(href, chapters) {
  const file = href.split("#")[0];
  const ch = chapters.find((c) => c.file === file);
  if (!ch) return file;
  return (ch.num ? "Ch " + ch.num + " · " : "") + ch.title;
}

function replaceById(html, id, inner) {
  const re = new RegExp(`(<div[^>]*id="${id}"[^>]*>)([\\s\\S]*?)(<\\/div>)`, "m");
  if (!re.test(html)) {
    console.error(`   ✗ Could not find <div id="${id}"> in book-index.html`);
    return html;
  }
  return html.replace(re, `$1\n${inner}\n      $3`);
}
