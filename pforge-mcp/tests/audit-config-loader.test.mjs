/**
 * Tests for audit config loader edge cases (Phase-39 Slice 7).
 *
 * Validates:
 *   - Config merge semantics (shallow merge, default fill)
 *   - forbidProduction immutability at load and save boundaries
 *   - Round-trip: save → load → same values
 *   - Non-string mode values fallback safely
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  AUDIT_DEFAULTS,
  loadAuditConfig,
  saveAuditConfig,
} from "../tempering/auto-activate.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `audit-config-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeForgeJson(dir, content) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

// ─── Config merge semantics ──────────────────────────────────────────

describe("audit config merge semantics", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("shallow-merges: overridden keys win, others default", () => {
    writeForgeJson(dir, { audit: { mode: "auto" } });
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe("auto");
    expect(cfg.maxRounds).toBe(AUDIT_DEFAULTS.maxRounds);
    expect(cfg.environments).toEqual(AUDIT_DEFAULTS.environments);
  });

  it("accepts maxRounds override", () => {
    writeForgeJson(dir, { audit: { mode: "auto", maxRounds: 3 } });
    const cfg = loadAuditConfig(dir);
    expect(cfg.maxRounds).toBe(3);
  });

  it("non-string mode treated as whatever it is — callers validate", () => {
    writeForgeJson(dir, { audit: { mode: 42 } });
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe(42);
  });
});

// ─── forbidProduction immutability ───────────────────────────────────

describe("forbidProduction immutability", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("load always returns forbidProduction=true even if file says false", () => {
    writeForgeJson(dir, { audit: { forbidProduction: false } });
    expect(loadAuditConfig(dir).forbidProduction).toBe(true);
  });

  it("save always writes forbidProduction=true even if patch says false", () => {
    saveAuditConfig(dir, { forbidProduction: false });
    const onDisk = JSON.parse(readFileSync(resolve(dir, ".forge.json"), "utf-8"));
    expect(onDisk.audit.forbidProduction).toBe(true);
  });

  it("round-trip preserves forbidProduction", () => {
    saveAuditConfig(dir, { mode: "auto" });
    const cfg = loadAuditConfig(dir);
    expect(cfg.forbidProduction).toBe(true);
    expect(cfg.mode).toBe("auto");
  });
});

// ─── Round-trip save → load ──────────────────────────────────────────

describe("audit config round-trip", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("save then load returns same values", () => {
    saveAuditConfig(dir, { mode: "always", maxRounds: 7 });
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe("always");
    expect(cfg.maxRounds).toBe(7);
    expect(cfg._source).toBe("file");
  });

  it("save merges with previous audit config", () => {
    saveAuditConfig(dir, { mode: "auto" });
    saveAuditConfig(dir, { maxRounds: 2 });
    const cfg = loadAuditConfig(dir);
    expect(cfg.mode).toBe("auto");
    expect(cfg.maxRounds).toBe(2);
  });
});
