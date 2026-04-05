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

// ─── Worker Spawning ──────────────────────────────────────────────────

/**
 * Detect available CLI workers in priority order.
 * @returns {{ name: string, available: boolean }[]}
 */
export function detectWorkers() {
  const workers = [
    { name: "gh-copilot", command: "gh", args: ["copilot", "--", "--version"] },
    { name: "claude", command: "claude", args: ["--version"] },
    { name: "codex", command: "codex", args: ["--version"] },
  ];

  return workers.map((w) => {
    try {
      execSync(`${w.command} ${w.args.join(" ")}`, {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: "pipe",
      });
      return { name: w.name, available: true };
    } catch {
      return { name: w.name, available: false };
    }
  });
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

  return new Promise((resolve, reject) => {
    const workers = worker ? [{ name: worker }] : detectWorkers().filter((w) => w.available);
    if (workers.length === 0) {
      reject(new Error("No CLI workers available. Install gh copilot, claude, or codex CLI."));
      return;
    }

    const chosen = workers[0];
    let args;
    let cmd;

    // Write prompt to temp file to avoid CLI arg length/escaping issues
    const promptFile = resolve(tmpdir(), `pforge-prompt-${Date.now()}.txt`);
    writeFileSync(promptFile, prompt);

    switch (chosen.name) {
      case "gh-copilot": {
        // Use shell wrapper to read prompt from temp file (avoids Windows spawn arg limits)
        if (process.platform === "win32") {
          cmd = "pwsh";
          args = ["-NoProfile", "-Command",
            `$p = Get-Content -Path '${promptFile}' -Raw; & gh copilot -- -p $p --allow-all --no-ask-user` + (model ? ` --model ${model}` : "")];
        } else {
          cmd = "bash";
          args = ["-c",
            `gh copilot -- -p "$(cat '${promptFile}')" --allow-all --no-ask-user` + (model ? ` --model ${model}` : "")];
        }
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
        reject(new Error(`Unknown worker: ${chosen.name}`));
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

      resolve({
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
      reject(new Error(`Failed to spawn ${cmd}: ${err.message} (code: ${err.code || "unknown"})`));
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
  } = options;

  // Load model routing from .forge.json (Slice 5)
  const modelRouting = loadModelRouting(cwd);
  const effectiveModel = model || modelRouting.default || null;

  // Parse plan
  const plan = parsePlan(planPath);

  // Estimation mode — return without executing
  if (estimate) {
    return buildEstimate(plan, effectiveModel, cwd);
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

  eventBus.emit("run-started", runMeta);

  // Execute slices
  const maxRetries = loadMaxRetries(cwd);
  const results = await scheduler.execute(
    plan.dag.nodes,
    plan.dag.order,
    async (slice) => executeSlice(slice, {
      cwd, model: effectiveModel, modelRouting, mode, runDir, maxRetries,
      memoryEnabled, projectName, planName: basename(planPath, ".md"),
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
    memoryEnabled = false, projectName = "", planName = "" } = options;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model, modelRouting, slice);

  let attempt = 0;
  let workerResult = null;
  let gateResult = { success: true, output: "No validation gate defined" };
  let lastError = null;

  while (attempt <= maxRetries) {
    // Build prompt — on retry, include the error context
    let sliceInstructions = buildSlicePrompt(slice);

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
  // Fallback
  default:                  { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
};

/**
 * Calculate cost for a single slice from its token data.
 * @param {{ tokens_in: number|null, tokens_out: number|null, model: string }} tokens
 * @returns {{ cost_usd: number, model: string, tokens_in: number, tokens_out: number }}
 */
export function calculateSliceCost(tokens) {
  const model = tokens?.model || "unknown";
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const tokensIn = typeof tokens?.tokens_in === "number" ? tokens.tokens_in : 0;
  const tokensOut = typeof tokens?.tokens_out === "number" ? tokens.tokens_out : 0;
  const cost = (tokensIn * pricing.input) + (tokensOut * pricing.output);
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
    const cost = calculateSliceCost(sr.tokens);
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

function buildEstimate(plan, model, cwd) {
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
    confidence: avgTokensPerSlice ? "historical" : "heuristic",
    slices: plan.slices.map((s) => ({
      number: s.number,
      title: s.title,
      depends: s.depends,
      parallel: s.parallel,
      scope: s.scope,
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

  try {
    const result = await runPlan(planPath, {
      cwd: process.cwd(),
      mode,
      model,
      resumeFrom,
      estimate,
      dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error(`Orchestrator error: ${err.message}`);
    process.exit(1);
  }
}
