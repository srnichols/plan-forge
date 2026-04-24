/**
 * Tests for the audit-loop activation surface (Phase-39 Slice 7).
 *
 * Validates:
 *   1. loadAuditConfig — defaults, file read, malformed fallback
 *   2. saveAuditConfig — persist to .forge.json, forbidProduction immutability
 *   3. shouldAutoDrain — mode off/auto/always, threshold signals, production guard
 *   4. AUDIT_DEFAULTS — frozen, mode is "off"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  AUDIT_DEFAULTS,
  loadAuditConfig,
  saveAuditConfig,
  shouldAutoDrain,
} from "../tempering/auto-activate.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `audit-activate-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeForgeJson(dir, content) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

// ─── AUDIT_DEFAULTS ──────────────────────────────────────────────────

describe("AUDIT_DEFAULTS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(AUDIT_DEFAULTS)).toBe(true);
  });

  it("defaults mode to 'off'", () => {
    expect(AUDIT_DEFAULTS.mode).toBe("off");
  });

  it("has forbidProduction = true", () => {
    expect(AUDIT_DEFAULTS.forbidProduction).toBe(true);
  });

  it("has maxRounds = 5", () => {
    expect(AUDIT_DEFAULTS.maxRounds).toBe(5);
  });

  it("has autoThresholds with expected shape", () => {
    expect(AUDIT_DEFAULTS.autoThresholds).toEqual({
      minFilesChanged: 5,
      minDaysSinceLastDrain: 3,
      requireFindings: true,
    });
  });

  it("has environments = ['dev', 'staging']", () => {
    expect(AUDIT_DEFAULTS.environments).toEqual(["dev", "staging"]);
  });
});

// ─── loadAuditConfig ─────────────────────────────────────────────────

describe("loadAuditConfig", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("returns defaults when .forge.json is absent", () => {
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe("off");
    expect(cfg._source).toBe("defaults");
    expect(cfg.forbidProduction).toBe(true);
  });

  it("returns defaults when .forge.json has no audit key", () => {
    writeForgeJson(dir, { quorum: { enabled: true } });
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe("off");
    expect(cfg._source).toBe("defaults");
  });

  it("merges audit section from .forge.json", () => {
    writeForgeJson(dir, { audit: { mode: "always", maxRounds: 10 } });
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe("always");
    expect(cfg.maxRounds).toBe(10);
    expect(cfg._source).toBe("file");
    // Non-overridden defaults still present
    expect(cfg.forbidProduction).toBe(true);
  });

  it("enforces forbidProduction even if .forge.json tries to override", () => {
    writeForgeJson(dir, { audit: { mode: "auto", forbidProduction: false } });
    const cfg = loadAuditConfig(dir);
    expect(cfg.forbidProduction).toBe(true);
  });

  it("returns defaults-fallback on malformed JSON", () => {
    writeFileSync(resolve(dir, ".forge.json"), "not-json{{{", "utf-8");
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe("off");
    expect(cfg._source).toBe("defaults-fallback");
  });
});

// ─── saveAuditConfig ─────────────────────────────────────────────────

describe("saveAuditConfig", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("creates .forge.json if absent", () => {
    const result = saveAuditConfig(dir, { mode: "auto" });
    expect(result.ok).toBe(true);
    expect(result.config.mode).toBe("auto");
    const onDisk = JSON.parse(readFileSync(resolve(dir, ".forge.json"), "utf-8"));
    expect(onDisk.audit.mode).toBe("auto");
  });

  it("preserves existing .forge.json keys", () => {
    writeForgeJson(dir, { quorum: { enabled: true }, meta: { name: "test" } });
    saveAuditConfig(dir, { mode: "always" });
    const onDisk = JSON.parse(readFileSync(resolve(dir, ".forge.json"), "utf-8"));
    expect(onDisk.quorum.enabled).toBe(true);
    expect(onDisk.meta.name).toBe("test");
    expect(onDisk.audit.mode).toBe("always");
  });

  it("enforces forbidProduction = true on save", () => {
    const result = saveAuditConfig(dir, { mode: "auto", forbidProduction: false });
    expect(result.config.forbidProduction).toBe(true);
    const onDisk = JSON.parse(readFileSync(resolve(dir, ".forge.json"), "utf-8"));
    expect(onDisk.audit.forbidProduction).toBe(true);
  });
});

// ─── shouldAutoDrain ─────────────────────────────────────────────────

describe("shouldAutoDrain", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("returns fire=false when mode is 'off'", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "off" },
    });
    expect(result.fire).toBe(false);
    expect(result.signals.mode).toBe("off");
  });

  it("returns fire=true when mode is 'always'", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "always" },
      env: "dev",
    });
    expect(result.fire).toBe(true);
    expect(result.signals.mode).toBe("always");
  });

  it("blocks 'always' mode in production", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "always" },
      env: "production",
    });
    expect(result.fire).toBe(false);
    expect(result.signals.blocked).toBe(true);
    expect(result.signals.reason).toBe("production-forbidden");
  });

  it("blocks 'auto' mode in production", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "auto" },
      env: "production",
      filesChanged: 20,
    });
    expect(result.fire).toBe(false);
    expect(result.signals.blocked).toBe(true);
  });

  it("fires in auto mode when all signals trip", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "auto" },
      env: "dev",
      filesChanged: 10,
      lastDrainTs: 0,
      lastVerdict: "max-rounds",
      recentFindingCount: 3,
      now: () => Date.now(),
    });
    expect(result.fire).toBe(true);
    expect(result.signals.mode).toBe("auto");
    expect(result.signals.decision.filesSignal).toBe(true);
    expect(result.signals.decision.findingsSignal).toBe(true);
  });

  it("does not fire in auto mode when no files changed and drain was recent", () => {
    const recentDrainTs = Date.now() - (1000 * 60 * 60); // 1 hour ago
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "auto" },
      env: "dev",
      filesChanged: 1,
      lastDrainTs: recentDrainTs,
      lastVerdict: "max-rounds",
      recentFindingCount: 3,
      now: () => Date.now(),
    });
    expect(result.fire).toBe(false);
    expect(result.signals.decision.filesSignal).toBe(false);
    expect(result.signals.decision.daysSignal).toBe(false);
  });

  it("does not fire in auto mode when last drain converged", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "auto" },
      env: "dev",
      filesChanged: 20,
      lastDrainTs: 0,
      lastVerdict: "converged",
      recentFindingCount: 5,
      now: () => Date.now(),
    });
    expect(result.fire).toBe(false);
    expect(result.signals.decision.verdictSignal).toBe(false);
  });

  it("does not fire in auto mode when requireFindings is true but no findings", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "auto" },
      env: "dev",
      filesChanged: 20,
      lastDrainTs: 0,
      lastVerdict: "max-rounds",
      recentFindingCount: 0,
      now: () => Date.now(),
    });
    expect(result.fire).toBe(false);
    expect(result.signals.decision.findingsSignal).toBe(false);
  });

  it("blocks auto mode for env not in allowed list", () => {
    const result = shouldAutoDrain({
      cwd: dir,
      config: { ...AUDIT_DEFAULTS, mode: "auto" },
      env: "custom-env",
      filesChanged: 20,
    });
    expect(result.fire).toBe(false);
    expect(result.signals.envBlocked).toBe(true);
  });

  it("reads config from .forge.json when not pre-loaded", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = shouldAutoDrain({ cwd: dir, env: "dev" });
    expect(result.fire).toBe(true);
  });

  it("returns safe result with no arguments", () => {
    // shouldAutoDrain with empty object should not throw
    const result = shouldAutoDrain({ cwd: dir });
    expect(result).toHaveProperty("fire");
    expect(result).toHaveProperty("signals");
    expect(result.fire).toBe(false);
  });
});
