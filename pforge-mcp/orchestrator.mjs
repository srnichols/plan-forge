#!/usr/bin/env node
/**
 * Plan Forge Orchestrator — DAG-Based Plan Execution Engine
 *
 * Architecture:
 *   - parsePlan()          → Markdown → DAG of slices with metadata
 *   - SequentialScheduler  → executes slices in topological order (Phase 1)
 *   - ParallelScheduler    → interface stub for Phase 6
 *   - EventBus (DI)        → lifecycle events (Phase 3 hub subscribes)
 *   - Worker spawning      → gh copilot CLI (primary) with fallback chain
 *
 * Spike findings (Slice 0): gh copilot CLI is the primary worker.
 *   Non-interactive, context-aware, multi-model, JSONL output with tokens.
 *
 * Usage:
 *   node pforge-mcp/orchestrator.mjs --test              # run self-test
 *   node pforge-mcp/orchestrator.mjs --parse <plan>      # parse and dump DAG
 *
 * @module orchestrator
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { resolve, basename, dirname } from "node:path";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { createTraceContext, createTelemetryHandler, writeManifest, appendRunIndex, pruneRunHistory, addLogSummary } from "./telemetry.mjs";
import { isOpenBrainConfigured, buildMemorySearchBlock, buildMemoryCaptureBlock, buildRunSummaryThought, buildCostAnomalyThought } from "./memory.mjs";

// ─── Event Bus (C3: Dependency Injection) ─────────────────────────────

/**
 * Default event handler — writes events to log.
 * Phase 3: WebSocket hub replaces this via DI.
 */
class LogEventHandler {
  constructor(logDir) {
    this.logDir = logDir;
    this.events = [];
  }

  handle(event) {
    this.events.push(event);
    const ts = new Date().toISOString();
    const line = `[${ts}] ${event.type}: ${JSON.stringify(event.data)}\n`;
    if (this.logDir) {
      try {
        const logFile = resolve(this.logDir, "events.log");
        writeFileSync(logFile, line, { flag: "a" });
      } catch {
        // Log dir may not exist yet during early events
      }
    }
  }
}

/**
 * Orchestrator event bus with dependency-injected handler.
 * Wraps Node EventEmitter. Handler can be swapped for WebSocket hub (Phase 3).
 */
class OrchestratorEventBus extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler || new LogEventHandler(null);
    // Proxy all known events to the handler
    const events = [
      "run-started", "slice-started", "slice-completed",
      "slice-failed", "run-completed", "run-aborted",
      "quorum-dispatch-started", "quorum-leg-completed", "quorum-review-completed",
      "skill-started", "skill-step-started", "skill-step-completed", "skill-completed",
    ];
    for (const evt of events) {
      this.on(evt, (data) => this.handler.handle({ type: evt, data, timestamp: new Date().toISOString() }));
    }
  }
}

// ─── Plan Parser ──────────────────────────────────────────────────────

/**
 * Parse a hardened plan Markdown file into a structured DAG.
 *
 * Handles formats:
 *   ### Slice 1: Title
 *   ### Slice 12.1 — Title
 *   ### Slice N: Title [depends: Slice 1] [P] [scope: src/**]
 *
 * @param {string} planPath - Path to the plan Markdown file
 * @returns {{ meta, scopeContract, slices, dag }}
 */
export function parsePlan(planPath) {
  const fullPath = resolve(planPath);
  // C4: Validate path is within project to prevent traversal
  const projectRoot = resolve(process.cwd());
  if (!fullPath.startsWith(projectRoot)) {
    throw new Error(`Plan path must be within project directory: ${planPath}`);
  }
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  const meta = parseMeta(lines);
  const scopeContract = parseScopeContract(lines);
  const slices = parseSlices(lines);
  const dag = buildDAG(slices);

  return { meta, scopeContract, slices, dag };
}

function parseMeta(lines) {
  const meta = { title: "", status: "", branch: "", plan: "" };
  for (const line of lines) {
    if (line.startsWith("# ")) {
      meta.title = line.replace(/^#+\s*/, "").trim();
      break;
    }
  }
  for (const line of lines) {
    const statusMatch = line.match(/\*\*Status\*\*:\s*(.+)/);
    if (statusMatch) meta.status = statusMatch[1].trim();
    const branchMatch = line.match(/\*\*Feature Branch\*\*:\s*`([^`]+)`/);
    if (branchMatch) meta.branch = branchMatch[1];
  }
  return meta;
}

function parseScopeContract(lines) {
  const contract = { inScope: [], outOfScope: [], forbidden: [] };
  let section = null;

  for (const line of lines) {
    if (line.match(/^###\s+In Scope/i)) { section = "inScope"; continue; }
    if (line.match(/^###\s+Out of Scope/i)) { section = "outOfScope"; continue; }
    if (line.match(/^###\s+Forbidden/i)) { section = "forbidden"; continue; }
    if (line.match(/^##\s/) && section) { section = null; continue; }
    if (section && line.startsWith("- ")) {
      contract[section].push(line.replace(/^-\s*/, "").trim());
    }
  }
  return contract;
}

/**
 * Parse slices from plan Markdown. Supports multiple header formats.
 *
 * Tags parsed from headers (M6):
 *   [depends: Slice 1]           → dependency
 *   [depends: Slice 1, Slice 3]  → multiple dependencies
 *   [P]                          → parallel-eligible (Phase 6)
 *   [scope: src/auth/**]         → file scope metadata
 */
function parseSlices(lines) {
  const slices = [];
  let current = null;
  let inCodeBlock = false;
  let inValidationGate = false;
  let codeBlockContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // Closing code block
        if (inValidationGate && current) {
          current.validationGate = codeBlockContent.join("\n").trim();
          inValidationGate = false;
        }
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockContent = [];
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Match slice headers: ### Slice N: Title  OR  ### Slice N.N — Title
    const sliceMatch = line.match(
      /^###\s+Slice\s+([\d.]+)\s*[:\u2014—-]\s*(.+?)(?:\s*\[(.+?)\])*\s*$/u
    );
    if (sliceMatch) {
      // Save previous slice
      if (current) slices.push(current);

      const rawNumber = sliceMatch[1];
      const rawTitle = sliceMatch[2].trim();
      const rawTags = line; // Re-parse tags from full line

      current = {
        number: rawNumber,
        title: rawTitle,
        depends: [],
        parallel: false,
        scope: [],
        buildCommand: null,
        testCommand: null,
        validationGate: null,
        stopCondition: null,
        tasks: [],
        rawLines: [],
      };

      // Parse tags from the full header line
      const dependsMatch = rawTags.match(/\[depends:\s*([^\]]+)\]/i);
      if (dependsMatch) {
        current.depends = dependsMatch[1]
          .split(",")
          .map((d) => d.trim().replace(/^Slice\s+/i, ""));
      }

      const parallelMatch = rawTags.match(/\[P\]/);
      if (parallelMatch) current.parallel = true;

      const scopeMatch = rawTags.match(/\[scope:\s*([^\]]+)\]/i);
      if (scopeMatch) {
        current.scope = scopeMatch[1].split(",").map((s) => s.trim());
      }

      // Check for status marker (✅)
      if (rawTitle.includes("✅") || rawTags.includes("✅")) {
        current.status = "completed";
      }

      continue;
    }

    if (!current) continue;

    // Collect raw lines for the current slice
    current.rawLines.push(line);

    // Parse build command
    const buildMatch = line.match(/\*\*Build command\*\*:\s*`(.+?)`/);
    if (buildMatch) current.buildCommand = buildMatch[1];

    // Parse test command
    const testMatch = line.match(/\*\*Test command\*\*:\s*`(.+?)`/);
    if (testMatch) current.testCommand = testMatch[1];

    // Detect validation gate section
    if (line.match(/\*\*Validation Gate/i)) {
      inValidationGate = true;
      continue;
    }

    // Parse stop condition
    const stopMatch = line.match(/\*\*Stop Condition\*\*:\s*(.+)/);
    if (stopMatch) current.stopCondition = stopMatch[1].trim();

    // Parse numbered tasks
    const taskMatch = line.match(/^\d+\.\s+(.+)/);
    if (taskMatch) current.tasks.push(taskMatch[1].trim());
  }

  // Push last slice
  if (current) slices.push(current);

  return slices;
}

/**
 * Build a DAG from parsed slices.
 * If no explicit dependencies, assume sequential (each depends on prior).
 *
 * @returns {{ nodes: Map, order: string[] }}
 */
function buildDAG(slices) {
  const nodes = new Map();

  // Create nodes
  for (const slice of slices) {
    nodes.set(slice.number, {
      ...slice,
      children: [],
      inDegree: 0,
    });
  }

  // Build edges
  const hasAnyDeps = slices.some((s) => s.depends.length > 0);

  if (hasAnyDeps) {
    // Explicit dependency mode — use declared dependencies
    for (const slice of slices) {
      for (const dep of slice.depends) {
        const parent = nodes.get(dep);
        if (parent) {
          parent.children.push(slice.number);
          nodes.get(slice.number).inDegree++;
        }
      }
    }
  } else {
    // Sequential mode — each slice depends on the previous one
    for (let i = 1; i < slices.length; i++) {
      const prev = slices[i - 1].number;
      const curr = slices[i].number;
      nodes.get(prev).children.push(curr);
      nodes.get(curr).inDegree++;
    }
  }

  // Topological sort (Kahn's algorithm)
  const order = topologicalSort(nodes);

  return { nodes, order };
}

function topologicalSort(nodes) {
  const queue = [];
  const order = [];
  const inDegree = new Map();

  for (const [id, node] of nodes) {
    inDegree.set(id, node.inDegree);
    if (node.inDegree === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    const node = nodes.get(id);
    for (const child of node.children) {
      inDegree.set(child, inDegree.get(child) - 1);
      if (inDegree.get(child) === 0) queue.push(child);
    }
  }

  if (order.length !== nodes.size) {
    throw new Error("Cycle detected in slice dependencies — cannot build DAG");
  }

  return order;
}

// ─── API Provider Registry ────────────────────────────────────────────

/**
 * Registry of API-based model providers (OpenAI-compatible endpoints).
 * Each provider maps a model name pattern to an API endpoint + env var for the key.
 * Models matching a provider pattern are dispatched via HTTP instead of CLI.
 */
const API_PROVIDERS = {
  xai: {
    pattern: /^grok-/,
    baseUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
    label: "xAI Grok",
  },
  openai: {
    pattern: /^(gpt-|dall-e-|chatgpt-)/,
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    label: "OpenAI",
  },
  // Future providers:
  // anthropic: { pattern: /^claude-/, baseUrl: "https://api.anthropic.com/v1", envKey: "ANTHROPIC_API_KEY", label: "Anthropic Direct" },
};

/**
 * Detect which API provider (if any) handles a given model name.
 * @param {string} model - Model identifier (e.g., "grok-3-mini")
 * @returns {{ name, baseUrl, apiKey, label } | null}
 */
function detectApiProvider(model) {
  if (!model) return null;
  for (const [name, provider] of Object.entries(API_PROVIDERS)) {
    if (provider.pattern.test(model)) {
      const apiKey = process.env[provider.envKey];
      if (apiKey) return { name, baseUrl: provider.baseUrl, apiKey, label: provider.label };
      return null; // Model matches but no API key configured
    }
  }
  return null;
}

/**
 * Call an OpenAI-compatible API endpoint directly (no CLI).
 * Used for API-based providers (xAI Grok, etc.) in quorum and analysis modes.
 *
 * @param {string} prompt - The prompt text
 * @param {string} model - Model identifier
 * @param {{ name, baseUrl, apiKey, label }} provider - Resolved provider
 * @param {object} options - { timeout }
 * @returns {Promise<{ output, stderr, jsonlEvents, exitCode, timedOut, tokens, worker, model }>}
 */
async function callApiWorker(prompt, model, provider, options = {}) {
  const { timeout = 300_000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`${provider.label} API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const usage = data.usage || {};
    const completionDetails = usage.completion_tokens_details || {};

    return {
      output: choice?.message?.content || "",
      stderr: "",
      jsonlEvents: [],
      exitCode: 0,
      timedOut: false,
      tokens: {
        tokens_in: usage.prompt_tokens || 0,
        tokens_out: usage.completion_tokens || 0,
        model: data.model || model,
        premiumRequests: 0,
        apiDurationMs: 0,
        sessionDurationMs: 0,
        codeChanges: null,
        reasoning_tokens: completionDetails.reasoning_tokens || 0,
      },
      worker: `api-${provider.name}`,
      model: data.model || model,
    };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return {
        output: "",
        stderr: `${provider.label} API call timed out after ${timeout}ms`,
        jsonlEvents: [],
        exitCode: -1,
        timedOut: true,
        tokens: { tokens_in: 0, tokens_out: 0, model },
        worker: `api-${provider.name}`,
        model,
      };
    }
    throw err;
  }
}

/**
 * Generate an image via xAI Grok image API (Aurora).
 * Uses the OpenAI-compatible /v1/images/generations endpoint.
 *
 * @param {string} prompt - Text description of the image to generate
 * @param {object} options - { model, size, format, outputPath, cwd }
 * @returns {Promise<{ success, url, localPath, model, revisedPrompt }>}
 */
