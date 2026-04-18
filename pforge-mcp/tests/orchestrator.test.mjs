import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  ensureForgeDir,
  readForgeJson,
  appendForgeJsonl,
  readForgeJsonl,
  parseValidationGates,
  lintGateCommands,
  GATE_ALLOWED_PREFIXES,
  isGateCommandAllowed,
  emitToolTelemetry,
  runAnalyze,
  getHealthTrend,
  inferSliceType,
  recommendModel,
  loadModelPerformance,
  recordModelPerformance,
  loadQuorumConfig,
  loadOpenClawConfig,
  scoreSliceComplexity,
  coalesceGateLines,
  parseStderrStats,
  parsePlan,
  findLatestRun,
  parseEventsLog,
  readSliceArtifacts,
  buildWatchSnapshot,
  detectWatchAnomalies,
  runWatch,
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

// ─── lintGateCommands ────────────────────────────────────────────────

describe("lintGateCommands", () => {
  function writePlan(gates, sliceNumber = "1", title = "Test Slice") {
    const planPath = resolve(tempDir, `lint-test-${Date.now()}.md`);
    writeFileSync(planPath, [
      "# Lint Test Plan",
      "**Status**: draft",
      "## Scope Contract",
      "### In Scope",
      "- Something",
      "## Execution Slices",
      `### Slice ${sliceNumber}: ${title}`,
      "**Validation Gate**",
      "```",
      ...gates,
      "```",
    ].join("\n"));
    return planPath;
  }

  it("passes clean gates with no errors or warnings", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["node --version", "npm test"]);
      const result = lintGateCommands(plan);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    } finally { process.chdir(origCwd); }
  });

  it("detects /dev/stdin as error", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["curl http://localhost:3100/api/test | node -e \"require('fs').readFileSync('/dev/stdin','utf8')\""]);
      const result = lintGateCommands(plan);
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.rule === "unix-only-path")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("detects blocked commands as error", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["wget http://example.com"]);
      const result = lintGateCommands(plan);
      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.rule === "blocked-command")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("warns on standalone comment lines", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["# This is a comment", "npm test"]);
      const result = lintGateCommands(plan);
      expect(result.passed).toBe(true); // comments are warnings, not errors
      expect(result.warnings.some(w => w.rule === "comment-line")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("warns on node *.test.mjs (vitest pattern)", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["node pforge-mcp/tests/server.test.mjs"]);
      const result = lintGateCommands(plan);
      expect(result.passed).toBe(true); // warning, not error
      expect(result.warnings.some(w => w.rule === "vitest-direct-node")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("warns on curl localhost in non-final slices", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      // Write a plan with 2 slices, curl in the first
      const planPath = resolve(tempDir, `lint-curl-${Date.now()}.md`);
      writeFileSync(planPath, [
        "# Curl Test Plan",
        "**Status**: draft",
        "## Scope Contract",
        "### In Scope",
        "- Something",
        "## Execution Slices",
        "### Slice 1: First",
        "**Validation Gate**",
        "```",
        "curl http://localhost:3100/api/test | node -e \"console.log('ok')\"",
        "```",
        "### Slice 2: Last",
        "**Validation Gate**",
        "```",
        "npm test",
        "```",
      ].join("\n"));
      const result = lintGateCommands(planPath);
      expect(result.warnings.some(w => w.rule === "runtime-gate")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("GATE_ALLOWED_PREFIXES is exported and contains expected entries", () => {
    expect(Array.isArray(GATE_ALLOWED_PREFIXES)).toBe(true);
    expect(GATE_ALLOWED_PREFIXES).toContain("node");
    expect(GATE_ALLOWED_PREFIXES).toContain("curl");
    expect(GATE_ALLOWED_PREFIXES).toContain("cd");
    expect(GATE_ALLOWED_PREFIXES).not.toContain("wget");
  });

  it("warns on Windows-unavailable commands (grep, sed, awk)", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["grep -c 'forge_' docs/capabilities.md"]);
      const result = lintGateCommands(plan);
      expect(result.warnings.some(w => w.rule === "windows-unavailable")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("warns on Unix-only paths (/tmp/)", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["echo 'test' > /tmp/test.env"]);
      const result = lintGateCommands(plan);
      expect(result.warnings.some(w => w.rule === "unix-only-path")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("warns on project scripts not on PATH (pforge)", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["pforge runbook docs/plans/test.md"]);
      const result = lintGateCommands(plan);
      expect(result.warnings.some(w => w.rule === "project-script")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("warns on JS comments in node -e one-liners", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["node -e \"const x = 1; // this breaks everything\""]);
      const result = lintGateCommands(plan);
      expect(result.warnings.some(w => w.rule === "js-comment-in-eval")).toBe(true);
    } finally { process.chdir(origCwd); }
  });

  it("does NOT warn on http:// URLs in node -e", () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = writePlan(["node -e \"fetch('http://localhost:3100').then(r=>console.log(r.status))\""]);
      const result = lintGateCommands(plan);
      expect(result.warnings.some(w => w.rule === "js-comment-in-eval")).toBe(false);
    } finally { process.chdir(origCwd); }
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

// ─── runAnalyze ──────────────────────────────────────────────────────

describe("runAnalyze", () => {
  it("returns violations array and filesScanned count", async () => {
    // Create a .ts file with a known violation (any type usage)
    const srcDir = resolve(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "bad.ts"), "const x: any = 5;\n");

    const result = await runAnalyze({ path: "src", cwd: tempDir });
    expect(result).toHaveProperty("violations");
    expect(result).toHaveProperty("filesScanned");
    expect(Array.isArray(result.violations)).toBe(true);
    expect(result.filesScanned).toBeGreaterThanOrEqual(1);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0]).toHaveProperty("file");
    expect(result.violations[0]).toHaveProperty("rule");
    expect(result.violations[0]).toHaveProperty("severity");
    expect(result.violations[0]).toHaveProperty("line");
  });

  it("returns empty violations for clean project", async () => {
    const srcDir = resolve(tempDir, "clean");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "good.ts"), "const x: number = 5;\nexport default x;\n");

    const result = await runAnalyze({ path: "clean", cwd: tempDir });
    expect(result.violations).toEqual([]);
    expect(result.filesScanned).toBe(1);
  });

  it("accepts cwd parameter for testability", async () => {
    const result = await runAnalyze({ path: ".", cwd: tempDir });
    expect(result).toHaveProperty("filesScanned");
    expect(result.filesScanned).toBe(0);
  });

  it("detects empty catch blocks", async () => {
    const srcDir = resolve(tempDir, "src2");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "catch.js"), "try { foo(); } catch (e) {}\n");

    const result = await runAnalyze({ path: "src2", cwd: tempDir });
    expect(result.violations.some(v => v.rule === "empty-catch")).toBe(true);
  });

  it("filters by specific rules when provided", async () => {
    const srcDir = resolve(tempDir, "src3");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(resolve(srcDir, "multi.ts"), "const x: any = 5;\ntry { foo(); } catch (e) {}\n");

    const allResult = await runAnalyze({ path: "src3", cwd: tempDir });
    const filteredResult = await runAnalyze({ path: "src3", rules: ["empty-catch"], cwd: tempDir });

    expect(allResult.violations.length).toBeGreaterThan(filteredResult.violations.length);
    expect(filteredResult.violations.every(v => v.rule === "empty-catch")).toBe(true);
  });

  it("skips node_modules and .git directories", async () => {
    const nmDir = resolve(tempDir, "node_modules", "pkg");
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(resolve(nmDir, "index.ts"), "const x: any = 5;\n");

    const result = await runAnalyze({ path: ".", cwd: tempDir });
    expect(result.violations).toEqual([]);
  });
});

