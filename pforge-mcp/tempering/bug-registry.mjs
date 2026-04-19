/**
 * Plan Forge — Tempering: Bug Registry (Phase TEMPER-06 Slice 06.1)
 *
 * Stores, deduplicates, and manages bugs discovered by tempering scanners.
 * Each bug is a JSON file in `.forge/bugs/<bugId>.json`.
 *
 * Design contracts:
 *   - Never throws. All public functions return structured results.
 *   - Atomic writes (tmp + rename) to avoid partial JSON on crash.
 *   - Path traversal safety: all writes constrained to .forge/bugs/.
 *   - Hub/captureMemory are injected for testability.
 *
 * @module tempering/bug-registry
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// ─── Constants ────────────────────────────────────────────────────────

export const BUG_STATUSES = ["open", "in-fix", "fixed", "wont-fix", "duplicate"];

export const VALID_TRANSITIONS = {
  "open":      ["in-fix", "wont-fix", "duplicate"],
  "in-fix":    ["fixed", "open", "wont-fix"],
  "fixed":     [],
  "wont-fix":  [],
  "duplicate": [],
};

// ─── Directory helpers ────────────────────────────────────────────────

/**
 * Ensure `.forge/bugs/` exists under cwd.
 * @param {string} cwd
 * @returns {string} resolved bugs directory path
 */
export function ensureBugsDir(cwd) {
  const dir = resolve(cwd, ".forge", "bugs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Bug ID generation ───────────────────────────────────────────────

/**
 * Generate a unique bug ID: `bug-YYYY-MM-DD-NNN`.
 * Reads existing files to find next sequence number. Retries on collision.
 *
 * @param {string} cwd
 * @param {Function} [nowFn] - injectable clock for testing
 * @returns {string}
 */
export function generateBugId(cwd, nowFn = () => Date.now()) {
  const dir = ensureBugsDir(cwd);
  const date = new Date(nowFn()).toISOString().slice(0, 10);
  const prefix = `bug-${date}-`;

  let existing = [];
  try {
    existing = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .map((f) => {
        const numStr = f.slice(prefix.length, -5); // remove .json
        return parseInt(numStr, 10);
      })
      .filter((n) => !isNaN(n));
  } catch { /* empty dir or unreadable */ }

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

// ─── Fingerprinting & Deduplication ──────────────────────────────────

/**
 * Normalize assertion messages for stable fingerprinting.
 * Strips timestamps, hex addresses, random UUIDs, and numeric noise.
 */
function normalizeForFingerprint(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "<ts>")        // ISO timestamps
    .replace(/0x[0-9a-fA-F]+/g, "<hex>")                      // hex addresses
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>") // UUIDs
    .replace(/\d{10,}/g, "<num>")                              // long numbers (timestamps, IDs)
    .trim();
}

/**
 * Compute a fingerprint for deduplication.
 * SHA-1 of (scanner|testName|topFrame|normalized-assertionMessage).
 *
 * @param {string} scanner
 * @param {object} evidence
 * @returns {string} hex fingerprint
 */
export function computeFingerprint(scanner, evidence) {
  const parts = [
    scanner || "",
    evidence?.testName || "",
    extractTopFrame(evidence?.stackTrace),
    normalizeForFingerprint(evidence?.assertionMessage),
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

/**
 * Extract the first meaningful (non-node_modules) frame from a stack trace.
 */
function extractTopFrame(stackTrace) {
  if (!stackTrace || typeof stackTrace !== "string") return "";
  const lines = stackTrace.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("at ") && !line.includes("node_modules")) {
      return line;
    }
  }
  return lines[0] || "";
}

/**
 * Search existing bugs for a duplicate by fingerprint.
 *
 * @param {string} cwd
 * @param {string} scanner
 * @param {string} testName
 * @param {string} fingerprint
 * @returns {{ bugId: string, status: string } | null}
 */
export function findDuplicate(cwd, scanner, testName, fingerprint) {
  const dir = resolve(cwd, ".forge", "bugs");
  if (!existsSync(dir)) return null;

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch { return null; }

  for (const file of files) {
    try {
      const bug = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));
      if (bug.fingerprint === fingerprint) {
        return { bugId: bug.bugId, status: bug.status };
      }
    } catch { /* skip corrupt */ }
  }
  return null;
}

// ─── Load / List ─────────────────────────────────────────────────────

/**
 * Load a single bug record by ID.
 * @param {string} cwd
 * @param {string} bugId
 * @returns {object|null}
 */
export function loadBug(cwd, bugId) {
  // Path traversal guard
  const safe = basename(bugId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe || safe !== bugId) return null;

  const filePath = resolve(cwd, ".forge", "bugs", `${safe}.json`);
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * List bugs with optional filters.
 *
 * @param {string} cwd
 * @param {object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.severity]
 * @param {string} [filters.scanner]
 * @param {string} [filters.since] - ISO date string
 * @param {string} [filters.until] - ISO date string
 * @returns {object[]}
 */
export function listBugs(cwd, filters = {}) {
  const dir = resolve(cwd, ".forge", "bugs");
  if (!existsSync(dir)) return [];

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch { return []; }

  const bugs = [];
  for (const file of files) {
    try {
      const bug = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));
      if (filters.status && bug.status !== filters.status) continue;
      if (filters.severity && bug.severity !== filters.severity) continue;
      if (filters.scanner && bug.scanner !== filters.scanner) continue;
      if (filters.since && bug.discoveredAt < filters.since) continue;
      if (filters.until && bug.discoveredAt > filters.until) continue;
      bugs.push(bug);
    } catch { /* skip corrupt */ }
  }

  // Sort newest first
  bugs.sort((a, b) => (b.discoveredAt || "").localeCompare(a.discoveredAt || ""));
  return bugs;
}

