/**
 * #415 — docs/.well-known/plan-forge.json describes the release it was written for.
 *
 * The site publishes it at /.well-known/plan-forge.json as the machine-readable capability surface. It was
 * written by hand for 2.35.0 and said 43 tools, 19 agents and 14 dashboard tabs while the server registers 107
 * tools. Nothing generated it and nothing tested it. scripts/generate-well-known.mjs now derives what code can
 * verify (the version, the tool count and names, the preset count), sync-versions keeps the version in step at
 * release, and the file states no count that nothing checks: agents, skills, prompts, dashboard tabs and models
 * change with each release, so the forge_capabilities tool is the source for them.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDescriptor } from "../../scripts/generate-well-known.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESCRIPTOR = "docs/.well-known/plan-forge.json";
const SCRIPT = join(REPO, "scripts", "generate-well-known.mjs");
const INPUTS = ["VERSION", "pforge-mcp/tools.json", "pforge-mcp/preset-catalog.json", DESCRIPTOR];

/** The counts the descriptor may state: each is derived from code or equals the length of a list beside it. */
const VERIFIED_COUNTS = ["mcp_tools", "presets", "pipeline_steps", "sessions"];

/** Claims the hand-written file made that nothing kept current (some were prose, such as "15-18 per preset"). */
const RETIRED_KEYS = [
  "mcp_tools_core", "mcp_tools_liveguard", "mcp_tools_watcher", "mcp_tools_crucible", "agents", "skills",
  "instruction_files", "prompt_templates", "dashboard_tabs", "ai_models_supported", "openbrain_auto_capture_tools",
];

const readText = (relative) => readFileSync(join(REPO, relative), "utf8");
const readJson = (relative) => JSON.parse(readText(relative));
const lf = (text) => text.replace(/\r\n/g, "\n");

describe("the published descriptor", () => {
  const descriptor = readJson(DESCRIPTOR);

  it("is what the generator derives from the repository", () => {
    expect(lf(renderDescriptor(REPO))).toBe(lf(readText(DESCRIPTOR)));
  });

  it("is the version of this checkout", () => {
    expect(descriptor.version).toBe(readText("VERSION").trim());
  });

  it("lists exactly the tools the server registers, and counts them", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const registered = TOOLS.map((tool) => tool.name).sort();
    expect([...descriptor.mcp_tools].sort()).toEqual(registered);
    expect(descriptor.capabilities.mcp_tools).toBe(registered.length);
    expect(descriptor.description).toContain(`${registered.length} MCP tools`);
  });

  it("names the presets the catalog ships, except custom, and counts them", () => {
    const shipped = Object.keys(readJson("pforge-mcp/preset-catalog.json").presets).filter((name) => name !== "custom").sort();
    expect(descriptor.presets.map((preset) => preset.name).sort()).toEqual(shipped);
    expect(descriptor.capabilities.presets).toBe(shipped.length);
  });

  it("counts its pipeline steps", () => {
    expect(descriptor.capabilities.pipeline_steps).toBe(descriptor.pipeline_steps.length);
  });

  it("states no count that nothing verifies", () => {
    const counts = Object.entries(descriptor.capabilities).filter(([, value]) => typeof value === "number").map(([key]) => key);
    expect(counts.filter((key) => !VERIFIED_COUNTS.includes(key)), "counts that nothing keeps current").toEqual([]);
    expect(Object.keys(descriptor.capabilities).filter((key) => RETIRED_KEYS.includes(key)), "claims that went stale before").toEqual([]);
    expect(descriptor.description).not.toMatch(/\b\d+\s+(?:reviewer\s+)?agents\b/i);
  });

  it("sends a reader to forge_capabilities for the counts it leaves out", () => {
    expect(descriptor.capabilities.live_surface).toBe("forge_capabilities");
    expect(descriptor.entry_points.mcp_discovery).toBe("forge_capabilities");
  });
});

describe("generate-well-known.mjs", () => {
  let root;
  const path = (relative) => join(root, relative);
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { encoding: "utf8" });
  /** The descriptor as it would read a release or two ago: an old version and a short tool list. */
  const staleText = () => {
    const current = lf(readFileSync(path(DESCRIPTOR), "utf8"));
    const stale = current
      .replace(/("version": ")[^"]+/, (_match, head) => `${head}0.0.1`)
      .replace(/("mcp_tools": )\d+/, (_match, head) => `${head}43`)
      .replace(/\d+( MCP tools)/, (_match, tail) => `43${tail}`)
      .replace(/("presets": )\d+/, (_match, head) => `${head}1`);
    expect(stale).not.toBe(current);
    return { current, stale };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pf-well-known-"));
    for (const relative of INPUTS) {
      mkdirSync(dirname(path(relative)), { recursive: true });
      copyFileSync(join(REPO, relative), path(relative));
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("--check passes on a current descriptor", () => {
    const result = run("--check");
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("--check fails on a stale one, names the file, and changes nothing", () => {
    const { stale } = staleText();
    writeFileSync(path(DESCRIPTOR), stale);
    const result = run("--check");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(DESCRIPTOR);
    expect(readFileSync(path(DESCRIPTOR), "utf8")).toBe(stale);
  });

  it("rewrites the derived fields and nothing else", () => {
    const { current, stale } = staleText();
    writeFileSync(path(DESCRIPTOR), stale);
    const result = run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(path(DESCRIPTOR), "utf8")).toBe(current);
    expect(run("--check").status).toBe(0);
  });

  it("brings the tool list back in step when a tool is added to or removed from the registry", () => {
    const tools = JSON.parse(readFileSync(path("pforge-mcp/tools.json"), "utf8"));
    writeFileSync(path("pforge-mcp/tools.json"), JSON.stringify([...tools.slice(1), { name: "forge_brand_new_tool" }]));
    expect(run("--check").status).toBe(1);
    expect(run().status).toBe(0);
    const written = JSON.parse(readFileSync(path(DESCRIPTOR), "utf8"));
    expect(written.mcp_tools).toContain("forge_brand_new_tool");
    expect(written.mcp_tools).not.toContain(tools[0].name);
    expect(written.capabilities.mcp_tools).toBe(tools.length);
    expect(written.description).toContain(`${tools.length} MCP tools`);
  });

  it("keeps the line endings the file has", () => {
    const { current, stale } = staleText();
    writeFileSync(path(DESCRIPTOR), stale.replace(/\n/g, "\r\n"));
    expect(run().status).toBe(0);
    expect(readFileSync(path(DESCRIPTOR), "utf8")).toBe(current.replace(/\n/g, "\r\n"));
  });

  it("refuses a descriptor it cannot find the fields in, rather than guessing", () => {
    writeFileSync(path(DESCRIPTOR), '{ "name": "Plan Forge" }\n');
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(DESCRIPTOR);
  });
});