// ─── readForgeJsonl ──────────────────────────────────────────────────

describe("readForgeJsonl", () => {
  it("returns defaultValue when file does not exist", () => {
    const result = readForgeJsonl("nonexistent.jsonl", [], tempDir);
    expect(result).toEqual([]);
  });

  it("returns custom default for missing file", () => {
    const result = readForgeJsonl("missing.jsonl", [{ fallback: true }], tempDir);
    expect(result).toEqual([{ fallback: true }]);
  });

  it("reads single-line JSONL correctly", () => {
    appendForgeJsonl("single.jsonl", { key: "value" }, tempDir);
    const result = readForgeJsonl("single.jsonl", [], tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("value");
  });

  it("reads multi-line JSONL correctly", () => {
    appendForgeJsonl("multi.jsonl", { n: 1 }, tempDir);
    appendForgeJsonl("multi.jsonl", { n: 2 }, tempDir);
    appendForgeJsonl("multi.jsonl", { n: 3 }, tempDir);
    const result = readForgeJsonl("multi.jsonl", [], tempDir);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.n)).toEqual([1, 2, 3]);
  });

  it("returns defaultValue for corrupt JSONL", () => {
    const forgePath = resolve(tempDir, ".forge");
    mkdirSync(forgePath, { recursive: true });
    writeFileSync(resolve(forgePath, "bad.jsonl"), "not json{{{");
    const result = readForgeJsonl("bad.jsonl", [], tempDir);
    expect(result).toEqual([]);
  });

  it("skips blank lines in JSONL", () => {
    const forgePath = resolve(tempDir, ".forge");
    mkdirSync(forgePath, { recursive: true });
    writeFileSync(resolve(forgePath, "blanks.jsonl"), '{"a":1}\n\n{"b":2}\n\n');
    const result = readForgeJsonl("blanks.jsonl", [], tempDir);
    expect(result).toHaveLength(2);
    expect(result[0].a).toBe(1);
    expect(result[1].b).toBe(2);
  });
});

// ─── isGateCommandAllowed ────────────────────────────────────────────

