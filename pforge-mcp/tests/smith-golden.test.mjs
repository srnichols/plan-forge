/**
 * Phase-41 ENUMS-CENTRALIZATION Slice 2
 * Smoke-test: pforge smith output against the testbed is stable.
 *
 * On every run we capture current smith output, normalize volatile fields
 * (tool versions, cache age timestamps), then compare against the golden
 * fixture captured at S2-time.  Any structural change in smith output
 * (added/removed sections, changed hook counts, new fail messages) will
 * surface here.
 *
 * It runs only when asked (PFORGE_SMITH_GOLDEN=1), on Windows, where a testbed resolves (testbed.path in
 * .forge.json, or a plan-forge-testbed clone next to the repo). The golden is a snapshot of one testbed in one tool
 * state: smith prints the testbed's .vscode/mcp.json entries, which Forge-Master and pforge-sdk sections it has
 * installed, its last run, and whether claude and grok are on PATH, so the comparison passes only while all of those
 * still match, and it drifts with every testbed or tool change that smith's own structure does not show. A suite
 * that is red for those reasons teaches people to read past its summary, and this one added two minutes to a
 * local run. Run it when you change what smith prints. When the testbed has changed on purpose, run `pforge smith`
 * in it and save the output as tests/fixtures/smith-golden-pre-enums.txt. The testbed is read-only; never modify
 * it. This test never writes a file.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTestbedPath } from "../testbed/scenarios.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "fixtures");
const GOLDEN = resolve(FIXTURES, "smith-golden-pre-enums.txt");

const PFORGE_PS1 = resolve(HERE, "..", "..", "pforge.ps1");

function findTestbed() {
  try {
    return resolveTestbedPath({}, { projectRoot: resolve(HERE, "..", "..") });
  } catch {
    return null;
  }
}

const TESTBED = findTestbed();
const isWindows = process.platform === "win32";
const testbedExists = Boolean(TESTBED) && existsSync(TESTBED);
const ps1Exists = existsSync(PFORGE_PS1);

/** Strip ANSI escape sequences so golden diffs are color-independent. */
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

