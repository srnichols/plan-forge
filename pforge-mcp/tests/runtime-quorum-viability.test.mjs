import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectExecutionRuntime,
  assessQuorumViability,
  resolveRequiredCli,
  filterQuorumModels,
} from "../orchestrator.mjs";

// ─── detectExecutionRuntime ─────────────────────────────────────────────

describe("detectExecutionRuntime", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns vs-code-agents-enterprise when VSCODE_AGENT_MODE=enterprise", () => {
    process.env.VSCODE_AGENT_MODE = "enterprise";
    expect(detectExecutionRuntime()).toBe("vs-code-agents-enterprise");
  });

  it("returns vs-code-copilot-chat when VSCODE_PID is set", () => {
    delete process.env.VSCODE_AGENT_MODE;
    process.env.VSCODE_PID = "12345";
    expect(detectExecutionRuntime()).toBe("vs-code-copilot-chat");
  });

  it("returns vs-code-copilot-chat when TERM_PROGRAM=vscode", () => {
    delete process.env.VSCODE_AGENT_MODE;
    delete process.env.VSCODE_PID;
    process.env.TERM_PROGRAM = "vscode";
    expect(detectExecutionRuntime()).toBe("vs-code-copilot-chat");
  });

  it("returns cli-claude when claude worker is available", () => {
    delete process.env.VSCODE_AGENT_MODE;
    delete process.env.VSCODE_PID;
    delete process.env.TERM_PROGRAM;
    const workers = [
      { name: "claude", available: true },
      { name: "gh-copilot", available: true },
    ];
    expect(detectExecutionRuntime({ workers })).toBe("cli-claude");
  });

  it("returns cli-codex when codex worker is available", () => {
    delete process.env.VSCODE_AGENT_MODE;
    delete process.env.VSCODE_PID;
    delete process.env.TERM_PROGRAM;
    const workers = [
      { name: "codex", available: true },
      { name: "gh-copilot", available: true },
    ];
    expect(detectExecutionRuntime({ workers })).toBe("cli-codex");
  });

  it("returns cli-gh as default fallback", () => {
    delete process.env.VSCODE_AGENT_MODE;
    delete process.env.VSCODE_PID;
    delete process.env.TERM_PROGRAM;
    const workers = [
      { name: "gh-copilot", available: true },
    ];
    expect(detectExecutionRuntime({ workers })).toBe("cli-gh");
  });

  it("returns cli-gh when no workers available", () => {
    delete process.env.VSCODE_AGENT_MODE;
    delete process.env.VSCODE_PID;
    delete process.env.TERM_PROGRAM;
    const workers = [];
    expect(detectExecutionRuntime({ workers })).toBe("cli-gh");
  });

  it("prefers VS Code detection over worker detection", () => {
    process.env.VSCODE_AGENT_MODE = "enterprise";
    const workers = [{ name: "claude", available: true }];
    expect(detectExecutionRuntime({ workers })).toBe("vs-code-agents-enterprise");
  });

  it("ignores unavailable workers", () => {
    delete process.env.VSCODE_AGENT_MODE;
    delete process.env.VSCODE_PID;
    delete process.env.TERM_PROGRAM;
    const workers = [
      { name: "claude", available: false },
      { name: "gh-copilot", available: true },
    ];
    expect(detectExecutionRuntime({ workers })).toBe("cli-gh");
  });
});

// ─── assessQuorumViability ──────────────────────────────────────────────

