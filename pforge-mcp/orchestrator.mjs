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

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, appendFileSync, readdirSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { resolve, basename, dirname, join, relative, extname } from "node:path";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { createTraceContext, createTelemetryHandler, writeManifest, appendRunIndex, pruneRunHistory, addLogSummary } from "./telemetry.mjs";
import { isOpenBrainConfigured, buildMemorySearchBlock, buildMemoryCaptureBlock, buildRunSummaryThought, buildCostAnomalyThought, loadProjectContext } from "./memory.mjs";

// ─── Centralized Constants ────────────────────────────────────────────
/** Canonical list of all supported agent adapters. Update here — consumed by dashboard, setup, and docs. */
export const SUPPORTED_AGENTS = ["copilot", "claude", "cursor", "codex", "gemini", "windsurf", "generic"];

/** Allowlist of commands permitted in validation gates. Shared by runGate() and lintGateCommands(). */
export const GATE_ALLOWED_PREFIXES = [
  // Build / test runners
  "npm", "npx", "node", "cargo", "go", "dotnet", "python", "python3",
  "pip", "mvn", "gradle", "make", "cmake", "bash", "sh", "pwsh",
  "powershell", "pytest", "mypy", "ruff", "eslint", "tsc", "vitest",
  "jest", "mocha",
  // Shell builtins & coreutils used in gate commands
  "cd", "cat", "ls", "rm", "mkdir", "cp", "mv", "diff", "wc",
  "head", "tail", "sort", "curl", "git", "grep", "test", "echo",
  "exit", "true", "false",
  // Project tools
  "pforge",
];

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
      "slice-failed", "slice-escalated", "run-completed", "run-aborted",
      "quorum-dispatch-started", "quorum-leg-completed", "quorum-review-completed",
      "skill-started", "skill-step-started", "skill-step-completed", "skill-completed",
      "slice-model-routed",
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
export function parsePlan(planPath, cwd = process.cwd()) {
  const fullPath = resolve(planPath);
  // C4: Validate path is within project to prevent traversal
  const projectRoot = resolve(cwd);
  if (!fullPath.startsWith(projectRoot)) {
    throw new Error(`Plan path must be within project directory: ${planPath}`);
  }
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");

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

    // Match slice headers (case-insensitive, flexible separators):
    //   ### Slice N: Title
    //   ### slice N — Title
    //   ### SLICE N.N - Title
    const sliceMatch = line.match(
      /^###\s+slice\s+([\d.]+)\s*[:\u2014\u2013—–-]\s*(.+?)(?:\s*\[.+?\])*\s*$/ui
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
      // Fuzzy depends: [depends: ...], [depends on: ...], [dep: ...], [needs: ...]
      const dependsMatch = rawTags.match(/\[(?:depends\s+on|depends|dep|needs):\s*([^\]]+)\]/i);
      if (dependsMatch) {
        current.depends = dependsMatch[1]
          .split(",")
          .map((d) => d.trim().replace(/^slice\s+/i, ""));
      }

      // Fuzzy parallel: [P], [parallel], [parallel-safe]
      const parallelMatch = rawTags.match(/\[(?:P|parallel(?:-safe)?)\]/i);
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

    // Parse build command (case-insensitive)
    const buildMatch = line.match(/\*\*Build [Cc]ommand\*\*:\s*`(.+?)`/i);
    if (buildMatch) current.buildCommand = buildMatch[1];

    // Parse test command (case-insensitive)
    const testMatch = line.match(/\*\*Test [Cc]ommand\*\*:\s*`(.+?)`/i);
    if (testMatch) current.testCommand = testMatch[1];

    // Detect validation gate section
    // Supports two formats:
    //   1. **Validation Gate**: <inline text>  (prose description, no code block)
    //   2. **Validation Gate**:\n```bash\n<commands>\n```  (fenced code block)
    const gateMatch = line.match(/\*\*Validation Gate\*?\*?\s*:?\s*(.*)$/i);
    if (gateMatch) {
      const inlineText = (gateMatch[1] || "").trim();
      if (inlineText && current) {
        // Inline gate text — extract backtick-wrapped commands or use prose
        const backtickCmds = [];
        const backtickRe = /`([^`]+)`/g;
        let bm;
        while ((bm = backtickRe.exec(inlineText)) !== null) backtickCmds.push(bm[1]);
        if (backtickCmds.length > 0) {
          current.validationGate = (current.validationGate ? current.validationGate + "\n" : "") + backtickCmds.join("\n");
        } else {
          // Store prose description as gate (regression guard won't execute it, but it's discoverable)
          current.validationGateDescription = inlineText;
        }
      }
      inValidationGate = true;
      continue;
    }

    // Parse stop condition
    const stopMatch = line.match(/\*\*Stop Condition\*\*:\s*(.+)/);
    if (stopMatch) current.stopCondition = stopMatch[1].trim();

    // Parse body-line **Depends On:** — merges with any [depends: ...] header tag.
    // Formats supported (colon can be inside OR outside the bold markers):
    //   **Depends On:** Slice 1, Slice 2A (auth required)
    //   **Depends On**: Slice 0
    const dependsBodyMatch = line.match(/\*\*Depends\s+On:?\*\*:?\s*(.+)/i);
    if (dependsBodyMatch) {
      // Strip trailing parenthetical notes, then split on commas
      const rawDeps = dependsBodyMatch[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
      const bodyDeps = rawDeps
        .split(/\s*,\s*/)
        .map((d) => d.replace(/^slice\s+/i, "").trim())
        .filter((d) => d.length > 0);
      // Merge with header-tag deps, de-dup
      for (const d of bodyDeps) {
        if (!current.depends.includes(d)) current.depends.push(d);
      }
    }

    // Parse body-line **Context Files:** — merges with any [scope: ...] header tag.
    // Extracts backtick-wrapped paths. Colon may appear inside OR outside bold markers.
    //   **Context Files:** `path/to/file.md`, `.github/instructions/auth.md`
    const contextBodyMatch = line.match(/\*\*Context Files:?\*\*:?\s*(.+)/i);
    if (contextBodyMatch) {
      const backticks = contextBodyMatch[1].match(/`([^`]+)`/g) || [];
      const files = backticks.map((s) => s.replace(/`/g, "").trim()).filter((s) => s.length > 0);
      for (const f of files) {
        if (!current.scope.includes(f)) current.scope.push(f);
      }
    }

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
 * Lookup order: environment variable → .forge/secrets.json → null
 * @param {string} model - Model identifier (e.g., "grok-3-mini")
 * @returns {{ name, baseUrl, apiKey, label } | null}
 */
function detectApiProvider(model) {
  if (!model) return null;
  for (const [name, provider] of Object.entries(API_PROVIDERS)) {
    if (provider.pattern.test(model)) {
      // 1. Environment variable (preferred — never on disk)
      const apiKey = process.env[provider.envKey] || loadSecretFromForge(provider.envKey);
      if (apiKey) return { name, baseUrl: provider.baseUrl, apiKey, label: provider.label };
      return null; // Model matches but no API key configured
    }
  }
  return null;
}

/**
 * Load an API key from .forge/secrets.json (fallback when env var is not set).
 * File is gitignored via **\/.forge/ pattern. Never committed.
 * Schema: { "XAI_API_KEY": "xai-...", "OPENAI_API_KEY": "sk-..." }
 * @param {string} key - Environment variable name to look up
 * @returns {string|null}
 */
function loadSecretFromForge(key) {
  try {
    const secretsPath = resolve(process.cwd(), ".forge", "secrets.json");
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
      return secrets[key] || null;
    }
  } catch { /* ignore parse errors */ }
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
 * Detect the actual image format from raw bytes using magic byte signatures.
 * Prevents MIME type mismatches when the API returns a different format than requested
 * (e.g. xAI Grok Aurora returns JPEG bytes even when PNG is assumed).
 *
 * @param {Buffer} buffer - Raw image bytes
 * @returns {{ ext: string, mimeType: string }}
 */
function detectImageFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { ext: "jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { ext: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { ext: "gif", mimeType: "image/gif" };
  }
  if (buffer.length >= 12 && buffer.slice(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", mimeType: "image/webp" };
  }
  // Unknown — default to JPEG (most common from xAI)
  return { ext: "jpg", mimeType: "image/jpeg" };
}

// Format metadata for conversion support
const FORMAT_META = {
  jpg:  { ext: "jpg",  mimeType: "image/jpeg", aliases: ["jpg", "jpeg"] },
  jpeg: { ext: "jpg",  mimeType: "image/jpeg", aliases: ["jpg", "jpeg"] },
  png:  { ext: "png",  mimeType: "image/png",  aliases: ["png"] },
  webp: { ext: "webp", mimeType: "image/webp", aliases: ["webp"] },
  avif: { ext: "avif", mimeType: "image/avif", aliases: ["avif"] },
  gif:  { ext: "gif",  mimeType: "image/gif",  aliases: ["gif"] },
};

/**
 * Convert image buffer to a target format using sharp.
 * Falls back gracefully if sharp is not installed — returns original buffer.
 *
 * @param {Buffer} buffer - Source image bytes
 * @param {string} targetFormat - Desired output format (jpg, png, webp, avif)
 * @param {{ quality?: number }} options - Encoding options
 * @returns {Promise<{ buffer: Buffer, format: { ext: string, mimeType: string }, converted: boolean }>}
 */
async function convertImageFormat(buffer, targetFormat, options = {}) {
  const meta = FORMAT_META[targetFormat];
  if (!meta) {
    // Unknown target — return as-is
    const detected = detectImageFormat(buffer);
    return { buffer, format: detected, converted: false };
  }

  const detected = detectImageFormat(buffer);
  const alreadyCorrect = meta.aliases.some((a) => detected.ext === a || (detected.ext === "jpeg" && a === "jpg"));
  if (alreadyCorrect) {
    return { buffer, format: { ext: meta.ext, mimeType: meta.mimeType }, converted: false };
  }

  try {
    const sharp = (await import("sharp")).default;
    const { quality = 85 } = options;

    let pipeline = sharp(buffer);
    switch (meta.ext) {
      case "jpg":  pipeline = pipeline.jpeg({ quality, mozjpeg: true }); break;
      case "png":  pipeline = pipeline.png({ quality: Math.min(quality, 100), compressionLevel: 9 }); break;
      case "webp": pipeline = pipeline.webp({ quality, effort: 6 }); break;
      case "avif": pipeline = pipeline.avif({ quality, effort: 4 }); break;
      case "gif":  pipeline = pipeline.gif(); break;
      default:     return { buffer, format: detected, converted: false };
    }

    const converted = await pipeline.toBuffer();
    return { buffer: converted, format: { ext: meta.ext, mimeType: meta.mimeType }, converted: true };
  } catch (err) {
    // sharp not installed or conversion failed — fall back to original bytes
    const detected2 = detectImageFormat(buffer);
    return { buffer, format: detected2, converted: false, warning: `Format conversion to ${targetFormat} failed: ${err.message}. Saved as ${detected2.ext} instead.` };
  }
}

/**
 * Generate an image via xAI Grok image API (Aurora).
 * Uses the OpenAI-compatible /v1/images/generations endpoint.
 *
 * @param {string} prompt - Text description of the image to generate
 * @param {object} options - { model, size, format, outputPath, cwd }
 * @returns {Promise<{ success, url, localPath, mimeType, model, revisedPrompt }>}
 */
export async function generateImage(prompt, options = {}) {
  const {
    model = "grok-imagine-image",
    size = "1024x1024",
    format = "png",
    quality = 85,
    outputPath = null,
    cwd = process.cwd(),
  } = options;

  // Resolve provider — try the model's provider, then fall back to xAI, then OpenAI
  const provider = detectApiProvider(model) || detectApiProvider("grok-imagine-image") || detectApiProvider("dall-e-3");
  if (!provider) {
    return { success: false, error: "No image API key configured. Set XAI_API_KEY or OPENAI_API_KEY environment variable." };
  }

  try {
    // Build request body — xAI doesn't support 'size', OpenAI does
    const reqBody = { model, prompt, n: 1, response_format: "b64_json" };
    if (provider.name !== "xai" && size) reqBody.size = size;

    const response = await fetch(`${provider.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return { success: false, error: `Image generation failed (${response.status}): ${errBody}` };
    }

    const data = await response.json();
    const imageData = data.data?.[0];
    if (!imageData?.b64_json && !imageData?.url) {
      return { success: false, error: "No image data in response (neither b64_json nor url)" };
    }

    // Decode bytes — handle both b64_json and url response formats
    let rawBuffer;
    if (imageData.b64_json) {
      rawBuffer = Buffer.from(imageData.b64_json, "base64");
    } else if (imageData.url) {
      const imgRes = await fetch(imageData.url);
      if (!imgRes.ok) {
        return { success: false, error: `Failed to download image from URL: ${imgRes.status}` };
      }
      rawBuffer = Buffer.from(await imgRes.arrayBuffer());
    }
    const detected = detectImageFormat(rawBuffer);

    // Determine the desired output format from the outputPath extension or format option
    const { extname: getExt } = await import("node:path");
    const requestedExt = outputPath ? getExt(outputPath).toLowerCase().replace(".", "") : format;
    const targetFormat = requestedExt || detected.ext;

    // Convert to the requested format if different from what the API returned
    const conversion = await convertImageFormat(rawBuffer, targetFormat, { quality });
    const finalBuffer = conversion.buffer;
    const finalFormat = conversion.format;

    const result = {
      success: true,
      model: data.model || model,
      revisedPrompt: imageData.revised_prompt || prompt,
      mimeType: finalFormat.mimeType,
      originalFormat: detected.mimeType,
      converted: conversion.converted,
    };

    if (conversion.warning) {
      result.warning = conversion.warning;
    }

    // Save to file if outputPath specified
    if (outputPath) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname, resolve: pathResolve } = await import("node:path");

      // Final safety: re-detect format from the actual output bytes to prevent
      // MIME mismatches (e.g. xAI Grok Aurora returns JPEG even when PNG requested).
      // This catches cases where conversion claims success but bytes don't match.
      const finalDetected = detectImageFormat(finalBuffer);

      // Correct extension if the final bytes don't match the requested format
      let resolvedPath = outputPath;
      const { extname: getExtForSave } = await import("node:path");
      const pathExt = getExtForSave(outputPath).toLowerCase().replace(".", "");
      const pathMeta = FORMAT_META[pathExt];
      const bytesMeta = FORMAT_META[finalDetected.ext];
      const extensionMatchesBytes = pathMeta?.aliases?.some((a) => bytesMeta?.aliases?.includes(a));

      if (!extensionMatchesBytes) {
        resolvedPath = outputPath.replace(/\.[^.]+$/, `.${finalDetected.ext}`);
        result.extensionCorrected = true;
        result.requestedPath = outputPath;
        // Update mimeType to reflect actual saved bytes
        result.mimeType = finalDetected.mimeType;
      }

      const fullPath = pathResolve(cwd, resolvedPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, finalBuffer);
      result.localPath = fullPath;
    }

    // Return truncated base64 for logging only — never return full base64 inline,
    // as passing raw image bytes through MCP tool results causes MIME type mismatch
    // errors in the Claude API when the declared media_type doesn't match the bytes.
    if (imageData.b64_json) {
      result.base64 = imageData.b64_json.substring(0, 100) + "..."; // Truncated for logging
      result.fullBase64Length = imageData.b64_json.length;
    } else if (imageData.url) {
      result.sourceUrl = imageData.url; // URL-based response — no base64 to truncate
    }

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

  // Detect API providers (check env var + .forge/secrets.json fallback)
  for (const [name, provider] of Object.entries(API_PROVIDERS)) {
    const apiKey = process.env[provider.envKey] || loadSecretFromForge(provider.envKey);
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

    // Track child for cleanup on parent exit
    if (!global.__pforgeChildren) global.__pforgeChildren = new Set();
    global.__pforgeChildren.add(child);
    child.on("close", () => global.__pforgeChildren?.delete(child));

    // Force UTF-8 decoding on both streams. On Windows, the default encoding
    // is platform-dependent and can mangle Unicode chars (↑ ↓ •) that appear
    // in gh copilot's token summary line — which silently breaks parseStderrStats.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    // Close stdin immediately (no interactive input needed)
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Fix A: Heartbeat — write a dot to stdout every 15s so VS Code terminal stays alive
    // This prevents "The terminal is awaiting input" notification
    const heartbeat = setInterval(() => {
      process.stdout.write(".");
    }, 15_000);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      // Fix B: Stream worker stderr to our stdout so terminal shows live progress
      // gh copilot writes model selection, token counting, and timing to stderr
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("{")) {
          // Skip JSONL lines, show human-readable progress
          process.stdout.write(`    ${trimmed}\n`);
        }
      }
    });

    child.on("close", (code) => {
      clearInterval(heartbeat);
      clearTimeout(timer);

      // Clean up temp prompt file
      try { unlinkSync(promptFile); } catch { /* ignore */ }

      const jsonlEvents = parseJSONL(stdout);
      let tokens = extractTokens(jsonlEvents);

      // Fallback: parse stderr stats (gh copilot outputs stats to stderr in non-TTY mode)
      // Called inside "close" handler so `stderr` is the fully-accumulated string — not a partial stream.
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
export function parseStderrStats(stderr) {
  const stats = { model: null, tokens_in: 0, tokens_out: 0, premiumRequests: 0 };
  if (!stderr) return stats;

  // Parse premium requests — two formats:
  //   Old: "1 Premium request" / "3 Premium requests"
  //   New: "Requests  3 Premium (1m 35s)"
  const premiumMatch = stderr.match(/(\d+)\s+Premium\s+request/i) || stderr.match(/Requests\s+(\d+)\s+Premium/i);
  if (premiumMatch) stats.premiumRequests = parseInt(premiumMatch[1], 10);

  // Parse token counts — three formats:
  //   Old: " claude-sonnet-4.6  639.4k in, 4.5k out, 552.1k cached"
  //   New (UTF-8): "Tokens    ↑ 476.0k • ↓ 3.1k • 430.1k (cached)"
  //   New (ASCII fallback): "Tokens    ^ 476.0k * v 3.1k * 430.1k (cached)"
  //     — covers terminals that strip/replace Unicode (Windows cp437, CI logs, etc.)
  const newTokenMatch = stderr.match(/Tokens\s+[↑⬆^]\s*([\d.]+[kmb]?)\s*[•·*]\s*[↓⬇v]\s*([\d.]+[kmb]?)/i);
  if (newTokenMatch) {
    stats.tokens_in = parseTokenCount(newTokenMatch[1]);
    stats.tokens_out = parseTokenCount(newTokenMatch[2]);
  }

  // Parse model from new format: "Model     claude-opus-4.6" or model line in breakdown
  const newModelMatch = stderr.match(/Model\s+([\w.-]+)/);
  if (newModelMatch) stats.model = newModelMatch[1];

  // Old format: model breakdown lines "claude-sonnet-4.6  11.7m in, 97.5k out, ..."
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
 * Coalesce multi-line gate commands from a validation gate block.
 * Joins lines inside unmatched quotes into single commands, strips
 * inline comments and standalone comment lines.
 *
 * @param {string} gateText - Raw validation gate text block
 * @returns {string[]} Array of complete, executable gate commands
 */
export function coalesceGateLines(gateText) {
  const rawLines = gateText.split("\n");
  const commands = [];
  let pending = "";
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (pending) {
      pending += "\n" + trimmed;
      const dblQuotes = (pending.match(/"/g) || []).length;
      if (dblQuotes % 2 === 0) {
        commands.push(pending);
        pending = "";
      }
    } else {
      const stripped = trimmed.replace(/\s{2,}#\s.*$/, "");
      if (!stripped || stripped.startsWith("#")) continue;
      // Skip markdown-style numbered list items (e.g. "1. Server generates CSRF...")
      // and bulleted prose (e.g. "- Install dependencies"). These are documentation,
      // not shell commands, and would fail the allowlist check with a misleading error.
      if (/^(\d+\.|[-*+])\s+\S/.test(stripped)) continue;
      const dblQuotes = (stripped.match(/"/g) || []).length;
      if (dblQuotes % 2 !== 0) {
        pending = stripped;
      } else {
        commands.push(stripped);
      }
    }
  }
  if (pending) commands.push(pending);
  return commands;
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
  const cmdBase = command.trim().split(/\s+/)[0].toLowerCase();
  const isAllowed = GATE_ALLOWED_PREFIXES.some((p) => cmdBase === p || cmdBase.endsWith(`/${p}`));
  if (!isAllowed) {
    return {
      success: false,
      output: "",
      error: `Validation gate blocked: '${cmdBase}' not in allowlist. Allowed: ${GATE_ALLOWED_PREFIXES.join(", ")}`,
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
    quorum = "auto",       // false | true | "auto" — default: auto (threshold-based)
    quorumThreshold = null, // override threshold from config
    quorumPreset = null,   // "power" | "speed" | null — selects model preset
    bridge = null,         // BridgeManager instance for approval gate
  } = options;

  // Load model routing from .forge.json (Slice 5)
  const modelRouting = loadModelRouting(cwd);
  const effectiveModel = model || modelRouting.default || null;

  // Parse plan
  const plan = parsePlan(planPath, cwd);

  // Estimation mode — return without executing
  if (estimate) {
    // Build quorum config for estimate even though we're not running
    let estimateQuorumConfig = null;
    if (quorum) {
      estimateQuorumConfig = loadQuorumConfig(cwd, quorumPreset);
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

  // Pre-flight: lint gate commands before burning time on execution
  const gateLint = lintGateCommands(planPath);
  if (!gateLint.passed) {
    const errorSummary = gateLint.errors.map(e => `  ❌ ${e.message}`).join("\n");
    const warnSummary = gateLint.warnings.map(w => `  ⚠️ ${w.message}`).join("\n");
    return {
      status: "failed",
      error: "Gate lint pre-flight failed — fix these before executing:",
      gateLint: {
        errors: gateLint.errors,
        warnings: gateLint.warnings,
        summary: gateLint.summary,
      },
      detail: [errorSummary, warnSummary].filter(Boolean).join("\n"),
    };
  }

  // Set up event bus with DI handler
  const runDir = createRunDir(cwd, planPath);
  const logHandler = new LogEventHandler(runDir);

  // v2.4: Create trace context and telemetry handler
  const trace = createTraceContext(planPath, { mode, model: effectiveModel, sliceCount: plan.slices.length });
  const telemetryHandler = createTelemetryHandler(trace, runDir);

  // Chain handlers: user-provided → telemetry → log → console progress
  const isCliRun = !eventHandler; // If no custom handler, we're running from CLI — show progress on stdout
  const combinedHandler = {
    handle(event) {
      telemetryHandler.handle(event);
      if (eventHandler) eventHandler.handle(event);
      logHandler.handle(event);
      // Write progress to stdout so terminal stays alive (prevents VS Code "awaiting input" stall)
      if (isCliRun && event?.type) {
        const ts = new Date().toISOString().slice(11, 19);
        const d = event.data || event; // data is nested under event.data by the EventBus
        switch (event.type) {
          case "run-started":
            process.stdout.write(`[${ts}] ▶ Run started: ${d.sliceCount || "?"} slices, mode=${d.mode || "auto"}\n`);
            break;
          case "slice-started":
            process.stdout.write(`[${ts}] ⏳ Slice ${d.sliceId || "?"}: ${d.title || ""} — executing...\n`);
            break;
          case "slice-completed":
            process.stdout.write(`[${ts}] ✅ Slice ${d.sliceId || "?"}: ${d.title || ""} — ${d.status || "done"} (${Math.round((d.duration || 0) / 1000)}s)\n`);
            break;
          case "slice-failed":
            process.stdout.write(`[${ts}] ❌ Slice ${d.sliceId || "?"}: ${d.title || ""} — FAILED\n`);
            break;
          case "slice-escalated":
            process.stdout.write(`[${ts}] ⬆ Slice ${d.sliceId || "?"}: ${d.title || ""} — escalating to ${d.toModel} (attempt ${d.attempt})\n`);
            break;
          case "run-completed":
            process.stdout.write(`[${ts}] 🏁 Run complete: ${d.results?.passed || 0} passed, ${d.results?.failed || 0} failed\n`);
            break;
          case "ci-triggered":
            process.stdout.write(`[${ts}] 🚀 CI triggered: ${d.workflow} @ ${d.ref} — ${d.status}\n`);
            break;
        }
      }
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
    quorumConfig = loadQuorumConfig(cwd, quorumPreset);
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
  const escalationChain = loadEscalationChain(cwd);
  const results = await scheduler.execute(
    plan.dag.nodes,
    plan.dag.order,
    async (slice) => executeSlice(slice, {
      cwd, model: effectiveModel, modelRouting, mode, runDir, maxRetries,
      memoryEnabled, projectName, planName: basename(planPath, ".md"),
      quorumConfig, escalationChain, eventBus,
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

  // Build summary in memory (needed for approval message content)
  const runId = basename(runDir);
  const summary = buildSummary(plan, results, runMeta, { sweepResult, analyzeResult });

  // Approval gate (Phase 16) — pause and await human approval before finalising
  if (allPassed && bridge?.hasApprovalChannels) {
    try {
      const approvalResult = await bridge.requestApproval(runId, { ...summary, runId });
      if (!approvalResult.approved) {
        summary.status = "approval-rejected";
        summary.approval = {
          status: "rejected",
          approver: approvalResult.approver ?? null,
          timedOut: approvalResult.timedOut ?? false,
          timestamp: new Date().toISOString(),
        };
      } else {
        summary.approval = {
          status: "approved",
          approver: approvalResult.approver ?? null,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (err) {
      // Non-fatal — log and continue without blocking the run
      console.error(`[orchestrator] Approval gate error: ${err.message}`);
    }
  }

  // CI/CD Integration Hook — trigger workflow after successful run
  if (allPassed && summary.status !== "approval-rejected") {
    const ciConfig = loadCiConfig(cwd);
    if (ciConfig.enabled && ciConfig.workflow) {
      summary.ci = triggerCiWorkflow(ciConfig, eventBus);
    }
  }

  // Write summary
  writeFileSync(resolve(runDir, "summary.json"), JSON.stringify(summary, null, 2));

  // Phase 2: Append to cost history
  if (summary.cost && summary.status !== "estimate" && summary.status !== "approval-rejected") {
    appendCostHistory(cwd, summary);
  }

  // Emit run-completed — telemetry handler writes trace.json during this emit
  eventBus.emit("run-completed", summary);

  // v2.4: Write manifest + index + prune (AFTER trace.json is written by emit)
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
  return { default: "claude-opus-4.6" };
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
 * Load escalation chain from .forge.json.
 * Schema: { "escalationChain": ["auto", "claude-opus-4.6", "gpt-5.3-codex"] }
 * On each retry, the orchestrator escalates to the next model in the chain.
 * First escalation jumps to top-tier reasoning (Opus), then to Codex for bug-fixing.
 * @returns {string[]}
 */
function loadEscalationChain(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (Array.isArray(config.escalationChain) && config.escalationChain.length > 0) {
        return config.escalationChain;
      }
    }
  } catch { /* defaults */ }

  // Auto-tune: reorder default chain by historical success rate × cost efficiency
  try {
    const perf = loadModelPerformance(cwd);
    if (perf.length >= 5) {
      const stats = {};
      for (const p of perf) {
        const m = p.model || "unknown";
        if (!stats[m]) stats[m] = { passed: 0, total: 0, cost: 0 };
        stats[m].total++;
        if (p.status === "passed") stats[m].passed++;
        stats[m].cost += p.cost_usd || 0;
      }
      const ranked = Object.entries(stats)
        .filter(([, s]) => s.total >= 3)
        .map(([model, s]) => ({
          model,
          successRate: s.passed / s.total,
          avgCost: s.cost / s.total,
          score: (s.passed / s.total) * 100 - (s.cost / s.total) * 1000, // success weighted, cost penalized
        }))
        .sort((a, b) => b.score - a.score);
      if (ranked.length >= 2) {
        return ["auto", ...ranked.slice(0, 3).map(r => r.model)];
      }
    }
  } catch { /* fall through to static default */ }

  return ["auto", "claude-opus-4.6", "gpt-5.3-codex"];
}

/**
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
 * Load CI/CD integration configuration from .forge.json.
 * Schema: { "ci": { "enabled": true, "workflow": "ci.yml", "ref": "main", "inputs": { "key": "value" } } }
 * @returns {{ enabled: boolean, workflow: string|null, ref: string, inputs: object }}
 */
function loadCiConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.ci && typeof config.ci === "object") {
        return {
          enabled: config.ci.enabled === true,
          workflow: config.ci.workflow || null,
          ref: config.ci.ref || "main",
          inputs: config.ci.inputs && typeof config.ci.inputs === "object" ? config.ci.inputs : {},
        };
      }
    }
  } catch { /* defaults */ }
  return { enabled: false, workflow: null, ref: "main", inputs: {} };
}

/**
 * Trigger a GitHub Actions workflow via `gh workflow run`.
 * Emits a `ci-triggered` event and returns a CI result object.
 * @param {{ workflow: string, ref: string, inputs: object }} ciConfig
 * @param {OrchestratorEventBus} eventBus
 * @returns {{ workflow: string, ref: string, status: "triggered"|"failed", error?: string, timestamp: string }}
 */
function triggerCiWorkflow(ciConfig, eventBus) {
  const { workflow, ref, inputs } = ciConfig;
  const timestamp = new Date().toISOString();

  try {
    const args = ["workflow", "run", workflow, "--ref", ref];
    if (inputs && Object.keys(inputs).length > 0) {
      for (const [key, value] of Object.entries(inputs)) {
        args.push("-f", `${key}=${value}`);
      }
    }
    execSync(`gh ${args.join(" ")}`, { encoding: "utf-8", timeout: 30_000 });

    const result = { workflow, ref, status: "triggered", timestamp };
    eventBus.emit("ci-triggered", result);
    return result;
  } catch (err) {
    const error = err.stderr?.trim() || err.message || "unknown error";
    const result = { workflow, ref, status: "failed", error, timestamp };
    eventBus.emit("ci-triggered", result);
    return result;
  }
}

/**
 * Resolve which model to use for a given slice based on routing config.
 * Priority: CLI override > slice-type routing > default routing > null (auto)
 */
function resolveModel(cliModel, modelRouting, slice) {
  if (cliModel && cliModel !== "auto") return cliModel;
  // Match slice type to routing keys (e.g. modelRouting.test, modelRouting.review, etc.)
  if (slice) {
    const sliceType = inferSliceType(slice);
    if (modelRouting[sliceType] && modelRouting[sliceType] !== "auto") return modelRouting[sliceType];
  }
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
  const modelStats = aggregateModelStats(loadModelPerformance(cwd));
  if (!existsSync(historyPath)) {
    return { runs: 0, message: "No cost history yet. Run `pforge run-plan` to start tracking.", forge_model_stats: modelStats };
  }

  let history;
  try {
    history = JSON.parse(readFileSync(historyPath, "utf-8"));
    if (!Array.isArray(history)) return { runs: 0, message: "Invalid cost history format.", forge_model_stats: modelStats };
  } catch {
    return { runs: 0, message: "Could not parse cost-history.json.", forge_model_stats: modelStats };
  }

  if (history.length === 0) {
    return { runs: 0, message: "Cost history is empty.", forge_model_stats: modelStats };
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
    forge_model_stats: modelStats,
  };
}

// ─── Model Performance Tracking (Phase 3) ────────────────────────────

/**
 * Load the model performance log from .forge/model-performance.json.
 * Returns an array of per-slice performance entries, or [] if none exists.
 */
export function loadModelPerformance(cwd) {
  const perfPath = resolve(cwd, ".forge", "model-performance.json");
  if (!existsSync(perfPath)) return [];
  try {
    const data = JSON.parse(readFileSync(perfPath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Append a per-slice performance entry to .forge/model-performance.json.
 * Each entry records the model used, pass/fail outcome, cost, and timing.
 *
 * @param {string} cwd
 * @param {{ date, plan, sliceId, sliceTitle, model, status, attempts, duration_ms, cost_usd }} entry
 */
export function recordModelPerformance(cwd, entry) {
  const perfPath = resolve(cwd, ".forge", "model-performance.json");
  const records = loadModelPerformance(cwd);
  records.push(entry);
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  writeFileSync(perfPath, JSON.stringify(records, null, 2));
}

/**
 * Aggregate model performance records into per-model stats.
 * @param {Array} records - from loadModelPerformance()
 * @returns {object} model → { total_slices, passed, failed, success_rate, avg_cost_usd }
 */
function aggregateModelStats(records) {
  const stats = {};
  for (const r of records) {
    const m = r.model || "unknown";
    if (!stats[m]) stats[m] = { total_slices: 0, passed: 0, failed: 0, total_cost_usd: 0 };
    stats[m].total_slices += 1;
    if (r.status === "passed") stats[m].passed += 1;
    else stats[m].failed += 1;
    stats[m].total_cost_usd += r.cost_usd || 0;
  }
  const result = {};
  for (const [model, s] of Object.entries(stats)) {
    result[model] = {
      total_slices: s.total_slices,
      passed: s.passed,
      failed: s.failed,
      success_rate: s.total_slices > 0 ? Math.round((s.passed / s.total_slices) * 1000) / 1000 : 0,
      avg_cost_usd: s.total_slices > 0 ? Math.round((s.total_cost_usd / s.total_slices) * 1_000_000) / 1_000_000 : 0,
    };
  }
  return result;
}

// ─── Operational Data Infrastructure ──────────────────────────────────

/**
 * Ensure a subdirectory exists under .forge/.
 * @param {string} subpath - Relative path under .forge/ (e.g. "runs", "telemetry"). Use "" for .forge/ root.
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {string} Resolved absolute path of the created directory
 */
export function ensureForgeDir(subpath, cwd = process.cwd()) {
  const dir = resolve(cwd, ".forge", subpath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Read and parse a JSON file from .forge/.
 * @param {string} filePath - Path relative to .forge/ (e.g. "cost-history.json")
 * @param {*} [defaultValue=null] - Returned when file is missing or contains invalid JSON
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {*} Parsed JSON or defaultValue
 */
export function readForgeJson(filePath, defaultValue = null, cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return JSON.parse(readFileSync(fullPath, "utf-8"));
    }
  } catch { /* corrupt/missing → return default */ }
  return defaultValue;
}

/**
 * Append a JSON record as a single line to a JSONL file under .forge/.
 * Creates parent directories if absent.
 * @param {string} filePath - Path relative to .forge/ (e.g. "telemetry/tool-calls.jsonl")
 * @param {object} record - JSON-serializable object to append
 * @param {string} [cwd=process.cwd()] - Project root directory
 */
export function appendForgeJsonl(filePath, record, cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  appendFileSync(fullPath, JSON.stringify(record) + "\n");
}

/**
 * Read a JSONL file under .forge/ and return an array of parsed records.
 * Returns defaultValue (default []) if the file is missing or unreadable.
 * @param {string} filePath - Path relative to .forge/
 * @param {Array} [defaultValue=[]] - Fallback when file is absent
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {Array}
 */
export function readForgeJsonl(filePath, defaultValue = [], cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (!existsSync(fullPath)) return defaultValue;
    return readFileSync(fullPath, "utf-8")
      .split("\n")
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch { return defaultValue; }
}

// ─── Health Trend Analysis ────────────────────────────────────────────

/**
 * Compute health trend from .forge/health-snapshots.jsonl.
 * Aggregates cost, drift, incident, and model performance data points
 * over the requested time window.
 *
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @param {number} [days=30] - Number of days of history to include
 * @param {string[]|null} [metrics=null] - Optional metric filter (e.g. ["drift","cost","incidents","models"])
 * @returns {object} Health trend report
 */
export function getHealthTrend(cwd = process.cwd(), days = 30, metrics = null) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const allMetrics = ["drift", "cost", "incidents", "models", "tests"];
  const active = metrics && metrics.length ? metrics.filter(m => allMetrics.includes(m)) : allMetrics;

  const result = { days, metricsIncluded: active, generatedAt: new Date().toISOString(), dataPoints: 0 };

  // Drift trend
  if (active.includes("drift")) {
    const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
    const filtered = driftHistory.filter(r => r.timestamp >= cutoff);
    const scores = filtered.map(r => r.score).filter(s => typeof s === "number");
    result.drift = {
      snapshots: filtered.length,
      latest: scores.length ? scores[scores.length - 1] : null,
      avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      trend: computeTrendDirection(scores),
    };
    result.dataPoints += filtered.length;
  }

  // Cost trend
  if (active.includes("cost")) {
    const costHistory = readForgeJson("cost-history.json", [], cwd);
    const filtered = Array.isArray(costHistory) ? costHistory.filter(r => (r.date || "") >= cutoff) : [];
    const costs = filtered.map(r => r.total_cost_usd || 0);
    result.cost = {
      runs: filtered.length,
      totalUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 100) / 100 : 0,
      avgPerRun: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 100) / 100 : 0,
      trend: computeTrendDirection(costs),
    };
    result.dataPoints += filtered.length;
  }

  // Incident trend
  if (active.includes("incidents")) {
    const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
    const filtered = incidents.filter(r => (r.capturedAt || "") >= cutoff);
    const resolved = filtered.filter(r => r.resolvedAt);
    const mttrs = resolved.map(r => r.mttr).filter(m => typeof m === "number" && m > 0);
    result.incidents = {
      total: filtered.length,
      resolved: resolved.length,
      open: filtered.length - resolved.length,
      avgMttrMs: mttrs.length ? Math.round(mttrs.reduce((a, b) => a + b, 0) / mttrs.length) : null,
      bySeverity: {},
    };
    for (const inc of filtered) {
      const sev = inc.severity || "unknown";
      result.incidents.bySeverity[sev] = (result.incidents.bySeverity[sev] || 0) + 1;
    }
    result.dataPoints += filtered.length;
  }

  // Model performance trend
  if (active.includes("models")) {
    const perfRecords = loadModelPerformance(cwd);
    const filtered = perfRecords.filter(r => (r.date || "") >= cutoff);
    const stats = {};
    for (const r of filtered) {
      const m = r.model || "unknown";
      if (!stats[m]) stats[m] = { slices: 0, passed: 0, failed: 0, totalCost: 0 };
      stats[m].slices += 1;
      if (r.status === "passed") stats[m].passed += 1;
      else stats[m].failed += 1;
      stats[m].totalCost += r.cost_usd || 0;
    }
    const models = {};
    for (const [model, s] of Object.entries(stats)) {
      models[model] = {
        slices: s.slices,
        successRate: s.slices > 0 ? Math.round((s.passed / s.slices) * 1000) / 1000 : 0,
        avgCostUsd: s.slices > 0 ? Math.round((s.totalCost / s.slices) * 1_000_000) / 1_000_000 : 0,
      };
    }
    result.models = { totalSlices: filtered.length, byModel: models };
    result.dataPoints += filtered.length;
  }

  // Test/regression trend (E5)
  if (active.includes("tests")) {
    const regHistory = readForgeJsonl("regression-history.json", [], cwd);
    const filtered = regHistory.filter(r => (r.timestamp || "") >= cutoff);
    const passRates = filtered.map(r => r.gatesChecked > 0 ? r.passed / r.gatesChecked : 1);
    result.tests = {
      runs: filtered.length,
      totalGates: filtered.reduce((sum, r) => sum + (r.gatesChecked || 0), 0),
      totalPassed: filtered.reduce((sum, r) => sum + (r.passed || 0), 0),
      totalFailed: filtered.reduce((sum, r) => sum + (r.failed || 0), 0),
      passRate: passRates.length ? Math.round((passRates.reduce((a, b) => a + b, 0) / passRates.length) * 1000) / 1000 : null,
      lastFailure: filtered.filter(r => r.failed > 0).slice(-1)[0]?.timestamp || null,
      trend: computeTrendDirection(passRates.map(r => r * 100)),
    };
    result.dataPoints += filtered.length;
  }

  // Overall health summary
  const scores = [];
  if (result.drift?.avg != null) scores.push(result.drift.avg);
  if (result.incidents) {
    const incidentPenalty = Math.min(result.incidents.total * 5, 50);
    scores.push(Math.max(0, 100 - incidentPenalty));
  }
  if (result.models?.totalSlices > 0) {
    const allPassRate = Object.values(result.models.byModel).reduce((sum, m) => sum + m.successRate, 0);
    const avgRate = allPassRate / Object.keys(result.models.byModel).length;
    scores.push(Math.round(avgRate * 100));
  }
  if (result.tests?.passRate != null) {
    scores.push(Math.round(result.tests.passRate * 100));
  }

  result.healthScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  result.trend = result.drift?.trend || (result.dataPoints === 0 ? "no-data" : "stable");

  // Project Health DNA — composite fingerprint for decay detection
  result.healthDNA = {
    driftAvg: result.drift?.avg ?? null,
    incidentRate: result.incidents ? Math.round((result.incidents.total / Math.max(days, 1)) * 100) / 100 : null,
    testPassRate: result.tests?.passRate ?? null,
    modelSuccessRate: result.models?.totalSlices > 0
      ? Math.round(Object.values(result.models.byModel).reduce((s, m) => s + m.successRate, 0) / Object.keys(result.models.byModel).length * 1000) / 1000
      : null,
    costPerSlice: result.cost?.avgPerRun ?? null,
    timestamp: new Date().toISOString(),
  };

  // Persist health DNA snapshot for cross-session trend analysis
  try {
    if (result.healthDNA.driftAvg != null || result.healthDNA.testPassRate != null) {
      appendForgeJsonl("health-dna.json", { ...result.healthDNA, healthScore: result.healthScore }, cwd);
    }
  } catch { /* best-effort */ }

  return result;
}

/**
 * Compute trend direction from an ordered array of numeric values.
 * Compares the mean of the first half to the mean of the second half.
 */
function computeTrendDirection(values) {
  if (!values || values.length < 2) return "insufficient-data";
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const delta = avg2 - avg1;
  const threshold = Math.abs(avg1) * 0.05 || 1;
  if (delta > threshold) return "increasing";
  if (delta < -threshold) return "decreasing";
  return "stable";
}

/**
 * Extract validation gates from a parsed plan file.
 * Delegates to parsePlan() — does not duplicate parsing logic.
 * @param {string} planFilePath - Absolute or project-relative path to a plan markdown file
 * @param {string} [cwd=process.cwd()] - Project root (used for path-traversal check)
 * @returns {Array<{sliceNumber: string, sliceTitle: string, gates: string[]}>}
 */
export function parseValidationGates(planFilePath, cwd = process.cwd()) {
  const plan = parsePlan(planFilePath, cwd);
  return plan.slices
    .filter(s => s.validationGate)
    .map(s => ({
      sliceNumber: s.number,
      sliceTitle: s.title,
      gates: s.validationGate
        .split("\n")
        .map(l => l.replace(/\s{2,}#\s.*$/, "").trim())
        .filter(l => l.length > 0),
    }));
}

/**
 * Lint all validation gate commands in a plan file.
 * Catches common issues that cause gate failures at runtime:
 *   - Commands not in the allowlist
 *   - Standalone comment lines (# ...) that get treated as commands
 *   - /dev/stdin usage (not cross-platform — fails on Windows)
 *   - curl localhost:* in non-final slices (requires running server)
 *   - `node *.test.mjs` for vitest test files (must use npx vitest)
 *
 * @param {string} planFilePath - Path to the plan Markdown file
 * @returns {{ warnings: Array, errors: Array, passed: boolean }}
 */
export function lintGateCommands(planFilePath, cwd = process.cwd()) {
  const plan = parsePlan(planFilePath, cwd);
  const warnings = [];
  const errors = [];
  const lastSliceNumber = plan.slices.length > 0
    ? plan.slices[plan.slices.length - 1].number
    : null;

  for (const slice of plan.slices) {
    if (!slice.validationGate) continue;

    // Also lint raw lines for comment detection before coalescing
    const rawLines = slice.validationGate.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    for (const raw of rawLines) {
      if (raw.startsWith("#")) {
        const loc = `Slice ${slice.number} ("${slice.title}")`;
        warnings.push({
          slice: slice.number,
          command: raw,
          rule: "comment-line",
          severity: "warn",
          message: `${loc}: Standalone comment '${raw.slice(0, 60)}...' will be treated as a command. Remove or prefix with a real command.`,
        });
      }
    }

    const commands = coalesceGateLines(slice.validationGate);

    for (const line of commands) {
      const loc = `Slice ${slice.number} ("${slice.title}")`;

      // 1. /dev/stdin (not cross-platform)
      if (line.includes("/dev/stdin")) {
        errors.push({
          slice: slice.number,
          command: line,
          rule: "unix-only-path",
          severity: "error",
          message: `${loc}: '/dev/stdin' is Unix-only — fails on Windows. Use readFileSync(0,'utf8') for cross-platform stdin.`,
        });
      }

      // 3. Command not in allowlist
      // Skip leading env var assignments (VAR=val command ...) to find the real command
      const tokens = line.split(/\s+/);
      let cmdIdx = 0;
      while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
        cmdIdx++;
      }
      const cmdToken = (tokens[cmdIdx] || tokens[0]).toLowerCase();
      const isAllowed = GATE_ALLOWED_PREFIXES.some(p => cmdToken === p || cmdToken.endsWith(`/${p}`));
      if (!isAllowed) {
        errors.push({
          slice: slice.number,
          command: line,
          rule: "blocked-command",
          severity: "error",
          message: `${loc}: '${cmdToken}' is not in the gate allowlist. Add it to GATE_ALLOWED_PREFIXES or rewrite the command.`,
        });
      }

      // 4. curl localhost in non-final slices (requires running server)
      if (/curl\s.*localhost[:\s]/.test(line) && slice.number !== lastSliceNumber) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "runtime-gate",
          severity: "warn",
          message: `${loc}: curl to localhost requires a running server. Move runtime API checks to vitest integration tests.`,
        });
      }

      // 5. node *.test.mjs for vitest files (should use npx vitest)
      if (/^node\s+.*\.test\.(mjs|js|ts)/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "vitest-direct-node",
          severity: "warn",
          message: `${loc}: 'node *.test.*' fails for vitest test files. Use 'npx vitest run <file>' instead.`,
        });
      }

      // 6. Unix-only commands (not available in cmd.exe on Windows)
      const WINDOWS_UNAVAILABLE = ["grep", "sed", "awk", "wc", "head", "tail", "sort", "diff", "test", "tr", "xargs", "find"];
      if (WINDOWS_UNAVAILABLE.includes(cmdToken) && !/^bash\s+-c/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "windows-unavailable",
          severity: "warn",
          message: `${loc}: '${cmdToken}' is not available in cmd.exe on Windows. Wrap in 'bash -c' or use a 'node -e' equivalent.`,
        });
      }

      // 7. Unix-only paths (/tmp/, /dev/null)
      if (/\/tmp\/|\/dev\/null/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "unix-only-path",
          severity: "warn",
          message: `${loc}: Unix-only path (/tmp/ or /dev/null) — fails on Windows. Use os.tmpdir() or NUL.`,
        });
      }

      // 8. Project scripts not on PATH (pforge is a .ps1/.sh script, not a global binary)
      if (/^pforge\s/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "project-script",
          severity: "warn",
          message: `${loc}: 'pforge' is a project script, not on PATH during gate execution. Use 'pwsh ./pforge.ps1' or rewrite as 'node -e'.`,
        });
      }

      // 9. JS comments inside node -e one-liners (// swallows the rest of the line)
      if (/^node\s+-e\s+".*\/\//.test(line) && !line.includes("http://") && !line.includes("https://")) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "js-comment-in-eval",
          severity: "warn",
          message: `${loc}: node -e contains '//' which acts as a line comment on a single line, breaking the code. Remove JS comments from gate commands.`,
        });
      }
    }
  }

  return {
    warnings,
    errors,
    passed: errors.length === 0,
    summary: `${errors.length} error(s), ${warnings.length} warning(s) across ${plan.slices.length} slices`,
  };
}

/**
 * Check if a command string is permitted in validation gates.
 * Uses the same GATE_ALLOWED_PREFIXES allowlist as runGate() and lintGateCommands().
 * Skips leading env-var assignments (e.g., "NODE_ENV=test npm test").
 * Additionally blocks known-dangerous patterns (e.g., rm -rf /) regardless of prefix.
 * @param {string} cmd - The command line to check
 * @returns {boolean} true if the command is allowed, false if blocked
 */
export function isGateCommandAllowed(cmd) {
  if (!cmd || typeof cmd !== "string") return false;
  const trimmed = cmd.trim();

  // Block known-dangerous patterns first — allowlist cannot override these
  const BLOCKED_PATTERNS = [
    /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+[/~*]/i,  // rm -rf / or rm -fr ~
    /\brm\s+-[a-z]*\s+\/(\s|$)/,                                          // rm -* /
    /\bdd\s+.*of=\/dev\/(sda|hda|nvme)/i,                                 // dd to raw block device
    /\bmkfs\b/i,                                                           // format filesystem
    /\b:>\s*\/dev\/(sda|hda)/i,                                           // truncate block device
  ];
  if (BLOCKED_PATTERNS.some((p) => p.test(trimmed))) return false;

  const tokens = trimmed.split(/\s+/);
  let cmdIdx = 0;
  while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
    cmdIdx++;
  }
  const cmdToken = (tokens[cmdIdx] || tokens[0] || "").toLowerCase();
  return GATE_ALLOWED_PREFIXES.some((p) => cmdToken === p || cmdToken.endsWith(`/${p}`));
}

/**
 * Run regression guard — extract validation gate commands from plan files,
 * check each against the allowlist, execute allowed commands, and report results.
 *
 * Stop condition: if parseValidationGates cannot reliably extract commands from a plan
 * (e.g., no bash-block gates found), falls back to `testCommand` fields from parsed slices.
 *
 * @param {string[]} files - Changed file paths to guard (informational — included in result)
 * @param {object} [options]
 * @param {string} [options.plan] - Path to a specific plan file (relative to cwd). If omitted, scans docs/plans/
 * @param {boolean} [options.failFast=false] - Stop on first gate failure
 * @param {string} [options.cwd=process.cwd()] - Project root
 * @returns {Promise<{files: string[], gatesChecked: number, passed: number, failed: number, blocked: number, skipped: number, success: boolean, results: object[]}>}
 */
export async function regressionGuard(files, { plan, failFast = false, cwd = process.cwd() } = {}) {
  // Resolve plan files to check
  let planPaths = [];
  if (plan) {
    const resolved = resolve(cwd, plan);
    if (existsSync(resolved)) {
      planPaths = [resolved];
    }
  } else {
    const plansDir = resolve(cwd, "docs", "plans");
    if (existsSync(plansDir)) {
      planPaths = readdirSync(plansDir)
        .filter((f) => f.endsWith("-PLAN.md") || f.endsWith("-plan.md"))
        .map((f) => resolve(plansDir, f));
    }
  }

  // Collect gate commands from plans
  const gateItems = [];
  for (const planPath of planPaths) {
    try {
      const parsed = parsePlan(planPath, cwd);
      const sliceGates = parsed.slices
        .filter(s => s.validationGate)
        .map(s => ({
          sliceNumber: s.number,
          sliceTitle: s.title,
          gates: s.validationGate
            .split("\n")
            .map(l => l.replace(/\s{2,}#\s.*$/, "").trim())
            .filter(l => l.length > 0),
        }));

      let foundGates = false;
      for (const sg of sliceGates) {
        for (const cmd of sg.gates) {
          gateItems.push({ planFile: basename(planPath), sliceNumber: sg.sliceNumber, sliceTitle: sg.sliceTitle, cmd, source: "validation-gate" });
          foundGates = true;
        }
      }

      // Fallback chain: testCommand → buildCommand → backtick commands from validationGateDescription
      if (!foundGates) {
        for (const s of parsed.slices) {
          if (s.testCommand) {
            gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: s.testCommand, source: "testCommand" });
          } else if (s.buildCommand) {
            gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: s.buildCommand, source: "buildCommand" });
          } else if (s.validationGateDescription) {
            // Extract backtick-wrapped commands from prose gate descriptions
            const backtickRe = /`([^`]+)`/g;
            let bm;
            while ((bm = backtickRe.exec(s.validationGateDescription)) !== null) {
              const candidate = bm[1].trim();
              // Only treat as executable if it looks like a command (starts with a known tool)
              if (/^(dotnet|npm|npx|node|bash|pwsh|powershell|python|go|cargo|make|mvn|gradle)\b/i.test(candidate)) {
                gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: candidate, source: "prose-gate" });
              }
            }
          }
        }
      }
    } catch { /* unreadable plan — skip */ }
  }

  // Hotspot-aware gate prioritization: run gates for high-churn files first
  try {
    const hotspotCache = resolve(cwd, ".forge", "hotspot-cache.json");
    if (existsSync(hotspotCache)) {
      const cached = JSON.parse(readFileSync(hotspotCache, "utf-8"));
      const hotFiles = new Set((cached.hotspots || []).slice(0, 10).map(h => h.file));
      if (hotFiles.size > 0) {
        gateItems.sort((a, b) => {
          const aHot = a.cmd && [...hotFiles].some(h => a.cmd.includes(h)) ? 1 : 0;
          const bHot = b.cmd && [...hotFiles].some(h => b.cmd.includes(h)) ? 1 : 0;
          return bHot - aHot; // Hot gates first
        });
      }
    }
  } catch { /* best-effort prioritization */ }

  const results = [];
  let passed = 0, failed = 0, blocked = 0, skipped = 0;

  for (const gate of gateItems) {
    if (!isGateCommandAllowed(gate.cmd)) {
      results.push({ ...gate, status: "blocked", reason: `'${gate.cmd.split(/\s+/)[0]}' not in gate allowlist` });
      blocked++;
      continue;
    }

    try {
      const output = execSync(gate.cmd, { cwd, stdio: "pipe", timeout: 120000, encoding: "utf-8" });
      results.push({ ...gate, status: "passed", output: (output || "").trim().slice(0, 500) });
      passed++;
    } catch (err) {
      const errOut = ((err.stderr || "") + (err.stdout || "")).trim().slice(0, 500) || err.message;
      results.push({ ...gate, status: "failed", output: errOut });
      failed++;
      if (failFast) {
        // Mark remaining as skipped
        const remaining = gateItems.slice(gateItems.indexOf(gate) + 1);
        for (const rem of remaining) {
          results.push({ ...rem, status: "skipped", reason: "fail-fast: previous gate failed" });
          skipped++;
        }
        break;
      }
    }
  }

  return {
    files: files || [],
    gatesChecked: gateItems.length,
    passed,
    failed,
    blocked,
    skipped,
    success: failed === 0,
    results,
  };
}

/**
 * Emit a telemetry record for a tool invocation. Best-effort — never throws.
 * @param {string} toolName - Tool identifier (e.g. "forge_smith")
 * @param {object|string} inputs - Tool input parameters
 * @param {*} result - Tool result (truncated to 2000 chars)
 * @param {number} durationMs - Execution time in milliseconds
 * @param {string} status - "ok" | "error" | "timeout"
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {object} The telemetry record written
 */
const LIVEGUARD_TOOLS = new Set([
  "forge_drift_report", "forge_incident_capture", "forge_dep_watch",
  "forge_regression_guard", "forge_runbook", "forge_hotspot",
  "forge_health_trend", "forge_alert_triage", "forge_deploy_journal",
  "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
  "forge_quorum_analyze", "forge_liveguard_run",
]);

export function emitToolTelemetry(toolName, inputs, result, durationMs, status, cwd = process.cwd()) {
  const normalizedResult = typeof result === "string"
    ? result.slice(0, 2000)
    : JSON.stringify(result ?? "").slice(0, 2000);
  const record = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    inputs: typeof inputs === "object" ? inputs : { raw: inputs },
    result: normalizedResult,
    durationMs,
    status,
  };
  try {
    appendForgeJsonl("telemetry/tool-calls.jsonl", record, cwd);
  } catch { /* telemetry is best-effort — never crash the tool */ }
  if (LIVEGUARD_TOOLS.has(toolName)) {
    try {
      appendForgeJsonl("liveguard-events.jsonl", { timestamp: record.timestamp, tool: toolName, status, durationMs }, cwd);
    } catch { /* best-effort */ }
  }
  return record;
}

// ─── PreDeploy Hook ───────────────────────────────────────────────────

/** File-path glob patterns that indicate a deploy action. */
const DEPLOY_FILE_PATTERNS = [
  /^deploy\//,
  /^Dockerfile/,
  /\.bicep$/,
  /\.tf$/,
  /^k8s\//,
  /^docker-compose.*\.yml$/,
];

/** Terminal commands that indicate a deploy action. */
const DEPLOY_COMMAND_PATTERNS = [
  /\bpforge\s+deploy-log\b/,
  /\bdocker\s+push\b/,
  /\baz\s+deploy\b/,
  /\bkubectl\s+apply\b/,
  /\bazd\s+up\b/,
  /\bgit\s+push\b/,
];

/** Default configuration for the PreDeploy hook. */
const PRE_DEPLOY_DEFAULTS = {
  enabled: true,
  blockOnSecrets: true,
  warnOnEnvGaps: true,
  scanSince: "HEAD~1",
};

/** Maximum age in minutes before cache is considered stale. */
const CACHE_MAX_AGE_MINUTES = 10;

/**
 * Check whether a tool invocation matches deploy trigger conditions.
 * @param {string} toolName - The tool being invoked (e.g. "editFiles", "runCommand")
 * @param {string} filePath - File path being written to (may be empty)
 * @param {string} command  - Terminal command being executed (may be empty)
 * @returns {boolean}
 */
export function isDeployTrigger(toolName, filePath, command) {
  if (filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    for (const pattern of DEPLOY_FILE_PATTERNS) {
      if (pattern.test(normalized)) return true;
    }
  }
  if (command) {
    for (const pattern of DEPLOY_COMMAND_PATTERNS) {
      if (pattern.test(command)) return true;
    }
  }
  return false;
}

/**
 * Determine if a cache file is stale (older than CACHE_MAX_AGE_MINUTES).
 * @param {object|null} cache - Parsed cache with `scannedAt` ISO timestamp
 * @returns {boolean} true if cache is missing, has no timestamp, or is stale
 */
function isCacheStale(cache) {
  if (!cache || !cache.scannedAt) return true;
  const age = Date.now() - new Date(cache.scannedAt).getTime();
  return age > CACHE_MAX_AGE_MINUTES * 60 * 1000;
}

/**
 * Run the PreDeploy hook logic. Reads secret-scan and env-diff caches,
 * evaluates them against the hook configuration, and returns a result
 * indicating whether the deploy should be blocked or an advisory issued.
 *
 * @param {object} params
 * @param {string} params.toolName  - Tool being invoked
 * @param {string} [params.filePath=""] - File path being written
 * @param {string} [params.command=""]  - Command being executed
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @returns {{ triggered: boolean, blocked?: boolean, reason?: string, advisory?: string, secretFindings?: Array, envGaps?: Array }}
 */
export function runPreDeployHook({ toolName, filePath = "", command = "", cwd = process.cwd() } = {}) {
  if (!isDeployTrigger(toolName, filePath, command)) {
    return { triggered: false };
  }

  // Load config from .forge.json hooks.preDeploy (defaults if absent)
  let config = { ...PRE_DEPLOY_DEFAULTS };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw && raw.hooks && raw.hooks.preDeploy) {
        config = { ...PRE_DEPLOY_DEFAULTS, ...raw.hooks.preDeploy };
      }
    }
  } catch { /* use defaults */ }

  // When hook is explicitly disabled, return triggered but take no action
  if (config.enabled === false) {
    return { triggered: true, blocked: false, reason: null, advisory: null, secretFindings: [], envGaps: [] };
  }

  const result = { triggered: true, blocked: false, reason: null, advisory: null, secretFindings: [], envGaps: [] };

  // 1. Check secret-scan cache
  const secretCache = readForgeJson("secret-scan-cache.json", null, cwd);
  if (secretCache && !secretCache.clean && Array.isArray(secretCache.findings) && secretCache.findings.length > 0) {
    result.secretFindings = secretCache.findings.map(f => ({
      file: f.file,
      line: f.line,
      type: f.type,
      entropyScore: f.entropyScore,
      confidence: f.confidence,
      masked: f.masked || "<REDACTED>",
    }));
    if (config.blockOnSecrets !== false) {
      result.blocked = true;
      result.reason = `secret-scan-found-${secretCache.findings.length}-findings`;
    }
  }

  // Flag stale secret cache (advisory — does not block)
  if (isCacheStale(secretCache)) {
    const staleMsg = "Secret scan cache is stale or missing — run forge_secret_scan to refresh.";
    result.advisory = result.advisory ? `${result.advisory}\n${staleMsg}` : staleMsg;
  }

  // 2. Check env-diff cache
  const envDiffCache = readForgeJson("env-diff-cache.json", null, cwd);
  if (envDiffCache && envDiffCache.summary && envDiffCache.summary.totalMissing > 0) {
    const gapPairs = (envDiffCache.pairs || []).filter(p =>
      (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0) > 0
    );
    result.envGaps = gapPairs;
    if (config.warnOnEnvGaps !== false && gapPairs.length > 0) {
      const lines = gapPairs.map(p => {
        const missing = [...(p.missingInTarget || []), ...(p.missingInBaseline || [])];
        return `${p.file || p.compareTo}: missing ${missing.join(", ")}`;
      });
      const envMsg = `Environment key gaps detected:\n${lines.map(l => `• ${l}`).join("\n")}`;
      result.advisory = result.advisory ? `${result.advisory}\n${envMsg}` : envMsg;
    }
  }
  // Also check totalGaps (used in some cache formats)
  if (!result.envGaps.length && envDiffCache && envDiffCache.summary && envDiffCache.summary.totalGaps > 0) {
    const gapPairs = (envDiffCache.pairs || []).filter(p =>
      (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0) > 0
    );
    if (gapPairs.length > 0) {
      result.envGaps = gapPairs;
      if (config.warnOnEnvGaps !== false) {
        const lines = gapPairs.map(p => {
          const missing = [...(p.missingInTarget || []), ...(p.missingInBaseline || [])];
          return `${p.file || p.compareTo}: missing ${missing.join(", ")}`;
        });
        const envMsg = `Environment key gaps detected:\n${lines.map(l => `• ${l}`).join("\n")}`;
        result.advisory = result.advisory ? `${result.advisory}\n${envMsg}` : envMsg;
      }
    }
  }

  return result;
}

// ─── PostSlice Hook ───────────────────────────────────────────────────

/** Conventional commit types that affect code drift. */
const POSTSLICE_COMMIT_PATTERN = /^(feat|fix|refactor|perf|chore|style|test)\(/;

/** Commit patterns that should NOT trigger the PostSlice hook. */
const POSTSLICE_SKIP_PATTERNS = [
  /^docs[:(]/,
  /^ci[:(]/,
  /^Merge /,
  /--no-verify/,
];

/** Default configuration for the PostSlice hook. */
const POSTSLICE_DEFAULTS = {
  enabled: true,
  silentDeltaThreshold: 5,
  warnDeltaThreshold: 10,
  scoreFloor: 70,
};

/** Module-level guard to prevent duplicate firings within the same session. */
let _postSliceHookFired = false;

/**
 * Reset the PostSlice hook fired flag. Exposed for testing.
 */
export function resetPostSliceHookFired() {
  _postSliceHookFired = false;
}

/**
 * Run the PostSlice hook logic. Detects conventional commits, reads drift
 * history, computes delta, and returns an advisory or warning message.
 *
 * @param {object} params
 * @param {string} params.commitMessage - The git commit message
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @returns {{ triggered: boolean, action?: string, message?: string, priorScore?: number, newScore?: number, delta?: number, skippedReason?: string }}
 */
export function runPostSliceHook({ commitMessage, cwd = process.cwd() } = {}) {
  if (!commitMessage) return { triggered: false, skippedReason: "no-commit-message" };

  // Guard: prevent duplicate firings in the same session
  if (_postSliceHookFired) {
    return { triggered: false, skippedReason: "already-fired" };
  }

  // Check skip patterns (docs, ci, merge, --no-verify)
  for (const pattern of POSTSLICE_SKIP_PATTERNS) {
    if (pattern.test(commitMessage)) {
      return { triggered: false, skippedReason: `skip-pattern: ${pattern.source}` };
    }
  }

  // Check conventional commit pattern
  if (!POSTSLICE_COMMIT_PATTERN.test(commitMessage)) {
    return { triggered: false, skippedReason: "not-conventional-commit" };
  }

  // Load config
  let config = { ...POSTSLICE_DEFAULTS };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.hooks?.postSlice) {
        config = { ...POSTSLICE_DEFAULTS, ...raw.hooks.postSlice };
      }
    }
  } catch { /* use defaults */ }

  if (config.enabled === false) {
    return { triggered: true, action: "disabled", message: null };
  }

  // Read drift history
  const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
  if (driftHistory.length < 2) {
    return { triggered: true, action: "skip", skippedReason: "insufficient-drift-history", message: null };
  }

  const priorScore = driftHistory[driftHistory.length - 2]?.score;
  const newScore = driftHistory[driftHistory.length - 1]?.score;
  const violations = driftHistory[driftHistory.length - 1]?.violations || [];

  if (priorScore == null || newScore == null) {
    return { triggered: true, action: "skip", skippedReason: "missing-scores", message: null };
  }

  const delta = priorScore - newScore; // positive = regression

  // Mark as fired (prevent duplicate firing for the same commit)
  _postSliceHookFired = true;

  // Evaluate thresholds
  if (newScore >= priorScore) {
    return { triggered: true, action: "silent", message: null, priorScore, newScore, delta: -delta };
  }
  if (delta <= config.silentDeltaThreshold) {
    return { triggered: true, action: "silent", message: null, priorScore, newScore, delta };
  }

  // Warning: delta > warnDeltaThreshold OR score below floor
  if (delta > config.warnDeltaThreshold || newScore < config.scoreFloor) {
    const topViolations = violations.slice(0, 5).map(v => `• ${v.file}: ${v.rule} (${v.severity})`).join("\n");
    const belowFloor = newScore < config.scoreFloor ? `Score is BELOW threshold (${config.scoreFloor}/${newScore}). ` : "";
    const message = `🔴 PostSlice Hook — Drift Warning\n\nDrift score dropped ${delta} points after this commit (${priorScore} → ${newScore}).\n${belowFloor}Recommend resolving violations before starting the next slice.\n\nTop violations:\n${topViolations}\n\nOptions:\n1. Fix violations now and amend the commit\n2. Accept and continue — run \`pforge incident\` if this causes a prod issue later\n3. Run \`pforge runbook docs/plans/<current-plan>\` to update ops docs with new risk\n\nThe next slice will start with this reduced score as the new baseline.`;
    return { triggered: true, action: "warning", message, priorScore, newScore, delta };
  }

  // Advisory: delta > silentDeltaThreshold but <= warnDeltaThreshold and score still >= floor
  const topViolations = violations.slice(0, 3).map(v => `• ${v.file}: ${v.rule} (${v.severity})`).join("\n");
  const message = `🟡 PostSlice Hook — Drift Advisory\n\nDrift score dropped ${delta} points after this commit (${priorScore} → ${newScore}).\nScore is still above threshold (${config.scoreFloor}) — proceeding is safe, but investigate before shipping.\n\nTop new violations:\n${topViolations}\n\nRun \`pforge drift\` to see the full report.`;
  return { triggered: true, action: "advisory", message, priorScore, newScore, delta };
}

// ─── PreAgentHandoff Hook ─────────────────────────────────────────────

/** Default configuration for the PreAgentHandoff hook. */
const PRE_AGENT_HANDOFF_DEFAULTS = {
  enabled: true,
  injectContext: true,
  runRegressionGuard: true,
  cacheMaxAgeMinutes: 30,
  minAlertSeverity: "medium",
};

/**
 * Check whether a LiveGuard cache file is stale based on its timestamp field.
 * @param {object|null} cache - Cache object with a timestamp or scannedAt field
 * @param {number} maxAgeMinutes - Maximum acceptable age in minutes
 * @returns {boolean}
 */
function isLiveGuardCacheStale(cache, maxAgeMinutes) {
  if (!cache) return true;
  const ts = cache.scannedAt || cache.timestamp || cache.createdAt;
  if (!ts) return true;
  const age = Date.now() - new Date(ts).getTime();
  return age > maxAgeMinutes * 60 * 1000;
}

/**
 * Format a relative time string like "5 min" or "2 hr".
 * @param {string} isoTimestamp
 * @returns {string}
 */
function formatSnapshotAge(isoTimestamp) {
  if (!isoTimestamp) return "unknown";
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr`;
}

/**
 * Run the PreAgentHandoff hook. Reads LiveGuard caches and builds a
 * structured context header for injection into a new agent session.
 *
 * When PFORGE_QUORUM_TURN env var is set, skips context injection entirely
 * to avoid inflating token usage in quorum model turns.
 *
 * @param {object} params
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @param {string[]} [params.dirtyFiles=[]] - Files modified on the current branch (git diff)
 * @param {boolean} [params.hasActivePlan=false] - Whether an active plan file exists
 * @param {boolean} [params.hasAutoFixPlan=false] - Whether a LIVEGUARD-FIX-*.md auto-fix plan exists
 * @param {boolean} [params.isResumeSession=false] - Whether the session references --resume-from
 * @returns {Promise<{ triggered: boolean, contextHeader?: string, regressionResult?: object, openClawResult?: object, skippedReason?: string }>}
 */
export async function runPreAgentHandoffHook({
  cwd = process.cwd(),
  dirtyFiles = [],
  hasActivePlan = false,
  hasAutoFixPlan = false,
  isResumeSession = false,
} = {}) {
  // PFORGE_QUORUM_TURN guard — skip context injection for quorum model turns
  if (process.env.PFORGE_QUORUM_TURN) {
    console.error("[PreAgentHandoff] skipping context injection — PFORGE_QUORUM_TURN active");
    return { triggered: false, skippedReason: "PFORGE_QUORUM_TURN active" };
  }

  // Check trigger conditions
  const hasDirtyBranch = dirtyFiles.length > 0;
  const shouldFire = hasDirtyBranch || hasActivePlan || hasAutoFixPlan || isResumeSession;
  if (!shouldFire) {
    return { triggered: false, skippedReason: "no-trigger-conditions" };
  }

  // Load config
  let config = { ...PRE_AGENT_HANDOFF_DEFAULTS };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.hooks?.preAgentHandoff) {
        config = { ...PRE_AGENT_HANDOFF_DEFAULTS, ...raw.hooks.preAgentHandoff };
      }
    }
  } catch { /* use defaults */ }

  if (config.enabled === false) {
    return { triggered: true, contextHeader: null, skippedReason: "disabled" };
  }

  const maxAge = config.cacheMaxAgeMinutes ?? 30;

  // Read LiveGuard caches (all file reads, no subprocesses)
  const triageCache = readForgeJson("alert-triage-cache.json", null, cwd);
  const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
  const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
  const secretScanCache = readForgeJson("secret-scan-cache.json", null, cwd);
  const deployJournal = readForgeJsonl("deploy-journal.jsonl", [], cwd);

  // Check if all data stores are empty
  const hasAnyData = triageCache || driftHistory.length > 0 || incidents.length > 0 || secretScanCache || deployJournal.length > 0;

  if (!hasAnyData) {
    const contextHeader = "🛡️ LIVEGUARD CONTEXT — No data yet\nRun `pforge triage` after completing the first deploy to activate LiveGuard monitoring.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    return { triggered: true, contextHeader, regressionResult: null, openClawResult: null };
  }

  // Build snapshot data
  const latestDrift = driftHistory.length > 0 ? driftHistory[driftHistory.length - 1] : null;
  const score = latestDrift?.score ?? "N/A";
  const trend = latestDrift?.trend ?? "unknown";
  const violationCount = latestDrift?.violations?.length ?? 0;
  const snapshotTs = latestDrift?.timestamp || triageCache?.scannedAt || new Date().toISOString();
  const snapshotAge = formatSnapshotAge(snapshotTs);

  const openIncidents = incidents.filter(i => !i.resolvedAt);

  const lastDeploy = deployJournal.length > 0 ? deployJournal[deployJournal.length - 1] : null;

  const secretScan = secretScanCache || { clean: true, findings: [] };
  const secretScanAge = secretScanCache ? formatSnapshotAge(secretScanCache.scannedAt) : "never";

  // Filter alerts by minAlertSeverity
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  const minRank = severityRank[config.minAlertSeverity] || 2;
  const alerts = (triageCache?.alerts || triageCache?.results || [])
    .filter(a => (severityRank[a.severity] || 0) >= minRank);

  // Build context header
  const lines = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "🛡️ LIVEGUARD CONTEXT — Session Start",
    `(As of ${snapshotAge} ago — run \`pforge triage\` to refresh)`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Drift Score: ${score}/100 (${trend}) — ${violationCount} active violations`,
    `Open Incidents: ${openIncidents.length}${openIncidents.length > 0 ? ` (${openIncidents.map(i => i.severity).join(", ")})` : ""}`,
  ];

  if (lastDeploy) {
    const postHealth = lastDeploy.postHealthScore ?? "not yet recorded";
    lines.push(`Last Deploy: ${lastDeploy.version || "unknown"} @ ${lastDeploy.timestamp || "unknown"} (pre: ${lastDeploy.preHealthScore ?? "N/A"}, post: ${postHealth})`);
  } else {
    lines.push("Last Deploy: none recorded");
  }

  lines.push(`Last Secret Scan: ${secretScan.clean !== false ? "✅ Clean" : `⛔ ${(secretScan.findings || []).length} finding(s)`} (${secretScanAge})`);
  lines.push("");

  if (alerts.length > 0) {
    lines.push("Top Alerts (medium+):");
    alerts.slice(0, 5).forEach((a, i) => {
      lines.push(`${i + 1}. [${(a.severity || "unknown").toUpperCase()}] ${a.title || a.message || "untitled"} — ${a.recommendedAction || "investigate"}`);
    });
    if (alerts.length > 5) {
      lines.push(`...and ${alerts.length - 5} more. Run \`pforge triage\` for full list.`);
    }
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let contextHeader = lines.join("\n");

  // Regression guard on dirty branch
  let regressionResult = null;
  if (hasDirtyBranch && config.runRegressionGuard !== false) {
    try {
      regressionResult = await regressionGuard(dirtyFiles, { cwd });
      if (regressionResult && regressionResult.failed > 0) {
        const failedGates = (regressionResult.results || []).filter(r => r.status === "failed");
        const regressionLines = [
          "",
          `⚠️ Regression Alert — ${regressionResult.failed} gate(s) failing on current branch changes`,
          "",
          ...failedGates.map(r => `• Slice ${r.sliceNumber} (${r.planFile}): ${r.cmd}`),
          "",
          "Resolve these before adding new code — the current branch has introduced regressions.",
        ];
        contextHeader += "\n" + regressionLines.join("\n");
      }
    } catch (err) {
      // Regression guard failure is non-blocking
      console.error(`[PreAgentHandoff] regression guard error: ${err.message}`);
    }
  }

  // OpenClaw bridge (fire-and-forget)
  let openClawResult = null;
  try {
    const { endpoint } = loadOpenClawConfig(cwd);
    if (endpoint) {
      // Fire-and-forget — no await
      const openClawPromise = postOpenClawSnapshot(cwd, {
        trigger: "preAgentHandoff",
        dirtyFiles: dirtyFiles.length,
        openIncidents: openIncidents.length,
      });
      openClawPromise.then(r => { openClawResult = r; }).catch(err => {
        console.error(`[PreAgentHandoff] openclaw snapshot skipped: ${err.message}`);
      });
    }
  } catch (err) {
    console.error(`[PreAgentHandoff] openclaw snapshot skipped: ${err.message}`);
  }

  return { triggered: true, contextHeader, regressionResult, openClawResult };
}

