import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('E:\\GitHub\\Plan-Forge\\pforge-mcp');
const serverPath = resolve(root, 'server.mjs');
const lines = readFileSync(serverPath, 'utf8').split(/\r?\n/);
const nl = '\n';

function range(start, end) {
  return lines.slice(start - 1, end).join(nl);
}

function buildRestImports() {
  const out = [];
  for (let i = 17; i <= 208; i++) {
    if ((i >= 17 && i <= 22) || (i >= 28 && i <= 58) || i === 195 || (i >= 197 && i <= 198) || i === 201 || i === 205 || i === 209) {
      continue;
    }
    let line = lines[i - 1];
    if (line.includes('from "./server/')) {
      line = line.replace('from "./server/', 'from "./');
    } else if (line.includes('from "./')) {
      line = line.replace('from "./', 'from "../');
    }
    out.push(line);
  }
  out.push('import { server } from "./mcp-handler.mjs";');
  out.push('import { runDrainPass, __shouldDrainOnInit } from "./openbrain-bridge.mjs";');
  return out.join(nl);
}

const restImports = buildRestImports();
const restSupport = range(342, 476).replace('const REST_ROUTES = [', 'export const REST_ROUTES = [');
let restBody = range(478, 3162);
restBody = restBody
  .replaceAll('import("./cost-service.mjs")', 'import("../cost-service.mjs")')
  .replaceAll('import("./notifications/core.mjs")', 'import("../notifications/core.mjs")')
  .replaceAll('import("./orchestrator.mjs")', 'import("../orchestrator.mjs")')
  .replaceAll('import("./forge-master-routes.mjs")', 'import("../forge-master-routes.mjs")');

const restApi = [
  restImports,
  '',
  'const __dirname = resolve(fileURLToPath(new URL("..", import.meta.url)));',
  '',
  restSupport,
  '',
  restBody,
  '',
].join(nl);

const openbrainBridge = [
  'import { resolve } from "node:path";',
  'import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";',
  'import { drainOpenBrainQueue, isOpenBrainConfigured } from "../memory.mjs";',
  'import { readForgeJsonl, appendForgeJsonl } from "../orchestrator.mjs";',
  'import { setPlanPathAliasWarned } from "./state.mjs";',
  '',
  range(237, 340),
  '',
].join(nl);

const mcpHandler = [
  'import { Server } from "@modelcontextprotocol/sdk/server/index.js";',
  'import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";',
  'import { FRAMEWORK_VERSION, setMcpServerRef } from "./state.mjs";',
  'import { TOOLS } from "./tool-definitions.mjs";',
  'import { callToolRequestHandler } from "./tool-handlers.mjs";',
  '',
  '// ─── MCP Server ───────────────────────────────────────────────────────',
  'export const server = new Server(',
  '  // Issue #106: report the running install\'s version, not a stale literal.',
  '  { name: "plan-forge-mcp", version: FRAMEWORK_VERSION },',
  '  { capabilities: { tools: {} } }',
  ');',
  'setMcpServerRef(server);',
  '',
  'server.setRequestHandler(ListToolsRequestSchema, async () => ({',
  '  tools: TOOLS,',
  '}));',
  '',
  'server.setRequestHandler(CallToolRequestSchema, callToolRequestHandler);',
  '',
].join(nl);

const surface = [
  'import { TOOLS } from "./tool-definitions.mjs";',
  'import { REST_ROUTES } from "./rest-api.mjs";',
  'import { MCP_ONLY_TOOLS } from "./tool-handlers.mjs";',
  '',
  range(3164, 3182),
  '',
].join(nl);

