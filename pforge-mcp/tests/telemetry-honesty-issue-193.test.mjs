/**
 * Bug #193 (v3.0.1) — testbed-found UX / telemetry-honesty defects.
 *
 *   A: `[model] resolved=` log renamed to `[model] configured=`
 *   B: formatQuorumSummary fallback no longer emits "✓ … unavailable"
 *   C: summary.json gets a top-level `phase` field
 *   D: API-direct worker + dry-run synth no longer hardcode `apiDurationMs: 0`
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { fileURLToPath } from "url";
import { formatQuorumSummary } from "../orchestrator.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const src = readFileSync(resolve(__dirname, "..", "orchestrator.mjs"), "utf8");
// Phase-53 S2: callApiWorker was extracted to orchestrator/worker-spawn.mjs
const workerSpawnSrc = readFileSync(resolve(__dirname, "..", "orchestrator", "worker-spawn.mjs"), "utf8");

// ─── Defect A: model log format ──────────────────────────────────────────────
// Bug #127 specifies `resolved=` as the canonical log prefix; Bug #193 Defect A
// originally proposed renaming to `configured=` but that conflicts with the
// Bug #127 test contract. The settled behavior is `resolved=` with a source tag.

describe("#193 Defect A — [model] resolved= log format", () => {
  it("source uses the `resolved=` wording (Bug #127 contract)", () => {
    expect(src).toContain('[model] resolved=${effectiveModel} source=${modelSource}');
  });

  it("source includes the source= tag in the log line", () => {
    // source= tag enables users to distinguish options / frontmatter / config / default
    expect(src).toMatch(/\[model\] resolved=\$\{effectiveModel\} source=\$\{modelSource\}/);
  });
});

// ─── Defect B: quorum summary no contradictory rows ──────────────────────────

describe("#193 Defect B — formatQuorumSummary contradictions", () => {
  it("available row WITHOUT billing string no longer renders `unavailable`", () => {
    const out = formatQuorumSummary(
      [{ model: "claude-opus-4.7", available: true, via: "cli", worker: "gh-copilot" }],
      "vs-code-copilot",
      "auto"
    );
    expect(out).toContain("✓");
    expect(out).not.toMatch(/✓[^\n]*unavailable/);
    expect(out).toContain("available (billing unspecified)");
  });

  it("available row WITH billing string keeps its billing string", () => {
    const out = formatQuorumSummary(
      [{ model: "gpt-5.3-codex", available: true, via: "cli", worker: "gh-copilot", billing: "GitHub Copilot subscription (VS Code)" }],
      "vs-code-copilot",
      "auto"
    );
    expect(out).toContain("✓");
    expect(out).toContain("GitHub Copilot subscription (VS Code)");
    expect(out).not.toContain("available (billing unspecified)");
  });

  it("unavailable row WITH reason still shows the reason", () => {
    const out = formatQuorumSummary(
      [{ model: "grok-4.20", available: false, via: "api", provider: "xai", reason: "XAI_API_KEY not set" }],
      "vs-code-copilot",
      "auto"
    );
    expect(out).toContain("✗");
    expect(out).toContain("XAI_API_KEY not set");
  });

  it("unavailable row WITHOUT reason falls back to literal `unavailable`", () => {
    const out = formatQuorumSummary(
      [{ model: "some-model", available: false, via: "cli", worker: "claude" }],
      "vs-code-copilot",
      "auto"
    );
    expect(out).toContain("✗");
    expect(out).toContain("unavailable");
  });

  it("billing warning still gets the ⚠ mark when available", () => {
    const out = formatQuorumSummary(
      [{ model: "x", available: true, via: "cli", worker: "claude", billingWarning: "metered" }],
      "vs-code-copilot",
      "auto"
    );
    expect(out).toContain("⚠");
  });
});

// ─── Defect C: summary.json `phase` field ────────────────────────────────────

describe("#193 Defect C — summary.json phase field", () => {
  it("buildSummary source assigns `phase: basename(runMeta.plan, \".md\")`", () => {
    expect(src).toContain('phase: basename(runMeta.plan, ".md")');
  });

  it("basename produces the expected phase string", () => {
    expect(basename("E:/x/docs/plans/Phase-2-PROJECTS-CRUD-PLAN.md", ".md"))
      .toBe("Phase-2-PROJECTS-CRUD-PLAN");
  });
});

// ─── Defect D: durations no longer hardcoded 0 ───────────────────────────────

describe("#193 Defect D — API-direct + dry-run duration honesty", () => {
  it("dry-run synth emits apiDurationMs: null, sessionDurationMs: null", () => {
    expect(src).toContain(
      'tokens: { tokens_in: 0, tokens_out: 0, model: "dry-run", premiumRequests: 0, apiDurationMs: null, sessionDurationMs: null, codeChanges: null, vendor: "dry-run" }'
    );
    // And the old literal-0 form must be gone.
    expect(src).not.toContain(
      'tokens: { tokens_in: 0, tokens_out: 0, model: "dry-run", premiumRequests: 0, apiDurationMs: 0, sessionDurationMs: 0,'
    );
  });

  it("callApiWorker captures _apiStartMs before fetch", () => {
    expect(workerSpawnSrc).toContain("const _apiStartMs = Date.now();");
  });

  it("callApiWorker computes _apiDurationMs after response.json()", () => {
    expect(workerSpawnSrc).toContain("const _apiDurationMs = Date.now() - _apiStartMs;");
  });

  it("callApiWorker assigns measured value to both duration fields", () => {
    // Match the success-path tokens block by structure (apiDurationMs + sessionDurationMs both bound to _apiDurationMs).
    const m = workerSpawnSrc.match(/apiDurationMs:\s*_apiDurationMs,[\s\S]{0,80}sessionDurationMs:\s*_apiDurationMs,/);
    expect(m).not.toBeNull();
  });

  it("callApiWorker no longer hardcodes apiDurationMs: 0 in its success path", () => {
    // The success-path tokens block starts shortly after `const choice = data.choices?.[0];`
    const successPath = workerSpawnSrc.split("const choice = data.choices?.[0];")[1] ?? "";
    // Take the first ~1KB of the success path (covers the tokens block).
    const window = successPath.slice(0, 1200);
    expect(window).not.toMatch(/apiDurationMs:\s*0,/);
    expect(window).not.toMatch(/sessionDurationMs:\s*0,/);
  });
});
