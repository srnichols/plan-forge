/**
 * audit-export.test.mjs — Tests for the streaming audit export module.
 *
 * Covers:
 *   - exportAudit yields JSONL records from events.log files
 *   - CSV format with header row
 *   - --since / --until date filters
 *   - --type event type filter
 *   - --run single-run scoping
 *   - graceful on missing .forge/runs/ directory
 *   - graceful on empty events.log
 *   - manifest.json plan name injection
 *   - multiple run directories sorted oldest-first
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { exportAudit } from "../audit-export.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `audit-export-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function setupRun(cwd, runId, events, manifest) {
  const runDir = resolve(cwd, ".forge", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, "events.log"), events.join("\n") + "\n", "utf-8");
  if (manifest) {
    writeFileSync(resolve(runDir, "manifest.json"), JSON.stringify(manifest), "utf-8");
  }
}

async function collect(gen) {
  const results = [];
  for await (const line of gen) {
    results.push(line);
  }
  return results;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("exportAudit", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => cleanup(tmpDir));

  it("yields nothing when .forge/runs/ does not exist", async () => {
    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines).toEqual([]);
  });

  it("yields nothing when .forge/runs/ exists but is empty", async () => {
    mkdirSync(resolve(tmpDir, ".forge", "runs"), { recursive: true });
    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines).toEqual([]);
  });

  it("yields JSONL records from a single run", async () => {
    setupRun(tmpDir, "run-001", [
      "[2025-05-01T10:00:00Z] slice-started: {\"sliceId\":\"1\",\"source\":\"copilot\"}",
      "[2025-05-01T10:01:00Z] slice-completed: {\"sliceId\":\"1\",\"cost\":0.05}",
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines.length).toBe(2);

    const r0 = JSON.parse(lines[0]);
    expect(r0.timestamp).toBe("2025-05-01T10:00:00Z");
    expect(r0.event_type).toBe("slice-started");
    expect(r0.run_id).toBe("run-001");
    expect(r0.slice_id).toBe("1");
    expect(r0.source).toBe("copilot");

    const r1 = JSON.parse(lines[1]);
    expect(r1.event_type).toBe("slice-completed");
    expect(r1.cost_usd).toBe(0.05);
  });

  it("injects plan name from manifest.json", async () => {
    setupRun(
      tmpDir,
      "run-002",
      ["[2025-05-01T10:00:00Z] run-started: {\"model\":\"gpt-4\"}"],
      { plan: "docs/plans/Phase-42-PLAN.md" },
    );

    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines.length).toBe(1);
    const r = JSON.parse(lines[0]);
    expect(r.plan).toBe("docs/plans/Phase-42-PLAN.md");
  });

  it("emits CSV with header row", async () => {
    setupRun(tmpDir, "run-csv", [
      "[2025-05-01T12:00:00Z] chat-completed: {\"model\":\"gpt-4\",\"tokensIn\":100,\"tokensOut\":200}",
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir, format: "csv" }));
    expect(lines.length).toBe(2); // header + 1 data row
    expect(lines[0]).toContain("timestamp");
    expect(lines[0]).toContain("event_type");
    expect(lines[1]).toContain("chat-completed");
    expect(lines[1]).toContain("gpt-4");
  });

  it("filters by --since (inclusive lower bound)", async () => {
    setupRun(tmpDir, "run-since", [
      "[2025-05-01T08:00:00Z] slice-started: {\"sliceId\":\"1\"}",
      "[2025-05-01T12:00:00Z] slice-completed: {\"sliceId\":\"1\"}",
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir, since: "2025-05-01T10:00:00Z" }));
    expect(lines.length).toBe(1);
    const r = JSON.parse(lines[0]);
    expect(r.event_type).toBe("slice-completed");
  });

  it("filters by --until (inclusive upper bound)", async () => {
    setupRun(tmpDir, "run-until", [
      "[2025-05-01T08:00:00Z] slice-started: {\"sliceId\":\"1\"}",
      "[2025-05-01T12:00:00Z] slice-completed: {\"sliceId\":\"1\"}",
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir, until: "2025-05-01T09:00:00Z" }));
    expect(lines.length).toBe(1);
    const r = JSON.parse(lines[0]);
    expect(r.event_type).toBe("slice-started");
  });

  it("filters by --type (single type)", async () => {
    setupRun(tmpDir, "run-type", [
      "[2025-05-01T10:00:00Z] slice-started: {\"sliceId\":\"1\"}",
      "[2025-05-01T10:01:00Z] chat-completed: {\"model\":\"gpt-4\"}",
      "[2025-05-01T10:02:00Z] slice-completed: {\"sliceId\":\"1\"}",
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir, type: ["chat-completed"] }));
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).event_type).toBe("chat-completed");
  });

  it("filters by --type (multiple types)", async () => {
    setupRun(tmpDir, "run-multi-type", [
      "[2025-05-01T10:00:00Z] slice-started: {\"sliceId\":\"1\"}",
      "[2025-05-01T10:01:00Z] chat-completed: {\"model\":\"gpt-4\"}",
      "[2025-05-01T10:02:00Z] gate-passed: {\"sliceId\":\"1\"}",
      "[2025-05-01T10:03:00Z] slice-completed: {\"sliceId\":\"1\"}",
    ]);

    const lines = await collect(
      exportAudit({ cwd: tmpDir, type: ["slice-started", "slice-completed"] }),
    );
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).event_type).toBe("slice-started");
    expect(JSON.parse(lines[1]).event_type).toBe("slice-completed");
  });

  it("scopes to a single run with --run", async () => {
    setupRun(tmpDir, "run-a", ["[2025-05-01T10:00:00Z] slice-started: {\"sliceId\":\"1\"}"]);
    setupRun(tmpDir, "run-b", ["[2025-05-01T11:00:00Z] slice-started: {\"sliceId\":\"2\"}"]);

    const lines = await collect(exportAudit({ cwd: tmpDir, run: "run-b" }));
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).run_id).toBe("run-b");
  });

  it("yields nothing when --run matches no directory", async () => {
    setupRun(tmpDir, "run-a", ["[2025-05-01T10:00:00Z] slice-started: {}"]);

    const lines = await collect(exportAudit({ cwd: tmpDir, run: "nonexistent" }));
    expect(lines).toEqual([]);
  });

  it("skips blank and unparseable lines gracefully", async () => {
    setupRun(tmpDir, "run-skip", [
      "",
      "this is not a valid event line",
      "[2025-05-01T10:00:00Z] slice-started: {\"sliceId\":\"1\"}",
      "  ",
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).event_type).toBe("slice-started");
  });

  it("handles events.log with no valid lines", async () => {
    setupRun(tmpDir, "run-empty-log", [
      "garbage line 1",
      "garbage line 2",
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines).toEqual([]);
  });

  it("multiple runs are yielded in sorted (oldest-first) order", async () => {
    setupRun(tmpDir, "aaa-run", ["[2025-01-01T00:00:00Z] run-started: {}"]);
    setupRun(tmpDir, "zzz-run", ["[2025-06-01T00:00:00Z] run-started: {}"]);

    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).run_id).toBe("aaa-run");
    expect(JSON.parse(lines[1]).run_id).toBe("zzz-run");
  });

  it("run directory without events.log is silently skipped", async () => {
    const runDir = resolve(tmpDir, ".forge", "runs", "empty-run");
    mkdirSync(runDir, { recursive: true });
    // No events.log created

    const lines = await collect(exportAudit({ cwd: tmpDir }));
    expect(lines).toEqual([]);
  });

  it("record fields map to CSV columns correctly", async () => {
    setupRun(tmpDir, "run-csv-fields", [
      '[2025-05-01T10:00:00Z] chat-completed: {"model":"gpt-4","tokensIn":500,"tokensOut":1000,"cost":0.03,"sliceId":"2","worker":"copilot"}',
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir, format: "csv" }));
    const header = lines[0].split(",");
    const values = lines[1].split(",");
    expect(header).toContain("timestamp");
    expect(header).toContain("model");
    expect(header).toContain("worker");
    // Verify model column matches
    const modelIdx = header.indexOf("model");
    expect(values[modelIdx]).toBe("gpt-4");
  });

  it("CSV escapes values containing commas", async () => {
    setupRun(tmpDir, "run-csv-escape", [
      '[2025-05-01T10:00:00Z] slice-started: {"source":"model,variant"}',
    ]);

    const lines = await collect(exportAudit({ cwd: tmpDir, format: "csv" }));
    const dataRow = lines[1];
    // Comma-containing value should be quoted
    expect(dataRow).toContain('"model,variant"');
  });

  it("combines --since and --type filters", async () => {
    setupRun(tmpDir, "run-combined", [
      "[2025-05-01T08:00:00Z] slice-started: {}",
      "[2025-05-01T12:00:00Z] slice-started: {}",
      "[2025-05-01T12:01:00Z] chat-completed: {}",
    ]);

    const lines = await collect(
      exportAudit({ cwd: tmpDir, since: "2025-05-01T10:00:00Z", type: ["slice-started"] }),
    );
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).event_type).toBe("slice-started");
    expect(JSON.parse(lines[0]).timestamp).toBe("2025-05-01T12:00:00Z");
  });
});
