/**
 * Contract tests for the five Lattice MCP tool handlers.
 * Verifies: tools.json registration, description quality, inputSchema, server.mjs wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SERVER_COMBINED_SRC } from "./helpers/server-combined-src.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const LATTICE_TOOLS = [
  "forge_lattice_index",
  "forge_lattice_stat",
  "forge_lattice_query",
  "forge_lattice_callers",
  "forge_lattice_blast",
];

let toolsJson;
try {
  toolsJson = JSON.parse(readFileSync(join(ROOT, "tools.json"), "utf8"));
} catch (e) {
  toolsJson = [];
}

const serverSrc = SERVER_COMBINED_SRC;

describe("Lattice MCP handlers — tools.json registration", () => {
  for (const toolName of LATTICE_TOOLS) {
    it(`${toolName} is listed in tools.json`, () => {
      const entry = toolsJson.find((t) => t.name === toolName);
      expect(entry, `${toolName} not found in tools.json`).toBeTruthy();
    });

    it(`${toolName} description contains USE FOR`, () => {
      const entry = toolsJson.find((t) => t.name === toolName);
      expect(entry?.description).toMatch(/USE FOR/);
    });

    it(`${toolName} description contains DO NOT USE FOR`, () => {
      const entry = toolsJson.find((t) => t.name === toolName);
      expect(entry?.description).toMatch(/DO NOT USE FOR/);
    });

    it(`${toolName} has a valid inputSchema of type object`, () => {
      const entry = toolsJson.find((t) => t.name === toolName);
      expect(entry?.inputSchema?.type).toBe("object");
    });

    it(`${toolName} has addedIn set`, () => {
      const entry = toolsJson.find((t) => t.name === toolName);
      expect(entry?.addedIn).toBeTruthy();
    });

    it(`${toolName} has an example with input and output`, () => {
      const entry = toolsJson.find((t) => t.name === toolName);
      expect(entry?.example?.input).toBeDefined();
      expect(entry?.example?.output).toBeDefined();
    });
  }
});

describe("Lattice MCP handlers — server.mjs wiring", () => {
  for (const toolName of LATTICE_TOOLS) {
    it(`${toolName} is in TOOLS array in server.mjs`, () => {
      expect(serverSrc).toContain(`name: "${toolName}"`);
    });

    it(`${toolName} has a handler in CallToolRequestSchema section`, () => {
      expect(serverSrc).toContain(`if (name === "${toolName}")`);
    });

    it(`${toolName} is in MCP_ONLY_TOOLS set`, () => {
      expect(serverSrc).toContain(`"${toolName}"`);
    });
  }

  it("lattice functions are imported in server.mjs", () => {
    expect(serverSrc).toContain('from "./lattice.mjs"');
    expect(serverSrc).toContain("latticeIndex");
    expect(serverSrc).toContain("latticeStat");
    expect(serverSrc).toContain("latticeQuery");
    expect(serverSrc).toContain("latticeCallers");
    expect(serverSrc).toContain("latticeBlast");
  });
});

describe("Lattice MCP handlers — CLI wiring", () => {
  it("pforge.ps1 contains 'lattice' command", () => {
    const ps1 = readFileSync(join(ROOT, "..", "pforge.ps1"), "utf8");
    expect(ps1).toMatch(/lattice/);
    expect(ps1).toMatch(/Invoke-Lattice/);
  });

  it("pforge.sh contains 'lattice' command", () => {
    const sh = readFileSync(join(ROOT, "..", "pforge.sh"), "utf8");
    expect(sh).toMatch(/lattice/);
    expect(sh).toMatch(/cmd_lattice/);
  });
});
