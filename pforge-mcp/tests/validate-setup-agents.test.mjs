/**
 * validate-setup with the agent adapters that .forge.json lists.
 *
 * `.forge.json` stores the adapters setup installed as typed: "agents": "claude,cursor,codex". validate-setup.sh
 * counted the files of each with `local`, which Bash allows only inside a function. Under `set -e` the script
 * ended right after "Agent-specific files:" with "local: can only be used in a function", so a project set up
 * with --agent claude, cursor or codex (any list that is not "all") was never validated to the end.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const PS_ARGS = ["-NoProfile", "-NonInteractive"];

const SHELLS = [
  { name: "validate-setup.sh", available: Boolean(BASH), run: (project) => spawnSync(BASH, [join(REPO_ROOT, "validate-setup.sh"), "--path", project], { encoding: "utf8", timeout: 120_000 }) },
  {
    name: "validate-setup.ps1 under pwsh",
    available: PWSH_OK,
    run: (project) => spawnSync("pwsh", [...PS_ARGS, "-File", join(REPO_ROOT, "validate-setup.ps1"), "-ProjectPath", project], { encoding: "utf8", timeout: 120_000 }),
  },
  {
    name: "validate-setup.ps1 under Windows PowerShell 5.1",
    available: isWin,
    run: (project) =>
      spawnSync("powershell.exe", [...PS_ARGS, "-ExecutionPolicy", "Bypass", "-File", join(REPO_ROOT, "validate-setup.ps1"), "-ProjectPath", project], { encoding: "utf8", timeout: 120_000 }),
  },
];

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project whose .forge.json lists `agents`, with one file of each adapter that the list names. */
function project(agents) {
  const dir = mkdtempSync(join(tmpdir(), "pf-validate-agents-"));
  tmpDirs.push(dir);
  const write = (rel, text = "") => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  write(".forge.json", `${JSON.stringify({ projectName: "Acme", preset: "custom", agents, templateVersion: "9.9.9" }, null, 2)}\n`);
  write("CLAUDE.md", "# Claude\n");
  write(".claude/skills/one/SKILL.md", "# one\n");
  write(".cursor/rules/one.mdc", "# one\n");
  write(".cursor/commands/one.md", "# one\n");
  write(".agents/skills/one/SKILL.md", "# one\n");
  return dir;
}

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`${shell.name}: agent adapters named in .forge.json`, () => {
    it("counts the files of each adapter, and gets to the summary", () => {
      const run = shell.run(project("claude,cursor,codex"));
      const out = `${run.stdout}${run.stderr}`;
      expect(out).not.toContain("can only be used in a function");
      expect(out).toMatch(/PASS\s+\.claude\/skills\/ \(1 Claude skills\)/);
      expect(out).toMatch(/PASS\s+\.cursor\/commands\/ \(1 Cursor commands\)/);
      expect(out).toMatch(/PASS\s+\.agents\/skills\/ \(1 Codex skills\)/);
      expect(out, "the run reaches its summary").toMatch(/Results:\s+\d+ passed/);
    }, 180_000);

    it("does the same for a single adapter", () => {
      const run = shell.run(project("claude"));
      const out = `${run.stdout}${run.stderr}`;
      expect(out).toMatch(/PASS\s+\.claude\/skills\/ \(1 Claude skills\)/);
      expect(out).not.toMatch(/Cursor commands|Codex skills/);
      expect(out).toMatch(/Results:\s+\d+ passed/);
    }, 180_000);
  });
}
