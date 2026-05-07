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
 *   4. Re-generates the A–Z body of book-index.html from CHAPTERS + SEARCH_SECTIONS
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
try {
  // Inject an export hook INSIDE the IIFE (right before the final '})();' so
  // CHAPTERS / SEARCH_SECTIONS are still in scope) so we can capture them.
  const exportLine = '\n  globalThis.__PFORGE_CHAPTERS = CHAPTERS;\n  globalThis.__PFORGE_SECTIONS = SEARCH_SECTIONS;\n';
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
} catch (err) {
  console.error("   ✗ Failed to evaluate manual.js:", err.message);
  process.exit(1);
}
log(`   ✓ Parsed ${CHAPTERS.length} chapters, ${SEARCH_SECTIONS.length} indexed sections`);

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

// ─── Step 6: Regenerate book-index.html ───
if (!auditOnly) {
  log("\n6. Regenerating book-index.html…");
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
} else {
  log("\n6. Skipping regeneration (--audit mode)");
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