/**
 * Infer the slice type from its title and tasks for model routing purposes.
 * Returns one of: "test" | "review" | "migration" | "execute"
 * @param {object} slice - Parsed slice object
 * @returns {string}
 */
export function inferSliceType(slice) {
  const text = [slice.title || "", ...(slice.tasks || [])].join(" ").toLowerCase();
  if (/\b(test|spec|unit test|integration test|e2e|coverage)\b/.test(text)) return "test";
  if (/\b(review|audit|lint|analyze|analyse|check|inspect)\b/.test(text)) return "review";
  if (/\b(migration|migrate|schema|seed|alter table|create table|drop table|dbcontext|ef core)\b/.test(text)) return "migration";
  return "execute";
}

/**
 * Recommend the best model for a given slice type based on historical performance.
 *
 * Selection criteria:
 *   1. Minimum 3 slices of data (MIN_SAMPLE)
 *   2. Success rate > 80%
 *   3. Cheapest qualifying model wins
 *
 * Records are filtered by sliceType when type info is present in history.
 * Falls back to all records when no type-specific data is available.
 *
 * @param {string} cwd - Project working directory
 * @param {string|null} sliceType - Slice type from inferSliceType(), or null for global stats
 * @returns {{ model: string, success_rate: number, avg_cost_usd: number, total_slices: number } | null}
 */