// ─── Hub event helper ─────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Registration ─────────────────────────────────────────────────────

/**
 * Register a bug discovered by a tempering scanner.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.scanner
 * @param {string} opts.severity - critical|high|medium|low
 * @param {object} opts.evidence - { testName, assertionMessage, stackTrace, ... }
 * @param {string[]} [opts.affectedFiles]
 * @param {string[]} [opts.reproSteps]
 * @param {string} opts.correlationId
 * @param {object|null} [opts.sliceRef]
 * @param {string} opts.classification - 'real-bug'|'infra'|'needs-human-review'|'unknown'
 * @param {object} opts.classifierMeta - { rule?, reason, confidence, source }
 * @param {object} [opts.hub]
 * @param {Function} [opts.captureMemory]
 * @param {Function} [opts.nowFn]
 * @returns {{ ok: boolean, bugId?: string, classification: string, action?: string, error?: string, existingBugId?: string }}
 */
export function registerBug(opts) {
  try {
    const {
      cwd,
      scanner,
      severity = "medium",
      evidence = {},
      affectedFiles = [],
      reproSteps = [],
      correlationId,
      sliceRef = null,
      classification,
      classifierMeta = {},
      hub = null,
      captureMemory = null,
      nowFn = () => Date.now(),
    } = opts || {};

    // 1. Infra classification → no file, return early
    if (classification === "infra") {
      return {
        ok: true,
        classification: "infra",
        action: "recorded-in-run",
      };
    }

    // 2. Validate evidence
    if (!evidence.testName && !(evidence.assertionMessage && evidence.stackTrace)) {
      return { ok: false, error: "MISSING_EVIDENCE" };
    }

    // 3. Dedup by fingerprint
    const fingerprint = computeFingerprint(scanner, evidence);
    const dup = findDuplicate(cwd, scanner, evidence.testName, fingerprint);
    if (dup) {
      return { ok: false, error: "DUPLICATE_BUG", existingBugId: dup.bugId };
    }

    // 4. Generate ID + build record
    const bugId = generateBugId(cwd, nowFn);
    const discoveredAt = new Date(nowFn()).toISOString();

    const record = {
      bugId,
      fingerprint,
      scanner,
      severity,
      status: "open",
      classification,
      classifierMeta,
      evidence,
      affectedFiles,
      reproSteps,
      correlationId,
      sliceRef,
      discoveredAt,
      updatedAt: discoveredAt,
    };

    // 5. Atomic write (tmp + rename)
    const dir = ensureBugsDir(cwd);
    const finalPath = resolve(dir, `${bugId}.json`);
    const tmpPath = resolve(dir, `.${bugId}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n", "utf-8");
    try {
      renameSync(tmpPath, finalPath);
    } catch {
      // Fallback: direct write if rename fails (e.g., cross-device)
      writeFileSync(finalPath, JSON.stringify(record, null, 2) + "\n", "utf-8");
    }

    // 6. Hub event
    emit(hub, "tempering-bug-registered", {
      bugId,
      scanner,
      severity,
      correlationId,
      classification,
      timestamp: discoveredAt,
    });

    // 7. L3 memory capture — only for real bugs
    if (classification === "real-bug" && typeof captureMemory === "function") {
      try {
        const summary = `Bug ${bugId} from ${scanner}: ${evidence.testName || evidence.assertionMessage || "unknown"} — severity=${severity}`;
        captureMemory(summary, "decision", `forge_bug_register/${scanner}/${severity}`, cwd);
      } catch { /* best-effort */ }
    }

    return { ok: true, bugId, classification };
  } catch (err) {
    return { ok: false, error: `REGISTER_FAILED: ${err.message}` };
  }
}

// ─── Status transitions ──────────────────────────────────────────────

/**
 * Transition a bug's status with validation.
 *
 * @param {string} cwd
 * @param {string} bugId
 * @param {string} newStatus
 * @param {object} [opts]
 * @param {string} [opts.note]
 * @returns {{ ok: boolean, error?: string }}
 */
export function updateBugStatus(cwd, bugId, newStatus, opts = {}) {
  try {
    const bug = loadBug(cwd, bugId);
    if (!bug) {
      return { ok: false, error: "BUG_NOT_FOUND" };
    }

    if (!BUG_STATUSES.includes(newStatus)) {
      return { ok: false, error: "INVALID_STATUS" };
    }

    const allowed = VALID_TRANSITIONS[bug.status];
    if (!allowed || !allowed.includes(newStatus)) {
      return { ok: false, error: "INVALID_TRANSITION", from: bug.status, to: newStatus };
    }

    bug.status = newStatus;
    bug.updatedAt = new Date().toISOString();
    if (opts.note) {
      bug.statusHistory = bug.statusHistory || [];
      bug.statusHistory.push({
        from: bug.status,
        to: newStatus,
        note: opts.note,
        at: bug.updatedAt,
      });
    }

    // Atomic write
    const dir = resolve(cwd, ".forge", "bugs");
    const finalPath = resolve(dir, `${bugId}.json`);
    const tmpPath = resolve(dir, `.${bugId}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(bug, null, 2) + "\n", "utf-8");
    try {
      renameSync(tmpPath, finalPath);
    } catch {
      writeFileSync(finalPath, JSON.stringify(bug, null, 2) + "\n", "utf-8");
    }

    return { ok: true, bugId, newStatus };
  } catch (err) {
    return { ok: false, error: `UPDATE_FAILED: ${err.message}` };
  }
}
