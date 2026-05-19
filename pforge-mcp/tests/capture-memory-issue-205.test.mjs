/**
 * Issue #205 regression — CLI plan runs silently drop OpenBrain memory captures.
 *
 * Before the fix:
 *   - `captureMemory()` lived only in `server.mjs` and was wired only into the
 *     MCP `forge_run_plan` handler.
 *   - `pforge run-plan` (CLI) spawned the orchestrator directly via
 *     `node orchestrator.mjs`, so `_memoryCapture` was emitted into the
 *     postmortem JSON but no caller ever consumed it. Result: `.forge/
 *     liveguard-memories.jsonl` and `.forge/openbrain-queue.jsonl` never
 *     received any records.
 *
 * After the fix:
 *   - `captureMemory()` lives in `memory.mjs` as the single source of truth.
 *   - The orchestrator calls it inline right after building `_memoryCapture`
 *     and stamps `_captured: true` on the receipt so the server-side MCP
 *     handler skips its legacy re-capture path.
 *
 * These tests assert the contract of the shared function only — running the
 * full orchestrator end-to-end is covered by the CLI QA step in the PR.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { captureMemory, autoDrainOpenBrainQueue, shapeQueueRecord } from "../memory.mjs";

let cwd;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pforge-issue205-"));
});

afterEach(() => {
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function readJsonl(absPath) {
  if (!existsSync(absPath)) return [];
  return readFileSync(absPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe("captureMemory — Issue #205 hotfix", () => {
  it("appends to liveguard-memories.jsonl on first capture", () => {
    const res = captureMemory("First capture test", "decision", "forge_run_plan", cwd);

    expect(res.captured).toBe(true);
    expect(res.deduped).toBe(false);
    expect(res.thought).toBeTruthy();
    expect(res.thought.content).toBe("First capture test");

    const records = readJsonl(resolve(cwd, ".forge", "liveguard-memories.jsonl"));
    expect(records).toHaveLength(1);
    expect(records[0].content).toBe("First capture test");
    expect(records[0].type).toBe("decision");
    expect(records[0].source).toBe("forge_run_plan");
    expect(records[0]._v).toBe(1);
    expect(records[0].created_by).toBe("liveguard-auto");
    expect(records[0].captured_at).toBeTruthy();
  });

  it("writes a telemetry row on every capture (even dedupes)", () => {
    captureMemory("Telemetry probe", "decision", "forge_run_plan", cwd);
    const telemetry = readJsonl(resolve(cwd, ".forge", "telemetry", "memory-captures.jsonl"));
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].tool).toBe("forge_run_plan");
    expect(telemetry[0].deduped).toBe(false);
  });

  it("does NOT queue to openbrain-queue.jsonl when OpenBrain is not configured", () => {
    captureMemory("No-OB project", "decision", "forge_run_plan", cwd);
    expect(existsSync(resolve(cwd, ".forge", "openbrain-queue.jsonl"))).toBe(false);
  });

  it("DOES queue to openbrain-queue.jsonl when OpenBrain is configured in .vscode/mcp.json", () => {
    mkdirSync(resolve(cwd, ".vscode"), { recursive: true });
    writeFileSync(
      resolve(cwd, ".vscode", "mcp.json"),
      JSON.stringify({ servers: { openbrain: { type: "sse", url: "https://example/sse" } } }),
    );

    const res = captureMemory("With OpenBrain", "decision", "forge_run_plan", cwd);
    expect(res.openBrainQueued).toBe(true);

    const queue = readJsonl(resolve(cwd, ".forge", "openbrain-queue.jsonl"));
    expect(queue).toHaveLength(1);
    // shapeQueueRecord spreads the thought fields at the top level and
    // prepends delivery-state metadata (_status / _attempts / _enqueuedAt
    // / _nextAttemptAt) — there is no nested `.thought` key.
    expect(queue[0].content).toBe("With OpenBrain");
    expect(queue[0]._status).toBe("pending");
    expect(queue[0]._attempts).toBe(0);
    expect(queue[0]._enqueuedAt).toBeTruthy();
    expect(queue[0]._nextAttemptAt).toBeTruthy();
  });

  it("invokes the onCapture callback with the thought and deduped flag", () => {
    const calls = [];
    captureMemory(
      "Callback probe",
      "decision",
      "forge_run_plan",
      cwd,
      { onCapture: (thought, deduped) => calls.push({ content: thought.content, deduped }) },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ content: "Callback probe", deduped: false });
  });

  it("respects projectName from .forge.json", () => {
    writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify({ projectName: "my-app" }));
    captureMemory("Project-scoped capture", "decision", "forge_run_plan", cwd);
    const records = readJsonl(resolve(cwd, ".forge", "liveguard-memories.jsonl"));
    expect(records[0].project).toBe("my-app");
  });

  it("never throws on missing cwd or bad input — capture is best-effort", () => {
    expect(() => captureMemory(null, null, null, "/nonexistent/path/that/does/not/exist")).not.toThrow();
    expect(() => captureMemory("ok", "decision", "forge_x", undefined)).not.toThrow();
  });

  it("dedupes near-identical captures so we don't dominate L2 with repeats", () => {
    const content = "Plan execution completed: Phase-X. Status: completed. Slices: 7 passed.";
    captureMemory(content, "decision", "forge_run_plan", cwd);
    const second = captureMemory(content, "decision", "forge_run_plan", cwd);

    // Second capture should be deduped (identical content → cosine 1.0 ≥ 0.9 threshold)
    expect(second.deduped).toBe(true);
    const records = readJsonl(resolve(cwd, ".forge", "liveguard-memories.jsonl"));
    expect(records).toHaveLength(1);

    // Telemetry rows DO accumulate (we want visibility into dedup rate)
    const telemetry = readJsonl(resolve(cwd, ".forge", "telemetry", "memory-captures.jsonl"));
    expect(telemetry).toHaveLength(2);
    expect(telemetry[1].deduped).toBe(true);
  });
});

/**
 * Issue #205 fix #3 — autoDrainOpenBrainQueue. Previously the queue file
 * grew forever until a human ran `pforge brain replay`, so L3 search
 * returned stale results for days after a successful run. The orchestrator
 * end-of-run path now invokes autoDrainOpenBrainQueue best-effort.
 */
