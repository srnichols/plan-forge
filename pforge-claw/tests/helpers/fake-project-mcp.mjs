#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const TOOLS = Object.freeze([
  "forge_master_ask",
  "forge_estimate_quorum",
  "forge_watch_live",
  "forge_abort",
  "forge_search",
  "forge_capabilities",
]);
let logPath;

function parseOptions() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: { log: { type: "string" } },
  });
  logPath = parsed.values.log;
}

function toolResult(name) {
  const outputs = {
    forge_master_ask: {
      answer: "A deterministic fixture response.",
      proposedActions: [{ priority: "P0", kind: "task", args: { description: "Fixture action" } }],
    },
    forge_estimate_quorum: { auto: { estimatedCostUSD: 0 }, power: { estimatedCostUSD: 0 }, speed: { estimatedCostUSD: 0 }, false: { estimatedCostUSD: 0 } },
    forge_watch_live: { state: "idle", active: false },
    forge_abort: { ok: true, aborted: false },
    forge_search: { hits: [], total: 0, message: "No fixture matches." },
    forge_capabilities: { tools: TOOLS },
  };
  return outputs[name];
}

async function respond(message) {
  if (message.method?.startsWith("notifications/")) return;
  const { id, method, params = {} } = message;
  if (method === "initialize") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-project-mcp", version: "1.0.0" },
      },
    })}\n`);
    return;
  }
  if (method === "tools/list") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0", id,
      result: { tools: TOOLS.map((name) => ({
        name, description: `Fixture ${name}`, inputSchema: { type: "object", properties: {} },
      })) },
    })}\n`);
    return;
  }
  if (method === "tools/call") {
    const name = params.name;
    if (logPath) await appendFile(logPath, `${JSON.stringify({ name, arguments: params.arguments ?? {} })}\n`);
    const unknown = !TOOLS.includes(name);
    const result = unknown
      ? { isError: true, content: [{ type: "text", text: "UNEXPECTED_TOOL" }] }
      : { content: [{ type: "text", text: JSON.stringify(toolResult(name)) }] };
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
    return;
  }
  if (id !== undefined) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0", id,
      error: { code: -32601, message: "Method not found" },
    })}\n`);
  }
}

parseOptions();
let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  while (buffered.includes("\n")) {
    const index = buffered.indexOf("\n");
    const line = buffered.slice(0, index);
    buffered = buffered.slice(index + 1);
    if (!line.trim()) continue;
    void respond(JSON.parse(line)).catch((error) => {
      process.stderr.write(`${error.code ?? "FAKE_MCP_FAILED"}\n`);
      process.exitCode = 1;
    });
  }
});
process.stdin.on("end", () => {
  if (buffered.trim()) void respond(JSON.parse(buffered));
});
