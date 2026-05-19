#!/usr/bin/env node
/**
 * enums-cli — print a named enum from enums.mjs as text or JSON.
 *
 * Usage:
 *   node pforge-mcp/bin/enums-cli.mjs --enum <NAME> [--format text|json]
 *
 * Examples:
 *   node pforge-mcp/bin/enums-cli.mjs --enum HOOK_PASCAL
 *   node pforge-mcp/bin/enums-cli.mjs --enum HOOK_NAMES --format json
 *
 * text (default): one value per line.  For objects, prints keys.
 * json:           JSON-serialised value (array or object).
 */

import {
  COST_SOURCES,
  ERROR_CODES,
  FORGE_MASTER_MODES,
  HOOK_CATEGORY,
  HOOK_NAMES,
  HOOK_PASCAL,
  MODEL_TIERS,
  QUORUM_MODES,
  WATCHER_MODES,
} from "../enums.mjs";

const REGISTRY = {
  COST_SOURCES,
  ERROR_CODES,
  FORGE_MASTER_MODES,
  HOOK_CATEGORY,
  HOOK_NAMES,
  HOOK_PASCAL,
  MODEL_TIERS,
  QUORUM_MODES,
  WATCHER_MODES,
};

const args = process.argv.slice(2);

function argValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const enumName = argValue("--enum");
const format = argValue("--format") ?? "text";

if (!enumName) {
  const names = Object.keys(REGISTRY).join(", ");
  process.stderr.write(`Usage: enums-cli.mjs --enum <NAME> [--format text|json]\nAvailable: ${names}\n`);
  process.exit(1);
}

if (!(enumName in REGISTRY)) {
  process.stderr.write(`Unknown enum '${enumName}'. Available: ${Object.keys(REGISTRY).join(", ")}\n`);
  process.exit(1);
}

const value = REGISTRY[enumName];

if (format === "json") {
  process.stdout.write(JSON.stringify(value) + "\n");
} else {
  const items = Array.isArray(value) ? value : Object.keys(value);
  for (const item of items) {
    process.stdout.write(item + "\n");
  }
}
