/**
 * One-shot generator — run once to produce the golden fixture.
 * Usage: node pforge-mcp/tests/generate-orchestrator-surface.mjs
 */
import * as orch from "../orchestrator.mjs";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exports = Object.keys(orch).sort();
const fixture = JSON.stringify({ exports }, null, 2) + "\n";
const out = resolve(__dirname, "fixtures", "orchestrator-surface.golden.json");
writeFileSync(out, fixture);
console.log(`Wrote ${exports.length} exports → ${out}`);
