import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Hub } from "../hub.mjs";
import { registerDelegateSyncResponder } from "../tempering/agent-router.mjs";

function makeStubWss() {
  const wss = new EventEmitter();
  wss.close = () => {};
  return wss;
}

function makeHub(cwd) {
  const wss = makeStubWss();
  const hub = new Hub(wss, 0, cwd);
  hub._appendDurableEvent = () => {};
  return { hub, wss };
}

function writeBugs(tmpDir, bugs) {
  const dir = resolve(tmpDir, ".forge", "tempering");
  mkdirSync(dir, { recursive: true });
  const lines = bugs.map((b) => JSON.stringify({ _v: 1, ...b })).join("\n") + "\n";
  writeFileSync(resolve(dir, "bugs.jsonl"), lines);
}

describe("tempering.delegate-sync responder — Slice 06.2", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-delegate-sync-"));
    ({ hub } = makeHub(tmpDir));
  });

  afterEach(() => {
    hub.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Happy path — known bug ─────────────────────────────────────

  it("returns analyst prompt for a known bug", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-001", type: "security", severity: "critical", scanner: "unit" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-001" });
    expect(result.ok).toBe(true);
    expect(result.payload.ok).toBe(true);
    expect(result.payload.prompt).toBeTruthy();
    expect(result.payload.bugId).toBe("BUG-001");
  });

  // ── 2. Unknown bug ───────────────────────────────────────────────

  it("returns ok: false for unknown bugId", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-001", type: "security", severity: "critical" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-999" });
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toBe("bug-not-found");
  });

  // ── 3. Records delegation to delegations.jsonl ────────────────────

  it("records delegation to delegations.jsonl", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-002", type: "security", severity: "critical" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    await hub.ask("tempering.delegate-sync", { bugId: "BUG-002" });

    const delegPath = resolve(tmpDir, ".forge", "tempering", "delegations.jsonl");
    expect(existsSync(delegPath)).toBe(true);
    const lines = readFileSync(delegPath, "utf-8").trim().split("\n");
    const record = JSON.parse(lines[lines.length - 1]);
    expect(record.bugId).toBe("BUG-002");
    expect(record.mode).toBe("sync-ask");
  });

  // ── 4. Prompt contains safety phrase ──────────────────────────────

  it("prompt contains 'do NOT edit files'", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-003", type: "security", severity: "critical" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-003" });
    expect(result.payload.prompt).toContain("do NOT edit files");
  });

  // ── 5. Route matches ROUTING_TABLE ────────────────────────────────

  it("route matches ROUTING_TABLE for security bugs", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-004", type: "security", severity: "critical" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-004" });
    expect(result.payload.agent).toBe("security");
    expect(result.payload.skill).toBe("security-audit");
  });

  // ── 6. Fallback derivation without classifierMeta ─────────────────

  it("handles bug with no classifier meta via scanner fallback", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-005", scanner: "unit", severity: "critical" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-005" });
    expect(result.payload.ok).toBe(true);
    expect(result.payload.agent).toBe("test-runner");
  });

  // ── 7. Response shape ─────────────────────────────────────────────

  it("returns agent and skill in response", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-006", type: "contract", severity: "medium" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-006" });
    expect(result.payload).toHaveProperty("agent");
    expect(result.payload).toHaveProperty("skill");
    expect(result.payload).toHaveProperty("prompt");
    expect(result.payload).toHaveProperty("bugId");
  });

  // ── 8. Scanner-derived bug types ──────────────────────────────────

  it("works with scanner-derived bug types (performance-budget)", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-007", scanner: "performance-budget", severity: "critical" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-007" });
    expect(result.payload.ok).toBe(true);
    expect(result.payload.agent).toBe("performance");
  });

  // ── 9. Missing bugs.jsonl ─────────────────────────────────────────

  it("handles missing bugs.jsonl", async () => {
    registerDelegateSyncResponder(hub, tmpDir);
    const result = await hub.ask("tempering.delegate-sync", { bugId: "BUG-XXX" });
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error).toBe("bug-not-found");
  });

  // ── 10. Delegation mode is sync-ask ───────────────────────────────

  it("records delegation mode as 'sync-ask'", async () => {
    writeBugs(tmpDir, [
      { bugId: "BUG-008", type: "functional", severity: "major" },
    ]);
    registerDelegateSyncResponder(hub, tmpDir);
    await hub.ask("tempering.delegate-sync", { bugId: "BUG-008" });

    const delegPath = resolve(tmpDir, ".forge", "tempering", "delegations.jsonl");
    const lines = readFileSync(delegPath, "utf-8").trim().split("\n");
    const record = JSON.parse(lines[lines.length - 1]);
    expect(record.mode).toBe("sync-ask");
    expect(record._v).toBe(1);
  });
});
