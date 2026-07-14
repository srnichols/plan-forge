// Phase GROK-BUILD-WORKER Slice 3 — parseGrokStreamingJson.
//
// The fixture is a REAL capture from `grok 0.2.101 -p ... --output-format
// streaming-json` (2026-07-14; session/request IDs redacted). Verified in
// v3.24.1 after installing the CLI (closes Required Decision #4). The parser
// also keeps tolerance for documented variant shapes — those cases are pinned
// below so a future schema change fails soft rather than silently.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGrokStreamingJson } from "../orchestrator.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(resolve(HERE, "fixtures/grok-streaming-json.jsonl"), "utf-8");

describe("parseGrokStreamingJson", () => {
  it("extracts text, tokens, cost ticks, and model from the REAL grok 0.2.101 capture", () => {
    const r = parseGrokStreamingJson(FIXTURE);
    expect(r.output).toBe("pong");                 // {type:"text",data:"pong"}
    expect(r.tokens_in).toBe(13793);               // usage.input_tokens
    expect(r.tokens_out).toBe(1);                   // usage.output_tokens
    expect(r.cost_in_usd_ticks).toBe(172693500);    // event-level total_cost_usd_ticks
    expect(r.model).toBe("grok-4.20-0309-non-reasoning"); // from modelUsage keys
    // CLI worker path stays on the subscription billing lane.
    expect(r.vendor).toBe("unknown");
  });

  it("tolerates the documented variant shapes (delta.text + result.usage + prompt/completion)", () => {
    const alt = [
      '{"type":"session","model":"grok-4.5"}',
      '{"type":"assistant","delta":{"text":"hello "}}',
      '{"type":"assistant","delta":{"text":"world"}}',
      '{"type":"result","usage":{"prompt_tokens":100,"completion_tokens":50}}',
    ].join("\n");
    const r = parseGrokStreamingJson(alt);
    expect(r.output).toBe("hello world");
    expect(r.model).toBe("grok-4.5");
    expect(r.tokens_in).toBe(100);
    expect(r.tokens_out).toBe(50);
  });

  it("falls back to null tokens when no usage event is present (heuristic upstream)", () => {
    const r = parseGrokStreamingJson('{"type":"text","data":"hello"}');
    expect(r.tokens_in).toBeNull();
    expect(r.tokens_out).toBeNull();
    expect(r.output).toBe("hello");
  });

  it("ignores malformed JSONL lines without throwing", () => {
    const messy = 'not json\n{"type":"end","usage":{"input_tokens":5,"output_tokens":3}}\n{bad';
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
