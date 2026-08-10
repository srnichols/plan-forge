import { describe, it, expect } from "vitest";
import { TOOL_METADATA, WORKFLOWS, CLI_SCHEMA, CONFIG_SCHEMA } from "../capabilities.mjs";
import { TOOL_NAMES } from "../enums.mjs";
import { SUPPORTED_AGENTS } from "../orchestrator.mjs";

// ─── TOOL_METADATA ────────────────────────────────────────────────────

describe("TOOL_METADATA", () => {
  const REQUIRED_TOOLS = [
    "forge_smith",
    "forge_validate",
    "forge_sweep",
    "forge_status",
    "forge_diff",
    "forge_run_plan",
    "forge_analyze",
    "forge_new_phase",
    "forge_capabilities",
    "forge_drift_report",
  ];

  it("defines all required tool entries", () => {
    for (const tool of REQUIRED_TOOLS) {
      expect(TOOL_METADATA, `Missing tool: ${tool}`).toHaveProperty(tool);
    }
  });

  // Drift guard (#240). buildCapabilityTools() enriches via
  // `TOOL_METADATA[tool.name] || {}`, and writeToolsJson() runs on every server
  // boot — so a tool without an entry silently loses all of its metadata from
  // tools.json on the next `node server.mjs --validate`. Assert both directions.
  it("has an entry for every name in TOOL_NAMES", () => {
    const missing = TOOL_NAMES.filter((name) => !(name in TOOL_METADATA));
    expect(
      missing,
      `TOOL_NAMES entries with no TOOL_METADATA (their metadata is stripped from tools.json on every server boot): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("has no entry that is absent from TOOL_NAMES", () => {
    const canonical = new Set(TOOL_NAMES);
    const stale = Object.keys(TOOL_METADATA).filter((name) => !canonical.has(name));
    expect(
      stale,
      `TOOL_METADATA entries for names not in TOOL_NAMES (stale metadata): ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("each tool has intent array", () => {
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(Array.isArray(meta.intent), `${name}.intent must be array`).toBe(true);
    }
  });

  it("each tool has cost field", () => {
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(meta.cost, `${name}.cost missing`).toBeDefined();
    }
  });

  it("each tool has prerequisites array", () => {
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(Array.isArray(meta.prerequisites), `${name}.prerequisites must be array`).toBe(true);
    }
  });

  it("each tool has addedIn version string", () => {
    for (const [name, meta] of Object.entries(TOOL_METADATA)) {
      expect(typeof meta.addedIn, `${name}.addedIn must be string`).toBe("string");
    }
  });

  it("forge_smith has correct cost level", () => {
    expect(TOOL_METADATA.forge_smith.cost).toBe("low");
  });

  it("forge_run_plan is defined", () => {
    expect(TOOL_METADATA.forge_run_plan).toBeDefined();
  });
});

// ─── WORKFLOWS ────────────────────────────────────────────────────────

describe("WORKFLOWS", () => {
  it("is a non-empty object", () => {
    expect(typeof WORKFLOWS).toBe("object");
    expect(Object.keys(WORKFLOWS).length).toBeGreaterThan(0);
  });

  it("each workflow has a steps array", () => {
    for (const [name, wf] of Object.entries(WORKFLOWS)) {
      expect(Array.isArray(wf.steps), `${name}.steps must be array`).toBe(true);
    }
  });
});

// ─── CLI_SCHEMA ───────────────────────────────────────────────────────

describe("CLI_SCHEMA", () => {
  it("has commands object", () => {
    expect(typeof CLI_SCHEMA.commands).toBe("object");
    expect(Object.keys(CLI_SCHEMA.commands).length).toBeGreaterThan(0);
  });

  it("each command has description", () => {
    for (const [name, cmd] of Object.entries(CLI_SCHEMA.commands)) {
      expect(typeof cmd.description, `${name}.description must be string`).toBe("string");
    }
  });

  it("includes forge smith command", () => {
    expect(CLI_SCHEMA.commands).toHaveProperty("smith");
  });
});

// ─── CONFIG_SCHEMA ────────────────────────────────────────────────────

describe("CONFIG_SCHEMA", () => {
  it("has properties object", () => {
    expect(typeof CONFIG_SCHEMA.properties).toBe("object");
    expect(Object.keys(CONFIG_SCHEMA.properties).length).toBeGreaterThan(0);
  });

  it("each property has a type", () => {
    for (const [key, prop] of Object.entries(CONFIG_SCHEMA.properties)) {
      expect(prop.type, `${key}.type missing`).toBeDefined();
    }
  });
});

// ─── SUPPORTED_AGENTS (cross-module contract) ─────────────────────────

describe("SUPPORTED_AGENTS contract", () => {
  it("does not contain duplicates", () => {
    const unique = new Set(SUPPORTED_AGENTS);
    expect(unique.size).toBe(SUPPORTED_AGENTS.length);
  });

  it("all entries are lowercase strings", () => {
    for (const agent of SUPPORTED_AGENTS) {
      expect(typeof agent).toBe("string");
      expect(agent).toBe(agent.toLowerCase());
    }
  });
});
