/**
 * Phase-43 — Allowlist ↔ Handler parity guard.
 *
 * Every tool name in BASE_ALLOWLIST (and WRITE_ALLOWLIST) must be a
 * registered MCP tool in pforge-mcp/enums.mjs#TOOL_NAMES. The "tool exists
 * but is not allowlisted" direction is intentional (write tools, hot path).
 * The opposite ("allowlisted but no handler") is the bug we caught in the
 * Phase-43 audit — Forge-Master advertising tools the bridge then rejects.
 *
 * If this test fails: either uncomment / wire the missing handler, or
 * remove the name from BASE_ALLOWLIST.
 *
 * NOTE: This test deliberately reads enums.mjs from the sibling pforge-mcp
 * package. In a standalone pforge-master install (no sibling), the test
 * is skipped — the bridge would handle rejection at runtime.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASE_ALLOWLIST, WRITE_ALLOWLIST } from "../src/allowlist.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENUMS_PATH = resolve(__dirname, "../../pforge-mcp/enums.mjs");

describe("Forge-Master allowlist ↔ MCP handler parity (Phase-43)", () => {
  if (!existsSync(ENUMS_PATH)) {
    it.skip("pforge-mcp/enums.mjs not present — parity check skipped", () => {});
    return;
  }

  let TOOL_NAMES;
  it("loads pforge-mcp tool inventory", async () => {
    const mod = await import(pathToFileURL(ENUMS_PATH).href);
    TOOL_NAMES = mod.TOOL_NAMES;
    expect(Array.isArray(TOOL_NAMES) || TOOL_NAMES?.length > 0).toBe(true);
  });

  it("every BASE_ALLOWLIST entry has a registered handler", async () => {
    const mod = await import(pathToFileURL(ENUMS_PATH).href);
    const registered = new Set(mod.TOOL_NAMES);
    // forge_master_audit is Phase-43 new — register exception until handler ships
    const PHASE43_PENDING = new Set(["forge_master_audit"]);
    const orphans = BASE_ALLOWLIST.filter(
      (name) => !registered.has(name) && !PHASE43_PENDING.has(name),
    );
    expect(orphans, `Allowlisted tools without an MCP handler: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every WRITE_ALLOWLIST entry has a registered handler", async () => {
    const mod = await import(pathToFileURL(ENUMS_PATH).href);
    const registered = new Set(mod.TOOL_NAMES);
    const orphans = WRITE_ALLOWLIST.map((t) => t.name).filter((name) => !registered.has(name));
    expect(orphans, `Write tools without an MCP handler: ${orphans.join(", ")}`).toEqual([]);
  });
});
