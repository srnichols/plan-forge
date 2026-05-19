/**
 * Plan Forge — Unified Telemetry (v2.4)
 *
 * OTLP-compatible trace/span/log capture for end-to-end observability.
 * Writes trace.json, manifest.json, and index.jsonl per run.
 *
 * @module telemetry
 */

import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname, type as osType } from "node:os";
import { execSync } from "node:child_process";

// Severity levels per OTLP convention
export const Severity = {
  TRACE: { text: "TRACE", number: 1 },
  DEBUG: { text: "DEBUG", number: 5 },
  INFO:  { text: "INFO",  number: 9 },
  WARN:  { text: "WARN",  number: 13 },
  ERROR: { text: "ERROR", number: 17 },
  FATAL: { text: "FATAL", number: 21 },
};

/**
 * Create trace context for a new run.
 */
export function createTraceContext(planPath, options = {}) {
  const { mode = "auto", model = "auto", sliceCount = 0 } = options;

  // Resource context — who/where/what
  let userName = "unknown";
  try { userName = execSync("git config user.name", { encoding: "utf-8", timeout: 5000 }).trim(); } catch { /* ignore */ }

  const traceId = randomUUID().replace(/-/g, "").substring(0, 32);

  return {
    resource: {
      "service.name": "plan-forge-orchestrator",
      "service.version": "2.4.0",
      "host.name": hostname(),
      "os.type": osType(),
      "user.name": userName,
      "project.name": basename(process.cwd()),
    },
    traceId,
    plan: planPath,
    mode,
    model,
    sliceCount,
    spans: [],
    _activeSpans: new Map(),
    _startTime: new Date().toISOString(),
  };
}

/**
 * Start a root span (run-plan).
 */
export function startRootSpan(trace, name, attributes = {}) {
  const span = {
    spanId: randomUUID().replace(/-/g, "").substring(0, 16),
    parentSpanId: null,
    name,
    kind: "SERVER",
    startTime: new Date().toISOString(),
    endTime: null,
    status: "UNSET",
    attributes,
    events: [],
    logSummary: [],
  };
  trace.spans.push(span);
  trace._activeSpans.set(name, span);
  return span;
}

/**
 * Start a child span (slice, worker, gate).
 */
export function startSpan(trace, name, parentSpanId, kind = "INTERNAL", attributes = {}) {
  const span = {
    spanId: randomUUID().replace(/-/g, "").substring(0, 16),
    parentSpanId,
    name,
    kind,
    startTime: new Date().toISOString(),
    endTime: null,
    status: "UNSET",
    attributes,
    events: [],
    logSummary: [],
  };
  trace.spans.push(span);
  trace._activeSpans.set(name, span);
  return span;
}

/**
 * End a span with status.
 */
export function endSpan(span, status = "OK") {
  span.endTime = new Date().toISOString();
  span.status = status;
}

/**
 * Add an event to a span.
 */
export function addEvent(span, name, severity = Severity.INFO, attributes = {}) {
  span.events.push({
    time: new Date().toISOString(),
    name,
    severity: severity.text,
    severityNumber: severity.number,
    attributes,
  });
}

/**
 * Add log summary lines to a span (extracted from worker output).
 */
export function addLogSummary(span, output) {
  if (!output) return;
  const lines = output.split("\n");
  const patterns = /creat|modif|writ|delet|error|fail|warn|pass|compil|test|build/i;
  const summary = lines
    .filter((l) => patterns.test(l))
    .slice(0, 50)
    .map((l) => l.trim().substring(0, 200));
  span.logSummary = summary;
}

// ─── Trace Writer ─────────────────────────────────────────────────────

/**
 * Write trace.json to the run directory.
 */
export function writeTrace(trace, runDir) {
  const output = {
    resource: trace.resource,
    traceId: trace.traceId,
    spans: trace.spans.map((s) => ({
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      name: s.name,
      kind: s.kind,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      attributes: s.attributes,
      events: s.events,
      logSummary: s.logSummary,
    })),
  };
  writeFileSync(resolve(runDir, "trace.json"), JSON.stringify(output, null, 2));
}

// ─── Manifest + Index (Log Registry) ──────────────────────────────────

/**
 * Write manifest.json for a completed run.
 */
