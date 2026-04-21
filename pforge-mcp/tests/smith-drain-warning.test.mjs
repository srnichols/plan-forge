/**
 * Plan Forge — Phase-28.4 Slice 4: forge_smith drain warning row.
 *
 * Tests the conditional ⚠ Drain warning line appended to the Memory section
 * of forge_smith output when the OpenBrain queue is unhealthy.
 *
 * Strategy: replicate the inline drain-warning logic from server.mjs in a
 * local helper, seed a temp .forge directory, and verify thresholds.
 * This mirrors the inline code exactly (per plan: "extend, do not refactor").
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Build a pending queue record JSON line. */
function pendingLine(enqueuedAt) {
  return JSON.stringify({
    _status: "pending",
    _attempts: 0,
    _enqueuedAt: enqueuedAt,
    _nextAttemptAt: enqueuedAt,
    content: "test thought",
    project: "test",
  });
}

/** Build a delivered (non-pending) queue record JSON line. */
function deliveredLine(enqueuedAt) {
  return JSON.stringify({
    _status: "delivered",
    _attempts: 1,
    _enqueuedAt: enqueuedAt,
    content: "delivered thought",
    project: "test",
  });
}

/**
 * Replicate the drain-warning logic from server.mjs forge_smith handler.
 * Pure sync, mirrors the inline code exactly — no shared production helper.
 */
function computeDrainWarning(forgeDir, projectRoot) {
  const drainWarnCfg = { count: 10, ageHours: 24 };
  try {
    const forgeJsonPath = resolve(projectRoot, ".forge.json");
    if (existsSync(forgeJsonPath)) {
      const dwCfg = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
      if (dwCfg?.openbrain?.drainWarn) {
        if (typeof dwCfg.openbrain.drainWarn.count === "number") drainWarnCfg.count = dwCfg.openbrain.drainWarn.count;
        if (typeof dwCfg.openbrain.drainWarn.ageHours === "number") drainWarnCfg.ageHours = dwCfg.openbrain.drainWarn.ageHours;
      }
    }
  } catch { /* use defaults */ }

  const queuePath = resolve(forgeDir, "openbrain-queue.jsonl");
  const pendingRecords = [];
  if (existsSync(queuePath)) {
    const lines = readFileSync(queuePath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec._status === "pending") pendingRecords.push(rec);
      } catch { /* skip */ }
    }
  }

  if (pendingRecords.length === 0) return "";

  const pendingTooMany = pendingRecords.length > drainWarnCfg.count;
  let oldestAgeMs = 0;
  for (const r of pendingRecords) {
    if (r._enqueuedAt) {
      const age = Date.now() - new Date(r._enqueuedAt).getTime();
      if (age > oldestAgeMs) oldestAgeMs = age;
    }
  }
  const oldestAgeHours = oldestAgeMs / 3600000;
  const pendingTooOld = oldestAgeHours > drainWarnCfg.ageHours;

  if (pendingTooMany || pendingTooOld) {
    const ageStr = oldestAgeMs > 86400000 ? `${Math.round(oldestAgeMs / 86400000)}d`
      : oldestAgeMs > 3600000 ? `${Math.round(oldestAgeMs / 3600000)}h`
      : `${Math.round(oldestAgeMs / 60000)}m`;
    return `\n  \u26A0 Drain:         ${pendingRecords.length} pending (oldest: ${ageStr}). Run 'pforge drain-memory' or restart MCP.`;
  }
  return "";
}

