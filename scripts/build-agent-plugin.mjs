#!/usr/bin/env node
/**
 * Build the Plan Forge agent plugin (Agent Plugins 1.0) from its canonical sources.
 *
 *   plugins/plan-forge/plugin.json                       manifest
 *   plugins/plan-forge/skills/<name>/                    ← presets/shared/skills/<name>/
 *   plugins/plan-forge/com.github.copilot/agents/*.md    ← templates/.github/agents/*.agent.md
 *   plugins/plan-forge/automations/*.automation.md       ← templates/.github/automations/
 *   .github/plugin/marketplace.json                      makes this repository a plugin marketplace
 *
 * The plugin is guidance only: the MCP server and hooks stay installed in each
 * project by setup.ps1 / setup.sh, because an installed plugin is copied out of
 * the repository on its own and cannot reach pforge-mcp/ or project scripts.
 *
 * Usage:
 *   node scripts/build-agent-plugin.mjs           # write the plugin
 *   node scripts/build-agent-plugin.mjs --check   # exit 1 if the committed plugin is stale
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN_NAME = "plan-forge";
export const PLUGIN_DIR = `plugins/${PLUGIN_NAME}`;
export const MARKETPLACE_FILE = ".github/plugin/marketplace.json";
const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const DESCRIPTION = "Plan Forge guardrails for agentic delivery: plan, harden, execute, review and ship skills, the pipeline agents, and scheduled check templates. Pair it with the Plan Forge MCP server that setup installs in your project.";

/**
 * Setup fills these in per project; a plugin serves many projects, so the
 * agent is told to resolve them itself.
 */
const PROJECT_PLACEHOLDER = /<YOUR ([A-Z ]+)>/g;
const genericPlaceholder = (_match, what) => `<this repository's ${what.toLowerCase()}>`;

const SOURCES = Object.freeze([
  { from: "presets/shared/skills", to: `${PLUGIN_DIR}/skills` },
  { from: "templates/.github/agents", to: `${PLUGIN_DIR}/com.github.copilot/agents` },
  { from: "templates/.github/automations", to: `${PLUGIN_DIR}/automations` },
]);

const toPosix = (p) => p.split("\\").join("/");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function renderGuidance(text) {
  return text.replace(PROJECT_PLACEHOLDER, genericPlaceholder);
}

function manifest() {
  return {
    $schema: AGENT_PLUGINS_SCHEMA,
    name: PLUGIN_NAME,
    description: DESCRIPTION,
    author: { name: "srnichols", url: "https://github.com/srnichols" },
    homepage: "https://github.com/srnichols/plan-forge",
    repository: "https://github.com/srnichols/plan-forge",
    license: "MIT",
    keywords: ["plan-forge", "planning", "guardrails", "code-review", "agents", "automations"],
  };
}

function marketplace() {
  return {
    name: PLUGIN_NAME,
    owner: { name: "srnichols" },
    metadata: { description: "Plan Forge agent plugins" },
    plugins: [{ name: PLUGIN_NAME, description: DESCRIPTION, source: PLUGIN_DIR }],
  };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Every file the plugin should contain, keyed by repo-relative POSIX path.
 * @param {{ root?: string }} [opts]
 * @returns {Map<string, string>}
 */
export function buildPluginFiles({ root = ROOT } = {}) {
  const files = new Map([
    [`${PLUGIN_DIR}/plugin.json`, json(manifest())],
    [MARKETPLACE_FILE, json(marketplace())],
  ]);
  for (const { from, to } of SOURCES) {
    const srcDir = join(root, from);
    if (!existsSync(srcDir)) continue;
    for (const file of walk(srcDir)) {
      const rel = toPosix(relative(srcDir, file));
      const raw = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      files.set(`${to}/${rel}`, file.endsWith(".md") ? renderGuidance(raw) : raw);
    }
  }
  return files;
}

function filesOnDisk(root) {
  const dir = join(root, PLUGIN_DIR);
  const found = existsSync(dir) ? walk(dir).map((f) => toPosix(relative(root, f))) : [];
  if (existsSync(join(root, MARKETPLACE_FILE))) found.push(MARKETPLACE_FILE);
  return found;
}

/**
 * Differences between the expected plugin and what is committed.
 * @returns {{ stale: string[], missing: string[], extra: string[] }}
 */
export function checkPlugin({ root = ROOT } = {}) {
  const expected = buildPluginFiles({ root });
  const onDisk = new Set(filesOnDisk(root));
  const result = { stale: [], missing: [], extra: [] };
  for (const [rel, content] of expected) {
    if (!onDisk.has(rel)) result.missing.push(rel);
    else if (readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n") !== content) result.stale.push(rel);
  }
  result.extra = [...onDisk].filter((rel) => !expected.has(rel));
  return result;
}

/** Rewrite the plugin directory and marketplace file from the sources. */
export function writePlugin({ root = ROOT } = {}) {
  const pluginDir = join(root, PLUGIN_DIR);
  if (existsSync(pluginDir) && statSync(pluginDir).isDirectory()) rmSync(pluginDir, { recursive: true, force: true });
  const files = buildPluginFiles({ root });
  for (const [rel, content] of files) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return files.size;
}

function main() {
  if (process.argv.includes("--check")) {
    const { stale, missing, extra } = checkPlugin();
    const problems = [...stale.map((f) => `stale   ${f}`), ...missing.map((f) => `missing ${f}`), ...extra.map((f) => `extra   ${f}`)];
    if (problems.length > 0) {
      console.error(`Agent plugin is out of date — run node scripts/build-agent-plugin.mjs\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log("Agent plugin is current.");
    return;
  }
  console.log(`Wrote ${writePlugin()} files to ${PLUGIN_DIR} and ${MARKETPLACE_FILE}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
