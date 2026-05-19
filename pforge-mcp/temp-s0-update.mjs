import { readFileSync, writeFileSync } from 'node:fs';

const path = 'E:\\GitHub\\Plan-Forge\\pforge-mcp\\server.mjs';
let text = readFileSync(path, 'utf8');

const setStart = '  const MCP_ONLY_TOOLS = new Set([';
const appPost = '  app.post("/api/tool/:name", async (req, res) => {';
const startIdx = text.indexOf(setStart);
const appIdx = text.indexOf(appPost, startIdx);
if (startIdx === -1 || appIdx === -1) throw new Error('Could not locate MCP_ONLY_TOOLS block');
const setBlock = text.slice(startIdx, appIdx).trimEnd();
text = text.slice(0, startIdx) + text.slice(appIdx);

const startBanner = '// ─── Start ────────────────────────────────────────────────────────────';
const insertIdx = text.indexOf(startBanner);
if (insertIdx === -1) throw new Error('Could not locate Start banner');

const buildServerSurface = `export function buildServerSurface() {
  const tools = [...TOOLS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

  const restRoutes = Array.from(
    createExpressApp
      .toString()
      .matchAll(/app\\.(get|post|put|delete)\\(\\s*["'`]([^"'`]+)["'`]/g),
    ([, method, path]) => ({ method: method.toUpperCase(), path }),
  ).sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));

  return {
    tools,
    restRoutes,
    mcpOnlyTools: [...MCP_ONLY_TOOLS].sort(),
  };
}
`;

text = text.slice(0, insertIdx) + `${setBlock}\n\n${buildServerSurface}\n` + text.slice(insertIdx);
writeFileSync(path, text, 'utf8');
