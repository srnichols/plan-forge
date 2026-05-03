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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadQuorumConfig, runPlan } from "../orchestrator.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "pforge-quorum-prec-"));
}

/**
 * Windows-safe rmSync: retries on EPERM (#149 Bucket follow-up).
 * The orchestrator may briefly hold open file handles in a child process
 * that hasn't fully released them when afterEach fires; on Windows this
 * surfaces as `EPERM, Permission denied` even with `force: true`. Linux
 * doesn't reproduce because of more permissive mandatory-locking semantics.
 */
function safeRmSync(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err) {
      if (err.code !== "EPERM" && err.code !== "EBUSY") throw err;
      // Brief sync sleep to give the OS a moment to release handles.
      const start = Date.now();
      while (Date.now() - start < 50) { /* spin */ }
    }
  }
  // Best effort — don't fail the test cleanup; CI will eventually GC the temp dir.
}

/** Write a minimal single-slice plan file so the zero-slice guard is not triggered. */
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

  let tmpDir;
  let errSpy;
  let savedEnv;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
    if (tmpDir) safeRmSync(tmpDir);
  });

  // ── (a) .forge.json enabled:false + quorum:"auto" → enabled=false ──────────

  it("(a) .forge.json quorum.enabled:false + quorum:auto → enabled=false, probe not called", async () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      quorum: "auto",
      manualImport: true,
      manualImportSource: "human",
      noTempering: true,
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

  it("(b) absent .forge.json + quorum:auto → enabled=true, source=default", async () => {
    // No .forge.json in tmpDir
    // Set a fake API key so the availability probe finds ≥1 model and does not throw
    process.env.OPENAI_API_KEY = "sk-fake-for-test";
    delete process.env.XAI_API_KEY;

    const planPath = writePlan(tmpDir);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      quorum: "auto",
      manualImport: true,
      noTempering: true,
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
      join(tmpDir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    process.env.OPENAI_API_KEY = "sk-fake-for-test";

    const planPath = writePlan(tmpDir);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      quorum: true,
      manualImport: true,
      noTempering: true,
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
      join(tmpDir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    process.env.OPENAI_API_KEY = "sk-fake-for-test";

    const planPath = writePlan(tmpDir);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      quorum: true,
      quorumPreset: "power",
      manualImport: true,
      noTempering: true,
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
      join(tmpDir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: true } }),
      "utf-8",
    );
    const planPath = writePlan(tmpDir);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      quorum: false,
      manualImport: true,
      noTempering: true,
    });

    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeNull();
  });

  // ── (f) source=config when .forge.json explicitly sets quorum.enabled:true ──

  it("(f) source=config when .forge.json explicitly sets quorum.enabled:true + quorum:auto", async () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: true } }),
      "utf-8",
    );
    process.env.OPENAI_API_KEY = "sk-fake-for-test";

    const planPath = writePlan(tmpDir);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      quorum: "auto",
      manualImport: true,
      noTempering: true,
    });

    expect(result.status).not.toBe("error");

    const line = findQuorumLogLine(errSpy);
    expect(line).toBeTruthy();
    expect(line).toContain("enabled=true");
    expect(line).toContain("source=config");
  });
});

// ─── loadQuorumConfig direct tests ────────────────────────────────────────────

describe("loadQuorumConfig — reads quorum.enabled from .forge.json", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (tmpDir) safeRmSync(tmpDir);
  });

  it("returns enabled:false when .forge.json has quorum.enabled:false", () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: false } }),
      "utf-8",
    );
    const cfg = loadQuorumConfig(tmpDir);
    expect(cfg.enabled).toBe(false);
  });

  it("returns enabled:true when .forge.json has quorum.enabled:true", () => {
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ quorum: { enabled: true } }),
      "utf-8",
    );
    const cfg = loadQuorumConfig(tmpDir);
    expect(cfg.enabled).toBe(true);
  });

  it("returns enabled:false (defaults) when .forge.json has no quorum.enabled key", () => {
    writeFileSync(join(tmpDir, ".forge.json"), JSON.stringify({}), "utf-8");
    const cfg = loadQuorumConfig(tmpDir);
    // Default is false — runPlan will upgrade this to true for the "auto" legacy-default case
    expect(cfg.enabled).toBe(false);
  });

  it("returns enabled:false (defaults) when .forge.json is absent", () => {
    const cfg = loadQuorumConfig(tmpDir);
    expect(cfg.enabled).toBe(false);
  });
});

