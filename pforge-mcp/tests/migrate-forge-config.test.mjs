/**
 * `.forge.json` migration on update. Both shells call migrate-forge-config.mjs.
 *
 * - Fresh installs and updated projects lacked hooks.postRun, so `pforge smith`
 *   warned "Missing hooks: PostRun" on every install, although the PostRun
 *   auditor hook is built in and off by default.
 * - The Bash updater never migrated .forge.json (#299 parity gap).
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_HOOKS, migrateForgeConfig } from "../migrate-forge-config.mjs";
import { DEFAULT_ROUTING_MODEL } from "../orchestrator/constants.mjs";

const SCRIPT = resolve(import.meta.dirname, "..", "migrate-forge-config.mjs");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("migrateForgeConfig", () => {
  it("adds every missing default and reports what it added", () => {
    const { config, added } = migrateForgeConfig({ projectName: "x", preset: "dotnet" });
    expect(config.modelRouting.default).toBe(DEFAULT_ROUTING_MODEL);
    expect(Object.keys(config.hooks)).toEqual(["preDeploy", "postSlice", "preAgentHandoff", "postRun"]);
    expect(config.hooks.postRun).toEqual({ invokeAuditor: { onFailure: false, everyNRuns: null } });
    expect(added).toEqual(["modelRouting.default", "hooks.preDeploy", "hooks.postSlice", "hooks.preAgentHandoff", "hooks.postRun"]);
  });

  it("adds only hooks.postRun to a config that has the other hooks, keeping their values", () => {
    const before = { modelRouting: { default: "gpt-6-sol" }, hooks: { preDeploy: { blockOnSecrets: false }, postSlice: {}, preAgentHandoff: {} } };
    const { config, added } = migrateForgeConfig(before);
    expect(added).toEqual(["hooks.postRun"]);
    expect(config.modelRouting.default).toBe("gpt-6-sol");
    expect(config.hooks.preDeploy).toEqual({ blockOnSecrets: false });
  });

  it("never overwrites a value the project set, even false or null", () => {
    const before = { modelRouting: { default: "auto" }, hooks: { ...DEFAULT_HOOKS, postRun: false } };
    expect(migrateForgeConfig(before).added).toEqual([]);
    expect(migrateForgeConfig(before).config.hooks.postRun).toBe(false);
  });
});

describe("CLI", () => {
  const project = (cfg) => {
    const dir = mkdtempSync(join(tmpdir(), "pf-migrate-"));
    dirs.push(dir);
    if (cfg !== undefined) writeFileSync(join(dir, ".forge.json"), typeof cfg === "string" ? cfg : JSON.stringify(cfg, null, 2));
    return dir;
  };
  const run = (dir) => spawnSync(process.execPath, [SCRIPT, "--project", dir], { encoding: "utf8" });

  it("writes the migrated file, keeps unknown keys, and prints one line per addition", () => {
    const dir = project({ projectName: "x", custom: { keep: 1 }, hooks: { preDeploy: {} } });
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(["modelRouting.default", "hooks.postSlice", "hooks.preAgentHandoff", "hooks.postRun"]);
    const cfg = JSON.parse(readFileSync(join(dir, ".forge.json"), "utf8"));
    expect(cfg.custom).toEqual({ keep: 1 });
    expect(cfg.hooks.postRun.invokeAuditor.onFailure).toBe(false);
  });

  it("leaves an up-to-date file byte for byte, and skips a missing or unreadable one", () => {
    const dir = project({ modelRouting: { default: "auto" }, hooks: DEFAULT_HOOKS });
    const before = readFileSync(join(dir, ".forge.json"), "utf8");
    expect(run(dir).stdout).toBe("");
    expect(readFileSync(join(dir, ".forge.json"), "utf8")).toBe(before);
    expect(run(project()).status).toBe(0);
    const broken = project("{ not json");
    expect(run(broken).status).toBe(0);
    expect(readFileSync(join(broken, ".forge.json"), "utf8")).toBe("{ not json");
  });
});
