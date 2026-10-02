/**
 * #307 — routing.copilotSdk defaults to "prefer".
 *
 * Copilot-servable models (gpt-*, Copilot Grok) run through @github/copilot-sdk
 * unless a project opts out with `routing.copilotSdk: "off"`. Measured on the
 * same tasks and model, the SDK path cost 33–36% less than spawning the Copilot
 * CLI (scripts/benchmark/sdk-parity.mjs).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCopilotSdkPreference } from "../orchestrator/worker-spawn.mjs";
import { runSdkSession } from "../orchestrator/sdk-worker.mjs";
import { CONFIG_SCHEMA } from "../capabilities/schemas.mjs";

const dirs = [];
const project = (config) => {
  const dir = mkdtempSync(join(tmpdir(), "pf-sdk-default-"));
  dirs.push(dir);
  if (config !== undefined) writeFileSync(join(dir, ".forge.json"), typeof config === "string" ? config : JSON.stringify(config));
  return dir;
};
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  delete process.env.PF_TEST_BYOK_KEY;
});

describe("routing.copilotSdk default", () => {
  it("is \"prefer\" with no .forge.json, no routing block, or an unknown value", () => {
    expect(loadCopilotSdkPreference(project())).toBe("prefer");
    expect(loadCopilotSdkPreference(project({ projectName: "x" }))).toBe("prefer");
    expect(loadCopilotSdkPreference(project({ routing: { copilotSdk: "sometimes" } }))).toBe("prefer");
    expect(loadCopilotSdkPreference(project("{ not json"))).toBe("prefer");
  });

  it("honours the opt-out", () => {
    expect(loadCopilotSdkPreference(project({ routing: { copilotSdk: "off" } }))).toBe("off");
  });

  it("the .forge.json schema documents the same default", () => {
    expect(CONFIG_SCHEMA.properties.routing.properties.copilotSdk.default).toBe("prefer");
  });
});

describe("BYOK through the SDK", () => {
  it("is declined by the real session factory so the direct API path is used", async () => {
    // A BYOK session would need a provider baseUrl; image and Foundry models keep
    // their direct API route. sdkError makes spawnWorker fall back to it.
    process.env.PF_TEST_BYOK_KEY = "test-key";
    const err = await runSdkSession({ prompt: "p", model: "gpt-image-2", cwd: project(), provider: { type: "openai", envKey: "PF_TEST_BYOK_KEY" } })
      .then(() => null, (e) => e);
    expect(err?.sdkError).toBe(true);
    expect(err.message).toMatch(/BYOK/);
  });
});