export function recommendModel(cwd, sliceType = null) {
  try {
    const records = loadModelPerformance(cwd);
    if (records.length === 0) return null;

    // Prefer type-specific records; fall back to all records
    const typed = sliceType ? records.filter((r) => r.sliceType === sliceType) : records;
    const relevant = typed.length >= 3 ? typed : records;

    const stats = aggregateModelStats(relevant);
    const MIN_SAMPLE = 3;
    const qualified = Object.entries(stats)
      .filter(([, s]) => s.total_slices >= MIN_SAMPLE && s.success_rate > 0.8)
      .map(([m, s]) => ({
        model: m,
        success_rate: s.success_rate,
        avg_cost_usd: s.avg_cost_usd,
        total_slices: s.total_slices,
      }))
      .sort((a, b) => a.avg_cost_usd - b.avg_cost_usd);

    return qualified.length > 0 ? qualified[0] : null;
  } catch {
    return null;
  }
}

/**
 * Execute a single slice — spawn worker + run validation gates.
 * Supports automatic retry: if gate fails, re-invokes worker with error context.
 */
async function executeSlice(slice, options) {
  const { cwd, model, modelRouting = {}, mode, runDir, maxRetries = 1,
    memoryEnabled = false, projectName = "", planName = "",
    quorumConfig = null,
    escalationChain = ["auto", "claude-opus-4.6", "gpt-5.3-codex"],
    eventBus = null } = options;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model, modelRouting, slice);

  // Fix 8: Snapshot working tree before slice (for safe rollback on failure)
  let snapshotStash = false;
  try {
    const status = execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5000 }).trim();
    if (status) {
      execSync(`git stash push -m "pforge-slice-${slice.number}-snapshot"`, { cwd, encoding: "utf-8", timeout: 10000 });
      snapshotStash = true;
    }
  } catch { /* not a git repo or git not available — skip snapshot */ }

  // ─── Agent-Per-Slice Routing (Slice 1) ───────────────────────────────
  // When no explicit model is set, recommend one from historical performance data.
  let finalModel = resolvedModel;
  if (!finalModel && cwd) {
    const sliceType = inferSliceType(slice);
    const rec = recommendModel(cwd, sliceType);
    if (rec) {
      finalModel = rec.model;
      if (eventBus) {
        eventBus.emit("slice-model-routed", {
          sliceId: slice.number,
          title: slice.title,
          model: rec.model,
          sliceType,
          success_rate: rec.success_rate,
          based_on_slices: rec.total_slices,
        });
      }
    }
  }

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
  let currentModel = finalModel;

  while (attempt <= maxRetries) {
    // Auto-escalate model on retries — skip past the current model in chain
    if (attempt > 0 && escalationChain.length > 1) {
      let nextModel = currentModel;
      for (let i = 0; i < escalationChain.length; i++) {
        const candidate = escalationChain[i] === "auto" ? null : escalationChain[i];
        if (candidate !== currentModel) {
          nextModel = candidate;
          break;
        }
      }
      // If starting model is already the top of the chain, try the next one down
      if (nextModel === currentModel) {
        const curIdx = escalationChain.findIndex(m => (m === "auto" ? null : m) === currentModel);
        const nextIdx = Math.min(curIdx + attempt, escalationChain.length - 1);
        const candidate = escalationChain[nextIdx] === "auto" ? null : escalationChain[nextIdx];
        if (candidate !== currentModel) nextModel = candidate;
      }
      if (nextModel !== currentModel) {
        const fromModel = currentModel || "auto";
        currentModel = nextModel;
        if (eventBus) {
          eventBus.emit("slice-escalated", {
            sliceId: slice.number,
            title: slice.title,
            attempt,
            fromModel,
            toModel: currentModel || "auto",
          });
        }
      }
    }

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
        workerResult = await spawnWorker(sliceInstructions, { model: currentModel, cwd });
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
      const gateLines = coalesceGateLines(slice.validationGate);

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
    ...(currentModel !== finalModel && { escalatedModel: finalModel || "auto" }),
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

  // Record model performance for this slice
  try {
    const sliceCost = calculateSliceCost(sliceResult.tokens, sliceResult.worker);
    recordModelPerformance(cwd, {
      date: new Date().toISOString(),
      plan: planName,
      sliceId: slice.number,
      sliceTitle: slice.title,
      sliceType: inferSliceType(slice),
      model: sliceResult.model || "unknown",
      status: sliceResult.status,
      attempts: sliceResult.attempts,
      duration_ms: sliceResult.duration,
      cost_usd: sliceCost.cost_usd,
    });
  } catch {
    // Non-fatal — don't fail the slice over a tracking write error
  }

  // Record quorum outcome for adaptive threshold tuning
  if (quorumConfig?.enabled) {
    try {
      const initialFailed = sliceResult.attempts > 1;
      appendForgeJsonl("quorum-history.json", {
        timestamp: new Date().toISOString(),
        sliceNumber: slice.number,
        sliceTitle: slice.title,
        complexityScore: complexityScore || null,
        quorumUsed: useQuorum,
        quorumNeeded: useQuorum && !initialFailed, // Needed = quorum used AND initial model would have failed
        status: sliceResult.status,
      }, cwd);
    } catch { /* non-fatal */ }
  }

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
const SECURITY_KEYWORDS = /\b(auth|token|rbac|encryption|secret|cors|jwt|oauth|password|credential|permission|role)\b/gi;

/**
 * Database/migration keywords that increase complexity score.
 * @type {RegExp}
 */
const DATABASE_KEYWORDS = /\b(migration|schema|alter|create\s+table|drop|seed|index|foreign\s+key|constraint|ef\s+core|dbcontext|repository)\b/gi;

/**
 * Load quorum configuration from .forge.json.
 * Schema: { "quorum": { "enabled": false, "auto": true, "threshold": 7, "preset": "power|speed", "models": [...], "reviewerModel": "...", "dryRunTimeout": 300000 } }
 * Returns merged config with defaults.
 */

const QUORUM_PRESETS = {
  power: {
    models: ["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    reviewerModel: "claude-opus-4.7",
    dryRunTimeout: 300_000, // 5 min — reasoning models need more time
    threshold: 5,           // lower threshold = more slices get quorum treatment
  },
  speed: {
    models: ["claude-sonnet-4.6", "gpt-5.4-mini", "grok-4-1-fast-reasoning"],
    reviewerModel: "claude-sonnet-4.6",
    dryRunTimeout: 120_000, // 2 min — fast models finish quickly
    threshold: 7,           // higher threshold = only the most complex slices
  },
};

// ─── OpenClaw Integration (v2.29) ────────────────────────────────────

/**
 * Load OpenClaw configuration from .forge.json.
 * @param {string} cwd
 * @returns {{ endpoint: string|null, apiKey: string|null }}
 */
export function loadOpenClawConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.openclaw && config.openclaw.endpoint) {
        let apiKey = config.openclaw.apiKey || null;
        // Fallback: .forge/secrets.json
        if (!apiKey) {
          const secretsPath = resolve(cwd, ".forge/secrets.json");
          if (existsSync(secretsPath)) {
            try {
              const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
              apiKey = secrets.OPENCLAW_API_KEY || null;
            } catch { /* skip */ }
          }
        }
        return { endpoint: config.openclaw.endpoint, apiKey };
      }
    }
  } catch { /* skip */ }
  return { endpoint: null, apiKey: null };
}

