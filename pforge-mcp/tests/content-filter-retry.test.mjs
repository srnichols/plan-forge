/**
 * A worker whose response the model provider blocked (content filtering) did
 * no work, but the attempt used to run the gate anyway, so the slice failed
 * with "validation gate failed: hello.txt missing" — pointing at the code
 * rather than at the blocked response (observed live, claude-opus-5.5,
 * 2026-10-03, 16.9 AI credits spent).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectContentFilterBlock } from "../orchestrator/worker-spawn.mjs";
import { createWorkerSession } from "../orchestrator/worker-session.mjs";

const BLOCKED_CLI = {
  worker: "gh-copilot",
  model: "claude-opus-5.5",
  exitCode: 0,
  output: "● Read pforge-prompt.txt\n  └ 32 lines read\nThe model returned no content because the response was blocked by content filtering.\n",
  stderr: "Changes    +0 -0\n",
};

describe("detectContentFilterBlock", () => {
  it("recognises the Copilot CLI's blocked-response message", () => {
    const reason = detectContentFilterBlock(BLOCKED_CLI, "auto");
    expect(reason).toMatch(/content filtering/);
    expect(reason).toMatch(/claude-opus-5\.5/);
    expect(reason).toMatch(/gate was skipped/i);
  });

  it("recognises an Azure OpenAI content management policy refusal in stderr", () => {
    const reason = detectContentFilterBlock({
      worker: "sdk", model: "gpt-6-luna", exitCode: 1, output: "",
      stderr: "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.",
    }, "auto");
    expect(reason).toBeTruthy();
  });

  it("recognises a content_filter finish reason", () => {
    expect(detectContentFilterBlock({ worker: "sdk", exitCode: 1, output: "", stderr: '{"finish_reason":"content_filter"}' }, "auto")).toBeTruthy();
  });

  it("ignores a long, real transcript that merely mentions content filtering", () => {
    const output = "Implemented the content filtering middleware. ".repeat(80)
      + "The model returned no content because the response was blocked by content filtering.";
    expect(detectContentFilterBlock({ worker: "gh-copilot", exitCode: 0, output, stderr: "" }, "auto")).toBeNull();
  });

  it("ignores ordinary output", () => {
    expect(detectContentFilterBlock({ worker: "gh-copilot", exitCode: 0, output: "Created hello.txt", stderr: "" }, "auto")).toBeNull();
  });

  it("is off in assisted mode and for a missing result", () => {
    expect(detectContentFilterBlock(BLOCKED_CLI, "assisted")).toBeNull();
    expect(detectContentFilterBlock(null, "auto")).toBeNull();
  });
});

describe("worker session reset after a blocked response", () => {
  it("starts the next attempt in a fresh session", () => {
    const sessions = createWorkerSession({ enabled: true });
    const { id } = sessions.forAttempt(0);
    sessions.record({ sessionId: id });
    sessions.reset();
    const next = sessions.forAttempt(1);
    expect(next.resume).toBe(false);
    expect(next.id).not.toBe(id);
  });
});

describe("Guard: a content-filtered attempt skips the gate and retries", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf-8");
  const loop = src.slice(src.indexOf("async function _executeSliceAttemptLoop"), src.indexOf("async function executeSlice("));

  it("detects the block before running the gate", () => {
    expect(loop).toMatch(/const contentFilter = launchFailure \? null : detectContentFilterBlock\(/);
    expect(loop).toMatch(/_gateUnlessFiltered\(\{ contentFilter,/);
    const helper = src.slice(src.indexOf("function _gateUnlessFiltered"), src.indexOf("function _recordContentFilterForRetry"));
    expect(helper).toMatch(/contentFilter\s*\?\s*\{[^}]*skipped: true/);
  });

  it("retries before the non-zero-exit break, in a fresh session", () => {
    const retryIdx = loop.indexOf("if (contentFilter)");
    const breakIdx = loop.indexOf("if (workerResult.exitCode !== 0) break;");
    expect(retryIdx).toBeGreaterThan(-1);
    expect(retryIdx).toBeLessThan(breakIdx);
    expect(loop.slice(retryIdx, retryIdx + 400)).toMatch(/workerSessions\.reset\(\)/);
  });

  it("reports content-filtered ahead of the gate branch", () => {
    const statusFn = src.slice(src.indexOf("function _executeSliceDetermineStatus"));
    const filterIdx = statusFn.indexOf("gateResult.contentFilter");
    expect(filterIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeLessThan(statusFn.indexOf("!gateResult.success"));
    expect(statusFn).toMatch(/content-filtered: /);
  });
});