describe("isGateCommandAllowed", () => {
  it("allows npm test", () => {
    expect(isGateCommandAllowed("npm test")).toBe(true);
  });

  it("allows node -e command", () => {
    expect(isGateCommandAllowed('node -e "console.log(1)"')).toBe(true);
  });

  it("allows dotnet test", () => {
    expect(isGateCommandAllowed("dotnet test")).toBe(true);
  });

  it("allows npx vitest run", () => {
    expect(isGateCommandAllowed("npx vitest run")).toBe(true);
  });

  it("allows cd followed by command", () => {
    expect(isGateCommandAllowed("cd pforge-mcp")).toBe(true);
  });

  it("allows curl localhost", () => {
    expect(isGateCommandAllowed("curl http://localhost:3100/api/test")).toBe(true);
  });

  it("allows env-var prefix (NODE_ENV=test npm test)", () => {
    expect(isGateCommandAllowed("NODE_ENV=test npm test")).toBe(true);
  });

  it("allows git commands", () => {
    expect(isGateCommandAllowed("git status")).toBe(true);
  });

  it("allows cat command", () => {
    expect(isGateCommandAllowed("cat VERSION")).toBe(true);
  });

  it("allows python command", () => {
    expect(isGateCommandAllowed("python -m pytest")).toBe(true);
  });

  it("blocks rm -rf /", () => {
    expect(isGateCommandAllowed("rm -rf /")).toBe(false);
  });

  it("blocks rm -fr ~", () => {
    expect(isGateCommandAllowed("rm -fr ~")).toBe(false);
  });

  it("blocks dd to block device", () => {
    expect(isGateCommandAllowed("dd if=/dev/zero of=/dev/sda")).toBe(false);
  });

  it("blocks mkfs", () => {
    expect(isGateCommandAllowed("mkfs.ext4 /dev/sda1")).toBe(false);
  });

  it("blocks wget (not in allowlist)", () => {
    expect(isGateCommandAllowed("wget http://example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGateCommandAllowed("")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isGateCommandAllowed(null)).toBe(false);
    expect(isGateCommandAllowed(undefined)).toBe(false);
  });

  it("GATE_ALLOWED_PREFIXES contains all expected entries", () => {
    const expected = ["node", "npm", "npx", "curl", "cd", "git", "cat", "dotnet", "python", "go"];
    for (const prefix of expected) {
      expect(GATE_ALLOWED_PREFIXES).toContain(prefix);
    }
  });
});

// ─── inferSliceType ──────────────────────────────────────────────────

describe("inferSliceType", () => {
  it("returns 'test' for slice with test tasks", () => {
    expect(inferSliceType({ title: "Add unit test for login", tasks: [] })).toBe("test");
  });

  it("returns 'test' for slice with spec in title", () => {
    expect(inferSliceType({ title: "Write spec for login", tasks: [] })).toBe("test");
  });

  it("returns 'test' for slice with e2e in tasks", () => {
    expect(inferSliceType({ title: "Slice 3", tasks: ["Run e2e suite"] })).toBe("test");
  });

  it("returns 'test' for coverage task", () => {
    expect(inferSliceType({ title: "Check coverage", tasks: [] })).toBe("test");
  });

  it("returns 'review' for audit tasks", () => {
    expect(inferSliceType({ title: "Security audit", tasks: [] })).toBe("review");
  });

  it("returns 'review' for lint tasks", () => {
    expect(inferSliceType({ title: "Run lint checks", tasks: [] })).toBe("review");
  });

  it("returns 'review' for analyze task", () => {
    expect(inferSliceType({ title: "Analyze code quality", tasks: [] })).toBe("review");
  });

  it("returns 'migration' for schema changes", () => {
    expect(inferSliceType({ title: "Database migration", tasks: [] })).toBe("migration");
  });

  it("returns 'migration' for create table tasks", () => {
    expect(inferSliceType({ title: "Build feature", tasks: ["Create table users"] })).toBe("migration");
  });

  it("returns 'migration' for EF Core tasks", () => {
    expect(inferSliceType({ title: "Setup DbContext", tasks: ["Add EF Core migration"] })).toBe("migration");
  });

  it("returns 'execute' for generic slices", () => {
    expect(inferSliceType({ title: "Implement API endpoints", tasks: ["Build REST routes"] })).toBe("execute");
  });

  it("returns 'execute' when title and tasks are empty", () => {
    expect(inferSliceType({ title: "", tasks: [] })).toBe("execute");
  });

  it("handles missing fields gracefully", () => {
    expect(inferSliceType({})).toBe("execute");
    expect(inferSliceType({ title: null })).toBe("execute");
  });
});

// ─── getHealthTrend ──────────────────────────────────────────────────

describe("getHealthTrend", () => {
  it("returns result with no data when .forge directory is empty", () => {
    const result = getHealthTrend(tempDir, 30);
    expect(result).toHaveProperty("days", 30);
    expect(result).toHaveProperty("metricsIncluded");
    expect(result).toHaveProperty("generatedAt");
    expect(result).toHaveProperty("dataPoints", 0);
    // drift.trend is "insufficient-data" with 0 snapshots; that takes precedence
    expect(result.trend).toBe("insufficient-data");
    // incidents metric contributes 100 (no incidents = no penalty), so healthScore is not null
    expect(typeof result.healthScore).toBe("number");
  });

  it("includes all 5 metrics by default", () => {
    const result = getHealthTrend(tempDir, 30);
    expect(result.metricsIncluded).toEqual(["drift", "cost", "incidents", "models", "tests"]);
  });

  it("filters to requested metrics only", () => {
    const result = getHealthTrend(tempDir, 30, ["drift"]);
    expect(result.metricsIncluded).toEqual(["drift"]);
    expect(result).toHaveProperty("drift");
    expect(result).not.toHaveProperty("cost");
    expect(result).not.toHaveProperty("incidents");
  });

  it("ignores unknown metric names", () => {
    const result = getHealthTrend(tempDir, 30, ["drift", "nonexistent"]);
    expect(result.metricsIncluded).toEqual(["drift"]);
  });

  it("computes drift stats from drift-history.json", () => {
    const now = new Date().toISOString();
    appendForgeJsonl("drift-history.json", { timestamp: now, score: 90, violations: [], filesScanned: 10 }, tempDir);
    appendForgeJsonl("drift-history.json", { timestamp: now, score: 80, violations: [], filesScanned: 10 }, tempDir);

    const result = getHealthTrend(tempDir, 30, ["drift"]);
    expect(result.drift.snapshots).toBe(2);
    expect(result.drift.latest).toBe(80);
    expect(result.drift.avg).toBe(85);
    expect(result.drift.min).toBe(80);
    expect(result.drift.max).toBe(90);
    expect(result.dataPoints).toBe(2);
  });

  it("excludes drift records outside the time window", () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    const recent = new Date().toISOString();
    appendForgeJsonl("drift-history.json", { timestamp: old, score: 50 }, tempDir);
    appendForgeJsonl("drift-history.json", { timestamp: recent, score: 90 }, tempDir);

    const result = getHealthTrend(tempDir, 30, ["drift"]);
    expect(result.drift.snapshots).toBe(1);
    expect(result.drift.latest).toBe(90);
  });

  it("computes incident stats from incidents.jsonl", () => {
    const now = new Date().toISOString();
    appendForgeJsonl("incidents.jsonl", { capturedAt: now, severity: "high", resolvedAt: now, mttr: 60000 }, tempDir);
    appendForgeJsonl("incidents.jsonl", { capturedAt: now, severity: "low", resolvedAt: null, mttr: null }, tempDir);

    const result = getHealthTrend(tempDir, 30, ["incidents"]);
    expect(result.incidents.total).toBe(2);
    expect(result.incidents.resolved).toBe(1);
    expect(result.incidents.open).toBe(1);
    expect(result.incidents.avgMttrMs).toBe(60000);
    expect(result.incidents.bySeverity.high).toBe(1);
    expect(result.incidents.bySeverity.low).toBe(1);
  });

  it("computes model stats from model-performance.json", () => {
    const now = new Date().toISOString();
    recordModelPerformance(tempDir, { date: now, model: "gpt-4o", status: "passed", cost_usd: 0.05 });
    recordModelPerformance(tempDir, { date: now, model: "gpt-4o", status: "passed", cost_usd: 0.03 });
    recordModelPerformance(tempDir, { date: now, model: "claude-sonnet", status: "failed", cost_usd: 0.10 });

    const result = getHealthTrend(tempDir, 30, ["models"]);
    expect(result.models.totalSlices).toBe(3);
    expect(result.models.byModel["gpt-4o"].slices).toBe(2);
    expect(result.models.byModel["gpt-4o"].successRate).toBe(1);
    expect(result.models.byModel["claude-sonnet"].slices).toBe(1);
  });

  it("computes healthScore as average of component scores", () => {
    const now = new Date().toISOString();
    appendForgeJsonl("drift-history.json", { timestamp: now, score: 80 }, tempDir);

    const result = getHealthTrend(tempDir, 30, ["drift"]);
    expect(result.healthScore).toBe(80);
  });
});

// ─── recommendModel ──────────────────────────────────────────────────

describe("recommendModel", () => {
  it("returns null when no performance data exists", () => {
    expect(recommendModel(tempDir)).toBeNull();
  });

  it("returns null when all models have fewer than 3 records", () => {
    recordModelPerformance(tempDir, { date: new Date().toISOString(), model: "gpt-4o", status: "passed", cost_usd: 0.05 });
    recordModelPerformance(tempDir, { date: new Date().toISOString(), model: "gpt-4o", status: "passed", cost_usd: 0.05 });
    expect(recommendModel(tempDir)).toBeNull();
  });

  it("returns the cheapest qualifying model", () => {
    const date = new Date().toISOString();
    // Model A: 4 slices, 100% pass, avg $0.10
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "cheap-model", status: "passed", cost_usd: 0.10 });
    }
    // Model B: 4 slices, 100% pass, avg $0.50
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "expensive-model", status: "passed", cost_usd: 0.50 });
    }

    const rec = recommendModel(tempDir);
    expect(rec).not.toBeNull();
    expect(rec.model).toBe("cheap-model");
    expect(rec.success_rate).toBeGreaterThan(0.8);
  });

  it("excludes models with success rate <= 80%", () => {
    const date = new Date().toISOString();
    // Model: 5 slices, 2 passed (40% success) — should NOT qualify
    for (let i = 0; i < 5; i++) {
      recordModelPerformance(tempDir, { date, model: "bad-model", status: i < 2 ? "passed" : "failed", cost_usd: 0.01 });
    }

    expect(recommendModel(tempDir)).toBeNull();
  });

  it("filters by sliceType when provided", () => {
    const date = new Date().toISOString();
    // "test" slices: model-a has 4 records
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "model-a", sliceType: "test", status: "passed", cost_usd: 0.02 });
    }
    // "execute" slices: model-b has 4 records
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "model-b", sliceType: "execute", status: "passed", cost_usd: 0.08 });
    }

    const recTest = recommendModel(tempDir, "test");
    expect(recTest).not.toBeNull();
    expect(recTest.model).toBe("model-a");
  });

  it("falls back to all records when type-specific data is insufficient", () => {
    const date = new Date().toISOString();
    // Only 1 test record — fewer than MIN_SAMPLE of 3
    recordModelPerformance(tempDir, { date, model: "model-a", sliceType: "test", status: "passed", cost_usd: 0.02 });
    // 3 execute records for the same model
    for (let i = 0; i < 3; i++) {
      recordModelPerformance(tempDir, { date, model: "model-a", sliceType: "execute", status: "passed", cost_usd: 0.02 });
    }

    const rec = recommendModel(tempDir, "test");
    expect(rec).not.toBeNull();
    expect(rec.model).toBe("model-a");
  });
});