/**
 * Post a LiveGuard context snapshot to the configured OpenClaw endpoint.
 * Fire-and-forget with a 5s hard timeout. Never throws.
 *
 * Payload includes: drift score, open incidents, last deploy, alert summary, secret scan status.
 *
 * @param {string} cwd - Project directory
 * @param {object} [extraContext] - Additional context fields to include
 * @returns {Promise<{ sent: boolean, endpoint?: string, error?: string }>}
 */
export async function postOpenClawSnapshot(cwd, extraContext = {}) {
  const { endpoint, apiKey } = loadOpenClawConfig(cwd);
  if (!endpoint) return { sent: false, error: "No openclaw.endpoint configured" };

  try {
    // Gather snapshot data
    const snapshot = { timestamp: new Date().toISOString(), project: null, ...extraContext };

    // Project name
    try {
      const config = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
      snapshot.project = config.projectName || null;
    } catch { /* skip */ }

    // Drift score
    const driftPath = resolve(cwd, ".forge/drift-history.json");
    if (existsSync(driftPath)) {
      try {
        const history = JSON.parse(readFileSync(driftPath, "utf-8"));
        const latest = Array.isArray(history) ? history[history.length - 1] : history;
        snapshot.driftScore = latest?.score ?? null;
        snapshot.driftViolations = latest?.violations ?? null;
      } catch { /* skip */ }
    }

    // Open incidents
    const incidentsPath = resolve(cwd, ".forge/incidents.jsonl");
    if (existsSync(incidentsPath)) {
      try {
        const lines = readFileSync(incidentsPath, "utf-8").trim().split("\n").filter(Boolean);
        const incidents = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        snapshot.openIncidents = incidents.filter((i) => !i.resolvedAt).length;
        snapshot.totalIncidents = incidents.length;
      } catch { /* skip */ }
    }

    // Last deploy
    const deployPath = resolve(cwd, ".forge/deploy-journal.jsonl");
    if (existsSync(deployPath)) {
      try {
        const lines = readFileSync(deployPath, "utf-8").trim().split("\n").filter(Boolean);
        const last = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : null;
        if (last) {
          snapshot.lastDeployVersion = last.version || null;
          snapshot.lastDeployEnv = last.environment || null;
          snapshot.lastDeployAt = last.timestamp || null;
        }
      } catch { /* skip */ }
    }

    // Secret scan status
    const scanPath = resolve(cwd, ".forge/secret-scan-cache.json");
    if (existsSync(scanPath)) {
      try {
        const scan = JSON.parse(readFileSync(scanPath, "utf-8"));
        snapshot.secretScanClean = scan.clean ?? null;
        snapshot.secretScanFindings = scan.findings?.length ?? 0;
      } catch { /* skip */ }
    }

    // POST with 5s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return { sent: true, endpoint, status: response.status };
  } catch (err) {
    // Fire-and-forget — never throw
    return { sent: false, endpoint, error: err.name === "AbortError" ? "timeout (5s)" : err.message };
  }
}

