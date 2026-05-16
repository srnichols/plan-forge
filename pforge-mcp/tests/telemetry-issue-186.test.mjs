// Tests for #186 (v2.96.2): worker token telemetry — vendor/sessionDurationMs/codeChanges
// gaps. Covers the pure helpers added in orchestrator.mjs:
//   - deriveVendorFromModel(model)
//   - parseShortstat(shortstat)

import { describe, it, expect } from "vitest";
import { deriveVendorFromModel, parseShortstat } from "../orchestrator.mjs";

describe("#186 deriveVendorFromModel", () => {
  it("maps claude-* to anthropic", () => {
    expect(deriveVendorFromModel("claude-opus-4.7")).toBe("anthropic");
    expect(deriveVendorFromModel("claude-sonnet-4.6")).toBe("anthropic");
    expect(deriveVendorFromModel("claude-haiku-3.5")).toBe("anthropic");
  });

  it("maps gpt-* to openai", () => {
    expect(deriveVendorFromModel("gpt-5.3-codex")).toBe("openai");
    expect(deriveVendorFromModel("gpt-4o")).toBe("openai");
    expect(deriveVendorFromModel("gpt-4o-mini")).toBe("openai");
  });

  it("maps o1/o3/o4 reasoning models to openai", () => {
    expect(deriveVendorFromModel("o1")).toBe("openai");
    expect(deriveVendorFromModel("o1-preview")).toBe("openai");
    expect(deriveVendorFromModel("o3-mini")).toBe("openai");
    expect(deriveVendorFromModel("o4-mini")).toBe("openai");
  });

  it("maps grok-* to xai", () => {
    expect(deriveVendorFromModel("grok-4.20-0309-reasoning")).toBe("xai");
    expect(deriveVendorFromModel("grok-4")).toBe("xai");
    expect(deriveVendorFromModel("grok-3-mini")).toBe("xai");
  });

  it("maps gemini-* to google", () => {
    expect(deriveVendorFromModel("gemini-2.5-pro")).toBe("google");
    expect(deriveVendorFromModel("gemini-flash-2.0")).toBe("google");
  });

  it("returns null for unknown / unrecognized models", () => {
    expect(deriveVendorFromModel("llama-3.1-70b")).toBeNull();
    expect(deriveVendorFromModel("mystery-model")).toBeNull();
    expect(deriveVendorFromModel("o0-bogus")).toBeNull(); // o0 is not a reasoning line
  });

  it("returns null for null/empty/non-string input", () => {
    expect(deriveVendorFromModel(null)).toBeNull();
    expect(deriveVendorFromModel(undefined)).toBeNull();
    expect(deriveVendorFromModel("")).toBeNull();
    expect(deriveVendorFromModel(42)).toBeNull();
    expect(deriveVendorFromModel({})).toBeNull();
  });

  it("is case-insensitive on model name", () => {
    expect(deriveVendorFromModel("CLAUDE-OPUS-4.7")).toBe("anthropic");
    expect(deriveVendorFromModel("Claude-Sonnet-4.6")).toBe("anthropic");
    expect(deriveVendorFromModel("GPT-5.3-codex")).toBe("openai");
  });
});

describe("#186 parseShortstat", () => {
  it("parses the standard 3-field summary", () => {
    const r = parseShortstat(" 3 files changed, 47 insertions(+), 12 deletions(-)");
    expect(r).toEqual({ filesChanged: 3, linesAdded: 47, linesRemoved: 12 });
  });

  it("parses an insertions-only commit (no deletions)", () => {
    const r = parseShortstat(" 1 file changed, 5 insertions(+)");
    expect(r).toEqual({ filesChanged: 1, linesAdded: 5, linesRemoved: 0 });
  });

  it("parses a deletions-only commit (no insertions)", () => {
    const r = parseShortstat(" 1 file changed, 2 deletions(-)");
    expect(r).toEqual({ filesChanged: 1, linesAdded: 0, linesRemoved: 2 });
  });

  it("handles multi-line output with leading blank lines", () => {
    const r = parseShortstat("\n\n 2 files changed, 8 insertions(+), 3 deletions(-)\n");
    expect(r).toEqual({ filesChanged: 2, linesAdded: 8, linesRemoved: 3 });
  });

  it("handles plural/singular file noun", () => {
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({
      filesChanged: 1, linesAdded: 1, linesRemoved: 0,
    });
    expect(parseShortstat(" 7 files changed, 100 insertions(+)")).toEqual({
      filesChanged: 7, linesAdded: 100, linesRemoved: 0,
    });
  });

  it("returns null for binary-only / merge-only output", () => {
    expect(parseShortstat(" Bin 0 -> 1024 bytes")).toBeNull();
    expect(parseShortstat("Merge: abc123 def456")).toBeNull();
  });

  it("returns null for null / empty / non-string input", () => {
    expect(parseShortstat(null)).toBeNull();
    expect(parseShortstat(undefined)).toBeNull();
    expect(parseShortstat("")).toBeNull();
    expect(parseShortstat(123)).toBeNull();
  });

  it("picks the first valid summary line even if other lines are present", () => {
    // git show output can include other diagnostics — we always want the summary.
    const r = parseShortstat("commit abc\nAuthor: x\n\n 4 files changed, 20 insertions(+), 5 deletions(-)");
    expect(r).toEqual({ filesChanged: 4, linesAdded: 20, linesRemoved: 5 });
  });
});
