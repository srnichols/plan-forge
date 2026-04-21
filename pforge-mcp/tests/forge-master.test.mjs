/**
 * Plan Forge — Forge-Master tests (Phase-28, Slice 1).
 *
 * Covers:
 *   - config.mjs   (getForgeMasterConfig, fallback chain, clamping, provider detection)
 *   - allowlist.mjs (BASE_ALLOWLIST shape, resolveAllowlist, isAllowlisted, extension discovery)
 *   - index.mjs     (re-exports)
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getForgeMasterConfig,
  FORGE_MASTER_DEFAULTS,
} from "../forge-master/config.mjs";

import {
  BASE_ALLOWLIST,
  WRITE_TOOLS_EXCLUDED,
  USAGE_HINTS,
  resolveAllowlist,
  isAllowlisted,
} from "../forge-master/allowlist.mjs";

// ─── Helpers ────────────────────────────────────────────────────────

let tmpDir;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "forge-master-test-"));
  return tmpDir;
}

function writeForgeJson(dir, content) {
  writeFileSync(join(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

// ─── Config Loader ──────────────────────────────────────────────────

describe("forge-master config", () => {
  beforeEach(() => makeTmp());
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("returns defaults when .forge.json is missing", () => {
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.routerModel).toBe(FORGE_MASTER_DEFAULTS.routerModel);
    expect(cfg.maxToolCalls).toBe(5);
    expect(cfg.ceilingToolCalls).toBe(10);
    expect(cfg.sessionRetentionDays).toBe(14);
    expect(cfg.l3Enabled).toBe(false);
    expect(cfg.discoverExtensionTools).toBe(true);
  });

  it("returns defaults when .forge.json has no forgeMaster block", () => {
    writeForgeJson(tmpDir, { preset: "dotnet" });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.maxToolCalls).toBe(5);
    expect(cfg.l3Enabled).toBe(false);
  });

  it("applies explicit forgeMaster overrides", () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "claude-opus-4.5",
        routerModel: "gpt-5.4-mini",
        maxToolCalls: 8,
        l3Enabled: true,
        discoverExtensionTools: false,
      },
    });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.reasoningModel).toBe("claude-opus-4.5");
    expect(cfg.routerModel).toBe("gpt-5.4-mini");
    expect(cfg.maxToolCalls).toBe(8);
    expect(cfg.l3Enabled).toBe(true);
    expect(cfg.discoverExtensionTools).toBe(false);
  });

  it("clamps maxToolCalls to 1..10", () => {
    writeForgeJson(tmpDir, { forgeMaster: { maxToolCalls: 50 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).maxToolCalls).toBe(10);
    writeForgeJson(tmpDir, { forgeMaster: { maxToolCalls: -3 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).maxToolCalls).toBe(1);
  });

  it("clamps sessionRetentionDays to 1..365", () => {
    writeForgeJson(tmpDir, { forgeMaster: { sessionRetentionDays: 999 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).sessionRetentionDays).toBe(365);
    writeForgeJson(tmpDir, { forgeMaster: { sessionRetentionDays: 0 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).sessionRetentionDays).toBe(1);
  });

  it("falls back to model.default when forgeMaster.reasoningModel is absent", () => {
    writeForgeJson(tmpDir, { model: { default: "gpt-5.2" } });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.reasoningModel).toBe("gpt-5.2");
    expect(cfg.reasoningProvider).toBe("openai");
  });

  it("detects provider from model name", () => {
    writeForgeJson(tmpDir, { forgeMaster: { reasoningModel: "claude-opus-4.7" } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("anthropic");

    writeForgeJson(tmpDir, { forgeMaster: { reasoningModel: "gpt-5.4" } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("openai");

    writeForgeJson(tmpDir, { forgeMaster: { reasoningModel: "grok-4" } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("xai");
  });

  it("respects explicit reasoningProvider over auto-detection", () => {
    writeForgeJson(tmpDir, {
      forgeMaster: { reasoningModel: "my-custom-model", reasoningProvider: "anthropic" },
    });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("anthropic");
  });

  it("handles malformed .forge.json gracefully", () => {
    writeFileSync(join(tmpDir, ".forge.json"), "not json!", "utf-8");
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.maxToolCalls).toBe(5); // defaults
  });

  it("ensures ceilingToolCalls >= maxToolCalls", () => {
    writeForgeJson(tmpDir, {
      forgeMaster: { maxToolCalls: 7, ceilingToolCalls: 3 },
    });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.ceilingToolCalls).toBeGreaterThanOrEqual(cfg.maxToolCalls);
  });
});

// ─── Allowlist ──────────────────────────────────────────────────────

describe("forge-master allowlist", () => {
  it("BASE_ALLOWLIST contains expected read-only tools", () => {
    expect(BASE_ALLOWLIST).toContain("forge_plan_status");
    expect(BASE_ALLOWLIST).toContain("forge_cost_report");
    expect(BASE_ALLOWLIST).toContain("forge_smith");
    expect(BASE_ALLOWLIST).toContain("forge_crucible_submit");
    expect(BASE_ALLOWLIST).toContain("brain_recall");
    expect(BASE_ALLOWLIST).toContain("forge_search");
    expect(BASE_ALLOWLIST).toContain("forge_timeline");
  });

  it("BASE_ALLOWLIST does NOT contain write tools", () => {
    for (const writeTool of WRITE_TOOLS_EXCLUDED) {
      expect(BASE_ALLOWLIST).not.toContain(writeTool);
    }
  });

  it("BASE_ALLOWLIST is frozen", () => {
    expect(Object.isFrozen(BASE_ALLOWLIST)).toBe(true);
  });

  it("USAGE_HINTS covers every base tool", () => {
    for (const tool of BASE_ALLOWLIST) {
      expect(USAGE_HINTS).toHaveProperty(tool);
      expect(typeof USAGE_HINTS[tool]).toBe("string");
      expect(USAGE_HINTS[tool].length).toBeGreaterThan(10);
    }
  });

  it("resolveAllowlist returns base tools when no extensions", () => {
    const list = resolveAllowlist();
    expect(list).toEqual(expect.arrayContaining([...BASE_ALLOWLIST]));
    expect(list.length).toBe(BASE_ALLOWLIST.length);
  });

  it("resolveAllowlist discovers readOnly extension tools", () => {
    const meta = {
      my_extension_tool: { source: "extension", readOnly: true },
      my_write_ext: { source: "extension", readOnly: false },
      my_untagged_ext: { source: "extension" },
    };
    const list = resolveAllowlist({ toolMetadata: meta });
    expect(list).toContain("my_extension_tool");
    expect(list).not.toContain("my_write_ext");
    expect(list).not.toContain("my_untagged_ext");
  });

  it("resolveAllowlist skips discovery when disabled", () => {
    const meta = {
      my_extension_tool: { source: "extension", readOnly: true },
    };
    const list = resolveAllowlist({ toolMetadata: meta, discoverExtensionTools: false });
    expect(list).not.toContain("my_extension_tool");
    expect(list.length).toBe(BASE_ALLOWLIST.length);
  });

  it("isAllowlisted rejects write tools with specific reason", () => {
    const list = resolveAllowlist();
    const result = isAllowlisted("forge_run_plan", list);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("write_tool_excluded_phase28");
  });

  it("isAllowlisted allows base tools", () => {
    const list = resolveAllowlist();
    expect(isAllowlisted("forge_cost_report", list).allowed).toBe(true);
  });

  it("isAllowlisted rejects unknown tools", () => {
    const list = resolveAllowlist();
    const result = isAllowlisted("some_random_tool", list);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tool_not_allowlisted");
  });
});

// ─── System Prompt ──────────────────────────────────────────────────

describe("forge-master system-prompt", () => {
  it("system-prompt.md exists and contains key sections", () => {
    const promptPath = join(import.meta.dirname, "..", "forge-master", "system-prompt.md");
    expect(existsSync(promptPath)).toBe(true);
    const content = readFileSync(promptPath, "utf-8");
    expect(content).toContain("Forge-Master");
    expect(content).toContain("Anti-Lovable");
    expect(content).toContain("Crucible-Funneling");
    expect(content).toContain("No Hand-Math");
    expect(content).toContain("Off-Topic");
    expect(content).toContain("Temper Guards");
    expect(content).toContain("5-question framework");
    expect(content).toContain("{context_block}");
  });
});

// ─── Index re-exports ───────────────────────────────────────────────

describe("forge-master index", () => {
  it("re-exports config and allowlist APIs", async () => {
    const mod = await import("../forge-master/index.mjs");
    expect(typeof mod.getForgeMasterConfig).toBe("function");
    expect(mod.FORGE_MASTER_DEFAULTS).toBeDefined();
    expect(mod.BASE_ALLOWLIST).toBeDefined();
    expect(mod.WRITE_TOOLS_EXCLUDED).toBeDefined();
    expect(mod.USAGE_HINTS).toBeDefined();
    expect(typeof mod.resolveAllowlist).toBe("function");
    expect(typeof mod.isAllowlisted).toBe("function");
  });
});
