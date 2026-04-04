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
 *   node mcp/orchestrator.mjs --test              # run self-test
 *   node mcp/orchestrator.mjs --parse <plan>      # parse and dump DAG
 *
 * @module orchestrator
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { resolve, basename, dirname } from "node:path";
import { EventEmitter } from "node:events";

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
  const content = readFileSync(resolve(planPath), "utf-8");
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
    timeout = 600_000, // 10 min default
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

    switch (chosen.name) {
      case "gh-copilot":
        cmd = "gh";
        args = ["copilot", "--", "-p", prompt, "--allow-all", "--no-ask-user", "--output-format", "json", "-s"];
        if (model) args.push("--model", model);
        break;
      case "claude":
        cmd = "claude";
        args = ["-p", prompt, "--output-format", "json"];
        if (model) args.push("--model", model);
        break;
      case "codex":
        cmd = "codex";
        args = ["-p", prompt, "--output-format", "json"];
        if (model) args.push("--model", model);
        break;
      default:
        reject(new Error(`Unknown worker: ${chosen.name}`));
        return;
    }

    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

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

      const jsonlEvents = parseJSONL(stdout);
      const tokens = extractTokens(jsonlEvents);

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
      reject(err);
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
    if (event.type === "assistant.message" && event.data?.outputTokens) {
      outputTokens += event.data.outputTokens;
    }
    if (event.type === "result" && event.usage) {
      premiumRequests = event.usage.premiumRequests || 0;
      apiDurationMs = event.usage.totalApiDurationMs || 0;
      sessionDurationMs = event.usage.sessionDurationMs || 0;
      codeChanges = event.usage.codeChanges || null;
    }
  }

  return {
    tokens_out: outputTokens,
    tokens_in: "unknown", // Not reported by Copilot CLI — estimate from prompt
    model,
    premiumRequests,
    apiDurationMs,
    sessionDurationMs,
    codeChanges,
  };
}

/**
 * Run a validation gate command directly (no AI worker needed).
 *
 * @param {string} command - Shell command to run
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, output: string, error: string }}
 */
