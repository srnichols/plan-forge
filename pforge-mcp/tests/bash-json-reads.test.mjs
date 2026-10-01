/**
 * #297 — pforge.sh reads JSON through node, not python3 or `grep -P`.
 *
 * In Git Bash on Windows, `python3` is usually the native Windows Store build,
 * which cannot open the POSIX path (`/tmp/...`, `/c/...`) embedded in its code
 * string, and Git Bash's `grep -P` refuses to run outside UTF-8 locales. Both
 * reads came back empty, so `pforge self-update` fell back to the project's own
 * root VERSION and refused to update (`Already current (v9.8.7)`).
 */

import { describe, it, expect, afterEach } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SH = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "pf-bash-json-"));
  tmpDirs.push(dir);
  mkdirSync(join(dir, ".git"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(dir, "pforge.sh"));
  return dir;
}

function pforge(dir, args, env = {}) {
  return spawnSync(BASH, ["pforge.sh", ...args], {
    cwd: dir,
    encoding: "utf-8",
    timeout: 60_000,
    env: { ...process.env, PFORGE_NO_UPDATE_CHECK: "1", ...env },
  });
}

describe("Guard: pforge.sh reads JSON through node, not python3 or grep -P", () => {
  it("has no python3 calls", () => {
    expect(SH).not.toMatch(/\bpython3\b/);
  });

  it("has no grep -P (Perl regex) calls", () => {
    expect(SH).not.toMatch(/\bgrep\s+-[A-Za-z]*P/);
  });
});

describe.skipIf(!BASH)("pforge.sh JSON reads behave the same on every platform", () => {
  it("self-update reads .forge.json templateVersion, not the project's own VERSION", () => {
    const dir = project({
      ".forge.json": JSON.stringify({ templateVersion: "3.27.0" }),
      VERSION: "9.8.7",
      "pforge-mcp/update-check.mjs": readFileSync(join(REPO_ROOT, "pforge-mcp", "update-check.mjs"), "utf8"),
    });
    const r = pforge(dir, ["self-update", "--dry-run"]);
    const output = `${r.stdout}\n${r.stderr}`;
    expect(output).toMatch(/v3\.27\.0/);
    expect(output).not.toMatch(/v9\.8\.7/);
  });

  it("config set/get/list round-trip and keep other keys", () => {
    const dir = project({ ".forge.json": JSON.stringify({ projectName: "keep-me", templateVersion: "3.27.0" }, null, 2) });
    expect(pforge(dir, ["config", "set", "update-source", "github-tags"]).status).toBe(0);
    expect(pforge(dir, ["config", "get", "update-source"]).stdout.trim()).toBe("github-tags");
    expect(pforge(dir, ["config", "list"]).stdout).toMatch(/update-source\s+github-tags/);
    const saved = JSON.parse(readFileSync(join(dir, ".forge.json"), "utf8"));
    expect(saved).toMatchObject({ projectName: "keep-me", templateVersion: "3.27.0", updateSource: "github-tags" });
  });

  it("ext list prints installed extensions from extensions.json", () => {
    const dir = project({
      ".forge/extensions/extensions.json": JSON.stringify({
        extensions: [{ name: "notify-slack", version: "1.2.3", installedDate: "2026-09-01" }],
      }),
    });
    expect(pforge(dir, ["ext", "list"]).stdout).toMatch(/notify-slack v1\.2\.3\s+\(installed 2026-09-01\)/);
  });
});
