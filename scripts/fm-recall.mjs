#!/usr/bin/env node
/**
 * Plan Forge — fm-recall CLI helper (Phase-38.2).
 *
 * Usage:
 *   node scripts/fm-recall.mjs query "<text>"    — top-3 recall results
 *   node scripts/fm-recall.mjs rebuild           — rebuild recall index
 *
 * Runs from the repository root; resolves projectDir to process.cwd().
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Dynamic import so this script is discoverable even if run from outside pforge-master
const { buildIndex, queryIndex, loadIndex } = await import(
  join(repoRoot, "pforge-master", "src", "recall-index.mjs")
);

const [sub, ...rest] = process.argv.slice(2);
const projectDir = process.cwd();

if (sub === "rebuild") {
  await buildIndex(projectDir);
  try {
    const idx = JSON.parse(
      readFileSync(join(projectDir, ".forge", "fm-sessions", "recall-index.json"), "utf-8"),
    );
    console.log(`Rebuilt recall index: ${idx.docs?.length ?? 0} document(s) indexed.`);
  } catch {
    console.log("Recall index rebuilt (empty — no sessions found).");
  }
  process.exit(0);
}

if (sub === "query") {
  const query = rest.join(" ").trim();
  if (!query) {
    console.error('Usage: pforge fm-recall query "<text>"');
    process.exit(1);
  }
  await loadIndex(projectDir);
  const results = await queryIndex(query, { topK: 3, projectDir });
  if (results.length === 0) {
    console.log("No results.");
  } else {
    for (const r of results) {
      const ts = (r.timestamp || "").slice(0, 10);
      const sid = r.sessionId ? r.sessionId.slice(0, 16) + "…" : "unknown";
      console.log(`[${ts} · ${r.lane} · ${sid}] ${r.userMessage}`);
    }
  }
  process.exit(0);
}

console.error('Usage: pforge fm-recall query "<text>" | rebuild');
process.exit(1);
