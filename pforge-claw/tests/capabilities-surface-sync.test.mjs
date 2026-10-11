import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../src/commands/index.mjs";

// pforge-mcp may not import pforge-claw (package boundary), so its capability surface carries a
// hand-maintained copy of the chat command list. Read it as text and fail on drift.
const SURFACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "pforge-mcp", "capabilities", "surface.mjs");
const ENTRY = /\{\s*name:\s*"([\w-]+)",\s*summary:\s*"[^"]*",\s*roles:\s*\[([^\]]*)\],\s*scope:\s*"(\w+)",\s*mutating:\s*(true|false),\s*available:\s*(true|false)\s*\}/g;

function surfaceCommands() {
  const text = readFileSync(SURFACE, "utf8");
  const start = text.indexOf("const chatCommands = [");
  const end = text.indexOf("].map(", start);
  const block = text.slice(start, end);
  return [...block.matchAll(ENTRY)].map(([, name, roles, scope, mutating, available]) => ({
    name,
    roles: [...roles.matchAll(/"(\w+)"/g)].map((match) => match[1]).sort(),
    scope,
    mutating: mutating === "true",
    available: available === "true",
  }));
}

describe("Guard: pforge-mcp capability surface lists the live Forge-Claw chat commands", () => {
  it("matches name, roles, scope, mutating and available for every registered command", () => {
    const listed = surfaceCommands();
    expect(listed.length).toBeGreaterThan(0);
    const expected = COMMANDS.map(({ name, roles, scope, mutating, available }) => ({
      name, roles: [...roles].sort(), scope, mutating, available,
    }));
    const byName = (left, right) => left.name.localeCompare(right.name);
    expect([...listed].sort(byName)).toEqual([...expected].sort(byName));
  });
});