export async function generateImage(prompt, options = {}) {
  const {
    model = "grok-2-image",
    size = "1024x1024",
    format = "png",
    outputPath = null,
    cwd = process.cwd(),
  } = options;

  // Resolve provider — try the model's provider, then fall back to xAI, then OpenAI
  const provider = detectApiProvider(model) || detectApiProvider("grok-2-image") || detectApiProvider("dall-e-3");
  if (!provider) {
    return { success: false, error: "No image API key configured. Set XAI_API_KEY or OPENAI_API_KEY environment variable." };
  }

  try {
    const response = await fetch(`${provider.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return { success: false, error: `Image generation failed (${response.status}): ${errBody}` };
    }

    const data = await response.json();
    const imageData = data.data?.[0];
    if (!imageData?.b64_json) {
      return { success: false, error: "No image data in response" };
    }

    const result = {
      success: true,
      model: data.model || model,
      revisedPrompt: imageData.revised_prompt || prompt,
    };

    // Save to file if outputPath specified
    if (outputPath) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname, resolve: pathResolve } = await import("node:path");
      const fullPath = pathResolve(cwd, outputPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, Buffer.from(imageData.b64_json, "base64"));
      result.localPath = fullPath;
    }

    // Also return base64 for inline use
    result.base64 = imageData.b64_json.substring(0, 100) + "..."; // Truncated for logging
    result.fullBase64Length = imageData.b64_json.length;

    return result;
  } catch (err) {
    return { success: false, error: `Image generation error: ${err.message}` };
  }
}

// ─── Worker Spawning ──────────────────────────────────────────────────

/**
 * Detect available workers (CLI + API providers).
 * @returns {{ name: string, available: boolean, type: "cli"|"api" }[]}
 */
export function detectWorkers() {
  const cliWorkers = [
    { name: "gh-copilot", command: "gh", args: ["copilot", "--", "--version"] },
    { name: "claude", command: "claude", args: ["--version"] },
    { name: "codex", command: "codex", args: ["--version"] },
  ];

  const results = cliWorkers.map((w) => {
    try {
      execSync(`${w.command} ${w.args.join(" ")}`, {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: "pipe",
      });
      return { name: w.name, available: true, type: "cli" };
    } catch {
      return { name: w.name, available: false, type: "cli" };
    }
  });

  // Detect API providers
  for (const [name, provider] of Object.entries(API_PROVIDERS)) {
    const apiKey = process.env[provider.envKey];
    results.push({
      name: `api-${name}`,
      available: !!apiKey,
      type: "api",
      label: provider.label,
      models: provider.pattern.toString(),
    });
  }

  return results;
}

/**
 * Spawn a worker process to execute a slice.
 *
 * Primary: gh copilot CLI with JSONL output
 * Fallback: claude → codex → error
 *
 * @param {string} prompt - The slice instructions
 * @param {object} options - { model, cwd, timeout }
 * @returns {Promise<{ output, jsonlEvents, exitCode, tokens }>}
 */
export function spawnWorker(prompt, options = {}) {
  const {
    model = null,
    cwd = process.cwd(),
    timeout = 1_200_000, // 20 min default
    worker = null,     // override worker choice
  } = options;

  // Route API-based models (e.g., grok-*) to HTTP provider instead of CLI
  const apiProvider = model ? detectApiProvider(model) : null;
  if (apiProvider) {
    return callApiWorker(prompt, model, apiProvider, { timeout });
  }

  return new Promise((workerResolve, workerReject) => {
    const workers = worker ? [{ name: worker }] : detectWorkers().filter((w) => w.available && w.type !== "api");
    if (workers.length === 0) {
      workerReject(new Error("No CLI workers available. Install gh copilot, claude, or codex CLI."));
      return;
    }

    const chosen = workers[0];
    let args;
    let cmd;

    // Write prompt to temp file to avoid CLI arg length/escaping issues
    // Use random suffix to prevent collisions when spawning multiple workers in parallel (quorum)
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const promptFile = resolve(tmpdir(), `pforge-prompt-${suffix}.txt`);
    writeFileSync(promptFile, prompt);

    switch (chosen.name) {
      case "gh-copilot": {
        // Pass prompt file directly via @filepath syntax — avoids PS variable expansion and newline splitting
        cmd = "gh";
        args = ["copilot", "--", "-p", `@${promptFile}`, "--allow-all", "--allow-all-paths", "--allow-all-tools", "--no-ask-user", ...(model ? ["--model", model] : [])];
        break;
      }
      case "claude":
        cmd = "claude";
        args = ["-p", prompt];
        if (model) args.push("--model", model);
        break;
      case "codex":
        cmd = "codex";
        args = ["-p", prompt];
        if (model) args.push("--model", model);
        break;
      default:
        workerReject(new Error(`Unknown worker: ${chosen.name}`));
        return;
    }

    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Close stdin immediately (no interactive input needed)
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);

      // Clean up temp prompt file
      try { unlinkSync(promptFile); } catch { /* ignore */ }

      const jsonlEvents = parseJSONL(stdout);
      let tokens = extractTokens(jsonlEvents);

      // Fallback: parse stderr stats (gh copilot outputs stats to stderr in non-TTY mode)
      if (!tokens.model || tokens.tokens_out === 0) {
        const stderrStats = parseStderrStats(stderr);
        if (stderrStats.model) tokens.model = stderrStats.model;
        if (stderrStats.tokens_out > 0) tokens.tokens_out = stderrStats.tokens_out;
        if (stderrStats.tokens_in > 0) tokens.tokens_in = stderrStats.tokens_in;
        if (stderrStats.premiumRequests > 0) tokens.premiumRequests = stderrStats.premiumRequests;
      }

      workerResolve({
        output: stdout,
        stderr,
        jsonlEvents,
        exitCode: timedOut ? -1 : code,
        timedOut,
        tokens,
        worker: chosen.name,
        model: tokens.model || model || "unknown",
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      workerReject(new Error(`Failed to spawn ${cmd}: ${err.message} (code: ${err.code || "unknown"})`));
    });
  });
}

/**
 * Parse JSONL output from CLI worker.
 */
function parseJSONL(output) {
  const events = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Non-JSON line — skip (text mode fallback)
    }
  }
  return events;
}

/**
 * Extract token usage from JSONL events.
 */
function extractTokens(events) {
  let outputTokens = 0;
  let model = null;
  let premiumRequests = 0;
  let apiDurationMs = 0;
  let sessionDurationMs = 0;
  let codeChanges = null;

  for (const event of events) {
    if (event.type === "session.tools_updated" && event.data?.model) {
      model = event.data.model;
    }
    // Fallback: some CLI versions include model at top level
    if (!model && event.data?.model && typeof event.data.model === "string") {
      model = event.data.model;
    }
    if (event.type === "assistant.message" && event.data?.outputTokens) {
      outputTokens += event.data.outputTokens;
    }
    if (event.type === "result") {
      if (event.usage) {
        premiumRequests = event.usage.premiumRequests || 0;
        apiDurationMs = event.usage.totalApiDurationMs || 0;
        sessionDurationMs = event.usage.sessionDurationMs || 0;
        codeChanges = event.usage.codeChanges || null;
      }
      // result event also has model sometimes
      if (!model && event.model) model = event.model;
    }
  }

  return {
    tokens_out: outputTokens,
    tokens_in: null, // Not directly reported by Copilot CLI
    model,
    premiumRequests,
    apiDurationMs,
    sessionDurationMs,
    codeChanges,
  };
}

/**
 * Parse stats from gh copilot CLI stderr output.
 * Format: "Breakdown by AI model:\n claude-sonnet-4.6  11.7m in, 97.5k out, ..."
 */
function parseStderrStats(stderr) {
  const stats = { model: null, tokens_in: 0, tokens_out: 0, premiumRequests: 0 };
  if (!stderr) return stats;

  // Parse premium requests
  const premiumMatch = stderr.match(/(\d+)\s+Premium request/);
  if (premiumMatch) stats.premiumRequests = parseInt(premiumMatch[1], 10);

  // Parse model breakdown lines: "claude-sonnet-4.6  11.7m in, 97.5k out, ..."
  const modelLines = stderr.match(/^\s+([\w.-]+)\s+([\d.]+[kmb]?)\s+in,\s+([\d.]+[kmb]?)\s+out/gm);
  if (modelLines) {
    let maxTokens = 0;
    for (const line of modelLines) {
      const m = line.match(/^\s+([\w.-]+)\s+([\d.]+[kmb]?)\s+in,\s+([\d.]+[kmb]?)\s+out/);
      if (!m) continue;
      const model = m[1];
      const tokIn = parseTokenCount(m[2]);
      const tokOut = parseTokenCount(m[3]);
      stats.tokens_in += tokIn;
      stats.tokens_out += tokOut;
      // Primary model = the one with most output tokens
      if (tokOut > maxTokens) {
        maxTokens = tokOut;
        stats.model = model;
      }
    }
  }

  return stats;
}

/**
 * Parse token count strings like "97.5k", "11.7m", "1.2b", "843.6k"
 */
function parseTokenCount(str) {
  if (!str) return 0;
  const num = parseFloat(str);
  if (str.endsWith("b")) return Math.round(num * 1_000_000_000);
  if (str.endsWith("m")) return Math.round(num * 1_000_000);
  if (str.endsWith("k")) return Math.round(num * 1_000);
  return Math.round(num);
}

/**
 * Run a validation gate command directly (no AI worker needed).
 * Commands are validated against an allowlist of common build/test tools.
 *
 * @param {string} command - Shell command to run
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, output: string, error: string }}
 */
export function runGate(command, cwd) {
  // C1: Validate gate commands against allowlist to prevent arbitrary execution
  const allowedPrefixes = [
    "npm", "npx", "node", "cargo", "go", "dotnet", "python", "python3",
    "pip", "mvn", "gradle", "make", "cmake", "bash", "sh", "pwsh",
    "powershell", "pytest", "mypy", "ruff", "eslint", "tsc", "vitest",
    "jest", "mocha", "grep", "test", "echo", "exit", "true", "false",
  ];
  const cmdBase = command.trim().split(/\s+/)[0].toLowerCase();
  const isAllowed = allowedPrefixes.some((p) => cmdBase === p || cmdBase.endsWith(`/${p}`));
  if (!isAllowed) {
    return {
      success: false,
      output: "",
      error: `Validation gate blocked: '${cmdBase}' not in allowlist. Allowed: ${allowedPrefixes.join(", ")}`,
    };
  }

  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { success: true, output: output.trim(), error: "" };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || "").trim(),
      error: (err.stderr || err.message || "").trim(),
    };
  }
}

// ─── Schedulers (C2: Pluggable) ───────────────────────────────────────

/**
 * Sequential scheduler — executes slices one at a time in DAG order.
 * Phase 1 implementation.
 */
export class SequentialScheduler {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  /**
   * @param {Map} nodes - DAG nodes
   * @param {string[]} order - Topological order
   * @param {Function} executeFn - async (slice) => result
   * @param {object} options - { abortSignal, resumeFrom }
   */
  async execute(nodes, order, executeFn, options = {}) {
    const { abortSignal, resumeFrom = null } = options;
    const results = [];
    let skipping = resumeFrom !== null;

    for (const id of order) {
      // Check abort
      if (abortSignal?.aborted) {
        this.eventBus.emit("run-aborted", { sliceId: id, reason: "User abort" });
        break;
      }

      const slice = nodes.get(id);

      // Resume support — skip completed slices
      if (skipping) {
        if (id === String(resumeFrom)) {
          skipping = false;
        } else {
          results.push({ sliceId: id, status: "skipped" });
          continue;
        }
      }

      // Skip already-completed slices (marked ✅ in plan)
      if (slice.status === "completed") {
        results.push({ sliceId: id, status: "skipped" });
        continue;
      }

      this.eventBus.emit("slice-started", { sliceId: id, title: slice.title });

      try {
        const result = await executeFn(slice);
        results.push({ sliceId: id, ...result });

        if (result.status === "passed") {
          this.eventBus.emit("slice-completed", { sliceId: id, ...result });
        } else {
          this.eventBus.emit("slice-failed", { sliceId: id, ...result });
          break; // Sequential: stop on first failure
        }
      } catch (err) {
        const failResult = { sliceId: id, status: "error", error: err.message };
        results.push(failResult);
        this.eventBus.emit("slice-failed", failResult);
        break;
      }
    }

    return results;
  }
}

/**
 * Parallel scheduler — Phase 6: executes [P]-tagged slices concurrently.
 * Respects DAG dependencies and merge points.
 * Falls back to sequential for slices without [P] or with scope conflicts.
 */
export class ParallelScheduler {
  constructor(eventBus, maxParallelism = 3) {
    this.eventBus = eventBus;
    this.maxParallelism = maxParallelism;
  }

  /**
   * Execute slices respecting DAG dependencies with parallel [P]-tagged slices.
   * Uses a readiness-based approach: slices become ready when all dependencies complete.
   */
  async execute(nodes, order, executeFn, options = {}) {
    const { abortSignal } = options;
    const results = new Map();
    const completed = new Set();
    const allResults = [];

    // Check for scope conflicts among parallel-eligible slices
    const conflicts = detectScopeConflicts(nodes);

    // Process until all slices are done
    while (completed.size < nodes.size) {
      if (abortSignal?.aborted) {
        this.eventBus.emit("run-aborted", { reason: "User abort" });
        break;
      }

      // Find ready slices: all dependencies completed
      const ready = [];
      for (const id of order) {
        if (completed.has(id)) continue;
        const node = nodes.get(id);
        const depsComplete = (node.depends || []).every((d) => completed.has(d));
        if (!depsComplete) continue;
        // Check if any dependency failed
        const depFailed = (node.depends || []).some((d) => {
          const r = results.get(d);
          return r && (r.status === "failed" || r.status === "error");
        });
        if (depFailed) {
          // Skip slices whose dependencies failed
          const skipResult = { sliceId: id, status: "skipped", reason: "dependency failed" };
          results.set(id, skipResult);
          allResults.push(skipResult);
          completed.add(id);
          continue;
        }
        ready.push(id);
      }

      if (ready.length === 0) break; // No more slices can run

      // Separate parallel-eligible from sequential
      const parallelReady = ready.filter((id) => {
        const node = nodes.get(id);
        return node.parallel && !conflicts.has(id);
      });
      const sequentialReady = ready.filter((id) => !parallelReady.includes(id));

      // Execute parallel batch (up to maxParallelism)
      if (parallelReady.length > 1) {
        const batch = parallelReady.slice(0, this.maxParallelism);
        const promises = batch.map(async (id) => {
          const slice = nodes.get(id);
          this.eventBus.emit("slice-started", { sliceId: id, title: slice.title, parallel: true });
          try {
            const result = await executeFn(slice);
            const r = { sliceId: id, ...result };
            if (result.status === "passed") {
              this.eventBus.emit("slice-completed", { sliceId: id, ...result, parallel: true });
            } else {
              this.eventBus.emit("slice-failed", { sliceId: id, ...result, parallel: true });
            }
            return r;
          } catch (err) {
            const r = { sliceId: id, status: "error", error: err.message };
            this.eventBus.emit("slice-failed", r);
            return r;
          }
        });

        const batchResults = await Promise.all(promises);
        for (const r of batchResults) {
          results.set(r.sliceId, r);
          allResults.push(r);
          completed.add(r.sliceId);
        }
      } else {
        // Execute one at a time (sequential or single parallel)
        const id = sequentialReady[0] || parallelReady[0];
        if (!id) break;

        const slice = nodes.get(id);
        if (slice.status === "completed") {
          const r = { sliceId: id, status: "skipped" };
          results.set(id, r);
          allResults.push(r);
          completed.add(id);
          continue;
        }

        this.eventBus.emit("slice-started", { sliceId: id, title: slice.title });
        try {
          const result = await executeFn(slice);
          const r = { sliceId: id, ...result };
          results.set(id, r);
          allResults.push(r);
          completed.add(id);

          if (result.status === "passed") {
            this.eventBus.emit("slice-completed", { sliceId: id, ...result });
          } else {
            this.eventBus.emit("slice-failed", { sliceId: id, ...result });
            // Don't break — parallel scheduler checks deps, not sequence
          }
        } catch (err) {
          const r = { sliceId: id, status: "error", error: err.message };
          results.set(id, r);
          allResults.push(r);
          completed.add(id);
          this.eventBus.emit("slice-failed", r);
        }
      }
    }

    return allResults;
  }
}

/**
 * Detect scope conflicts among parallel-eligible slices (M6).
 * If two [P] slices have overlapping file scopes, they can't run in parallel.
 * @returns {Set<string>} IDs of slices that have conflicts (forced sequential)
 */
function detectScopeConflicts(nodes) {
  const conflicts = new Set();
  const parallelSlices = [];

  for (const [id, node] of nodes) {
    if (node.parallel) {
      parallelSlices.push({ id, scope: node.scope || [] });
    }
  }

  // Check all pairs for overlapping scopes
  for (let i = 0; i < parallelSlices.length; i++) {
    for (let j = i + 1; j < parallelSlices.length; j++) {
      const a = parallelSlices[i];
      const b = parallelSlices[j];

      // No scope declared = global = conflicts with everything
      if (a.scope.length === 0 || b.scope.length === 0) {
        conflicts.add(a.id);
        conflicts.add(b.id);
        continue;
      }

      // Check for overlap (simple prefix match)
      for (const sa of a.scope) {
        for (const sb of b.scope) {
          const baseA = sa.replace(/\*\*/g, "");
          const baseB = sb.replace(/\*\*/g, "");
          if (baseA.startsWith(baseB) || baseB.startsWith(baseA)) {
            conflicts.add(a.id);
            conflicts.add(b.id);
          }
        }
      }
    }
  }

  return conflicts;
}

// ─── Orchestrator ─────────────────────────────────────────────────────

/**
 * Main orchestrator — coordinates plan execution.
 *
 * @param {string} planPath - Path to hardened plan Markdown
 * @param {object} options
 * @param {string} options.cwd - Project working directory
 * @param {string} options.model - Model override
 * @param {string} options.mode - "auto" | "assisted"
 * @param {number} options.resumeFrom - Slice number to resume from
 * @param {boolean} options.estimate - Estimate only, don't execute
 * @param {boolean} options.dryRun - Parse + validate only
 * @param {object} options.eventHandler - Custom event handler (DI)
 * @param {AbortController} options.abortController
 */
export async function runPlan(planPath, options = {}) {
  const {
    cwd = process.cwd(),
    model = null,
    mode = "auto",
    resumeFrom = null,
    estimate = false,
    dryRun = false,
    eventHandler = null,
    abortController = null,
    quorum = false,        // false | true | "auto"
    quorumThreshold = null, // override threshold from config
  } = options;

  // Load model routing from .forge.json (Slice 5)
  const modelRouting = loadModelRouting(cwd);
  const effectiveModel = model || modelRouting.default || null;

  // Parse plan
  const plan = parsePlan(planPath);

  // Estimation mode — return without executing
  if (estimate) {
    // Build quorum config for estimate even though we're not running
    let estimateQuorumConfig = null;
    if (quorum) {
      estimateQuorumConfig = loadQuorumConfig(cwd);
      estimateQuorumConfig.enabled = true;
      if (quorum === "auto") estimateQuorumConfig.auto = true;
      else if (quorum === true) estimateQuorumConfig.auto = false;
      if (quorumThreshold !== null && typeof quorumThreshold === "number") {
        estimateQuorumConfig.threshold = quorumThreshold;
      }
    }
    return buildEstimate(plan, effectiveModel, cwd, estimateQuorumConfig);
  }

  // Dry run — parse and validate only
  if (dryRun) {
    return { status: "dry-run", plan };
  }

  // Set up event bus with DI handler
  const runDir = createRunDir(cwd, planPath);
  const logHandler = new LogEventHandler(runDir);

  // v2.4: Create trace context and telemetry handler
  const trace = createTraceContext(planPath, { mode, model: effectiveModel, sliceCount: plan.slices.length });
  const telemetryHandler = createTelemetryHandler(trace, runDir);

  // Chain handlers: user-provided → telemetry → log
  const combinedHandler = {
    handle(event) {
      telemetryHandler.handle(event);
      if (eventHandler) eventHandler.handle(event);
      logHandler.handle(event);
    },
  };
  const eventBus = new OrchestratorEventBus(combinedHandler);

  // Write run.json metadata
  const runMeta = {
    plan: planPath,
    traceId: trace.traceId,
    startTime: new Date().toISOString(),
    model: effectiveModel || "auto",
    modelRouting,
    mode,
    sliceCount: plan.slices.length,
    executionOrder: plan.dag.order,
  };
  writeFileSync(resolve(runDir, "run.json"), JSON.stringify(runMeta, null, 2));

  // Select scheduler — use ParallelScheduler if plan has [P] tags
  const hasParallelSlices = plan.slices.some((s) => s.parallel);
  const maxParallelism = loadMaxParallelism(cwd);
  const scheduler = hasParallelSlices
    ? new ParallelScheduler(eventBus, maxParallelism)
    : new SequentialScheduler(eventBus);
  const abortSignal = abortController?.signal || null;

  // OpenBrain memory integration
  const memoryEnabled = isOpenBrainConfigured(cwd);
  const projectName = loadProjectName(cwd);

  // Quorum mode (v2.5)
  let quorumConfig = null;
  if (quorum) {
    quorumConfig = loadQuorumConfig(cwd);
    quorumConfig.enabled = true;
    if (quorum === "auto") {
      quorumConfig.auto = true;
    } else if (quorum === true) {
      quorumConfig.auto = false; // Force quorum on all slices
    }
    if (quorumThreshold !== null && typeof quorumThreshold === "number") {
      quorumConfig.threshold = quorumThreshold;
    }
  }

  eventBus.emit("run-started", { ...runMeta, quorum: quorumConfig ? { enabled: true, auto: quorumConfig.auto, threshold: quorumConfig.threshold } : null });

  // Execute slices
  const maxRetries = loadMaxRetries(cwd);
  const results = await scheduler.execute(
    plan.dag.nodes,
    plan.dag.order,
    async (slice) => executeSlice(slice, {
      cwd, model: effectiveModel, modelRouting, mode, runDir, maxRetries,
      memoryEnabled, projectName, planName: basename(planPath, ".md"),
      quorumConfig,
    }),
    { abortSignal, resumeFrom: resumeFrom ? String(resumeFrom) : null },
  );

  // Auto-sweep + auto-analyze after all slices (Slice 6)
  const allPassed = results.every((r) => r.status === "passed" || r.status === "skipped");
  let sweepResult = null;
  let analyzeResult = null;

  if (allPassed && !estimate && !dryRun) {
    sweepResult = runAutoSweep(cwd);
    analyzeResult = runAutoAnalyze(cwd, planPath);
  }

  // Write summary
  const summary = buildSummary(plan, results, runMeta, { sweepResult, analyzeResult });
  writeFileSync(resolve(runDir, "summary.json"), JSON.stringify(summary, null, 2));

  // Phase 2: Append to cost history
  if (summary.cost && summary.status !== "estimate") {
    appendCostHistory(cwd, summary);
  }

  // Emit run-completed — telemetry handler writes trace.json during this emit
  eventBus.emit("run-completed", summary);

  // v2.4: Write manifest + index + prune (AFTER trace.json is written by emit)
  const runId = basename(runDir);
  const manifest = writeManifest(runDir, runId, { ...summary, traceId: trace.traceId });
  appendRunIndex(cwd, runId, manifest);
  pruneRunHistory(cwd, loadMaxRunHistory(cwd));

  // OpenBrain: capture run summary + cost anomaly as thoughts
  if (memoryEnabled) {
    summary._memoryCapture = {
      runSummary: buildRunSummaryThought(summary, projectName),
      costAnomaly: buildCostAnomalyThought(summary, getCostReport(cwd), projectName),
    };
  }

  return summary;
}

/**
 * Load model routing configuration from .forge.json.
 * Schema: { "modelRouting": { "execute": "gpt-5.2-codex", "review": "claude-sonnet-4.6", "default": "auto" } }
 * Returns the modelRouting object, or defaults if not configured.
 */
function loadModelRouting(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.modelRouting && typeof config.modelRouting === "object") {
        return config.modelRouting;
      }
    }
  } catch {
    // Invalid JSON or missing file — use defaults
  }
  return { default: "auto" };
}

/**
 * Load max parallelism from .forge.json.
 * Schema: { "maxParallelism": 3 }
 * @returns {number}
 */
function loadMaxParallelism(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (typeof config.maxParallelism === "number" && config.maxParallelism > 0) {
        return config.maxParallelism;
      }
    }
  } catch { /* defaults */ }
  return 3; // Default: 3 concurrent workers
}

/**
 * Load max retries from .forge.json.
 * Schema: { "maxRetries": 1 }
 * @returns {number}
 */
function loadMaxRetries(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (typeof config.maxRetries === "number" && config.maxRetries >= 0) {
        return config.maxRetries;
      }
    }
  } catch { /* defaults */ }
  return 1; // Default: 1 retry (2 total attempts)
}

/**
 * Load max run history from .forge.json.
 * @returns {number}
 */
function loadMaxRunHistory(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (typeof config.maxRunHistory === "number" && config.maxRunHistory > 0) return config.maxRunHistory;
    }
  } catch { /* defaults */ }
  return 50;
}

/**
 * Load project name from .forge.json.
 */
function loadProjectName(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.projectName) return config.projectName;
    }
  } catch { /* defaults */ }
  return basename(cwd);
}

/**
 * Resolve which model to use for a given slice based on routing config.
 * Priority: CLI override > slice-type routing > default routing > null (auto)
 */
function resolveModel(cliModel, modelRouting, _slice) {
  if (cliModel && cliModel !== "auto") return cliModel;
  // Future: match slice type (execute/review/test) to routing keys
  if (modelRouting.default && modelRouting.default !== "auto") return modelRouting.default;
  return null; // Let CLI worker pick default
}

// ─── Cost History (Phase 2) ───────────────────────────────────────────

/**
 * Append a run's cost data to .forge/cost-history.json.
 * Each entry captures date, plan, total cost, and per-model breakdown.
 */
function appendCostHistory(cwd, summary) {
  const historyPath = resolve(cwd, ".forge", "cost-history.json");
  let history = [];
  try {
    if (existsSync(historyPath)) {
      history = JSON.parse(readFileSync(historyPath, "utf-8"));
      if (!Array.isArray(history)) history = [];
    }
  } catch {
    history = [];
  }

  const entry = {
    date: summary.endTime || new Date().toISOString(),
    plan: summary.plan,
    sliceCount: summary.sliceCount,
    status: summary.status,
    total_tokens_in: summary.cost?.total_tokens_in || 0,
    total_tokens_out: summary.cost?.total_tokens_out || 0,
    total_cost_usd: summary.cost?.total_cost_usd || 0,
    by_model: summary.cost?.by_model || {},
    duration_ms: summary.totalDuration || 0,
  };

  history.push(entry);

  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

/**
 * Generate a cost report from .forge/cost-history.json.
 * Returns formatted summary with totals, per-model breakdown, and monthly aggregation.
 */
export function getCostReport(cwd) {
  const historyPath = resolve(cwd, ".forge", "cost-history.json");
  if (!existsSync(historyPath)) {
    return { runs: 0, message: "No cost history yet. Run `pforge run-plan` to start tracking." };
  }

  let history;
  try {
    history = JSON.parse(readFileSync(historyPath, "utf-8"));
    if (!Array.isArray(history)) return { runs: 0, message: "Invalid cost history format." };
  } catch {
    return { runs: 0, message: "Could not parse cost-history.json." };
  }

  if (history.length === 0) {
    return { runs: 0, message: "Cost history is empty." };
  }

  // Aggregate totals
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const modelTotals = {};
  const monthly = {};

  for (const entry of history) {
    totalCost += entry.total_cost_usd || 0;
    totalTokensIn += entry.total_tokens_in || 0;
    totalTokensOut += entry.total_tokens_out || 0;

    // Per-model aggregation
    if (entry.by_model) {
      for (const [model, data] of Object.entries(entry.by_model)) {
        if (!modelTotals[model]) modelTotals[model] = { tokens_in: 0, tokens_out: 0, cost_usd: 0, runs: 0 };
        modelTotals[model].tokens_in += data.tokens_in || 0;
        modelTotals[model].tokens_out += data.tokens_out || 0;
        modelTotals[model].cost_usd += data.cost_usd || 0;
        modelTotals[model].runs += 1;
      }
    }

    // Monthly aggregation
    const month = (entry.date || "").substring(0, 7); // YYYY-MM
    if (month) {
      if (!monthly[month]) monthly[month] = { runs: 0, cost_usd: 0 };
      monthly[month].runs += 1;
      monthly[month].cost_usd += entry.total_cost_usd || 0;
    }
  }

  // Round model totals
  for (const m of Object.values(modelTotals)) {
    m.cost_usd = Math.round(m.cost_usd * 100) / 100;
  }
  for (const m of Object.values(monthly)) {
    m.cost_usd = Math.round(m.cost_usd * 100) / 100;
  }

  return {
    runs: history.length,
    total_cost_usd: Math.round(totalCost * 100) / 100,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    by_model: modelTotals,
    monthly,
    latest: history[history.length - 1],
  };
}

/**
 * Execute a single slice — spawn worker + run validation gates.
 * Supports automatic retry: if gate fails, re-invokes worker with error context.
 */
async function executeSlice(slice, options) {
  const { cwd, model, modelRouting = {}, mode, runDir, maxRetries = 1,
    memoryEnabled = false, projectName = "", planName = "",
    quorumConfig = null } = options;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model, modelRouting, slice);

  // ─── Quorum Mode (v2.5) ───
  let quorumResult = null;
  let useQuorum = false;
  let complexityScore = 0;

  if (quorumConfig && quorumConfig.enabled && mode !== "assisted") {
    const { score, signals } = scoreSliceComplexity(slice, cwd);
    complexityScore = score;

    // Determine if this slice qualifies for quorum
    if (quorumConfig.auto) {
      useQuorum = score >= quorumConfig.threshold;
    } else {
      useQuorum = true; // Force quorum on all slices
    }

    if (useQuorum) {
      // Dispatch to multiple models for dry-run analysis
      const dispatchResult = await quorumDispatch(slice, quorumConfig, {
        cwd,
        memoryEnabled,
        projectName,
        complexityScore: score,
      });

      // Synthesize responses
      quorumResult = await quorumReview(dispatchResult, slice, quorumConfig, { cwd });

      // Log quorum data
      const quorumLog = {
        score,
        signals,
        threshold: quorumConfig.threshold,
        models: quorumConfig.models,
        successfulLegs: dispatchResult.successful.length,
        totalLegs: dispatchResult.all.length,
        dispatchDuration: dispatchResult.totalDuration,
        reviewerFallback: quorumResult.fallback,
        reviewerCost: quorumResult.reviewerCost,
      };
      writeFileSync(
        resolve(runDir, `slice-${slice.number}-quorum.json`),
        JSON.stringify(quorumLog, null, 2),
      );
    }
  }

  let attempt = 0;
  let workerResult = null;
  let gateResult = { success: true, output: "No validation gate defined" };
  let lastError = null;

  while (attempt <= maxRetries) {
    // Build prompt — on retry, include the error context
    let sliceInstructions = (useQuorum && quorumResult)
      ? quorumResult.enhancedPrompt
      : buildSlicePrompt(slice);

    // OpenBrain: inject memory search + capture instructions
    if (memoryEnabled) {
      sliceInstructions = buildMemorySearchBlock(projectName, slice) + "\n" + sliceInstructions;
      sliceInstructions += "\n" + buildMemoryCaptureBlock(projectName, slice, planName);
    }
    if (attempt > 0 && lastError) {
      sliceInstructions += `\n\n--- RETRY (attempt ${attempt + 1}) ---\n` +
        `Previous attempt failed with this error:\n${lastError}\n` +
        `Fix the error and ensure the build/test gates pass.`;
    }

    if (mode === "assisted") {
      workerResult = {
        output: "Assisted mode — human executes in VS Code",
        tokens: { tokens_in: null, tokens_out: null, model: "human" },
        exitCode: 0,
        worker: "human",
        model: "human",
      };
    } else {
      try {
        workerResult = await spawnWorker(sliceInstructions, { model: resolvedModel, cwd });
      } catch (err) {
        return {
          status: "failed",
          duration: Date.now() - startTime,
          error: err.message,
          attempts: attempt + 1,
        };
      }
    }

    // Capture session log (C4) — append on retry
    const logFile = resolve(runDir, `slice-${slice.number}-log.txt`);
    const logContent = [
      attempt > 0 ? `\n=== RETRY ATTEMPT ${attempt + 1} ===` : "",
      `=== Slice ${slice.number}: ${slice.title} ===`,
      `Worker: ${workerResult.worker}`,
      `Model: ${workerResult.model}`,
      `Started: ${new Date(startTime).toISOString()}`,
      "",
      "=== STDOUT ===",
      workerResult.output || "(empty)",
      "",
      "=== STDERR ===",
      workerResult.stderr || "(empty)",
    ].join("\n");
    writeFileSync(logFile, logContent, attempt > 0 ? { flag: "a" } : undefined);

    // Run validation gate if defined
    gateResult = { success: true, output: "No validation gate defined" };
    if (slice.validationGate) {
      const gateLines = slice.validationGate
        .split("\n")
        .map((l) => l.replace(/\s{2,}#\s.*$/, "").trim())
        .filter((l) => l.length > 0);

      for (const gateLine of gateLines) {
        gateResult = runGate(gateLine, cwd);
        if (!gateResult.success) {
          gateResult.failedCommand = gateLine;
          break;
        }
      }
    }

    // If gate passed AND worker didn't timeout/fail, we're done
    if (gateResult.success && workerResult.exitCode === 0) break;

    // Worker timed out — retry with timeout context
    if (workerResult.timedOut) {
      lastError = `Worker timed out after ${Math.round((Date.now() - startTime) / 1000)}s. The task may be too complex for a single slice — consider splitting it.`;
      attempt++;
      if (attempt <= maxRetries) {
        writeFileSync(logFile, `\n\n--- WORKER TIMED OUT, RETRYING (attempt ${attempt + 1}) ---\n${lastError}\n`, { flag: "a" });
      }
      continue;
    }

    // Worker failed with non-zero exit (not timeout) — no point retrying
    if (workerResult.exitCode !== 0) break;

    // Gate failed — set error for retry prompt
    lastError = `Gate command '${gateResult.failedCommand || "unknown"}' failed:\n${gateResult.error || gateResult.output}`;
    attempt++;

    if (attempt <= maxRetries) {
      // Log the retry
      writeFileSync(logFile, `\n\n--- GATE FAILED, RETRYING (attempt ${attempt + 1}) ---\n${lastError}\n`, { flag: "a" });
    }
  }

  const duration = Date.now() - startTime;
  // Status: gate is the authority. Worker exit code may be non-zero from shell wrappers
  // even when the work succeeded. If gates pass, the slice passed.
  const status = gateResult.success ? "passed" : "failed";

  const sliceResult = {
    number: slice.number,
    title: slice.title,
    status,
    duration,
    exitCode: workerResult.exitCode,
    gateStatus: gateResult.success ? "passed" : "failed",
    gateOutput: gateResult.output,
    gateError: gateResult.error || null,
    failedCommand: gateResult.failedCommand || null,
    tokens: workerResult.tokens || { tokens_in: null, tokens_out: null, model: "unknown" },
    worker: workerResult.worker,
    model: workerResult.model,
    attempts: attempt + 1,
    ...(useQuorum && {
      quorum: {
        score: complexityScore,
        models: quorumResult?.modelResponses?.map((r) => r.model) || [],
        reviewerFallback: quorumResult?.fallback || false,
        reviewerCost: quorumResult?.reviewerCost || 0,
        dryRunTokens: quorumResult?.modelResponses?.reduce((sum, r) => ({
          tokens_in: (sum.tokens_in || 0) + (r.tokens?.tokens_in || 0),
          tokens_out: (sum.tokens_out || 0) + (r.tokens?.tokens_out || 0),
        }), { tokens_in: 0, tokens_out: 0 }) || { tokens_in: 0, tokens_out: 0 },
      },
    }),
  };

  writeFileSync(
    resolve(runDir, `slice-${slice.number}.json`),
    JSON.stringify(sliceResult, null, 2),
  );

  return sliceResult;
}

function buildSlicePrompt(slice) {
  const parts = [
    `Execute Slice ${slice.number}: ${slice.title}`,
    "",
    "Tasks:",
  ];
  for (const task of slice.tasks) {
    parts.push(`- ${task}`);
  }
  // Scope isolation: tell worker which files to modify
  if (slice.scope && slice.scope.length > 0) {
    parts.push("", `SCOPE: Only modify files matching: ${slice.scope.join(", ")}`);
    parts.push("Do NOT create or modify files outside this scope.");
  }
  if (slice.buildCommand) {
    parts.push("", `Build command: ${slice.buildCommand}`);
  }
  if (slice.testCommand) {
    parts.push(`Test command: ${slice.testCommand}`);
  }
  if (slice.validationGate) {
    parts.push("", "Validation gate (run these after completion):", slice.validationGate);
  }
  if (slice.stopCondition) {
    parts.push("", `Stop condition: ${slice.stopCondition}`);
  }
  return parts.join("\n");
}

// ─── Quorum Mode (Phase 7 — v2.5) ────────────────────────────────────

/**
 * Security-sensitive keywords that increase complexity score.
 * @type {RegExp}
 */
const SECURITY_KEYWORDS = /\b(auth|token|rbac|encryption|secret|cors|jwt|oauth|password|credential|permission|role)\b/i;

/**
 * Database/migration keywords that increase complexity score.
 * @type {RegExp}
 */
const DATABASE_KEYWORDS = /\b(migration|schema|alter|create\s+table|drop|seed|index|foreign\s+key|constraint|ef\s+core|dbcontext|repository)\b/i;

/**
 * Load quorum configuration from .forge.json.
 * Schema: { "quorum": { "enabled": false, "auto": true, "threshold": 7, "models": [...], "reviewerModel": "...", "dryRunTimeout": 300000 } }
 * Returns merged config with defaults.
 */
export function loadQuorumConfig(cwd) {
  const defaults = {
    enabled: false,
    auto: true,
    threshold: 7,
    models: ["claude-opus-4.6", "gpt-5.3-codex", "claude-sonnet-4.6"],
    reviewerModel: "claude-opus-4.6",
    dryRunTimeout: 300_000, // 5 min per dry-run leg
  };
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.quorum && typeof config.quorum === "object") {
        return { ...defaults, ...config.quorum };
      }
    }
  } catch { /* defaults */ }
  return defaults;
}

/**
 * Score a slice's technical complexity on a 1-10 scale.
 *
 * Weighted signals:
 *   - File count in scope (20%)
 *   - Cross-module dependencies (20%)
 *   - Security-sensitive keywords (15%)
 *   - Database/migration keywords (15%)
 *   - Acceptance criteria / gate length (10%)
 *   - Task count (10%)
 *   - Historical failure rate (10%)
 *
 * @param {object} slice - Parsed slice from plan
 * @param {string} cwd - Working directory (for historical data)
 * @returns {{ score: number, signals: object }}
 */
export function scoreSliceComplexity(slice, cwd) {
  const signals = {};

  // 1. File count in scope (0-1 normalized: 0 files=0, 5+=1)
  const scopeCount = (slice.scope && slice.scope.length) || 0;
  signals.scopeWeight = Math.min(scopeCount / 5, 1);

  // 2. Cross-module dependencies (0-1: 0 deps=0, 4+=1)
  const depCount = (slice.depends && slice.depends.length) || 0;
  signals.dependencyWeight = Math.min(depCount / 4, 1);

  // 3. Security-sensitive keywords in tasks + title
  const allText = [slice.title || "", ...(slice.tasks || []), slice.validationGate || ""].join(" ");
  const securityHits = (allText.match(SECURITY_KEYWORDS) || []).length;
  signals.securityWeight = Math.min(securityHits / 3, 1);

  // 4. Database/migration keywords
  const dbHits = (allText.match(DATABASE_KEYWORDS) || []).length;
  signals.databaseWeight = Math.min(dbHits / 3, 1);

  // 5. Validation gate length (lines of gate commands)
  const gateLines = slice.validationGate
    ? slice.validationGate.split("\n").filter((l) => l.trim().length > 0).length
    : 0;
  signals.gateWeight = Math.min(gateLines / 5, 1);

  // 6. Task count (0-1: 1 task=0.1, 10+=1)
  const taskCount = (slice.tasks && slice.tasks.length) || 0;
  signals.taskWeight = Math.min(taskCount / 10, 1);

  // 7. Historical failure rate (0-1: scan past runs for similar slice titles)
  signals.historicalWeight = getHistoricalFailureRate(slice, cwd);

  // Weighted sum
  const raw =
    signals.scopeWeight * 0.20 +
    signals.dependencyWeight * 0.20 +
    signals.securityWeight * 0.15 +
    signals.databaseWeight * 0.15 +
    signals.gateWeight * 0.10 +
    signals.taskWeight * 0.10 +
    signals.historicalWeight * 0.10;

  // Normalize to 1-10 scale (raw is 0-1)
  const score = Math.max(1, Math.min(10, Math.round(raw * 9) + 1));

  return { score, signals };
}

/**
 * Scan historical runs for failure rate of slices with similar titles/keywords.
 * Returns 0-1 (0 = no history or never failed, 1 = always fails).
 */
function getHistoricalFailureRate(slice, cwd) {
  const runsDir = resolve(cwd, ".forge", "runs");
  if (!existsSync(runsDir)) return 0;

  const titleWords = (slice.title || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (titleWords.length === 0) return 0;

  let matches = 0;
  let failures = 0;

  try {
    const indexPath = resolve(runsDir, "index.jsonl");
    if (!existsSync(indexPath)) return 0;

    const lines = readFileSync(indexPath, "utf-8").split("\n").filter((l) => l.trim());
    // Sample last 20 runs max
    const recent = lines.slice(-20);

    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        const runDir = resolve(runsDir, entry.runDir || entry.runId || "");
        const summaryPath = resolve(runDir, "summary.json");
        if (!existsSync(summaryPath)) continue;

        const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
        if (!summary.slices) continue;

        for (const s of summary.slices) {
          const sTitle = (s.title || "").toLowerCase();
          const isMatch = titleWords.some((w) => sTitle.includes(w));
          if (isMatch) {
            matches++;
            if (s.status === "failed") failures++;
          }
        }
      } catch { /* skip malformed entries */ }
    }
  } catch { /* no history */ }

  return matches > 0 ? failures / matches : 0;
}

/**
 * Build the dry-run prompt for quorum dispatch.
 * Wraps the original slice prompt with dry-run instructions.
 */
function buildDryRunPrompt(slice) {
  const originalPrompt = buildSlicePrompt(slice);
  return [
    "You are in QUORUM DRY-RUN mode. Do NOT execute any code changes.",
    "Do NOT create, modify, or delete any files.",
    "",
    "Instead, produce a detailed implementation plan for the slice below:",
    "",
    "1. **Files to create or modify** — exact paths, one per line",
    "2. **Implementation approach** — for each file, describe the key changes (classes, methods, patterns)",
    "3. **Edge cases and failure modes** — what could go wrong, how to handle it",
    "4. **Testing strategy** — how to verify the validation gate passes",
    "5. **Risk assessment** — rate confidence (high/medium/low) and explain concerns",
    "",
    "--- ORIGINAL SLICE INSTRUCTIONS ---",
    originalPrompt,
  ].join("\n");
}

/**
 * Build the reviewer synthesis prompt from dry-run responses.
 */
function buildReviewerPrompt(dryRunResults, slice) {
  const originalPrompt = buildSlicePrompt(slice);
  const parts = [
    "You are the QUORUM REVIEWER. Three AI models independently analyzed the same coding task",
    "and produced implementation plans. Your job is to synthesize the BEST execution plan.",
    "",
    "Rules:",
    "- Pick the BEST approach for each file/component (not necessarily from the same model)",
    "- When models DISAGREE on architecture, choose the approach with better error handling and testability",
    "- Flag any RISK AREAS where all three models expressed concerns",
    "- Produce a CONCRETE execution plan (not vague guidance) — the output will be used as instructions for the executing agent",
    "- Include specific file paths, class names, method signatures, and patterns to use",
    "",
  ];

  for (let i = 0; i < dryRunResults.length; i++) {
    const r = dryRunResults[i];
    parts.push(`--- MODEL ${String.fromCharCode(65 + i)} (${r.model}) ---`);
    parts.push(r.output || "(no response)");
    parts.push("");
  }

  parts.push("--- ORIGINAL SLICE ---");
  parts.push(originalPrompt);
  parts.push("");
  parts.push("Produce the unified execution plan now.");

  return parts.join("\n");
}

/**
 * Dispatch a slice to multiple models for parallel dry-run analysis.
 * Returns array of dry-run results.
 *
 * @param {object} slice - Parsed slice
 * @param {object} config - Quorum config from loadQuorumConfig()
 * @param {object} options - { cwd, eventBus, memoryEnabled, projectName }
 * @returns {Promise<{ model: string, output: string, tokens: object, duration: number, exitCode: number }[]>}
 */
export async function quorumDispatch(slice, config, options = {}) {
  const { cwd = process.cwd(), eventBus = null, memoryEnabled = false, projectName = "" } = options;

  let dryPrompt = buildDryRunPrompt(slice);

  // OpenBrain: inject memory search for dry-run agents too
  if (memoryEnabled) {
    dryPrompt = buildMemorySearchBlock(projectName, slice) + "\n" + dryPrompt;
  }

  if (eventBus) {
    eventBus.emit("quorum-dispatch-started", {
      sliceId: slice.number,
      models: config.models,
      score: options.complexityScore || null,
    });
  }

  const startTime = Date.now();
  const promises = config.models.map(async (model) => {
    const legStart = Date.now();
    try {
      const result = await spawnWorker(dryPrompt, {
        model,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
      });
      const legResult = {
        model,
        output: result.output || result.stderr || "",
        tokens: result.tokens,
        duration: Date.now() - legStart,
        exitCode: result.exitCode,
        success: true, // gh copilot may exit non-zero but still produce useful output
      };
      // Determine success: has meaningful output (stdout or stderr) regardless of exit code
      // gh copilot outputs text to stderr in non-TTY mode
      legResult.success = (legResult.output || "").trim().length > 50;
      if (eventBus) {
        eventBus.emit("quorum-leg-completed", { sliceId: slice.number, ...legResult });
      }
      return legResult;
    } catch (err) {
      const legResult = {
        model,
        output: "",
        tokens: { tokens_in: null, tokens_out: null, model },
        duration: Date.now() - legStart,
        exitCode: 1,
        success: false,
        error: err.message,
      };
      if (eventBus) {
        eventBus.emit("quorum-leg-completed", { sliceId: slice.number, ...legResult });
      }
      return legResult;
    }
  });

  const results = await Promise.all(promises);

  // Filter to successful responses
  const successful = results.filter((r) => r.success && (r.output || "").trim().length > 0);

  return { all: results, successful, totalDuration: Date.now() - startTime };
}

/**
 * Synthesize multiple dry-run responses into a unified execution plan.
 * Spawns a reviewer agent to merge the best elements.
 *
 * @param {{ successful: object[] }} dispatchResult - Output from quorumDispatch()
 * @param {object} slice - Original slice
 * @param {object} config - Quorum config
 * @param {object} options - { cwd, eventBus }
 * @returns {Promise<{ enhancedPrompt: string, reviewerTokens: object, reviewerCost: number, modelResponses: object[] }>}
 */
export async function quorumReview(dispatchResult, slice, config, options = {}) {
  const { cwd = process.cwd(), eventBus = null } = options;
  const { successful } = dispatchResult;

  // Need at least 2 responses for meaningful consensus
  if (successful.length < 2) {
    // Fall back: use the single best response or original prompt
    const fallback = successful.length === 1
      ? `Based on analysis, here is the recommended approach:\n\n${successful[0].output}\n\n--- EXECUTE ---\n${buildSlicePrompt(slice)}`
      : buildSlicePrompt(slice);

    return {
      enhancedPrompt: fallback,
      reviewerTokens: { tokens_in: 0, tokens_out: 0, model: "none" },
      reviewerCost: 0,
      modelResponses: successful,
      fallback: true,
    };
  }

  const reviewerPrompt = buildReviewerPrompt(successful, slice);

  try {
    const reviewerResult = await spawnWorker(reviewerPrompt, {
      model: config.reviewerModel,
      cwd,
      timeout: config.dryRunTimeout || 300_000,
    });

    const enhancedPrompt = [
      `Execute Slice ${slice.number}: ${slice.title}`,
      "",
      "The following execution plan was synthesized from multi-model consensus analysis.",
      "Follow this plan precisely:",
      "",
      reviewerResult.output,
      "",
      "--- ORIGINAL REQUIREMENTS ---",
      // Include scope and gate from original so they're not lost
      ...(slice.scope && slice.scope.length > 0
        ? [`SCOPE: Only modify files matching: ${slice.scope.join(", ")}`, "Do NOT create or modify files outside this scope.", ""]
        : []),
      ...(slice.validationGate
        ? ["Validation gate (run these after completion):", slice.validationGate, ""]
        : []),
    ].join("\n");

    if (eventBus) {
      eventBus.emit("quorum-review-completed", {
        sliceId: slice.number,
        reviewerModel: config.reviewerModel,
        tokens: reviewerResult.tokens,
        modelCount: successful.length,
      });
    }

    return {
      enhancedPrompt,
      reviewerTokens: reviewerResult.tokens,
      reviewerCost: calculateSliceCost(reviewerResult.tokens).cost_usd,
      modelResponses: successful,
      fallback: false,
    };
  } catch (err) {
    // Reviewer failed — fall back to best single dry-run
    const best = successful.reduce((a, b) =>
      (a.output || "").length > (b.output || "").length ? a : b);

    return {
      enhancedPrompt: `Based on analysis by ${best.model}, here is the recommended approach:\n\n${best.output || ""}\n\n--- EXECUTE ---\n${buildSlicePrompt(slice)}`,
      reviewerTokens: { tokens_in: 0, tokens_out: 0, model: "none" },
      reviewerCost: 0,
      modelResponses: successful,
      fallback: true,
      error: err.message,
    };
  }
}

// ─── Quorum Analysis ─────────────────────────────────────────────────

/**
 * Multi-model analysis of a plan or file.
 * Dispatches independent analysis to N models, then synthesizes findings.
 *
 * Modes:
 *   - plan: Analyze a hardened plan for consistency, coverage gaps, risk
 *   - file: Analyze source file(s) for bugs, patterns, improvements
 *
 * @param {object} options - { target, mode, models, cwd }
 * @returns {Promise<{ results, synthesis, cost }>}
 */
export async function analyzeWithQuorum(options = {}) {
  const {
    target,
    mode = "plan",   // "plan" | "file" | "diagnose"
    models = null,
    cwd = process.cwd(),
  } = options;

  const config = loadQuorumConfig(cwd);
  const analyzeModels = models || config.models;

  // Build analysis prompt based on mode
  let content;
  try {
    content = readFileSync(resolve(cwd, target), "utf-8");
  } catch (err) {
    throw new Error(`Cannot read analysis target: ${target} — ${err.message}`);
  }

  const prompt = mode === "plan"
    ? buildPlanAnalysisPrompt(content, target)
    : mode === "diagnose"
      ? buildDiagnosePrompt(content, target)
      : buildFileAnalysisPrompt(content, target);

  console.log(`\n🗳️  Quorum Analysis — dispatching to ${analyzeModels.length} models...`);
  console.log(`   Target: ${target} (${mode} mode)`);
  console.log(`   Models: ${analyzeModels.join(", ")}\n`);

  // Dispatch to all models in parallel
  const startTime = Date.now();
  const promises = analyzeModels.map(async (model) => {
    const legStart = Date.now();
    console.log(`   ⏳ ${model} — analyzing...`);
    try {
      const result = await spawnWorker(prompt, {
        model,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
      });
      const duration = Date.now() - legStart;
      console.log(`   ✅ ${model} — done (${Math.round(duration / 1000)}s)`);
      return {
        model,
        output: result.output || "",
        tokens: result.tokens,
        duration,
        success: (result.output || "").trim().length > 50,
        worker: result.worker,
      };
    } catch (err) {
      const duration = Date.now() - legStart;
      console.log(`   ❌ ${model} — failed: ${err.message}`);
      return {
        model,
        output: "",
        tokens: { tokens_in: 0, tokens_out: 0, model },
        duration,
        success: false,
        error: err.message,
        worker: "failed",
      };
    }
  });

  const results = await Promise.all(promises);
  const successful = results.filter((r) => r.success);
  const totalDuration = Date.now() - startTime;

  console.log(`\n   📊 ${successful.length}/${results.length} models returned results (${Math.round(totalDuration / 1000)}s total)`);

  // Synthesize findings if we have 2+ responses
  let synthesis = null;
  let synthesisCost = 0;
  if (successful.length >= 2) {
    console.log(`   🔄 Synthesizing with ${config.reviewerModel}...`);
    const synthPrompt = buildAnalysisSynthesisPrompt(successful, target, mode);
    try {
      const synthResult = await spawnWorker(synthPrompt, {
        model: config.reviewerModel,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
      });
      synthesis = synthResult.output || "";
      synthesisCost = calculateSliceCost(synthResult.tokens).cost_usd;
      console.log(`   ✅ Synthesis complete`);
    } catch (err) {
      console.log(`   ⚠️  Synthesis failed: ${err.message} — returning raw results`);
    }
  } else if (successful.length === 1) {
    synthesis = successful[0].output;
  }

  // Calculate total cost
  let totalCost = synthesisCost;
  for (const r of results) {
    totalCost += calculateSliceCost(r.tokens).cost_usd;
  }

  return {
    target,
    mode,
    models: analyzeModels,
    results: results.map((r) => ({
      model: r.model,
      output: r.output,
      duration: r.duration,
      success: r.success,
      worker: r.worker,
      cost: calculateSliceCost(r.tokens).cost_usd,
      error: r.error,
    })),
    synthesis,
    totalDuration,
    totalCost: Math.round(totalCost * 100) / 100,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build analysis prompt for a hardened plan file.
 */
function buildPlanAnalysisPrompt(content, filename) {
  return [
    "You are a senior software architect performing an independent code review of a hardened execution plan.",
    "Analyze the following plan and report on:",
    "",
    "1. **Consistency**: Are slice dependencies correct? Do scopes overlap or conflict?",
    "2. **Coverage Gaps**: Are there untested edge cases, missing error handlers, or validation gaps?",
    "3. **Risk Assessment**: Which slices have the highest failure risk and why?",
    "4. **Naming & Style**: Are naming conventions consistent across slices?",
    "5. **Security**: Any security concerns in the planned implementation?",
    "6. **Improvement Suggestions**: Concrete, actionable improvements.",
    "",
    "Format your response as structured Markdown with clear headings for each category.",
    "Rate each category as: ✅ Good | ⚠️ Needs Attention | ❌ Critical Issue",
    "End with an overall confidence score (1-10) for plan readiness.",
    "",
    `--- PLAN: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build analysis prompt for source file(s).
 */
function buildFileAnalysisPrompt(content, filename) {
  return [
    "You are a senior software engineer performing an independent code review.",
    "Analyze the following file and report on:",
    "",
    "1. **Bugs**: Logic errors, null reference risks, race conditions, off-by-one errors",
    "2. **Security**: Input validation gaps, injection risks, auth issues, secret exposure",
    "3. **Performance**: Hot paths, unnecessary allocations, N+1 queries, missing caching",
    "4. **Architecture**: Separation of concerns, testability, coupling issues",
    "5. **Error Handling**: Missing error handlers, swallowed exceptions, incomplete recovery",
    "6. **Improvements**: Concrete, actionable fixes with code snippets where helpful",
    "",
    "Format your response as structured Markdown with clear headings.",
    "Rate each category as: ✅ Good | ⚠️ Needs Attention | ❌ Critical Issue",
    "End with an overall code quality score (1-10).",
    "",
    `--- FILE: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build diagnosis prompt for bug investigation.
 * Focused on root cause analysis, failure modes, and fix recommendations.
 */
function buildDiagnosePrompt(content, filename) {
  return [
    "You are a senior software engineer performing a focused bug investigation.",
    "The user suspects there may be bugs or reliability issues in this file.",
    "Investigate thoroughly and report on:",
    "",
    "1. **Root Cause Analysis**: What bugs exist? Trace the exact code path for each.",
    "2. **Failure Modes**: How will each bug manifest at runtime? Under what conditions?",
    "3. **Reproduction Steps**: How would you trigger each bug? What inputs or state?",
    "4. **Impact Assessment**: Severity (crash/data loss/wrong result/cosmetic) and blast radius",
    "5. **Fix Recommendations**: Exact code changes needed. Show before/after snippets.",
    "6. **Regression Risk**: Could the fixes break other functionality? What tests should be added?",
    "",
    "Be thorough — examine every code path, every edge case, every null/undefined risk.",
    "Check for: race conditions, boundary values, error propagation, resource leaks,",
    "unhandled promise rejections, type coercion bugs, off-by-one errors, stale closures.",
    "",
    "Format your response as structured Markdown with clear headings.",
    "Rate overall reliability as: ✅ Solid | ⚠️ Has Issues | ❌ Unreliable",
    "End with a prioritized fix list (fix most critical bugs first).",
    "",
    `--- FILE UNDER INVESTIGATION: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build synthesis prompt from multiple model analysis results.
 */
function buildAnalysisSynthesisPrompt(successful, target, mode) {
  const type = mode === "plan" ? "plan analysis" : mode === "diagnose" ? "bug investigation" : "code review";
  let prompt = [
    `You are a senior technical reviewer synthesizing ${type} results from ${successful.length} independent AI models.`,
    `Each model independently analyzed: ${target}`,
    "",
    "Your job is to:",
    "1. Identify findings that MULTIPLE models agree on (high confidence)",
    "2. Flag unique findings from single models that seem valid (medium confidence)",
    "3. Resolve any contradictions between models",
    "4. Produce a unified, prioritized report",
    "",
    "Format: Structured Markdown with priority levels (🔴 Critical, 🟡 Important, 🟢 Minor).",
    "Include a confidence indicator for each finding: [Consensus: N/M models agree]",
    "End with an overall assessment and top 3 action items.",
    "",
  ].join("\n");

  for (const r of successful) {
    prompt += `\n--- ANALYSIS BY ${r.model} ---\n${r.output}\n`;
  }

  return prompt;
}

// ─── Pricing Table (Phase 2) ──────────────────────────────────────────
// Per-token costs in USD. Updated April 2026.
// Source: published API pricing pages. Rates are per 1 token.
const MODEL_PRICING = {
  // Anthropic Claude
  "claude-opus-4.6":        { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-opus-4.6-fast":   { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-opus-4.5":        { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-sonnet-4.6":      { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-sonnet-4.5":      { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-sonnet-4":        { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-haiku-4.5":       { input: 0.8 / 1_000_000,  output: 4 / 1_000_000 },
  // OpenAI GPT
  "gpt-5.4":                { input: 5 / 1_000_000,    output: 15 / 1_000_000 },
  "gpt-5.3-codex":          { input: 3 / 1_000_000,    output: 12 / 1_000_000 },
  "gpt-5.2-codex":          { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.2":                { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.1-codex-max":      { input: 3 / 1_000_000,    output: 12 / 1_000_000 },
  "gpt-5.1-codex":          { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.1":                { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.1-codex-mini":     { input: 0.3 / 1_000_000,  output: 1.2 / 1_000_000 },
  "gpt-5-mini":             { input: 0.4 / 1_000_000,  output: 1.6 / 1_000_000 },
  "gpt-4.1":                { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  // Google Gemini
  "gemini-3-pro-preview":   { input: 1.25 / 1_000_000, output: 5 / 1_000_000 },
  // xAI Grok (reasoning_tokens billed as output)
  "grok-4.20":              { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "grok-4":                 { input: 2 / 1_000_000,    output: 10 / 1_000_000 },
  "grok-4-0709":            { input: 2 / 1_000_000,    output: 10 / 1_000_000 },
  "grok-3":                 { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "grok-3-mini":            { input: 0.30 / 1_000_000, output: 0.50 / 1_000_000 },
  // Fallback
  default:                  { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
};

/**
 * Calculate cost for a single slice from its token data.
 *
 * CLI workers (gh-copilot, claude) are subscription-based — cost is estimated
 * from premium request counts, not token-based API pricing.
 * API workers use per-token MODEL_PRICING.
 *
 * @param {{ tokens_in: number|null, tokens_out: number|null, model: string, premiumRequests?: number }} tokens
 * @param {string} [worker] - Worker type: "gh-copilot", "claude", "codex", "api-xai", etc.
 * @returns {{ cost_usd: number, model: string, tokens_in: number, tokens_out: number }}
 */
export function calculateSliceCost(tokens, worker) {
  const model = tokens?.model || "unknown";
  const tokensIn = typeof tokens?.tokens_in === "number" ? tokens.tokens_in : 0;
  const tokensOut = typeof tokens?.tokens_out === "number" ? tokens.tokens_out : 0;

  let cost;
  // CLI subscription workers: cost based on premium requests, not API token pricing
  if (worker && !worker.startsWith("api-")) {
    const premiumRequests = tokens?.premiumRequests || 0;
    // GitHub Copilot premium request rate — approximate per-request cost
    const PREMIUM_REQUEST_RATE = 0.01; // ~$0.01 per premium request
    cost = premiumRequests * PREMIUM_REQUEST_RATE;
  } else {
    // API workers: use per-token pricing
    const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
    cost = (tokensIn * pricing.input) + (tokensOut * pricing.output);
  }

  return {
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000, // 6 decimal places
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
  };
}

/**
 * Build cost breakdown from all slice results.
 * @param {Array} sliceResults
 * @returns {{ total_cost_usd, by_model, by_slice }}
 */
export function buildCostBreakdown(sliceResults) {
  const byModel = {};
  const bySlice = [];
  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const sr of sliceResults) {
    if (!sr.tokens || sr.status === "skipped") continue;
    const cost = calculateSliceCost(sr.tokens, sr.worker);
    totalCost += cost.cost_usd;
    totalIn += cost.tokens_in;
    totalOut += cost.tokens_out;

    bySlice.push({
      slice: sr.number || sr.sliceId,
      ...cost,
    });

    if (!byModel[cost.model]) {
      byModel[cost.model] = { tokens_in: 0, tokens_out: 0, cost_usd: 0, slices: 0 };
    }
    byModel[cost.model].tokens_in += cost.tokens_in;
    byModel[cost.model].tokens_out += cost.tokens_out;
    byModel[cost.model].cost_usd += cost.cost_usd;
    byModel[cost.model].slices += 1;
  }

  // Round model totals
  for (const m of Object.values(byModel)) {
    m.cost_usd = Math.round(m.cost_usd * 1_000_000) / 1_000_000;
  }

  return {
    total_cost_usd: Math.round(totalCost * 100) / 100,
    total_tokens_in: totalIn,
    total_tokens_out: totalOut,
    by_model: byModel,
    by_slice: bySlice,
  };
}

function buildEstimate(plan, model, cwd, quorumConfig = null) {
  // Phase 2 Slice 4: Use historical data if available
  const historyPath = cwd ? resolve(cwd, ".forge", "cost-history.json") : null;
  let avgTokensPerSlice = null;

  try {
    if (historyPath && existsSync(historyPath)) {
      const history = JSON.parse(readFileSync(historyPath, "utf-8"));
      if (Array.isArray(history) && history.length > 0) {
        const totalIn = history.reduce((s, e) => s + (e.total_tokens_in || 0), 0);
        const totalOut = history.reduce((s, e) => s + (e.total_tokens_out || 0), 0);
        const totalSlices = history.reduce((s, e) => s + (e.sliceCount || 1), 0);
        if (totalSlices > 0) {
          avgTokensPerSlice = {
            input: Math.round(totalIn / totalSlices),
            output: Math.round(totalOut / totalSlices),
            source: `${history.length} prior run(s)`,
          };
        }
      }
    }
  } catch {
    // Fall back to heuristic
  }

  const tokensPerSlice = avgTokensPerSlice || { input: 2000, output: 5000, source: "heuristic" };
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const sliceCount = plan.slices.length;
  const totalInputTokens = sliceCount * tokensPerSlice.input;
  const totalOutputTokens = sliceCount * tokensPerSlice.output;
  const estimatedCost = (totalInputTokens * pricing.input) + (totalOutputTokens * pricing.output);

  // Quorum overhead estimation (v2.5)
  let quorumOverhead = null;
  if (quorumConfig && quorumConfig.enabled) {
    const quorumSlices = quorumConfig.auto
      ? plan.slices.filter((s) => scoreSliceComplexity(s, cwd).score >= quorumConfig.threshold)
      : plan.slices;
    const modelCount = quorumConfig.models.length;
    // Each quorum slice: N dry-run prompt+response + 1 reviewer
    const dryRunInputPerLeg = tokensPerSlice.input * 1.5; // Dry-run prompt is larger
    const dryRunOutputPerLeg = tokensPerSlice.output * 0.8; // Plan output is shorter than code
    const reviewerInput = dryRunOutputPerLeg * modelCount + tokensPerSlice.input; // All outputs + original
    const reviewerOutput = tokensPerSlice.output * 0.6;

    const dryRunCostPerSlice = modelCount * (
      (dryRunInputPerLeg * pricing.input) + (dryRunOutputPerLeg * pricing.output)
    );
    const reviewerPricing = MODEL_PRICING[quorumConfig.reviewerModel] || pricing;
    const reviewerCostPerSlice = (reviewerInput * reviewerPricing.input) + (reviewerOutput * reviewerPricing.output);

    quorumOverhead = {
      quorumSliceCount: quorumSlices.length,
      totalSliceCount: sliceCount,
      dryRunCostPerSlice: Math.round(dryRunCostPerSlice * 100) / 100,
      reviewerCostPerSlice: Math.round(reviewerCostPerSlice * 100) / 100,
      totalOverheadUSD: Math.round((dryRunCostPerSlice + reviewerCostPerSlice) * quorumSlices.length * 100) / 100,
      models: quorumConfig.models,
      reviewerModel: quorumConfig.reviewerModel,
      slices: quorumSlices.map((s) => ({
        number: s.number,
        title: s.title,
        complexityScore: scoreSliceComplexity(s, cwd).score,
      })),
    };
  }

  return {
    status: "estimate",
    sliceCount,
    executionOrder: plan.dag.order,
    model: model || "auto",
    tokens: {
      estimatedInput: totalInputTokens,
      estimatedOutput: totalOutputTokens,
      source: tokensPerSlice.source,
    },
    estimatedCostUSD: Math.round(estimatedCost * 100) / 100,
    ...(quorumOverhead && {
      quorumOverhead,
      totalCostWithQuorumUSD: Math.round((estimatedCost + quorumOverhead.totalOverheadUSD) * 100) / 100,
    }),
    confidence: avgTokensPerSlice ? "historical" : "heuristic",
    slices: plan.slices.map((s) => ({
      number: s.number,
      title: s.title,
      depends: s.depends,
      parallel: s.parallel,
      scope: s.scope,
      ...(quorumConfig && quorumConfig.enabled && {
        complexityScore: scoreSliceComplexity(s, cwd).score,
        quorumEligible: quorumConfig.auto
          ? scoreSliceComplexity(s, cwd).score >= quorumConfig.threshold
          : true,
      }),
    })),
  };
}

/**
 * Run auto-sweep after all slices pass.
 * Calls pforge sweep and captures results.
 */
function runAutoSweep(cwd) {
  const IS_WINDOWS = process.platform === "win32";
  const pforge = IS_WINDOWS
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1 sweep`
    : `bash pforge.sh sweep`;
  try {
    const output = execSync(pforge, { cwd, encoding: "utf-8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } });
    const markerCount = (output.match(/TODO|FIXME|HACK|stub|placeholder/gi) || []).length;
    return { ran: true, clean: markerCount === 0, markerCount, output: output.trim() };
  } catch (err) {
    return { ran: true, clean: false, error: (err.stderr || err.message || "").trim() };
  }
}

/**
 * Run auto-analyze after all slices pass.
 * Calls pforge analyze and captures consistency score.
 */
function runAutoAnalyze(cwd, planPath) {
  const IS_WINDOWS = process.platform === "win32";
  const pforge = IS_WINDOWS
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1 analyze "${planPath}"`
    : `bash pforge.sh analyze "${planPath}"`;
  try {
    const output = execSync(pforge, { cwd, encoding: "utf-8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } });
    const scoreMatch = output.match(/(\d+)\s*\/\s*100|Score:\s*(\d+)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1] || scoreMatch[2], 10) : null;
    return { ran: true, score, output: output.trim() };
  } catch (err) {
    return { ran: true, score: null, error: (err.stderr || err.message || "").trim() };
  }
}

function buildSummary(plan, results, runMeta, extras = {}) {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
  const totalTokensOut = results.reduce((sum, r) => {
    const t = r.tokens?.tokens_out;
    return sum + (typeof t === "number" ? t : 0);
  }, 0);

  const summary = {
    plan: runMeta.plan,
    startTime: runMeta.startTime,
    endTime: new Date().toISOString(),
    mode: runMeta.mode,
    model: runMeta.model,
    sliceCount: plan.slices.length,
    results: { passed, failed, skipped, total: results.length },
    totalDuration,
    totalTokensOut,
    status: failed > 0 ? "failed" : "completed",
    cost: buildCostBreakdown(results),
    sliceResults: results,
  };

  // Auto-sweep + auto-analyze results (Slice 6)
  if (extras.sweepResult) summary.sweep = extras.sweepResult;
  if (extras.analyzeResult) summary.analyze = extras.analyzeResult;

  // Build report line
  const parts = [`All slices: ${passed} passed, ${failed} failed`];
  if (summary.cost?.total_cost_usd > 0) {
    parts.push(`Cost: $${summary.cost.total_cost_usd}`);
  }
  if (extras.sweepResult?.ran) {
    parts.push(`Sweep: ${extras.sweepResult.clean ? "clean" : `${extras.sweepResult.markerCount || "?"} markers`}`);
  }
  if (extras.analyzeResult?.ran && extras.analyzeResult.score !== null) {
    parts.push(`Score: ${extras.analyzeResult.score}/100`);
  }
  summary.report = parts.join(". ") + ".";

  return summary;
}

function createRunDir(cwd, planPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planName = basename(planPath, ".md");
  const runDir = resolve(cwd, ".forge", "runs", `${timestamp}_${planName}`);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

// ─── Self-Test ────────────────────────────────────────────────────────

async function selfTest() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Plan Forge Orchestrator — Self Test     ║");
  console.log("╚══════════════════════════════════════════╝\n");

  let passed = 0;
  let failed = 0;

  function assert(label, condition) {
    if (condition) {
      console.log(`  ✅ ${label}`);
      passed++;
    } else {
      console.log(`  ❌ ${label}`);
      failed++;
    }
  }

  // Test 1: Parse example plan
  console.log("─── Plan Parser ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const plan = parsePlan(examplePlan);
      assert("Parses plan without error", true);
      assert(`Found ${plan.slices.length} slices`, plan.slices.length > 0);
      assert("First slice has number", !!plan.slices[0]?.number);
      assert("First slice has title", !!plan.slices[0]?.title);
      assert("DAG has execution order", plan.dag.order.length > 0);
      assert("DAG order matches slice count", plan.dag.order.length === plan.slices.length);
      assert("Meta title extracted", !!plan.meta.title);

      // Check validation gate parsing
      const sliceWithGate = plan.slices.find((s) => s.validationGate);
      assert("At least one slice has validation gate", !!sliceWithGate);

      // Check build command parsing
      const sliceWithBuild = plan.slices.find((s) => s.buildCommand);
      assert("At least one slice has build command", !!sliceWithBuild);
    } else {
      console.log("  ⚠️  Example plan not found — skipping parser tests");
    }
  } catch (err) {
    assert(`Parse plan: ${err.message}`, false);
  }

  // Test 2: Parse Phase 1 plan (with tags)
  console.log("\n─── Phase 1 Plan (tags) ───");
  try {
    const phase1Plan = resolve(process.cwd(), "docs/plans/Phase-1-ORCHESTRATOR-RUN-PLAN-PLAN.md");
    if (existsSync(phase1Plan)) {
      const plan = parsePlan(phase1Plan);
      assert("Parses Phase 1 plan", true);
      assert(`Found ${plan.slices.length} slices`, plan.slices.length >= 8);
      assert("Has scope contract", plan.scopeContract.inScope.length > 0);
      assert("Has forbidden actions", plan.scopeContract.forbidden.length > 0);
    }
  } catch (err) {
    assert(`Parse Phase 1: ${err.message}`, false);
  }

  // Test 3: DAG with dependencies
  console.log("\n─── DAG Builder ───");
  try {
    const testSlices = [
      { number: "1", title: "First", depends: [], parallel: false, scope: [], tasks: [] },
      { number: "2", title: "Second", depends: ["1"], parallel: false, scope: [], tasks: [] },
      { number: "3", title: "Third", depends: ["1"], parallel: true, scope: ["src/**"], tasks: [] },
      { number: "4", title: "Fourth", depends: ["2", "3"], parallel: false, scope: [], tasks: [] },
    ];
    const dag = buildDAG(testSlices);
    assert("DAG built from explicit deps", true);
    assert("Topological order has 4 entries", dag.order.length === 4);
    assert("Slice 1 is first", dag.order[0] === "1");
    assert("Slice 4 is last", dag.order[dag.order.length - 1] === "4");
    assert("Parallel flag preserved", dag.nodes.get("3").parallel === true);
    assert("Scope metadata preserved", dag.nodes.get("3").scope.length > 0);
  } catch (err) {
    assert(`DAG builder: ${err.message}`, false);
  }

  // Test 4: Cycle detection
  console.log("\n─── Cycle Detection ───");
  try {
    const cyclicSlices = [
      { number: "1", title: "A", depends: ["2"], parallel: false, scope: [], tasks: [] },
      { number: "2", title: "B", depends: ["1"], parallel: false, scope: [], tasks: [] },
    ];
    try {
      buildDAG(cyclicSlices);
      assert("Cycle detection throws error", false);
    } catch (err) {
      assert("Cycle detection throws error", err.message.includes("Cycle"));
    }
  } catch (err) {
    assert(`Cycle test: ${err.message}`, false);
  }

  // Test 5: Event bus
  console.log("\n─── Event Bus ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    bus.emit("slice-started", { sliceId: "1" });
    bus.emit("slice-completed", { sliceId: "1" });
    assert("Event bus fires events", events.length === 2);
    assert("Events have type", events[0].type === "slice-started");
    assert("Events have timestamp", !!events[0].timestamp);
    assert("Events have data", !!events[0].data.sliceId);
  } catch (err) {
    assert(`Event bus: ${err.message}`, false);
  }

  // Test 6: Sequential scheduler with mock executor
  console.log("\n─── Sequential Scheduler ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    const scheduler = new SequentialScheduler(bus);

    const nodes = new Map();
    nodes.set("1", { number: "1", title: "First", children: ["2"], inDegree: 0 });
    nodes.set("2", { number: "2", title: "Second", children: [], inDegree: 1 });
    const order = ["1", "2"];

    const results = await scheduler.execute(nodes, order, async (slice) => {
      return { status: "passed", duration: 100 };
    });

    assert("Scheduler executed 2 slices", results.length === 2);
    assert("Both passed", results.every((r) => r.status === "passed"));
    assert("Events fired for lifecycle",
      events.some((e) => e.type === "slice-started") &&
      events.some((e) => e.type === "slice-completed"));
  } catch (err) {
    assert(`Scheduler: ${err.message}`, false);
  }

  // Test 7: Worker detection
  console.log("\n─── Worker Detection ───");
  try {
    const workers = detectWorkers();
    assert("Detects workers array", Array.isArray(workers));
    assert(`Found ${workers.filter((w) => w.available).length} available worker(s)`,
      workers.some((w) => w.available));

    const ghCopilot = workers.find((w) => w.name === "gh-copilot");
    assert("gh-copilot in worker list", !!ghCopilot);
  } catch (err) {
    assert(`Worker detection: ${err.message}`, false);
  }

  // Test 8: Gate execution
  console.log("\n─── Gate Execution ───");
  try {
    const result = runGate("node --version", process.cwd());
    assert("Gate runs command", result.success);
    assert("Gate captures output", result.output.startsWith("v"));

    const failResult = runGate("exit 1", process.cwd());
    assert("Gate detects failure", !failResult.success);

    // C1: Gate allowlist blocks unknown commands
    const blockedResult = runGate("curl http://example.com", process.cwd());
    assert("Gate blocks non-allowlisted commands", !blockedResult.success);
    assert("Gate error mentions allowlist", blockedResult.error.includes("allowlist"));

    // C1: Gate allows common build tools
    const npmResult = runGate("node -e \"console.log('ok')\"", process.cwd());
    assert("Gate allows node commands", npmResult.success);
  } catch (err) {
    assert(`Gate execution: ${err.message}`, false);
  }

  // Test 9: Estimate mode
  console.log("\n─── Estimate Mode ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const plan = parsePlan(examplePlan);
      const est = buildEstimate(plan, "claude-sonnet-4.6", process.cwd());
      assert("Estimate has slice count", est.sliceCount > 0);
      assert("Estimate has cost", est.estimatedCostUSD >= 0);
      assert("Estimate has tokens", est.tokens.estimatedInput > 0);
      assert("Estimate has execution order", est.executionOrder.length > 0);
      assert("Estimate has confidence", est.confidence === "heuristic" || est.confidence === "historical");
      assert("Estimate has source", !!est.tokens.source);
    }
  } catch (err) {
    assert(`Estimate: ${err.message}`, false);
  }

  // Test 10: runPlan() dry-run mode (T1: end-to-end test)
  console.log("\n─── Full Run (Dry-Run) ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const result = await runPlan(examplePlan, { dryRun: true, cwd: process.cwd() });
      assert("Dry-run returns status", result.status === "dry-run");
      assert("Dry-run returns plan object", !!result.plan);
      assert("Dry-run plan has slices", result.plan.slices.length > 0);
    }
  } catch (err) {
    assert(`Dry-run: ${err.message}`, false);
  }

  // Test 11: Model routing (T2: loadModelRouting)
  console.log("\n─── Model Routing ───");
  try {
    const routing = loadModelRouting(process.cwd());
    assert("loadModelRouting returns object", typeof routing === "object");
    assert("Has default key", "default" in routing);

    // resolveModel priority chain
    assert("CLI override wins", resolveModel("claude-sonnet-4.6", { default: "gpt-5" }, null) === "claude-sonnet-4.6");
    assert("Routing default when CLI is auto", resolveModel("auto", { default: "gpt-5" }, null) === "gpt-5");
    assert("Null when both auto", resolveModel(null, { default: "auto" }, null) === null);
  } catch (err) {
    assert(`Model routing: ${err.message}`, false);
  }

  // Test 12: Path traversal prevention (C4)
  console.log("\n─── Security ───");
  try {
    try {
      parsePlan("../../../../etc/passwd");
      assert("Path traversal blocked", false);
    } catch (err) {
      assert("Path traversal blocked", err.message.includes("within project"));
    }
  } catch (err) {
    assert(`Security: ${err.message}`, false);
  }

  // Test 13: Error paths (T2: missing file)
  console.log("\n─── Error Paths ───");
  try {
    try {
      parsePlan("nonexistent-plan.md");
      assert("Missing file throws", false);
    } catch {
      assert("Missing file throws", true);
    }

    // Token extraction with empty events
    const emptyTokens = extractTokens([]);
    assert("Empty events returns null tokens_in", emptyTokens.tokens_in === null);
    assert("Empty events returns 0 tokens_out", emptyTokens.tokens_out === 0);
  } catch (err) {
    assert(`Error paths: ${err.message}`, false);
  }

  // Test 14: Cost calculation (Phase 2)
  console.log("\n─── Cost Calculation ───");
  try {
    // Per-slice cost
    const cost1 = calculateSliceCost({ tokens_in: 1000, tokens_out: 500, model: "claude-sonnet-4.6" });
    assert("Cost calculated for Claude Sonnet", cost1.cost_usd > 0);
    assert("Cost has model", cost1.model === "claude-sonnet-4.6");
    // 1000 * 3/1M + 500 * 15/1M = 0.003 + 0.0075 = 0.0105
    assert("Cost matches expected", Math.abs(cost1.cost_usd - 0.0105) < 0.0001);

    const cost2 = calculateSliceCost({ tokens_in: null, tokens_out: 100, model: "unknown-model" });
    assert("Unknown model uses default pricing", cost2.cost_usd > 0);
    assert("Null tokens_in treated as 0", cost2.tokens_in === 0);

    // CLI worker uses premium request costing, not token pricing
    const cost3 = calculateSliceCost({ tokens_in: 500000, tokens_out: 5000, model: "claude-opus-4.6", premiumRequests: 3 }, "gh-copilot");
    assert("CLI worker uses premium request rate", cost3.cost_usd === 0.03);
    assert("CLI worker preserves token counts", cost3.tokens_in === 500000);

    // API worker uses per-token pricing
    const cost4 = calculateSliceCost({ tokens_in: 1000, tokens_out: 500, model: "grok-4" }, "api-xai");
    assert("API worker uses token pricing", cost4.cost_usd > 0);
    assert("API worker cost matches expected", Math.abs(cost4.cost_usd - 0.007) < 0.0001); // 1000*2/1M + 500*10/1M

    // Breakdown
    const mockResults = [
      { number: "1", tokens: { tokens_in: 500, tokens_out: 200, model: "claude-sonnet-4.6" }, status: "passed" },
      { number: "2", tokens: { tokens_in: 300, tokens_out: 100, model: "gpt-5-mini" }, status: "passed" },
      { number: "3", status: "skipped" },
    ];
    const breakdown = buildCostBreakdown(mockResults);
    assert("Breakdown has total cost", breakdown.total_cost_usd >= 0);
    assert("Breakdown has 2 models", Object.keys(breakdown.by_model).length === 2);
    assert("Breakdown has 2 slices (skipped excluded)", breakdown.by_slice.length === 2);

    // Cost report with no history
    const report = getCostReport(process.cwd());
    assert("Cost report works (may be empty)", report !== undefined);
  } catch (err) {
    assert(`Cost calculation: ${err.message}`, false);
  }

  // Test 15: Parallel scheduler (Phase 6)
  console.log("\n─── Parallel Scheduler ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    const pScheduler = new ParallelScheduler(bus, 2);

    // Build a DAG with parallel slices
    const pNodes = new Map();
    pNodes.set("1", { number: "1", title: "Setup", depends: [], parallel: false, scope: [], children: ["2", "3"], inDegree: 0 });
    pNodes.set("2", { number: "2", title: "AuthModule", depends: ["1"], parallel: true, scope: ["src/auth/**"], children: ["4"], inDegree: 1 });
    pNodes.set("3", { number: "3", title: "UserModule", depends: ["1"], parallel: true, scope: ["src/user/**"], children: ["4"], inDegree: 1 });
    pNodes.set("4", { number: "4", title: "Integration", depends: ["2", "3"], parallel: false, scope: [], children: [], inDegree: 2 });
    const pOrder = ["1", "2", "3", "4"];

    let concurrentCount = 0;
    let maxConcurrent = 0;
    const pResults = await pScheduler.execute(pNodes, pOrder, async (slice) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 50)); // Simulate work
      concurrentCount--;
      return { status: "passed", duration: 50 };
    });

    assert("Parallel scheduler executed all 4 slices", pResults.length === 4);
    assert("All slices passed", pResults.every((r) => r.status === "passed"));
    assert("Slices 2+3 ran in parallel", maxConcurrent >= 2);
    assert("Events fired for parallel slices", events.some((e) => e.type === "slice-completed"));

    // Test conflict detection
    const conflictNodes = new Map();
    conflictNodes.set("1", { parallel: true, scope: ["src/auth/**"] });
    conflictNodes.set("2", { parallel: true, scope: ["src/auth/login.js"] }); // Overlaps!
    conflictNodes.set("3", { parallel: true, scope: ["src/user/**"] }); // No overlap
    const conflicts = detectScopeConflicts(conflictNodes);
    assert("Conflict detection finds overlapping scopes", conflicts.has("1") && conflicts.has("2"));
    assert("Non-overlapping scope has no conflict", !conflicts.has("3"));
  } catch (err) {
    assert(`Parallel scheduler: ${err.message}`, false);
  }

  // Test 16: Quorum — Complexity scoring (v2.5)
  console.log("\n─── Quorum: Complexity Scoring ───");
  try {
    // Simple slice — low complexity
    const simpleSlice = {
      number: "1", title: "Add README",
      tasks: ["Create README.md"],
      scope: [], depends: [], validationGate: "",
    };
    const simpleResult = scoreSliceComplexity(simpleSlice, process.cwd());
    assert("Simple slice scores low", simpleResult.score <= 3);
    assert("Score has signals object", typeof simpleResult.signals === "object");
    assert("Signals have scopeWeight", "scopeWeight" in simpleResult.signals);

    // Complex slice — auth + migration + many deps + many tasks
    const complexSlice = {
      number: "2", title: "Auth migration with RBAC",
      tasks: [
        "Create migration for users table",
        "Implement JWT authentication",
        "Add RBAC role checking middleware",
        "Create token refresh endpoint",
        "Add password hashing service",
        "Write auth integration tests",
        "Add CORS policy for auth endpoints",
        "Seed admin role data",
      ],
      scope: ["src/auth/**", "src/middleware/**", "db/migrations/**", "tests/auth/**"],
      depends: ["1", "3", "4"],
      validationGate: "dotnet build\ndotnet test --filter Auth\ndotnet ef database update\ncurl -f http://localhost/health",
    };
    const complexResult = scoreSliceComplexity(complexSlice, process.cwd());
    assert("Complex slice scores high", complexResult.score >= 7);
    assert("Security keywords detected", complexResult.signals.securityWeight > 0);
    assert("Database keywords detected", complexResult.signals.databaseWeight > 0);
    assert("High task count detected", complexResult.signals.taskWeight > 0);
    assert("Multiple deps detected", complexResult.signals.dependencyWeight > 0);

    // Score is always 1-10
    assert("Score >= 1", simpleResult.score >= 1);
    assert("Score <= 10", complexResult.score <= 10);
  } catch (err) {
    assert(`Complexity scoring: ${err.message}`, false);
  }

  // Test 17: Quorum — Config loading (v2.5)
  console.log("\n─── Quorum: Config ───");
  try {
    const config = loadQuorumConfig(process.cwd());
    assert("Config has enabled flag", "enabled" in config);
    assert("Config has auto flag", "auto" in config);
    assert("Config has threshold", typeof config.threshold === "number");
    assert("Config has models array", Array.isArray(config.models));
    assert("Config has 3 default models", config.models.length === 3);
    assert("Config has reviewerModel", typeof config.reviewerModel === "string");
    assert("Config has dryRunTimeout", typeof config.dryRunTimeout === "number");
    assert("Default threshold is 7", config.threshold === 7);
  } catch (err) {
    assert(`Quorum config: ${err.message}`, false);
  }

  // Summary
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════`);

  process.exit(failed > 0 ? 1 : 0);
}

// ─── CLI Entry Point ──────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

if (args.includes("--test")) {
  selfTest();
} else if (args.includes("--parse")) {
  const planPath = getArg("--parse");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --parse <plan-path>");
    process.exit(1);
  }
  const plan = parsePlan(planPath);
  console.log(JSON.stringify(plan, null, 2));
} else if (args.includes("--run")) {
  const planPath = getArg("--run");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --run <plan-path> [options]");
    process.exit(1);
  }

  const mode = getArg("--mode") || "auto";
  const model = getArg("--model") || null;
  const resumeFrom = getArg("--resume-from") ? Number(getArg("--resume-from")) : null;
  const estimate = args.includes("--estimate");
  const dryRun = args.includes("--dry-run");

  // Quorum mode: --quorum (force all) or --quorum=auto (threshold-based)
  let quorum = false;
  const quorumArg = args.find((a) => a.startsWith("--quorum"));
  if (quorumArg) {
    if (quorumArg === "--quorum=auto") quorum = "auto";
    else quorum = true;
  }
  const quorumThreshold = getArg("--quorum-threshold") ? Number(getArg("--quorum-threshold")) : null;

  try {
    const result = await runPlan(planPath, {
      cwd: process.cwd(),
      mode,
      model,
      resumeFrom,
      estimate,
      dryRun,
      quorum,
      quorumThreshold,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error(`Orchestrator error: ${err.message}`);
    process.exit(1);
  }
} else if (args.includes("--analyze")) {
  const target = getArg("--analyze");
  if (!target) {
    console.error("Usage: node orchestrator.mjs --analyze <plan-or-file> [--mode plan|file] [--models model1,model2,...]");
    process.exit(1);
  }

  const mode = getArg("--mode") || (target.match(/plan/i) ? "plan" : "file");
  const modelsArg = getArg("--models");
  const models = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : null;

  try {
    const result = await analyzeWithQuorum({
      target,
      mode,
      models,
      cwd: process.cwd(),
    });

    // Print synthesis (readable) to stdout
    if (result.synthesis) {
      console.log("\n" + "═".repeat(60));
      console.log("  QUORUM ANALYSIS — SYNTHESIZED REPORT");
      console.log("═".repeat(60) + "\n");
      console.log(result.synthesis);
    }

    // Print cost summary
    console.log("\n" + "─".repeat(40));
    console.log(`  Models: ${result.models.join(", ")}`);
    console.log(`  Duration: ${Math.round(result.totalDuration / 1000)}s`);
    console.log(`  Cost: $${result.totalCost.toFixed(2)}`);
    console.log("─".repeat(40));

    // Save full JSON report to .forge/
    const reportDir = resolve(process.cwd(), ".forge", "analysis");
    mkdirSync(reportDir, { recursive: true });
    const reportFile = resolve(reportDir, `${basename(target, ".md")}-${Date.now()}.json`);
    writeFileSync(reportFile, JSON.stringify(result, null, 2));
    console.log(`\n  📄 Full report saved: ${reportFile}\n`);

    process.exit(0);
  } catch (err) {
    console.error(`Analysis error: ${err.message}`);
    process.exit(1);
  }
} else if (args.includes("--diagnose")) {
  const target = getArg("--diagnose");
  if (!target) {
    console.error("Usage: node orchestrator.mjs --diagnose <file> [--models model1,model2,...]");
    process.exit(1);
  }

  const modelsArg = getArg("--models");
  const models = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : null;

  try {
    const result = await analyzeWithQuorum({
      target,
      mode: "diagnose",
      models,
      cwd: process.cwd(),
    });

    if (result.synthesis) {
      console.log("\n" + "═".repeat(60));
      console.log("  QUORUM DIAGNOSIS — BUG INVESTIGATION REPORT");
      console.log("═".repeat(60) + "\n");
      console.log(result.synthesis);
    }

    console.log("\n" + "─".repeat(40));
    console.log(`  Models: ${result.models.join(", ")}`);
    console.log(`  Duration: ${Math.round(result.totalDuration / 1000)}s`);
    console.log(`  Cost: $${result.totalCost.toFixed(2)}`);
    console.log("─".repeat(40));

    const reportDir = resolve(process.cwd(), ".forge", "analysis");
    mkdirSync(reportDir, { recursive: true });
    const reportFile = resolve(reportDir, `diagnose-${basename(target)}-${Date.now()}.json`);
    writeFileSync(reportFile, JSON.stringify(result, null, 2));
    console.log(`\n  📄 Full report saved: ${reportFile}\n`);

    process.exit(0);
  } catch (err) {
    console.error(`Diagnosis error: ${err.message}`);
    process.exit(1);
  }
}
