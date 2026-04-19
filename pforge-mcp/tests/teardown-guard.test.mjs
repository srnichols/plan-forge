/**
 * Plan Forge — Phase HOTFIX-2.49.1 Slice H.1: Teardown Safety Guard tests.
 *
 * ~12 tests covering:
 *   - isDestructiveSliceTitle (8)
 *   - loadTeardownGuardConfig (4)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  isDestructiveSliceTitle,
  loadTeardownGuardConfig,
} from "../orchestrator.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-teardown-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── isDestructiveSliceTitle ─────────────────────────────────────────

describe("isDestructiveSliceTitle", () => {
  it("detects 'Teardown cloud resources'", () => {
    expect(isDestructiveSliceTitle("Teardown cloud resources")).toBe(true);
  });

  it("detects leading whitespace: '  cleanup scratch files'", () => {
    expect(isDestructiveSliceTitle("  cleanup scratch files")).toBe(true);
  });

  it("detects 'Rollback migration'", () => {
    expect(isDestructiveSliceTitle("Rollback migration")).toBe(true);
  });

  it("detects 'Postmortem analysis'", () => {
    expect(isDestructiveSliceTitle("Postmortem analysis")).toBe(true);
  });

  it("detects 'Finalize deployment'", () => {
    expect(isDestructiveSliceTitle("Finalize deployment")).toBe(true);
  });

  it("rejects non-destructive title: 'Build the API layer'", () => {
    expect(isDestructiveSliceTitle("Build the API layer")).toBe(false);
  });

  it("rejects mid-string keyword (prefix-anchored): 'Setup teardown integration'", () => {
    expect(isDestructiveSliceTitle("Setup teardown integration")).toBe(false);
  });

  it("returns false for non-string inputs (null, undefined, number)", () => {
    expect(isDestructiveSliceTitle(null)).toBe(false);
    expect(isDestructiveSliceTitle(undefined)).toBe(false);
    expect(isDestructiveSliceTitle(42)).toBe(false);
  });
});

// ─── loadTeardownGuardConfig ─────────────────────────────────────────

describe("loadTeardownGuardConfig", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns full defaults when .forge.json is absent", () => {
    const config = loadTeardownGuardConfig(dir);
    expect(config).toEqual({
      enabled: true,
      blockOnBranchLoss: true,
      checkRemote: true,
    });
  });

  it("overrides enabled: false while retaining other defaults", () => {
    writeFileSync(
      resolve(dir, ".forge.json"),
      JSON.stringify({ orchestrator: { teardownGuard: { enabled: false } } }),
    );
    const config = loadTeardownGuardConfig(dir);
    expect(config.enabled).toBe(false);
    expect(config.blockOnBranchLoss).toBe(true);
    expect(config.checkRemote).toBe(true);
  });

  it("returns defaults for malformed JSON (no throw)", () => {
    writeFileSync(resolve(dir, ".forge.json"), "{ not valid json!!!");
    const config = loadTeardownGuardConfig(dir);
    expect(config).toEqual({
      enabled: true,
      blockOnBranchLoss: true,
      checkRemote: true,
    });
  });

  it("selectively overrides checkRemote: false", () => {
    writeFileSync(
      resolve(dir, ".forge.json"),
      JSON.stringify({ orchestrator: { teardownGuard: { checkRemote: false } } }),
    );
    const config = loadTeardownGuardConfig(dir);
    expect(config.enabled).toBe(true);
    expect(config.blockOnBranchLoss).toBe(true);
    expect(config.checkRemote).toBe(false);
  });
});
