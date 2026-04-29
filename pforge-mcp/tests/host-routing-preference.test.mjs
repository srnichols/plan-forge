/**
 * Meta-bug #104 regression tests — host-aware routing preference.
 *
 * Verifies:
 *   1. getRoutingPreference(host, userPref) picks the right transport order.
 *   2. .forge.json `routing.hostPreference` is honored by loadRoutingPreference.
 *   3. probeQuorumModelAvailability(model, {hostPreference, host}) routes
 *      gpt-* through direct-api FIRST under claude-code/cursor when "auto",
 *      and DROPS gpt-* under "drop" when no direct API key is set.
 *   4. filterQuorumModels emits a host + per-model summary table.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getRoutingPreference,
  loadRoutingPreference,
  probeQuorumModelAvailability,
  filterQuorumModels,
  formatQuorumSummary,
  setGhCopilotProbe,
} from "../orchestrator.mjs";

describe("#104: getRoutingPreference", () => {
  it('"auto" + claude-code → direct-api FIRST, gh-copilot fallback', () => {
    const r = getRoutingPreference("claude-code", "auto");
    expect(r.order).toEqual(["direct-api", "gh-copilot"]);
    expect(r.dropIfNoDirectApi).toBe(false);
  });

  it('"auto" + cursor → direct-api FIRST, gh-copilot fallback', () => {
    const r = getRoutingPreference("cursor", "auto");
    expect(r.order).toEqual(["direct-api", "gh-copilot"]);
  });

  it('"auto" + windsurf → direct-api FIRST', () => {
    expect(getRoutingPreference("windsurf", "auto").order).toEqual(["direct-api", "gh-copilot"]);
  });

  it('"auto" + zed → direct-api FIRST', () => {
    expect(getRoutingPreference("zed", "auto").order).toEqual(["direct-api", "gh-copilot"]);
  });

  it('"auto" + vs-code-copilot → gh-copilot FIRST', () => {
    expect(getRoutingPreference("vs-code-copilot", "auto").order).toEqual(["gh-copilot", "direct-api"]);
  });

  it('"auto" + cli-terminal → gh-copilot FIRST', () => {
    expect(getRoutingPreference("cli-terminal", "auto").order).toEqual(["gh-copilot", "direct-api"]);
  });

  it('"gh-copilot" override → gh-copilot FIRST regardless of host', () => {
    expect(getRoutingPreference("claude-code", "gh-copilot").order).toEqual(["gh-copilot", "direct-api"]);
    expect(getRoutingPreference("cursor", "gh-copilot").order).toEqual(["gh-copilot", "direct-api"]);
  });

  it('"direct-api" override → direct-api FIRST regardless of host', () => {
    expect(getRoutingPreference("vs-code-copilot", "direct-api").order).toEqual(["direct-api", "gh-copilot"]);
  });

  it('"drop" + claude-code → direct-api ONLY, drop flag true', () => {
    const r = getRoutingPreference("claude-code", "drop");
    expect(r.order).toEqual(["direct-api"]);
    expect(r.dropIfNoDirectApi).toBe(true);
  });

  it('"drop" + vs-code-copilot → behaves like auto (no drop)', () => {
    const r = getRoutingPreference("vs-code-copilot", "drop");
    expect(r.order).toEqual(["gh-copilot", "direct-api"]);
    expect(r.dropIfNoDirectApi).toBe(false);
  });

  it("invalid pref falls back to auto", () => {
    expect(getRoutingPreference("claude-code", "bogus").order).toEqual(["direct-api", "gh-copilot"]);
  });
});

describe("#104: loadRoutingPreference", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "pforge-104-")); });
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } });

  it("returns 'auto' when .forge.json missing", () => {
    expect(loadRoutingPreference(tmpDir)).toBe("auto");
  });

  it("returns 'auto' when .forge.json has no routing.hostPreference", () => {
    writeFileSync(join(tmpDir, ".forge.json"), JSON.stringify({ quorum: { enabled: true } }));
    expect(loadRoutingPreference(tmpDir)).toBe("auto");
  });

  it("returns user setting when valid", () => {
    writeFileSync(join(tmpDir, ".forge.json"), JSON.stringify({ routing: { hostPreference: "drop" } }));
    expect(loadRoutingPreference(tmpDir)).toBe("drop");
  });

  it("rejects invalid values, returns 'auto'", () => {
    writeFileSync(join(tmpDir, ".forge.json"), JSON.stringify({ routing: { hostPreference: "bogus" } }));
    expect(loadRoutingPreference(tmpDir)).toBe("auto");
  });

  it("returns 'auto' on malformed JSON", () => {
    writeFileSync(join(tmpDir, ".forge.json"), "{not-json");
    expect(loadRoutingPreference(tmpDir)).toBe("auto");
  });
});

describe("#104: probeQuorumModelAvailability honors hostPreference", () => {
  let savedKey;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    setGhCopilotProbe(() => true);
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    setGhCopilotProbe(null);
    delete process.env.CLAUDECODE;
  });

  it("under host=claude-code + auto + OPENAI_API_KEY set → routes via direct-api FIRST", () => {
    process.env.OPENAI_API_KEY = "sk-fake";
    const r = probeQuorumModelAvailability("gpt-5.3-codex", { host: "claude-code", hostPreference: "auto" });
    expect(r.available).toBe(true);
    expect(r.via).toBe("api");
    expect(r.host).toBe("claude-code");
    expect(r.fallback).toBeUndefined();
    expect(r.routingPreference).toBe("auto");
  });

  it("under host=claude-code + auto + no OPENAI_API_KEY → falls back to gh-copilot with warning", () => {
    const r = probeQuorumModelAvailability("gpt-5.3-codex", { host: "claude-code", hostPreference: "auto" });
    expect(r.available).toBe(true);
    expect(r.via).toBe("cli");
    expect(r.worker).toBe("gh-copilot");
    expect(r.billingWarning).toMatch(/Claude Code/);
  });

  it("under host=vs-code-copilot + auto → gh-copilot FIRST (no warning)", () => {
    const r = probeQuorumModelAvailability("gpt-5.3-codex", { host: "vs-code-copilot", hostPreference: "auto" });
    expect(r.available).toBe(true);
    expect(r.via).toBe("cli");
    expect(r.worker).toBe("gh-copilot");
    expect(r.billingWarning).toBeNull();
  });

  it('under host=claude-code + "gh-copilot" override → routes via gh-copilot even with API key set', () => {
    process.env.OPENAI_API_KEY = "sk-fake";
    const r = probeQuorumModelAvailability("gpt-5.3-codex", { host: "claude-code", hostPreference: "gh-copilot" });
    expect(r.via).toBe("cli");
    expect(r.worker).toBe("gh-copilot");
  });

  it('under host=claude-code + "drop" + no OPENAI_API_KEY → DROPPED (unavailable)', () => {
    const r = probeQuorumModelAvailability("gpt-5.3-codex", { host: "claude-code", hostPreference: "drop" });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/drop/);
    expect(r.reason).toMatch(/OPENAI_API_KEY/);
  });

  it('under host=claude-code + "drop" + OPENAI_API_KEY → routed via direct API', () => {
    process.env.OPENAI_API_KEY = "sk-fake";
    const r = probeQuorumModelAvailability("gpt-5.3-codex", { host: "claude-code", hostPreference: "drop" });
    expect(r.available).toBe(true);
    expect(r.via).toBe("api");
  });

  it('under host=vs-code-copilot + "drop" → behaves like auto (does NOT drop)', () => {
    const r = probeQuorumModelAvailability("gpt-5.3-codex", { host: "vs-code-copilot", hostPreference: "drop" });
    expect(r.available).toBe(true);
    expect(r.via).toBe("cli");
  });
});

describe("#104: filterQuorumModels + formatQuorumSummary", () => {
  it("formatQuorumSummary renders host header and per-model rows", () => {
    const rows = [
      { model: "claude-opus-4.7", available: true, via: "cli", worker: "claude", billing: "Anthropic Max" },
      { model: "gpt-5.3-codex", available: true, via: "cli", worker: "gh-copilot", billing: "Copilot subscription", billingWarning: "Routes through Copilot seat" },
      { model: "grok-4", available: false, via: "api", reason: "XAI_API_KEY not set" },
    ];
    const out = formatQuorumSummary(rows, "claude-code", "auto");
    expect(out).toMatch(/host: claude-code/);
    expect(out).toMatch(/routing.hostPreference: auto/);
    expect(out).toMatch(/✓ claude-opus-4\.7/);
    expect(out).toMatch(/⚠ gpt-5\.3-codex/);
    expect(out).toMatch(/✗ grok-4/);
    expect(out).toMatch(/Routes through Copilot seat/);
  });

  it("filterQuorumModels passes hostPreference through to probe", () => {
    const calls = [];
    const probe = (model, opts = {}) => {
      calls.push({ model, opts });
      return { model, available: true, via: "cli", worker: "x", billing: "test" };
    };
    const result = filterQuorumModels(
      { models: ["a", "b"] },
      { probe, host: "claude-code", hostPreference: "drop", summary: false },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].opts).toEqual({ host: "claude-code", hostPreference: "drop" });
    expect(result.host).toBe("claude-code");
    expect(result.hostPreference).toBe("drop");
    expect(result.table).toHaveLength(2);
  });

  it("filterQuorumModels dedupes models", () => {
    const probe = () => ({ available: true, via: "cli", worker: "x" });
    const r = filterQuorumModels({ models: ["a", "a", "b"] }, { probe, summary: false });
    expect(r.available).toEqual(["a", "b"]);
  });
});