describe("assessQuorumViability", () => {
  const allAvailableProbe = (model) => ({
    model,
    available: true,
    via: /^grok-|^gpt-|^chatgpt-/.test(model) ? "api" : "cli",
  });

  const noneAvailableProbe = (model) => ({
    model,
    available: false,
    via: /^grok-|^gpt-|^chatgpt-/.test(model) ? "api" : "cli",
    reason: "not installed",
    install: "install it",
  });

  const selectiveProbe = (availableModels) => (model) => ({
    model,
    available: availableModels.includes(model),
    via: /^grok-|^gpt-|^chatgpt-/.test(model) ? "api" : "cli",
    reason: availableModels.includes(model) ? undefined : "not installed",
    install: availableModels.includes(model) ? undefined : "install it",
  });

  it("returns error for unknown preset", () => {
    const result = assessQuorumViability("unknown");
    expect(result.error).toMatch(/Unknown preset/);
  });

  // ─── Power preset ──────────────────────────────────────────────

  describe("power preset", () => {
    it("all models available — synthesis viable", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "vs-code-agents-enterprise",
        probe: allAvailableProbe,
      });
      expect(result.preset).toBe("power");
      expect(result.declared).toBe(3);
      expect(result.effective).toBe(3);
      expect(result.synthesisViable).toBe(true);
      expect(result.recommendation).toBeNull();
      expect(result.models).toHaveLength(3);
      expect(result.models.every((m) => m.status === "available")).toBe(true);
    });

    it("2 of 3 models available — synthesis still viable", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "cli-gh",
        // v2.81 (#107): power preset upgraded to opus-4.7 — was opus-4.6.
        probe: selectiveProbe(["claude-opus-4.7", "gpt-5.3-codex"]),
      });
      expect(result.effective).toBe(2);
      expect(result.synthesisViable).toBe(true);
      expect(result.recommendation).toBeTruthy();
      expect(result.recommendation.note).toMatch(/2-of-3/);
    });

    it("1 of 3 models available — synthesis NOT viable, recommends fallback", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "cli-gh",
        // v2.81 (#107): power preset upgraded to opus-4.7 — was opus-4.6.
        probe: selectiveProbe(["claude-opus-4.7"]),
      });
      expect(result.effective).toBe(1);
      expect(result.synthesisViable).toBe(false);
      expect(result.recommendation).toBeTruthy();
      expect(result.recommendation.preset).toBe("speed");
      expect(result.recommendation.reason).toMatch(/power models/i);
    });

    it("0 of 3 models available — synthesis NOT viable", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "cli-gh",
        probe: noneAvailableProbe,
      });
      expect(result.effective).toBe(0);
      expect(result.synthesisViable).toBe(false);
      expect(result.recommendation.preset).toBe("speed");
    });

    it("includes declaredForRuntime annotations", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "cli-gh",
        probe: allAvailableProbe,
      });
      // v2.81 (#107): power preset upgraded to opus-4.7 — was opus-4.6.
      const claudeModel = result.models.find((m) => m.model === "claude-opus-4.7");
      expect(claudeModel.declaredForRuntime).toBe(true);
      const grokModel = result.models.find((m) => m.model === "grok-4.20-0309-reasoning");
      expect(grokModel.declaredForRuntime).toBe(false);
    });
  });

  // ─── Speed preset ─────────────────────────────────────────────

  describe("speed preset", () => {
    it("all models available — synthesis viable", () => {
      const result = assessQuorumViability("speed", {
        runtimeOverride: "vs-code-agents-enterprise",
        probe: allAvailableProbe,
      });
      expect(result.preset).toBe("speed");
      expect(result.declared).toBe(3);
      expect(result.effective).toBe(3);
      expect(result.synthesisViable).toBe(true);
      expect(result.recommendation).toBeNull();
    });

    it("partial availability — synthesis viable with 2", () => {
      const result = assessQuorumViability("speed", {
        runtimeOverride: "cli-gh",
        probe: selectiveProbe(["claude-sonnet-4.6", "gpt-5.4-mini"]),
      });
      expect(result.effective).toBe(2);
      expect(result.synthesisViable).toBe(true);
    });

    it("no models available — synthesis NOT viable, provides note", () => {
      const result = assessQuorumViability("speed", {
        runtimeOverride: "cli-claude",
        probe: noneAvailableProbe,
      });
      expect(result.effective).toBe(0);
      expect(result.synthesisViable).toBe(false);
      // speed preset has no fallbacks defined, but still gets a note
      expect(result.recommendation.note).toMatch(/0-of-3/);
    });

    it("single model — synthesis NOT viable, hint about single-model", () => {
      const result = assessQuorumViability("speed", {
        runtimeOverride: "cli-claude",
        probe: selectiveProbe(["claude-sonnet-4.6"]),
      });
      expect(result.effective).toBe(1);
      expect(result.synthesisViable).toBe(false);
      expect(result.recommendation.hint).toMatch(/single-model/);
    });
  });

  // ─── Cross-runtime ────────────────────────────────────────────

  describe("cross-runtime", () => {
    it("sets runtime from runtimeOverride", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "cli-codex",
        probe: allAvailableProbe,
      });
      expect(result.runtime).toBe("cli-codex");
    });

    it("declaredForRuntime is null when runtime not in availableIn", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "unknown-runtime",
        probe: allAvailableProbe,
      });
      result.models.forEach((m) => {
        expect(m.declaredForRuntime).toBeNull();
      });
    });

    const runtimes = ["cli-gh", "cli-claude", "cli-codex", "vs-code-copilot-chat", "vs-code-agents-enterprise"];
    for (const rt of runtimes) {
      it(`produces valid output for runtime: ${rt}`, () => {
        const result = assessQuorumViability("power", {
          runtimeOverride: rt,
          probe: allAvailableProbe,
        });
        expect(result.runtime).toBe(rt);
        expect(typeof result.declared).toBe("number");
        expect(typeof result.effective).toBe("number");
        expect(typeof result.synthesisViable).toBe("boolean");
      });
    }
  });

  // ─── Determinism ──────────────────────────────────────────────

  describe("determinism", () => {
    it("same inputs produce identical outputs", () => {
      const probe = allAvailableProbe;
      const opts = { runtimeOverride: "cli-gh", probe };
      const r1 = assessQuorumViability("power", opts);
      const r2 = assessQuorumViability("power", opts);
      expect(r1).toEqual(r2);
    });

    it("different presets produce different outputs", () => {
      const probe = allAvailableProbe;
      const opts = { runtimeOverride: "cli-gh", probe };
      const power = assessQuorumViability("power", opts);
      const speed = assessQuorumViability("speed", opts);
      expect(power.preset).toBe("power");
      expect(speed.preset).toBe("speed");
      expect(power.models).not.toEqual(speed.models);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────

  describe("edge cases", () => {
    it("unavailable models include reason and install hint", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "cli-gh",
        probe: noneAvailableProbe,
      });
      result.models.forEach((m) => {
        expect(m.status).toBe("unavailable");
        expect(m.reason).toBeTruthy();
        expect(m.install).toBeTruthy();
      });
    });

    it("available models have null reason and install", () => {
      const result = assessQuorumViability("power", {
        runtimeOverride: "cli-gh",
        probe: allAvailableProbe,
      });
      result.models.forEach((m) => {
        expect(m.status).toBe("available");
        expect(m.reason).toBeNull();
        expect(m.install).toBeNull();
      });
    });
  });
});

