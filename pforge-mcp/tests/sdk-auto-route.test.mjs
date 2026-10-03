/**
 * spawnWorker → Copilot SDK route for "auto" slices (auto tiers) and for
 * resumed sessions (retry preamble, pinned session).
 *
 * The SDK is reached through `await import("./sdk-worker.mjs")`, mocked here,
 * so no Copilot runtime starts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runSdkSession = vi.fn();
vi.mock("../orchestrator/sdk-worker.mjs", () => ({
  runSdkSession: (...args) => runSdkSession(...args),
}));

const { spawnWorker, RESUMED_SESSION_PREAMBLE } = await import("../orchestrator/worker-spawn.mjs");

const SDK_RESULT = { output: "done", stderr: "", exitCode: 0, timedOut: false, tokens: {}, worker: "sdk", model: "gpt-6-luna" };

describe("spawnWorker — SDK route for auto tiers and resumed sessions", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pf-sdk-auto-"));
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ routing: { copilotSdk: "prefer" } }));
    runSdkSession.mockReset();
    runSdkSession.mockResolvedValue(SDK_RESULT);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs an auto slice on the SDK as model auto with the slice's tier", async () => {
    const result = await spawnWorker("do it", { model: null, autoTier: "efficiency", cwd: dir });
    expect(result).toBe(SDK_RESULT);
    expect(runSdkSession).toHaveBeenCalledWith(expect.objectContaining({ model: "auto", autoTier: "efficiency" }));
  });

  it("passes a COPILOT_SERVABLE model through unchanged", async () => {
    await spawnWorker("do it", { model: "gpt-6-luna", cwd: dir });
    expect(runSdkSession).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna" }));
  });

  it("pins the session and prefixes the retry preamble when resuming", async () => {
    const session = { id: "0cb916db-26aa-40f2-86b5-1ba81b225fd2", resume: true };
    await spawnWorker("fix the gate", { model: "gpt-6-luna", cwd: dir, session });
    const call = runSdkSession.mock.calls[0][0];
    expect(call.session).toEqual(session);
    expect(call.prompt).toBe(RESUMED_SESSION_PREAMBLE + "fix the gate");
  });

  it("sends the prompt unchanged on a first attempt", async () => {
    await spawnWorker("first try", { model: "gpt-6-luna", cwd: dir, session: { id: "x", resume: false } });
    expect(runSdkSession.mock.calls[0][0].prompt).toBe("first try");
  });
});
