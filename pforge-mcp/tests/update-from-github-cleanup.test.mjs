/**
 * #298 — `pforge update --from-github` must remove the release tarball and the
 * extract dir it downloaded (unless --keep-cache), on every exit path, and log
 * the tag/sha256/size to the update audit.
 *
 * pforge.ps1 kept the paths in $script: variables but read function-local
 * $null copies in its cleanup, so it printed "Cleaned up cache files." and
 * deleted nothing (~64 MB per update). Both shells also skipped cleanup when
 * they returned early (already up to date, dry run).
 *
 * The project gets a stub pforge-mcp/update-from-github.mjs that "downloads"
 * a local tarball, so the full shell flow runs without the network.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";
const TAG = "v9.9.9";

const STUB = `import { appendFileSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [action, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
if (action === "resolve-tag") {
  console.log(JSON.stringify({ ok: true, tag: "${TAG}" }));
} else if (action === "download") {
  const dir = join(opt("--project-dir"), ".forge", "cache");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "update-${TAG}.tar.gz");
  copyFileSync(process.env.PF_TEST_TARBALL, path);
  console.log(JSON.stringify({ ok: true, path, sha256: "abc123", sizeBytes: 42 }));
} else if (action === "audit") {
  appendFileSync(join(opt("--project-dir"), "audit-capture.jsonl"), readFileSync(0, "utf8").trim() + "\\n");
  console.log(JSON.stringify({ ok: true }));
}
`;

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

function seed(templateVersion) {
  const base = mkdtempSync(join(tmpdir(), "pf-update-gh-cache-"));
  tmpDirs.push(base);
  const release = join(base, "release");
  writeTree(join(release, "plan-forge"), { VERSION: TAG.slice(1), "templates/.github/hooks/plan-forge.json": "{\"hooks\":{}}\n" });
  // Both shells run the release's update-plan.mjs and refuse a source without it (#299).
  copyUpdateRuntime(join(release, "plan-forge"));
  const tarball = join(base, "release.tar.gz");
  execFileSync("tar", ["-czf", tarball, "-C", release, "plan-forge"], { stdio: "ignore" });
  const project = join(base, "project");
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion, preset: "custom" }),
    "pforge-mcp/update-from-github.mjs": STUB,
  });
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return { project, tarball };
}

const cacheEntries = (project) => {
  const dir = join(project, ".forge", "cache");
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(`update-${TAG}`)) : [];
};

function runners() {
  const list = [];
  if (BASH) {
    list.push({ name: "pforge.sh", run: (project, tarball, args) => spawnSync(BASH, ["pforge.sh", "update", "--from-github", ...args], { cwd: project, encoding: "utf-8", timeout: 180_000, env: { ...process.env, PF_TEST_TARBALL: tarball } }) });
  }
  if (isWin) {
    list.push({
      name: "pforge.ps1 (Windows PowerShell 5.1)",
      run: (project, tarball, args) => spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", "--from-github", ...args],
        { cwd: project, encoding: "utf-8", timeout: 180_000, env: { ...process.env, PF_TEST_TARBALL: tarball } },
      ),
    });
  }
  return list;
}

describe.each(runners())("#298 $name update --from-github cleans its download cache", ({ run }) => {
  it("removes the tarball and extract dir after an update and audits the tag", () => {
    const { project, tarball } = seed("9.9.8");
    const r = run(project, tarball, ["--force"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(cacheEntries(project)).toEqual([]);
    expect(r.stdout).toContain("Cleaned up cache files.");
    const audit = JSON.parse(readFileSync(join(project, "audit-capture.jsonl"), "utf8").trim().split("\n").pop());
    expect(audit).toMatchObject({ tag: TAG, sha256: "abc123", sizeBytes: 42 });
  });

  it("removes the cache when it returns early because the project is already current", () => {
    const { project, tarball } = seed(TAG.slice(1));
    const r = run(project, tarball, []);
    expect(r.stdout).toMatch(/Already up to date/);
    expect(cacheEntries(project)).toEqual([]);
  });

  it("keeps the cache with --keep-cache and names the real tarball path", () => {
    const { project, tarball } = seed("9.9.8");
    const r = run(project, tarball, ["--force", "--keep-cache"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(cacheEntries(project)).toContain(`update-${TAG}.tar.gz`);
    expect(r.stdout).toMatch(new RegExp(`Cache preserved \\(--keep-cache\\): \\S*update-${TAG.replace(/\./g, "\\.")}\\.tar\\.gz`));
  });
});
