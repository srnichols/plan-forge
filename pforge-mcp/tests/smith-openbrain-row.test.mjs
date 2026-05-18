/**
 * Plan Forge — Phase-OPENBRAIN-PROMOTION Slice 3: forge_smith L3 OpenBrain row.
 *
 * Tests the always-visible "L3 OpenBrain" status line in the Memory section
 * of forge_smith output. The row reports whether OpenBrain is configured in
 * .vscode/mcp.json (or .claude/mcp.json) and never affects the smith exit
 * code — it is informational only.
 *
 * Strategy: replicate the inline detection logic in a local helper (matches
 * the `smith-drain-warning.test.mjs` "extend, do not refactor" pattern), and
 * also assert the production server.mjs contains the row text + uses
 * isOpenBrainConfigured.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Replicate the isOpenBrainConfigured detection logic from memory.mjs.
 * Pure sync, mirrors the production check exactly — no shared helper import.
 */
function isOpenBrainConfiguredLocal(cwd) {
  const mcpConfigPaths = [
    resolve(cwd, ".vscode", "mcp.json"),
    resolve(cwd, ".claude", "mcp.json"),
  ];
  for (const configPath of mcpConfigPaths) {
    try {
      if (existsSync(configPath)) {
        const config = readFileSync(configPath, "utf-8");
        if (config.includes("openbrain") || config.includes("open-brain")) {
          return true;
        }
      }
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * Replicate the Slice 3 L3 status-line construction from server.mjs.
 * Mirrors the inline code exactly — extend-not-refactor pattern.
 */
function computeL3StatusLine(cwd) {
  try {
    const l3Configured = isOpenBrainConfiguredLocal(cwd);
    return l3Configured
      ? `L3 OpenBrain:    \u2713 configured (Reflexion + Federation active)`
      : `L3 OpenBrain:    \u26A0 not configured \u2014 run 'pforge brain hint' or see https://srnichols.github.io/OpenBrain`;
  } catch {
    return `L3 OpenBrain:    (status check failed)`;
  }
}

function seedProject(mcpJsonContent = null, mcpJsonPath = ".vscode/mcp.json") {
  const root = mkdtempSync(join(tmpdir(), "smith-openbrain-"));
  if (mcpJsonContent !== null) {
    const target = resolve(root, mcpJsonPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, mcpJsonContent);
  }
  return root;
}

describe("forge_smith L3 OpenBrain status row (Phase-OPENBRAIN-PROMOTION Slice 3)", () => {
  const temps = [];
  afterEach(() => {
    for (const t of temps) {
      try { rmSync(t, { recursive: true, force: true }); } catch { /* cleanup */ }
    }
    temps.length = 0;
  });

  it("no mcp.json at all \u2192 not-configured warning row", () => {
    const root = seedProject();
    temps.push(root);
    const line = computeL3StatusLine(root);
    expect(line).toContain("\u26A0 not configured");
    expect(line).toContain("pforge brain hint");
    expect(line).toContain("https://srnichols.github.io/OpenBrain");
  });

  it("mcp.json without openbrain entry \u2192 not-configured warning row", () => {
    const config = JSON.stringify({ servers: { "plan-forge": { command: "node" } } });
    const root = seedProject(config);
    temps.push(root);
    const line = computeL3StatusLine(root);
    expect(line).toContain("\u26A0 not configured");
  });

  it("mcp.json with openbrain server \u2192 configured \u2713 row", () => {
    const config = JSON.stringify({
      servers: { openbrain: { command: "node", args: ["openbrain/server.mjs"] } },
    });
    const root = seedProject(config);
    temps.push(root);
    const line = computeL3StatusLine(root);
    expect(line).toContain("\u2713 configured");
    expect(line).toContain("Reflexion + Federation");
    expect(line).not.toContain("\u26A0 not configured");
  });

  it("mcp.json with hyphenated open-brain alias \u2192 configured \u2713 row", () => {
    const config = JSON.stringify({
      servers: { "open-brain": { command: "node" } },
    });
    const root = seedProject(config);
    temps.push(root);
    const line = computeL3StatusLine(root);
    expect(line).toContain("\u2713 configured");
  });

  it(".claude/mcp.json fallback path is checked too", () => {
    const config = JSON.stringify({ servers: { openbrain: { command: "node" } } });
    const root = seedProject(config, ".claude/mcp.json");
    temps.push(root);
    const line = computeL3StatusLine(root);
    expect(line).toContain("\u2713 configured");
  });

  it("malformed mcp.json does not throw \u2014 returns either configured/not-configured deterministically", () => {
    // The detection is a string-include scan, not JSON parse, so malformed
    // JSON containing the word "openbrain" still counts as configured.
    const root = seedProject("{ this is not valid json but mentions openbrain");
    temps.push(root);
    const line = computeL3StatusLine(root);
    expect(line).toContain("\u2713 configured");
  });

  // ─── Production-source guards ───
  // These tests pin the runtime text to what the docs/CLI advertise. If the
  // production strings drift, the tests break loudly. Mirrors the pattern
  // used by smith-drain-warning.test.mjs.

  it("server.mjs imports isOpenBrainConfigured at module scope", () => {
    const serverSrc = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
    expect(serverSrc).toContain("isOpenBrainConfigured,");
  });

  it("server.mjs Memory section includes the L3 OpenBrain status line", () => {
    const serverSrc = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
    expect(serverSrc).toContain("L3 OpenBrain:");
    expect(serverSrc).toContain("\u2713 configured (Reflexion + Federation active)");
    expect(serverSrc).toContain("\u26A0 not configured");
  });

  it("server.mjs references pforge brain hint in the not-configured row", () => {
    const serverSrc = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
    expect(serverSrc).toContain("pforge brain hint");
  });

  it("server.mjs references the OpenBrain install URL", () => {
    const serverSrc = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
    expect(serverSrc).toContain("https://srnichols.github.io/OpenBrain");
  });
});
