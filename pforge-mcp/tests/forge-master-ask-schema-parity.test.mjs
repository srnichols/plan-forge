import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TOOLS } from "../server/tool-definitions.mjs";
import { TOOL_METADATA } from "../capabilities/tool-metadata.mjs";
import { _buildForgeMasterTurnInput } from "../server/tool-handlers/platform.mjs";
import { normalizeTurnInput } from "../../pforge-master/src/turn-input.mjs";
import { validateProposals } from "../../pforge-master/src/proposed-actions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const masterServerSource = readFileSync(join(__dirname, "../../pforge-master/server.mjs"), "utf8");

function extractMasterAskBlock() {
  const start = masterServerSource.indexOf("const FORGE_MASTER_ASK_TOOL = {");
  const end = masterServerSource.indexOf("const FORGE_MASTER_OBSERVE_TOOL", start);
  if (start < 0 || end < 0) throw new Error("unable to locate forge_master_ask schema block");
  return masterServerSource.slice(start, end);
}

function extractPropertyNames(schemaBlock) {
  const propertiesBlock = schemaBlock.match(/properties:\s*\{([\s\S]*?)\n\s{4}\},\s*\n\s{4}required:/)?.[1];
  if (!propertiesBlock) throw new Error("unable to locate forge_master_ask properties");
  return [...propertiesBlock.matchAll(/^[ ]{6}([A-Za-z]\w*):\s*\{/gm)].map((match) => match[1]);
}

function extractEnum(schemaBlock, property) {
  const match = schemaBlock.match(new RegExp(`${property}:\\s*\\{[^}]*enum:\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`unable to locate ${property} enum in forge_master_ask schema`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

describe("Guard: both forge_master_ask schemas declare the same properties", () => {
  it("keeps property names and enum arrays identical", () => {
    const mcpSchema = TOOLS.find((tool) => tool.name === "forge_master_ask")?.inputSchema;
    expect(mcpSchema).toBeTruthy();
    const masterBlock = extractMasterAskBlock();
    const mcpNames = Object.keys(mcpSchema.properties).sort();
    const masterNames = extractPropertyNames(masterBlock).sort();
    expect(masterNames.length).toBeGreaterThanOrEqual(9);
    expect(masterNames).toEqual(mcpNames);

    const enumPairs = [
      ["role", ["caller", "properties"]],
      ["channel", ["caller", "properties"]],
      ["style", ["responseFormat", "properties"]],
      ["kind", ["untrustedContext", "items", "properties"]],
    ];
    for (const [property, parents] of enumPairs) {
      const masterEnum = extractEnum(masterBlock, property);
      const mcpEnum = parents.reduce((value, key) => value[key], mcpSchema.properties)[property].enum;
      expect(masterEnum).toEqual(mcpEnum);
    }
  });
});

describe("Guard: forge_master_ask metadata matches the opt-in contract", () => {
  const { input, output } = TOOL_METADATA.forge_master_ask.example;

  it("documents every optional input with a valid example", () => {
    for (const field of ["caller", "responseFormat", "untrustedContext", "contextBlocks", "proposeActions"]) {
      expect(Object.hasOwn(input, field), field).toBe(true);
    }
    expect(input.proposeActions).toBe(true);
    expect(input.untrustedContext).toHaveLength(1);
    expect(input.contextBlocks).toHaveLength(1);
    expect(normalizeTurnInput(input).ok).toBe(true);
  });

  it("documents opt-in truncation and valid, untrusted action proposals", () => {
    expect(output.truncated).toEqual({ budget: false, reply: false, context: false, untrusted: false });
    expect(output.proposedActions).toHaveLength(1);
    const validated = validateProposals(output.proposedActions, {
      role: input.caller.role,
      projectId: input.caller.projectId,
      untrusted: true,
    });
    expect(validated.dropped).toBe(0);
    expect(validated.actions).toEqual(output.proposedActions);
    expect(output.proposedActionsMessage).toContain("Forge-Master does not execute them");
  });
});

describe("_buildForgeMasterTurnInput", () => {
  const legacyArgs = { message: "hello", sessionId: "session-1", maxToolCalls: 4 };
  const prefs = { tier: "high" };
  const cwd = "C:\\workspace";

  it("forwards all new fields and preserves the legacy fields", () => {
    const args = {
      ...legacyArgs,
      caller: { role: "owner", channel: "chat" },
      responseFormat: { style: "brief", maxChars: 1000 },
      untrustedContext: [],
      contextBlocks: [],
      proposeActions: false,
    };
    expect(_buildForgeMasterTurnInput(args, prefs, cwd)).toEqual({
      message: legacyArgs.message,
      sessionId: legacyArgs.sessionId,
      maxToolCalls: legacyArgs.maxToolCalls,
      tier: prefs.tier,
      cwd,
      caller: args.caller,
      responseFormat: args.responseFormat,
      untrustedContext: [],
      contextBlocks: [],
      proposeActions: false,
    });
  });

  it("leaves absent fields absent", () => {
    const result = _buildForgeMasterTurnInput(legacyArgs, prefs, cwd);
    for (const field of ["caller", "responseFormat", "untrustedContext", "contextBlocks", "proposeActions"]) {
      expect(Object.hasOwn(result, field)).toBe(false);
    }
    expect(result).toEqual({
      message: legacyArgs.message,
      sessionId: legacyArgs.sessionId,
      maxToolCalls: legacyArgs.maxToolCalls,
      tier: prefs.tier,
      cwd,
    });
  });

  it("preserves explicit false and empty arrays", () => {
    const result = _buildForgeMasterTurnInput({
      ...legacyArgs,
      proposeActions: false,
      untrustedContext: [],
      contextBlocks: [],
    }, prefs, cwd);
    expect(result.proposeActions).toBe(false);
    expect(result.untrustedContext).toEqual([]);
    expect(result.contextBlocks).toEqual([]);
  });
});
