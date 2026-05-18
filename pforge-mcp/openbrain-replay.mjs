/**
 * openbrain-replay.mjs
 * ─────────────────────────────────────────────────────────────────────
 * Round-trip test + bulk replay utilities for OpenBrain (L3 memory).
 *
 * Pure module — all I/O is dependency-injected (filesystem path strings,
 * MCP client object). Live SSE transport lives in `createSseClient()` so
 * tests can substitute a mock client.
 *
 * Companions:
 *   - REST: POST /api/brain/test, POST /api/brain/replay  (server.mjs)
 *   - MCP : forge_brain_test, forge_brain_replay           (capabilities.mjs)
 *   - CLI : pforge brain test, pforge brain replay         (pforge.ps1/sh)
 *
 * Scope: project-agnostic; reads OpenBrain endpoint from .vscode/mcp.json.
 * Does NOT dedupe against existing OpenBrain records; does NOT migrate schema.
 */

import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { resolve, basename, join } from "node:path";

// ─── Config discovery ──────────────────────────────────────────────────

/**
 * Read OpenBrain SSE endpoint + auth key from .vscode/mcp.json (or .claude/mcp.json).
 * Supports both header-form (`headers: { "x-brain-key": "..." }`) and query-form
 * (`url: ".../sse?key=..."`) auth. Resolves `${env:NAME}` placeholders.
 *
 * @param {string} cwd
 * @returns {{ url: string, key: string|null, source: string } | null}
 */
export function readOpenBrainConfig(cwd) {
  const candidates = [
    resolve(cwd, ".vscode", "mcp.json"),
    resolve(cwd, ".claude", "mcp.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let config;
    try {
      config = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      continue;
    }
    const servers = config?.servers ?? config?.mcpServers ?? {};
    for (const name of Object.keys(servers)) {
      if (!/openbrain|open-brain/i.test(name)) continue;
      const entry = servers[name];
      // SSE-mode requires a URL. Stdio mode has command/args — skip; we cannot
      // round-trip via stdio from a one-shot CLI without spawning the server.
      const url = typeof entry?.url === "string" ? entry.url : null;
      if (!url) continue;

      let key = null;

      // Header-form: prefer over query-form because it's the documented setup.
      const headers = entry?.headers ?? {};
      for (const h of Object.keys(headers)) {
        if (/^x-brain-key$/i.test(h)) {
          key = resolveEnvPlaceholder(headers[h]);
          break;
        }
      }

      // Query-form: `?key=...` in the SSE URL.
      if (!key) {
        try {
          const u = new URL(url);
          const qk = u.searchParams.get("key");
          if (qk) key = qk;
        } catch { /* malformed URL — leave key null */ }
      }

      // Final fallback: OPENBRAIN_KEY env var (matches the existing convention
      // used by mcp.json's `${env:OPENBRAIN_KEY}` interpolation).
      if (!key && process.env.OPENBRAIN_KEY) {
        key = process.env.OPENBRAIN_KEY;
      }

      return { url, key, source: path };
    }
  }
  return null;
}

/** Resolve `${env:NAME}` → process.env[NAME]. Returns input unchanged otherwise. */
function resolveEnvPlaceholder(value) {
  if (typeof value !== "string") return null;
  const m = value.match(/^\$\{env:([A-Z_][A-Z0-9_]*)\}$/i);
  if (!m) return value;
  const envName = m[1];
  return process.env[envName] ?? null;
}

// ─── Normalizers ───────────────────────────────────────────────────────

const QUEUE_META_PREFIX = "_"; // queue-internal fields start with _ (e.g. _status)
const CAPTURE_TOP_LEVEL = new Set(["content", "project", "source", "created_by"]);

/**
 * Normalize a `.forge/openbrain-queue.jsonl` record → capture_thought payload.
 * Returns null for tombstones (`_action=delete`) or records missing content.
 *
 * @param {object} record
 * @returns {{ content: string, project?: string, source?: string, created_by?: string, metadata?: object } | null}
 */
export function normalizeQueueRecord(record) {
  if (!record || typeof record !== "object") return null;
  if (record._action === "delete") return null;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!content) return null;

  const out = { content };
  if (record.project) out.project = String(record.project);
  if (record.source) out.source = String(record.source);
  if (record.created_by) out.created_by = String(record.created_by);

  // Everything else (excluding queue internals) becomes metadata.
  const metadata = {};
  for (const k of Object.keys(record)) {
    if (k.startsWith(QUEUE_META_PREFIX)) continue;
    if (CAPTURE_TOP_LEVEL.has(k)) continue;
    if (k === "content") continue;
    metadata[k] = record[k];
  }
  if (Object.keys(metadata).length > 0) out.metadata = metadata;

  return out;
}

