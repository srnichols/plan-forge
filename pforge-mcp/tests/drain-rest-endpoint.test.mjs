import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { runDrainPass } from "../server.mjs";
import { shapeQueueRecord } from "../memory.mjs";
import { readForgeJsonl } from "../orchestrator.mjs";

let tempDir;

function makeTempDir() {
  const dir = resolve(tmpdir(), `pforge-drain-rest-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupForgeDir(cwd) {
  const forgeDir = resolve(cwd, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  return forgeDir;
}

function writeOpenBrainConfig(cwd) {
  const vscodeDir = resolve(cwd, ".vscode");
  mkdirSync(vscodeDir, { recursive: true });
  writeFileSync(resolve(vscodeDir, "mcp.json"), JSON.stringify({
    servers: {
      openbrain: {
        command: "node",
        args: ["openbrain-server.mjs"],
      },
    },
  }), "utf-8");
}

function makeQueueRecord(overrides = {}) {
  const base = shapeQueueRecord({
    content: "test thought for REST drain",
    project: "Plan-Forge",
    type: "convention",
    source: "test",
    created_by: "test-worker",
  });
  base._nextAttemptAt = new Date(Date.now() - 60_000).toISOString();
  base._enqueuedAt = base._nextAttemptAt;
  return { ...base, ...overrides };
}

function writeQueue(forgeDir, records) {
  const lines = records.map(r => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(resolve(forgeDir, "openbrain-queue.jsonl"), lines, "utf-8");
}

beforeEach(() => {
  tempDir = makeTempDir();
});

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* cleanup */ }
});

describe("POST /api/memory/drain — REST endpoint via runDrainPass", () => {
  it("returns NOT_CONFIGURED when OpenBrain is not configured", async () => {
    setupForgeDir(tempDir);

    const result = await runDrainPass(tempDir, "rest-drain", null);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_CONFIGURED");
  });

  it("returns ok with zero counts when queue is empty", async () => {
    setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const result = await runDrainPass(tempDir, "rest-drain", null);

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(0);
    expect(result.delivered).toBe(0);
    expect(result.deferred).toBe(0);
    expect(result.dlq).toBe(0);
    expect(result.durationMs).toBe(0);
  });

  it("drains non-empty queue with mocked dispatcher and returns summary", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);
    const records = [makeQueueRecord(), makeQueueRecord(), makeQueueRecord()];
    writeQueue(forgeDir, records);

    const dispatcher = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDrainPass(tempDir, "rest-drain", null, { dispatcher });

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(3);
    expect(result.delivered).toBe(3);
    expect(result.deferred).toBe(0);
    expect(result.dlq).toBe(0);
    expect(typeof result.durationMs).toBe("number");

    // Queue file should be rewritten (empty — all delivered)
    const survivors = readForgeJsonl("openbrain-queue.jsonl", [], tempDir);
    expect(survivors.length).toBe(0);

    // Archive should have 3 records
    const archived = readForgeJsonl("openbrain-queue.archive.jsonl", [], tempDir);
    expect(archived.length).toBe(3);

    // Stats should have 1 record
    const stats = readForgeJsonl("openbrain-stats.jsonl", [], tempDir);
    expect(stats.length).toBe(1);
    expect(stats[0].delivered).toBe(3);
    expect(stats[0].source).toBe("rest-drain");
  });

  it("uses source tag 'rest-drain' in stats", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);
    writeQueue(forgeDir, [makeQueueRecord()]);

    const dispatcher = vi.fn().mockResolvedValue({ ok: true });
    const result = await runDrainPass(tempDir, "rest-drain", null, { dispatcher });

    expect(result.ok).toBe(true);
    const stats = readForgeJsonl("openbrain-stats.jsonl", [], tempDir);
    expect(stats[0].source).toBe("rest-drain");
  });

  it("broadcasts hub event on successful drain", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);
    writeQueue(forgeDir, [makeQueueRecord(), makeQueueRecord()]);

    const events = [];
    const mockHub = { broadcast: (e) => events.push(e) };
    const dispatcher = vi.fn().mockResolvedValue({ ok: true });

    await runDrainPass(tempDir, "rest-drain", mockHub, { dispatcher });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("openbrain-flush");
    expect(events[0].source).toBe("rest-drain");
    expect(events[0].delivered).toBe(2);
  });

  it("handles partial failure — some records delivered, some deferred", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);
    const records = [makeQueueRecord(), makeQueueRecord(), makeQueueRecord()];
    writeQueue(forgeDir, records);

    let callCount = 0;
    const dispatcher = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 2) return { ok: false, error: "NETWORK_ERROR" };
      return { ok: true };
    });

    const result = await runDrainPass(tempDir, "rest-drain", null, { dispatcher });

    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(2);
    expect(result.deferred).toBeGreaterThanOrEqual(1);
  });
});
