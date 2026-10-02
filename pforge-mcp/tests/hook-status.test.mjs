/**
 * `pforge smith` lifecycle-hook detection (hook-status.mjs), shared by both shells.
 *
 * The Bash check needed jq, which Git Bash does not ship, and built config keys
 * as "${hook,}${hook:1}" ("sessionStartessionStart"). On Windows, Bash smith
 * reported 3/8 hooks on a fresh install that PowerShell reported as 8/8.
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hookStatus } from "../hook-status.mjs";
import { HOOK_PASCAL } from "../enums.mjs";

const SCRIPT = resolve(import.meta.dirname, "..", "hook-status.mjs");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function project({ hooksJson, forgeJson, files = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pf-hooks-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".github", "hooks", "scripts"), { recursive: true });
  if (hooksJson !== undefined) writeFileSync(join(dir, ".github", "hooks", "plan-forge.json"), JSON.stringify(hooksJson));
  if (forgeJson !== undefined) writeFileSync(join(dir, ".forge.json"), JSON.stringify(forgeJson));
  for (const f of files) writeFileSync(join(dir, ".github", "hooks", "scripts", f), "");
  return dir;
}

const FRESH = {
  hooksJson: { hooks: { SessionStart: [{}], PreToolUse: [{}], PostToolUse: [{}], Stop: [{}] } },
  forgeJson: { hooks: { preDeploy: {}, postSlice: {}, preAgentHandoff: {}, postRun: { invokeAuditor: { onFailure: false } } } },
};

describe("hookStatus", () => {
  it("finds all eight hooks on a fresh install (plan-forge.json + .forge.json)", () => {
    const status = hookStatus(project(FRESH));
    expect(status.map((s) => s.hook)).toEqual([...HOOK_PASCAL]);
    expect(status.every((s) => s.sources.length > 0)).toBe(true);
    expect(status.find((s) => s.hook === "SessionStart").sources).toEqual(["hooks/plan-forge.json"]);
    expect(status.find((s) => s.hook === "PostRun").sources).toEqual([".forge.json"]);
  });

  it("counts a hook script file whose name contains the hook", () => {
    const status = hookStatus(project({ files: ["PreDeploy.ps1"] }));
    expect(status.find((s) => s.hook === "PreDeploy").sources).toEqual(["file"]);
    expect(status.find((s) => s.hook === "PostRun").sources).toEqual([]);
  });

  it("treats false or null entries as absent, like the PowerShell check", () => {
    const status = hookStatus(project({ hooksJson: { hooks: { Stop: false } }, forgeJson: { hooks: { postRun: null } } }));
    expect(status.find((s) => s.hook === "Stop").sources).toEqual([]);
    expect(status.find((s) => s.hook === "PostRun").sources).toEqual([]);
  });

  it("survives missing or unreadable JSON files", () => {
    const dir = project();
    writeFileSync(join(dir, ".forge.json"), "{ not json");
    expect(hookStatus(dir).every((s) => s.sources.length === 0)).toBe(true);
  });
});

describe("CLI", () => {
  it("prints Hook|sources per hook", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--project", project(FRESH)], { encoding: "utf8" });
    const lines = r.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(HOOK_PASCAL.length);
    expect(lines[0]).toBe("SessionStart|hooks/plan-forge.json");
    expect(lines.at(-1)).toBe("PostRun|.forge.json");
  });
});