export function writeManifest(runDir, runId, summary) {
  const files = [];
  const checkFile = (name) => {
    const path = resolve(runDir, name);
    if (existsSync(path)) files.push(name);
  };

  checkFile("run.json");
  checkFile("summary.json");
  checkFile("trace.json");
  checkFile("events.log");

  // Find slice files
  const slices = [];
  try {
    const entries = readdirSync(runDir);
    const sliceJsonFiles = entries.filter((f) => /^slice-[\d.]+\.json$/.test(f)).sort();
    for (const sjf of sliceJsonFiles) {
      const num = sjf.match(/slice-([\d.]+)\.json/)?.[1];
      if (!num) continue;
      const logFile = `slice-${num}-log.txt`;
      slices.push({
        number: num,
        result: sjf,
        log: entries.includes(logFile) ? logFile : null,
        status: summary?.sliceResults?.find((r) => String(r.number || r.sliceId) === num)?.status || "unknown",
      });
    }
  } catch { /* ignore */ }

  const manifest = {
    runId,
    traceId: summary?.traceId || null,
    plan: summary?.plan || null,
    startTime: summary?.startTime || null,
    endTime: summary?.endTime || null,
    status: summary?.status || "unknown",
    artifacts: files,
    slices,
  };

  writeFileSync(resolve(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Append a run entry to .forge/runs/index.jsonl.
 * JSONL format — one JSON object per line, safe for concurrent appends.
 */
export function appendRunIndex(cwd, runId, manifest) {
  const indexPath = resolve(cwd, ".forge", "runs", "index.jsonl");
  mkdirSync(resolve(cwd, ".forge", "runs"), { recursive: true });

  const entry = JSON.stringify({
    runId,
    plan: manifest.plan,
    status: manifest.status,
    startTime: manifest.startTime,
    endTime: manifest.endTime,
    dir: runId,
    sliceCount: manifest.slices?.length || 0,
  });

  appendFileSync(indexPath, entry + "\n");
}

/**
 * Read the run index. Skips malformed lines (corruption recovery).
 */
export function readRunIndex(cwd) {
  const indexPath = resolve(cwd, ".forge", "runs", "index.jsonl");
  if (!existsSync(indexPath)) return [];

  const lines = readFileSync(indexPath, "utf-8").split("\n").filter((l) => l.trim());
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines (corruption recovery — Gap 6)
      continue;
    }
  }
  return entries;
}

// ─── Log Rotation ─────────────────────────────────────────────────────

/**
 * Prune old run directories beyond maxRunHistory.
 */
export function pruneRunHistory(cwd, maxRunHistory = 50) {
  const runsDir = resolve(cwd, ".forge", "runs");
  if (!existsSync(runsDir)) return;

  const dirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  if (dirs.length <= maxRunHistory) return;

  const toRemove = dirs.slice(maxRunHistory);
  for (const dir of toRemove) {
    try {
      rmSync(resolve(runsDir, dir), { recursive: true, force: true });
    } catch { /* best effort */ }
  }

  // Compact index — remove entries for deleted directories
  const indexPath = resolve(runsDir, "index.jsonl");
  if (existsSync(indexPath)) {
    const remaining = new Set(dirs.slice(0, maxRunHistory));
    const entries = readRunIndex(cwd).filter((e) => remaining.has(e.dir));
    writeFileSync(indexPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
}

// ─── OTel Chat Span Emitter ────────────────────────────────────────────

// Singleton tracer promise — resolved once per process lifetime.
let _otelTracerPromise = null;

// Singleton meter promise — resolved once per process lifetime.
let _otelMeterPromise = null;

/**
 * Lazily initialize the OTel tracer when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * All OTel packages are loaded via dynamic import (optional deps).
 * Returns null if the endpoint is unset or if packages are unavailable.
 * @returns {Promise<object|null>}
 */
async function _getOtelTracer() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  if (_otelTracerPromise !== null) return _otelTracerPromise;

  _otelTracerPromise = (async () => {
    try {
      const { initOtel } = await import("./otel-init.mjs");
      await initOtel();
      const { trace } = await import("@opentelemetry/api");
      return trace.getTracer("pforge-mcp", "2.4.0");
    } catch {
      // Optional packages not installed — graceful no-op.
      return null;
    }
  })();

  return _otelTracerPromise;
}

/**
 * Lazily initialize the OTel meter when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * All OTel packages are loaded via dynamic import (optional deps).
 * Returns null if the endpoint is unset or if packages are unavailable.
 * @returns {Promise<object|null>}
 */
async function _getOtelMeter() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  if (_otelMeterPromise !== null) return _otelMeterPromise;

  _otelMeterPromise = (async () => {
    try {
      const { initOtel } = await import("./otel-init.mjs");
      await initOtel();
      const { metrics } = await import("@opentelemetry/api");
      return metrics.getMeter("pforge-mcp", "2.4.0");
    } catch {
      // Optional packages not installed — graceful no-op.
      return null;
    }
  })();

  return _otelMeterPromise;
}

/**
 * Record gen_ai.client.operation.duration and gen_ai.client.token.usage histograms.
 * Fires and forgets — caller should not await (never throws).
 *
 * Histogram names follow the OpenTelemetry GenAI semantic conventions:
 *   gen_ai.client.operation.duration — unit: s
 *   gen_ai.client.token.usage        — unit: {token}, split by gen_ai.token.type
 *
 * @param {object} data - Same payload as _emitChatSpan.
 */
function _buildOtelBaseAttrs(data, model) {
  const provider = data?.provider ?? _inferProvider(model);
  return {
    "gen_ai.operation.name": "chat",
    "gen_ai.system": provider,
    "gen_ai.request.model": data?.requestModel ?? model,
    "gen_ai.response.model": data?.responseModel ?? model,
  };
}

function _extractOtelTokenCounts(data) {
  return {
    tokensIn: data?.tokens?.tokens_in ?? data?.tokensIn ?? 0,
    tokensOut: data?.tokens?.tokens_out ?? data?.tokensOut ?? 0,
  };
}

async function _recordChatMetrics(data) {
  try {
    const meter = await _getOtelMeter();
    if (!meter) return;

    const model = data?.model ?? "unknown";
    const baseAttrs = _buildOtelBaseAttrs(data, model);
    const durationMs = data?.durationMs ?? data?.duration ?? 0;

    meter.createHistogram("gen_ai.client.operation.duration", {
      description: "GenAI operation duration", unit: "s",
    }).record(durationMs / 1000, baseAttrs);

    const tokenHist = meter.createHistogram("gen_ai.client.token.usage", {
      description: "GenAI token usage", unit: "{token}",
    });
    const { tokensIn, tokensOut } = _extractOtelTokenCounts(data);
    if (tokensIn > 0) tokenHist.record(tokensIn, { ...baseAttrs, "gen_ai.token.type": "input" });
    if (tokensOut > 0) tokenHist.record(tokensOut, { ...baseAttrs, "gen_ai.token.type": "output" });
  } catch {
    // Never surface OTel errors to the orchestrator.
  }
}

/**
 * Infer the gen_ai.provider.name from a model identifier string.
 * @param {string} model
 * @returns {string}
 */
function _inferProvider(model) {
  if (!model) return "unknown";
  if (/^gpt-|^o[1-9]/.test(model)) return "openai";
  if (/^claude/.test(model)) return "anthropic";
  if (/^grok/.test(model)) return "xai";
  if (/^gemini/.test(model)) return "google";
  if (/^mistral/.test(model)) return "mistralai";
  return "unknown";
}

/**
 * Emit a `gen_ai.chat <model>` span to the OTLP endpoint.
 * Fires and forgets — caller should not await (never throws).
 *
 * @param {object} data - Payload from the `chat-completed` orchestrator event.
 *   Expected fields: model, requestModel, responseModel, provider,
 *   tokens.tokens_in, tokens.tokens_out, cost_usd, sliceId, runId.
 */
function _buildChatSpanAttrs(data, model) {
  const { tokensIn, tokensOut } = _extractOtelTokenCounts(data);
  return {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": data?.provider ?? _inferProvider(model),
    "gen_ai.request.model": data?.requestModel ?? model,
    "gen_ai.response.model": data?.responseModel ?? model,
    "gen_ai.usage.input_tokens": tokensIn,
    "gen_ai.usage.output_tokens": tokensOut,
    "pforge.cost.usd": data?.cost_usd ?? data?.costUsd ?? 0,
    "pforge.slice.number": String(data?.sliceId ?? ""),
    "pforge.run.id": data?.runId ?? "",
  };
}

async function _emitChatSpan(data) {
  try {
    const tracer = await _getOtelTracer();
    if (!tracer) return;

    const model = data?.model ?? "unknown";
    const span = tracer.startSpan(`gen_ai.chat ${model}`, {
      kind: 3, // SpanKind.CLIENT
      attributes: _buildChatSpanAttrs(data, model),
    });
    span.end();

    await _recordChatMetrics(data);
  } catch {
    // Never surface OTel errors to the orchestrator.
  }
}

// ─── OTel Agent (Slice) Span Emitter ──────────────────────────────────

/**
 * Emit an `invoke_agent slice-N` span to the OTLP endpoint.
 * Fires and forgets — caller should not await (never throws).
 *
 * @param {object} data - Payload from the `slice-started` orchestrator event.
 *   Expected fields: sliceId, title, planName, planCommitSha, runId.
 */
async function _emitAgentSpan(data) {
  try {
    const tracer = await _getOtelTracer();
    if (!tracer) return;

    const sliceId = data?.sliceId ?? "";
    const span = tracer.startSpan(`invoke_agent slice-${sliceId}`, {
      kind: 3, // SpanKind.CLIENT
      attributes: {
        "gen_ai.agent.name": `slice-${sliceId}`,
        "gen_ai.agent.version": data?.planCommitSha ?? "",
        "pforge.plan.name": data?.planName ?? data?.plan ?? "",
        "pforge.slice.number": String(sliceId),
        "pforge.run.id": data?.runId ?? "",
        "pforge.actor.source": data?.source ?? "",
        "pforge.action.security_risk": data?.security_risk ?? "",
      },
    });

    span.end();
  } catch {
    // Never surface OTel errors to the orchestrator.
  }
}

/**
 * Public fire-and-forget entry point for agent-span emission.
 * Called by the telemetry handler on slice-started events.
 *
 * @param {{ sliceId: string|number, title?: string, planName?: string, planCommitSha?: string, runId?: string }} data
 */
export function emitAgentSpan(data) {
  _emitAgentSpan(data).catch(() => {});
}

// ─── OTel Workflow (Plan) Span Emitter ────────────────────────────────

/**
 * Emit an `invoke_workflow <plan>` span to the OTLP endpoint.
 * Fires and forgets — caller should not await (never throws).
 *
 * @param {object} data - Payload from the `run-started` orchestrator event.
 *   Expected fields: plan, planCommitSha, mode, model, sliceCount, runId, quorumMode, quorumThreshold.
 */
async function _emitWorkflowSpan(data) {
  try {
    const tracer = await _getOtelTracer();
    if (!tracer) return;

    const plan = data?.plan ?? "unknown";
    const span = tracer.startSpan(`invoke_workflow ${plan}`, {
      kind: 3, // SpanKind.CLIENT
      attributes: {
        "gen_ai.workflow.name": plan,
        "pforge.plan.path": plan,
        "pforge.plan.commit_sha": data?.planCommitSha ?? "",
        "pforge.quorum.mode": data?.quorumMode ?? data?.mode ?? "",
        "pforge.quorum.threshold": data?.quorumThreshold ?? 0,
        "pforge.run.id": data?.runId ?? "",
      },
    });

    span.end();
  } catch {
    // Never surface OTel errors to the orchestrator.
  }
}

/**
 * Public fire-and-forget entry point for workflow-span emission.
 * Called by the telemetry handler on run-started events.
 *
 * @param {{ plan: string, planCommitSha?: string, mode?: string, quorumMode?: string, quorumThreshold?: number, runId?: string }} data
 */
export function emitWorkflowSpan(data) {
  _emitWorkflowSpan(data).catch(() => {});
}

// ─── OTel Tool Span Emitter ────────────────────────────────────────────

/**
 * Emit an `execute_tool <tool_name>` span to the OTLP endpoint.
 * Fires and forgets — caller should not await (never throws).
 *
 * @param {object} data - Payload from the tool dispatcher wrapper.
 *   Expected fields: toolName, durationMs, isError, runId.
 */
async function _emitToolSpan(data) {
  try {
    const tracer = await _getOtelTracer();
    if (!tracer) return;

    const toolName = data?.toolName ?? "unknown";
    const durationMs = data?.durationMs ?? 0;
    const startTime = new Date(Date.now() - durationMs);

    const span = tracer.startSpan(`execute_tool ${toolName}`, {
      kind: 3, // SpanKind.CLIENT
      startTime,
      attributes: {
        "pforge.tool.name": toolName,
        "pforge.tool.duration_ms": durationMs,
        "pforge.tool.error": data?.isError ?? false,
        "pforge.run.id": data?.runId ?? "",
      },
    });

    span.end();
  } catch {
    // Never surface OTel errors to the dispatcher.
  }
}

/**
 * Public fire-and-forget entry point for tool-span emission.
 * Called by the server.mjs wrap layer after each MCP tool invocation.
 *
 * @param {{ toolName: string, durationMs: number, isError: boolean, runId?: string }} data
 */
export function emitToolSpan(data) {
  _emitToolSpan(data).catch(() => {});
}

// ─── OTel Gate Span Emitter ───────────────────────────────────────────

/**
 * Emit a `run_gate slice-N` span to the OTLP endpoint.
 * Fires and forgets — caller should not await (never throws).
 *
 * @param {object} data - Payload from the `gate-passed` orchestrator event.
 *   Expected fields: sliceId, runId, failOpen, durationMs.
 */
async function _emitGateSpan(data) {
  try {
    const tracer = await _getOtelTracer();
    if (!tracer) return;

    const sliceId = data?.sliceId ?? "";
    const durationMs = data?.durationMs ?? 0;
    const startTime = durationMs ? new Date(Date.now() - durationMs) : new Date();

    const span = tracer.startSpan(`run_gate slice-${sliceId}`, {
      kind: 3, // SpanKind.CLIENT
      startTime,
      attributes: {
        "pforge.gate.passed": !(data?.failed ?? false),
        "pforge.gate.fail_open": data?.failOpen ?? false,
        "pforge.slice.number": String(sliceId),
        "pforge.run.id": data?.runId ?? "",
      },
    });

    span.end();
  } catch {
    // Never surface OTel errors to the orchestrator.
  }
}

/**
 * Public fire-and-forget entry point for gate-span emission.
 * Called by the telemetry handler on gate-passed events.
 *
 * @param {{ sliceId: string|number, runId?: string, failOpen?: boolean, durationMs?: number }} data
 */
export function emitGateSpan(data) {
  _emitGateSpan(data).catch(() => {});
}

// ─── Orchestrator Event Handler for Telemetry ─────────────────────────

/**
 * Create a telemetry event handler that builds trace.json from orchestrator events.
 * Plug this into the orchestrator via DI (eventHandler option).
 */
export function createTelemetryHandler(trace, runDir) {
  const state = { rootSpan: null };

  function onRunStarted(data) {
    state.rootSpan = startRootSpan(trace, "run-plan", {
      plan: data?.plan,
      mode: data?.mode,
      model: data?.model,
      sliceCount: data?.sliceCount,
    });
    _emitWorkflowSpan({ ...data, runId: trace.traceId }).catch(() => {});
  }

  function onSliceStarted(data) {
    const parentId = state.rootSpan?.spanId || null;
    startSpan(trace, `slice-${data?.sliceId}`, parentId, "INTERNAL", {
      sliceId: data?.sliceId,
      title: data?.title,
      parallel: data?.parallel || false,
      "pforge.actor.source": data?.source ?? null,
      "pforge.action.security_risk": data?.security_risk ?? null,
    });
    _emitAgentSpan({ ...data, runId: trace.traceId }).catch(() => {});
  }

  function onSliceCompleted(data) {
    const span = trace._activeSpans.get(`slice-${data?.sliceId}`);
    if (!span) return;
    addEvent(span, "completed", Severity.INFO, {
      duration: data?.duration,
      model: data?.model,
      tokens_out: data?.tokens?.tokens_out,
      cost_usd: data?.tokens?.cost_usd,
      attempts: data?.attempts,
    });
    span.attributes.duration = data?.duration;
    span.attributes.model = data?.model;
    span.attributes.cost_usd = data?.cost_usd;
    span.attributes.attempts = data?.attempts;
    endSpan(span, "OK");
  }

  function onSliceFailed(data) {
    const span = trace._activeSpans.get(`slice-${data?.sliceId}`);
    if (!span) return;
    addEvent(span, "failed", Severity.ERROR, {
      error: data?.error,
      failedCommand: data?.failedCommand,
      gateError: data?.gateError,
    });
    endSpan(span, "ERROR");
  }

  function onRunCompleted(data) {
    if (state.rootSpan) {
      addEvent(state.rootSpan, "completed", Severity.INFO, {
        status: data?.status,
        passed: data?.results?.passed,
        failed: data?.results?.failed,
        report: data?.report,
      });
      endSpan(state.rootSpan, data?.status === "completed" ? "OK" : "ERROR");
    }
    writeTrace(trace, runDir);
  }

  function onRunAborted(data) {
    if (state.rootSpan) {
      addEvent(state.rootSpan, "aborted", Severity.WARN, { reason: data?.reason });
      endSpan(state.rootSpan, "ERROR");
    }
    writeTrace(trace, runDir);
  }

  function onQuorumDispatchStarted(data) {
    const parentSpan = trace._activeSpans.get(`slice-${data?.sliceId}`);
    if (!parentSpan) return;
    addEvent(parentSpan, "quorum-dispatch", Severity.INFO, {
      models: data?.models,
      score: data?.score,
    });
    for (let i = 0; i < (data?.models || []).length; i++) {
      startSpan(trace, `slice-${data?.sliceId}-quorum-${i}`, parentSpan.spanId, "CLIENT", {
        quorumLeg: i,
        model: data.models[i],
      });
    }
  }

  function endQuorumLegByModel(data) {
    for (const [key, span] of trace._activeSpans) {
      if (key.startsWith(`slice-${data?.sliceId}-quorum-`) && span.attributes?.model === data?.model) {
        addEvent(span, "leg-completed", data?.success ? Severity.INFO : Severity.WARN, {
          model: data?.model,
          duration: data?.duration,
          tokens_out: data?.tokens?.tokens_out,
        });
        endSpan(span, data?.success ? "OK" : "ERROR");
        break;
      }
    }
  }

  function onQuorumLegCompleted(data) {
    const legSpan = trace._activeSpans.get(`slice-${data?.sliceId}-quorum-${data?.legIndex ?? ""}`);
    if (!legSpan) {
      endQuorumLegByModel(data);
      return;
    }
    endSpan(legSpan, data?.success ? "OK" : "ERROR");
  }

  function onQuorumReviewCompleted(data) {
    const parentSpan = trace._activeSpans.get(`slice-${data?.sliceId}`);
    if (!parentSpan) return;
    addEvent(parentSpan, "quorum-review", Severity.INFO, {
      reviewerModel: data?.reviewerModel,
      tokens_out: data?.tokens?.tokens_out,
      modelCount: data?.modelCount,
    });
  }

  function onGatePassed(data) {
    const parentSpan = trace._activeSpans.get(`slice-${data?.sliceId}`);
    if (parentSpan) {
      addEvent(parentSpan, "gate-passed", Severity.INFO, {
        failOpen: data?.failOpen ?? false,
      });
    }
    _emitGateSpan({ ...data, runId: trace.traceId }).catch(() => {});
  }

  function onChatCompleted(data) {
    const parentSpan = trace._activeSpans.get(`slice-${data?.sliceId}`);
    if (parentSpan) {
      addEvent(parentSpan, "chat-completed", Severity.INFO, {
        model: data?.model,
        tokens_in: data?.tokens?.tokens_in ?? data?.tokensIn,
        tokens_out: data?.tokens?.tokens_out ?? data?.tokensOut,
        cost_usd: data?.cost_usd ?? data?.costUsd,
      });
    }
    _emitChatSpan({ ...data, runId: trace.traceId }).catch(() => {});
  }

  const dispatch = {
    "run-started": onRunStarted,
    "slice-started": onSliceStarted,
    "slice-completed": onSliceCompleted,
    "slice-failed": onSliceFailed,
    "run-completed": onRunCompleted,
    "run-aborted": onRunAborted,
    "quorum-dispatch-started": onQuorumDispatchStarted,
    "quorum-leg-completed": onQuorumLegCompleted,
    "quorum-review-completed": onQuorumReviewCompleted,
    "gate-passed": onGatePassed,
    "chat-completed": onChatCompleted,
  };

  return {
    handle(event) {
      const handler = dispatch[event?.type];
      if (handler) handler(event.data);
    },
  };
}