/**
 * Normalize a markdown file → array of capture_thought records, one per H2 section.
 * Falls back to a single record (whole file) when no H2 headings are found.
 *
 * @param {string} path
 * @param {{ project?: string, source?: string, maxBytes?: number }} opts
 */
export function normalizeMarkdownFile(path, opts = {}) {
  const { project, source, maxBytes = 8192 } = opts;
  const raw = readFileSync(path, "utf-8");
  const fileName = basename(path);

  const sections = splitByHeading(raw);
  return sections.map((sec) => {
    let content = sec.body.trim() ? `${sec.heading}\n\n${sec.body.trim()}` : sec.heading;
    let truncated = false;
    if (content.length > maxBytes) {
      content = content.slice(0, maxBytes) + "\n\n[…truncated]";
      truncated = true;
    }
    const metadata = { source_file: fileName, heading: stripHashPrefix(sec.heading) };
    if (truncated) metadata.truncated = true;
    const record = { content };
    if (project) record.project = project;
    if (source) record.source = source;
    record.metadata = metadata;
    return record;
  });
}

/**
 * Walk a directory and return all `.md` files (non-recursive by default).
 * Exposed so the REST layer can resolve a "source" argument uniformly.
 */
export function listMarkdownFiles(dir, { recursive = false } = {}) {
  const out = [];
  function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (recursive) walk(p);
      } else if (/\.md$/i.test(name)) {
        out.push(p);
      }
    }
  }
  if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
  return out;
}

function splitByHeading(raw) {
  const lines = raw.split(/\r?\n/);

  // First pass: detect whether the document has any H2 sections.
  const hasH2 = lines.some((l) => /^##\s+\S/.test(l));

  const sections = [];
  let current = null;

  if (hasH2) {
    // H2-only mode: ignore preamble (H1, intro paragraphs); emit one section
    // per H2 heading, including the heading line + everything below until the
    // next H2.
    for (const line of lines) {
      const h2 = /^##\s+(.+)$/.exec(line);
      if (h2) {
        if (current) sections.push(current);
        current = { heading: line, body: "" };
      } else if (current) {
        current.body += line + "\n";
      }
    }
    if (current) sections.push(current);
    return sections;
  }

  // Fallback: no H2s. Emit one section using the first H1 as the heading
  // (or "# Document" if no headings at all).
  let heading = "# Document";
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) { heading = line; break; }
  }
  // Body = all non-heading content.
  const body = lines.filter((l) => !/^#\s+/.test(l)).join("\n");
  sections.push({ heading, body });
  return sections;
}