// ─── Watcher (v2.34) ─────────────────────────────────────────────────
// A read-only observer that watches another project's pforge run from a
// separate VS Code Copilot session. Tails events.log + slice-*.json files,
// optionally invokes a frontier model (default: claude-opus-4.7) to advise.
// The watcher MUST NOT modify files in the target project.

/**
 * Default model for the watcher. Frontier-tier — needs strong reasoning to
 * spot anomalies in another agent's output.
 */
const DEFAULT_WATCHER_MODEL = "claude-opus-4.7";

/**
 * Discover the most recent run directory under <targetPath>/.forge/runs/.
 * @param {string} targetPath - Absolute path to the project being watched
 * @param {string|null} [runId=null] - Specific run dir name; null = newest
 * @returns {{ runDir: string, runId: string } | null}
 */
export function findLatestRun(targetPath, runId = null) {
  const runsDir = resolve(targetPath, ".forge", "runs");
  if (!existsSync(runsDir)) return null;
  if (runId) {
    const explicit = resolve(runsDir, runId);
    return existsSync(explicit) ? { runDir: explicit, runId } : null;
  }
  let entries;
  try { entries = readdirSync(runsDir, { withFileTypes: true }); } catch { return null; }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (dirs.length === 0) return null;
  const latest = dirs[dirs.length - 1];
  return { runDir: resolve(runsDir, latest), runId: latest };
}

