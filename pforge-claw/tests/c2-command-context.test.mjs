import { afterEach, describe, expect, it, vi } from "vitest";
import { c2Fixture, cleanupC2Fixtures } from "./c2-fixtures.mjs";
import {
  runtimeEligibility, authorizeJobRequest, authorizeCommand, createCommandContext,
} from "../src/handlers/c2-command-context.mjs";
import task from "../src/commands/task.mjs";

afterEach(cleanupC2Fixtures);

describe("C2 current authority and configured runtime admission", () => {
  it("normalizes project > lane > default without arbitrary provider fallback", async () => {
    const f = await c2Fixture({ role: "approver", runtime: "byok:openai" });
    const lane = { ...f.config.lanes[0], runtime: "copilot-sdk" };
    expect(runtimeEligibility({ config: f.config, project: f.project, lane, caller: f.caller, secrets: f.secrets, requireKey: true }))
      .toMatchObject({ ok: true, runtimeId: "openai", role: "approver", provider: {
        type: "openai", keySecret: "FIXTURE_MODEL_KEY", endpoint: "https://example.com/v1",
      } });
    delete f.project.runtime;
    expect(runtimeEligibility({ config: f.config, project: f.project, lane, caller: f.caller, secrets: f.secrets, requireKey: true }))
      .toEqual({ ok: false, code: "RUNTIME_POLICY_DENIED" });
    lane.runtime = "byok:openai";
    expect(runtimeEligibility({ config: f.config, project: f.project, lane, caller: f.caller, secrets: f.secrets, requireKey: true }).ok).toBe(true);
    delete lane.runtime;
    f.config.runtimes.default = "byok:openai";
    expect(runtimeEligibility({ config: f.config, project: f.project, lane, caller: f.caller, secrets: f.secrets, requireKey: true }).runtimeId).toBe("openai");
  });

  it.each(["missing-provider", "missing-key-reference", "invalid-key-reference", "missing-endpoint", "invalid-endpoint", "missing-key"])(
    "refuses unusable configured BYOK: %s", async (condition) => {
      const f = await c2Fixture({ role: "approver", runtime: "openai" });
      const provider = f.config.runtimes.byok.openai;
      if (condition === "missing-provider") delete f.config.runtimes.byok.openai;
      if (condition === "missing-key-reference") delete provider.keySecret;
      if (condition === "invalid-key-reference") provider.keySecret = "raw-private-reference";
      if (condition === "missing-endpoint") delete provider.endpoint;
      if (condition === "invalid-endpoint") provider.endpoint = "private-invalid-endpoint";
      const secrets = condition === "missing-key" ? { get: () => undefined } : f.secrets;
      const verdict = runtimeEligibility({ config: f.config, project: f.project, lane: f.config.lanes[0], caller: f.caller, secrets, requireKey: true });
      expect(verdict.ok).toBe(false);
      expect(JSON.stringify(verdict)).not.toMatch(/fixture-key|private/);
    },
  );

  it("uses current allowlist authority, never stale callerRole, and validates owners too", async () => {
    const f = await c2Fixture({ runtime: "openai" });
    f.config.allowlist = [{ ...f.caller, role: "viewer" }];
    expect(runtimeEligibility({ config: f.config, project: f.project, caller: f.caller, secrets: f.secrets }))
      .toEqual({ ok: false, code: "ROLE_DENIED" });
    f.config.allowlist = [];
    expect(runtimeEligibility({ config: f.config, project: f.project, caller: f.caller, secrets: f.secrets }))
      .toEqual({ ok: false, code: "CALLER_NOT_ALLOWED" });
    f.config.allowlist = [f.caller];
    delete f.config.runtimes.byok.openai;
    expect(runtimeEligibility({ config: f.config, project: f.project, caller: f.caller, secrets: f.secrets }).ok).toBe(false);
  });

  it("validates remote references without claiming access to executing-lane credentials", async () => {
    const f = await c2Fixture({ role: "approver", runtime: "openai" });
    const secrets = { get: vi.fn(() => { throw new Error("must remain lane-local"); }) };
    const verdict = runtimeEligibility({
      config: f.config, project: f.project, lane: { id: "remote-fixture", kind: "remote" },
      caller: f.caller, secrets, requireKey: false,
    });
    expect(verdict).toMatchObject({ ok: true, runtimeId: "openai" });
    expect(secrets.get).not.toHaveBeenCalled();
    expect(verdict.provider).not.toHaveProperty("apiKey");
    delete f.config.runtimes.byok.openai;
    expect(runtimeEligibility({ config: f.config, project: f.project, caller: f.caller, requireKey: false }).ok).toBe(false);
  });

  it("reuses actual placement and current configured project rather than caller-selected runtime fields", async () => {
    const f = await c2Fixture({ role: "approver" });
    f.config.lanes[0].runtime = "byok:openai";
    const accepted = authorizeJobRequest(f.deps);
    expect(accepted).toMatchObject({ ok: true, caller: { role: "approver" }, project: f.project, constraint: "byok-only" });
    delete f.config.lanes[0].runtime;
    expect(authorizeJobRequest({ ...f.deps, project: { ...f.project, runtime: "openai" } }).ok).toBe(false);
  });

  it("shares current role/scope/availability/runtime decisions and project MCP context across dispatch paths", async () => {
    const f = await c2Fixture();
    const context = createCommandContext({
      config: f.config, registry: f.registry, services: { ...f.services, marker: "retained" },
      clients: f.clients, chatId: f.deps.chatId, threadId: f.deps.threadId,
    });
    expect(context.services).toMatchObject({ config: f.config, registry: f.registry, store: f.store, marker: "retained" });
    expect(authorizeCommand({ config: f.config, command: task, caller: f.caller, context }).ok).toBe(true);
    await context.mcp.call("forge_search", { query: "fixture" });
    expect(f.clients.call).toHaveBeenCalledWith(f.project.id, "forge_search", { query: "fixture" });
    f.config.allowlist = [{ ...f.caller, role: "viewer" }];
    expect(authorizeCommand({ config: f.config, command: task, caller: f.caller, context }))
      .toMatchObject({ ok: false, reason: "role" });
    expect(authorizeCommand({ config: f.config, command: { ...task, available: false }, caller: f.caller, context }))
      .toMatchObject({ ok: false, reason: "unavailable" });
  });
});