function stripHashPrefix(heading) {
  return heading.replace(/^#+\s+/, "").trim();
}

// ─── Round-trip ────────────────────────────────────────────────────────

/**
 * Capture a unique marker thought, then search for it. Returns ok=true when
 * the search response includes a record whose content carries the marker.
 *
 * @param {object} client  - mock or live MCP client with capture()/search()
 * @param {{ project?: string, source?: string, timeoutMs?: number }} opts
 */
export async function roundTrip(client, opts = {}) {
  const start = Date.now();
  const marker = `PFTEST-RT-${randomId(10)}`;
  const project = opts.project || "plan-forge";
  const source = opts.source || "pforge-brain-test";

  try {
    const captureRes = await client.capture({
      content: `${marker} — pforge brain test marker thought (safe to ignore)`,
      project,
      source,
    });
    // Allow OpenBrain a moment to index (best-effort; many backends are
    // synchronous, but pgvector REINDEX windows can lag a second).
    if (opts.indexDelayMs) await delay(opts.indexDelayMs);

    const searchRes = await client.search({
      query: marker,
      project,
      limit: 5,
    });
    const hits = searchRes?.results ?? searchRes?.thoughts ?? [];
    const hit = hits.find((h) => String(h.content || "").includes(marker)) ?? null;

    return {
      ok: hit !== null,
      marker,
      hit,
      capturedId: captureRes?.id ?? null,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      ok: false,
      marker,
      hit: null,
      error: String(e?.message || e),
      durationMs: Date.now() - start,
    };
  }
}

// ─── Bulk replay ───────────────────────────────────────────────────────

/**
 * Replay a batch of records into OpenBrain via capture_thought.
 * Rate-limited; retries on any thrown error up to maxRetries.
 *
 * @param {object} client
 * @param {Array<object|null>} records  - pre-normalized capture payloads (or nulls to skip)
 * @param {{
 *   rate?: number,           // ms between calls (default 50)
 *   maxRetries?: number,     // default 3
 *   retryDelayMs?: number,   // base backoff (default 250)
 *   dryRun?: boolean,
 *   sampleSize?: number,     // # of sample receipts to return (default 5)
 *   onProgress?: (event: {index, total, status, error?}) => void,
 * }} opts
 */
export async function replayRecords(client, records, opts = {}) {
  const {
    rate = 50,
    maxRetries = 3,
    retryDelayMs = 250,
    dryRun = false,
    sampleSize = 5,
    onProgress = null,
  } = opts;

  const start = Date.now();
  const total = records.length;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const samples = [];
  const failures = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec || typeof rec !== "object" || typeof rec.content !== "string" || !rec.content.trim()) {
      skipped += 1;
      onProgress?.({ index: i, total, status: "skipped" });
      continue;
    }
    if (dryRun) {
      onProgress?.({ index: i, total, status: "dryrun" });
      continue;
    }

    let attempt = 0;
    let lastErr = null;
    while (attempt < maxRetries) {
      attempt += 1;
      try {
        const res = await client.capture(rec);
        sent += 1;
        if (samples.length < sampleSize) {
          samples.push({
            index: i,
            id: res?.id ?? null,
            content: rec.content.slice(0, 80),
          });
        }
        lastErr = null;
        onProgress?.({ index: i, total, status: "sent" });
        break;
      } catch (e) {
        lastErr = String(e?.message || e);
        if (attempt < maxRetries) {
          await delay(retryDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }
    if (lastErr) {
      failed += 1;
      failures.push({ index: i, error: lastErr, contentPreview: rec.content.slice(0, 80) });
      onProgress?.({ index: i, total, status: "failed", error: lastErr });
    }
    if (rate > 0 && i < records.length - 1) await delay(rate);
  }

  return {
    attempted: total - skipped,
    sent,
    failed,
    skipped,
    dryRun,
    durationMs: Date.now() - start,
    samples,
    failures,
  };
}

// ─── Live SSE client (thin SDK wrapper) ────────────────────────────────

/**
 * Build a live MCP client connected to OpenBrain via SSE. Returns an object
 * with the same shape used by tests ({ capture, search, close }).
 *
 * @param {{ url: string, key: string|null }} cfg
 */
export async function createSseClient(cfg) {
  if (!cfg?.url) throw new Error("createSseClient: missing url");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");

  const transport = new SSEClientTransport(new URL(cfg.url), {
    requestInit: cfg.key ? { headers: { "x-brain-key": cfg.key } } : undefined,
    eventSourceInit: cfg.key
      ? {
          // Custom fetch lets us inject the auth header into the SSE GET too.
          fetch: (url, init) =>
            fetch(url, {
              ...(init || {}),
              headers: { ...(init?.headers || {}), "x-brain-key": cfg.key },
            }),
        }
      : undefined,
  });

  const client = new Client(
    { name: "pforge-brain-client", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);

  return {
    raw: client,
    transport,
    async capture(args) {
      const res = await client.callTool({ name: "capture_thought", arguments: args });
      return parseToolResult(res);
    },
    async search(args) {
      const res = await client.callTool({ name: "search_thoughts", arguments: args });
      return parseToolResult(res);
    },
    async close() {
      try { await client.close(); } catch { /* best-effort */ }
    },
  };
}

/** Best-effort parse of an MCP tool-call response into a JSON object. */
function parseToolResult(res) {
  if (!res) return null;
  // MCP responses surface content as an array of {type, text} parts.
  if (Array.isArray(res.content)) {
    for (const part of res.content) {
      if (part?.type === "text" && typeof part.text === "string") {
        try { return JSON.parse(part.text); } catch { return { text: part.text }; }
      }
    }
  }
  // Some servers return the structured result directly.
  if (res.structuredContent) return res.structuredContent;
  return res;
}

// ─── helpers ───────────────────────────────────────────────────────────

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function randomId(len) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
