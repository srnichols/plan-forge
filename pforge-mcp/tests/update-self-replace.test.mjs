/**
 * `pforge update` overwrites pforge.sh while pforge.sh is running it.
 *
 * Bash reads a script incrementally. The dispatch used to be a bare
 * `case … esac` at the end of the file, so when cmd_update returned, bash
 * read the next bytes of the replaced, longer file at the old offset and
 * failed with "syntax error near unexpected token `;;'": exit 2 after an
 * update that had succeeded. Found while rehearsing the v3.27.0 release
 * (update from v3.26.7 in Git Bash).
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The next release's pforge.sh: the same script, made longer so every offset moves. */
function longerCopyOf(script) {
  const [shebang, ...rest] = script.split("\n");
  const padding = Array.from({ length: 80 }, (_, i) => `# release padding line ${i} ${"-".repeat(40)}`);
  return [shebang, ...padding, ...rest].join("\n");
}

function seed() {
  const base = mkdtempSync(join(tmpdir(), "pf-update-self-"));
  tmpDirs.push(base);
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  mkdirSync(source, { recursive: true });
  mkdirSync(project, { recursive: true });
  const current = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8");
  writeFileSync(join(source, "VERSION"), "9.9.9");
  writeFileSync(join(source, "pforge.sh"), longerCopyOf(current));
  // Both shells run the source's update-plan.mjs and refuse a source without it (#299).
  copyUpdateRuntime(source);
  writeFileSync(join(project, ".forge.json"), JSON.stringify({ templateVersion: "9.9.8", preset: "custom" }));
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  return { source, project };
}

describe.skipIf(!BASH)("pforge.sh survives replacing itself during update", () => {
  it("exits 0 with no syntax error after update overwrites the running pforge.sh", () => {
    const { source, project } = seed();
    const r = spawnSync(BASH, ["pforge.sh", "update", source, "--force"], { cwd: project, encoding: "utf-8", timeout: 120_000 });

    expect(r.stdout).toMatch(/Update complete/);
    expect(readFileSync(join(project, "pforge.sh"), "utf8")).toBe(readFileSync(join(source, "pforge.sh"), "utf8"));
    expect(r.stderr).not.toMatch(/syntax error/);
    expect(r.status).toBe(0);
  });
});