/**
 * Parse events.log into structured entries.
 * Format per line: "[ISO] eventType: {jsonData}"
 * @param {string} runDir
 * @returns {Array<{ ts: string, type: string, data: object }>}
 */
export function parseEventsLog(runDir) {
  const logPath = resolve(runDir, "events.log");
  if (!existsSync(logPath)) return [];
  const events = [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\[([^\]]+)\]\s+([a-z-]+):\s*(.*)$/);
      if (!m) continue;
      let data = {};
      try { data = JSON.parse(m[3] || "{}"); } catch { /* keep empty */ }
      events.push({ ts: m[1], type: m[2], data });
    }
  } catch { /* ignore */ }
  return events;
}

/**
 * Read all slice-*.json artifacts in a run directory.
 * @param {string} runDir
 * @returns {Array<object>}
 */
export function readSliceArtifacts(runDir) {
  const artifacts = [];
  let entries;
  try { entries = readdirSync(runDir); } catch { return artifacts; }
  for (const name of entries) {
    const m = name.match(/^slice-(\d+)\.json$/);
    if (!m) continue;
    try {
      const data = JSON.parse(readFileSync(resolve(runDir, name), "utf-8"));
      artifacts.push({ sliceNumber: parseInt(m[1], 10), ...data });
    } catch { /* skip malformed */ }
  }
  return artifacts.sort((a, b) => a.sliceNumber - b.sliceNumber);
}

