#!/usr/bin/env node
// Generate the hero image for the "Loop That Never Ends" blog post.
// Usage: node scripts/gen-loop-never-ends-hero.mjs

import { generateImage } from "../pforge-mcp/orchestrator.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "docs/blog/assets");
mkdirSync(OUT_DIR, { recursive: true });

const outputPath = resolve(OUT_DIR, "loop-never-ends-hero.webp");

const prompt =
  "Dramatic cinematic scene inside a dark forge-hall: a massive glowing ouroboros — a serpent of molten metal and amber fire — coils in a perfect circle around a central anvil, devouring its own tail. Inside the circle's orbit, glowing scrolls and parchments (representing bug reports) are drawn into the flame, transforming as they pass through into pristine blue-white architectural blueprints that emerge on the other side of the loop. A blacksmith silhouette watches from the side, tools at rest. Embers drift through warm amber firelight. ABSOLUTELY NO text, NO words, NO letters, NO numbers, NO writing anywhere. Painterly digital art, cinematic rim-lighting, amber #f59e0b warm fire + slate #0f172a deep shadows + cool emerald #34d399 highlights on the emerging blueprints, shallow depth of field, wide 16:9 composition.";

console.log(`[gen] loop-never-ends-hero → ${outputPath}`);
const t0 = Date.now();
const res = await generateImage(prompt, {
  model: "grok-imagine-image",
  outputPath,
  format: "webp",
  quality: 88,
});
const ms = Date.now() - t0;
if (res.success) {
  console.log(`[gen] OK in ${ms}ms → ${res.localPath || outputPath}`);
  if (res.revisedPrompt && res.revisedPrompt !== prompt) {
    console.log(`[gen] revised prompt:\n  ${res.revisedPrompt.slice(0, 200)}...`);
  }
} else {
  console.error(`[gen] FAILED: ${res.error}`);
  process.exitCode = 1;
}
