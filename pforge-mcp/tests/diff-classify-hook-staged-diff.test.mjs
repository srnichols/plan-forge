/**
 * The diff-classify PreCommit chain entry must classify the whole staged diff.
 *
 * Found while fixing meta-bug #291: check-diff-classify.ps1/.sh handed the
 * staged diff to Node through an environment variable. PowerShell joined
 * git's output lines with spaces, so no line started with "+" and nothing was
 * flagged; a diff larger than the platform's variable limit (32 KiB on
 * Windows, 128 KiB per string on Linux) never reached Node; and the module's
 * default 3,000-line window skipped the rest of a large commit. The wrappers
 * now run check-diff-classify.mjs, which reads the staged diff itself through
 * the bounded git-diff reader and classifies every line.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOKS = join(REPO_ROOT, "templates", ".github", "hooks");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";
const PADDING_LINE = "// padding padding padding padding padding padding padding padding padding\n";
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

// Built at runtime so no credential-shaped literal lives in this source file.
function credentialLine() {
  const token = Array.from({ length: 32 }, (_, i) => TOKEN_ALPHABET[(i * 7 + 3) % TOKEN_ALPHABET.length]).join("");
  return `api_key = "${token}"\n`;
}

/** A repo with the Plan Forge classifier runtime and the hook scripts installed. */
function seedRepo({ withRuntime = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pf-diff-hook-"));
  tmpDirs.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "diff-hook@example.invalid");
  git(dir, "config", "user.name", "Diff Hook");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "core.autocrlf", "false");
  const scripts = join(dir, ".github", "hooks", "scripts");
  mkdirSync(scripts, { recursive: true });
  for (const name of ["check-diff-classify.mjs", "check-diff-classify.sh", "check-diff-classify.ps1"]) {
    copyFileSync(join(HOOKS, "scripts", name), join(scripts, name));
  }
  if (withRuntime) {
    mkdirSync(join(dir, "pforge-mcp", "server"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "pforge-mcp", "diff-classify.mjs"), join(dir, "pforge-mcp", "diff-classify.mjs"));
    copyFileSync(join(REPO_ROOT, "pforge-mcp", "server", "git-diff-reader.mjs"), join(dir, "pforge-mcp", "server", "git-diff-reader.mjs"));
  }
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  return dir;
}

/** Stage a file far beyond 3,000 lines and 128 KiB whose only secret is its last line. */
function stageLargeLeak(dir) {
  writeFileSync(join(dir, "bulk.txt"), PADDING_LINE.repeat(5000) + credentialLine());
  git(dir, "add", "bulk.txt");
}

const runners = {
  ps1: (dir) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, ".github", "hooks", "scripts", "check-diff-classify.ps1")], { cwd: dir, encoding: "utf-8", timeout: 60_000 }),
  sh: (dir) => spawnSync(BASH, [".github/hooks/scripts/check-diff-classify.sh"], { cwd: dir, encoding: "utf-8", timeout: 60_000 }),
};

const verdict = (r) => JSON.parse((r.stdout || "").trim() || "null");

for (const [shell, run] of Object.entries(runners)) {
  const available = shell === "ps1" ? isWin : Boolean(BASH);
  describe.skipIf(!available)(`check-diff-classify.${shell} classifies the whole staged diff`, () => {
    it("blocks a secret on the last line of a large staged diff", () => {
      const dir = seedRepo();
      stageLargeLeak(dir);
      const out = verdict(run(dir));
      expect(out?.blocked, JSON.stringify(out)).toBe(true);
      expect(out.message).toMatch(/leaked-secret/);
    });

    it("allows a clean staged change", () => {
      const dir = seedRepo();
      writeFileSync(join(dir, "notes.md"), "plain notes\n");
      git(dir, "add", "notes.md");
      expect(verdict(run(dir))).toEqual({});
    });

    it("blocks when git cannot read the staged diff", () => {
      const dir = seedRepo();
      writeFileSync(join(dir, ".git", "index"), "not an index");
      const out = verdict(run(dir));
      expect(out?.blocked).toBe(true);
      expect(out.message).toMatch(/could not read the staged diff/);
    });

    it("stays silent when the Plan Forge runtime is not installed", () => {
      const dir = seedRepo({ withRuntime: false });
      stageLargeLeak(dir);
      expect(verdict(run(dir))).toEqual({});
    });
  });
}

describe.skipIf(!(isWin || BASH))("the shipped chain entry blocks through PreCommit.mjs", () => {
  it("runCommandEntry returns blocked for the template's diff-classify entry", async () => {
    const { runCommandEntry } = await import(pathToFileURL(join(HOOKS, "PreCommit.mjs")).href);
    const cfg = JSON.parse(readFileSync(join(HOOKS, "plan-forge.json"), "utf-8"));
    const entry = cfg.hooks.preCommit.chain.find((e) => e.name === "diff-classify");
    const dir = seedRepo();
    stageLargeLeak(dir);
    const result = runCommandEntry(entry, { cwd: dir });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/leaked-secret/);
  });
});
