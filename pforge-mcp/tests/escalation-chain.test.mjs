/**
 * Auto-tuned escalation chain (no escalationChain in .forge.json).
 *
 * The chain was ranked from .forge/model-performance.json without checking
 * the models still exist: records with no model became "unknown", and retired
 * models stayed in. Phase-PRESET-BUILD-CHECKS slice 3 then retried with
 * `--model unknown`, which the Copilot CLI rejected, and the slice failed.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordModelPerformance, setGhCopilotProbe } from "../orchestrator.mjs";
import { autoTuneEscalationChain } from "../orchestrator/model-scoring.mjs";

describe("autoTuneEscalationChain", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pforge-escalation-"));
    setGhCopilotProbe(() => true);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    setGhCopilotProbe(null);
  });

  const record = (model, times, { status = "passed", cost = 0.05 } = {}) => {
    const date = new Date().toISOString();
    for (let i = 0; i < times; i++) recordModelPerformance(dir, { date, model, status, cost_usd: cost });
  };

  it("ranks only models GitHub Copilot currently serves", () => {
    record(undefined, 4, { cost: 0.001 });       // stored without a model → "unknown"
    record("claude-sonnet-4.6", 4, { cost: 0.002 }); // retired
    record("claude-opus-4.6", 4, { cost: 0.003 });   // left the catalog
    record("claude-sonnet-5.5", 4, { cost: 0.04 });
    record("claude-opus-5.5", 4, { cost: 0.08 });

    const chain = autoTuneEscalationChain(dir);
    expect(chain[0]).toBe("auto");
    expect(chain.slice(1).sort()).toEqual(["claude-opus-5.5", "claude-sonnet-5.5"]);
  });

  it("returns null when fewer than two current models qualify", () => {
    record("unknown", 6);
    record("claude-sonnet-4.6", 6);
    record("claude-sonnet-5.5", 6);

    expect(autoTuneEscalationChain(dir)).toBeNull();
  });

  it("returns null with too little history", () => {
    record("claude-sonnet-5.5", 2);
    record("claude-opus-5.5", 2);

    expect(autoTuneEscalationChain(dir)).toBeNull();
  });

  it("orders by success rate, penalising cost", () => {
    record("claude-sonnet-5.5", 4, { cost: 0.01 });
    record("claude-opus-5.5", 3, { cost: 0.01 });
    record("claude-opus-5.5", 1, { status: "failed", cost: 0.01 });

    expect(autoTuneEscalationChain(dir)).toEqual(["auto", "claude-sonnet-5.5", "claude-opus-5.5"]);
  });
});
