import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TOOL_PROFILES, DEFAULT_TOOL_PROFILES, resolveInitialProfiles, createToolProfileState,
} from "../server/tool-profiles.mjs";
import { TOOLS } from "../server/tool-definitions.mjs";

const toolNames = TOOLS.map((t) => t.name);

describe("TOOL_PROFILES", () => {
  it("places every registered tool in at least one profile", () => {
    const profiled = new Set(Object.values(TOOL_PROFILES).flat());
    expect(toolNames.filter((name) => !profiled.has(name))).toEqual([]);
  });

  it("names only registered tools", () => {
    const registered = new Set(toolNames);
    for (const [profile, tools] of Object.entries(TOOL_PROFILES)) {
      expect(tools.filter((name) => !registered.has(name)), profile).toEqual([]);
    }
  });

  it("keeps the core profile small and self-extending", () => {
    expect(DEFAULT_TOOL_PROFILES).toEqual(["core"]);
    expect(TOOL_PROFILES.core.length).toBeLessThanOrEqual(25);
    expect(TOOL_PROFILES.core).toEqual(expect.arrayContaining(["forge_tool_profile", "forge_capabilities", "forge_run_plan"]));
  });
});

describe("resolveInitialProfiles", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-tool-profiles-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to core", () => {
    expect(resolveInitialProfiles({ cwd: dir, env: {} })).toEqual(["core"]);
  });

  it("reads toolProfiles from .forge.json, always keeping core", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ toolProfiles: ["bugs", "liveguard"] }));
    expect(resolveInitialProfiles({ cwd: dir, env: {} })).toEqual(["core", "bugs", "liveguard"]);
  });

  it("accepts full", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ toolProfiles: "full" }));
    expect(resolveInitialProfiles({ cwd: dir, env: {} })).toEqual(["core", "full"]);
  });

  it("lets PFORGE_TOOL_PROFILE override the config", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ toolProfiles: ["bugs"] }));
    expect(resolveInitialProfiles({ cwd: dir, env: { PFORGE_TOOL_PROFILE: "tempering, memory" } })).toEqual(["core", "tempering", "memory"]);
  });

  it("drops unknown profile names", () => {
    expect(resolveInitialProfiles({ cwd: dir, env: { PFORGE_TOOL_PROFILE: "bugs,nope" } })).toEqual(["core", "bugs"]);
  });
});

describe("createToolProfileState", () => {
  it("lists only the active profiles' tools, in registration order", () => {
    const state = createToolProfileState(["core"]);
    const listed = state.listedTools(TOOLS).map((t) => t.name);
    expect(listed).toEqual(toolNames.filter((name) => TOOL_PROFILES.core.includes(name)));
  });

  it("lists every tool under full", () => {
    expect(createToolProfileState(["core", "full"]).listedTools(TOOLS)).toHaveLength(TOOLS.length);
  });

  it("loads and unloads profiles, reporting whether the list changed", () => {
    const state = createToolProfileState(["core"]);
    expect(state.apply({ load: ["bugs"] })).toMatchObject({ changed: true, active: ["core", "bugs"], unknown: [] });
    expect(state.listedTools(TOOLS).map((t) => t.name)).toContain("forge_bug_list");
    expect(state.apply({ load: ["bugs"] }).changed).toBe(false);
    expect(state.apply({ unload: ["bugs"] })).toMatchObject({ changed: true, active: ["core"] });
  });

  it("never unloads core and reports unknown names", () => {
    const state = createToolProfileState(["core"]);
    expect(state.apply({ unload: ["core"], load: ["nope"] })).toMatchObject({ changed: false, active: ["core"], unknown: ["nope"] });
  });
});