// ─── loadQuorumConfig ───────────────────────────────────────────────────

describe("loadQuorumConfig", () => {
  it("returns defaults when no config exists", () => {
    const config = loadQuorumConfig(tempDir);
    expect(config.enabled).toBe(false);
    expect(config.auto).toBe(true);
    expect(config.threshold).toBe(6);
    expect(config.models).toEqual(["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20-0309-reasoning"]);
    expect(config.reviewerModel).toBe("claude-opus-4.6");
    expect(config.dryRunTimeout).toBe(300_000);
  });

  it("merges quorum section from .forge.json", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), JSON.stringify({
      quorum: { enabled: true, threshold: 9 }
    }));
    const config = loadQuorumConfig(tempDir);
    expect(config.enabled).toBe(true);
    expect(config.threshold).toBe(9);
    expect(config.auto).toBe(true);
  });

  it("ignores non-quorum sections in .forge.json", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), JSON.stringify({
      hooks: { preDeploy: { enabled: false } }
    }));
    const config = loadQuorumConfig(tempDir);
    expect(config.threshold).toBe(6);
  });

  it("handles corrupt .forge.json with defaults", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), "CORRUPT");
    const config = loadQuorumConfig(tempDir);
    expect(config.threshold).toBe(6);
    expect(config.models).toHaveLength(3);
  });

  it("applies preset override parameter", () => {
    const config = loadQuorumConfig(tempDir, "power");
    expect(config.preset).toBe("power");
  });

  it("power preset uses claude-opus-4.7 as reviewer model (v2.34)", () => {
    const config = loadQuorumConfig(tempDir, "power");
    expect(config.reviewerModel).toBe("claude-opus-4.7");
  });

  it("user config overrides preset values", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), JSON.stringify({
      quorum: { threshold: 10, models: ["custom-model"] }
    }));
    const config = loadQuorumConfig(tempDir, "speed");
    expect(config.threshold).toBe(10);
    expect(config.models).toEqual(["custom-model"]);
    expect(config.preset).toBe("speed");
  });
});

