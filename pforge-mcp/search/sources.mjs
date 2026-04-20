/**
 * Plan Forge — L2 Source Registry for forge_search
 *
 * Declares which `.forge/` files to scan and how to map raw records into
 * searchable normalized objects for the ranking engine.
 *
 * Each source descriptor provides:
 *   - source:  canonical name (run, bug, incident, tempering, hub-event, review, memory, plan)
 *   - resolve: function(cwd) → array of absolute file paths to scan
 *   - parse:   function(content, filePath) → array of normalized records
 *   - weight:  source-type ranking multiplier
 *
 * @module search/sources
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";

export const SOURCE_WEIGHTS = Object.freeze({
  bug: 1.2,
  incident: 1.3,
  run: 1.0,
  memory: 0.9,
  "hub-event": 0.7,
  plan: 1.1,
  tempering: 1.0,
  review: 1.1,
});

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function safeReadJsonl(filePath, maxLines = Infinity) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const capped = maxLines < Infinity ? lines.slice(-maxLines) : lines;
    const records = [];
    for (const line of capped) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return records;
  } catch {
    return [];
  }
}

function fileMtime(filePath) {
  try {
    return statSync(filePath).mtime;
  } catch {
    return new Date(0);
  }
}

function listDir(dirPath) {
  try {
    if (!existsSync(dirPath)) return [];
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

// ─── Source: run ───────────────────────────────────────────────────────
const runSource = {
  source: "run",
  resolve(cwd) {
    const runsDir = resolve(cwd, ".forge", "runs");
    return listDir(runsDir)
      .map((name) => resolve(runsDir, name, "events.log"))
      .filter((p) => existsSync(p));
  },
  parse(content, filePath) {
    const runId = basename(resolve(filePath, ".."));
    const events = safeReadJsonl(filePath);
    const parts = [];
    for (const evt of events) {
      if (evt.type) parts.push(evt.type);
      if (evt.sliceTitle) parts.push(evt.sliceTitle);
      if (evt.plan) parts.push(evt.plan);
      if (evt.message) parts.push(evt.message);
    }
    const text = parts.join(" ");
    const timestamp = events.length > 0 ? (events[events.length - 1].timestamp || null) : null;
    const tags = [...new Set(events.map((e) => e.type).filter(Boolean))];
    const correlationId = events.find((e) => e._correlationId)?._correlationId || runId;
    return text
      ? [{ source: "run", recordRef: runId, text, timestamp: timestamp || fileMtime(filePath).toISOString(), tags, correlationId }]
      : [];
  },
};

// ─── Source: bug ──────────────────────────────────────────────────────
const bugSource = {
  source: "bug",
  resolve(cwd) {
    const bugsDir = resolve(cwd, ".forge", "bugs");
    return listDir(bugsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => resolve(bugsDir, f));
  },
  parse(content, filePath) {
    const data = safeReadJson(filePath);
    if (!data) return [];
    const bugId = basename(filePath, ".json");
    const parts = [data.title, data.description, ...(data.tags || [])].filter(Boolean);
    return [{
      source: "bug",
      recordRef: bugId,
      text: parts.join(" "),
      timestamp: data.timestamp || data.createdAt || fileMtime(filePath).toISOString(),
      tags: data.tags || [],
      correlationId: data.correlationId || data._correlationId || bugId,
    }];
  },
};

// ─── Source: incident ─────────────────────────────────────────────────
const incidentSource = {
  source: "incident",
  resolve(cwd) {
    const dir = resolve(cwd, ".forge", "incidents");
    return listDir(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => resolve(dir, f));
  },
  parse(content, filePath) {
    const data = safeReadJson(filePath);
    if (!data) return [];
    const id = basename(filePath, ".json");
    const parts = [data.title, data.severity, data.summary].filter(Boolean);
    return [{
      source: "incident",
      recordRef: id,
      text: parts.join(" "),
      timestamp: data.timestamp || data.createdAt || fileMtime(filePath).toISOString(),
      tags: data.tags || [],
      correlationId: data.correlationId || data._correlationId || id,
    }];
  },
};

// ─── Source: tempering ────────────────────────────────────────────────
const temperingSource = {
  source: "tempering",
  resolve(cwd) {
    const dir = resolve(cwd, ".forge", "tempering");
    return listDir(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => resolve(dir, f));
  },
  parse(content, filePath) {
    const data = safeReadJson(filePath);
    if (!data) return [];
    const id = basename(filePath, ".json");
    const parts = [];
    if (Array.isArray(data.failingRules)) parts.push(...data.failingRules);
    if (Array.isArray(data.offendingPaths)) parts.push(...data.offendingPaths);
    if (data.summary) parts.push(data.summary);
    if (data.scanner) parts.push(data.scanner);
    return parts.length > 0
      ? [{
          source: "tempering",
          recordRef: id,
          text: parts.join(" "),
          timestamp: data.timestamp || fileMtime(filePath).toISOString(),
          tags: data.tags || [],
          correlationId: data.correlationId || data._correlationId || id,
        }]
      : [];
  },
};

// ─── Source: hub-event ────────────────────────────────────────────────
const hubEventSource = {
  source: "hub-event",
  resolve(cwd) {
    const p = resolve(cwd, ".forge", "hub-events.jsonl");
    return existsSync(p) ? [p] : [];
  },
  parse(content, filePath) {
    const events = safeReadJsonl(filePath, 5000);
    return events.map((evt, i) => {
      const parts = [evt.type, evt.correlationId, evt.tool, evt.message].filter(Boolean);
      return {
        source: "hub-event",
        recordRef: evt.id || evt._correlationId || `hub-${i}`,
        text: parts.join(" "),
        timestamp: evt.timestamp || fileMtime(filePath).toISOString(),
        tags: evt.tags || (evt.type ? [evt.type] : []),
        correlationId: evt._correlationId || evt.correlationId || "",
      };
    });
  },
};

// ─── Source: review ───────────────────────────────────────────────────
const reviewSource = {
  source: "review",
  resolve(cwd) {
    const p = resolve(cwd, ".forge", "review-queue.json");
    return existsSync(p) ? [p] : [];
  },
  parse(content, filePath) {
    const data = safeReadJson(filePath);
    if (!data) return [];
    const items = Array.isArray(data) ? data : (data.items || []);
    return items.map((item) => {
      const parts = [item.title, ...(item.tags || []), item.context].filter(Boolean);
      return {
        source: "review",
        recordRef: item.id || item.itemId || "",
        text: parts.join(" "),
        timestamp: item.timestamp || item.createdAt || fileMtime(filePath).toISOString(),
        tags: item.tags || [],
        correlationId: item.correlationId || item._correlationId || "",
      };
    });
  },
};

// ─── Source: memory ───────────────────────────────────────────────────
const memorySource = {
  source: "memory",
  resolve(cwd) {
    const p = resolve(cwd, ".forge", "liveguard-memories.jsonl");
    return existsSync(p) ? [p] : [];
  },
  parse(content, filePath) {
    const records = safeReadJsonl(filePath);
    return records.map((rec, i) => {
      const parts = [rec.summary, ...(rec.tags || []), rec.content].filter(Boolean);
      return {
        source: "memory",
        recordRef: rec.id || `mem-${i}`,
        text: parts.join(" "),
        timestamp: rec.timestamp || fileMtime(filePath).toISOString(),
        tags: rec.tags || [],
        correlationId: rec._correlationId || rec.correlationId || "",
      };
    });
  },
};

// ─── Source: plan ─────────────────────────────────────────────────────
const planSource = {
  source: "plan",
  resolve(cwd) {
    const plansDir = resolve(cwd, "docs", "plans");
    return listDir(plansDir)
      .filter((f) => /^Phase-.*\.md$/i.test(f))
      .map((f) => resolve(plansDir, f));
  },
  parse(content, filePath) {
    const raw = (() => {
      try {
        return readFileSync(filePath, "utf-8");
      } catch {
        return "";
      }
    })();
    if (!raw) return [];

    const phaseId = basename(filePath, ".md");

    // Extract YAML frontmatter
    let phase = "";
    let status = "";
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const phaseMatch = fm.match(/^phase:\s*(.+)/m);
      const statusMatch = fm.match(/^status:\s*(.+)/m);
      if (phaseMatch) phase = phaseMatch[1].trim();
      if (statusMatch) status = statusMatch[1].trim();
    }

    // Extract first heading
    const headingMatch = raw.match(/^#+\s+(.+)/m);
    const title = headingMatch ? headingMatch[1].trim() : phaseId;

    const parts = [title, phase, status].filter(Boolean);
    return [{
      source: "plan",
      recordRef: phaseId,
      text: parts.join(" "),
      timestamp: fileMtime(filePath).toISOString(),
      tags: [phase, status].filter(Boolean),
      correlationId: phaseId,
    }];
  },
};

export const L2_SOURCES = [
  runSource,
  bugSource,
  incidentSource,
  temperingSource,
  hubEventSource,
  reviewSource,
  memorySource,
  planSource,
];
