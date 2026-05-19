#!/usr/bin/env node
// One-shot conversion of chapter-hero JPGs -> WebP @ q82.
// Reports per-file before/after size + total savings.
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import sharp from '../pforge-mcp/node_modules/sharp/lib/index.js';

const dir = 'docs/manual/assets/chapter-heroes';
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg'));

let beforeTotal = 0;
let afterTotal = 0;
const rows = [];

for (const f of files) {
  const src = join(dir, f);
  const dst = join(dir, basename(f, extname(f)) + '.webp');
  const before = statSync(src).size;
  await sharp(src).webp({ quality: 82, effort: 6 }).toFile(dst);
  const after = statSync(dst).size;
  beforeTotal += before;
  afterTotal += after;
  rows.push({ file: f, beforeKB: Math.round(before / 1024), afterKB: Math.round(after / 1024), pct: Math.round((1 - after / before) * 100) });
  unlinkSync(src);
}

rows.sort((a, b) => b.pct - a.pct);
console.table(rows);
console.log(`\nTotal: ${(beforeTotal / 1024 / 1024).toFixed(2)} MB -> ${(afterTotal / 1024 / 1024).toFixed(2)} MB`);
console.log(`Saved: ${((beforeTotal - afterTotal) / 1024 / 1024).toFixed(2)} MB (${Math.round((1 - afterTotal / beforeTotal) * 100)}%)`);
console.log(`Files: ${files.length}`);
