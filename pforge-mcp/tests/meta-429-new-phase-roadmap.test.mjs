/**
 * Meta-bug #429 — `pforge new-phase` in Bash never added the phase to DEPLOYMENT-ROADMAP.md, and exited 1.
 *
 * cmd_new_phase built the roadmap entry in a here-document, so it spans several lines, and spliced it in with
 * `sed -i "s/## Completed Phases/${entry}\n\n## Completed Phases/"`. An s command cannot take a replacement with a
 * raw newline in it: sed stopped with "unterminated `s' command", pforge.sh runs under set -e, and the plan file
 * was left behind with no roadmap entry. The PowerShell twin worked. The entry now goes in with awk, from the
 * environment, which takes any text, including the / and & that the phase name may hold.
 *
 * The roadmap each shell writes is compared byte for byte, so the two stay the same. Windows PowerShell 5.1 is not
 * run here: its Set-Content writes the system code page, which is a separate matter from the roadmap's structure.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;

const SHELLS = [
  { name: "pforge.sh", available: Boolean(BASH), run: (project, name) => spawnSync(BASH, ["pforge.sh", "new-phase", name], { cwd: project, encoding: "utf8", timeout: 120_000 }) },
  {
    name: "pforge.ps1 under pwsh",
    available: PWSH_OK,
    run: (project, name) => spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", join(project, "pforge.ps1"), "new-phase", name], { cwd: project, encoding: "utf8", timeout: 120_000 }),
  },
];

const ROADMAP = "# Roadmap\n\n## Active Phases\n\n- Phase 1: one\n\n## Completed Phases\n\n- Phase 0: zero\n";
const ROADMAP_WITHOUT_COMPLETED = "# Roadmap\n\n## Active Phases\n\n- Phase 1: one\n";

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(roadmap) {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-429-"));
  tmpDirs.push(dir);
  mkdirSync(join(dir, "docs", "plans"), { recursive: true });
  writeFileSync(join(dir, "docs", "plans", "DEPLOYMENT-ROADMAP.md"), roadmap);
  writeFileSync(join(dir, "docs", "plans", "Phase-1-ONE-PLAN.md"), "# Phase 1: One\n");
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(dir, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(dir, "pforge.ps1"));
  return dir;
}

const roadmapOf = (dir) => readFileSync(join(dir, "docs", "plans", "DEPLOYMENT-ROADMAP.md"), "utf8").replace(/\r\n/g, "\n");

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`${shell.name} new-phase`, () => {
    it("adds the phase above Completed Phases, creates the plan file, and exits 0", () => {
      const dir = project(ROADMAP);
      const run = shell.run(dir, "Demo Thing");
      const out = `${run.stdout}${run.stderr}`;
      expect(run.status, out).toBe(0);
      expect(out).toContain("UPDATED  DEPLOYMENT-ROADMAP.md (added Phase 2)");
      expect(existsSync(join(dir, "docs", "plans", "Phase-2-DEMO-THING-PLAN.md"))).toBe(true);

      const text = roadmapOf(dir);
      expect(text.split("\n").filter((line) => line === "## Completed Phases")).toHaveLength(1);
      const at = (needle) => text.indexOf(needle);
      expect(at("- Phase 1: one")).toBeGreaterThan(-1);
      expect(at("### Phase 2: Demo Thing")).toBeGreaterThan(at("- Phase 1: one"));
      expect(at("## Completed Phases")).toBeGreaterThan(at("### Phase 2: Demo Thing"));
      expect(at("- Phase 0: zero")).toBeGreaterThan(at("## Completed Phases"));
      expect(text).toContain("**Plan**: [Phase-2-DEMO-THING-PLAN.md](./Phase-2-DEMO-THING-PLAN.md)");
    }, 180_000);

    it("takes a phase name that holds an ampersand, which sed would have read as the matched text", () => {
      const dir = project(ROADMAP);
      const run = shell.run(dir, "Fish & Chips");
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      const text = roadmapOf(dir);
      expect(text).toContain("### Phase 2: Fish & Chips\n");
      expect(text.split("\n").filter((line) => line === "## Completed Phases")).toHaveLength(1);
    }, 180_000);

    it("appends the phase to a roadmap that has no Completed Phases heading", () => {
      const dir = project(ROADMAP_WITHOUT_COMPLETED);
      const run = shell.run(dir, "Demo Thing");
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      const text = roadmapOf(dir);
      expect(text.startsWith(ROADMAP_WITHOUT_COMPLETED)).toBe(true);
      expect(text).toContain("### Phase 2: Demo Thing");
    }, 180_000);
  });
}

// A roadmap with no Completed Phases heading is not compared: Bash appends the entry with echo, which ends the file with a
// newline, and PowerShell appends it without one. That difference is older than this bug and the structure is the same.
describe.skipIf(!BASH || !PWSH_OK)("new-phase: the two shells write the same roadmap", () => {
  it.each([["Demo Thing"], ["Fish & Chips"]])("for %j", (name) => {
    const [sh, ps] = SHELLS.map((shell) => {
      const dir = project(ROADMAP);
      const run = shell.run(dir, name);
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      return roadmapOf(dir);
    });
    expect(sh).toBe(ps);
  }, 300_000);
});