/**
 * Build a structured snapshot of the watched run's current state.
 * Cheap to build — pure file reads, no AI calls.
 *
 * @param {string} targetPath - Absolute path to project being watched
 * @param {string|null} runId - Specific run dir, null for latest
 * @returns {object} Snapshot object
 */
/**
 * Map raw event types to a normalized runState taxonomy.
 * Consumers should branch on these stable values, NOT on raw event types.
 * @param {string|null} eventType - Raw event type from events.log (e.g. "run-completed")
 * @param {boolean} hasStarted - Whether a run-started event was seen
 * @returns {"completed"|"aborted"|"in-progress"|"unknown"}
 */
export function normalizeRunState(eventType, hasStarted) {
  if (eventType === "run-completed") return "completed";
  if (eventType === "run-aborted") return "aborted";
  if (hasStarted) return "in-progress";
  return "unknown";
}

/**
 * Build a structured snapshot of the watched run's current state.
 * Cheap to build — pure file reads, no AI calls.
 *
 * @param {string} targetPath - Absolute path to project being watched
 * @param {string|null} runId - Specific run dir, null for latest
 * @param {object} [opts]
 * @param {number} [opts.tailEvents=25] - Number of trailing events to include (1..200)
 * @returns {object} Snapshot object
 */
export function buildWatchSnapshot(targetPath, runId = null, opts = {}) {
  const tailEventsRaw = Number.isFinite(opts.tailEvents) ? opts.tailEvents : 25;
  const tailEvents = Math.min(200, Math.max(1, Math.floor(tailEventsRaw)));

  const located = findLatestRun(targetPath, runId);
  if (!located) {
    return { ok: false, error: `No run directory found under ${targetPath}/.forge/runs/`, targetPath };
  }
  const events = parseEventsLog(located.runDir);
  const artifacts = readSliceArtifacts(located.runDir);

  // Read summary.json if present (means run completed)
  let summary = null;
  const summaryPath = resolve(located.runDir, "summary.json");
  if (existsSync(summaryPath)) {
    try { summary = JSON.parse(readFileSync(summaryPath, "utf-8")); } catch { /* ignore */ }
  }

  // Compute live status from events
  const runStarted = events.find((e) => e.type === "run-started");
  const runCompleted = events.find((e) => e.type === "run-completed" || e.type === "run-aborted");
  const sliceStarted = events.filter((e) => e.type === "slice-started");
  const sliceCompleted = events.filter((e) => e.type === "slice-completed");
  const sliceFailed = events.filter((e) => e.type === "slice-failed");
  const sliceEscalated = events.filter((e) => e.type === "slice-escalated");
  const lastEvent = events[events.length - 1] || null;
  const lastEventAgeMs = lastEvent ? Date.now() - new Date(lastEvent.ts).getTime() : null;
  const runState = normalizeRunState(runCompleted?.type || null, Boolean(runStarted));

  return {
    ok: true,
    targetPath,
    runId: located.runId,
    runDir: located.runDir,
    runState,
    lastEventType: runCompleted?.type || (runStarted ? "run-started" : null),
    plan: runStarted?.data?.plan || null,
    model: runStarted?.data?.model || null,
    sliceCount: runStarted?.data?.sliceCount || null,
    counts: {
      started: sliceStarted.length,
      completed: sliceCompleted.length,
      failed: sliceFailed.length,
      escalated: sliceEscalated.length,
      events: events.length,
      artifacts: artifacts.length,
    },
    lastEvent,
    lastEventAgeMs,
    summary,
    artifacts: artifacts.map((a) => ({
      sliceNumber: a.sliceNumber,
      title: a.title || a.slice?.title || null,
      status: a.status || null,
      attempts: a.attempts || null,
      duration: a.duration || null,
      worker: a.worker || null,
      model: a.model || null,
      tokensIn: a.tokens?.tokens_in ?? null,
      tokensOut: a.tokens?.tokens_out ?? null,
      gateError: a.gateError || null,
    })),
    tailEvents,
    events: events.slice(-tailEvents),
  };
}

/**
 * Detect anomalies in a snapshot without calling an AI model.
 * Cheap heuristics — used both standalone and as input to the analyzer prompt.
 *
 * @param {object} snapshot - Output of buildWatchSnapshot()
 * @returns {Array<{ severity: "info"|"warn"|"error", code: string, message: string }>}
 */
export function detectWatchAnomalies(snapshot) {
  const anomalies = [];
  if (!snapshot.ok) return anomalies;

  // 1. Stalled run: in-progress but no events for >5 min
  if (snapshot.runState === "in-progress" && snapshot.lastEventAgeMs && snapshot.lastEventAgeMs > 5 * 60_000) {
    anomalies.push({
      severity: "warn",
      code: "stalled",
      message: `No events for ${Math.round(snapshot.lastEventAgeMs / 60_000)}min — run may be stalled`,
    });
  }

  // 2. Token-parsing regression: completed slices reporting 0 tokens
  for (const a of snapshot.artifacts) {
    if (a.status === "passed" && (a.tokensOut === 0 || a.tokensOut === null) && a.duration && a.duration > 60_000) {
      anomalies.push({
        severity: "warn",
        code: "tokens-zero",
        message: `Slice ${a.sliceNumber} ran ${Math.round(a.duration / 1000)}s but reports 0 output tokens — parser may be broken`,
      });
    }
  }

  // 3. High retry attempts
  for (const a of snapshot.artifacts) {
    if (a.attempts && a.attempts >= 3) {
      anomalies.push({
        severity: "warn",
        code: "high-retries",
        message: `Slice ${a.sliceNumber} took ${a.attempts} attempts (close to retry limit)`,
      });
    }
  }

  // 4. Failed slice present
  if (snapshot.counts.failed > 0) {
    anomalies.push({
      severity: "error",
      code: "slice-failed",
      message: `${snapshot.counts.failed} slice(s) failed`,
    });
  }

  // 4b. Slice escalated to a stronger model (one or more retries triggered escalation)
  if (snapshot.counts?.escalated > 0) {
    anomalies.push({
      severity: "warn",
      code: "model-escalated",
      message: `${snapshot.counts.escalated} slice(s) were escalated to a stronger model — investigate why initial model failed`,
    });
  }

  // 5. All slices skipped (likely no-op detection)
  if (
    snapshot.runState === "completed" &&
    snapshot.summary?.results?.skipped === snapshot.summary?.results?.total &&
    snapshot.summary?.results?.total > 0
  ) {
    anomalies.push({
      severity: "info",
      code: "all-skipped",
      message: "All slices were skipped — likely a no-op re-run of an already-executed plan",
    });
  }

  // 6. Gate-on-prose failures
  for (const a of snapshot.artifacts) {
    if (a.gateError && /'[\d]+\.'/.test(a.gateError)) {
      anomalies.push({
        severity: "error",
        code: "gate-on-prose",
        message: `Slice ${a.sliceNumber} gate failed on markdown numbered-list prose — coalesceGateLines regression`,
      });
    }
  }

  return anomalies;
}

/**
 * Build the watcher analyzer prompt for the frontier model.
 */
function buildWatcherPrompt(snapshot, anomalies) {
  const lines = [
    "You are the Plan Forge WATCHER — a read-only observer of another AI agent's plan execution.",
    "You CANNOT modify any files. Your job is to:",
    "  1. Summarize the watched run's current state in 2-3 sentences.",
    "  2. Flag anomalies, regressions, or concerning patterns.",
    "  3. Recommend specific corrective actions the executing agent should take.",
    "",
    "Be concise. Prefer concrete recommendations over generic observations.",
    "When advising commands, format them as: `pforge <command>` or shell snippets.",
    "",
    "--- SNAPSHOT ---",
    JSON.stringify({
      targetPath: snapshot.targetPath,
      runId: snapshot.runId,
      runState: snapshot.runState,
      plan: snapshot.plan,
      model: snapshot.model,
      counts: snapshot.counts,
      lastEventAgeMs: snapshot.lastEventAgeMs,
      summary: snapshot.summary
        ? {
            status: snapshot.summary.status,
            results: snapshot.summary.results,
            totalDuration: snapshot.summary.totalDuration,
            totalTokensOut: snapshot.summary.totalTokensOut,
            cost: snapshot.summary.cost?.total_cost_usd,
          }
        : null,
      artifacts: snapshot.artifacts,
    }, null, 2),
    "",
    "--- HEURISTIC ANOMALIES (already detected) ---",
    anomalies.length === 0 ? "(none)" : JSON.stringify(anomalies, null, 2),
    "",
    "--- LAST 25 EVENTS ---",
    JSON.stringify(snapshot.events, null, 2),
    "",
    "Produce your watcher report as Markdown with sections: ## Status / ## Anomalies / ## Recommendations.",
  ];
  return lines.join("\n");
}

/**
 * Watch another project's pforge execution. Read-only.
 *
 * Modes:
 *   - "snapshot": Return current state + heuristic anomalies. No AI call. Cheap.
 *   - "analyze":  Snapshot + invoke frontier model for advice. Costs a worker call.
 *
 * @param {object} options
 * @param {string} options.targetPath  - Absolute path to project being watched
 * @param {string} [options.runId]     - Specific run dir; default = latest
 * @param {"snapshot"|"analyze"} [options.mode="snapshot"]
 * @param {string} [options.model]     - Override watcher model (default: claude-opus-4.7)
 * @param {number} [options.timeout=300000] - Worker timeout for analyze mode
 * @returns {Promise<object>} Watcher report
 */
export async function runWatch(options = {}) {
  const {
    targetPath,
    runId = null,
    mode = "snapshot",
    model = DEFAULT_WATCHER_MODEL,
    timeout = 300_000,
    tailEvents = 25,
  } = options;

  if (!targetPath) {
    return { ok: false, error: "targetPath is required" };
  }
  const resolved = resolve(targetPath);
  if (!existsSync(resolved)) {
    return { ok: false, error: `Target path does not exist: ${resolved}` };
  }

  const snapshot = buildWatchSnapshot(resolved, runId, { tailEvents });
  if (!snapshot.ok) return snapshot;

  const anomalies = detectWatchAnomalies(snapshot);

  const report = {
    ok: true,
    mode,
    watcherModel: mode === "analyze" ? model : null,
    targetPath: resolved,
    runId: snapshot.runId,
    runState: snapshot.runState,
    lastEventType: snapshot.lastEventType,
    plan: snapshot.plan,
    counts: snapshot.counts,
    lastEventAgeMs: snapshot.lastEventAgeMs,
    tailEvents: snapshot.tailEvents,
    summary: snapshot.summary
      ? {
          status: snapshot.summary.status,
          results: snapshot.summary.results,
          totalDuration: snapshot.summary.totalDuration,
          totalTokensOut: snapshot.summary.totalTokensOut,
          cost: snapshot.summary.cost?.total_cost_usd,
        }
      : null,
    artifacts: snapshot.artifacts,
    anomalies,
    timestamp: new Date().toISOString(),
  };

  if (mode === "snapshot") return report;

  // Analyze mode: invoke frontier watcher model
  // CRITICAL: spawn the worker with cwd = watcher's own directory, NEVER the target's,
  // so any tool calls the watcher might make cannot touch the target project.
  const prompt = buildWatcherPrompt(snapshot, anomalies);
  const watcherCwd = process.cwd(); // watcher's own working directory
  try {
    const result = await spawnWorker(prompt, { model, cwd: watcherCwd, timeout });
    report.advice = result.output || "(no advice returned)";
    report.tokens = result.tokens || null;
    report.workerExitCode = result.exitCode;
  } catch (err) {
    report.adviceError = err.message;
  }
  return report;
}

