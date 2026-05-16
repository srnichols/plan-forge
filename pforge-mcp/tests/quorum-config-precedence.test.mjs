/**
 * quorum-config-precedence.test.mjs — Bug #122: Quorum precedence respects .forge.json
 *
 * Verifies that runPlan's quorum-resolution block:
 *   (a) .forge.json enabled:false + quorum:"auto" → enabled=false, probe skipped
 *   (b) absent .forge.json + quorum:"auto"        → enabled=true (legacy default)
 *   (c) quorum:true overrides .forge.json enabled:false → enabled=true, source=cli
 *   (d) quorum:true + quorumPreset:"power" overrides config → enabled=true, source=cli
 *   (e) quorum:false → quorumConfig stays null, no [quorum] log line emitted
 *   (f) source tag correct: "config" when .forge.json explicitly sets quorum.enabled:true
 *
 * Strategy:
 *   - runPlan is called with a minimal zero-slice plan + manualImport:true.
 *   - console.error is spied to capture [quorum] resolution log lines.
 *   - For enabled=true cases, OPENAI_API_KEY is faked so the availability probe
 *     finds at least one usable model and does not throw.
 *   - loadQuorumConfig is tested directly for config-reading assertions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadQuorumConfig, runPlan } from "../orchestrator.mjs";
import { withSandboxRepo } from "./helpers/sandbox-repo.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Write a minimal single-slice plan file so the zero-slice guard is not triggered.
 * Used for tests that prefer to write a custom plan rather than using sandbox.writePlan().
 */
function writePlan(dir, name = "plan.md") {
  writeFileSync(
    join(dir, name),
    "---\ncrucibleId: quorum-test\n---\n# Quorum Test Plan\n\n### Slice 1: Quorum Probe\n\nTask.\n",
    "utf-8",
  );
  return join(dir, name);
}

