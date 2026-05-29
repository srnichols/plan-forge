#!/usr/bin/env node
// Tier B Mermaid color-only legibility pass.
// Brightens dim slate-400 (#94a3b8) -> slate-300 (#cbd5e1) inside the
// Mermaid-generated <style> block. Color-only because Mermaid pre-computes
// rect sizes from the default 14px font — bumping fonts via CSS override
// would cause node overflow. The #1e293b background fill on edge labels
// is intentional (matches page bg) and left alone.
//
// Run from repo root: node scripts/audit/svg-tier-b-mermaid.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = 'docs/manual/assets/diagrams';

const TIER_B = [
  'competitive-loop-flow.svg',
  'inner-loop-state.svg',
  'integration-surfaces.svg',
  'self-deterministic-callback-graph.svg',
  'self-deterministic-system-flow.svg',
];

// Color swaps applied ONLY inside <style>...</style> (not inline attrs).
// All values are text-fill / text-color tokens — never stroke or rect fill.
const COLOR_MAP = new Map([
  ['#94a3b8', '#cbd5e1'],
  ['#64748b', '#94a3b8'],
]);

let modified = 0;
const report = [];

for (const file of TIER_B) {
  const path = resolve(DIR, file);
  const original = readFileSync(path, 'utf8');

  const styleMatch = original.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) {
    report.push(`SKIP  ${file} — no <style> block`);
    continue;
  }

  const before = styleMatch[1];
  let after = before;
  const swaps = {};

  for (const [from, to] of COLOR_MAP) {
    const re = new RegExp(from.replace('#', '\\#'), 'gi');
    const hits = (after.match(re) || []).length;
    if (hits > 0) {
      after = after.replace(re, to);
      swaps[from] = hits;
    }
  }

  if (after === before) {
    report.push(`UNCH  ${file}`);
    continue;
  }

  const updated = original.replace(before, after);
  writeFileSync(path, updated, 'utf8');
  modified++;
  const swapStr = Object.entries(swaps).map(([k, v]) => `${k}\u00d7${v}`).join(', ');
  report.push(`OK    ${file}  (${swapStr})`);
}

console.log('\n=== Tier B Mermaid color pass ===\n');
for (const line of report) console.log(line);
console.log(`\nTotal files modified: ${modified} / ${TIER_B.length}`);
console.log('\nNote: font sizes intentionally left unchanged. Mermaid pre-computes');
console.log('node rect dimensions from the default 14px font — bumping fonts via');
console.log('CSS override would cause text overflow in pre-positioned nodes.');
