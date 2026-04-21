#!/usr/bin/env node
// Generate two Forge-Master Studio concept images via xAI Grok.
// Usage: node scripts/gen-forge-master-images.mjs [A|B|both]  (default: both)

import { generateImage } from "../pforge-mcp/orchestrator.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "docs/assets");
mkdirSync(OUT_DIR, { recursive: true });

const variants = {
  A: {
    name: "forge-master-studio-hero.webp",
    prompt:
      "Dramatic low-angle cinematic shot: a master blacksmith stands at a central anvil under a vaulted stone forge-hall, hammer raised, mid-strike, glowing steel on the anvil casting warm amber light up his face. Arranged around him in a wide semicircle are three or four translucent, ghostly apprentice-smiths at smaller anvils, each caught mid-motion on their own piece of work — one hammering, one quenching in a barrel, one tonging steel from a brazier — rendered as faintly glowing blue-white spirits. Thin amber threads of light connect the master's hammer to each apprentice, like a conductor orchestrating an ensemble. Embers drift through the air. ABSOLUTELY NO text, NO words, NO letters, NO numbers, NO writing anywhere. Painterly digital art, cinematic lighting, amber #f59e0b warm fire + slate #0f172a deep shadows + cool cyan ghost-light, shallow depth of field, 16:9 wide composition.",
  },
  B: {
    name: "forge-master-chat-og.webp",
    prompt:
      "Tight close-up of a blacksmith's leather-gloved hand cupping a constellation of glowing amber runic glyphs and connected geometric nodes floating above the palm, like a miniature star-map of abstract symbols. Dark slate background, amber rim-lighting, drifting embers. ABSOLUTELY NO text, NO words, NO letters, NO numbers, NO writing — only abstract glowing runes and geometric symbols. Clean painterly illustration, Plan Forge amber-on-slate brand palette, wide social-card composition.",
  },
};

const pick = process.argv[2] || "both";
const keys = pick === "both" ? Object.keys(variants) : [pick.toUpperCase()];

for (const k of keys) {
  const v = variants[k];
  if (!v) {
    console.error(`[gen] unknown variant ${k}`);
    continue;
  }
  const outputPath = resolve(OUT_DIR, v.name);
  console.log(`[gen] ${k} → ${outputPath}`);
  const t0 = Date.now();
  const res = await generateImage(v.prompt, {
    model: "grok-imagine-image",
    outputPath,
    format: "webp",
    quality: 88,
  });
  const ms = Date.now() - t0;
  if (res.success) {
    console.log(`[gen] ${k} OK in ${ms}ms → ${res.localPath || outputPath}`);
    if (res.revisedPrompt && res.revisedPrompt !== v.prompt) {
      console.log(`[gen] ${k} revised prompt:\n  ${res.revisedPrompt.slice(0, 200)}...`);
    }
  } else {
    console.error(`[gen] ${k} FAILED: ${res.error}`);
    process.exitCode = 1;
  }
}
