// Phase GROK-BUILD-WORKER Slice 3 — parseGrokStreamingJson.
//
// NOTE: the fixture is SYNTHETIC (the grok CLI was not installed when authored).
// It models the documented `--output-format streaming-json` shape. These tests
// pin the parser's tolerance + fallback behavior; tighten the field mapping once
// a real transcript is captured (Required Decision #4).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGrokStreamingJson } from "../orchestrator.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, "fixtures/grok-streaming-json.jsonl"), "utf-8");

describe("parseGrokStreamingJson", () => {
  it("extracts tokens, cost ticks, model, and assistant text from the fixture", () => {
    const r = parseGrokStreamingJson(FIXTURE);
    expect(r.model).toBe("grok-4.5");
    expect(r.tokens_in).toBe(1520);
    expect(r.tokens_out).toBe(842);
    expect(r.cost_in_usd_ticks).toBe(31000);
    expect(r.output).toContain("Analyzing the repository");
    expect(r.output).toContain("Applying the requested change");
    // CLI worker path stays on the subscription billing lane.
    expect(r.vendor).toBe("unknown");
  });

  it("tolerates prompt_tokens/completion_tokens field variants", () => {
    const alt = [
      '{"model":"grok-4.5"}',
      '{"type":"result","usage":{"prompt_tokens":100,"completion_tokens":50}}',
    ].join("\n");
    const r = parseGrokStreamingJson(alt);
    expect(r.tokens_in).toBe(100);
    expect(r.tokens_out).toBe(50);
  });

  it("falls back to null tokens when no usage event is present (heuristic upstream)", () => {
    const r = parseGrokStreamingJson('{"type":"assistant","delta":{"text":"hello"}}');
    expect(r.tokens_in).toBeNull();
    expect(r.tokens_out).toBeNull();
    expect(r.output).toBe("hello");
  });

  it("ignores malformed JSONL lines without throwing", () => {
    const messy = 'not json\n{"type":"result","usage":{"input_tokens":5,"output_tokens":3}}\n{bad';
    const r = parseGrokStreamingJson(messy);
    expect(r.tokens_in).toBe(5);
    expect(r.tokens_out).toBe(3);
  });

  it("returns a safe empty summary for empty/nullish input", () => {
    const r = parseGrokStreamingJson("");
    expect(r.output).toBe("");
    expect(r.tokens_in).toBeNull();
    expect(r.tokens_out).toBeNull();
    expect(r.cost_in_usd_ticks).toBeNull();
  });
});
