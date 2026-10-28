#!/usr/bin/env node
/**
 * Keeps docs/.well-known/plan-forge.json, the machine-readable descriptor the site publishes at
 * /.well-known/plan-forge.json (RFC 8615), in step with what it says about the product (#415).
 *
 *   node scripts/generate-well-known.mjs           # rewrite the derived fields
 *   node scripts/generate-well-known.mjs --check   # exit 1 if any of them is out of date
 *
 * Derived: `version` (VERSION; sync-versions.mjs also keeps it current at release), the MCP tool count and
 * names (pforge-mcp/tools.json, which the capabilities-drift workflow checks against the server's registry),
 * the preset count (pforge-mcp/preset-catalog.json, without `custom`), and the tool count in the description.
 * Everything else stays as the file has it, formatting and line endings included. The file states no count
 * that nothing verifies: agents, skills, prompts, dashboard tabs and models change with each release, so the
 * `forge_capabilities` tool is the source for them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DESCRIPTOR = "docs/.well-known/plan-forge.json";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (root, relative) => JSON.parse(readFileSync(join(root, relative), "utf8"));

/** What the repository says: the version, the registered tool names and the shipped preset count. */
function readFacts(root) {
  const tools = readJson(root, "pforge-mcp/tools.json");
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool?.name !== "string")) {
    throw new Error("pforge-mcp/tools.json is not a list of tools with names");
  }
  const presets = Object.keys(readJson(root, "pforge-mcp/preset-catalog.json").presets).filter((name) => name !== "custom");
  return { version: readFileSync(join(root, "VERSION"), "utf8").trim(), toolNames: tools.map((tool) => tool.name), presetCount: presets.length };
}

/**
 * The derived fields: where each sits in the file, and what goes there. A pattern has a leading and a trailing
 * group that are kept; the value goes between them. The file's own layout is relied on, so a field that is not
 * found is an error and not a guess.
 */
const FIELDS = [
  { label: "version", pattern: /^(\s*"version"\s*:\s*")[^"\n]*(")/m, value: (facts) => facts.version },
  { label: "tool count in the description", pattern: /("description"\s*:\s*"[^"\n]*?)\d+( MCP tools)/, value: (facts) => facts.toolNames.length },
  { label: "capabilities.mcp_tools", pattern: /("mcp_tools"\s*:\s*)\d+()/, value: (facts) => facts.toolNames.length },
  { label: "capabilities.presets", pattern: /("presets"\s*:\s*)\d+()/, value: (facts) => facts.presetCount },
  {
    label: "mcp_tools list",
    pattern: /("mcp_tools"\s*:\s*\[\n)[\s\S]*?(\n  \])/,
    value: (facts) => facts.toolNames.map((name) => `    ${JSON.stringify(name)}`).join(",\n"),
  },
];

/**
 * @param {string} [root] - a checkout; the repository this script is in by default
 * @returns {string} the descriptor's text with every derived field current, in the line endings the file has
 */
export function renderDescriptor(root = REPO) {
  const original = readFileSync(join(root, DESCRIPTOR), "utf8");
  const facts = readFacts(root);
  let text = original.replace(/\r\n/g, "\n");
  for (const { label, pattern, value } of FIELDS) {
    if (!pattern.test(text)) throw new Error(`${DESCRIPTOR}: cannot find the ${label}`);
    text = text.replace(pattern, (_match, head, tail) => `${head}${value(facts)}${tail}`);
  }
  try {
    JSON.parse(text);
  } catch (err) {
    throw new Error(`${DESCRIPTOR}: not valid JSON after the update: ${err.message}`);
  }
  return original.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

function parseArgs(argv) {
  const args = { root: REPO, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--root") args.root = resolve(argv[++i] ?? "");
    else throw new Error(`unknown option ${arg}`);
  }
  return args;
}

/** @returns {number} the exit status: 0 current or rewritten, 1 out of date under --check, 2 could not be read */
export function main(argv) {
  const { root, check } = parseArgs(argv);
  const file = join(root, DESCRIPTOR);
  const current = readFileSync(file, "utf8");
  const updated = renderDescriptor(root);
  if (updated === current) {
    console.log(`${DESCRIPTOR} is current`);
    return 0;
  }
  if (check) {
    console.error(`${DESCRIPTOR} is out of date: run node scripts/generate-well-known.mjs`);
    return 1;
  }
  writeFileSync(file, updated);
  console.log(`Updated ${DESCRIPTOR}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`generate-well-known: ${err.message}`);
    process.exitCode = 2;
  }
}