// Normalize volatile fields so minor version bumps don't fail the comparison.
// Keeps structural content (sections, hook counts) intact while masking items
// that legitimately vary between environments (tool availability, API key presence).
function normalize(text) {
  return (
    stripAnsi(text)
      // CRLF first: several rules below end in "\n", and pwsh on Windows emits "\r\n".
      .replace(/\r\n/g, "\n")
      // Semver-like version strings: v1.2.3, v1.2.3.windows.4, 1.2.3.windows.4
      .replace(/v\d+\.\d+\.\d+(?:\.\S*)?/g, "v<version>")
      .replace(/\b\d+\.\d+\.\d+(?:\.\S+)?\b/g, "<version>")
      // Cache age: "(cached 95m ago)" → "(cached <age>)"
      .replace(/\(cached \d+[smhd]+ ago\)/g, "(cached <age>)")
      // A cache-hit hint is optional after a cold lookup.
      .replace(/^[^\S\n]*\(cached <age>\)\n/gm, "")
      // Auto-update status: cache age and last-check time change every run
      .replace(/Cache age: -?\d+m/g, "Cache age: <age>")
      .replace(/Last check: [^\n|]+/g, "Last check: <time>")
      // gh-copilot agentic status: varies by environment (login session, flags)
      .replace(/gh-copilot v<version>[^\n]*/g, "gh-copilot v<version> <copilot-agent-status>")
      // copilot-coding-agent: check result changes with gh auth state.
      // Issue #210 fix: message may render either "v<semver>", a bare "v" (the
      // pre-fix bug where $version was null), or "(version unknown)" (post-fix
      // graceful fallback). All three normalize to the same placeholder so the
      // golden fixture is forward- and backward-compatible.
      .replace(/copilot-coding-agent (?:v\S*|\(version unknown\))[^\n]*/g, "copilot-coding-agent <coding-agent-status>")
      // Worker CLIs (claude, grok): present and versioned on a machine with the CLI ("(agentic capable)"), "not found
      // on PATH" plus a FIX line without it ("(agent worker)"). Same environment-varying class as gh-copilot above;
      // the FIX line is dropped so both shapes collapse.
      .replace(/[^\S\n]*(?:✅|Γ£à|⚠️|⚠|ΓÜá∩╕Å)[^\n]*\b(claude|grok)\b[^\n]*\((?:agent worker|agentic capable)\)[^\n]*/g, "  $1 <worker-status>")
      .replace(/[^\S\n]+FIX: (?:irm https:\/\/x\.ai\/cli\/install|winget install Anthropic\.Claude)[^\n]*\n?/g, "")
      // Image API key presence: XAI_API_KEY / OPENAI_API_KEY vary by environment
      .replace(/[^\S\n]*(?:✓|✅|Γ£à)[^\n]*API_KEY[^\n]*/g, "  <api-key-present>")
      .replace(/[^\S\n]*(?:✓|✅|Γ£à)[^\n]*Grok Aurora[^\n]*/g, "  <api-key-present>")
      .replace(/[^\S\n]*(?:⚠|⚠️|ΓÜá∩╕Å)[^\n]*No image API keys configured[^\n]*/g, "  <no-api-keys>")
      .replace(/[^\S\n]+FIX: Set XAI_API_KEY or OPENAI_API_KEY[^\n]*/g, "")
      // Normalise block: 0/1/N api-key lines → single placeholder so the test is
      // environment-agnostic regardless of how many keys are configured.
      // Also consume any immediately-following blank line (left by FIX-line removal).
      .replace(/(?:  <api-key-present>\n?|  <no-api-keys>\n?)+\n?/g, "  <api-key-section>\n")
      // Testbed state, not smith's structure: the installed version may be a -dev
      // build or behind the latest release, and the instruction-file and tool
      // counts grow with every upgrade. Each upgrade used to break this golden.
      .replace(/<version>-dev\b/g, "<version>")
      .replace(/[^\S\n]*(?:✅|Γ£à)[^\n]*Up to date \(v<version>\)/g, "  <version-currency>")
      .replace(/[^\S\n]*(?:⚠️|⚠|ΓÜá∩╕Å)[^\n]*Installed v<version> — latest is v<version>\n[^\S\n]+FIX: Run 'pforge self-update'[^\n]*/g, "  <version-currency>")
      .replace(/\b\d+ instruction files\b/g, "<n> instruction files")
      // Present only once the testbed's pforge-mcp ships install-consistency.mjs (3.31.2+).
      .replace(/[^\S\n]*(?:✅|Γ£à)[^\n]*Plan Forge v<version> installed \(packages agree\)\n/g, "")
      .replace(/\b\d+ MCP tools\b/g, "<n> MCP tools")
      // Generated capability surface: cli-schema.json is gitignored and appears only once
      // the testbed's MCP server has started, so smith passes or warns depending on that.
      .replace(/[^\S\n]*(?:✅|Γ£à)[^\n]*tools\.json \+ cli-schema\.json[^\n]*\n/g, "  <capability-surface>\n")
      .replace(/[^\S\n]*(?:⚠️|⚠|ΓÜá∩╕Å)[^\n]*tools\.json or cli-schema\.json missing\n[^\S\n]+FIX:[^\n]*\n/g, "  <capability-surface>\n")
      // Run history: every plan run on the testbed changes these numbers, and the
      // quorum line appears only after a quorum run.
      .replace(/Cost: \$\d+(?:\.\d+)?/g, "Cost: $<n>")
      .replace(/\b\d+ run\(s\) in \.forge\/runs\//g, "<n> run(s) in .forge/runs/")
      .replace(/Model performance: \d+ records/g, "Model performance: <n> records")
      .replace(/LiveGuard memories: \d+ captured/g, "LiveGuard memories: <n> captured")
      .replace(/OpenBrain queue: \d+ thought/g, "OpenBrain queue: <n> thought")
      .replace(/\b\d+ manual-import bypass/g, "<n> manual-import bypass")
      .replace(/[^\S\n]*(?:✅|Γ£à)[^\n]*Quorum history present[^\n]*\n/g, "")
      // Results summary: pass/fail/warning counts vary with environment state
      .replace(/Results:\s+\d+ passed\s*\|\s*\d+ failed\s*\|\s*\d+ warnings/g, "Results: <summary>")
      .replace(/\b\d+ warning\(s\) — review/g, "<n> warning(s) — review")
      // "Fix the N issue(s) above" count varies
      .replace(/Fix the \d+ issue\(s\) above[^\n]*/g, "Fix <n> issue(s) above")
      // Box-drawing characters (U+2500–U+257F) and CP850 mojibake variants
      // The golden may be captured in a different console encoding than the test run;
      // normalise all box-drawing to ASCII dashes/pipes so the structural content
      // is compared rather than the frame decoration.
      .replace(/[─━╔╗╚╝║═╠╣╦╩╬┌┐└┘├┤┬┴┼│\u2500-\u257F]+/g, "<box>")
      // Windows-1252 / CP850 mojibake of the same box chars (ΓòöΓòÉΓòÉ… etc.)
      .replace(/[\u0393\u00F2\u00F6\u00DC\u00C9\u00C7\u00C6\u00C8\u00C4\u00C3\u00BF]+/g, "<box>")
      // Trailing whitespace
      .replace(/ +\n/g, "\n")
  );
}

function runSmith() {
  return spawnSync(
    "pwsh",
    ["-NonInteractive", "-NoProfile", "-File", PFORGE_PS1, "smith"],
    { cwd: TESTBED, encoding: "utf-8", timeout: 150_000 }
  );
}

// Run smith once and share the result across both tests in this file.
// Avoids running pforge.ps1 twice (each invocation takes 15–30 s under load).
const OPTED_IN = process.env.PFORGE_SMITH_GOLDEN === "1";
const canRun = OPTED_IN && isWindows && testbedExists && ps1Exists;
let _smithOutput = null;
function getSmithOutput() {
  if (_smithOutput === null) {
    const result = runSmith();
    // Without this guard a timeout yields null stdout, and the golden comparison
    // reports a content diff instead of the real cause.
    if (result.error) {
      throw new Error(
        `pforge smith did not complete (${result.error.code || result.error.message}) — ` +
          "golden comparison skipped. This test shells out to a full pwsh CLI run, so it " +
          "is the most load-sensitive file in the suite; re-run it in isolation to confirm."
      );
    }
    _smithOutput = (result.stdout || "") + (result.stderr || "");
  }
  return _smithOutput;
}

describe("smith-golden cache normalization", () => {
  const cold = "Version Currency:\n  Up to date (v3.33.0)\n\nAuto-update:\n  disabled\n";

  it("compares cold and warm cache output identically", () => {
    const warm = cold.replace("\n\nAuto-update:", "\n    (cached 12m ago)\n\nAuto-update:");
    expect(normalize(warm)).toBe(normalize(cold));
  });

  it("keeps non-cache diagnostic lines", () => {
    const diagnostic = cold.replace("\n\nAuto-update:", "\n    Warning: package versions disagree\n\nAuto-update:");
    expect(normalize(diagnostic)).toContain("Warning: package versions disagree");
    expect(normalize(diagnostic)).not.toBe(normalize(cold));
  });
});

describe("smith-golden worker normalization", () => {
  // A worker CLI that is on PATH and one that is not are the same structure, whichever machine ran smith.
  const WORKERS = [
    ["claude", "  ⚠️  claude not found on PATH (agent worker)\n     FIX: winget install Anthropic.Claude   (or npm install -g @anthropic-ai/claude-code)\n", "  ✅ claude v2.1.0 (agentic capable)\n"],
    ["grok", "  ⚠️  grok not found on PATH (agent worker)\n     FIX: irm https://x.ai/cli/install.ps1 | iex\n", "  ✅ grok v0.1.2 (agentic capable)\n"],
  ];

  it.each(WORKERS)("collapses %s installed and missing to the same line", (_name, missing, present) => {
    expect(normalize(present)).toBe(normalize(missing));
  });

  it("keeps the other lines around a worker line", () => {
    const text = `Workers:\n${WORKERS[0][2]}  ✅ node v22.12.0\n`;
    expect(normalize(text)).toContain("claude <worker-status>");
    expect(normalize(text)).toContain("node v<version>");
  });
});

describe("smith-golden: pforge smith output stability", () => {
  it.skipIf(!canRun)(
    "smith reports 8/8 lifecycle hooks (PostRun added by Phase-39/41)",
    () => {
      const output = normalize(getSmithOutput());
      expect(output).toMatch(/8\/8 lifecycle hooks present/);
      expect(output).not.toMatch(/Missing hooks:.*PostRun/);
    },
    180_000
  );

  it.skipIf(!canRun)(
    "smith output matches the S2 golden fixture (normalized)",
    () => {
      const goldenRaw = readFileSync(GOLDEN, "utf-8");
      expect(goldenRaw.length, "Golden fixture should be non-empty; save `pforge smith` output from the testbed as tests/fixtures/smith-golden-pre-enums.txt").toBeGreaterThan(100);

      const actual = normalize(getSmithOutput());
      const expected = normalize(goldenRaw);

      expect(actual).toBe(expected);
    },
    180_000
  );
});
