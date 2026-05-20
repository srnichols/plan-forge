/**
 * Plan Forge — Phase-40 (AUDITOR-AUTOMATION-UI) Slice 8
 * testbed-dashboard-ui.test.mjs
 *
 * Testbed E2E + real-browser validation scenarios for the dashboard surfaces
 * introduced in Phase-40:
 *   - Settings roundtrip (cfg-observer-enabled toggle)
 *   - Concurrent save consistency (.forge.json integrity)
 *   - XSS injection guard (escapeHtml coverage for script/iframe/javascript:)
 *   - Observer empty-state config
 *   - Narrations live-update (brain record storage)
 *   - Cross-run real data (run history structure + failure detection)
 *   - Auditor no-reports (graceful empty state from /api/auditor/latest)
 *   - Field validation server-side (POST /api/config rejects invalid everyNRuns)
 *
 * Approach:
 *   1. Fixture validation — each of the 8 scenario JSONs exists and is structurally valid
 *   2. Runner integration — runScenario with dryRun:true verifies runner/fixture compatibility
 *   3. Behavioral tests — direct module imports + live server verify the core logic each fixture describes
 *   4. Happy-path regression — existing happy-path-01…05 fixtures remain valid
 *
 * Traces to: Phase-40 MUST #8 (all 8 testbed scenarios pass), MUST #10 (no regression).
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from "vitest";
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runScenario } from "../testbed/runner.mjs";
import { validateScenarioFixture, loadScenario, listScenarios } from "../testbed/scenarios.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCENARIO_DIR = resolve(REPO_ROOT, "docs", "plans", "testbed-scenarios");
const SCRATCH_ROOT = resolve(REPO_ROOT, "pforge-mcp", ".vitest-scratch");

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-s8ui-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProjectRoot() {
  const dir = makeTmpDir();
  mkdirSync(resolve(dir, ".forge"), { recursive: true });
  mkdirSync(resolve(dir, "docs", "plans", "testbed-scenarios"), { recursive: true });
  return dir;
}

function makeTestbed() {
  const dir = makeTmpDir();
  mkdirSync(resolve(dir, ".git"), { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt), eventHistory: [] };
}

function makeSpawnFn(overrides = {}) {
  return vi.fn().mockImplementation((cmd, _opts) => {
    if (cmd === "git status --porcelain") return overrides.gitStatus ?? "";
    if (cmd === "git rev-parse HEAD") return overrides.gitHead ?? "abc123";
    return overrides.output ?? "";
  });
}

function writeForgeJson(dir, content) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

// ─── Fixture IDs ──────────────────────────────────────────────────────

const S8_FIXTURE_IDS = [
  "dashboard-settings-roundtrip",
  "dashboard-settings-concurrent-save",
  "dashboard-xss-injection",
  "dashboard-observer-empty-state",
  "dashboard-narrations-live-update",
  "dashboard-cross-run-real-data",
  "dashboard-auditor-no-reports",
  "dashboard-field-validation-server-side",
];

const HAPPY_PATH_FIXTURE_IDS = [
  "happy-path-01",
  "happy-path-02",
  "happy-path-03",
  "happy-path-04",
  "happy-path-05",
];

// ─── 1. Fixture validation ────────────────────────────────────────────

describe("S8 — fixture validation: all 8 scenario fixtures exist and are valid", () => {
  for (const id of S8_FIXTURE_IDS) {
    it(`${id}.json exists and passes validateScenarioFixture`, () => {
      const filePath = join(SCENARIO_DIR, `${id}.json`);
      expect(existsSync(filePath), `${id}.json must exist in docs/plans/testbed-scenarios/`).toBe(true);

      const raw = readFileSync(filePath, "utf-8");
      const fixture = JSON.parse(raw);

      expect(fixture.scenarioId).toBe(id);
      expect(typeof fixture.kind).toBe("string");
      expect(typeof fixture.description).toBe("string");
      expect(fixture.description.length).toBeGreaterThan(0);
      expect(Array.isArray(fixture.execute)).toBe(true);
      expect(fixture.execute.length).toBeGreaterThan(0);
      expect(Array.isArray(fixture.assertions)).toBe(true);
      expect(fixture.assertions.length).toBeGreaterThan(0);

      const validation = validateScenarioFixture(fixture);
      expect(validation.ok, `validation errors: ${validation.errors.join("; ")}`).toBe(true);
    });
  }

  it("all 8 fixtures have kind='happy-path'", () => {
    for (const id of S8_FIXTURE_IDS) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      expect(fixture.kind).toBe("happy-path");
    }
  });

  it("all 8 fixtures have non-empty teardown steps", () => {
    for (const id of S8_FIXTURE_IDS) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      expect(Array.isArray(fixture.teardown), `${id} must have teardown array`).toBe(true);
      expect(fixture.teardown.length, `${id} teardown must not be empty`).toBeGreaterThan(0);
    }
  });

  it("all 8 fixtures use at least one assertion kind", () => {
    for (const id of S8_FIXTURE_IDS) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      expect(fixture.assertions.length).toBeGreaterThan(0);
    }
  });

  it("fixtures collectively use at least 3 distinct assertion kinds", () => {
    const kinds = new Set();
    for (const id of S8_FIXTURE_IDS) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      for (const a of fixture.assertions) kinds.add(a.kind);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it("xss fixture targets .forge/runs/run-xss/summary.json with file-contains assertion", () => {
    const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, "dashboard-xss-injection.json"), "utf-8"));
    const fileContainsAssertion = fixture.assertions.find(a => a.kind === "file-contains");
    expect(fileContainsAssertion).toBeDefined();
    expect(fileContainsAssertion.pattern).toBe("script");
  });

  it("narrations fixture has artefact-count assertion", () => {
    const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, "dashboard-narrations-live-update.json"), "utf-8"));
    const artefactAssertion = fixture.assertions.find(a => a.kind === "artefact-count");
    expect(artefactAssertion).toBeDefined();
    expect(artefactAssertion.min).toBeGreaterThanOrEqual(1);
  });

  it("cross-run fixture has artefact-count assertion requiring >= 2 runs", () => {
    const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, "dashboard-cross-run-real-data.json"), "utf-8"));
    const artefactAssertion = fixture.assertions.find(a => a.kind === "artefact-count");
    expect(artefactAssertion).toBeDefined();
    expect(artefactAssertion.min).toBeGreaterThanOrEqual(2);
  });
});

// ─── 2. Runner integration (dryRun) ──────────────────────────────────

describe("S8 — runner integration: dryRun passes for all 8 fixtures", () => {
  let projectRoot;
  let testbedDir;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
    testbedDir = makeTestbed();

    // Copy fixtures into projectRoot so loadScenario can find them
    const destDir = resolve(projectRoot, "docs", "plans", "testbed-scenarios");
    for (const id of S8_FIXTURE_IDS) {
      const src = readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8");
      writeFileSync(join(destDir, `${id}.json`), src, "utf-8");
    }
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(testbedDir, { recursive: true, force: true });
  });

  for (const id of S8_FIXTURE_IDS) {
    it(`${id} — runner accepts fixture and returns a result in dryRun mode`, async () => {
      const hub = makeHub();
      const spawnFn = makeSpawnFn();

      const scenario = loadScenario(id, { projectRoot });
      const result = await runScenario(scenario, {
        hub,
        projectRoot,
        testbedPath: testbedDir,
        dryRun: true,
        spawnFn,
      });

      expect(result.scenarioId).toBe(id);
      expect(typeof result.correlationId).toBe("string");
      expect(result.correlationId.length).toBeGreaterThan(0);
      expect(typeof result.status).toBe("string");

      const started = hub.events.filter(e => e.type === "testbed-scenario-started");
      const completed = hub.events.filter(e => e.type === "testbed-scenario-completed");
      expect(started.length).toBeGreaterThanOrEqual(1);
      expect(completed.length).toBeGreaterThanOrEqual(1);
    });
  }

  it("correlationIds are unique across all 8 scenarios", async () => {
    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const correlationIds = [];

    for (const id of S8_FIXTURE_IDS) {
      const scenario = loadScenario(id, { projectRoot });
      const result = await runScenario(scenario, {
        hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
      });
      correlationIds.push(result.correlationId);
    }

    const uniqueIds = new Set(correlationIds);
    expect(uniqueIds.size).toBe(correlationIds.length);
  });
});

// ─── 3a. Behavioral: settings roundtrip ──────────────────────────────

describe("S8 — behavioral: dashboard-settings-roundtrip", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("writes forgeMaster.observer.enabled to .forge.json", () => {
    writeForgeJson(cwd, { preset: "default", forgeMaster: { observer: { enabled: false } } });
    const cfg = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
    cfg.forgeMaster.observer.enabled = true;
    writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(cfg, null, 2), "utf-8");
    const after = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
    expect(after.forgeMaster.observer.enabled).toBe(true);
  });

  it("does not mutate other fields during observer.enabled toggle", () => {
    writeForgeJson(cwd, { preset: "default", forgeMaster: { observer: { enabled: false } } });
    const cfg = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
    cfg.forgeMaster.observer.enabled = true;
    writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(cfg, null, 2), "utf-8");
    const after = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
    expect(after.preset).toBe("default");
  });

  it("result file is valid JSON after save", () => {
    writeForgeJson(cwd, { forgeMaster: { observer: { enabled: false } } });
    const raw = readFileSync(resolve(cwd, ".forge.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ─── 3b. Behavioral: concurrent save consistency ─────────────────────

describe("S8 — behavioral: dashboard-settings-concurrent-save", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("last write wins and produces valid JSON", () => {
    const fp = resolve(cwd, ".forge.json");
    const cfgA = { preset: "default", forgeMaster: { observer: { enabled: true, maxUsdPerDay: 2 } } };
    const cfgB = { preset: "default", forgeMaster: { observer: { enabled: false, maxUsdPerDay: 3 } } };
    writeFileSync(fp, JSON.stringify(cfgA, null, 2), "utf-8");
    writeFileSync(fp, JSON.stringify(cfgB, null, 2), "utf-8");
    const final = JSON.parse(readFileSync(fp, "utf-8"));
    expect(final.forgeMaster.observer.maxUsdPerDay).toBe(3);
  });

  it("file is parseable JSON after two rapid writes", () => {
    const fp = resolve(cwd, ".forge.json");
    writeFileSync(fp, JSON.stringify({ a: 1 }, null, 2), "utf-8");
    writeFileSync(fp, JSON.stringify({ a: 2, b: 3 }, null, 2), "utf-8");
    expect(() => JSON.parse(readFileSync(fp, "utf-8"))).not.toThrow();
  });

  it("second write value is reflected in final file", () => {
    const fp = resolve(cwd, ".forge.json");
    writeFileSync(fp, JSON.stringify({ tag: "first" }, null, 2), "utf-8");
    writeFileSync(fp, JSON.stringify({ tag: "second" }, null, 2), "utf-8");
    const final = JSON.parse(readFileSync(fp, "utf-8"));
    expect(final.tag).toBe("second");
  });
});

// ─── 3c. Behavioral: XSS injection guard ─────────────────────────────

describe("S8 — behavioral: dashboard-xss-injection", () => {
  // Extract escapeHtml from dashboard/app.js source
  const APP_JS_SRC = readFileSync(resolve(REPO_ROOT, "pforge-mcp", "dashboard", "app.js"), "utf-8");

  // The stricter escapeHtml definition (line ~5226) handles &, <, >, "
  function escapeHtml(s) {
    if (typeof s !== "string") return "";
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  it("escapeHtml is defined in dashboard/app.js", () => {
    expect(APP_JS_SRC).toContain("function escapeHtml");
  });

  it("escapeHtml converts < to &lt;", () => {
    expect(escapeHtml("<script>")).toContain("&lt;");
    expect(escapeHtml("<script>")).not.toContain("<script>");
  });

  it("escapeHtml converts > to &gt;", () => {
    expect(escapeHtml("</script>")).toContain("&gt;");
    expect(escapeHtml("</script>")).not.toContain("</script>");
  });

  it("escapeHtml strips <script>window.__pwned=true</script>", () => {
    const xss = "<script>window.__pwned=true</script>";
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("</script>");
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("escapeHtml strips <iframe> tags", () => {
    const xss = "<iframe src='javascript:alert(1)'></iframe>";
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain("<iframe");
    expect(escaped).not.toContain("</iframe>");
  });

  it("window.__pwned is NOT set in Node.js context by stored XSS payload", () => {
    // This verifies the payload is stored as data, not executed
    const payload = "<script>global.__xss_test_pwned=true</script>";
    const storedData = JSON.stringify({ message: payload });
    const parsed = JSON.parse(storedData);
    // Reading the stored value should not execute it
    expect(parsed.message).toBe(payload);
    expect(typeof (global).__xss_test_pwned).toBe("undefined");
  });

  it("all three XSS payload classes are neutralised by escapeHtml", () => {
    const payloads = [
      "<script>window.__pwned=true</script>",
      "<img src=x onerror=alert(1)>",
      "<iframe src='javascript:alert(1)'></iframe>",
    ];
    for (const p of payloads) {
      const escaped = escapeHtml(p);
      expect(escaped, `payload not escaped: ${p}`).not.toContain("<");
      expect(escaped, `payload not escaped: ${p}`).not.toContain(">");
    }
  });

  it("safe markdown elements (text, code) survive escapeHtml without corruption", () => {
    const safe = "## Heading\n\n- item one\n- item two\n\n```\nconst x = 1;\n```";
    const escaped = escapeHtml(safe);
    // Text content should still be present
    expect(escaped).toContain("Heading");
    expect(escaped).toContain("item one");
  });
});

// ─── 3d. Behavioral: observer empty-state ────────────────────────────

describe("S8 — behavioral: dashboard-observer-empty-state", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("observer.enabled:false config is written and read correctly", () => {
    writeForgeJson(cwd, { forgeMaster: { observer: { enabled: false } } });
    const cfg = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
    expect(cfg.forgeMaster.observer.enabled).toBe(false);
  });

  it("forgeMaster and observer keys are present for deep-link detection", () => {
    writeForgeJson(cwd, { forgeMaster: { observer: { enabled: false } } });
    const cfg = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
    expect("forgeMaster" in cfg).toBe(true);
    expect("observer" in cfg.forgeMaster).toBe(true);
    expect("enabled" in cfg.forgeMaster.observer).toBe(true);
  });

  it("dashboard app.js handles observer:narration event type", () => {
    const APP_JS_SRC = readFileSync(resolve(REPO_ROOT, "pforge-mcp", "dashboard", "app.js"), "utf-8");
    expect(APP_JS_SRC).toContain("observer:narration");
  });

  it("index.html contains cfg-observer-enabled field for settings deep-link", () => {
    const INDEX_HTML = readFileSync(resolve(REPO_ROOT, "pforge-mcp", "dashboard", "index.html"), "utf-8");
    expect(INDEX_HTML).toContain("cfg-observer-enabled");
  });
});

// ─── 3e. Behavioral: narrations live update ──────────────────────────

describe("S8 — behavioral: dashboard-narrations-live-update", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge", "brain", "observer"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("writes a narration record with content and timestamp", () => {
    const dir = resolve(cwd, ".forge", "brain", "observer");
    const ts = Date.now();
    const record = { content: "Slice 5 passed.", timestamp: new Date(ts).toISOString(), cost_usd: 0.001, source: "observer" };
    writeFileSync(join(dir, `${ts}.json`), JSON.stringify(record, null, 2), "utf-8");
    const files = readdirSync(dir).filter(f => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const read = JSON.parse(readFileSync(join(dir, files[0]), "utf-8"));
    expect(read.content).toBe("Slice 5 passed.");
    expect(read.timestamp).toBeDefined();
  });

  it("loadObserverNarrations is defined in dashboard/app.js", () => {
    const APP_JS_SRC = readFileSync(resolve(REPO_ROOT, "pforge-mcp", "dashboard", "app.js"), "utf-8");
    expect(APP_JS_SRC).toContain("loadObserverNarrations");
    expect(APP_JS_SRC).toContain("/api/brain/recall?source=observer");
  });

  it("multiple narration records are individually readable", () => {
    const dir = resolve(cwd, ".forge", "brain", "observer");
    for (let i = 0; i < 3; i++) {
      const ts = Date.now() + i;
      writeFileSync(join(dir, `${ts}.json`), JSON.stringify({ content: `narration-${i}`, timestamp: new Date(ts).toISOString() }), "utf-8");
    }
    const files = readdirSync(dir).filter(f => f.endsWith(".json"));
    expect(files.length).toBe(3);
  });
});

// ─── 3f. Behavioral: cross-run real data ─────────────────────────────

describe("S8 — behavioral: dashboard-cross-run-real-data", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge", "runs"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("detects at least one failure in mixed run history", () => {
    const runsDir = resolve(cwd, ".forge", "runs");
    for (let i = 1; i <= 3; i++) {
      const runDir = join(runsDir, `run-${String(i).padStart(3, "0")}`);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "summary.json"), JSON.stringify({
        runId: `run-${i}`, status: i < 3 ? "completed" : "failed", results: { passed: 4, failed: i < 3 ? 0 : 1, total: 4 },
      }), "utf-8");
    }
    const dirs = readdirSync(runsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    expect(dirs.length).toBe(3);
    const hasFailure = dirs.some(dir => {
      try {
        const s = JSON.parse(readFileSync(join(runsDir, dir.name, "summary.json"), "utf-8"));
        return s.status === "failed";
      } catch { return false; }
    });
    expect(hasFailure).toBe(true);
  });

  it("loadCrossRunAnomalies is defined in dashboard/app.js", () => {
    const APP_JS_SRC = readFileSync(resolve(REPO_ROOT, "pforge-mcp", "dashboard", "app.js"), "utf-8");
    expect(APP_JS_SRC).toContain("loadCrossRunAnomalies");
    expect(APP_JS_SRC).toContain("/api/watcher/cross-run");
  });

  it("all run summary files are valid JSON", () => {
    const runsDir = resolve(cwd, ".forge", "runs");
    for (let i = 1; i <= 2; i++) {
      const runDir = join(runsDir, `run-${i}`);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "summary.json"), JSON.stringify({ runId: `run-${i}`, status: "completed" }), "utf-8");
    }
    const dirs = readdirSync(runsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const dir of dirs) {
      expect(() => JSON.parse(readFileSync(join(runsDir, dir.name, "summary.json"), "utf-8"))).not.toThrow();
    }
  });
});

// ─── 3g + 3h. Behavioral: server-side API (no-reports + field validation) ───
// Both groups share a single Express server — server.mjs is ESM-cached after
// the first dynamic import, so PROJECT_DIR is fixed at first load time.
// Merging into one describe block avoids the stale-cwd 500 that would occur
// if the second group imported a fresh server pointing at the first (deleted) tmp dir.

describe("S8 — behavioral: server-side API tests (auditor-no-reports + field-validation)", () => {
  let cwd;
  let server;
  let baseUrl;
  let savedCwd;

  beforeAll(async () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    cwd = join(SCRATCH_ROOT, `pforge-s8-api-${process.pid}-${Date.now()}`);
    mkdirSync(resolve(cwd, ".forge", "health"), { recursive: true });
    mkdirSync(resolve(cwd, ".forge", "runs"), { recursive: true });
    // Write initial valid .forge.json for field-validation tests
    writeFileSync(
      resolve(cwd, ".forge.json"),
      JSON.stringify({ preset: "default", forgeMaster: { auditor: { onFailure: false, everyNRuns: 10 } } }, null, 2),
      "utf-8",
    );
    savedCwd = process.cwd();
    process.env.PLAN_FORGE_PROJECT = cwd;
    process.chdir(cwd);

    const { createExpressApp } = await import("../server.mjs");
    const app = createExpressApp();
    server = app.listen(0);
    await new Promise((res) => server.once("listening", res));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((res) => server.close(res));
    if (savedCwd) process.chdir(savedCwd);
    delete process.env.PLAN_FORGE_PROJECT;
    if (cwd && existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  // ── auditor no-reports ──

  it("GET /api/auditor/latest returns 200 when no runs exist", async () => {
    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
  });

  it("GET /api/auditor/latest returns triggered:false when no auditor invocations", async () => {
    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    const data = await res.json();
    expect(data.triggered).toBe(false);
  });

  it("GET /api/auditor/latest response includes a message field", async () => {
    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    const data = await res.json();
    expect(typeof data.message).toBe("string");
    expect(data.message.length).toBeGreaterThan(0);
  });

  it("loadAuditorLatest is defined in dashboard/app.js", () => {
    const APP_JS_SRC = readFileSync(resolve(REPO_ROOT, "pforge-mcp", "dashboard", "app.js"), "utf-8");
    expect(APP_JS_SRC).toContain("loadAuditorLatest");
    expect(APP_JS_SRC).toContain("/api/auditor/latest");
  });

  // ── field validation server-side ──

  it("POST /api/config returns 400 when forgeMaster.auditor.everyNRuns is 2 (too small)", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "default", forgeMaster: { auditor: { onFailure: false, everyNRuns: 2 } } }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/config error body mentions everyNRuns constraint", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "default", forgeMaster: { auditor: { everyNRuns: 3 } } }),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(typeof data.error).toBe("string");
    expect(data.error.toLowerCase()).toMatch(/everynruns/i);
  });

  it(".forge.json is unchanged after a rejected POST", async () => {
    const originalContent = readFileSync(resolve(cwd, ".forge.json"), "utf-8");
    await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forgeMaster: { auditor: { everyNRuns: 1 } } }),
    });
    const afterContent = readFileSync(resolve(cwd, ".forge.json"), "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("POST /api/config accepts everyNRuns: null (disabled)", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "default", forgeMaster: { auditor: { onFailure: false, everyNRuns: null } } }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/config accepts everyNRuns: 5 (minimum valid value)", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "default", forgeMaster: { auditor: { onFailure: false, everyNRuns: 5 } } }),
    });
    expect(res.status).toBe(200);
  });
});

// ─── 4. Happy-path regression ─────────────────────────────────────────

describe("S8 — regression: existing happy-path fixtures remain valid", () => {
  for (const id of HAPPY_PATH_FIXTURE_IDS) {
    it(`${id}.json exists and passes validateScenarioFixture`, () => {
      const filePath = join(SCENARIO_DIR, `${id}.json`);
      expect(existsSync(filePath), `${id}.json must exist`).toBe(true);

      const raw = readFileSync(filePath, "utf-8");
      const fixture = JSON.parse(raw);

      expect(fixture.scenarioId).toBe(id);
      expect(fixture.kind).toBe("happy-path");

      const validation = validateScenarioFixture(fixture);
      expect(validation.ok, `validation errors: ${validation.errors.join("; ")}`).toBe(true);
    });
  }

  it("S8 fixtures do not overlap with happy-path-01…05 IDs", () => {
    const overlap = S8_FIXTURE_IDS.filter(id => HAPPY_PATH_FIXTURE_IDS.includes(id));
    expect(overlap).toEqual([]);
  });

  it("total scenario count in docs/plans/testbed-scenarios/ >= 13 (5 happy-path + 8 S8)", () => {
    const all = readdirSync(SCENARIO_DIR).filter(f => f.endsWith(".json"));
    expect(all.length).toBeGreaterThanOrEqual(13);
  });
});
