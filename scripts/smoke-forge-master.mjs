#!/usr/bin/env node
/**
 * Plan Forge — Forge-Master smoke runner (Phase-33, Slice 3).
 *
 * Invokes the Forge-Master reasoning loop with a live advisory prompt and
 * writes a timestamped markdown transcript to .forge/smoke/.
 *
 * Prerequisites: `gh auth login`  (or set GITHUB_TOKEN env var)
 *
 * Usage (Unix):
 *   FORGE_SMOKE=1 node scripts/smoke-forge-master.mjs
 *
 * Usage (Windows — without cross-env):
 *   set FORGE_SMOKE=1 && node scripts/smoke-forge-master.mjs
 *
 * npm shortcut (Unix):
 *   npm run smoke:forge-master
 *
 * Exit codes:
 *   0 — success (transcript written, reply printed to stdout)
 *   1 — provider error or unexpected failure
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { classify } from "../pforge-master/src/intent-router.mjs";
import { runTurn } from "../pforge-master/src/reasoning.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SMOKE_PROMPT =
  "Should I refactor the orchestrator worker spawn logic or ship Phase-34 first?";

async function main() {
  const startMs = Date.now();

  // Classify first (no model call — fast keyword router)
  const classification = await classify(SMOKE_PROMPT);

  // Live reasoning turn
  const result = await runTurn({ message: SMOKE_PROMPT });

  if (result.error) {
    process.stderr.write(`[smoke-forge-master] Error: ${result.error}\n`);
    if (result.suggestion) {
      process.stderr.write(`Suggestion: ${result.suggestion}\n`);
    }
    process.exit(1);
  }

  const durationMs = Date.now() - startMs;
  const isoNow = new Date().toISOString().replace(/[:.]/g, "-");
  const transcriptDir = resolve(ROOT, ".forge", "smoke");
  const transcriptPath = resolve(transcriptDir, `forge-master-${isoNow}.md`);

  const transcript = buildTranscript({
    prompt: SMOKE_PROMPT,
    lane: classification.lane,
    model: result.model || "gpt-4o-mini",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    reply: result.reply,
    durationMs,
    isoNow: new Date().toISOString(),
  });

  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(transcriptPath, transcript, "utf-8");

  process.stdout.write(result.reply + "\n");
  process.stdout.write(
    `\n[smoke-forge-master] Transcript written to ${transcriptPath}\n`,
  );
}

function buildTranscript({ prompt, lane, model, tokensIn, tokensOut, reply, durationMs, isoNow }) {
  return `# Forge-Master Smoke Run — ${isoNow}

## Prompt

${prompt}

## Classification

Lane: ${lane}

## Response

Model: ${model}
Tokens in: ${tokensIn}
Tokens out: ${tokensOut}
Duration: ${durationMs}ms

\`\`\`
${reply}
\`\`\`
`;
}

main().catch((err) => {
  process.stderr.write(
    `[smoke-forge-master] Unexpected error: ${err?.message || String(err)}\n`,
  );
  process.exit(1);
});
