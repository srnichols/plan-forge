#!/usr/bin/env node
// One-shot Tier C bulk upgrade: apply Figure 21-3 legibility standard to the
// <style> block of each listed SVG. Style block only — no layout changes.
// Run from repo root: node scripts/audit/svg-tier-c-bulk.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = 'docs/manual/assets/diagrams';

const TIER_C = [
  'audit-loop-triage-lanes.svg',
  'bug-registry-status-machine.svg',
  'competitive-worktree-race.svg',
  'copilot-trilogy-flow.svg',
  'dag-parallel.svg',
  'dashboard-tabs-grouped.svg',
  'discovery-harness-four-pass.svg',
  'enterprise-reference-architecture-foundry.svg',
  'enterprise-reference-architecture-generic.svg',
  'escalation-chain.svg',
  'evidence-ab-test-bars.svg',
  'evolution-timeline.svg',
  'forge-master-intent-flow.svg',
  'github-stack-architecture.svg',
  'github-stack-dogfood-timeline.svg',
  'host-aware-routing-decision.svg',
  'knowledge-graph-schema.svg',
  'liveguard-composite-health.svg',
  'memory-capture-dataflow.svg',
  'memory-stack-layered.svg',
  'memory-three-tier-capture.svg',
  'quorum-complexity-rubric.svg',
  'quorum-estimate-tool-flow.svg',
  'quorum-flow.svg',
  'remote-bridge-fanout.svg',
  'team-coordination-flow.svg',
  'triage-three-lane-funnel.svg',
  'watcher-snapshot-vs-live.svg',
];

// Font-size bumps: small -> readable
const FONT_MAP = new Map([
  ['7px', '10px'],
  ['7.5px', '10.5px'],
  ['8px', '10.5px'],
  ['8.5px', '11px'],
  ['9px', '11px'],
  ['9.5px', '11.5px'],
  ['10px', '11.5px'],
  ['10.5px', '12px'],
  ['11px', '12.5px'],
  ['11.5px', '13px'],
  ['12px', '13.5px'],
  ['12.5px', '13.5px'],
  ['13px', '14px'],
  ['14px', '15px'],
]);

// Text fill swaps (Tailwind slate ramp brightened one step)
// Applied only inside the <style> block, only to `fill:` declarations.
const FILL_MAP = new Map([
  ['#475569', '#64748b'],  // slate-600 -> slate-500 (very dim -> dim)
  ['#64748b', '#cbd5e1'],  // slate-500 -> slate-300 (dim secondary -> brighter)
  ['#94a3b8', '#cbd5e1'],  // slate-400 -> slate-300 (secondary -> brighter)
  ['#e2e8f0', '#f1f5f9'],  // slate-200 -> slate-100 (titles)
  ['#fb7185', '#fda4af'],  // rose-400 -> rose-300 (error/fail accent)
  ['#fca5a5', '#fecaca'],  // red-300 -> red-200
  ['#34d399', '#6ee7b7'],  // emerald-400 -> emerald-300 (success accent)
  ['#60a5fa', '#93c5fd'],  // blue-400 -> blue-300
  ['#fbbf24', '#fcd34d'],  // amber-400 -> amber-300
]);

// Arrow stroke brightening: applied to `.arrow` rules (stroke only).
// Rule: in any selector containing "arrow" (e.g. .arrow, .arrow-write),
// brighten stroke #475569 -> #64748b. Other strokes (tier-colored box
// borders) are left alone because they anchor semantic meaning.
function upgradeArrowStrokes(styleBlock) {
  // Find rules whose selector includes "arrow" (case-insensitive simple match)
  return styleBlock.replace(/(\.[\w-]*arrow[\w-]*\s*\{[^}]*\})/gi, (rule) => {
    return rule.replace(/stroke:\s*#475569/g, 'stroke: #64748b');
  });
}

function transformStyleBlock(styleBlock) {
  let out = styleBlock;

  // 1. font-size swaps
  for (const [from, to] of FONT_MAP) {
    const re = new RegExp(`font-size:\\s*${from.replace('.', '\\.')}(?=\\s*;)`, 'g');
    out = out.replace(re, `font-size: ${to}`);
  }

  // 2. fill color swaps (text colors only — applied to `fill:` declarations)
  for (const [from, to] of FILL_MAP) {
    const re = new RegExp(`fill:\\s*${from}(?=\\s*;|\\s*})`, 'g');
    out = out.replace(re, `fill: ${to}`);
  }

  // 3. arrow stroke brightening
  out = upgradeArrowStrokes(out);

  return out;
}

// Also brighten arrow-marker <path fill="#475569"/> inside <defs>. These
// are tied to .arrow strokes. Apply only to markers whose id contains
// "ah" or "arr" (audit convention used across our SVGs).
function upgradeArrowMarkers(svg) {
  return svg.replace(
    /(<marker[^>]*\bid="[^"]*(?:ah|arr|arrow)[^"]*"[^>]*>[\s\S]*?<\/marker>)/g,
    (marker) => marker.replace(/fill="#475569"/g, 'fill="#64748b"')
  );
}

let totalChanged = 0;
const report = [];

for (const file of TIER_C) {
  const path = resolve(DIR, file);
  const original = readFileSync(path, 'utf8');

  // Extract <style>...</style> block (assume one per SVG)
  const styleMatch = original.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) {
    report.push(`SKIP  ${file} — no <style> block`);
    continue;
  }

  const before = styleMatch[1];
  const after = transformStyleBlock(before);

  let updated = original.replace(before, after);
  updated = upgradeArrowMarkers(updated);

  if (updated === original) {
    report.push(`UNCH  ${file} — no matching tokens`);
    continue;
  }

  writeFileSync(path, updated, 'utf8');
  totalChanged++;

  // Diff summary: count what changed
  const fontHits = (before.match(/font-size:/g) || []).length;
  const fillHits = (before.match(/fill:\s*#[0-9a-f]{6}/gi) || []).length;
  report.push(`OK    ${file}  (style block: ${fontHits} font-size, ${fillHits} fill decls scanned)`);
}

console.log('\n=== Tier C bulk upgrade ===\n');
for (const line of report) console.log(line);
console.log(`\nTotal files modified: ${totalChanged} / ${TIER_C.length}`);
