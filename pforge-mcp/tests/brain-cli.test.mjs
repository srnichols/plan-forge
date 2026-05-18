/**
 * Plan Forge — Phase-OPENBRAIN-PROMOTION Slice 5: pforge brain CLI.
 *
 * Validates the `brain status` and `brain hint` subcommands across:
 *   - pforge.ps1   (Invoke-Brain / Invoke-BrainStatus / Invoke-BrainHint)
 *   - pforge.sh    (cmd_brain / cmd_brain_status / cmd_brain_hint)
 *   - cli-schema.json (brain entry with subcommand arg + --ping flag)
 *
 * Pattern matches smith-openbrain-row.test.mjs: source-text guards rather
 * than runtime execution (the CLI scripts shell out to MCP and have a large
 * startup cost — pinning source patterns catches drift more cheaply).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const psScript = readFileSync(resolve(repoRoot, "pforge.ps1"), "utf-8");
const bashScript = readFileSync(resolve(repoRoot, "pforge.sh"), "utf-8");
const cliSchema = JSON.parse(readFileSync(resolve(repoRoot, "pforge-mcp", "cli-schema.json"), "utf-8"));

describe("pforge.ps1 brain subcommand (Phase-OPENBRAIN-PROMOTION Slice 5)", () => {
  it("defines Invoke-Brain dispatcher", () => {
    expect(psScript).toMatch(/function Invoke-Brain \{/);
  });

  it("defines Invoke-BrainStatus and Invoke-BrainHint", () => {
    expect(psScript).toMatch(/function Invoke-BrainStatus \{/);
    expect(psScript).toMatch(/function Invoke-BrainHint \{/);
  });

  it("defines Test-OpenBrainConfigured helper that mirrors memory.mjs detection", () => {
    expect(psScript).toMatch(/function Test-OpenBrainConfigured/);
    expect(psScript).toContain(".vscode/mcp.json");
    expect(psScript).toContain(".claude/mcp.json");
    expect(psScript).toContain("openbrain");
    expect(psScript).toContain("open-brain");
  });

  it("wires 'brain' into the top-level command dispatcher", () => {
    expect(psScript).toMatch(/'brain'\s+\{\s+Invoke-Brain\s+\}/);
  });

  it("supports --ping as an opt-in flag (default is local-only)", () => {
    expect(psScript).toContain("--ping");
    // Negative: --ping must not be the default. The flag presence in
    // $Arguments triggers it; absence means local-only.
    expect(psScript).toMatch(/\$doPing = \(\$Arguments -contains '--ping'\)/);
  });

  it("brain status prints ✓/⚠ based on configured state (never throws)", () => {
    expect(psScript).toContain("✓ OpenBrain detected");
    expect(psScript).toContain("⚠ OpenBrain NOT configured");
  });

  it("brain hint prints the 4 deploy options + URL + 'pforge brain status' callout", () => {
    expect(psScript).toContain("Docker Compose");
    expect(psScript).toContain("Supabase Cloud");
    expect(psScript).toContain("Kubernetes / Azure");
    expect(psScript).toContain("https://srnichols.github.io/OpenBrain");
    expect(psScript).toContain("https://github.com/srnichols/OpenBrain");
    expect(psScript).toContain("After installing, run 'pforge brain status'");
  });

  it("unknown subcommand prints usage + exits 1 (never silent)", () => {
    expect(psScript).toMatch(/Usage: pforge brain <subcommand>/);
    expect(psScript).toMatch(/status \[--ping\]/);
  });
});

describe("pforge.sh brain subcommand (Phase-OPENBRAIN-PROMOTION Slice 5)", () => {
  it("defines cmd_brain dispatcher", () => {
    expect(bashScript).toMatch(/cmd_brain\(\) \{/);
  });

  it("defines cmd_brain_status and cmd_brain_hint", () => {
    expect(bashScript).toMatch(/cmd_brain_status\(\) \{/);
    expect(bashScript).toMatch(/cmd_brain_hint\(\) \{/);
  });

  it("defines _test_openbrain_configured helper that mirrors memory.mjs detection", () => {
    expect(bashScript).toMatch(/_test_openbrain_configured\(\) \{/);
    expect(bashScript).toContain(".vscode/mcp.json");
    expect(bashScript).toContain(".claude/mcp.json");
    expect(bashScript).toMatch(/grep -qE 'openbrain\|open-brain'/);
  });

  it("wires 'brain' into the top-level case statement", () => {
    expect(bashScript).toMatch(/brain\)\s+cmd_brain "\$@"/);
  });

  it("supports --ping as an opt-in flag (default is local-only)", () => {
    expect(bashScript).toContain("--ping");
    expect(bashScript).toMatch(/do_ping=false/);
    expect(bashScript).toMatch(/if \[ "\$arg" = "--ping" \]/);
  });

  it("brain status prints ✓/⚠ based on configured state (never throws)", () => {
    expect(bashScript).toContain("✓ OpenBrain detected");
    expect(bashScript).toContain("⚠ OpenBrain NOT configured");
  });

  it("brain hint prints the 4 deploy options + URL + 'pforge brain status' callout (text parity with PS)", () => {
    expect(bashScript).toContain("Docker Compose");
    expect(bashScript).toContain("Supabase Cloud");
    expect(bashScript).toContain("Kubernetes / Azure");
    expect(bashScript).toContain("https://srnichols.github.io/OpenBrain");
    expect(bashScript).toContain("https://github.com/srnichols/OpenBrain");
    expect(bashScript).toContain("After installing, run 'pforge brain status'");
  });

  it("unknown subcommand prints usage + exits 1 (never silent)", () => {
    expect(bashScript).toContain("Usage: pforge brain <subcommand>");
    expect(bashScript).toMatch(/status \[--ping\]/);
  });
});

describe("cli-schema.json brain entry (Phase-OPENBRAIN-PROMOTION Slice 5)", () => {
  it("has a 'brain' command", () => {
    expect(cliSchema.commands).toHaveProperty("brain");
  });

  it("brain command description mentions OpenBrain and L3", () => {
    expect(cliSchema.commands.brain.description).toMatch(/OpenBrain/);
    expect(cliSchema.commands.brain.description).toMatch(/L3/);
  });

  it("brain command declares the subcommand arg", () => {
    expect(cliSchema.commands.brain.args).toHaveLength(1);
    expect(cliSchema.commands.brain.args[0].name).toBe("subcommand");
    expect(cliSchema.commands.brain.args[0].required).toBe(true);
  });

  it("brain command declares the --ping flag", () => {
    expect(cliSchema.commands.brain.flags).toHaveProperty("--ping");
    expect(cliSchema.commands.brain.flags["--ping"].type).toBe("boolean");
  });

  it("brain command includes status, status --ping, and hint examples", () => {
    expect(cliSchema.commands.brain.examples).toContain("pforge brain status");
    expect(cliSchema.commands.brain.examples).toContain("pforge brain status --ping");
    expect(cliSchema.commands.brain.examples).toContain("pforge brain hint");
  });
});

describe("brain hint parity with setup wizard Y branch", () => {
  // Plan invariant: 'pforge brain hint' must print the same content as the
  // setup wizard Y branch. This is the single source of truth for install copy.
  const setupPs = readFileSync(resolve(repoRoot, "setup.ps1"), "utf-8");
  const setupSh = readFileSync(resolve(repoRoot, "setup.sh"), "utf-8");

  const sharedPhrases = [
    "Recommended: Enable Persistent Memory (OpenBrain)",
    "OpenBrain deploy options:",
    "Docker Compose       ~5 min   Free                Local dev / single machine",
    "Kubernetes / Azure   ~30 min  Cloud rates         Teams, federation across repos",
    "Full walkthrough:  https://srnichols.github.io/OpenBrain",
    "After installing, run 'pforge brain status' to confirm Plan Forge sees it.",
  ];

  for (const phrase of sharedPhrases) {
    it(`all 4 surfaces share: ${phrase.slice(0, 60)}${phrase.length > 60 ? "..." : ""}`, () => {
      expect(psScript).toContain(phrase);
      expect(bashScript).toContain(phrase);
      expect(setupPs).toContain(phrase);
      expect(setupSh).toContain(phrase);
    });
  }
});