export function runGate(command, cwd) {
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
 * Parallel scheduler — Phase 6 placeholder.
 * Interface defined now, implementation deferred.
 */
export class ParallelScheduler {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  async execute(_nodes, _order, _executeFn, _options) {
    throw new Error("ParallelScheduler not implemented — see Phase 6");
  }
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
    return buildEstimate(plan, effectiveModel);
  }

  // Dry run — parse and validate only
  if (dryRun) {
    return { status: "dry-run", plan };
  }

  // Set up event bus with DI handler
  const runDir = createRunDir(cwd, planPath);
  const logHandler = new LogEventHandler(runDir);
  const eventBus = new OrchestratorEventBus(eventHandler || logHandler);

  // Write run.json metadata
  const runMeta = {
    plan: planPath,
    startTime: new Date().toISOString(),
    model: effectiveModel || "auto",
    modelRouting,
    mode,
    sliceCount: plan.slices.length,
    executionOrder: plan.dag.order,
  };
  writeFileSync(resolve(runDir, "run.json"), JSON.stringify(runMeta, null, 2));

  // Select scheduler
  const scheduler = new SequentialScheduler(eventBus);
  const abortSignal = abortController?.signal || null;

  eventBus.emit("run-started", runMeta);

  // Execute slices
  const results = await scheduler.execute(
    plan.dag.nodes,
    plan.dag.order,
    async (slice) => executeSlice(slice, { cwd, model: effectiveModel, modelRouting, mode, runDir }),
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

  eventBus.emit("run-completed", summary);

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
 * Resolve which model to use for a given slice based on routing config.
 * Priority: CLI override > slice-type routing > default routing > null (auto)
 */
function resolveModel(cliModel, modelRouting, _slice) {
  if (cliModel && cliModel !== "auto") return cliModel;
  // Future: match slice type (execute/review/test) to routing keys
  if (modelRouting.default && modelRouting.default !== "auto") return modelRouting.default;
  return null; // Let CLI worker pick default
}

/**
 * Execute a single slice — spawn worker + run validation gates.
 */
async function executeSlice(slice, options) {
  const { cwd, model, modelRouting = {}, mode, runDir } = options;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model, modelRouting, slice);

  const sliceInstructions = buildSlicePrompt(slice);
  let workerResult = null;

  if (mode === "assisted") {
    // Assisted mode: don't spawn worker, just validate gates
    workerResult = {
      output: "Assisted mode — human executes in VS Code",
      tokens: { tokens_in: "n/a", tokens_out: "n/a", model: "human" },
      exitCode: 0,
      worker: "human",
      model: "human",
    };
  } else {
    // Full Auto mode: spawn worker
    try {
      workerResult = await spawnWorker(sliceInstructions, { model: resolvedModel, cwd });
    } catch (err) {
      return {
        status: "failed",
        duration: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  // Capture session log (C4)
  const logFile = resolve(runDir, `slice-${slice.number}-log.txt`);
  const logContent = [
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
  writeFileSync(logFile, logContent);

  // Run validation gate if defined
  let gateResult = { success: true, output: "No validation gate defined" };
  if (slice.validationGate) {
    // Execute each line of the validation gate as a separate command
    const gateLines = slice.validationGate
      .split("\n")
      .map((l) => l.replace(/\s{2,}#\s.*$/, "").trim()) // Strip inline comments (2+ spaces before #)
      .filter((l) => l.length > 0);

    for (const gateLine of gateLines) {
      gateResult = runGate(gateLine, cwd);
      if (!gateResult.success) break;
    }
  }

  const duration = Date.now() - startTime;
  const status = workerResult.exitCode === 0 && gateResult.success ? "passed" : "failed";

  // Write per-slice result (Slice 2 schema)
  const sliceResult = {
    number: slice.number,
    title: slice.title,
    status,
    duration,
    exitCode: workerResult.exitCode,
    gateStatus: gateResult.success ? "passed" : "failed",
    gateOutput: gateResult.output,
    gateError: gateResult.error || null,
    tokens: workerResult.tokens || { tokens_in: "unknown", tokens_out: "unknown", model: "unknown" },
    worker: workerResult.worker,
    model: workerResult.model,
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

function buildEstimate(plan, model) {
  // Rough estimate: ~2000 tokens per slice for input, ~5000 for output
  const tokensPerSlice = { input: 2000, output: 5000 };
  const costPerToken = {
    "claude-sonnet-4.6": { input: 0.003 / 1000, output: 0.015 / 1000 },
    "gpt-5.2-codex": { input: 0.002 / 1000, output: 0.008 / 1000 },
    "gpt-5-mini": { input: 0.0004 / 1000, output: 0.0016 / 1000 },
    default: { input: 0.003 / 1000, output: 0.015 / 1000 },
  };

  const pricing = costPerToken[model] || costPerToken.default;
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
    },
    estimatedCostUSD: Math.round(estimatedCost * 100) / 100,
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
    sliceResults: results,
  };

  // Auto-sweep + auto-analyze results (Slice 6)
  if (extras.sweepResult) summary.sweep = extras.sweepResult;
  if (extras.analyzeResult) summary.analyze = extras.analyzeResult;

  // Build report line
  const parts = [`All slices: ${passed} passed, ${failed} failed`];
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
  } catch (err) {
    assert(`Gate execution: ${err.message}`, false);
  }

  // Test 9: Estimate mode
  console.log("\n─── Estimate Mode ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const plan = parsePlan(examplePlan);
      const est = buildEstimate(plan, "claude-sonnet-4.6");
      assert("Estimate has slice count", est.sliceCount > 0);
      assert("Estimate has cost", est.estimatedCostUSD >= 0);
      assert("Estimate has tokens", est.tokens.estimatedInput > 0);
      assert("Estimate has execution order", est.executionOrder.length > 0);
    }
  } catch (err) {
    assert(`Estimate: ${err.message}`, false);
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
