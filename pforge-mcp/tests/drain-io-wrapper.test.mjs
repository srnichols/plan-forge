import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { runDrainPass, __shouldDrainOnInit } from "../server.mjs";
import { shapeQueueRecord } from "../memory.mjs";
import { readForgeJsonl } from "../orchestrator.mjs";

let tempDir;

function makeTempDir() {
  const dir = resolve(tmpdir(), `pforge-drain-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupForgeDir(cwd) {
  const forgeDir = resolve(cwd, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  return forgeDir;
}

function makeQueueRecord(overrides = {}) {
  const base = shapeQueueRecord({
    content: "test thought",
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

function writeOpenBrainConfig(cwd) {
  // isOpenBrainConfigured checks for openbrain MCP server in .vscode/mcp.json
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

beforeEach(() => {
  tempDir = makeTempDir();
});

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* cleanup */ }
});

describe("runDrainPass", () => {
  it("returns NOT_CONFIGURED when OpenBrain not configured", async () => {
    setupForgeDir(tempDir);
    // No .vscode/mcp.json with openbrain → not configured
    const result = await runDrainPass(tempDir, "test-drain", null);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_CONFIGURED");
  });

  it("returns empty success when queue file is missing", async () => {
    setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const result = await runDrainPass(tempDir, "test-drain", null);

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(0);
    expect(result.delivered).toBe(0);
    expect(result.deferred).toBe(0);
    expect(result.dlq).toBe(0);
    expect(result.durationMs).toBe(0);
  });

  it("returns empty success when queue file is empty", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);
    writeFileSync(resolve(forgeDir, "openbrain-queue.jsonl"), "", "utf-8");

    const result = await runDrainPass(tempDir, "test-drain", null);

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(0);
  });

  it("successful drain: rewrites queue, appends archive and stats", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const records = [makeQueueRecord({ content: "thought-1" }), makeQueueRecord({ content: "thought-2" })];
    writeQueue(forgeDir, records);

    const dispatcher = async () => ({ ok: true });
    const result = await runDrainPass(tempDir, "test-drain", null, { dispatcher });

    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(2);
    expect(result.delivered).toBe(2);
    expect(result.deferred).toBe(0);
    expect(result.dlq).toBe(0);
    expect(typeof result.durationMs).toBe("number");

    // Queue file should be empty (no survivors)
    const queueContent = readFileSync(resolve(forgeDir, "openbrain-queue.jsonl"), "utf-8").trim();
    expect(queueContent).toBe("");

    // Archive file should have 2 records
    const archiveRecords = readForgeJsonl("openbrain-queue.archive.jsonl", [], tempDir);
    expect(archiveRecords).toHaveLength(2);
    expect(archiveRecords[0]._status).toBe("delivered");
    expect(archiveRecords[0]._deliveredAt).toBeDefined();

    // Stats file should have 1 record
    const statsRecords = readForgeJsonl("openbrain-stats.jsonl", [], tempDir);
    expect(statsRecords).toHaveLength(1);
    expect(statsRecords[0].delivered).toBe(2);
    expect(statsRecords[0].source).toBe("test-drain");
  });

  it("partial failure: deferred records stay in queue", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const records = [
      makeQueueRecord({ content: "good" }),
      makeQueueRecord({ content: "bad" }),
      makeQueueRecord({ content: "good2" }),
    ];
    writeQueue(forgeDir, records);

    const dispatcher = async (r) => {
      return r.content === "bad" ? { ok: false, error: "network-error" } : { ok: true };
    };
    const result = await runDrainPass(tempDir, "test-drain", null, { dispatcher });

    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(2);
    expect(result.deferred).toBe(1);

    // Queue file should have 1 survivor
    const survivors = readForgeJsonl("openbrain-queue.jsonl", [], tempDir);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]._attempts).toBe(1);
    expect(survivors[0]._lastError).toBe("network-error");
  });

  it("dispatcher exception preserves queue via atomic write rollback", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const records = [makeQueueRecord({ content: "will-throw" })];
    writeQueue(forgeDir, records);

    const dispatcher = async () => {
      throw new Error("connection refused");
    };

    const result = await runDrainPass(tempDir, "test-drain", null, { dispatcher });

    // Dispatcher throws → treated as failure by drainOpenBrainQueue (per-record try/catch)
    // So atomic write should still succeed, with the record retried
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(0);
    expect(result.deferred).toBe(1);

    const survivors = readForgeJsonl("openbrain-queue.jsonl", [], tempDir);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]._lastError).toBe("connection refused");
  });

  it("broadcasts hub event on successful drain", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const records = [makeQueueRecord()];
    writeQueue(forgeDir, records);

    const events = [];
    const mockHub = { broadcast: (e) => events.push(e) };
    const dispatcher = async () => ({ ok: true });

    await runDrainPass(tempDir, "test-drain", mockHub, { dispatcher });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("openbrain-flush");
    expect(events[0].delivered).toBe(1);
    expect(events[0].source).toBe("test-drain");
    expect(events[0].timestamp).toBeDefined();
  });

  it("skips hub broadcast when hub is null", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const records = [makeQueueRecord()];
    writeQueue(forgeDir, records);

    const dispatcher = async () => ({ ok: true });
    // Should not throw when hub is null
    const result = await runDrainPass(tempDir, "test-drain", null, { dispatcher });
    expect(result.ok).toBe(true);
  });

  it("appends DLQ records when records exceed max attempts", async () => {
    const forgeDir = setupForgeDir(tempDir);
    writeOpenBrainConfig(tempDir);

    const records = [makeQueueRecord({ _attempts: 4 })];
    writeQueue(forgeDir, records);

    const dispatcher = async () => ({ ok: false, error: "permanent-failure" });
    const result = await runDrainPass(tempDir, "test-drain", null, { dispatcher });

    expect(result.ok).toBe(true);
    expect(result.dlq).toBe(1);

    const dlqRecords = readForgeJsonl("openbrain-dlq.jsonl", [], tempDir);
    expect(dlqRecords).toHaveLength(1);
    expect(dlqRecords[0]._status).toBe("failed");
  });
});

describe("__shouldDrainOnInit", () => {
  const originalEnv = process.env.PFORGE_DRAIN_ON_INIT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PFORGE_DRAIN_ON_INIT;
    } else {
      process.env.PFORGE_DRAIN_ON_INIT = originalEnv;
    }
  });

  it("returns true when env var is not set", () => {
    delete process.env.PFORGE_DRAIN_ON_INIT;
    expect(__shouldDrainOnInit()).toBe(true);
  });

  it("returns false when env var is 'false'", () => {
    process.env.PFORGE_DRAIN_ON_INIT = "false";
    expect(__shouldDrainOnInit()).toBe(false);
  });

  it("returns true when env var is any other value", () => {
    process.env.PFORGE_DRAIN_ON_INIT = "true";
    expect(__shouldDrainOnInit()).toBe(true);
  });
});
