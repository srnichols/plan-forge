#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const TOOLS = Object.freeze([
  "forge_master_ask",
  "forge_estimate_quorum",
  "forge_cost_report",
  "forge_watch_live",
  "forge_abort",
  "forge_search",
  "forge_capabilities",
  "forge_progress",
  "forge_digest_inputs",
  "forge_alerts",
  "forge_capture",
  "forge_memory_capture",
  "forge_recall",
  "forge_master_observe",
  "forge_plan_status",
]);
let logPath;
const MAX_WATCH_BYTES = 64 * 1024;
const FIXTURE_RUN_ID = "fixture-run-1";

async function watchFixture(args) {
  if (path.resolve(args.targetPath ?? "") !== process.cwd()) throw new Error("FAKE_WATCH_SCOPE_INVALID");
  let events = [];
  try {
    const contents = await readFile(path.join(process.cwd(), ".forge", "runs", FIXTURE_RUN_ID, "events.log"), "utf8");
    if (Buffer.byteLength(contents) > MAX_WATCH_BYTES) throw new Error("FAKE_WATCH_EVENTS_TOO_LARGE");
    events = contents.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const limit = args.maxCapturedEvents ?? 100;
  const captured = events.slice(-limit);
  return {
    ok: true, mode: "polling", durationMs: args.durationMs ?? 1000,
    capturedEvents: captured.length, droppedEvents: Math.max(0, events.length - captured.length),
    maxCapturedEvents: limit, capturedAnomalies: 0, eventProjection: args.verbose ? "verbose" : "lite",
    events: args.verbose ? captured : captured.map(({ ts, type }) => ({ ts, type, correlationId: null })),
  };
}

function parseOptions() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: { log: { type: "string" }, port: { type: "string" } },
  });
  logPath = parsed.values.log;
}

function toolResult(name) {
  const estimate = (mode) => ({
    mode, estimatedCostUSD: 0, totalSliceCount: 1, quorumSliceCount: 0,
  });
  const outputs = {
    forge_master_ask: {
      answer: "A deterministic fixture response.",
      proposedActions: [{ priority: "P0", kind: "task", args: { description: "Fixture action" } }],
    },
    forge_estimate_quorum: {
      recommended: "auto",
      auto: estimate("auto"),
      power: estimate("power"),
      speed: estimate("speed"),
      false: estimate("false"),
    },
    forge_cost_report: { totalCostUSD: 0, runs: [] },
    forge_abort: { ok: true, aborted: false },
    forge_search: { hits: [], total: 0, message: "No fixture matches." },
    forge_capabilities: { tools: TOOLS },
    forge_progress: { state: "idle", progress: 0 },
    forge_digest_inputs: { jobs: [], alerts: [], captured: [] },
    forge_alerts: { alerts: [], total: 0, message: "No fixture alerts." },
    forge_capture: { ok: true, id: "fixture-capture-1" },
    forge_memory_capture: { ok: true, id: "fixture-memory-capture-1" },
    forge_recall: { hits: [], total: 0, message: "No fixture memories." },
    forge_master_observe: {
      status: { running: true },
      insights: { items: [], total: 0, hasMore: false },
    },
    forge_plan_status: { plans: [], total: 0, message: "No active fixture plans." },
  };
  if (!Object.hasOwn(outputs, name)) throw new Error(`Unexpected fake MCP tool call: ${name}`);
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
    if (!TOOLS.includes(name)) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0", id,
        error: { code: -32601, message: `Unexpected fake MCP tool call: ${name}` },
      })}\n`);
      return;
    }
    const output = name === "forge_watch_live" ? await watchFixture(params.arguments ?? {}) : toolResult(name);
    const result = { content: [{ type: "text", text: JSON.stringify(output) }] };
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
      process.stdin.destroy();
    });
  }
});
process.stdin.on("end", () => {
  if (buffered.trim()) void respond(JSON.parse(buffered));
});