// ─── loadOpenClawConfig ─────────────────────────────────────────────────

describe("loadOpenClawConfig", () => {
  it("returns null endpoint when no config exists", () => {
    const config = loadOpenClawConfig(tempDir);
    expect(config.endpoint).toBeNull();
    expect(config.apiKey).toBeNull();
  });

  it("reads endpoint and apiKey from .forge.json openclaw section", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), JSON.stringify({
      openclaw: { endpoint: "https://example.com/api", apiKey: "key-123" }
    }));
    const config = loadOpenClawConfig(tempDir);
    expect(config.endpoint).toBe("https://example.com/api");
    expect(config.apiKey).toBe("key-123");
  });

  it("falls back to .forge/secrets.json for apiKey", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), JSON.stringify({
      openclaw: { endpoint: "https://example.com" }
    }));
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "secrets.json"), JSON.stringify({ OPENCLAW_API_KEY: "secret-key" }));

    const config = loadOpenClawConfig(tempDir);
    expect(config.endpoint).toBe("https://example.com");
    expect(config.apiKey).toBe("secret-key");
  });

  it("returns null when openclaw section has no endpoint", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), JSON.stringify({
      openclaw: { apiKey: "key-only" }
    }));
    const config = loadOpenClawConfig(tempDir);
    expect(config.endpoint).toBeNull();
  });

  it("handles corrupt .forge.json gracefully", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), "BAD");
    const config = loadOpenClawConfig(tempDir);
    expect(config.endpoint).toBeNull();
  });

  it("handles corrupt secrets.json gracefully", () => {
    writeFileSync(resolve(tempDir, ".forge.json"), JSON.stringify({
      openclaw: { endpoint: "https://test.com" }
    }));
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "secrets.json"), "NOT JSON");

    const config = loadOpenClawConfig(tempDir);
    expect(config.endpoint).toBe("https://test.com");
    expect(config.apiKey).toBeNull();
  });
});

// ─── scoreSliceComplexity ───────────────────────────────────────────────