describe("autoDrainOpenBrainQueue — Issue #205 fix #3", () => {
  function seedOpenBrain(cwd) {
    mkdirSync(resolve(cwd, ".vscode"), { recursive: true });
    writeFileSync(
      resolve(cwd, ".vscode", "mcp.json"),
      JSON.stringify({
        servers: {
          openbrain: { type: "sse", url: "https://example/sse", headers: { "x-brain-key": "test-key" } },
        },
      }),
    );
  }

  function seedQueue(cwd, count) {
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
    const queuePath = resolve(cwd, ".forge", "openbrain-queue.jsonl");
    const lines = [];
    for (let i = 0; i < count; i++) {
      const thought = {
        content: `Queue probe ${i}`,
        project: "plan-forge",
        type: "decision",
        source: "test",
        created_by: "test",
        captured_at: new Date().toISOString(),
      };
      lines.push(JSON.stringify(shapeQueueRecord(thought)));
    }
    writeFileSync(queuePath, lines.join("\n") + "\n", "utf-8");
  }

  it("returns skipped:not-configured when OpenBrain is absent", async () => {
    const result = await autoDrainOpenBrainQueue(cwd);
    expect(result.skipped).toBe("not-configured");
  });

  it("returns skipped:empty when queue file is missing", async () => {
    seedOpenBrain(cwd);
    const result = await autoDrainOpenBrainQueue(cwd);
    expect(result.skipped).toBe("empty");
  });

  it("returns skipped:empty when queue file is present but has no records", async () => {
    seedOpenBrain(cwd);
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
    writeFileSync(resolve(cwd, ".forge", "openbrain-queue.jsonl"), "", "utf-8");
    const result = await autoDrainOpenBrainQueue(cwd);
    expect(result.skipped).toBe("empty");
  });

  it("delivers queued records via dispatcher and clears the queue", async () => {
    seedOpenBrain(cwd);
    seedQueue(cwd, 3);
    const delivered = [];
    const dispatcher = async (rec) => {
      delivered.push(rec);
      return { ok: true };
    };

    const result = await autoDrainOpenBrainQueue(cwd, { dispatcher });

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(3);
    expect(result.delivered).toBe(3);
    expect(result.dlq).toBe(0);
    expect(delivered).toHaveLength(3);

    // Queue file should now be empty
    const queueAfter = readJsonl(resolve(cwd, ".forge", "openbrain-queue.jsonl"));
    expect(queueAfter).toHaveLength(0);

    // Archive should contain the 3 delivered records
    const archive = readJsonl(resolve(cwd, ".forge", "openbrain-queue.archive.jsonl"));
    expect(archive).toHaveLength(3);
    expect(archive[0]._status).toBe("delivered");
    expect(archive[0]._deliveredAt).toBeTruthy();

    // Stats row should be appended
    const stats = readJsonl(resolve(cwd, ".forge", "openbrain-stats.jsonl"));
    expect(stats).toHaveLength(1);
    expect(stats[0].attempted).toBe(3);
    expect(stats[0].delivered).toBe(3);
    expect(stats[0].source).toBe("cli-drain");
  });

  it("retries failed records and keeps them in the queue until DLQ threshold", async () => {
    seedOpenBrain(cwd);
    seedQueue(cwd, 1);
    const dispatcher = async () => ({ ok: false, error: "simulated-failure" });

    const result = await autoDrainOpenBrainQueue(cwd, { dispatcher, maxAttempts: 5 });

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(0);
    expect(result.deferred).toBe(1);
    expect(result.dlq).toBe(0);

    // Queue should still hold the record with an incremented attempt counter
    const queueAfter = readJsonl(resolve(cwd, ".forge", "openbrain-queue.jsonl"));
    expect(queueAfter).toHaveLength(1);
    expect(queueAfter[0]._attempts).toBe(1);
    expect(queueAfter[0]._lastError).toBe("simulated-failure");
  });

  it("moves records to DLQ after exceeding maxAttempts", async () => {
    seedOpenBrain(cwd);
    // Pre-stamp a record at attempts=4 so one more failure pushes to DLQ
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
    const rec = shapeQueueRecord({
      content: "DLQ probe",
      project: "plan-forge",
      type: "decision",
      source: "test",
      created_by: "test",
      captured_at: new Date().toISOString(),
    });
    rec._attempts = 4;
    writeFileSync(resolve(cwd, ".forge", "openbrain-queue.jsonl"), JSON.stringify(rec) + "\n");

    const dispatcher = async () => ({ ok: false, error: "permanent-failure" });
    const result = await autoDrainOpenBrainQueue(cwd, { dispatcher, maxAttempts: 5 });

    expect(result.dlq).toBe(1);
    expect(result.delivered).toBe(0);

    // Queue should be empty (record was moved to DLQ)
    const queueAfter = readJsonl(resolve(cwd, ".forge", "openbrain-queue.jsonl"));
    expect(queueAfter).toHaveLength(0);

    const dlq = readJsonl(resolve(cwd, ".forge", "openbrain-dlq.jsonl"));
    expect(dlq).toHaveLength(1);
    expect(dlq[0].content).toBe("DLQ probe");
  });

  it("never throws when dispatcher itself throws — error contained in result", async () => {
    seedOpenBrain(cwd);
    seedQueue(cwd, 1);
    const dispatcher = async () => { throw new Error("kaboom"); };

    // autoDrainOpenBrainQueue must swallow dispatcher exceptions and
    // return a structured result — never propagate the throw.
    const result = await autoDrainOpenBrainQueue(cwd, { dispatcher });

    // Pure drain function catches dispatcher throws and treats them as failures
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(0);
    expect(result.deferred).toBeGreaterThan(0);
  });
});
