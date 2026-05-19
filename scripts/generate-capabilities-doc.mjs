#!/usr/bin/env node
/**
 * generate-capabilities-doc.mjs
 *
 * Regenerates the "## MCP Tools (N)" table in docs/capabilities.md.
 * Also updates the <!--c:tools-->N<!--/c--> count in docs/manual/glossary.html
 * and the tool-count sentence in docs/llms.txt.
 *
 * Usage:
 *   node scripts/generate-capabilities-doc.mjs          # update files in-place
 *   node scripts/generate-capabilities-doc.mjs --dry-run # print to stdout, no writes
 *   node scripts/generate-capabilities-doc.mjs --check   # exit 1 if files would change
 *
 * Source of truth for tool order: TOOL_NAMES in pforge-mcp/enums.mjs
 * Source of truth for descriptions: pforge-mcp/tools.json (auto-generated on server start)
 * Source of truth for intent/cost: TOOL_METADATA in pforge-mcp/capabilities.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkMode = args.includes("--check");

// ─── Load sources ─────────────────────────────────────────────────────

const { TOOL_NAMES } = await import(pathToFileURL(resolve(ROOT, "pforge-mcp/enums.mjs")));
const { TOOL_METADATA } = await import(pathToFileURL(resolve(ROOT, "pforge-mcp/capabilities.mjs")));
const toolsJsonPath = resolve(ROOT, "pforge-mcp/tools.json");

if (!existsSync(toolsJsonPath)) {
  process.stderr.write("[generate-capabilities-doc] tools.json not found — run the MCP server once to generate it\n");
  process.exit(1);
}

const toolsJson = JSON.parse(readFileSync(toolsJsonPath, "utf-8"));
const toolDescMap = Object.fromEntries(toolsJson.map((t) => [t.name, t.description ?? ""]));

// MCP tools = those present in tools.json (CLI-only anvil/hallmark are excluded from the MCP table)
const mcpToolNames = TOOL_NAMES.filter((n) => n in toolDescMap);
const mcpCount = mcpToolNames.length;

// ─── Build the MCP Tools table ────────────────────────────────────────

function escapeCell(str) {
  return String(str ?? "").replace(/\|/g, "\\|");
}

const rows = mcpToolNames.map((name) => {
  const meta = TOOL_METADATA[name] ?? {};
  const intent = Array.isArray(meta.intent) ? meta.intent[0] : (meta.intent ?? "");
  const cost = meta.cost ?? "low";
  const desc = escapeCell(toolDescMap[name] ?? "");
  return `| \`${name}\` | ${intent} | ${cost} | ${desc} |`;
});

const tableHeader = `## MCP Tools (${mcpCount})\n\n| Tool | Intent | Cost | Description |\n|------|--------|------|-------------|`;
const table = tableHeader + "\n" + rows.join("\n");

// ─── Update docs/capabilities.md ──────────────────────────────────────

const capPath = resolve(ROOT, "docs/capabilities.md");
const capOrig = readFileSync(capPath, "utf-8");

// Replace from "## MCP Tools" through the last row before the next "## " heading
const capUpdated = capOrig.replace(
  /## MCP Tools \(\d+\)\n[\s\S]*?(?=\n## )/,
  table + "\n"
);

if (capUpdated === capOrig && dryRun) {
  process.stdout.write("[generate-capabilities-doc] docs/capabilities.md: no changes needed\n");
} else if (capUpdated !== capOrig) {
  if (dryRun || checkMode) {
    process.stdout.write(`[generate-capabilities-doc] docs/capabilities.md: would update MCP Tools table (${mcpCount} tools)\n`);
  } else {
    writeFileSync(capPath, capUpdated, "utf-8");
    process.stdout.write(`[generate-capabilities-doc] docs/capabilities.md: updated (${mcpCount} tools)\n`);
  }
}

// ─── Update glossary.html count ───────────────────────────────────────

const glossaryPath = resolve(ROOT, "docs/manual/glossary.html");
if (existsSync(glossaryPath)) {
  const glossOrig = readFileSync(glossaryPath, "utf-8");
  const glossUpdated = glossOrig.replace(/<!--c:tools-->\d+<!--\/c-->/, `<!--c:tools-->${mcpCount}<!--/c-->`);
  if (glossUpdated !== glossOrig) {
    if (dryRun || checkMode) {
      process.stdout.write(`[generate-capabilities-doc] docs/manual/glossary.html: would update count → ${mcpCount}\n`);
    } else {
      writeFileSync(glossaryPath, glossUpdated, "utf-8");
      process.stdout.write(`[generate-capabilities-doc] docs/manual/glossary.html: updated count → ${mcpCount}\n`);
    }
  }
}

// ─── Update docs/llms.txt count ───────────────────────────────────────

const llmsPath = resolve(ROOT, "docs/llms.txt");
if (existsSync(llmsPath)) {
  const llmsOrig = readFileSync(llmsPath, "utf-8");
  const llmsUpdated = llmsOrig.replace(/^- \d+ MCP tools/m, `- ${mcpCount} MCP tools`);
  if (llmsUpdated !== llmsOrig) {
    if (dryRun || checkMode) {
      process.stdout.write(`[generate-capabilities-doc] docs/llms.txt: would update count → ${mcpCount}\n`);
    } else {
      writeFileSync(llmsPath, llmsUpdated, "utf-8");
      process.stdout.write(`[generate-capabilities-doc] docs/llms.txt: updated count → ${mcpCount}\n`);
    }
  }
}

// ─── Exit code for --check ────────────────────────────────────────────

if (checkMode) {
  const changed = capUpdated !== capOrig;
  if (changed) {
    process.stderr.write("[generate-capabilities-doc] DRIFT DETECTED: docs/capabilities.md is out of sync with enums.mjs TOOL_NAMES.\nRun: node scripts/generate-capabilities-doc.mjs\n");
    process.exit(1);
  } else {
    process.stdout.write("[generate-capabilities-doc] docs/capabilities.md is in sync\n");
  }
}