function seedProject(queueLines = [], forgeJsonContent = null) {
  const root = mkdtempSync(join(tmpdir(), "smith-drain-"));
  const forgeDir = resolve(root, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  if (queueLines.length > 0) {
    writeFileSync(resolve(forgeDir, "openbrain-queue.jsonl"), queueLines.join("\n") + "\n");
  }
  if (forgeJsonContent !== null) {
    writeFileSync(resolve(root, ".forge.json"), JSON.stringify(forgeJsonContent, null, 2));
  }
  return { root, forgeDir };
}

describe("forge_smith drain warning row (Phase-28.4 Slice 4)", () => {
  const temps = [];
  afterEach(() => {
    for (const t of temps) {
      try { rmSync(t, { recursive: true, force: true }); } catch { /* cleanup */ }
    }
    temps.length = 0;
  });

  it("empty queue → no warning line", () => {
    const { root, forgeDir } = seedProject();
    temps.push(root);
    const warning = computeDrainWarning(forgeDir, root);
    expect(warning).toBe("");
  });

  it("5 pending, all < 24h → no warning", () => {
    const now = Date.now();
    const recentTs = new Date(now - 2 * 3600000).toISOString(); // 2h ago
    const lines = Array.from({ length: 5 }, () => pendingLine(recentTs));
    const { root, forgeDir } = seedProject(lines);
    temps.push(root);
    const warning = computeDrainWarning(forgeDir, root);
    expect(warning).toBe("");
  });

  it("11 pending, all < 24h → warning fires (count threshold)", () => {
    const now = Date.now();
    const recentTs = new Date(now - 1 * 3600000).toISOString(); // 1h ago
    const lines = Array.from({ length: 11 }, () => pendingLine(recentTs));
    const { root, forgeDir } = seedProject(lines);
    temps.push(root);
    const warning = computeDrainWarning(forgeDir, root);
    expect(warning).toContain("\u26A0 Drain:");
    expect(warning).toContain("11 pending");
    expect(warning).toContain("pforge drain-memory");
  });

  it("3 pending, oldest 30h → warning fires (age threshold)", () => {
    const now = Date.now();
    const oldTs = new Date(now - 30 * 3600000).toISOString(); // 30h ago
    const recentTs = new Date(now - 1 * 3600000).toISOString(); // 1h ago
    const lines = [
      pendingLine(oldTs),
      pendingLine(recentTs),
      pendingLine(recentTs),
    ];
    const { root, forgeDir } = seedProject(lines);
    temps.push(root);
    const warning = computeDrainWarning(forgeDir, root);
    expect(warning).toContain("\u26A0 Drain:");
    expect(warning).toContain("3 pending");
    expect(warning).toContain("pforge drain-memory");
    // 30h should render as "1d" (rounds to nearest day)
    expect(warning).toMatch(/oldest: 1d/);
  });

  it("custom thresholds via .forge.json → 11 pending + 30h-old → no warning (under custom thresholds)", () => {
    const now = Date.now();
    const oldTs = new Date(now - 30 * 3600000).toISOString(); // 30h ago
    const recentTs = new Date(now - 1 * 3600000).toISOString();
    const lines = Array.from({ length: 11 }, (_, i) =>
      i === 0 ? pendingLine(oldTs) : pendingLine(recentTs)
    );
    const forgeJson = { openbrain: { drainWarn: { count: 50, ageHours: 168 } } };
    const { root, forgeDir } = seedProject(lines, forgeJson);
    temps.push(root);
    const warning = computeDrainWarning(forgeDir, root);
    expect(warning).toBe("");
  });

  it("delivered records are not counted as pending", () => {
    const now = Date.now();
    const oldTs = new Date(now - 48 * 3600000).toISOString();
    const lines = [
      deliveredLine(oldTs),
      deliveredLine(oldTs),
      deliveredLine(oldTs),
    ];
    const { root, forgeDir } = seedProject(lines);
    temps.push(root);
    const warning = computeDrainWarning(forgeDir, root);
    expect(warning).toBe("");
  });

  it("server.mjs contains drainWarn config key", () => {
    const serverSrc = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
    expect(serverSrc).toContain("drainWarn");
  });

  it("server.mjs references pforge drain-memory in warning text", () => {
    const serverSrc = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
    expect(serverSrc).toContain("pforge drain-memory");
  });
});
