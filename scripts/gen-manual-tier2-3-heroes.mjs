#!/usr/bin/env node
// Generate Tier 2 + Tier 3 manual chapter hero images via xAI Grok Aurora.
// Usage: node scripts/gen-manual-tier2-3-heroes.mjs [slug|all]  (default: all)
//
// Tier 2 (important, medium-traffic):
//   ch9-hero       customization.html
//   ch10-hero      instructions-agents.html
//   ch11-hero      mcp-server.html
//   ch12-hero-ext  extensions.html
//   ch19-hero      watcher.html
//   ch20-hero      remote-bridge.html
//
// Tier 3 (nice-to-have, deep-dives + Learn):
//   ch21-hero      bug-registry.html
//   ch22-hero      testbed.html
//   ch23-hero      health-dna.html
//   ch24-hero      memory-architecture.html
//   ch-sdl-hero    self-deterministic-loop.html
//   ch-inner-hero  inner-loop.html
//   ch-comp-hero   competitive-loop.html
//   ch-audit-hero  audit-loop.html
//   ch-update-hero update-source.html

import { generateImage } from "../pforge-mcp/orchestrator.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "docs/manual/assets/chapter-heroes");
mkdirSync(OUT_DIR, { recursive: true });

const NEGATIVE = " ABSOLUTELY NO text, NO words, NO letters, NO numbers, NO writing anywhere.";
const PALETTE = " Painterly digital art, amber #f59e0b warm fire + slate #0f172a deep shadows, cinematic lighting, 16:9 wide composition.";

const variants = {
  // ─── Tier 2 ────────────────────────────────────────────────────────
  "ch9-hero": {
    name: "ch9-hero.jpg",
    prompt:
      "A weathered leather-bound project crest seal pressed into a sheet of glowing amber wax on a stone forge bench. The crest depicts an anvil-and-shield emblem with sub-icons radiating around it (gear, scale, lock, eye). A blacksmith's gloved hand holds the seal-stamp." +
      PALETTE + NEGATIVE,
  },
  "ch10-hero": {
    name: "ch10-hero.jpg",
    prompt:
      "A constellation of glowing amber nodes interconnected by fine threads of light, hovering in a dim forge interior. Each node is a small abstract symbol (shield, scroll, gear, eye). The nodes pulse with light suggesting auto-loading rules. A faint forge backdrop with embers." +
      PALETTE + NEGATIVE,
  },
  "ch11-hero": {
    name: "ch11-hero.jpg",
    prompt:
      "An isometric server architecture rendered as a stack of glowing amber tower-anvils, each radiating tool icons (wrench, scroll, eye, shield, gauge, key, gear, lightning). Geometric data streams flow between them. Slate background with wireframe accents. Painterly digital art, technical schematic aesthetic." +
      PALETTE + NEGATIVE,
  },
  "ch12-hero-ext": {
    name: "ch12-hero-ext.jpg",
    prompt:
      "A row of polished wooden marketplace shelves in a forge workshop, each shelf holding glowing amber crate-boxes labeled with abstract guild symbols (interlocking rings, runic glyphs). A blacksmith reaches up to lift one crate. Warm forge light, embers drifting." +
      PALETTE + NEGATIVE,
  },
  "ch19-hero": {
    name: "ch19-hero.jpg",
    prompt:
      "A tall stone watchtower rising above a foggy forge valley at dusk, with two glowing amber lantern-eyes at the top scanning the horizon. In the distance, smaller forge fires dot the landscape \u2014 the watcher observing other forges from afar. Painterly cinematic landscape, amber and deep slate-blue palette." +
      NEGATIVE,
  },
  "ch20-hero": {
    name: "ch20-hero.jpg",
    prompt:
      "A glowing amber bridge made of light spans between a stone forge on the left and a constellation of floating messaging-icon orbs on the right (chat bubble, bell, envelope, megaphone, shield). The bridge pulses with data flowing both directions. Painterly digital art, cinematic." +
      PALETTE + NEGATIVE,
  },

  // ─── Tier 3 ────────────────────────────────────────────────────────
  "ch21-hero": {
    name: "ch21-hero.jpg",
    prompt:
      "A leather-bound ledger lying open on a forge bench, its pages glowing with a unique fingerprint pattern beside each entry, illuminated by amber forge-light. A small bug-icon glyph hovers above the ledger. Painterly digital art." +
      PALETTE + NEGATIVE,
  },
  "ch22-hero": {
    name: "ch22-hero.jpg",
    prompt:
      "A laboratory section of a forge workshop: rows of glass vials and brass test fixtures lit from within with amber light, each one containing a glowing micro-blueprint or rune. A blacksmith examines one vial through a magnifying lens. Painterly digital art, alchemy-meets-engineering aesthetic." +
      PALETTE + NEGATIVE,
  },
  "ch23-hero": {
    name: "ch23-hero.jpg",
    prompt:
      "A glowing golden DNA double-helix rendered as interlocking forge-glyphs (gauges, hammers, shields, gears, charts) instead of nucleotide letters. Encased in a translucent crystal vial standing on a stone bench, with a faint heartbeat pulse passing through it. Painterly digital art, amber-on-slate cinematic." +
      NEGATIVE,
  },
  "ch24-hero": {
    name: "ch24-hero.jpg",
    prompt:
      "A three-tier vault carved into stone: lower tier crackling with live amber sparks (hub events), middle tier filled with rolled scrolls glowing softly (file artifacts), upper tier holding a single radiant golden brain-orb (semantic memory). All three tiers connected by glowing channels. Painterly cinematic, forge-architecture aesthetic." +
      NEGATIVE,
  },
  "ch-sdl-hero": {
    name: "ch-sdl-hero.jpg",
    prompt:
      "A circular flow diagram floating above a stone forge bench: glowing amber arrows curving between four totems \u2014 a hammer, a mirror, a scroll, and a brain \u2014 with feedback arcs spiraling inward to a central glowing core. Painterly digital art, mystical-technical aesthetic." +
      PALETTE + NEGATIVE,
  },
  "ch-inner-hero": {
    name: "ch-inner-hero.jpg",
    prompt:
      "A polished bronze hand-mirror lying on a forge bench, but instead of reflecting the room, the mirror shows a glowing amber spiral of feedback loops curving inward toward a small glowing core. Painterly digital art, contemplative aesthetic." +
      PALETTE + NEGATIVE,
  },
  "ch-comp-hero": {
    name: "ch-comp-hero.jpg",
    prompt:
      "Three blacksmith-spirits in semi-translucent forms (one green-tinted, one blue, one gold) racing side-by-side on parallel forge tracks, each hammering at their own anvil. A central glowing finish-line beam waits ahead. Sparks fly from all three anvils. Painterly cinematic, motion-blur energy." +
      PALETTE + NEGATIVE,
  },
  "ch-audit-hero": {
    name: "ch-audit-hero.jpg",
    prompt:
      "A large bronze funnel hanging in a forge interior, glowing amber findings (small gem-like motes) flowing into it from above and being sorted into three labeled output channels (left, center, right). The channels disappear into the floor and re-emerge feeding back into the top of the funnel. Closed-loop aesthetic. Painterly digital art." +
      PALETTE + NEGATIVE,
  },
  "ch-update-hero": {
    name: "ch-update-hero.jpg",
    prompt:
      "A stone forge crossroads at twilight: two glowing amber paths diverge from a central anvil. The left path leads up a hill toward a distant glowing gate (GitHub-style), the right path leads down toward a shadowy sibling-forge. A blacksmith stands at the junction holding a lantern. Painterly cinematic landscape." +
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
