/**
 * Plan Forge — Phase TEMPER-01 Slice 01.1: foundation tests.
 *
 * Covers:
 *   - Default config shape + enterprise-defaults contract
 *   - ensureTemperingDirs + readTemperingConfig (idempotent, never overwrites)
 *   - Stack detection across the 6 supported stacks
 *   - Coverage-report location
 *   - Parsers: lcov, istanbul, cobertura, jacoco, go cover, coverage.py, tarpaulin
 *   - Layer classification + rollup + gap computation
 *   - handleScan happy path + no-coverage path + unknown-stack path
 *   - handleStatus shape
 *   - readTemperingState contract (returns null when uninitialized)
 *   - correlationId threading
 *   - Hub event emission + L3 capture wiring points (metadata + source pinning)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  TEMPERING_DEFAULT_CONFIG,
  TEMPERING_SCAN_STALE_DAYS,
  ensureTemperingDirs,
  readTemperingConfig,
  detectStack,
  locateCoverageReport,
  parseLcov,
  parseIstanbulJson,
  parseCobertura,
  parseJacoco,
  parseGoCover,
  parseCoveragePyJson,
  parseTarpaulin,
  parseCoverage,
  classifyLayer,
  rollupByLayer,
  computeGaps,
  listScanRecords,
  readScanRecord,
  readTemperingState,
  handleScan,
  handleStatus,
} from "../tempering.mjs";
import { TOOL_METADATA } from "../capabilities.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
const toolsJson = JSON.parse(readFileSync(resolve(__dirname, "..", "tools.json"), "utf-8"));

function makeTempProject() {
  const dir = resolve(tmpdir(), `temper-foundation-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }

// ─── Default config + constants ──────────────────────────────────────

describe("TEMPERING_DEFAULT_CONFIG — enterprise defaults", () => {
  it("coverage minima match the arc doc: domain=90, integration=80, controller=60, overall=80", () => {
    expect(TEMPERING_DEFAULT_CONFIG.coverageMinima).toEqual({
      domain: 90, integration: 80, controller: 60, overall: 80,
    });
  });

  it("all 11 scanners are enabled by default (enterprise posture)", () => {
    const scanners = TEMPERING_DEFAULT_CONFIG.scanners;
    expect(Object.values(scanners).every((v) => v === true)).toBe(true);
    expect(Object.keys(scanners).length).toBe(11);
  });

  it("visual analyzer is quorum-mode 2-of-3 by default", () => {
    expect(TEMPERING_DEFAULT_CONFIG.visualAnalyzer.mode).toBe("quorum");
    expect(TEMPERING_DEFAULT_CONFIG.visualAnalyzer.models.length).toBe(3);
    expect(TEMPERING_DEFAULT_CONFIG.visualAnalyzer.agreement).toBe(2);
  });

  it("bug registry defaults to github integration with jsonl fallback always on", () => {
    expect(TEMPERING_DEFAULT_CONFIG.bugRegistry.integration).toBe("github");
    expect(TEMPERING_DEFAULT_CONFIG.bugRegistry.fallback).toBe("jsonl");
  });

  it("config is frozen — mutation attempts don't leak into fresh reads", () => {
    expect(Object.isFrozen(TEMPERING_DEFAULT_CONFIG)).toBe(true);
  });

  it("runtimeBudgets includes keys for all 9 scanners (TEMPER-05 Slice 05.2)", () => {
    const budgets = TEMPERING_DEFAULT_CONFIG.runtimeBudgets;
    expect(budgets.unitMaxMs).toBe(120000);
    expect(budgets.integrationMaxMs).toBe(300000);
    expect(budgets.uiMaxMs).toBe(600000);
    expect(budgets.visualDiffMaxMs).toBe(300000);
    expect(budgets.flakinessMaxMs).toBe(60000);
    expect(budgets.perfBudgetMaxMs).toBe(120000);
    expect(budgets.loadStressMaxMs).toBe(300000);
    expect(budgets.mutationMaxMs).toBe(600000);
  });

  it("TEMPERING_SCAN_STALE_DAYS is 7 (matches CRUCIBLE_STALL_CUTOFF_DAYS contract)", () => {
    expect(TEMPERING_SCAN_STALE_DAYS).toBe(7);
  });
});

// ─── ensureTemperingDirs + readTemperingConfig ───────────────────────

describe("ensureTemperingDirs + readTemperingConfig", () => {
  let dir;
  beforeEach(() => { dir = makeTempProject(); });
  afterEach(() => cleanup(dir));

  it("creates .forge/tempering/ on first call and seeds config.json", () => {
    const out = ensureTemperingDirs(dir);
    expect(existsSync(resolve(dir, ".forge", "tempering"))).toBe(true);
    expect(existsSync(out.configPath)).toBe(true);
    expect(out.configWritten).toBe(true);
  });

  it("is idempotent — second call does NOT overwrite config", () => {
    ensureTemperingDirs(dir);
    const configPath = resolve(dir, ".forge", "tempering", "config.json");
    writeFileSync(configPath, JSON.stringify({ coverageMinima: { domain: 50 } }), "utf-8");
    const out2 = ensureTemperingDirs(dir);
    expect(out2.configWritten).toBe(false);
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(cfg.coverageMinima.domain).toBe(50); // preserved
  });

  it("readTemperingConfig returns defaults when config absent (_source=defaults)", () => {
    const cfg = readTemperingConfig(dir);
    expect(cfg._source).toBe("defaults");
    expect(cfg.coverageMinima.domain).toBe(90);
  });

  it("readTemperingConfig shallow-merges user overrides with defaults", () => {
    ensureTemperingDirs(dir);
    const configPath = resolve(dir, ".forge", "tempering", "config.json");
    writeFileSync(configPath, JSON.stringify({ coverageMinima: { domain: 50 } }), "utf-8");
    const cfg = readTemperingConfig(dir);
    expect(cfg._source).toBe("file");
    expect(cfg.coverageMinima.domain).toBe(50);
  });

  it("readTemperingConfig never throws on malformed JSON — returns defaults-fallback", () => {
    mkdirSync(resolve(dir, ".forge", "tempering"), { recursive: true });
    writeFileSync(resolve(dir, ".forge", "tempering", "config.json"), "{ broken", "utf-8");
    const cfg = readTemperingConfig(dir);
    expect(cfg._source).toBe("defaults-fallback");
    expect(cfg.coverageMinima.domain).toBe(90);
  });
});

// ─── Stack detection ─────────────────────────────────────────────────

describe("detectStack", () => {
  let dir;
  beforeEach(() => { dir = makeTempProject(); });
  afterEach(() => cleanup(dir));

  it("detects typescript from package.json", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    expect(detectStack(dir)).toBe("typescript");
  });

  it("detects dotnet from a .csproj file (even if package.json present)", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    writeFileSync(resolve(dir, "app.csproj"), "<Project/>", "utf-8");
    expect(detectStack(dir)).toBe("dotnet");
  });

  it("detects python from pyproject.toml", () => {
    writeFileSync(resolve(dir, "pyproject.toml"), "[tool.poetry]", "utf-8");
    expect(detectStack(dir)).toBe("python");
  });

  it("detects go from go.mod", () => {
    writeFileSync(resolve(dir, "go.mod"), "module example.com/x", "utf-8");
    expect(detectStack(dir)).toBe("go");
  });

  it("detects rust from Cargo.toml", () => {
    writeFileSync(resolve(dir, "Cargo.toml"), "[package]", "utf-8");
    expect(detectStack(dir)).toBe("rust");
  });

  it("detects java from pom.xml", () => {
    writeFileSync(resolve(dir, "pom.xml"), "<project/>", "utf-8");
    expect(detectStack(dir)).toBe("java");
  });

  it("returns 'unknown' when no marker file found", () => {
    expect(detectStack(dir)).toBe("unknown");
  });
});

// ─── Coverage report location ────────────────────────────────────────

describe("locateCoverageReport", () => {
  let dir;
  beforeEach(() => { dir = makeTempProject(); });
  afterEach(() => cleanup(dir));

  it("finds coverage/lcov.info for typescript", () => {
    mkdirSync(resolve(dir, "coverage"), { recursive: true });
    writeFileSync(resolve(dir, "coverage", "lcov.info"), "SF:x\nend_of_record\n", "utf-8");
    const report = locateCoverageReport(dir, "typescript");
    expect(report).not.toBeNull();
    expect(report.format).toBe("lcov");
  });

  it("prefers lcov over coverage-final.json (priority order)", () => {
    mkdirSync(resolve(dir, "coverage"), { recursive: true });
    writeFileSync(resolve(dir, "coverage", "lcov.info"), "SF:x\nend_of_record\n", "utf-8");
    writeFileSync(resolve(dir, "coverage", "coverage-final.json"), "{}", "utf-8");
    const report = locateCoverageReport(dir, "typescript");
    expect(report.name).toBe("lcov");
  });

  it("returns null when no report exists for stack", () => {
    expect(locateCoverageReport(dir, "typescript")).toBeNull();
  });

  it("does not cross stacks (e.g. go cover.out for typescript)", () => {
    writeFileSync(resolve(dir, "cover.out"), "mode: set\n", "utf-8");
    expect(locateCoverageReport(dir, "typescript")).toBeNull();
    expect(locateCoverageReport(dir, "go")).not.toBeNull();
  });
});

// ─── Coverage parsers ────────────────────────────────────────────────

describe("parseLcov", () => {
  it("parses a two-record lcov.info", () => {
    const content = [
      "SF:src/a.js",
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:src/b.js",
      "LF:20",
      "LH:5",
      "end_of_record",
    ].join("\n");
    const records = parseLcov(content);
    expect(records).toEqual([
      { file: "src/a.js", linesTotal: 10, linesHit: 8 },
      { file: "src/b.js", linesTotal: 20, linesHit: 5 },
    ]);
  });

  it("handles empty and malformed content safely", () => {
    expect(parseLcov("")).toEqual([]);
    expect(parseLcov(null)).toEqual([]);
    expect(parseLcov("garbage\nmore garbage")).toEqual([]);
  });
});

describe("parseIstanbulJson", () => {
  it("counts statements as lines total/hit", () => {
    const json = JSON.stringify({
      "src/a.js": { s: { 0: 1, 1: 0, 2: 5 } },
      "src/b.js": { s: { 0: 0, 1: 0 } },
    });
    const records = parseIstanbulJson(json);
    expect(records).toContainEqual({ file: "src/a.js", linesTotal: 3, linesHit: 2 });
    expect(records).toContainEqual({ file: "src/b.js", linesTotal: 2, linesHit: 0 });
  });

  it("returns [] on malformed JSON", () => {
    expect(parseIstanbulJson("{ broken")).toEqual([]);
  });
});

describe("parseCobertura", () => {
  it("extracts lines-valid / lines-covered when present", () => {
    const xml = '<coverage><class filename="Foo.cs" line-rate="0.8" lines-valid="50" lines-covered="40"></class></coverage>';
    const records = parseCobertura(xml);
    expect(records).toEqual([{ file: "Foo.cs", linesTotal: 50, linesHit: 40 }]);
  });

  it("falls back to line-rate when counts missing", () => {
    const xml = '<coverage><class filename="Bar.cs" line-rate="0.75"></class></coverage>';
    const records = parseCobertura(xml);
    expect(records).toEqual([{ file: "Bar.cs", linesTotal: 100, linesHit: 75 }]);
  });
});

describe("parseJacoco", () => {
  it("extracts per-class line counters", () => {
    const xml = '<report><class name="com/foo/Bar" sourcefilename="Bar.java"><counter type="LINE" missed="5" covered="15"/></class></report>';
    const records = parseJacoco(xml);
    expect(records).toEqual([{ file: "Bar.java", linesTotal: 20, linesHit: 15 }]);
  });
});

describe("parseGoCover", () => {
  it("sums statements per file weighted by hit/non-hit", () => {
    const content = [
      "mode: set",
      "foo.go:1.1,5.2 3 1",
      "foo.go:6.1,10.2 2 0",
      "bar.go:1.1,20.2 10 1",
    ].join("\n");
    const records = parseGoCover(content);
    expect(records).toContainEqual({ file: "foo.go", linesTotal: 5, linesHit: 3 });
    expect(records).toContainEqual({ file: "bar.go", linesTotal: 10, linesHit: 10 });
  });
});

describe("parseCoveragePyJson", () => {
  it("extracts num_statements / covered_lines per file", () => {
    const json = JSON.stringify({
      files: {
        "src/a.py": { summary: { num_statements: 30, covered_lines: 25 } },
      },
    });
    const records = parseCoveragePyJson(json);
    expect(records).toEqual([{ file: "src/a.py", linesTotal: 30, linesHit: 25 }]);
  });
});

describe("parseTarpaulin", () => {
  it("extracts coverable / covered per file", () => {
    const json = JSON.stringify({
      files: [{ path: ["src", "lib.rs"], coverable: 40, covered: 30 }],
    });
    const records = parseTarpaulin(json);
    expect(records).toEqual([{ file: "src/lib.rs", linesTotal: 40, linesHit: 30 }]);
  });
});

describe("parseCoverage dispatch", () => {
  it("dispatches to the right parser by format id", () => {
    expect(parseCoverage("lcov", "SF:x\nLF:1\nLH:1\nend_of_record\n"))
      .toEqual([{ file: "x", linesTotal: 1, linesHit: 1 }]);
    expect(parseCoverage("unknown-format", "anything")).toEqual([]);
  });
});

// ─── Layer classification + rollup + gaps ────────────────────────────

describe("classifyLayer", () => {
  it("classifies controller paths", () => {
    expect(classifyLayer("src/controllers/user.ts")).toBe("controller");
    expect(classifyLayer("src/routes/api.ts")).toBe("controller");
    expect(classifyLayer("src/api/handler.ts")).toBe("controller");
  });

  it("classifies integration (data-access) paths", () => {
    expect(classifyLayer("src/repositories/user.ts")).toBe("integration");
    expect(classifyLayer("src/db/client.ts")).toBe("integration");
    expect(classifyLayer("src/persistence/store.ts")).toBe("integration");
  });

  it("classifies domain (business-logic) paths", () => {
    expect(classifyLayer("src/services/auth.ts")).toBe("domain");
    expect(classifyLayer("src/domain/order.ts")).toBe("domain");
    expect(classifyLayer("src/models/user.ts")).toBe("domain");
  });

  it("classifies everything else as overall", () => {
    expect(classifyLayer("src/utils/format.ts")).toBe("overall");
    expect(classifyLayer("index.ts")).toBe("overall");
  });

  it("is case-insensitive and handles Windows path separators", () => {
    expect(classifyLayer("SRC\\Controllers\\User.ts")).toBe("controller");
  });
});

describe("rollupByLayer", () => {
  it("aggregates per-file into per-layer totals + percents", () => {
    const records = [
      { file: "src/services/a.ts", linesTotal: 100, linesHit: 90 }, // domain
      { file: "src/controllers/b.ts", linesTotal: 50, linesHit: 30 }, // controller
      { file: "src/repositories/c.ts", linesTotal: 20, linesHit: 20 }, // integration
    ];
    const rollup = rollupByLayer(records);
    expect(rollup.domain.percent).toBe(90);
    expect(rollup.controller.percent).toBe(60);
    expect(rollup.integration.percent).toBe(100);
    // overall includes all three (no double-counting from layered files)
    expect(rollup.overall.total).toBe(170);
    expect(rollup.overall.hit).toBe(140);
  });

  it("handles zero-total layers without divide-by-zero", () => {
    const rollup = rollupByLayer([]);
    expect(rollup.domain.percent).toBe(0);
    expect(rollup.overall.percent).toBe(0);
  });
});

describe("computeGaps", () => {
  it("returns only layers below minimum, sorted files worst-first", () => {
    const records = [
      { file: "src/services/a.ts", linesTotal: 100, linesHit: 70 },
      { file: "src/services/b.ts", linesTotal: 100, linesHit: 50 },
    ];
    const rollup = rollupByLayer(records);
    const gaps = computeGaps(rollup, { domain: 90, integration: 80, controller: 60, overall: 80 }, records);
    const domainGap = gaps.find((g) => g.layer === "domain");
    expect(domainGap).toBeDefined();
    expect(domainGap.actual).toBe(60);
    expect(domainGap.gap).toBe(30);
    expect(domainGap.files[0].file).toBe("src/services/b.ts"); // worst first
  });

  it("returns empty when every layer meets minimum", () => {
    const records = [{ file: "src/services/a.ts", linesTotal: 100, linesHit: 95 }];
    const rollup = rollupByLayer(records);
    const gaps = computeGaps(rollup, { domain: 90 }, records);
    expect(gaps).toEqual([]);
  });
});

// ─── readTemperingState + scan record IO ─────────────────────────────

describe("readTemperingState", () => {
  let dir;
  beforeEach(() => { dir = makeTempProject(); });
  afterEach(() => cleanup(dir));

  it("returns null when .forge/tempering/ does not exist", () => {
    expect(readTemperingState(dir)).toBeNull();
  });

  it("returns an initialized state after ensureTemperingDirs", () => {
    ensureTemperingDirs(dir);
    const state = readTemperingState(dir);
    expect(state).not.toBeNull();
    expect(state.initialized).toBe(true);
    expect(state.totalScans).toBe(0);
    expect(state.stale).toBe(false); // no scans yet, not stale
  });

  it("surfaces latest scan freshness + gap counts", () => {
    ensureTemperingDirs(dir);
    const scanPath = resolve(dir, ".forge", "tempering", "scan-2026-04-19T00-00-00-000Z.json");
    writeFileSync(scanPath, JSON.stringify({
      scanId: "scan-x",
      completedAt: new Date().toISOString(),
      status: "amber",
      coverageVsMinima: [
        { layer: "domain", minimum: 90, actual: 80, gap: 10 },
        { layer: "controller", minimum: 60, actual: 58, gap: 2 }, // below 5-point filter
      ],
    }), "utf-8");
    const state = readTemperingState(dir);
    expect(state.totalScans).toBe(1);
    expect(state.latestStatus).toBe("amber");
    expect(state.gaps).toBe(2);
    expect(state.belowMinimum).toBe(1); // only the 10-point gap qualifies
  });

  it("flags stale=true when latest scan is older than TEMPERING_SCAN_STALE_DAYS", () => {
    ensureTemperingDirs(dir);
    const scanPath = resolve(dir, ".forge", "tempering", "scan-old.json");
    writeFileSync(scanPath, JSON.stringify({ scanId: "x", coverageVsMinima: [] }), "utf-8");
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(scanPath, past, past);
    const state = readTemperingState(dir);
    expect(state.stale).toBe(true);
  });
});

// ─── handleScan end-to-end ───────────────────────────────────────────

describe("handleScan", () => {
  let dir;
  const events = [];
  const hub = { broadcast: (e) => events.push(e) };
  beforeEach(() => { dir = makeTempProject(); events.length = 0; });
  afterEach(() => cleanup(dir));

  it("happy path — typescript project with lcov.info produces a green scan record", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    mkdirSync(resolve(dir, "coverage"), { recursive: true });
    writeFileSync(resolve(dir, "coverage", "lcov.info"),
      "SF:src/services/a.ts\nLF:100\nLH:95\nend_of_record\n", "utf-8");
    const result = handleScan({ projectDir: dir, hub });
    expect(result.ok).toBe(true);
    expect(result.stack).toBe("typescript");
    expect(result.status).toBe("green");
    expect(result.coverageVsMinima).toEqual([]);
    expect(existsSync(result.scanRecordPath)).toBe(true);
    expect(events.map((e) => e.type)).toContain("tempering-scan-started");
    expect(events.map((e) => e.type)).toContain("tempering-scan-completed");
  });

  it("amber — coverage gap on domain layer (>= 5 points)", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    mkdirSync(resolve(dir, "coverage"), { recursive: true });
    writeFileSync(resolve(dir, "coverage", "lcov.info"),
      "SF:src/services/weak.ts\nLF:100\nLH:70\nend_of_record\n", "utf-8");
    const result = handleScan({ projectDir: dir, hub });
    expect(result.status).toBe("amber");
    expect(result.coverageVsMinima.length).toBeGreaterThan(0);
    const domain = result.coverageVsMinima.find((g) => g.layer === "domain");
    expect(domain).toBeDefined();
    expect(domain.gap).toBeGreaterThanOrEqual(5);
  });

  it("no-data — unknown stack returns status=no-data with a helpful reason", () => {
    const result = handleScan({ projectDir: dir, hub });
    expect(result.status).toBe("no-data");
    expect(result.reason).toMatch(/detect project stack/);
  });

  it("no-data — known stack with no coverage report returns status=no-data with generator hint", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    const result = handleScan({ projectDir: dir, hub });
    expect(result.status).toBe("no-data");
    expect(result.reason).toMatch(/--coverage/);
  });

  it("threads correlationId through scan record + events", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    const corr = "corr-test-12345";
    const result = handleScan({ projectDir: dir, hub, correlationId: corr });
    expect(result.correlationId).toBe(corr);
    const rec = JSON.parse(readFileSync(result.scanRecordPath, "utf-8"));
    expect(rec.correlationId).toBe(corr);
    const startedEv = events.find((e) => e.type === "tempering-scan-started");
    expect(startedEv.data.correlationId).toBe(corr);
  });

  it("mints a correlationId when none supplied (temper-scan-<uuid>)", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    const result = handleScan({ projectDir: dir, hub });
    expect(result.correlationId).toMatch(/^temper-scan-[0-9a-f-]+$/);
  });

  it("seeds config.json on first run, preserves it on second run", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    const r1 = handleScan({ projectDir: dir, hub });
    expect(r1.configWritten).toBe(true);
    const r2 = handleScan({ projectDir: dir, hub });
    expect(r2.configWritten).toBe(false);
  });
});

// ─── handleStatus ────────────────────────────────────────────────────

describe("handleStatus", () => {
  let dir;
  beforeEach(() => { dir = makeTempProject(); });
  afterEach(() => cleanup(dir));

  it("returns ok+initialized=false on an uninitialized project", () => {
    const r = handleStatus({ projectDir: dir });
    expect(r.ok).toBe(true);
    expect(r.initialized).toBe(false);
    expect(r.state).toBeNull();
    expect(r.scans).toEqual([]);
  });

  it("returns scan summaries newest-first with coverage percents", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    mkdirSync(resolve(dir, "coverage"), { recursive: true });
    writeFileSync(resolve(dir, "coverage", "lcov.info"),
      "SF:src/services/a.ts\nLF:100\nLH:95\nend_of_record\n", "utf-8");
    handleScan({ projectDir: dir });
    const r = handleStatus({ projectDir: dir, limit: 5 });
    expect(r.initialized).toBe(true);
    expect(r.scans.length).toBe(1);
    expect(r.scans[0].coverage.domain).toBeGreaterThan(0);
  });

  it("clamps limit to [1, 100]", () => {
    writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
    const r1 = handleStatus({ projectDir: dir, limit: 0 });
    expect(r1.ok).toBe(true);
    const r2 = handleStatus({ projectDir: dir, limit: 9999 });
    expect(r2.ok).toBe(true);
  });
});

// ─── Schema + wiring contract ────────────────────────────────────────

describe("forge_tempering_scan + forge_tempering_status schema + wiring", () => {
  it("tools.json exposes both tools with addedIn 2.42.0", () => {
    const scanTool = toolsJson.find((t) => t.name === "forge_tempering_scan");
    const statusTool = toolsJson.find((t) => t.name === "forge_tempering_status");
    expect(scanTool).toBeDefined();
    expect(statusTool).toBeDefined();
    expect(TOOL_METADATA.forge_tempering_scan.addedIn).toBe("2.42.0");
    expect(TOOL_METADATA.forge_tempering_status.addedIn).toBe("2.42.0");
  });

  it("TOOL_METADATA declares the expected consumes paths", () => {
    const consumes = TOOL_METADATA.forge_tempering_scan.consumes;
    expect(consumes).toContain("coverage/lcov.info");
    expect(consumes).toContain("coverage/cobertura.xml");
    expect(consumes).toContain("coverage.out");
  });

  it("TOOL_METADATA declares hub event side-effects", () => {
    const side = TOOL_METADATA.forge_tempering_scan.sideEffects.join(" ");
    expect(side).toContain("tempering-scan-started");
    expect(side).toContain("tempering-scan-completed");
  });

  it("server.mjs imports the Tempering handlers", () => {
    expect(serverSrc).toMatch(/temperingHandleScan[^}]*from\s+"\.\/tempering\.mjs"|import\s*\{[^}]*handleScan as temperingHandleScan/);
  });

  it("server.mjs wires L3 capture via captureMemory on scan completion", () => {
    // Pinning: tag payload must include stack/status for cross-project recall
    expect(serverSrc).toMatch(/captureMemory\([^)]*forge_tempering_scan/);
  });

  it("server.mjs wires emitToolTelemetry on both tools", () => {
    expect(serverSrc).toMatch(/emitToolTelemetry\(\s*"forge_tempering_scan"/);
    expect(serverSrc).toMatch(/emitToolTelemetry\(\s*"forge_tempering_status"/);
  });
});
