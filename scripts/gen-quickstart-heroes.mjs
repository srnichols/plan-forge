#!/usr/bin/env node
// Generate Quickstart hero images via xAI Grok Aurora.
// Usage: node scripts/gen-quickstart-heroes.mjs [slug|all]  (default: all)
//
// Quickstart heroes (3-page fast-path series):
//   quickstart-install-hero      quickstart-install.html
//   quickstart-first-plan-hero   quickstart-first-plan.html
//   quickstart-first-deploy-hero quickstart-first-deploy.html

import { generateImage } from "../pforge-mcp/orchestrator.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "docs/manual/assets/chapter-heroes");
mkdirSync(OUT_DIR, { recursive: true });

const NEGATIVE = " ABSOLUTELY NO text, NO words, NO letters, NO numbers, NO writing anywhere.";
const PALETTE = " Painterly digital art, amber #f59e0b warm fire + slate #0f172a deep shadows, cinematic lighting, 16:9 wide composition.";

const variants = {
  "quickstart-install-hero": {
    name: "quickstart-install-hero.jpg",
    prompt:
      "A fresh forge workbench scene: gleaming new tools laid out in order — a hammer, wrench, terminal scroll, and gear — beside an unlit anvil ready to be struck for the first time. A single amber ember glows in the forge background, suggesting readiness and anticipation. Clean, inviting, wide-open workspace with slate stone walls. The Plan Forge anvil-and-shield emblem glows softly overhead." +
      PALETTE + NEGATIVE,
  },
  "quickstart-first-plan-hero": {
    name: "quickstart-first-plan-hero.jpg",
    prompt:
      "A first blueprint scroll being unrolled on a lit forge workbench, the parchment glowing amber at the edges as if freshly stamped. A compass-rose pin marks a single starting point at the top of the scroll. Abstract geometric plan shapes — a slice boundary box, scope outline, and a single validation-gate arch — glow lightly on the surface. The forge smolders warmly behind. Minimal, focused composition, sense of beginning." +
      PALETTE + NEGATIVE,
  },
  "quickstart-first-deploy-hero": {
    name: "quickstart-first-deploy-hero.jpg",
    prompt:
      "Launch moment in a forge: a blacksmith raises a glowing amber hammer above a newly completed artifact on the anvil, sparks caught mid-flight in a brilliant arc. The artifact radiates light as if alive. The forge door behind stands open, showing the outside world — stars and a rising horizon — ready to receive the finished work. Dramatic, triumphant composition, sense of first achievement." +
      PALETTE + NEGATIVE,
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
