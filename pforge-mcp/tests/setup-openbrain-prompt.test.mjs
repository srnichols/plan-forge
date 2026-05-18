/**
 * Plan Forge — Phase-OPENBRAIN-PROMOTION Slice 4: setup wizard OpenBrain prompt.
 *
 * Source-text guards for setup.ps1 and setup.sh. The setup scripts ship as the
 * single most-touched user-facing surface; we pin the gate logic + prompt text
 * to source patterns so accidental refactors (e.g. dropping a CI gate) break
 * the test loudly rather than escaping to a consumer install.
 *
 * No runtime execution of the setup scripts — too expensive and side-effecty.
 * Instead we assert the scripts contain the required identifiers, gates, and
 * branching keywords.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const psScript = readFileSync(resolve(repoRoot, "setup.ps1"), "utf-8");
const bashScript = readFileSync(resolve(repoRoot, "setup.sh"), "utf-8");

describe("setup.ps1 OpenBrain prompt (Phase-OPENBRAIN-PROMOTION Slice 4)", () => {
  it("declares the -NonInteractive switch in param()", () => {
    expect(psScript).toMatch(/\[switch\]\$NonInteractive/);
  });

  it("gates the prompt on $NonInteractive, $env:CI, $env:PFORGE_NONINTERACTIVE, and Host RawUI", () => {
    expect(psScript).toContain("$skipOpenBrainPrompt");
    expect(psScript).toContain("$NonInteractive");
    expect(psScript).toContain("$env:CI");
    expect(psScript).toContain("$env:PFORGE_NONINTERACTIVE");
    expect(psScript).toContain("$Host.UI.RawUI");
  });

  it("wraps Read-Host in try/catch so non-interactive hosts cannot crash setup", () => {
    expect(psScript).toMatch(/try \{ Read-Host "Show me OpenBrain install options\? \[Y\/n\/skip\]" \} catch \{ "skip" \}/);
  });

  it("prints the four deploy options in the Y branch", () => {
    expect(psScript).toContain("Docker Compose");
    expect(psScript).toContain("Supabase Cloud");
    expect(psScript).toContain("Kubernetes / Azure");
  });

  it("references the OpenBrain install URL and source repo", () => {
    expect(psScript).toContain("https://srnichols.github.io/OpenBrain");
    expect(psScript).toContain("https://github.com/srnichols/OpenBrain");
  });

  it("points to 'pforge brain status' and 'pforge brain hint' for follow-up", () => {
    expect(psScript).toContain("pforge brain status");
    expect(psScript).toContain("pforge brain hint");
  });

  it("the prompt block sits BEFORE 'Running validation...' (so validation still runs even if user skips)", () => {
    const promptIdx = psScript.indexOf("$skipOpenBrainPrompt");
    const validateIdx = psScript.indexOf('"Running validation..."');
    expect(promptIdx).toBeGreaterThan(0);
    expect(validateIdx).toBeGreaterThan(promptIdx);
  });
});

describe("setup.sh OpenBrain prompt (Phase-OPENBRAIN-PROMOTION Slice 4)", () => {
  it("declares the NON_INTERACTIVE=false default (set -u safety)", () => {
    expect(bashScript).toMatch(/^NON_INTERACTIVE=false/m);
  });

  it("parses --non-interactive in the arg loop", () => {
    expect(bashScript).toContain("--non-interactive) NON_INTERACTIVE=true");
  });

  it("documents --non-interactive in the --help usage line", () => {
    expect(bashScript).toMatch(/Usage:.*--non-interactive/);
  });

  it("gates the prompt on NON_INTERACTIVE, CI, PFORGE_NONINTERACTIVE, and stdin TTY", () => {
    expect(bashScript).toContain(
      `if [[ "$NON_INTERACTIVE" == "true" ]] || [[ -n "\${CI:-}" ]] || [[ -n "\${PFORGE_NONINTERACTIVE:-}" ]] || [[ ! -t 0 ]]; then`
    );
  });

  it("read fallback initializes OB_RESP so 'set -u' cannot crash on closed stdin", () => {
    expect(bashScript).toContain('OB_RESP=""');
    expect(bashScript).toContain('read -rp "Show me OpenBrain install options? [Y/n/skip]: " OB_RESP || OB_RESP="skip"');
  });

  it("uses portable tr-based lowercasing (NOT bash-4-only ${VAR,,})", () => {
    expect(bashScript).toContain(`OB_RESP_LC="$(printf '%s' "$OB_RESP" | tr '[:upper:]' '[:lower:]')"`);
    // Negative guard: the bash-4 syntax should NOT have crept back in.
    expect(bashScript).not.toContain("${OB_RESP,,}");
  });

  it("prints the four deploy options in the Y branch (text identical to PS script)", () => {
    expect(bashScript).toContain("Docker Compose");
    expect(bashScript).toContain("Supabase Cloud");
    expect(bashScript).toContain("Kubernetes / Azure");
  });

  it("references the OpenBrain install URL and source repo", () => {
    expect(bashScript).toContain("https://srnichols.github.io/OpenBrain");
    expect(bashScript).toContain("https://github.com/srnichols/OpenBrain");
  });

  it("points to 'pforge brain status' and 'pforge brain hint' for follow-up", () => {
    expect(bashScript).toContain("pforge brain status");
    expect(bashScript).toContain("pforge brain hint");
  });

  it("the prompt block sits BEFORE 'Running validation...' (so validation still runs even if user skips)", () => {
    const promptIdx = bashScript.indexOf("NON_INTERACTIVE");
    const validateIdx = bashScript.indexOf('cyan "Running validation..."');
    expect(promptIdx).toBeGreaterThan(0);
    expect(validateIdx).toBeGreaterThan(promptIdx);
  });
});

describe("setup script parity (Phase-OPENBRAIN-PROMOTION Slice 4 forbidden-actions invariant)", () => {
  // The plan's Forbidden Actions require the prompt copy to be identical
  // between PS and bash so consumers on either OS get the same wording.
  const keyPhrases = [
    "Recommended: Enable Persistent Memory (OpenBrain)",
    "Plan Forge ships with L1 (Hub) + L2 (.forge/*.jsonl) memory.",
    "The L3 layer",
    "OpenBrain, a self-hosted MCP server.",
    "but the inner loop only improves over time when L3 is present.",
    "Show me OpenBrain install options?",
    "OpenBrain deploy options:",
    "Docker Compose       ~5 min   Free                Local dev / single machine",
    "Supabase Cloud       ~10 min",
    "Kubernetes / Azure   ~30 min  Cloud rates         Teams, federation across repos",
    "Full walkthrough:  https://srnichols.github.io/OpenBrain",
    "Source repo:       https://github.com/srnichols/OpenBrain",
    "After installing, run 'pforge brain status' to confirm Plan Forge sees it.",
    "Skipping. Reflexion / Auto-skills / Federation will be inert. Re-enable anytime with 'pforge brain hint'.",
  ];

  for (const phrase of keyPhrases) {
    it(`both scripts contain: ${phrase.slice(0, 60)}${phrase.length > 60 ? "..." : ""}`, () => {
      expect(psScript).toContain(phrase);
      expect(bashScript).toContain(phrase);
    });
  }
});
