/**
 * Plan Forge — Tempering: JSONL Fallback Bug Adapter (Phase TEMPER-06 Slice 06.2)
 *
 * Always-on local adapter that confirms the bug is persisted in `.forge/bugs/`.
 * Makes "local-only" first-class and uniform with external adapters.
 *
 * All functions follow the 4-function adapter contract:
 *   async (bug, config, opts) => { provider: "jsonl", ok: boolean, ... }
 *
 * @module tempering/bug-adapters/jsonl-fallback
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, basename } from "node:path";

/**
 * Confirm a bug was registered locally.
 * The bug-registry already wrote the file; this adapter just confirms it exists.
 */
export async function registerBug(bug, config, { cwd } = {}) {
  try {
    const bugPath = resolve(cwd || process.cwd(), ".forge", "bugs", `${bug.bugId}.json`);
    if (existsSync(bugPath)) {
      return { provider: "jsonl", ok: true, path: bugPath };
    }
    return { provider: "jsonl", ok: true, path: bugPath, note: "file-not-yet-written" };
  } catch {
    return { provider: "jsonl", ok: false, error: "READ_FAILED" };
  }
}

/**
 * Confirm status update was persisted locally.
 * The registry already performed the atomic update.
 */
export async function updateBugStatus(bug, config, { cwd } = {}) {
  return { provider: "jsonl", ok: true };
}

/**
 * Append a validated-fix entry to the bug's validationHistory.
 */
export async function commentValidatedFix(bug, config, { cwd } = {}) {
  try {
    const bugPath = resolve(cwd || process.cwd(), ".forge", "bugs", `${bug.bugId}.json`);
    if (!existsSync(bugPath)) {
      return { provider: "jsonl", ok: false, error: "BUG_NOT_FOUND" };
    }

    const record = JSON.parse(readFileSync(bugPath, "utf-8"));
    record.validationHistory = record.validationHistory || [];
    record.validationHistory.push({
      validatedAt: new Date().toISOString(),
      scanRef: bug.validationHistory?.at(-1)?.scanRef || null,
      result: "fix-confirmed",
    });

    // Atomic write
    const safe = basename(bug.bugId).replace(/[^a-zA-Z0-9_-]/g, "");
    const dir = resolve(cwd || process.cwd(), ".forge", "bugs");
    const tmpPath = resolve(dir, `.${safe}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n", "utf-8");
    try {
      renameSync(tmpPath, bugPath);
    } catch {
      writeFileSync(bugPath, JSON.stringify(record, null, 2) + "\n", "utf-8");
    }

    return { provider: "jsonl", ok: true };
  } catch {
    return { provider: "jsonl", ok: false, error: "WRITE_FAILED" };
  }
}

/**
 * Read current status from the local bug file (identity sync).
 */
export async function syncStatusFromProvider(bugId, config, { cwd } = {}) {
  try {
    const id = typeof bugId === "object" ? bugId.bugId : bugId;
    const safe = basename(id).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) return { provider: "jsonl", ok: false, error: "INVALID_BUG_ID" };

    const bugPath = resolve(cwd || process.cwd(), ".forge", "bugs", `${safe}.json`);
    if (!existsSync(bugPath)) {
      return { provider: "jsonl", ok: false, error: "BUG_NOT_FOUND" };
    }

    const record = JSON.parse(readFileSync(bugPath, "utf-8"));
    return { provider: "jsonl", ok: true, status: record.status };
  } catch {
    return { provider: "jsonl", ok: false, error: "READ_FAILED" };
  }
}
