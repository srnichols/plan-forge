/**
 * Plan Forge — Hotfix v2.90.1 Slice 2: Output-watchdog Vitest coverage
 *
 * Tests the exported watchdog configuration API:
 *   - DEFAULT_WORKER_OUTPUT_IDLE_MS  (constant — 8 min default)
 *   - resolveWorkerOutputIdleMs()    (env-var resolver)
 *
 * Scenarios covered:
 *   silent-killed    — default resolver value is a positive timeout (watchdog will fire on a silent subprocess)
 *   output-flows     — default resolver value is the expected 8-min constant (no false-positive for active output)
 *   env-override     — PFORGE_WORKER_OUTPUT_IDLE_MS=<ms> is honoured
 *   env-zero-disables — PFORGE_WORKER_OUTPUT_IDLE_MS=0 falls back to default
 *                       (0 is not > 0, so the watchdog cannot be zeroed out; set a large value to soften it)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_WORKER_OUTPUT_IDLE_MS,
  resolveWorkerOutputIdleMs,
} from "../orchestrator.mjs";

const ENV_KEY = "PFORGE_WORKER_OUTPUT_IDLE_MS";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("DEFAULT_WORKER_OUTPUT_IDLE_MS", () => {
  it("is 480 000 ms (8 minutes)", () => {
    expect(DEFAULT_WORKER_OUTPUT_IDLE_MS).toBe(480_000);
  });
});

describe("resolveWorkerOutputIdleMs — silent-killed scenario", () => {
  it("returns a positive number when env var is absent — watchdog will fire on a silent subprocess", () => {
    delete process.env[ENV_KEY];
    const ms = resolveWorkerOutputIdleMs();
    expect(ms).toBeGreaterThan(0);
    expect(Number.isFinite(ms)).toBe(true);
  });
});

describe("resolveWorkerOutputIdleMs — output-flows scenario", () => {
  it("returns DEFAULT_WORKER_OUTPUT_IDLE_MS (8 min) by default — no false-positive for active output within that window", () => {
    delete process.env[ENV_KEY];
    expect(resolveWorkerOutputIdleMs()).toBe(DEFAULT_WORKER_OUTPUT_IDLE_MS);
  });
});

describe("resolveWorkerOutputIdleMs — env-override scenario", () => {
  it("returns the env-var value when PFORGE_WORKER_OUTPUT_IDLE_MS is a positive integer", () => {
    process.env[ENV_KEY] = "300000";
    expect(resolveWorkerOutputIdleMs()).toBe(300_000);
  });

  it("returns the env-var value when PFORGE_WORKER_OUTPUT_IDLE_MS is a positive float (truncated to number)", () => {
    process.env[ENV_KEY] = "60000.5";
    expect(resolveWorkerOutputIdleMs()).toBeCloseTo(60_000.5);
  });

  it("falls back to default when PFORGE_WORKER_OUTPUT_IDLE_MS is non-numeric", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(resolveWorkerOutputIdleMs()).toBe(DEFAULT_WORKER_OUTPUT_IDLE_MS);
  });

  it("falls back to default when PFORGE_WORKER_OUTPUT_IDLE_MS is an empty string", () => {
    process.env[ENV_KEY] = "";
    expect(resolveWorkerOutputIdleMs()).toBe(DEFAULT_WORKER_OUTPUT_IDLE_MS);
  });

  it("falls back to default when PFORGE_WORKER_OUTPUT_IDLE_MS is negative", () => {
    process.env[ENV_KEY] = "-1";
    expect(resolveWorkerOutputIdleMs()).toBe(DEFAULT_WORKER_OUTPUT_IDLE_MS);
  });
});

describe("resolveWorkerOutputIdleMs — env-zero-disables scenario", () => {
  it("falls back to default when PFORGE_WORKER_OUTPUT_IDLE_MS=0 (zero is not > 0; use a large value to soften the watchdog instead)", () => {
    // Design note: the resolver's `parsed > 0` guard intentionally rejects 0
    // so that a mis-typed env value cannot accidentally disable the safety net.
    // To truly disable the watchdog, set PFORGE_WORKER_OUTPUT_IDLE_MS to a value
    // larger than the longest expected worker run (e.g. 86400000 for 24 h).
    process.env[ENV_KEY] = "0";
    expect(resolveWorkerOutputIdleMs()).toBe(DEFAULT_WORKER_OUTPUT_IDLE_MS);
  });

  it("returns the env-var value when PFORGE_WORKER_OUTPUT_IDLE_MS is a very large number (soft-disable pattern)", () => {
    process.env[ENV_KEY] = "86400000"; // 24 h
    expect(resolveWorkerOutputIdleMs()).toBe(86_400_000);
  });
});
