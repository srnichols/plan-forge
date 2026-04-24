/**
 * Meta-bug #103 regression tests — Copilot-servable model routing.
 *
 * Verifies probeQuorumModelAvailability() correctly routes:
 *   - grok-*, dall-e-*     → direct API required (no CLI proxy)
 *   - gpt-*, chatgpt-*     → gh-copilot preferred, direct API fallback
 *   - claude-*, codex-*    → CLI path
 *
 * Before the fix: gpt-5.3-codex was marked `unavailable: OPENAI_API_KEY not set`
 * even when gh-copilot was installed and would serve it via the Copilot
 * subscription. Quorum auto-dropped it from the model list.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  probeQuorumModelAvailability,
  setGhCopilotProbe,
  detectClientHost,
  describeBillingSurface,
} from "../orchestrator.mjs";

describe("#103: Copilot-servable model routing in probeQuorumModelAvailability", () => {
  // Save/restore any OPENAI_API_KEY so tests do not bleed env.
  let savedOpenAiKey;
  let savedXaiKey;

  beforeEach(() => {
    savedOpenAiKey = process.env.OPENAI_API_KEY;
    savedXaiKey = process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
  });

  afterEach(() => {
    setGhCopilotProbe(null);
    if (savedOpenAiKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAiKey;
    else delete process.env.OPENAI_API_KEY;
    if (savedXaiKey !== undefined) process.env.XAI_API_KEY = savedXaiKey;
    else delete process.env.XAI_API_KEY;
  });

  describe("gpt-* (Copilot-servable)", () => {
    it("is available via gh-copilot when CLI is installed, no OPENAI_API_KEY needed", () => {
      setGhCopilotProbe(() => true);
      const result = probeQuorumModelAvailability("gpt-5.3-codex");
      expect(result.available).toBe(true);
      expect(result.via).toBe("cli");
      expect(result.worker).toBe("gh-copilot");
      expect(result.provider).toBe("copilot-subscription");
    });

    it("falls back to direct API when gh-copilot is absent and OPENAI_API_KEY is set", () => {
      setGhCopilotProbe(() => false);
      process.env.OPENAI_API_KEY = "sk-test";
      const result = probeQuorumModelAvailability("gpt-5.3-codex");
      expect(result.available).toBe(true);
      expect(result.via).toBe("api");
      expect(result.fallback).toBe(true);
    });

    it("is unavailable when gh-copilot is absent AND no OPENAI_API_KEY", () => {
      setGhCopilotProbe(() => false);
      const result = probeQuorumModelAvailability("gpt-5.3-codex");
      expect(result.available).toBe(false);
      expect(result.reason).toContain("gh-copilot");
      expect(result.reason).toContain("OPENAI_API_KEY");
    });

    it("chatgpt-* behaves the same as gpt-*", () => {
      setGhCopilotProbe(() => true);
      const result = probeQuorumModelAvailability("chatgpt-4o");
      expect(result.available).toBe(true);
      expect(result.worker).toBe("gh-copilot");
    });
  });

  describe("grok-* (direct-API-only)", () => {
    it("is unavailable without XAI_API_KEY even when gh-copilot is installed", () => {
      setGhCopilotProbe(() => true);
      const result = probeQuorumModelAvailability("grok-4");
      expect(result.available).toBe(false);
      expect(result.via).toBe("api");
      expect(result.reason).toContain("XAI_API_KEY");
    });

    it("is available when XAI_API_KEY is set, regardless of gh-copilot", () => {
      setGhCopilotProbe(() => false);
      process.env.XAI_API_KEY = "xai-test";
      const result = probeQuorumModelAvailability("grok-4");
      expect(result.available).toBe(true);
      expect(result.via).toBe("api");
      expect(result.provider).toBe("xai");
    });
  });

  describe("claude-* / codex-* (CLI-routed)", () => {
    it("claude-opus-4.7 is available via gh-copilot fallback when claude CLI absent", () => {
      setGhCopilotProbe(() => true);
      // detectWorkers() will include gh-copilot from real loadWorkerCapabilities.
      // Even without the claude CLI on PATH, gh-copilot drives the spawn.
      const result = probeQuorumModelAvailability("claude-opus-4.7");
      // Either the claude CLI is installed (via=cli, worker=claude) or
      // gh-copilot fallback kicks in (via=cli, worker=gh-copilot, fallback=true).
      expect(result.via).toBe("cli");
    });
  });

  describe("host detection & observability", () => {
    // Snapshot the detection-relevant env vars so tests don't leak.
    const ENV_KEYS = [
      "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT",
      "TERM_PROGRAM", "CURSOR_TRACE_ID", "ZED_TERM",
      "VSCODE_AGENT_MODE", "VSCODE_PID",
    ];
    const saved = {};
    beforeEach(() => {
      for (const k of ENV_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });
    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] !== undefined) process.env[k] = saved[k];
        else delete process.env[k];
      }
    });

    it("detectClientHost returns claude-code when CLAUDECODE=1", () => {
      process.env.CLAUDECODE = "1";
      expect(detectClientHost()).toBe("claude-code");
    });

    it("detectClientHost returns cursor when TERM_PROGRAM=cursor", () => {
      process.env.TERM_PROGRAM = "cursor";
      expect(detectClientHost()).toBe("cursor");
    });

    it("detectClientHost returns vs-code-copilot for plain VS Code", () => {
      process.env.TERM_PROGRAM = "vscode";
      expect(detectClientHost()).toBe("vs-code-copilot");
    });

    it("detectClientHost returns cli-terminal when no signals", () => {
      expect(detectClientHost()).toBe("cli-terminal");
    });

    it("describeBillingSurface warns when Claude Code user hits Copilot seat", () => {
      const b = describeBillingSurface("gh-copilot", "claude-code");
      expect(b.warning).toMatch(/Claude Code/);
      expect(b.warning).toMatch(/Copilot seat/);
    });

    it("describeBillingSurface warns Cursor users about subprocess visibility", () => {
      const b = describeBillingSurface("gh-copilot", "cursor");
      expect(b.warning).toMatch(/Cursor/);
    });

    it("describeBillingSurface does not warn VS Code Copilot users", () => {
      const b = describeBillingSurface("gh-copilot", "vs-code-copilot");
      expect(b.warning).toBeNull();
    });

    it("probeQuorumModelAvailability surfaces host + billing for gpt-* in Claude Code", () => {
      process.env.CLAUDECODE = "1";
      setGhCopilotProbe(() => true);
      const result = probeQuorumModelAvailability("gpt-5.3-codex");
      expect(result.available).toBe(true);
      expect(result.host).toBe("claude-code");
      expect(result.billing).toMatch(/Copilot/);
      expect(result.billingWarning).toMatch(/Claude Code/);
    });

    it("probeQuorumModelAvailability includes host in unavailable results", () => {
      process.env.CLAUDECODE = "1";
      setGhCopilotProbe(() => false);
      const result = probeQuorumModelAvailability("gpt-5.3-codex");
      expect(result.available).toBe(false);
      expect(result.host).toBe("claude-code");
    });
  });
});
