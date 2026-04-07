/**
 * pforge-sdk — Tool registry helpers
 *
 * Loads tool metadata from pforge-mcp/tools.json and exposes
 * helpers for filtering by riskLevel, intent, or cost.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_PATH = resolve(__dirname, '../../pforge-mcp/tools.json');

function loadTools() {
  const raw = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.tools ?? Object.values(raw));
}

/** All tools from the Plan Forge MCP registry. */
export const tools = loadTools();

/**
 * Filter tools by riskLevel.
 * @param {'read-only'|'write'|'execute'} level
 */
export function getToolsByRisk(level) {
  return tools.filter((t) => t.riskLevel === level);
}

/**
 * Filter tools by intent keyword.
 * @param {string} intent
 */
export function getToolsByIntent(intent) {
  return tools.filter((t) => Array.isArray(t.intent) && t.intent.includes(intent));
}

/**
 * Get a single tool by name.
 * @param {string} name
 */
export function getTool(name) {
  return tools.find((t) => t.name === name) ?? null;
}