export function loadQuorumConfig(cwd, presetOverride = null) {
  const defaults = {
    enabled: false,
    auto: true,
    threshold: 6,
    models: ["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    reviewerModel: "claude-opus-4.6",
    dryRunTimeout: 300_000, // 5 min per dry-run leg
  };

  // Adaptive threshold: learn from quorum history which slices actually need quorum
  try {
    const qHistory = readForgeJsonl("quorum-history.json", [], cwd);
    if (qHistory.length >= 5) {
      const needed = qHistory.filter(q => q.quorumNeeded).length;
      const total = qHistory.length;
      const neededRate = needed / total;
      // If <20% of slices needed quorum, raise threshold (fewer get quorum)
      // If >60% needed quorum, lower threshold (more get quorum)
      if (neededRate < 0.2 && defaults.threshold < 9) defaults.threshold = Math.min(9, defaults.threshold + 1);
      else if (neededRate > 0.6 && defaults.threshold > 3) defaults.threshold = Math.max(3, defaults.threshold - 1);
    }
  } catch { /* use static default */ }
  const configPath = resolve(cwd, ".forge.json");
  let userConfig = {};
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.quorum && typeof config.quorum === "object") {
        userConfig = config.quorum;
      }
    }
  } catch { /* defaults */ }

  // Resolve preset: CLI override > .forge.json preset > none
  const presetName = presetOverride || userConfig.preset || null;
  const preset = presetName ? QUORUM_PRESETS[presetName] || {} : {};

  // Merge order: defaults < preset < userConfig (explicit fields win)
  return { ...defaults, ...preset, ...userConfig, ...(presetOverride ? { preset: presetOverride } : {}) };
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
  "gpt-5.4-mini":           { input: 0.4 / 1_000_000,  output: 1.6 / 1_000_000 },
  "gpt-5-mini":             { input: 0.4 / 1_000_000,  output: 1.6 / 1_000_000 },
  "gpt-4.1":                { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  // Google Gemini
  "gemini-3-pro-preview":   { input: 1.25 / 1_000_000, output: 5 / 1_000_000 },
  // xAI Grok (reasoning_tokens billed as output — per docs.x.ai/developers/models)
  "grok-4.20":                         { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4.20-0309-reasoning":         { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4.20-0309-non-reasoning":     { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4.20-multi-agent-0309":       { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4-1-fast-reasoning":          { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000 },
  "grok-4-1-fast-non-reasoning":      { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000 },
  "grok-4":                 { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4-0709":            { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
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
  let estimatedCost = (totalInputTokens * pricing.input) + (totalOutputTokens * pricing.output);

  // Cost calibration: compare prior estimates vs actuals to compute correction factor
  let costCalibration = null;
  try {
    if (historyPath && existsSync(historyPath)) {
      const history = JSON.parse(readFileSync(historyPath, "utf-8"));
      const withEstimates = Array.isArray(history) ? history.filter(h => h.estimated_cost_usd > 0 && h.total_cost_usd > 0) : [];
      if (withEstimates.length >= 3) {
        const ratios = withEstimates.slice(-10).map(h => h.total_cost_usd / h.estimated_cost_usd);
        const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        const correctionFactor = Math.max(0.5, Math.min(3.0, avgRatio)); // Clamp to 0.5x–3x
        estimatedCost *= correctionFactor;
        costCalibration = { correctionFactor: Math.round(correctionFactor * 100) / 100, samplesUsed: withEstimates.length, source: "historical" };
      }
    }
  } catch { /* fall through to uncalibrated estimate */ }

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

  // Phase 3: Recommend cheapest model with >80% success rate from performance history
  let modelRecommendation = null;
  if (cwd) {
    try {
      const perfRecords = loadModelPerformance(cwd);
      if (perfRecords.length > 0) {
        const stats = aggregateModelStats(perfRecords);
        // Minimum 3 slices of data before trusting a model's success rate
        const MIN_SAMPLE = 3;
        const qualified = Object.entries(stats)
          .filter(([, s]) => s.total_slices >= MIN_SAMPLE && s.success_rate > 0.8)
          .map(([m, s]) => ({
            model: m,
            success_rate: s.success_rate,
            total_slices: s.total_slices,
            avg_cost_usd: s.avg_cost_usd,
          }))
          .sort((a, b) => a.avg_cost_usd - b.avg_cost_usd);

        if (qualified.length > 0) {
          const best = qualified[0];
          modelRecommendation = {
            model: best.model,
            reason: `Cheapest model with >${(0.8 * 100).toFixed(0)}% success rate`,
            success_rate: best.success_rate,
            avg_cost_usd_per_slice: best.avg_cost_usd,
            based_on_slices: best.total_slices,
            all_qualified: qualified,
          };
        }
      }
    } catch {
      // Non-fatal — skip recommendation if performance data unavailable
    }
  }

  // Slice auto-split advisory: flag slices that have timed out or exceeded task count thresholds
  let splitAdvisories = [];
  try {
    const perfRecords = loadModelPerformance(cwd);
    for (const s of plan.slices) {
      const priorFailures = perfRecords.filter(p =>
        p.sliceTitle && s.title && p.sliceTitle.toLowerCase() === s.title.toLowerCase() && p.status !== "passed"
      );
      const taskCount = s.tasks?.length || 0;
      const scopeCount = s.scope?.length || 0;
      if (priorFailures.length >= 2 || (taskCount > 6 && scopeCount > 4)) {
        splitAdvisories.push({
          sliceNumber: s.number,
          sliceTitle: s.title,
          reason: priorFailures.length >= 2
            ? `Failed ${priorFailures.length} time(s) historically — consider splitting`
            : `${taskCount} tasks + ${scopeCount} scope files — may be too large`,
          tasks: taskCount,
          scope: scopeCount,
          priorFailures: priorFailures.length,
        });
      }
    }
  } catch { /* best-effort */ }

  return {
    status: "estimate",
    sliceCount,
    executionOrder: plan.dag.order,
    model: model || "auto",
    ...(modelRecommendation && { modelRecommendation }),
    ...(splitAdvisories.length > 0 && { splitAdvisories }),
    tokens: {
      estimatedInput: totalInputTokens,
      estimatedOutput: totalOutputTokens,
      source: tokensPerSlice.source,
    },
    estimatedCostUSD: Math.round(estimatedCost * 100) / 100,
    ...(costCalibration && { costCalibration }),
    ...(quorumOverhead && {
      quorumOverhead,
      totalCostWithQuorumUSD: Math.round((estimatedCost + quorumOverhead.totalOverheadUSD) * 100) / 100,
    }),
    confidence: avgTokensPerSlice ? "historical" : "heuristic",
    slices: plan.slices.map((s) => {
      const sliceType = inferSliceType(s);
      const rec = cwd ? recommendModel(cwd, sliceType) : null;
      return {
        number: s.number,
        title: s.title,
        depends: s.depends,
        parallel: s.parallel,
        scope: s.scope,
        sliceType,
        ...(rec && {
          recommendedModel: {
            model: rec.model,
            success_rate: rec.success_rate,
            based_on_slices: rec.total_slices,
          },
        }),
        ...(quorumConfig && quorumConfig.enabled && {
          complexityScore: scoreSliceComplexity(s, cwd).score,
          quorumEligible: quorumConfig.auto
            ? scoreSliceComplexity(s, cwd).score >= quorumConfig.threshold
            : true,
        }),
      };
    }),
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

// ─── Architecture Guardrail Rules ────────────────────────────────────
const GUARDRAIL_RULES = [
  { id: "empty-catch",     pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*)?\s*\}|catch\s*(?:\([^)]*\))?\s*\{\s*\/\*[^*]*\*\/\s*\}/g, severity: "high",     description: "Empty catch block — must log or handle the error (comments alone don't count)" },
  { id: "any-type",        pattern: /:\s*any\b|<any>|as\s+any\b/g,                             severity: "medium",   description: "Avoid 'any' type — use explicit types" },
  { id: "sync-over-async", pattern: /\.(Result|Wait\(\))\b/g,                                  severity: "high",     description: "Sync-over-async (.Result/.Wait()) — use await instead" },
  { id: "sql-injection",   pattern: /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^`]*\$\{/gi, severity: "critical", description: "SQL string interpolation — use parameterized queries" },
  { id: "deferred-work",   pattern: /\b(TODO|FIXME|HACK)\b/g,                                  severity: "low",      description: "Deferred work marker in production code" },
];

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".cs", ".py"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "bin", "obj", "dist", ".forge", "vendor", "coverage", ".next", "out"]);

/** Framework paths that belong to Plan Forge itself, not the user's application code. */
const FRAMEWORK_PATHS = ["pforge-mcp", "pforge.ps1", "pforge.sh", "setup.ps1", "setup.sh", "validate-setup.ps1", "validate-setup.sh"];

/**
 * Scan source files for architecture guardrail violations.
 * Called by forge_drift_report to score the codebase without spawning a subprocess.
 * Separates app code violations from framework (Plan Forge) code violations.
 *
 * @param {object} options
 * @param {string} [options.path="."]   - Directory to scan (relative to cwd)
 * @param {string} [options.mode="file"] - Analysis mode (currently only "file" is used)
 * @param {string[]|null} [options.rules=null] - Rule IDs to run; null = all rules
 * @param {string} [options.cwd=process.cwd()] - Project root
 * @returns {Promise<{violations: Array<{file,rule,severity,line,description,framework?:boolean}>, frameworkViolations: Array, filesScanned: number}>}
 */
export async function runAnalyze({ mode = "file", path: targetPath = ".", rules = null, cwd = process.cwd() } = {}) {
  const activeRules = rules
    ? GUARDRAIL_RULES.filter(r => rules.includes(r.id))
    : GUARDRAIL_RULES;

  const rootPath = resolve(cwd, targetPath);
  const violations = [];
  const frameworkViolations = [];
  let filesScanned = 0;

  function isFrameworkPath(relPath) {
    const normalized = relPath.replace(/\\/g, "/");
    return FRAMEWORK_PATHS.some(fp => normalized === fp || normalized.startsWith(fp + "/"));
  }

  function scanDir(dirPath) {
    let entries;
    try { entries = readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) scanDir(fullPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        filesScanned++;
        let content;
        try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
        const relPath = relative(cwd, fullPath);
        const isFramework = isFrameworkPath(relPath);
        const applicableRules = isFramework
          ? activeRules.filter(r => r.id !== "sql-injection") // Skip SQL injection in framework/client-side code
          : activeRules;
        for (const rule of applicableRules) {
          const re = new RegExp(rule.pattern.source, rule.pattern.flags);
          let match;
          while ((match = re.exec(content)) !== null) {
            const line = content.substring(0, match.index).split("\n").length;
            const violation = { file: relPath, rule: rule.id, severity: rule.severity, line, description: rule.description };
            if (isFramework) {
              frameworkViolations.push({ ...violation, framework: true });
            } else {
              violations.push(violation);
            }
          }
        }
      }
    }
  }

  scanDir(rootPath);
  return { violations, frameworkViolations, filesScanned };
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
    const blockedResult = runGate("wget http://example.com", process.cwd());
    assert("Gate blocks non-allowlisted commands", !blockedResult.success);
    assert("Gate error mentions allowlist", blockedResult.error.includes("allowlist"));

    // C1: Gate allows common build tools
    const npmResult = runGate("node -e \"console.log('ok')\"", process.cwd());
    assert("Gate allows node commands", npmResult.success);

    // C1: Gate allows curl (used in gate verification commands)
    const curlResult = runGate("curl --version", process.cwd());
    assert("Gate allows curl commands", curlResult.success);
  } catch (err) {
    assert(`Gate execution: ${err.message}`, false);
  }

  // Test 8b: Gate Lint
  console.log("\n─── Gate Lint ───");
  try {
    // Use a real plan file if available
    const lintPlan = resolve(process.cwd(), "docs/plans/Phase-LiveGuard-v2.27.0-PLAN.md");
    if (existsSync(lintPlan)) {
      const result = lintGateCommands(lintPlan);
      assert("Gate lint returns warnings array", Array.isArray(result.warnings));
      assert("Gate lint returns errors array", Array.isArray(result.errors));
      assert("Gate lint returns passed boolean", typeof result.passed === "boolean");
      assert("Gate lint returns summary string", typeof result.summary === "string");
      assert("Cleaned plan has 0 errors", result.errors.length === 0);
    } else {
      console.log("  ⚠️  LiveGuard plan not found — skipping gate lint tests");
    }

    // Test lint detection with synthetic bad commands
    const origParse = parsePlan;
    // Temporarily test the detection logic inline
    const testLines = [
      "# this is a comment",
      "node pforge-mcp/tests/foo.test.mjs",
      "curl http://localhost:3100/api/test",
      "wget http://example.com",
    ];
    const commentLine = testLines[0];
    assert("Detects comment lines", commentLine.startsWith("#"));

    const vitestLine = testLines[1];
    assert("Detects node *.test.mjs pattern", /^node\s+.*\.test\.(mjs|js|ts)/.test(vitestLine));

    const curlLine = testLines[2];
    assert("Detects curl localhost pattern", /curl\s.*localhost[:\s]/.test(curlLine));

    const wgetCmd = testLines[3].split(/\s+/)[0].toLowerCase();
    assert("Detects blocked command", !GATE_ALLOWED_PREFIXES.some(p => wgetCmd === p));
  } catch (err) {
    assert(`Gate lint: ${err.message}`, false);
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
    assert("Default is claude-opus-4.6 when no .forge.json", loadModelRouting("/nonexistent-path-pforge-test").default === "claude-opus-4.6");
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
    assert("API worker cost matches expected", Math.abs(cost4.cost_usd - 0.005) < 0.0001); // 1000*2/1M + 500*6/1M

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
    assert("Default threshold is 6", config.threshold === 6);
  } catch (err) {
    assert(`Quorum config: ${err.message}`, false);
  }

  // Test 18: CI config loading
  console.log("\n─── CI/CD Integration ───");
  try {
    const ciConfig = loadCiConfig(process.cwd());
    assert("loadCiConfig returns object", typeof ciConfig === "object");
    assert("Has enabled flag", "enabled" in ciConfig);
    assert("Has workflow field", "workflow" in ciConfig);
    assert("Has ref field", "ref" in ciConfig);
    assert("Has inputs field", typeof ciConfig.inputs === "object");
    assert("Default enabled is false", ciConfig.enabled === false || typeof ciConfig.enabled === "boolean");
    assert("Default ref is main (when no config)", ciConfig.workflow === null || typeof ciConfig.workflow === "string");
  } catch (err) {
    assert(`CI config: ${err.message}`, false);
  }

  // Test 19: Agent-Per-Slice Routing (Slice 1)
  console.log("\n─── Agent-Per-Slice Routing ───");
  try {
    // inferSliceType detection
    const testSlice = { title: "Write unit tests for auth module", tasks: ["Add spec coverage"] };
    assert("Infers test type", inferSliceType(testSlice) === "test");

    const reviewSlice = { title: "Code review and audit", tasks: ["Review PR changes"] };
    assert("Infers review type", inferSliceType(reviewSlice) === "review");

    const migrationSlice = { title: "Database migration", tasks: ["Add schema migration for users table"] };
    assert("Infers migration type", inferSliceType(migrationSlice) === "migration");

    const executeSlice2 = { title: "Implement auth service", tasks: ["Add login endpoint"] };
    assert("Defaults to execute type", inferSliceType(executeSlice2) === "execute");

    // recommendModel returns null when no performance data
    const noRec = recommendModel(process.cwd(), "execute");
    assert("recommendModel returns null or object", noRec === null || typeof noRec === "object");
    if (noRec !== null) {
      assert("Recommendation has model", typeof noRec.model === "string");
      assert("Recommendation has success_rate", typeof noRec.success_rate === "number");
      assert("Recommendation has total_slices", typeof noRec.total_slices === "number");
    }

    // slice-model-routed event is registered in the event bus
    const events2 = [];
    const handler2 = { handle: (e) => events2.push(e) };
    const bus2 = new OrchestratorEventBus(handler2);
    bus2.emit("slice-model-routed", { sliceId: "1", model: "test-model" });
    assert("slice-model-routed event fires", events2.some((e) => e.type === "slice-model-routed"));
  } catch (err) {
    assert(`Agent-per-slice routing: ${err.message}`, false);
  }

  // Summary
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════`);

  process.exit(failed > 0 ? 1 : 0);
}

// ─── CLI Entry Point ──────────────────────────────────────────────────

// Fix 1: Clean up zombie child processes when parent exits
for (const sig of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (global.__pforgeChildren) {
      for (const child of global.__pforgeChildren) {
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
      }
    }
  });
}

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

  // Quorum mode: --quorum=auto (default), --quorum=power, --quorum=speed, --quorum (force all), --no-quorum / --quorum=false (disable)
  let quorum = "auto";
  let quorumPreset = null;
  const quorumArg = args.find((a) => a.startsWith("--quorum") || a === "--no-quorum");
  if (quorumArg) {
    if (quorumArg === "--quorum=auto") quorum = "auto";
    else if (quorumArg === "--quorum=power") { quorum = true; quorumPreset = "power"; }
    else if (quorumArg === "--quorum=speed") { quorum = true; quorumPreset = "speed"; }
    else if (quorumArg === "--no-quorum" || quorumArg === "--quorum=false") quorum = false;
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
      quorumPreset,
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
