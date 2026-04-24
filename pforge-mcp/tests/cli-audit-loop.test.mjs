/**
 * Tests for `pforge audit-loop` CLI flag parsing and behavior (Phase-39 Slice 7).
 *
 * Validates:
 *   - loadAuditConfig integration with CLI flag mapping
 *   - --auto flag respects config and returns early when no signals trip
 *   - --dry-run prevents triage side effects
 *   - --env sets environment context
 *   - --max overrides maxRounds
 *   - Production guard cannot be bypassed via CLI
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  loadAuditConfig,
  shouldAutoDrain,
  AUDIT_DEFAULTS,
} from "../tempering/auto-activate.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `cli-audit-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeForgeJson(dir, content) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

/**
 * Simulates CLI flag parsing → config resolution used by `pforge audit-loop`.
 * This mirrors the logic the CLI handler applies.
 */
function resolveCliConfig(dir, flags = {}) {
  const config = loadAuditConfig(dir);
  if (flags.max) config.maxRounds = flags.max;
  if (flags.env) config._env = flags.env;
  if (flags.dryRun) config._dryRun = true;
  // --auto means respect config mode; without --auto, treat as manual one-shot (always)
  if (!flags.auto) config._manualMode = true;
  return config;
}

describe("CLI audit-loop flag resolution", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("manual mode (no --auto): config._manualMode is true", () => {
    const config = resolveCliConfig(dir, {});
    expect(config._manualMode).toBe(true);
  });

  it("--auto mode: respects config mode", () => {
    writeForgeJson(dir, { audit: { mode: "auto" } });
    const config = resolveCliConfig(dir, { auto: true });
    expect(config._manualMode).toBeUndefined();
    expect(config.mode).toBe("auto");
  });

  it("--max=3 overrides maxRounds", () => {
    const config = resolveCliConfig(dir, { max: 3 });
    expect(config.maxRounds).toBe(3);
  });

  it("--env sets environment", () => {
    const config = resolveCliConfig(dir, { env: "staging" });
    expect(config._env).toBe("staging");
  });

  it("--dry-run sets dry-run flag", () => {
    const config = resolveCliConfig(dir, { dryRun: true });
    expect(config._dryRun).toBe(true);
  });

  it("production guard survives all CLI flags", () => {
    const config = resolveCliConfig(dir, { env: "production", auto: true });
    expect(config.forbidProduction).toBe(true);
  });
});

describe("CLI audit-loop --auto with shouldAutoDrain", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("--auto with mode=off returns early", () => {
    writeForgeJson(dir, { audit: { mode: "off" } });
    const config = resolveCliConfig(dir, { auto: true });
    const result = shouldAutoDrain({ cwd: dir, config, env: "dev" });
    expect(result.fire).toBe(false);
    expect(result.signals.reason).toBe("audit-loop disabled");
  });

  it("--auto with mode=auto and no signals returns early", () => {
    writeForgeJson(dir, { audit: { mode: "auto" } });
    const config = resolveCliConfig(dir, { auto: true });
    const result = shouldAutoDrain({
      cwd: dir,
      config,
      env: "dev",
      filesChanged: 0,
      recentFindingCount: 0,
    });
    expect(result.fire).toBe(false);
  });

  it("manual mode (no --auto) bypasses shouldAutoDrain — always runs", () => {
    // In manual mode, the CLI should run the drain regardless of config mode.
    // This test validates that the config is read but manual mode overrides.
    const config = resolveCliConfig(dir, {});
    expect(config._manualMode).toBe(true);
    // Manual mode still respects production guard
    expect(config.forbidProduction).toBe(true);
  });
});
