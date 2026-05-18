// One-shot route inventory dumper. Reads handler files and prints METHOD + PATH.
import fs from 'node:fs';
import path from 'node:path';

const files = [
  'pforge-mcp/server.mjs',
  'pforge-mcp/bridge.mjs',
  'pforge-mcp/forge-master-routes.mjs',
  'pforge-mcp/hub.mjs',
];

const routes = [];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], file: path.basename(f) });
  }
}

console.log(`Total routes: ${routes.length}`);
const byPrefix = {};
for (const r of routes) {
  const parts = r.path.split('/').filter(Boolean);
  let key;
  if (parts[0] === 'api' && parts.length >= 2) key = `/api/${parts[1]}`;
  else if (parts[0] === '.well-known') key = '/.well-known';
  else key = '/' + (parts[0] || '');
  (byPrefix[key] = byPrefix[key] || []).push(r);
}
for (const p of Object.keys(byPrefix).sort()) {
  console.log(`\n${p}  (${byPrefix[p].length})`);
  for (const r of byPrefix[p]) {
    console.log(`  ${r.method.padEnd(6)} ${r.path}   [${r.file}]`);
  }
}
