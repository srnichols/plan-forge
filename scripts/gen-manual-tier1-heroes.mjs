#!/usr/bin/env node
// Generate Tier 1 manual chapter hero images via xAI Grok Aurora.
// Usage: node scripts/gen-manual-tier1-heroes.mjs [slug|all]  (default: all)
//
// Tier 1 (must-have, high-traffic chapters per MANUAL-AUDIT-2026-05.md):
//   ch3-hero      installation.html
//   ch5-hero      writing-plans.html
//   ch6-hero      crucible.html
//   ch7-hero      dashboard.html
//   ch8-hero      cli-reference.html
//   ch13-hero     advanced-execution.html
//   ch14-hero     troubleshooting.html

import { generateImage } from "../pforge-mcp/orchestrator.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "docs/manual/assets/chapter-heroes");
mkdirSync(OUT_DIR, { recursive: true });

const NEGATIVE = " ABSOLUTELY NO text, NO words, NO letters, NO numbers, NO writing anywhere.";

const variants = {
  "ch3-hero": {
    name: "ch3-hero.jpg",
    prompt:
      "Technical setup workshop scene: a craftsman/woman at a wooden workbench with the Plan Forge anvil-and-shield emblem glowing amber above. Surrounded by setup tools — wrench, checklist, gear, glowing terminal cursor — laid out neatly. Forge backdrop with embers drifting up. Painterly digital art, amber #f59e0b warm fire + slate #0f172a deep shadows, cinematic lighting, 16:9 wide composition." +
      NEGATIVE,
  },
  "ch5-hero": {
    name: "ch5-hero.jpg",
    prompt:
      "Architect's blueprint scroll unrolled across a dark workbench, glowing annotations in three colors: amber for in-scope paths, emerald for validation gates, red for forbidden zones. A leather-gloved hand holds a brass compass-rose pin marking a key boundary. Ember-lit forge backdrop. Painterly digital art, Plan Forge amber-on-slate brand palette, shallow depth of field, cinematic." +
      NEGATIVE,
  },
  "ch6-hero": {
    name: "ch6-hero.jpg",
    prompt:
      "Fiery crucible smelting pot in a stone forge, molten ore glowing amber inside, sparks crackling. Floating above the crucible: glowing question-mark glyphs and abstract geometric symbols crystallizing into a solid blueprint shape that hovers ready to be hammered. Amber and slate palette, painterly digital art, cinematic lighting, 16:9." +
      NEGATIVE,
  },
  "ch7-hero": {
    name: "ch7-hero.jpg",
    prompt:
      "Cinematic over-the-shoulder shot of a master smith in a leather apron looking at a wall of glowing amber screens (control room aesthetic). Each screen shows different live data streams — gauges, line charts, status lights, abstract geometric dashboards. Forge backdrop, amber + slate, embers drifting, painterly digital art, shallow depth of field." +
      NEGATIVE,
  },
  "ch8-hero": {
    name: "ch8-hero.jpg",
    prompt:
      "Hacker's terminal screen filling the frame, glowing amber on slate-black background, blinking cursor at the prompt. Forge sparks drift upward across the screen. Abstract geometric command glyphs (arrows, brackets, dots) glow softly along the screen edges as if flowing data. Painterly digital art, monospaced aesthetic, cinematic." +
      NEGATIVE,
  },
  "ch13-hero": {
    name: "ch13-hero.jpg",
    prompt:
      "Three distinct paths diverging from a central glowing decision node (escalation chain). Each path shows a different model-spirit-blacksmith working at its own anvil: a green spirit smith on the left path, a blue spirit smith on the middle path, a golden spirit smith on the right path. Each path arcs upward, with arrows showing escalation. Painterly digital art, amber and slate base palette with green/blue/gold accents, cinematic." +
      NEGATIVE,
  },
  "ch14-hero": {
    name: "ch14-hero.jpg",
    prompt:
      "A diagnostic decision tree etched in glowing amber lines on a slate-black background, branches forking and merging. Tool icons (wrench, magnifying glass, key, gear) glow at each leaf node. A leather-gloved hand traces one branch with a finger. Painterly digital art, Plan Forge amber-on-slate brand palette, abstract technical aesthetic." +
      NEGATIVE,
  },
};

const pick = (process.argv[2] || "all").toLowerCase();
const keys = pick === "all" ? Object.keys(variants) : [pick];

let okCount = 0;
let failCount = 0;

for (const k of keys) {
  const v = variants[k];
  if (!v) {
    console.error(`[gen] unknown variant ${k} — choose from: ${Object.keys(variants).join(", ")} | all`);
    process.exitCode = 2;
    continue;
  }
  const outputPath = resolve(OUT_DIR, v.name);
  console.log(`[gen] ${k} → ${outputPath}`);
  const t0 = Date.now();
  try {
    const res = await generateImage(v.prompt, {
      model: "grok-imagine-image",
      outputPath,
      format: "jpg",
      quality: 88,
    });
    const ms = Date.now() - t0;
    if (res.success) {
      console.log(`[gen] ${k} OK in ${ms}ms → ${res.localPath || outputPath}`);
      okCount++;
      if (res.revisedPrompt && res.revisedPrompt !== v.prompt) {
        console.log(`[gen] ${k} revised prompt:\n  ${res.revisedPrompt.slice(0, 200)}…`);
      }
    } else {
      console.error(`[gen] ${k} FAILED: ${res.error}`);
      failCount++;
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[gen] ${k} EXCEPTION: ${err.message}`);
    failCount++;
    process.exitCode = 1;
  }
}

console.log(`\n[gen] Done. ${okCount} OK, ${failCount} failed.`);
