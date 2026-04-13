import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  ensureForgeDir,
  readForgeJson,
  appendForgeJsonl,
  parseValidationGates,
  emitToolTelemetry,
} from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(__dirname, "fixtures", name);

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── ensureForgeDir ──────────────────────────────────────────────────

describe("ensureForgeDir", () => {
  it("creates .forge/<subpath> directory if it doesn't exist", () => {
    const dir = ensureForgeDir("runs", tempDir);
    expect(dir).toBe(resolve(tempDir, ".forge", "runs"));
    expect(existsSync(dir)).toBe(true);
  });

  it("returns resolved absolute path", () => {
    const dir = ensureForgeDir("telemetry", tempDir);
    expect(resolve(dir)).toBe(dir);
  });

  it("is idempotent (calling twice doesn't throw)", () => {
    ensureForgeDir("runs", tempDir);
    ensureForgeDir("runs", tempDir);
    expect(existsSync(resolve(tempDir, ".forge", "runs"))).toBe(true);
  });

  it("handles empty subpath (creates .forge/ root)", () => {
    const dir = ensureForgeDir("", tempDir);
    expect(dir).toBe(resolve(tempDir, ".forge"));
    expect(existsSync(dir)).toBe(true);
  });
});

// ─── readForgeJson ───────────────────────────────────────────────────

describe("readForgeJson", () => {
  it("returns parsed JSON for existing valid file", () => {
    const forgePath = resolve(tempDir, ".forge");
    mkdirSync(forgePath, { recursive: true });
    writeFileSync(resolve(forgePath, "config.json"), JSON.stringify({ key: "value" }));

    expect(readForgeJson("config.json", null, tempDir)).toEqual({ key: "value" });
  });

  it("returns defaultValue for missing file", () => {
    expect(readForgeJson("missing.json", { fallback: true }, tempDir)).toEqual({ fallback: true });
  });

  it("returns defaultValue for corrupt JSON", () => {
    const forgePath = resolve(tempDir, ".forge");
    mkdirSync(forgePath, { recursive: true });
    writeFileSync(resolve(forgePath, "bad.json"), "not json{{{");

    expect(readForgeJson("bad.json", [], tempDir)).toEqual([]);
  });

  it("returns null when no defaultValue specified", () => {
    expect(readForgeJson("nope.json", undefined, tempDir)).toBe(null);
  });
});

// ─── appendForgeJsonl ────────────────────────────────────────────────

describe("appendForgeJsonl", () => {
  it("creates file and writes first record", () => {
    appendForgeJsonl("events/log.jsonl", { event: "start" }, tempDir);
    const content = readFileSync(resolve(tempDir, ".forge", "events", "log.jsonl"), "utf-8");
    expect(content).toBe('{"event":"start"}\n');
  });

  it("appends second record on new line", () => {
    appendForgeJsonl("log.jsonl", { n: 1 }, tempDir);
    appendForgeJsonl("log.jsonl", { n: 2 }, tempDir);
    const lines = readFileSync(resolve(tempDir, ".forge", "log.jsonl"), "utf-8")
      .split("\n").filter(l => l);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ n: 1 });
    expect(JSON.parse(lines[1])).toEqual({ n: 2 });
  });

  it("creates parent directories if missing", () => {
    appendForgeJsonl("deep/nested/log.jsonl", { ok: true }, tempDir);
    expect(existsSync(resolve(tempDir, ".forge", "deep", "nested", "log.jsonl"))).toBe(true);
  });

  it("each line is valid JSON", () => {
    for (let i = 0; i < 5; i++) {
      appendForgeJsonl("multi.jsonl", { i }, tempDir);
    }
    const lines = readFileSync(resolve(tempDir, ".forge", "multi.jsonl"), "utf-8")
      .split("\n").filter(l => l);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ─── parseValidationGates ────────────────────────────────────────────

describe("parseValidationGates", () => {
  it("extracts gates from fixture plan with validation gates", () => {
    const gates = parseValidationGates(fixture("sample-plan.md"));
    expect(gates.length).toBeGreaterThan(0);
    expect(gates[0].sliceNumber).toBe("1");
    expect(gates[0].sliceTitle).toBe("Setup Framework");
    expect(gates[0].gates).toContain("npm test");
  });

  it("returns empty array for plan with no gates", () => {
    const planPath = resolve(tempDir, "no-gates.md");
    writeFileSync(planPath, [
      "# No Gates Plan",
      "**Status**: draft",
      "## Scope Contract",
      "### In Scope",
      "- Something",
      "## Execution Slices",
      "### Slice 1: No Gate Here",
      "1. Do something",
    ].join("\n"));

    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const gates = parseValidationGates(planPath);
      expect(gates).toEqual([]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("strips inline comments from gate commands", () => {
    const planPath = resolve(tempDir, "comments.md");
    writeFileSync(planPath, [
      "# Comments Plan",
      "**Status**: draft",
      "## Scope Contract",
      "### In Scope",
      "- Something",
      "## Execution Slices",
      "### Slice 1: With Comments",
      "**Validation Gate**",
      "```",
      "npm test  # run tests",
      "npm run lint  # check style",
      "```",
    ].join("\n"));

    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const gates = parseValidationGates(planPath);
      expect(gates[0].gates).toEqual(["npm test", "npm run lint"]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("returns correct sliceNumber and sliceTitle per gate block", () => {
    const gates = parseValidationGates(fixture("sample-plan.md"));
    const gate = gates.find(g => g.sliceNumber === "1");
    expect(gate).toBeDefined();
    expect(gate.sliceTitle).toBe("Setup Framework");
  });
});

// ─── emitToolTelemetry ───────────────────────────────────────────────

describe("emitToolTelemetry", () => {
  it("returns a record with timestamp, tool, inputs, result, durationMs, status", () => {
    const record = emitToolTelemetry("forge_smith", { plan: "test.md" }, "ok", 150, "ok", tempDir);
    expect(record).toHaveProperty("timestamp");
    expect(record.tool).toBe("forge_smith");
    expect(record.inputs).toEqual({ plan: "test.md" });
    expect(record.result).toBe("ok");
    expect(record.durationMs).toBe(150);
    expect(record.status).toBe("ok");
  });

  it("writes record to .forge/telemetry/tool-calls.jsonl", () => {
    emitToolTelemetry("forge_validate", {}, "passed", 50, "ok", tempDir);
    const content = readFileSync(
      resolve(tempDir, ".forge", "telemetry", "tool-calls.jsonl"), "utf-8"
    );
    const record = JSON.parse(content.trim());
    expect(record.tool).toBe("forge_validate");
  });

  it("truncates long string results to 2000 chars", () => {
    const longResult = "x".repeat(5000);
    const record = emitToolTelemetry("forge_sweep", {}, longResult, 10, "ok", tempDir);
    expect(record.result.length).toBe(2000);
  });

  it("truncates large object results to 2000 chars", () => {
    const bigObj = { data: "y".repeat(5000) };
    const record = emitToolTelemetry("forge_sweep", {}, bigObj, 10, "ok", tempDir);
    expect(record.result.length).toBeLessThanOrEqual(2000);
  });

  it("does not throw on FS error (best-effort)", () => {
    expect(() => {
      emitToolTelemetry("forge_status", {}, "test", 5, "ok", "/nonexistent/Z:/impossible/path");
    }).not.toThrow();
  });
});
