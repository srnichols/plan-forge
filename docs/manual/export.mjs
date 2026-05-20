#!/usr/bin/env node
/**
 * Plan Forge Manual — Offline / Single-Source HTML Export
 *
 * Generates docs/manual/plan-forge-manual.html — a complete single-page version
 * of the manual suitable for:
 *   • Offline reading (plane, commute, no-wifi)
 *   • Air-gapped enterprise deployment
 *   • Ctrl+F across the full manual at once
 *   • A printable / archivable snapshot with a content hash
 *
 *   node docs/manual/export.mjs             # Regenerate plan-forge-manual.html
 *   node docs/manual/export.mjs --dry-run   # Preview stats without writing
 *   node docs/manual/export.mjs --quiet     # Suppress per-chapter progress
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUAL_DIR = __dirname;
const ASSETS_DIR = path.join(MANUAL_DIR, "assets");
const MANUAL_JS = path.join(ASSETS_DIR, "manual.js");
const OUTPUT_PATH = path.join(MANUAL_DIR, "plan-forge-manual.html");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const quiet = args.includes("--quiet");
const log = (...m) => { if (!quiet) console.log(...m); };

log("\n┌──────────────────────────────────────────────────────┐");
log("│  Plan Forge Manual — Offline Export                 │");
log(`│  Mode: ${dryRun ? "DRY-RUN (no writes)                      " : "GENERATE                                "}│`);
log("└──────────────────────────────────────────────────────┘\n");

// ─── Load CHAPTERS from assets/manual.js (same technique as maintain.mjs) ───
log("1. Parsing assets/manual.js…");
const manualJsSrc = fs.readFileSync(MANUAL_JS, "utf8");
let CHAPTERS = [];
try {
  const exportLine = "\n  globalThis.__PFORGE_CHAPTERS = CHAPTERS;\n";
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
} catch (err) {
  console.error("   ✗ Failed to evaluate manual.js:", err.message);
  process.exit(1);
}
log(`   ✓ ${CHAPTERS.length} chapters registered`);

// ─── Helpers ───
function extractMain(html) {
  const m = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  return m ? m[1].trim() : null;
}

// Strip script tags (interactive sidebar JS not needed in offline view)
function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

// ─── Build table of contents ───
function buildToc(chapters) {
  const partLabels = {
    "Front Matter": "Front Matter",
    "Quickstart":   "Quickstart",
    "I":            "Part I · Smelt",
    "II":           "Part II · Forge",
    "III":          "Part III · Guard",
    "IV":           "Part IV · Learn",
    "V":            "Part V · Integrate",
    "Appendix":     "Appendices",
  };

  let html = `<nav id="toc" class="toc-nav" aria-label="Table of Contents">\n`;
  html += `  <h2 class="toc-heading">Table of Contents</h2>\n`;

  let lastAct = null;
  for (const ch of chapters) {
    if (ch.id === "index") continue;
    const act = ch.act || "Front Matter";
    if (act !== lastAct) {
      if (lastAct !== null) html += `    </ul>\n  </div>\n`;
      const groupLabel = partLabels[act] || act;
      html += `  <div class="toc-group">\n    <div class="toc-group-label">${groupLabel}</div>\n    <ul>\n`;
      lastAct = act;
    }
    const numPrefix = ch.num ? `<span class="toc-num">${ch.num}</span> ` : "";
    html += `      <li><a href="#chapter-${ch.id}">${numPrefix}${ch.title}</a></li>\n`;
  }
  if (lastAct !== null) html += `    </ul>\n  </div>\n`;
  html += `</nav>\n`;
  return html;
}

// ─── Process each chapter ───
log("\n2. Extracting chapter content…");
const parts = [];
let included = 0;
let skipped = 0;

for (const ch of CHAPTERS) {
  if (ch.id === "index") continue;
  const filepath = path.join(MANUAL_DIR, ch.file);
  if (!fs.existsSync(filepath)) {
    log(`   ⚠ Missing file: ${ch.file} — skipping`);
    skipped++;
    continue;
  }
  const raw = fs.readFileSync(filepath, "utf8");
  const mainContent = extractMain(raw);
  if (!mainContent) {
    log(`   ⚠ No <main> in ${ch.file} — skipping`);
    skipped++;
    continue;
  }
  const body = stripScripts(mainContent);
  const numAttr = ch.num ? ` data-chapter-num="${ch.num}"` : "";
  const actAttr = ch.act ? ` data-part="${ch.act}"` : "";
  parts.push(
    `<section id="chapter-${ch.id}" class="export-chapter"${numAttr}${actAttr}>\n` +
    `${body}\n` +
    `</section>`
  );
  if (!quiet) process.stdout.write(`   ✓ ${ch.file.padEnd(45)} ${ch.title.slice(0, 40)}\n`);
  included++;
}
log(`\n   Included: ${included} chapters   Skipped: ${skipped}`);

// ─── Compute content hash ───
const contentHash = createHash("sha256")
  .update(parts.join("\n"))
  .digest("hex")
  .slice(0, 16);

// ─── Read version from CHAPTERS STATUS block (use manual.js MANUAL_COUNTS) ───
const versionMatch = manualJsSrc.match(/version\s*:\s*["']([^"']+)["']/);
const version = versionMatch ? versionMatch[1] : "unknown";

const now = new Date();
const generatedDate = now.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");

// ─── Build TOC ───
const tocHtml = buildToc(CHAPTERS);

// ─── Assemble document ───
const document = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Plan Forge Manual — Complete Offline Edition</title>
  <meta name="description" content="Plan Forge Manual — complete single-page offline edition. ${included} chapters and appendices. Generated ${generatedDate}." />
  <meta name="generator" content="Plan Forge export.mjs" />
  <link rel="icon" type="image/svg+xml" href="../assets/plan-forge-logo.svg" />
  <link rel="stylesheet" href="../assets/tailwind.built.css" />
  <link rel="stylesheet" href="../assets/shared.css" />
  <link rel="stylesheet" href="assets/manual.css" />
  <style>
    /* ─── Export-only layout overrides ─── */
    /* Hide interactive sidebar/nav chrome not needed in offline view */
    #mobile-sidebar-btn,
    #sidebar-overlay,
    #manual-sidebar,
    .manual-sidebar,
    .chapter-prev-next,
    [class*="chapter-prev-next"] { display: none !important; }

    .manual-layout { display: block !important; }
    main { max-width: none !important; padding: 0 !important; }

    /* ─── Export shell ─── */
    .export-header {
      max-width: 56rem;
      margin: 0 auto;
      padding: 2.5rem 1.5rem 1.5rem;
      border-bottom: 1px solid #1e293b;
    }
    .export-header h1 {
      font-size: 2rem;
      font-weight: 800;
      color: #f59e0b;
      margin: 0 0 0.4rem;
    }
    .export-header .export-subtitle {
      color: #94a3b8;
      font-size: 0.95rem;
      margin-bottom: 0.5rem;
    }
    .export-header .export-meta {
      font-size: 0.7rem;
      color: #475569;
      font-family: "JetBrains Mono", monospace;
    }
    .export-header .export-meta a { color: #f59e0b; text-decoration: none; }
    .export-header .export-meta a:hover { text-decoration: underline; }

    /* ─── Table of contents ─── */
    .toc-nav {
      max-width: 56rem;
      margin: 2rem auto;
      padding: 1.5rem;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.75rem;
    }
    .toc-heading {
      color: #f59e0b;
      font-size: 1rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin: 0 0 1rem;
    }
    .toc-group { margin-bottom: 1rem; }
    .toc-group-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #64748b;
      margin-bottom: 0.25rem;
    }
    .toc-nav ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
      gap: 0.15rem 1rem;
    }
    .toc-nav a {
      color: #94a3b8;
      font-size: 0.8rem;
      text-decoration: none;
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
    }
    .toc-nav a:hover { color: #f59e0b; }
    .toc-num {
      font-size: 0.65rem;
      font-weight: 700;
      color: #f59e0b;
      font-family: "JetBrains Mono", monospace;
      min-width: 1.5rem;
    }

    /* ─── Chapter separators ─── */
    .export-chapter {
      max-width: 56rem;
      margin: 0 auto;
      padding: 2rem 1.5rem 3rem;
      border-top: 2px solid #1e293b;
    }
    .export-chapter:target { scroll-margin-top: 2rem; }

    /* ─── Print styles ─── */
    @media print {
      .export-header, .toc-nav { page-break-after: avoid; }
      .export-chapter { page-break-before: auto; }
      .chapter-hero { max-height: 12rem; object-fit: cover; }
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-300 min-h-screen">

<!-- Export header -->
<header class="export-header">
  <h1>📚 Plan Forge Manual</h1>
  <p class="export-subtitle">Complete offline edition &mdash; ${included} chapters &amp; appendices</p>
  <p class="export-meta">
    Generated ${generatedDate}
    &middot; content hash <code>${contentHash}</code>
    &middot; v${version}
    &middot; <a href="https://planforge.software/" rel="noopener">Main site ↗</a>
    &middot; <a href="index.html">Online version ↗</a>
    &middot; <a href="https://github.com/srnichols/plan-forge" rel="noopener">GitHub ↗</a>
  </p>
</header>

<!-- Table of contents -->
${tocHtml}

<hr style="border:none;border-top:1px solid #1e293b;max-width:56rem;margin:0 auto;" />

<!-- Chapters -->
${parts.join("\n\n")}

<!-- Footer -->
<footer style="max-width:56rem;margin:3rem auto;padding:1.5rem;font-size:0.75rem;color:#475569;border-top:1px solid #1e293b;font-family:'JetBrains Mono',monospace;">
  <p>Plan Forge Manual &mdash; offline edition &mdash; generated ${generatedDate} &mdash; hash <code>${contentHash}</code></p>
  <p>Regenerate with: <code>node docs/manual/export.mjs</code> &mdash; <a href="https://planforge.software/" style="color:#f59e0b;" rel="noopener">Main site</a> &mdash; <a href="index.html" style="color:#f59e0b;">Online version</a> &mdash; <a href="https://github.com/srnichols/plan-forge" style="color:#f59e0b;" rel="noopener">GitHub</a></p>
</footer>

</body>
</html>
`;

// ─── Write or preview ───
if (dryRun) {
  console.log(`\n[dry-run] Would write ${OUTPUT_PATH}`);
  console.log(`  ${included} chapters included, ${skipped} skipped`);
  console.log(`  Estimated size: ~${Math.round(document.length / 1024)} KB`);
  console.log(`  Content hash: ${contentHash}`);
  console.log(`  Generated: ${generatedDate}`);
} else {
  fs.writeFileSync(OUTPUT_PATH, document, "utf8");
  const sizeKb = Math.round(fs.statSync(OUTPUT_PATH).size / 1024);
  console.log(`\n✓ Generated: docs/manual/plan-forge-manual.html`);
  console.log(`  ${included} chapters · ${sizeKb} KB · hash ${contentHash}`);
  console.log(`  Timestamp: ${generatedDate}`);
  console.log(`\n  To update: node docs/manual/export.mjs`);
  console.log(`  Validate:  node docs/manual/maintain.mjs`);
}
