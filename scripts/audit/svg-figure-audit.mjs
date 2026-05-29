#!/usr/bin/env node
/**
 * SVG figure audit — surfaces legibility/layout issues in docs/manual/assets/diagrams/*.svg
 *
 * Heuristics (mirror the issues we fixed on Figure 21-3):
 *   1. Small fonts          — font-size < 11px is too small for the manual
 *   2. Dim palette          — slate-400/500/600 (#94a3b8, #64748b, #475569) used for body text
 *   3. Text outside viewBox — any <text> with x/y past the declared viewBox bounds
 *   4. Text outside rect    — text positioned outside the nearest enclosing rect (overflow)
 *   5. Cramped rects        — rect with many text lines crammed in (lines-per-px ratio)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'docs/manual/assets/diagrams';
const files = readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();

const DIM_HEXES = ['#94a3b8', '#64748b', '#475569', '#334155', '#1e293b'];
const DIM_TAILWIND = ['slate-400', 'slate-500', 'slate-600', 'slate-700'];

function parseViewBox(svg) {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (!m) return null;
  const [x, y, w, h] = m[1].trim().split(/\s+/).map(Number);
  return { x, y, w, h };
}

function findFontSizes(svg) {
  const sizes = new Set();
  // inline font-size attribute or style
  for (const m of svg.matchAll(/font-size\s*[:=]\s*"?(\d+(?:\.\d+)?)/g)) sizes.add(Number(m[1]));
  // CSS rules
  for (const m of svg.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/g)) sizes.add(Number(m[1]));
  return [...sizes].sort((a, b) => a - b);
}

function findDimTextColors(svg) {
  const hits = [];
  for (const hex of DIM_HEXES) {
    // appears as fill of body text (heuristic: only flag if inside a .label/.small/.note CSS or text element)
    const re = new RegExp(`fill\\s*[:=]\\s*"?${hex}`, 'gi');
    const matches = svg.match(re);
    if (matches) hits.push({ color: hex, count: matches.length });
  }
  return hits;
}

function findTextElements(svg) {
  const elements = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = m[1];
    const content = m[2];
    const xm = attrs.match(/\bx\s*=\s*"([^"]+)"/);
    const ym = attrs.match(/\by\s*=\s*"([^"]+)"/);
    if (!xm || !ym) continue;
    elements.push({
      x: Number(xm[1]),
      y: Number(ym[1]),
      content: content.trim(),
      raw: m[0],
    });
  }
  return elements;
}

function findRects(svg) {
  const rects = [];
  for (const m of svg.matchAll(/<rect\b([^/>]*)\/?>/g)) {
    const attrs = m[1];
    const x = Number((attrs.match(/\bx\s*=\s*"([^"]+)"/) || [])[1]);
    const y = Number((attrs.match(/\by\s*=\s*"([^"]+)"/) || [])[1]);
    const w = Number((attrs.match(/\bwidth\s*=\s*"([^"]+)"/) || [])[1]);
    const h = Number((attrs.match(/\bheight\s*=\s*"([^"]+)"/) || [])[1]);
    if ([x, y, w, h].some(Number.isNaN)) continue;
    rects.push({ x, y, w, h });
  }
  return rects;
}

function findTextOutsideViewBox(viewBox, texts) {
  if (!viewBox) return [];
  const { x, y, w, h } = viewBox;
  const right = x + w;
  const bottom = y + h;
  return texts.filter((t) => t.x < x || t.x > right || t.y < y || t.y > bottom).slice(0, 5);
}

function findTextOverflowingRect(rects, texts) {
  // For each text, find the smallest rect containing it; if none contains it but
  // a nearby rect almost-contains it (within 30px), flag it. Skip texts outside all rects.
  const overflows = [];
  for (const t of texts) {
    const containing = rects.filter((r) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);
    if (containing.length > 0) continue;
    // find nearest rect whose center is within 60px of text
    const near = rects
      .map((r) => ({ r, dx: t.x - (r.x + r.w / 2), dy: t.y - (r.y + r.h / 2) }))
      .filter(({ r, dx, dy }) => Math.abs(dx) < r.w / 2 + 40 && Math.abs(dy) < r.h / 2 + 30)
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    if (near.length === 0) continue;
    const nearest = near[0];
    const r = nearest.r;
    // only flag if text is just outside the rect edges (overflow), not a free-floating label
    const justBelow = t.y > r.y + r.h && t.y < r.y + r.h + 25;
    const justRight = t.x > r.x + r.w && t.x < r.x + r.w + 50;
    if (justBelow || justRight) {
      overflows.push({ text: t.content.slice(0, 60), tx: t.x, ty: t.y, rect: r });
    }
  }
  return overflows.slice(0, 5);
}

function findCrampedRects(rects, texts) {
  // For each rect, count texts inside it; flag if lines * 20 > rect.h (less than 20px per line on avg)
  const cramped = [];
  for (const r of rects) {
    const inside = texts.filter((t) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);
    if (inside.length < 3) continue;
    const ratio = r.h / inside.length;
    if (ratio < 18) {
      cramped.push({ rect: r, lines: inside.length, ratio: ratio.toFixed(1) });
    }
  }
  return cramped.slice(0, 3);
}

const report = [];
for (const file of files) {
  const path = join(DIR, file);
  const svg = readFileSync(path, 'utf8');
  const viewBox = parseViewBox(svg);
  const sizes = findFontSizes(svg);
  const dimColors = findDimTextColors(svg);
  const texts = findTextElements(svg);
  const rects = findRects(svg);

  const smallFonts = sizes.filter((s) => s < 11);
  const outsideVB = findTextOutsideViewBox(viewBox, texts);
  const overflowRect = findTextOverflowingRect(rects, texts);
  const cramped = findCrampedRects(rects, texts);

  const issues = [];
  if (smallFonts.length) issues.push({ kind: 'small-fonts', detail: smallFonts });
  if (dimColors.length) issues.push({ kind: 'dim-colors', detail: dimColors });
  if (outsideVB.length) issues.push({ kind: 'text-outside-viewbox', detail: outsideVB });
  if (overflowRect.length) issues.push({ kind: 'text-overflow-rect', detail: overflowRect });
  if (cramped.length) issues.push({ kind: 'cramped-rect', detail: cramped });

  report.push({
    file,
    viewBox,
    textCount: texts.length,
    rectCount: rects.length,
    fontSizes: sizes,
    issues,
  });
}

// Print summary
const clean = report.filter((r) => r.issues.length === 0);
const dirty = report.filter((r) => r.issues.length > 0);

console.log(`\n=== SVG audit (${files.length} files) ===\n`);
console.log(`Clean: ${clean.length}`);
console.log(`Has findings: ${dirty.length}\n`);

for (const r of dirty) {
  console.log(`\n── ${r.file} (viewBox ${r.viewBox?.w}×${r.viewBox?.h}, ${r.textCount} text, ${r.rectCount} rect)`);
  console.log(`   fonts: ${r.fontSizes.join(', ')}`);
  for (const issue of r.issues) {
    if (issue.kind === 'small-fonts') {
      console.log(`   ⚠ small-fonts: ${issue.detail.join(', ')}`);
    } else if (issue.kind === 'dim-colors') {
      console.log(`   ⚠ dim-colors: ${issue.detail.map((d) => `${d.color}×${d.count}`).join(', ')}`);
    } else if (issue.kind === 'text-outside-viewbox') {
      console.log(`   ⚠ text-outside-viewbox: ${issue.detail.length} hits`);
      for (const t of issue.detail) console.log(`       (${t.x},${t.y}) "${t.content.slice(0, 40)}"`);
    } else if (issue.kind === 'text-overflow-rect') {
      console.log(`   ⚠ text-overflow-rect: ${issue.detail.length} hits`);
      for (const o of issue.detail) console.log(`       text@(${o.tx},${o.ty}) "${o.text}" — rect ${o.rect.w}×${o.rect.h}@(${o.rect.x},${o.rect.y})`);
    } else if (issue.kind === 'cramped-rect') {
      console.log(`   ⚠ cramped-rect: ${issue.detail.length} hits`);
      for (const c of issue.detail) console.log(`       rect ${c.rect.w}×${c.rect.h}@(${c.rect.x},${c.rect.y}) — ${c.lines} lines, ${c.ratio}px/line`);
    }
  }
}

console.log(`\n=== Clean files (${clean.length}) ===`);
console.log(clean.map((r) => r.file).join('\n'));
