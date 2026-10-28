/**
 * The managed .gitignore block (#211) is refreshed with awk. The refresh passed the multi-line block through
 * `awk -v`, which GNU awk accepts and the awk on macOS refuses ("awk: newline in string"). The block was written
 * the first time, so setup passed, and every update after that ended in an error, after it had already applied
 * the update (#427). The block goes in through the environment now.
 *
 * setup.sh and pforge.sh each have the function; both are run here, as a user's shell would run them.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const BEGIN = "# >>> plan-forge managed (do not edit between markers) >>>";
const END = "# <<< plan-forge managed <<<";

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pf-gitignore-"));
  tmpDirs.push(dir);
  return dir;
};

function functionSource(script) {
  const source = readFileSync(join(REPO_ROOT, script), "utf8");
  const start = source.indexOf("\npf_update_gitignore() {");
  expect(start, `${script} defines pf_update_gitignore`).toBeGreaterThan(-1);
  return source.slice(start + 1, source.indexOf("\n}\n", start) + 3);
}

function refresh(script, dir) {
  const driver = ["set -euo pipefail", 'green() { echo "$*"; }', 'yellow() { echo "$*"; }', functionSource(script), 'pf_update_gitignore "$1"'].join("\n");
  const run = spawnSync(BASH, ["-c", driver, "bash", dir], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

const read = (dir) => readFileSync(join(dir, ".gitignore"), "utf8").replace(/\r\n/g, "\n");
const count = (text, needle) => text.split("\n").filter((line) => line === needle).length;

for (const script of ["setup.sh", "pforge.sh"]) {
  describe.skipIf(!BASH)(`${script}: the managed .gitignore block`, () => {
    it("does not give awk the multi-line block as a -v value", () => {
      expect(functionSource(script)).not.toMatch(/awk\b[^\n]*\s-v\s+body=/);
    });

    it("creates .gitignore with the block when there is none", () => {
      const dir = tempDir();
      refresh(script, dir);
      const text = read(dir);
      expect(count(text, BEGIN)).toBe(1);
      expect(count(text, END)).toBe(1);
      expect(text).toContain("\n**/.forge/\n");
    });

    it("refreshes a stale block in place and keeps the lines around it", () => {
      const dir = tempDir();
      writeFileSync(join(dir, ".gitignore"), ["node_modules/", BEGIN, "old line one", "old line two", END, "# mine", ""].join("\n"));
      const output = refresh(script, dir);
      const text = read(dir);
      expect(output).toContain("Refreshed plan-forge managed block");
      expect(text).not.toContain("old line");
      expect(count(text, BEGIN)).toBe(1);
      expect(count(text, END)).toBe(1);
      expect(text).toContain("pforge-mcp/node_modules/");
      const lines = text.split("\n");
      expect(lines[0]).toBe("node_modules/");
      expect(lines.indexOf("# mine")).toBeGreaterThan(lines.indexOf(END));
    });

    it("leaves a block that is already current alone", () => {
      const dir = tempDir();
      refresh(script, dir);
      const first = read(dir);
      expect(refresh(script, dir)).toContain("already current");
      expect(read(dir)).toBe(first);
    });

    it("appends the block after the user's own lines when it is not there yet", () => {
      const dir = tempDir();
      writeFileSync(join(dir, ".gitignore"), "dist/\n.env");
      refresh(script, dir);
      const lines = read(dir).split("\n");
      expect(lines.slice(0, 2)).toEqual(["dist/", ".env"]);
      expect(lines.indexOf(BEGIN)).toBeGreaterThan(1);
    });
  });
}
