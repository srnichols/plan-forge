/**
 * Plan Forge — preflight worker-backend auth gate (assertWorkerBackendReady).
 *
 * Companion to the UV_HANDLE_CLOSING crash fix: rather than dispatching N
 * doomed parallel workers when gh is unauthenticated (the reproduction for the
 * libuv abort), runPlan now refuses to start Full Auto with a clean, actionable
 * message. This suite exercises the gate's decision matrix directly.
 *
 * Verifies:
 *   (1) usable CLI worker → null (run proceeds).
 *   (2) only candidate auth-failed → WORKER_AUTH_REQUIRED w/ actionable text.
 *   (3) no CLI worker but API key serves model → null (run proceeds).
 *   (4) explicit --worker that is auth-failed → blocked even if another worker is up.
 *   (5) no worker, non-auth reason → NO_WORKER_AVAILABLE w/ concrete reason.
 *   (6) direct-API model → null (validated elsewhere, gate skips CLI check).
 */

import { describe, it, expect } from "vitest";
import { assertWorkerBackendReady } from "../orchestrator/worker-spawn.mjs";

const cli = (over = {}) => ({ name: "gh-copilot", type: "cli", available: false, failureCategory: null, reason: null, ...over });

describe("assertWorkerBackendReady — Full-Auto preflight gate", () => {
  it("(1) returns null when a CLI worker is available", () => {
    const detect = () => [cli({ available: true })];
    expect(assertWorkerBackendReady({ model: "claude-opus-4.7", detect })).toBeNull();
  });

  it("(2) blocks with actionable auth message when only candidate is auth-failed", () => {
    const detect = () => [cli({ available: false, failureCategory: "auth", reason: "gh not authenticated" })];
    const result = assertWorkerBackendReady({ model: "claude-opus-4.7", detect });
    expect(result).toMatchObject({ status: "failed", code: "WORKER_AUTH_REQUIRED", failureCategory: "auth" });
    expect(result.error).toContain("gh auth login");
    expect(result.error.toLowerCase()).toContain("no github auth");
  });

  it("(3) returns null when no CLI worker but a configured API key serves the model", () => {
    // claude-* maps to the anthropic provider; an injected resolver simulates a present key.
    const detect = () => [cli({ available: false, failureCategory: "auth" })];
    const resolveApiProvider = () => ({ label: "Anthropic", envKey: "ANTHROPIC_API_KEY" });
    expect(assertWorkerBackendReady({ model: "claude-opus-4.7", detect, resolveApiProvider })).toBeNull();
  });

  it("(4) honors an explicit --worker override and blocks when that worker is auth-failed", () => {
    const detect = () => [
      cli({ name: "gh-copilot", available: false, failureCategory: "auth" }),
      cli({ name: "claude", available: true }),
    ];
    const result = assertWorkerBackendReady({ model: null, worker: "gh-copilot", detect });
    expect(result).toMatchObject({ code: "WORKER_AUTH_REQUIRED" });
  });

  it("(5) reports a concrete reason when no worker is available for a non-auth cause", () => {
    const detect = () => [cli({ available: false, failureCategory: "missing", reason: "gh copilot not found on PATH." })];
    const result = assertWorkerBackendReady({ model: "claude-opus-4.7", detect });
    expect(result).toMatchObject({ status: "failed", code: "NO_WORKER_AVAILABLE" });
    expect(result.error).toContain("gh copilot not found on PATH.");
  });

  it("(6) skips the CLI gate for direct-API-only models", () => {
    // Grok routes through XAI direct API; spawnWorker validates the key itself.
    const detect = () => { throw new Error("detect should not be called for direct-API models"); };
    expect(assertWorkerBackendReady({ model: "grok-4.20", detect })).toBeNull();
  });

  it("(7) skips the CLI gate for the copilot-coding-agent worker even with no local CLI auth", () => {
    // copilot-coding-agent dispatches remotely (GitHub Copilot Coding Agent via
    // PRs) and spawns no local CLI worker, so the local-CLI auth gate must not
    // fire. Its auth is validated by the copilot pre-flight instead. Without this
    // skip, a CI host with no authenticated CLI worker wrongly returns
    // WORKER_AUTH_REQUIRED before the copilot pre-flight can run.
    const detect = () => [cli({ available: false, failureCategory: "auth", reason: "gh not authenticated" })];
    expect(assertWorkerBackendReady({ model: "claude-opus-4.7", worker: "copilot-coding-agent", detect })).toBeNull();
  });
});