let mainBody = range(3185, 3367).replace('async function main() {', 'export async function runServerMain() {');
const main = [
  'import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";',
  'import { resolve } from "node:path";',
  'import { existsSync, mkdirSync, writeFileSync } from "node:fs";',
  'import { fileURLToPath } from "node:url";',
  'import { PROJECT_DIR, HTTP_PORT, FRAMEWORK_VERSION, activeHub, activeBridge, activeEventWatcher, _studioClient, setActiveHub, setActiveBridge, setActiveEventWatcher, setStudioClient } from "./state.mjs";',
  'import { TOOLS } from "./tool-definitions.mjs";',
  'import { server } from "./mcp-handler.mjs";',
  'import { createExpressApp } from "./rest-api.mjs";',
  'import { runDrainPass, __shouldDrainOnInit } from "./openbrain-bridge.mjs";',
  'import { createHub } from "../hub.mjs";',
  'import { createBridge } from "../bridge.mjs";',
  'import { startEventFileWatcher } from "./helpers.mjs";',
  'import { checkForUpdate, detectCorruptInstall } from "../update-check.mjs";',
  'import { writeToolsJson, writeCliSchema } from "../capabilities.mjs";',
  '',
  'const __dirname = resolve(fileURLToPath(new URL("..", import.meta.url)));',
  '',
  mainBody,
  '',
].join(nl);

const shim = [
  '#!/usr/bin/env node',
  '/**',
  ' * Plan Forge MCP Server',
  ' * Thin entrypoint + public re-export shim for the split server modules.',
  ' */',
  '',
  'import { existsSync, readFileSync } from "node:fs";',
  'import { resolve } from "node:path";',
  'import { fileURLToPath } from "node:url";',
  'import { PROJECT_DIR, PROJECT_DIR_SOURCE, FRAMEWORK_VERSION } from "./server/state.mjs";',
  'import { runServerMain } from "./server/main.mjs";',
  '',
  '// ─── Load .env from project root (cwd) at startup ──────────────────────',
  '// Lightweight parser — existing process.env values always win.',
  'try {',
  '  const envPath = resolve(process.cwd(), ".env");',
  '  if (existsSync(envPath)) {',
  '    const envContent = readFileSync(envPath, "utf8");',
  '    for (const rawLine of envContent.split(/\\r?\\n/)) {',
  '      const line = rawLine.trim();',
  '      if (!line || line.startsWith("#")) continue;',
  '      const eq = line.indexOf("=");',
  '      if (eq < 1) continue;',
  '      const key = line.slice(0, eq).trim();',
  '      let value = line.slice(eq + 1).trim();',
  '      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("\'") && value.endsWith("\'"))) value = value.slice(1, -1);',
  '      if (key && process.env[key] === undefined) process.env[key] = value;',
  '    }',
  '  }',
  '} catch {}',
  '',
  'console.error(`[pforge-mcp] PROJECT_DIR=${PROJECT_DIR} (source=${PROJECT_DIR_SOURCE})`);',
  'console.error(`[pforge-mcp] FRAMEWORK_VERSION=${FRAMEWORK_VERSION}`);',
  '',
  'export { resolveProjectRoot } from "./server/helpers.mjs";',
  'export { invokeForgeTool } from "./server/tool-handlers.mjs";',
  'export { _sweepAnvilCompute, _analyzeAnvilCompute, _temperingScanAnvilCompute, _hotspotAnvilCompute } from "./server/anvil-compute.mjs";',
  'export { runDrainPass, __resetPlanPathAliasWarned, __shouldDrainOnInit } from "./server/openbrain-bridge.mjs";',
  'export { createExpressApp } from "./server/rest-api.mjs";',
  'export { buildServerSurface } from "./server/surface.mjs";',
  '',
  'const isDirectRun = (() => {',
  '  try {',
  '    const entry = process.argv[1];',
  '    if (!entry) return false;',
  '    return resolve(entry) === resolve(fileURLToPath(import.meta.url));',
  '  } catch {',
  '    return false;',
  '  }',
  '})();',
  '',
  'if (isDirectRun) {',
  '  runServerMain().catch((err) => {',
  '    console.error("Fatal:", err);',
  '    process.exit(1);',
  '  });',
  '}',
  '',
].join(nl);

writeFileSync(resolve(root, 'server', 'rest-api.mjs'), restApi, 'utf8');
writeFileSync(resolve(root, 'server', 'openbrain-bridge.mjs'), openbrainBridge, 'utf8');
writeFileSync(resolve(root, 'server', 'mcp-handler.mjs'), mcpHandler, 'utf8');
writeFileSync(resolve(root, 'server', 'surface.mjs'), surface, 'utf8');
writeFileSync(resolve(root, 'server', 'main.mjs'), main, 'utf8');
writeFileSync(resolve(root, 'server.mjs'), shim, 'utf8');
