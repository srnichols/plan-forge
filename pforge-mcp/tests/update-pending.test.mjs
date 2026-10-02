/**
 * #302 — `pforge pending`: review the guidance updates `pforge update` saved in
 * .forge/update-pending/ instead of overwriting a project's edits.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { applyPending, discardPending, listPending, resolvePendingPath, runCli } from "../update-pending.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const WORKFLOW = ".github/instructions/git-workflow.instructions.md";
const STEP0 = ".github/prompts/step0-specify-feature.prompt.md";
const DAY_MS = 86_400_000;

let project;
const write = (rel, text) => {
  mkdirSync(dirname(join(project, rel)), { recursive: true });
  writeFileSync(join(project, rel), text);
};
const read = (rel) => readFileSync(join(project, rel), "utf8");

function cli(argv) {
  let out = "";
  let err = "";
  const code = runCli([...argv, "--project", project], { out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "pf-pending-"));
  write(WORKFLOW, "mine\n");
  write(`.forge/update-pending/${WORKFLOW}`, "new\n");
  write(STEP0, "same\r\n");
  write(`.forge/update-pending/${STEP0}`, "same\n");
  const old = new Date(Date.now() - 3 * DAY_MS);
  utimesSync(join(project, `.forge/update-pending/${WORKFLOW}`), old, old);
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

describe("listPending", () => {
  it("lists pending copies oldest first, with age and whether the project copy already matches", () => {
    expect(listPending(project)).toEqual([
      { path: WORKFLOW, pending: `.forge/update-pending/${WORKFLOW}`, ageDays: 3, projectExists: true, identical: false },
      { path: STEP0, pending: `.forge/update-pending/${STEP0}`, ageDays: 0, projectExists: true, identical: true },
    ]);
  });

  it("is empty when there is no pending directory", () => {
    rmSync(join(project, ".forge"), { recursive: true });
    expect(listPending(project)).toEqual([]);
  });

  it("never reports a negative age for a copy written just now", () => {
    const ahead = new Date(Date.now() + 5_000);
    utimesSync(join(project, `.forge/update-pending/${STEP0}`), ahead, ahead);
    expect(listPending(project).find((i) => i.path === STEP0).ageDays).toBe(0);
  });
});

describe("resolvePendingPath", () => {
  it("accepts the project path or the pending path, with either slash", () => {
    expect(resolvePendingPath(project, WORKFLOW)).toBe(WORKFLOW);
    expect(resolvePendingPath(project, `.forge/update-pending/${WORKFLOW}`)).toBe(WORKFLOW);
    expect(resolvePendingPath(project, WORKFLOW.replace(/\//g, "\\"))).toBe(WORKFLOW);
  });

  it("rejects unknown paths and paths that leave the pending directory", () => {
    expect(resolvePendingPath(project, "README.md")).toBeNull();
    expect(resolvePendingPath(project, `../../${WORKFLOW}`)).toBeNull();
    expect(resolvePendingPath(project, ".github")).toBeNull();
  });
});

describe("apply and discard", () => {
  it("apply is a dry run by default", () => {
    expect(applyPending(project, [WORKFLOW], { stamp: "S" })).toEqual([{ path: WORKFLOW, backup: `.forge/update-backups/S/${WORKFLOW}`, applied: false }]);
    expect(read(WORKFLOW)).toBe("mine\n");
    expect(existsSync(join(project, `.forge/update-pending/${WORKFLOW}`))).toBe(true);
  });

  it("apply backs the project copy up, takes the new version and removes the pending copy", () => {
    applyPending(project, [WORKFLOW], { dryRun: false, stamp: "S" });
    expect(read(WORKFLOW)).toBe("new\n");
    expect(read(`.forge/update-backups/S/${WORKFLOW}`)).toBe("mine\n");
    expect(existsSync(join(project, `.forge/update-pending/${WORKFLOW}`))).toBe(false);
    expect(existsSync(join(project, ".forge/update-pending/.github/instructions"))).toBe(false);
  });

  it("discard keeps the project copy and removes the pending tree once empty", () => {
    discardPending(project, [WORKFLOW, STEP0], { dryRun: false });
    expect(read(WORKFLOW)).toBe("mine\n");
    expect(existsSync(join(project, ".forge/update-pending"))).toBe(false);
    expect(existsSync(join(project, ".forge"))).toBe(true);
  });
});

describe("CLI", () => {
  it("list (the default) names each pending file and the next commands", () => {
    const r = cli([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("2 pending update(s)");
    expect(r.out).toContain(`${WORKFLOW}  3 day(s) old`);
    expect(r.out).toContain(`${STEP0}  today  (already identical)`);
    expect(r.out).toContain("pforge pending diff <path>");
  });

  it("says plainly when nothing is pending", () => {
    rmSync(join(project, ".forge"), { recursive: true });
    expect(cli(["list"]).out).toMatch(/^No pending updates\./);
    expect(cli(["count"]).out).toBe("0\n");
  });

  it("diff shows the project file against the pending copy", () => {
    const r = cli(["diff", WORKFLOW]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("-mine");
    expect(r.out).toContain("+new");
  });

  it("apply needs --yes to change anything", () => {
    const dry = cli(["apply", WORKFLOW]);
    expect(dry.out).toContain(`WOULD APPLY  ${WORKFLOW}`);
    expect(dry.out).toContain("Re-run with --yes");
    expect(read(WORKFLOW)).toBe("mine\n");
    const real = cli(["apply", WORKFLOW, "--yes"]);
    expect(real.out).toMatch(new RegExp(`APPLIED  ${WORKFLOW.replace(/\./g, "\\.")} \\(your copy backed up to \\.forge/update-backups/`));
    expect(read(WORKFLOW)).toBe("new\n");
  });

  it("discard --all drops every pending copy", () => {
    expect(cli(["discard", "--all", "--yes"]).out).toContain(`DISCARDED  ${STEP0}`);
    expect(listPending(project)).toEqual([]);
  });

  it("reports usage errors and unknown paths with distinct exit codes", () => {
    expect(cli(["apply"]).code).toBe(2);
    expect(cli(["bogus"]).code).toBe(2);
    const missing = cli(["apply", "README.md", "--yes"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no pending update for README.md");
  });
});

// ─── Both shells ────────────────────────────────────────────────────────────

const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;
const hasWrappers = existsSync(join(REPO_ROOT, "pforge.ps1")) && existsSync(join(REPO_ROOT, "pforge.sh"));

function installWrappers() {
  for (const f of ["pforge.ps1", "pforge.sh", "pforge-mcp/update-pending.mjs", "pforge-mcp/update-guard.mjs"]) {
    mkdirSync(dirname(join(project, f)), { recursive: true });
    copyFileSync(join(REPO_ROOT, f), join(project, f));
  }
  writeFileSync(join(project, ".forge.json"), JSON.stringify({ projectName: "Demo", preset: "custom" }));
  spawnSync("git", ["init", "-q"], { cwd: project });
}

describe.skipIf(!hasWrappers)("pforge pending in both shells", () => {
  it.skipIf(!PWSH)("pforge.ps1 pending lists and applies", () => {
    installWrappers();
    const run = (...a) => spawnSync("pwsh", ["-NoProfile", "-File", join(project, "pforge.ps1"), "pending", ...a], { cwd: project, encoding: "utf8" });
    expect(run().stdout).toContain(`${WORKFLOW}  3 day(s) old`);
    const applied = run("apply", WORKFLOW, "--yes");
    expect(applied.status, applied.stderr).toBe(0);
    expect(read(WORKFLOW)).toBe("new\n");
  }, 60_000);

  it.skipIf(!BASH)("pforge.sh pending lists and discards", () => {
    installWrappers();
    const run = (...a) => spawnSync(BASH, ["pforge.sh", "pending", ...a], { cwd: project, encoding: "utf8" });
    expect(run().stdout).toContain(`${WORKFLOW}  3 day(s) old`);
    const dropped = run("discard", "--all", "--yes");
    expect(dropped.status, dropped.stderr).toBe(0);
    expect(readdirSync(join(project, ".forge"))).not.toContain("update-pending");
    expect(read(WORKFLOW)).toBe("mine\n");
  }, 60_000);
});
