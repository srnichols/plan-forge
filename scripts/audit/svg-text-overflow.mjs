#!/usr/bin/env node
/**
 * Text-overflow detector for SVG figures.
 *
 * Approach: estimate each <text>'s rendered width from font-size × char count,
 * find the smallest containing rect, and flag when the text extends past the
 * rect's right edge (with a small margin). Honors text-anchor (start/middle/end).
 *
 * Output: per-file list of overflow candidates ordered by severity (overflow px).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'docs/manual/assets/diagrams';
const MARGIN_PX = 4; // text should sit at least 4px inside the rect edge

// Per-char width factors (approximate, in px per char per 1px of font-size).
// Empirically tuned for Inter (sans) and JetBrains Mono.
const FACTOR_SANS = 0.52;       // Inter regular
const FACTOR_SANS_BOLD = 0.56;  // Inter 600/700
const FACTOR_MONO = 0.6;        // JetBrains Mono

function parseStyleBlock(svg) {
  const m = svg.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) return new Map();
  const css = m[1];
  const rules = new Map(); // className -> { fontSize, fontWeight, mono, textAnchor }
  // Find rules like .foo, .bar { ... font-size: 11.5px; font-weight: 700; font-family: ... }
  for (const r of css.matchAll(/\.([a-zA-Z_-][\w-]*)\s*\{([^}]+)\}/g)) {
    const cls = r[1];
    const body = r[2];
    const fs = body.match(/font-size\s*:\s*([\d.]+)\s*px/);
    const fw = body.match(/font-weight\s*:\s*(\d+|bold)/);
    const ff = body.match(/font-family\s*:\s*[^;]*?(JetBrains|monospace|Mono)/i);
    if (!rules.has(cls)) rules.set(cls, {});
    const cur = rules.get(cls);
    if (fs) cur.fontSize = Number(fs[1]);
    if (fw) cur.fontWeight = fw[1] === 'bold' ? 700 : Number(fw[1]);
    if (ff) cur.mono = true;
  }
  return rules;
}

function parseViewBox(svg) {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (!m) return null;
  const [x, y, w, h] = m[1].trim().split(/\s+/).map(Number);
  return { x, y, w, h };
}

function getTextContent(raw) {
  // Strip tags inside <text>...</text>, collapse whitespace
  const inner = raw.replace(/^<text\b[^>]*>/, '').replace(/<\/text>$/, '');
  // Drop tspan tags but keep their content
  return inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function findTextElements(svg, cssRules) {
  const elements = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = m[1];
    const x = Number((attrs.match(/\bx\s*=\s*"([^"]+)"/) || [])[1]);
    const y = Number((attrs.match(/\by\s*=\s*"([^"]+)"/) || [])[1]);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;

    const classAttr = (attrs.match(/\bclass\s*=\s*"([^"]+)"/) || [])[1] || '';
    const classes = classAttr.split(/\s+/).filter(Boolean);
    const anchorAttr = (attrs.match(/\btext-anchor\s*=\s*"([^"]+)"/) || [])[1];
    const inlineFs = (attrs.match(/\bfont-size\s*=\s*"([^"]+)"/) || [])[1];
    const styleAttr = (attrs.match(/\bstyle\s*=\s*"([^"]+)"/) || [])[1] || '';
    const styleFs = (styleAttr.match(/font-size\s*:\s*([\d.]+)\s*px/) || [])[1];

    // Resolve font-size: inline attr > inline style > CSS class
    let fontSize = null;
    let fontWeight = 400;
    let mono = false;
    for (const c of classes) {
      const rule = cssRules.get(c);
      if (rule) {
        if (rule.fontSize) fontSize = rule.fontSize;
        if (rule.fontWeight) fontWeight = rule.fontWeight;
        if (rule.mono) mono = true;
      }
    }
    if (styleFs) fontSize = Number(styleFs);
    if (inlineFs) fontSize = Number(inlineFs);
    if (fontSize == null) fontSize = 11.5; // default fallback

    // Mono detection from inline style
    if (/font-family[^;]*?(JetBrains|Mono|monospace)/i.test(styleAttr)) mono = true;

    const content = getTextContent(m[0]);
    if (!content) continue;

    const anchor = anchorAttr || 'start';
    const factor = mono ? FACTOR_MONO : (fontWeight >= 600 ? FACTOR_SANS_BOLD : FACTOR_SANS);
    const estWidth = content.length * fontSize * factor;

    // Compute text bounding x range (leftEdge, rightEdge)
    let leftEdge, rightEdge;
    if (anchor === 'middle') {
      leftEdge = x - estWidth / 2;
      rightEdge = x + estWidth / 2;
    } else if (anchor === 'end') {
      leftEdge = x - estWidth;
      rightEdge = x;
    } else {
      leftEdge = x;
      rightEdge = x + estWidth;
    }

    elements.push({ x, y, content, fontSize, fontWeight, mono, anchor, estWidth, leftEdge, rightEdge });
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
    rects.push({ x, y, w, h, area: w * h });
  }
  return rects;
}

function findContainingRect(rects, text) {
  // Find smallest rect whose interior contains (text.x, text.y)
  const containers = rects.filter((r) =>
    text.x >= r.x && text.x <= r.x + r.w && text.y >= r.y && text.y <= r.y + r.h
  );
  if (containers.length === 0) return null;
  // Pick smallest (excluding full-bg rects)
  containers.sort((a, b) => a.area - b.area);
  return containers[0];
}

function analyzeFile(path, file) {
  const svg = readFileSync(path, 'utf8');
  const cssRules = parseStyleBlock(svg);
  const viewBox = parseViewBox(svg);
  const texts = findTextElements(svg, cssRules);
  const rects = findRects(svg);

  const overflows = [];
  for (const t of texts) {
    const rect = findContainingRect(rects, t);
    if (!rect) continue;
    // Skip the full-canvas background rect (too big to be meaningful)
    if (viewBox && rect.w >= viewBox.w * 0.95 && rect.h >= viewBox.h * 0.95) continue;

    const rightLimit = rect.x + rect.w - MARGIN_PX;
    const leftLimit = rect.x + MARGIN_PX;
    const overflowRight = t.rightEdge - rightLimit;
    const overflowLeft = leftLimit - t.leftEdge;

    if (overflowRight > 0 || overflowLeft > 0) {
      overflows.push({
        text: t.content.slice(0, 80),
        len: t.content.length,
        fontSize: t.fontSize,
        anchor: t.anchor,
        estWidth: Math.round(t.estWidth),
        rect: `${rect.w}\u00d7${rect.h}@(${rect.x},${rect.y})`,
        rectInnerW: rect.w - 2 * MARGIN_PX,
        overflowPx: Math.round(Math.max(overflowRight, overflowLeft)),
        side: overflowRight > overflowLeft ? 'right' : 'left',
      });
    }
  }
  overflows.sort((a, b) => b.overflowPx - a.overflowPx);
  return { file, viewBox, overflows };
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();
const results = files.map((f) => analyzeFile(join(DIR, f), f));

const dirty = results.filter((r) => r.overflows.length > 0);
const clean = results.filter((r) => r.overflows.length === 0);

console.log(`\n=== SVG text-overflow audit (${files.length} files, margin ${MARGIN_PX}px) ===\n`);
console.log(`Clean: ${clean.length}`);
console.log(`Has overflows: ${dirty.length}\n`);

for (const r of dirty) {
  console.log(`\n\u2500\u2500 ${r.file} (viewBox ${r.viewBox?.w}\u00d7${r.viewBox?.h}) \u2014 ${r.overflows.length} overflow(s)`);
  for (const o of r.overflows.slice(0, 30)) {
    console.log(`   +${o.overflowPx}px ${o.side}: "${o.text}"`);
    console.log(`        len=${o.len} fs=${o.fontSize} anchor=${o.anchor} estW=${o.estWidth} in rect ${o.rect} (innerW=${o.rectInnerW})`);
  }
  if (r.overflows.length > 6) {
    console.log(`   ... and ${r.overflows.length - 6} more`);
  }
}

console.log(`\n=== Clean files (${clean.length}) ===`);
console.log(clean.map((r) => r.file).join('\n'));