describe("scoreSliceComplexity", () => {
  it("returns low score for simple slice", () => {
    const result = scoreSliceComplexity({ title: "Update readme", tasks: ["Edit README.md"], scope: ["README.md"] }, tempDir);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it("returns higher score for security-sensitive slice", () => {
    const simple = scoreSliceComplexity({ title: "Update readme", tasks: ["Edit file"], scope: ["README.md"] }, tempDir);
    const complex = scoreSliceComplexity({ title: "Fix auth security vulnerability", tasks: ["Patch SQL injection", "Update RBAC middleware", "Add auth tests", "Fix CSRF token"], scope: ["src/auth.ts", "src/middleware.ts", "src/db.ts", "src/routes.ts", "src/tests/auth.test.ts"] }, tempDir);
    expect(complex.score).toBeGreaterThanOrEqual(simple.score);
  });

  it("returns signals object with weight fields", () => {
    const result = scoreSliceComplexity({ title: "Test slice", tasks: ["Task 1"], scope: [] }, tempDir);
    expect(result).toHaveProperty("signals");
    expect(typeof result.signals).toBe("object");
  });
});

// ─── coalesceGateLines ───────────────────────────────────────────────

describe("coalesceGateLines", () => {
  it("extracts simple shell commands", () => {
    const gate = `npm test\npnpm lint\necho ok`;
    expect(coalesceGateLines(gate)).toEqual(["npm test", "pnpm lint", "echo ok"]);
  });

  it("skips markdown-style numbered list prose (regression: slice-7 false failure)", () => {
    // Real-world case from Rummag Phase-01 CI/CD slice: plan authors described
    // CSRF flow as numbered prose. Previously these were sent to runGate and
    // rejected by the allowlist as "'1.' not in allowlist", failing the slice.
    const gate = `1. Server generates CSRF token on session creation → sets as httpOnly cookie \`_csrf\`.\n2. Client reads cookie and mirrors value in X-CSRF-Token header.\nnpm test`;
    const result = coalesceGateLines(gate);
    expect(result).toEqual(["npm test"]);
  });

  it("skips bulleted prose lines", () => {
    const gate = `- Install dependencies\n* Run migrations\n+ Verify connection\nnpm run build`;
    expect(coalesceGateLines(gate)).toEqual(["npm run build"]);
  });

  it("does not strip commands whose args contain numbers", () => {
    // Don't confuse "pytest -n 4" or "curl https://api/v1/thing" with a list item
    const gate = `pytest -n 4\ncurl https://api/v1/health`;
    expect(coalesceGateLines(gate)).toEqual(["pytest -n 4", "curl https://api/v1/health"]);
  });

  it("strips standalone comments but preserves commands", () => {
    const gate = `# Run all validation\nnpm test\n# Then lint\npnpm lint`;
    expect(coalesceGateLines(gate)).toEqual(["npm test", "pnpm lint"]);
  });
});

// ─── parseStderrStats ───────────────────────────────────────────────

describe("parseStderrStats", () => {
  it("parses UTF-8 token summary from gh copilot (new format)", () => {
    const stderr = `Model     claude-opus-4.6\nTokens    ↑ 476.0k • ↓ 3.1k • 430.1k (cached)\nRequests  3 Premium (1m 35s)`;
    const stats = parseStderrStats(stderr);
    expect(stats.model).toBe("claude-opus-4.6");
    expect(stats.tokens_in).toBe(476_000);
    expect(stats.tokens_out).toBe(3_100);
    expect(stats.premiumRequests).toBe(3);
  });

  it("parses ASCII-fallback token summary (Windows cp437 / CI log strip)", () => {
    // When Unicode arrows are stripped/replaced, we still want to capture counts.
    const stderr = `Model     claude-opus-4.6\nTokens    ^ 3.2m * v 10.5k * 3.1m (cached)\nRequests  3 Premium (4m 41s)`;
    const stats = parseStderrStats(stderr);
    expect(stats.tokens_in).toBe(3_200_000);
    expect(stats.tokens_out).toBe(10_500);
    expect(stats.premiumRequests).toBe(3);
  });

  it("parses old per-model breakdown format", () => {
    const stderr = ` claude-sonnet-4.6  639.4k in, 4.5k out, 552.1k cached\n1 Premium request`;
    const stats = parseStderrStats(stderr);
    expect(stats.model).toBe("claude-sonnet-4.6");
    expect(stats.tokens_in).toBe(639_400);
    expect(stats.tokens_out).toBe(4_500);
    expect(stats.premiumRequests).toBe(1);
  });

  it("returns zero stats for empty input", () => {
    expect(parseStderrStats("")).toEqual({ model: null, tokens_in: 0, tokens_out: 0, premiumRequests: 0 });
    expect(parseStderrStats(null)).toEqual({ model: null, tokens_in: 0, tokens_out: 0, premiumRequests: 0 });
  });

  it("handles millions and billions suffixes", () => {
    const stderr = `Tokens    ↑ 3.2m • ↓ 1.5b • 0 (cached)`;
    const stats = parseStderrStats(stderr);
    expect(stats.tokens_in).toBe(3_200_000);
    expect(stats.tokens_out).toBe(1_500_000_000);
  });
});

// ─── scoreSliceComplexity signal detection (Rummag regression) ───────

describe("scoreSliceComplexity signal detection", () => {
  function writePlanWithSlice(body) {
    const planPath = resolve(tempDir, "signals-plan.md");
    writeFileSync(planPath, [
      "# Signals Plan",
      "**Status**: draft",
      "## Scope Contract",
      "### In Scope",
      "- Something",
      "## Execution Slices",
      body,
    ].join("\n"));
    return planPath;
  }

  it("SECURITY_KEYWORDS regex is global — counts ALL hits, not just one", () => {
    // Regression: without /g flag, .match() returned max 2 elements (match + capture),
    // so securityWeight could never exceed 0.67 even on heavily security-focused slices.
    const planPath = writePlanWithSlice([
      "### Slice 1: Auth — Tokens, OAuth, Password Hashing",
      "1. Implement JWT token issuance with httpOnly cookies",
      "2. Configure OAuth provider (Google) for SSO",
      "3. Hash passwords with bcrypt, enforce RBAC via role claims",
      "4. Add CORS middleware and rate-limit credential endpoints",
      "5. Audit permission checks on every protected route",
    ].join("\n"));
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = parsePlan(planPath, tempDir);
      const { signals } = scoreSliceComplexity(plan.slices[0], tempDir);
      // Slice text contains: auth, token, jwt, oauth, password, rbac, role, cors, credential, permission — 10+ hits
      // With /g flag, securityWeight should saturate to 1.0 (3+ hits)
      expect(signals.securityWeight).toBe(1);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("DATABASE_KEYWORDS regex is global", () => {
    const planPath = writePlanWithSlice([
      "### Slice 1: Schema Migration",
      "1. Create migration to alter users table",
      "2. Add index on email, foreign key constraint to tenant",
      "3. Seed initial data via repository pattern",
    ].join("\n"));
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = parsePlan(planPath, tempDir);
      const { signals } = scoreSliceComplexity(plan.slices[0], tempDir);
      expect(signals.databaseWeight).toBe(1);
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ─── parsePlan body-line parsing (Rummag regression) ─────────────────

describe("parsePlan body-line metadata", () => {
  function writeBodyPlan(body) {
    const planPath = resolve(tempDir, "body-plan.md");
    writeFileSync(planPath, [
      "# Body Plan",
      "**Status**: draft",
      "## Scope Contract",
      "### In Scope",
      "- Something",
      "## Execution Slices",
      body,
    ].join("\n"));
    return planPath;
  }

  it("parses **Depends On:** body line into depends[] (Rummag format)", () => {
    // Regression: Rummag plan writes deps as body prose, not header tag.
    // Previously depends[] was always [] → dependencyWeight always 0 → quorum never triggered.
    const planPath = writeBodyPlan([
      "### Slice 3: Campaigns",
      "1. Build campaign CRUD",
      "**Depends On:** Slice 1, Slice 2A (auth + items required)",
    ].join("\n"));
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = parsePlan(planPath, tempDir);
      expect(plan.slices[0].depends).toEqual(["1", "2A"]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("merges body **Depends On:** with header [depends: ...] tag without duplicates", () => {
    const planPath = writeBodyPlan([
      "### Slice 3: Campaigns [depends: 1]",
      "1. Do stuff",
      "**Depends On:** Slice 1, Slice 2",
    ].join("\n"));
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = parsePlan(planPath, tempDir);
      expect(plan.slices[0].depends.sort()).toEqual(["1", "2"]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("parses **Context Files:** body line into scope[] (Rummag format)", () => {
    // Regression: Rummag plan declares context as backtick-wrapped paths in body,
    // not header [scope:] tag. Previously scope[] was always [] → scopeWeight always 0.
    const planPath = writeBodyPlan([
      "### Slice 1: Auth",
      "1. Implement Auth.js v5",
      "**Context Files:** `.github/instructions/auth.instructions.md`, `Phase-01.md`, `apps/api/src/auth/`",
    ].join("\n"));
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = parsePlan(planPath, tempDir);
      expect(plan.slices[0].scope).toEqual([
        ".github/instructions/auth.instructions.md",
        "Phase-01.md",
        "apps/api/src/auth/",
      ]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("body Context Files does not duplicate header [scope:] entries", () => {
    const planPath = writeBodyPlan([
      "### Slice 1: Auth [scope: src/auth/**]",
      "1. Implement auth",
      "**Context Files:** `src/auth/**`, `docs/auth.md`",
    ].join("\n"));
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = parsePlan(planPath, tempDir);
      expect(plan.slices[0].scope.sort()).toEqual(["docs/auth.md", "src/auth/**"]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("integration: Rummag-style slice produces non-zero scope/dependency/security weights", () => {
    // End-to-end regression: ensure complexity score rises above the previous
    // stuck-at-2 baseline when the parser actually captures metadata.
    const planPath = writeBodyPlan([
      "### Slice 5: Payments — Stripe Standard Checkout",
      "1. Implement PaymentIntent creation with auth-protected endpoints",
      "2. Add webhook signature verification using Stripe secret",
      "3. Enforce RBAC role checks on refund endpoints",
      "4. Store payment credentials via encrypted token storage",
      "5. Write migration for payment_intents schema with index on user_id",
      "**Depends On:** Slice 1, Slice 2A",
      "**Context Files:** `apps/api/src/payments/`, `apps/api/src/webhooks/`, `packages/db/migrations/`",
    ].join("\n"));
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = parsePlan(planPath, tempDir);
      const slice = plan.slices[0];
      const { score, signals } = scoreSliceComplexity(slice, tempDir);
      expect(slice.depends.length).toBe(2);
      expect(slice.scope.length).toBe(3);
      expect(signals.scopeWeight).toBeGreaterThan(0);
      expect(signals.dependencyWeight).toBeGreaterThan(0);
      expect(signals.securityWeight).toBeGreaterThan(0);
      expect(score).toBeGreaterThanOrEqual(3); // Previously stuck at 2
    } finally {
      process.chdir(origCwd);
    }
  });
});

// ─── Watcher (v2.34) ─────────────────────────────────────────────────

describe("Watcher: findLatestRun", () => {
  it("returns null when .forge/runs/ doesn't exist", () => {
    expect(findLatestRun(tempDir)).toBeNull();
  });

  it("returns null when runs dir is empty", () => {
    mkdirSync(resolve(tempDir, ".forge", "runs"), { recursive: true });
    expect(findLatestRun(tempDir)).toBeNull();
  });

  it("returns the lexicographically last run dir", () => {
    const runs = resolve(tempDir, ".forge", "runs");
    mkdirSync(resolve(runs, "20250101-aaa"), { recursive: true });
    mkdirSync(resolve(runs, "20250201-bbb"), { recursive: true });
    mkdirSync(resolve(runs, "20250101-ccc"), { recursive: true });
    const result = findLatestRun(tempDir);
    expect(result.runId).toBe("20250201-bbb");
  });

  it("honors explicit runId", () => {
    const runs = resolve(tempDir, ".forge", "runs");
    mkdirSync(resolve(runs, "specific-run"), { recursive: true });
    mkdirSync(resolve(runs, "newer-run"), { recursive: true });
    const result = findLatestRun(tempDir, "specific-run");
    expect(result.runId).toBe("specific-run");
  });

  it("returns null when explicit runId doesn't exist", () => {
    mkdirSync(resolve(tempDir, ".forge", "runs", "real-run"), { recursive: true });
    expect(findLatestRun(tempDir, "fake-run")).toBeNull();
  });
});

describe("Watcher: parseEventsLog", () => {
  it("returns empty array when events.log missing", () => {
    expect(parseEventsLog(tempDir)).toEqual([]);
  });

  it("parses valid event lines", () => {
    const log = [
      `[2025-01-01T00:00:00.000Z] run-started: {"plan":"Phase-1.md","sliceCount":3}`,
      `[2025-01-01T00:00:05.000Z] slice-started: {"sliceNumber":1}`,
      `[2025-01-01T00:01:00.000Z] slice-completed: {"sliceNumber":1,"status":"passed"}`,
    ].join("\n");
    writeFileSync(resolve(tempDir, "events.log"), log);
    const events = parseEventsLog(tempDir);
    expect(events.length).toBe(3);
    expect(events[0].type).toBe("run-started");
    expect(events[0].data.plan).toBe("Phase-1.md");
    expect(events[2].data.status).toBe("passed");
  });

  it("skips malformed lines without crashing", () => {
    writeFileSync(resolve(tempDir, "events.log"), "not a real line\n[2025-01-01T00:00:00.000Z] run-started: {}\ngarbage");
    const events = parseEventsLog(tempDir);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("run-started");
  });
});

describe("Watcher: readSliceArtifacts", () => {
  it("returns empty when no slice files present", () => {
    expect(readSliceArtifacts(tempDir)).toEqual([]);
  });

  it("reads and sorts slice-N.json artifacts", () => {
    writeFileSync(resolve(tempDir, "slice-3.json"), JSON.stringify({ status: "passed", title: "Three" }));
    writeFileSync(resolve(tempDir, "slice-1.json"), JSON.stringify({ status: "passed", title: "One" }));
    writeFileSync(resolve(tempDir, "slice-2.json"), JSON.stringify({ status: "failed", title: "Two" }));
    writeFileSync(resolve(tempDir, "summary.json"), "{}"); // should be ignored
    const arts = readSliceArtifacts(tempDir);
    expect(arts.length).toBe(3);
    expect(arts[0].sliceNumber).toBe(1);
    expect(arts[1].sliceNumber).toBe(2);
    expect(arts[2].sliceNumber).toBe(3);
    expect(arts[1].status).toBe("failed");
  });

  it("skips malformed JSON files", () => {
    writeFileSync(resolve(tempDir, "slice-1.json"), "{not valid json");
    writeFileSync(resolve(tempDir, "slice-2.json"), JSON.stringify({ status: "passed" }));
    const arts = readSliceArtifacts(tempDir);
    expect(arts.length).toBe(1);
    expect(arts[0].sliceNumber).toBe(2);
  });
});

describe("Watcher: buildWatchSnapshot", () => {
  it("returns ok=false when no run dir exists", () => {
    const snap = buildWatchSnapshot(tempDir);
    expect(snap.ok).toBe(false);
    expect(snap.error).toMatch(/No run directory/);
  });

  it("builds full snapshot from events + artifacts + summary", () => {
    const runDir = resolve(tempDir, ".forge", "runs", "20250101-test");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "events.log"), [
      `[2025-01-01T00:00:00.000Z] run-started: {"plan":"P.md","sliceCount":2,"model":"claude-opus-4.7"}`,
      `[2025-01-01T00:00:01.000Z] slice-started: {"sliceNumber":1}`,
      `[2025-01-01T00:01:00.000Z] slice-completed: {"sliceNumber":1,"status":"passed"}`,
      `[2025-01-01T00:01:01.000Z] slice-started: {"sliceNumber":2}`,
      `[2025-01-01T00:02:00.000Z] slice-failed: {"sliceNumber":2}`,
    ].join("\n"));
    writeFileSync(resolve(runDir, "slice-1.json"), JSON.stringify({
      status: "passed", title: "First", duration: 60000, attempts: 1,
      tokens: { tokens_in: 1000, tokens_out: 500 },
    }));
    writeFileSync(resolve(runDir, "slice-2.json"), JSON.stringify({
      status: "failed", title: "Second", duration: 59000, attempts: 3,
      gateError: "exit 1",
    }));
    const snap = buildWatchSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    expect(snap.runId).toBe("20250101-test");
    expect(snap.plan).toBe("P.md");
    expect(snap.model).toBe("claude-opus-4.7");
    expect(snap.counts.completed).toBe(1);
    expect(snap.counts.failed).toBe(1);
    expect(snap.artifacts.length).toBe(2);
    expect(snap.artifacts[0].tokensOut).toBe(500);
    expect(snap.artifacts[1].attempts).toBe(3);
  });

  it("derives runState from completion event", () => {
    const runDir = resolve(tempDir, ".forge", "runs", "20250101-done");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "events.log"), [
      `[2025-01-01T00:00:00.000Z] run-started: {}`,
      `[2025-01-01T00:01:00.000Z] run-completed: {}`,
    ].join("\n"));
    const snap = buildWatchSnapshot(tempDir);
    expect(snap.runState).toBe("run-completed");
  });

  it("marks runState in-progress when no completion event yet", () => {
    const runDir = resolve(tempDir, ".forge", "runs", "20250101-active");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "events.log"), `[2025-01-01T00:00:00.000Z] run-started: {}`);
    const snap = buildWatchSnapshot(tempDir);
    expect(snap.runState).toBe("in-progress");
  });
});

describe("Watcher: detectWatchAnomalies", () => {
  it("returns empty for clean snapshot", () => {
    const snap = {
      ok: true,
      runState: "in-progress",
      lastEventAgeMs: 30_000,
      counts: { failed: 0 },
      artifacts: [{ sliceNumber: 1, status: "passed", duration: 30_000, tokensOut: 5000, attempts: 1 }],
    };
    expect(detectWatchAnomalies(snap)).toEqual([]);
  });

  it("flags stalled runs (no events >5min)", () => {
    const snap = {
      ok: true, runState: "in-progress", lastEventAgeMs: 10 * 60_000,
      counts: { failed: 0 }, artifacts: [],
    };
    const anomalies = detectWatchAnomalies(snap);
    expect(anomalies.find((a) => a.code === "stalled")).toBeDefined();
  });

  it("flags zero-token completed slices that ran > 1min", () => {
    const snap = {
      ok: true, runState: "in-progress", lastEventAgeMs: 1000,
      counts: { failed: 0 },
      artifacts: [{ sliceNumber: 5, status: "passed", duration: 120_000, tokensOut: 0, attempts: 1 }],
    };
    const anomalies = detectWatchAnomalies(snap);
    expect(anomalies.find((a) => a.code === "tokens-zero")).toBeDefined();
  });

  it("flags high retry attempts", () => {
    const snap = {
      ok: true, runState: "in-progress", lastEventAgeMs: 1000,
      counts: { failed: 0 },
      artifacts: [{ sliceNumber: 7, status: "passed", duration: 30_000, tokensOut: 1000, attempts: 3 }],
    };
    const anomalies = detectWatchAnomalies(snap);
    expect(anomalies.find((a) => a.code === "high-retries")).toBeDefined();
  });

  it("flags failed slice count", () => {
    const snap = {
      ok: true, runState: "in-progress", lastEventAgeMs: 1000,
      counts: { failed: 2 }, artifacts: [],
    };
    const anomalies = detectWatchAnomalies(snap);
    const failed = anomalies.find((a) => a.code === "slice-failed");
    expect(failed).toBeDefined();
    expect(failed.severity).toBe("error");
  });

  it("flags gate-on-prose regression", () => {
    const snap = {
      ok: true, runState: "in-progress", lastEventAgeMs: 1000,
      counts: { failed: 0 },
      artifacts: [{ sliceNumber: 8, status: "failed", gateError: "command '1.' not found" }],
    };
    const anomalies = detectWatchAnomalies(snap);
    expect(anomalies.find((a) => a.code === "gate-on-prose")).toBeDefined();
  });

  it("returns empty for ok=false snapshot", () => {
    expect(detectWatchAnomalies({ ok: false })).toEqual([]);
  });
});

describe("Watcher: runWatch (snapshot mode)", () => {
  it("requires targetPath", async () => {
    const result = await runWatch({});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/targetPath/);
  });

  it("returns error when targetPath does not exist", async () => {
    const result = await runWatch({ targetPath: resolve(tempDir, "nope") });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not exist/);
  });

  it("returns snapshot report without invoking AI", async () => {
    const runDir = resolve(tempDir, ".forge", "runs", "20250101-snap");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "events.log"), `[2025-01-01T00:00:00.000Z] run-started: {"plan":"X.md"}`);
    const result = await runWatch({ targetPath: tempDir, mode: "snapshot" });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("snapshot");
    expect(result.watcherModel).toBeNull();
    expect(result.runId).toBe("20250101-snap");
    expect(result.advice).toBeUndefined(); // no AI call in snapshot mode
    expect(Array.isArray(result.anomalies)).toBe(true);
  });
});