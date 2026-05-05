/**
 * Plan Forge — Hotfix v2.90.2 Slice 3: Worker timeout resolver Vitest coverage
 *
 * Tests the exported worker timeout configuration API:
 *   - DEFAULT_WORKER_TIMEOUT_MS  (constant — 30 min default)
 *   - resolveWorkerTimeoutMs()   (priority resolver: per-slice → env → default)
 *
 * Scenarios covered:
 *   default-30min        — no env var, no per-slice override → DEFAULT_WORKER_TIMEOUT_MS
 *   env-override         — PFORGE_WORKER_TIMEOUT_MS=<ms> is honoured when no per-slice override
 *   per-slice-override   — opts.sliceOverride wins over env and default
 *   slice-overrides-env  — per-slice beats a set env var
 *   uplift-guard         — new default is at least 1.5× the old 1_200_000 ms default
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_WORKER_TIMEOUT_MS,
  resolveWorkerTimeoutMs,
} from "../orchestrator.mjs";

const ENV_KEY = "PFORGE_WORKER_TIMEOUT_MS";

afterEach(() => {
  delete process.env[ENV_KEY];
});

// ─── default-30min ────────────────────────────────────────────────────────────

describe("DEFAULT_WORKER_TIMEOUT_MS", () => {
  it("is 1 800 000 ms (30 minutes)", () => {
    expect(DEFAULT_WORKER_TIMEOUT_MS).toBe(1_800_000);
  });
});

describe("resolveWorkerTimeoutMs — default-30min scenario", () => {
  it("returns DEFAULT_WORKER_TIMEOUT_MS when no env var and no per-slice override", () => {
    delete process.env[ENV_KEY];
    expect(resolveWorkerTimeoutMs()).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("returns a positive finite number when called with no arguments", () => {
    delete process.env[ENV_KEY];
    const ms = resolveWorkerTimeoutMs();
    expect(ms).toBeGreaterThan(0);
    expect(Number.isFinite(ms)).toBe(true);
  });
});

// ─── env-override ─────────────────────────────────────────────────────────────

describe("resolveWorkerTimeoutMs — env-override scenario", () => {
  it("returns the env-var value when PFORGE_WORKER_TIMEOUT_MS is a positive integer", () => {
    process.env[ENV_KEY] = "2700000";
    expect(resolveWorkerTimeoutMs()).toBe(2_700_000);
  });

  it("returns the env-var value when PFORGE_WORKER_TIMEOUT_MS is a positive float", () => {
    process.env[ENV_KEY] = "1800000.5";
    expect(resolveWorkerTimeoutMs()).toBeCloseTo(1_800_000.5);
  });

  it("falls back to default when PFORGE_WORKER_TIMEOUT_MS is non-numeric", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(resolveWorkerTimeoutMs()).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("falls back to default when PFORGE_WORKER_TIMEOUT_MS is an empty string", () => {
    process.env[ENV_KEY] = "";
    expect(resolveWorkerTimeoutMs()).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("falls back to default when PFORGE_WORKER_TIMEOUT_MS is zero", () => {
    process.env[ENV_KEY] = "0";
    expect(resolveWorkerTimeoutMs()).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("falls back to default when PFORGE_WORKER_TIMEOUT_MS is negative", () => {
    process.env[ENV_KEY] = "-1";
    expect(resolveWorkerTimeoutMs()).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });
});

// ─── per-slice-override ───────────────────────────────────────────────────────

describe("resolveWorkerTimeoutMs — per-slice-override scenario", () => {
  it("returns the per-slice override when sliceOverride is a positive number and no env var is set", () => {
    delete process.env[ENV_KEY];
    expect(resolveWorkerTimeoutMs({ sliceOverride: 3_600_000 })).toBe(3_600_000);
  });

  it("ignores a zero sliceOverride and falls back to default", () => {
    delete process.env[ENV_KEY];
    expect(resolveWorkerTimeoutMs({ sliceOverride: 0 })).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("ignores a negative sliceOverride and falls back to default", () => {
    delete process.env[ENV_KEY];
    expect(resolveWorkerTimeoutMs({ sliceOverride: -5000 })).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("ignores a null sliceOverride and falls back to default", () => {
    delete process.env[ENV_KEY];
    expect(resolveWorkerTimeoutMs({ sliceOverride: null })).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it("ignores an undefined sliceOverride and falls back to default", () => {
    delete process.env[ENV_KEY];
    expect(resolveWorkerTimeoutMs({ sliceOverride: undefined })).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });
});

// ─── slice-overrides-env ──────────────────────────────────────────────────────

describe("resolveWorkerTimeoutMs — slice-overrides-env scenario", () => {
  it("per-slice override wins over a set env var", () => {
    process.env[ENV_KEY] = "2700000";
    expect(resolveWorkerTimeoutMs({ sliceOverride: 3_600_000 })).toBe(3_600_000);
  });

  it("per-slice override wins even when env var is a larger value", () => {
    process.env[ENV_KEY] = "7200000";
    expect(resolveWorkerTimeoutMs({ sliceOverride: 600_000 })).toBe(600_000);
  });
});

// ─── uplift-guard (SHOULD) ────────────────────────────────────────────────────

describe("DEFAULT_WORKER_TIMEOUT_MS — uplift guard", () => {
  const OLD_DEFAULT_WORKER_TIMEOUT_MS = 1_200_000;

  it("new default is at least 1.5× the old 1_200_000 ms default so the uplift survives accidental regression", () => {
    expect(DEFAULT_WORKER_TIMEOUT_MS).toBeGreaterThanOrEqual(OLD_DEFAULT_WORKER_TIMEOUT_MS * 1.5);
  });
});
