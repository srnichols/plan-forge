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
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { captureMemory } from "../memory.mjs";

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
