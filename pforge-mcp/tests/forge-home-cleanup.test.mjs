/**
 * forge-home-cleanup.test.mjs — Issue #203
 *
 * Tests for:
 *   1. buildMemoryReport orphan whitelist (memory.mjs)
 *   2. forge-home-cleanup.mjs script behaviour
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildMemoryReport } from "../memory.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function tmpForge() {
  const cwd = mkdtempSync(join(tmpdir(), "pforge-test-forge-home-"));
  mkdirSync(join(cwd, ".forge"), { recursive: true });
  return cwd;
}

function writeForgeFile(cwd, name, content = "") {
  writeFileSync(join(cwd, ".forge", name), content, "utf-8");
}

// ── buildMemoryReport orphan whitelist ────────────────────────────────────────

describe("buildMemoryReport orphan whitelist (Issue #203)", () => {
  let cwd;
  afterEach(() => { if (cwd && existsSync(cwd)) rmSync(cwd, { recursive: true, force: true }); });

  it("does not flag known L2 files as orphans", () => {
    cwd = tmpForge();
    const knownFiles = [
      "liveguard-memories.jsonl", "openbrain-queue.jsonl", "openbrain-dlq.jsonl",
      "openbrain-stats.jsonl", "hub-events.jsonl", "drift-history.jsonl",
      "incidents.jsonl", "regression-history.jsonl", "env-diff-history.jsonl",
      "memory-search-cache.jsonl", "openbrain-queue.archive.jsonl",
    ];
    for (const f of knownFiles) writeForgeFile(cwd, f);
    const report = buildMemoryReport(cwd);
    for (const f of knownFiles) {
      expect(report.orphans, `${f} should not be an orphan`).not.toContain(f);
    }
  });

  it("does not flag known state files as orphans", () => {
    cwd = tmpForge();
    const stateFiles = [
      "cost-history.json", "drift-history.json", "model-performance.json",
      "quorum-history.jsonl", "watch-history.jsonl", "dashboard-state.json",
      "secrets.json", "update-check.json", "version-check.json",
      "secret-scan-cache.json", "fm-prefs.json", "forge-master-observer-state.json",
      "liveguard-events.jsonl", "fix-proposals.json", "team-activity.jsonl",
      "health-dna.jsonl", "last-orch.pid", "server-ports.json",
    ];
    for (const f of stateFiles) writeForgeFile(cwd, f);
    const report = buildMemoryReport(cwd);
    for (const f of stateFiles) {
      expect(report.orphans, `${f} should not be an orphan`).not.toContain(f);
    }
  });

  it("does not flag known subdirectories as orphans", () => {
    cwd = tmpForge();
    const knownDirs = [
      "plans", "digests", "trajectories", "crucible", "tempering", "runbooks",
      "graph", "bugs", "analysis", "fm-sessions", "skills-auto", "cache",
      "validation", "chain-logs", "health", "archive", "network-logs",
      "hammer-forge-master", "load-sim", "orchestrator-logs",
    ];
    for (const d of knownDirs) mkdirSync(join(cwd, ".forge", d), { recursive: true });
    const report = buildMemoryReport(cwd);
    for (const d of knownDirs) {
      expect(report.orphans, `${d}/ dir should not be an orphan`).not.toContain(d);
    }
  });

  it("does not flag ephemeral log / tmp files as orphans", () => {
    cwd = tmpForge();
    const ephemeral = [
      "release-notes-v2.50.0.md",
      "chain-runner-3.log",
      "run-phase-28-harden.log",
      "harden-phase-30-session.log",
      "fm-dashboard-2024-01.log",
      "mcp-hammer.log",
      "mcp-hammer.err.log",
      "mcp-val.2024-01-01.log",
      "sequencer-b-then-d.log",
      "meta-bug-95-body.txt",
      "meta-bug-phase30-harden.json",
      "gate-tmp.cjs",
      "tmp-phase28-submit.json",
      "liveguard-broadcast.log",
    ];
    for (const f of ephemeral) writeForgeFile(cwd, f);
    const report = buildMemoryReport(cwd);
    for (const f of ephemeral) {
      expect(report.orphans, `ephemeral file ${f} should not be an orphan`).not.toContain(f);
    }
  });

  it("still flags genuinely unknown files as orphans", () => {
    cwd = tmpForge();
    writeForgeFile(cwd, "mystery-file.xyz");
    const report = buildMemoryReport(cwd);
    expect(report.orphans).toContain("mystery-file.xyz");
  });

  it("returns empty orphans when only known files exist", () => {
    cwd = tmpForge();
    writeForgeFile(cwd, "liveguard-memories.jsonl");
    writeForgeFile(cwd, "cost-history.json");
    mkdirSync(join(cwd, ".forge", "runs"), { recursive: true });
    const report = buildMemoryReport(cwd);
    expect(report.orphans).toHaveLength(0);
  });

  it("returns empty orphans for empty .forge/ dir", () => {
    cwd = tmpForge();
    const report = buildMemoryReport(cwd);
    expect(report.orphans).toHaveLength(0);
  });
});

// ── forge-home-cleanup.mjs script ────────────────────────────────────────────

describe("forge-home-cleanup script (Issue #203)", () => {
  let cwd;
  afterEach(() => { if (cwd && existsSync(cwd)) rmSync(cwd, { recursive: true, force: true }); });

  async function runCleanup(forgeCwd, extraArgs = []) {
    const { execFileSync } = await import("child_process");
    const scriptPath = new URL("../../scripts/forge-home-cleanup.mjs", import.meta.url).pathname
      .replace(/^\/([A-Z]:)/, "$1"); // fix Windows drive-letter
    try {
      const out = execFileSync(process.execPath, [scriptPath, `--cwd=${forgeCwd}`, "--no-confirm", ...extraArgs], {
        encoding: "utf-8",
        cwd: forgeCwd,
      });
      return { ok: true, output: out };
    } catch (err) {
      return { ok: false, output: err.stdout ?? "", error: err.stderr ?? err.message };
    }
  }

  it("reports clean when no ephemeral files exist", async () => {
    cwd = tmpForge();
    const result = await runCleanup(cwd);
    expect(result.ok).toBe(true);
    // Expect one of these messages
    expect(result.output).toMatch(/No ephemeral files found|No .forge\/ directory/);
  });

  it("dry-run: reports but does not move files", async () => {
    cwd = tmpForge();
    writeForgeFile(cwd, "chain-runner-1.log", "old log data");
    const result = await runCleanup(cwd, ["--dry-run"]);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/DRY RUN/);
    // File should still exist (not moved)
    expect(existsSync(join(cwd, ".forge", "chain-runner-1.log"))).toBe(true);
  });

  it("moves ephemeral files to archive and removes from root", async () => {
    cwd = tmpForge();
    writeForgeFile(cwd, "chain-runner-2.log", "log content");
    writeForgeFile(cwd, "meta-bug-42-draft.txt", "draft");
    writeForgeFile(cwd, "release-notes-v2.50.0.md", "release notes");
    const result = await runCleanup(cwd);
    expect(result.ok).toBe(true);
    // Files should be gone from root
    expect(existsSync(join(cwd, ".forge", "chain-runner-2.log"))).toBe(false);
    expect(existsSync(join(cwd, ".forge", "meta-bug-42-draft.txt"))).toBe(false);
    // Archive dir should contain them
    const archiveDir = join(cwd, ".forge", "archive");
    expect(existsSync(archiveDir)).toBe(true);
    const slots = readdirSync(archiveDir);
    expect(slots.length).toBeGreaterThanOrEqual(1);
    const slot = join(archiveDir, slots[0]);
    const archived = readdirSync(slot);
    expect(archived).toContain("chain-runner-2.log");
    expect(archived).toContain("meta-bug-42-draft.txt");
  });

  it("does not move non-ephemeral files", async () => {
    cwd = tmpForge();
    writeForgeFile(cwd, "liveguard-memories.jsonl", "{}");
    writeForgeFile(cwd, "cost-history.json", "{}");
    writeForgeFile(cwd, "chain-runner-3.log", "log");
    const result = await runCleanup(cwd);
    expect(result.ok).toBe(true);
    // Known files untouched
    expect(existsSync(join(cwd, ".forge", "liveguard-memories.jsonl"))).toBe(true);
    expect(existsSync(join(cwd, ".forge", "cost-history.json"))).toBe(true);
  });

  it("--max-age-days=0 skips archive pruning", async () => {
    cwd = tmpForge();
    // Put an old archive slot in place
    const oldSlot = join(cwd, ".forge", "archive", "2020-01");
    mkdirSync(oldSlot, { recursive: true });
    writeFileSync(join(oldSlot, "old-file.log"), "");
    const result = await runCleanup(cwd, ["--max-age-days=0"]);
    expect(result.ok).toBe(true);
    // Old slot must still exist (pruning disabled)
    expect(existsSync(oldSlot)).toBe(true);
  });
});