// ─── QUORUM_PRESETS schema validation ───────────────────────────────────

describe("QUORUM_PRESETS schema", () => {
  it("power preset has availableIn for all known runtimes", () => {
    const result = assessQuorumViability("power", {
      runtimeOverride: "vs-code-agents-enterprise",
      probe: (m) => ({ model: m, available: true, via: "cli" }),
    });
    // power preset should have enterprise as a key
    expect(result.models.some((m) => m.declaredForRuntime === true)).toBe(true);
  });

  it("speed preset has availableIn for all known runtimes", () => {
    const result = assessQuorumViability("speed", {
      runtimeOverride: "vs-code-agents-enterprise",
      probe: (m) => ({ model: m, available: true, via: "cli" }),
    });
    expect(result.models.some((m) => m.declaredForRuntime === true)).toBe(true);
  });

  it("fallback presets reference valid preset names", () => {
    // Power preset's cli-gh fallback should reference "speed"
    const result = assessQuorumViability("power", {
      runtimeOverride: "cli-gh",
      probe: (m) => ({ model: m, available: false, via: "cli", reason: "n/a" }),
    });
    if (result.recommendation?.preset) {
      // The fallback preset must be a known preset name
      const fallbackResult = assessQuorumViability(result.recommendation.preset, {
        runtimeOverride: "cli-gh",
        probe: (m) => ({ model: m, available: true, via: "cli" }),
      });
      expect(fallbackResult.error).toBeUndefined();
    }
  });
});