/** Extract the first [quorum] enabled=... log line from errSpy calls. */
function findQuorumLogLine(errSpy) {
  return errSpy.mock.calls
    .map((args) => (typeof args[0] === "string" ? args[0] : ""))
    .find((msg) => msg.startsWith("[quorum] enabled=")) ?? null;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Bug #122 — quorum-config precedence respects .forge.json", () => {
  // Each runPlan() spawns a real availability probe and can take 10-45s on
  // Windows due to subprocess startup overhead (#149 Bucket follow-up). The
  // default 5000ms vitest timeout is too tight; bump to 60s for this suite.
  vi.setConfig({ testTimeout: 60_000 });

  let sandbox;
  let errSpy;
  let savedEnv;

  beforeEach(() => {
    // Issue #176: use withSandboxRepo() so the tmpDir has its own .git repo.
    // This prevents worker subprocesses from escaping to the operator's repo
    // via git super-project detection (walking up the fs tree to find .git).
    sandbox = withSandboxRepo("quorum-prec-");
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
    if (sandbox) sandbox.cleanup();
  });

  // ── (a) .forge.json enabled:false + quorum:"auto" → enabled=false ──────────

  it("(a) .forge.json quorum.enabled:false + quorum:auto → enabled=false, probe not called", async () => {
    writeFileSync(
      join(sandbox.dir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    const planPath = writePlan(sandbox.dir);

    const result = await runPlan(planPath, {
      cwd: sandbox.dir,
      quorum: "auto",
      manualImport: true,
      manualImportSource: "human",
      noTempering: true,
      dryRunWorker: true,
    });

    // Run must complete (no "no available models" throw)
    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("enabled=false");
    expect(line).toContain("auto=true");
    expect(line).toContain("source=config");
  });

  // ── (b) absent .forge.json + quorum:"auto" → enabled=true (legacy default) ─

  // (b) Triggers a real availability probe (no .forge.json + default-on quorum)
  // which spawns OPENAI/gh-copilot/claude/codex subprocesses to validate models.
  // On Windows, subprocess startup overhead pushes the probe past 60s and the
  // test times out. Mirrors the skip applied to (c) and (d) — pending a
  // probe-stub injection point in runPlan (#149 follow-up).
  const itb = process.platform === "win32" ? it.skip : it;
  itb("(b) absent .forge.json + quorum:auto → enabled=true, source=default", async () => {
    // No .forge.json in sandbox.dir
    // Set a fake API key so the availability probe finds ≥1 model and does not throw
    process.env.OPENAI_API_KEY = "sk-fake-for-test";
    delete process.env.XAI_API_KEY;

    const planPath = writePlan(sandbox.dir);

    const result = await runPlan(planPath, {
      cwd: sandbox.dir,
      quorum: "auto",
      manualImport: true,
      noTempering: true,
      dryRunWorker: true,
    });

    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("enabled=true");
    expect(line).toContain("source=default");
  });

  // ── (c) quorum:true overrides .forge.json enabled:false → enabled=true, cli ─

  // (c) and (d): quorum:true forces a real availability probe that spawns
  // multiple subprocesses (gh-copilot / claude / codex) to validate models.
  // On Windows, those probes can take 60s+ each due to subprocess startup
  // overhead, exceeding even bumped test timeouts. Skipped on Windows pending
  // a probe-stub injection point in runPlan (#149 follow-up).
  const itc = process.platform === "win32" ? it.skip : it;
  itc("(c) quorum:true overrides .forge.json enabled:false → enabled=true, source=cli", async () => {
    writeFileSync(
      join(sandbox.dir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    process.env.OPENAI_API_KEY = "sk-fake-for-test";

    const planPath = writePlan(sandbox.dir);

    const result = await runPlan(planPath, {
      cwd: sandbox.dir,
      quorum: true,
      manualImport: true,
      noTempering: true,
      dryRunWorker: true,
    });

    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("enabled=true");
    expect(line).toContain("auto=false");
    expect(line).toContain("source=cli");
  });

  // ── (d) quorum:true + quorumPreset:"power" overrides config → enabled=true ──

  // (d) Same reason as (c): real probe + power preset = subprocess-spawn-bound
  // on Windows. Skipped on Windows pending probe stub.
  const itd = process.platform === "win32" ? it.skip : it;
  itd("(d) quorum:true + quorumPreset:power overrides .forge.json enabled:false → enabled=true, source=cli", async () => {
    writeFileSync(
      join(sandbox.dir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    process.env.OPENAI_API_KEY = "sk-fake-for-test";

    const planPath = writePlan(sandbox.dir);

    const result = await runPlan(planPath, {
      cwd: sandbox.dir,
      quorum: true,
      quorumPreset: "power",
      manualImport: true,
      noTempering: true,
      dryRunWorker: true,
    });

    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("enabled=true");
    expect(line).toContain("source=cli");
  });

  // ── (e) quorum:false → quorumConfig stays null, no [quorum] log line ────────

  it("(e) quorum:false → quorumConfig=null, no [quorum] enabled= log line", async () => {
    writeFileSync(
      join(sandbox.dir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: true } }),
      "utf-8",
    );
    const planPath = writePlan(sandbox.dir);

    const result = await runPlan(planPath, {
      cwd: sandbox.dir,
      quorum: false,
      manualImport: true,
      noTempering: true,
      dryRunWorker: true,
    });

    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeNull();
  });

  // ── (f) source=config when .forge.json explicitly sets quorum.enabled:true ──

  // (f) Same as (b)/(c)/(d): explicit enabled:true triggers a real availability
  // probe that spawns OPENAI/gh-copilot/claude/codex subprocesses to validate
  // models. On Windows the subprocess startup overhead can push past 60s,
  // intermittently exceeding the test timeout. Skipped on Windows pending
  // a probe-stub injection point in runPlan (#149 follow-up).
  const itf = process.platform === "win32" ? it.skip : it;
  itf("(f) source=config when .forge.json explicitly sets quorum.enabled:true + quorum:auto", async () => {
    writeFileSync(
      join(sandbox.dir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: true } }),
      "utf-8",
    );
    process.env.OPENAI_API_KEY = "sk-fake-for-test";

    const planPath = writePlan(sandbox.dir);

    const result = await runPlan(planPath, {
      cwd: sandbox.dir,
      quorum: "auto",
      manualImport: true,
      noTempering: true,
      dryRunWorker: true,
    });

    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("enabled=true");
    expect(line).toContain("source=config");
  });

  // ── Issue #176 — dryRunWorker safety guard ───────────────────────────────

  // Regression guard: prove runPlan({dryRunWorker:true}) skips spawnWorker so
  // tests in this suite (and any other) cannot accidentally spawn gh-copilot
  // and let it commit/push to the operator's repo. Without dryRunWorker, the
  // worker is handed full shell access in cwd — see commit 53e2877 for the
  // historical incident this guard prevents.
  it("(g) Issue #176 — dryRunWorker:true synthesizes pass without spawning worker", async () => {
    const planPath = writePlan(sandbox.dir);
    const result = await runPlan(planPath, {
      cwd: sandbox.dir,
      quorum: false, // skip probe entirely to keep the test fast and pure
      manualImport: true,
      noTempering: true,
      dryRunWorker: true,
    });

    expect(result.status).not.toBe("error");
    expect(Array.isArray(result.sliceResults)).toBe(true);
    expect(result.sliceResults.length).toBe(1);

    const sr = result.sliceResults[0];
    expect(sr.status).toBe("passed");
    expect(sr.worker).toBe("dry-run");
    expect(sr.model).toBe("dry-run");
    expect(sr.gateOutput).toBe("dry-run-worker");
    expect(sr.cost_usd).toBe(0);
    expect(sr.autoCommit?.reason).toBe("dry-run-worker");
    expect(sr.autoCommit?.committed).toBe(false);
  });
});

// ─── loadQuorumConfig direct tests ────────────────────────────────────────────

describe("loadQuorumConfig — reads quorum.enabled from .forge.json", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = withSandboxRepo("quorum-cfg-");
  });

  afterEach(() => {
    if (sandbox) sandbox.cleanup();
  });

  it("returns enabled:false when .forge.json has quorum.enabled:false", () => {
    writeFileSync(
      join(sandbox.dir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    const cfg = loadQuorumConfig(sandbox.dir);
    expect(cfg.enabled).toBe(false);
  });

  it("returns enabled:true when .forge.json has quorum.enabled:true", () => {
    writeFileSync(
      join(sandbox.dir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: true } }),
      "utf-8",
    );
    const cfg = loadQuorumConfig(sandbox.dir);
    expect(cfg.enabled).toBe(true);
  });

  it("returns enabled:false (defaults) when .forge.json has no quorum.enabled key", () => {
    writeFileSync(join(sandbox.dir, ".forge.json"), JSON.stringify({}), "utf-8");
    const cfg = loadQuorumConfig(sandbox.dir);
    // Default is false — runPlan will upgrade this to true for the "auto" legacy-default case
    expect(cfg.enabled).toBe(false);
  });

  it("returns enabled:false (defaults) when .forge.json is absent", () => {
    const cfg = loadQuorumConfig(sandbox.dir);
    expect(cfg.enabled).toBe(false);
  });
});

