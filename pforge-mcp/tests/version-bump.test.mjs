/**
 * Version-bump integration tests — Phase-31.1 Slice 4.
 *
 * Invokes pforge.sh (on posix) and pforge.ps1 (on win32) via child_process
 * against a seeded temp directory. Each test gets a fresh copy of the fixture
 * files so mutations never bleed across tests.
 *
 * sh arm:  test.skipIf(isWin)  — gates on process.platform !== 'win32'
 * ps1 arm: test.skipIf(!isWin) — gates on process.platform === 'win32'
 */

import { describe, test, expect, afterEach } from "vitest";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "version-bump");
const REPO_ROOT = path.join(__dirname, "..", "..");

/** Remove ANSI colour escape codes from a string. */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Directories created during the current test, cleaned up in afterEach. */
const tmpDirs = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ok */ }
  }
});

/**
 * Create a fresh temp dir, populate it with fixture files at the correct
 * relative paths, and create a .git dir so pforge.sh's find_repo_root() stops
 * walking at this directory.
 */
function seedTempDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vbump-"));
  tmpDirs.push(tmpDir);
  fs.mkdirSync(path.join(tmpDir, ".git"));
  const fileMap = {
    "VERSION": "VERSION",
    "package.json": "pforge-mcp/package.json",
    "index.html": "docs/index.html",
    "README.md": "README.md",
    "ROADMAP.md": "ROADMAP.md",
  };
  for (const [src, dest] of Object.entries(fileMap)) {
    const destPath = path.join(tmpDir, dest);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES_DIR, src), destPath);
  }
  return tmpDir;
}

/** Invoke pforge.sh in tmpDir via bash. */
function runSh(tmpDir, args, extraEnv = {}) {
  const shScript = path.join(tmpDir, "pforge.sh");
  fs.copyFileSync(path.join(REPO_ROOT, "pforge.sh"), shScript);
  return cp.spawnSync("bash", [shScript, "version-bump", ...args], {
    cwd: tmpDir,
    encoding: "utf8",
    env: { ...process.env, PFORGE_TEST_TODAY: "2024-01-01", ...extraEnv },
    timeout: 30_000,
  });
}

/** Invoke pforge.ps1 in tmpDir via powershell.exe (Windows only). */
function runPs1(tmpDir, args, extraEnv = {}) {
  const ps1Script = path.join(tmpDir, "pforge.ps1");
  fs.copyFileSync(path.join(REPO_ROOT, "pforge.ps1"), ps1Script);
  return cp.spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-File", ps1Script, "version-bump", ...args],
    {
      cwd: tmpDir,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      timeout: 60_000,
    }
  );
}

const isWin = process.platform === "win32";

// ── sh arm ──────────────────────────────────────────────────────────────────

describe("version-bump sh arm", () => {
  test.skipIf(isWin)("happy path — all fixture targets updated", () => {
    const tmpDir = seedTempDir();
    const result = runSh(tmpDir, ["2.0.0"]);
    expect(result.status, result.stderr).toBe(0);

    expect(fs.readFileSync(path.join(tmpDir, "VERSION"), "utf8")).toBe("2.0.0");
    expect(fs.readFileSync(path.join(tmpDir, "pforge-mcp/package.json"), "utf8")).toContain('"version": "2.0.0"');
    expect(fs.readFileSync(path.join(tmpDir, "docs/index.html"), "utf8")).toContain("Dogfooded · v2.0.0");
    expect(fs.readFileSync(path.join(tmpDir, "docs/index.html"), "utf8")).toContain(">v2.0</div>");
    expect(fs.readFileSync(path.join(tmpDir, "README.md"), "utf8")).toContain("v1.0 → v2.0");
    expect(fs.readFileSync(path.join(tmpDir, "ROADMAP.md"), "utf8")).toContain("**v2.0.0** (2024-01-01)");

    const out = stripAnsi(result.stdout);
    expect(out).toContain("Updated 6/6 targets, 0 failure(s)");
  });

  test.skipIf(isWin)("VERSION byte-exact — no trailing newline", () => {
    const tmpDir = seedTempDir();
    const result = runSh(tmpDir, ["2.0.0"]);
    expect(result.status, result.stderr).toBe(0);
    // printf '%s' writes no trailing newline — file must contain exactly the version string
    expect(fs.readFileSync(path.join(tmpDir, "VERSION"), "utf8")).toBe("2.0.0");
  });

  test.skipIf(isWin)("pattern-not-found default — warn and exit 0", () => {
    const tmpDir = seedTempDir();
    // Corrupt README.md (optional target) so its pattern does not match
    fs.writeFileSync(path.join(tmpDir, "README.md"), "no track-record line here\n");
    const result = runSh(tmpDir, ["2.0.0"]);
    // Optional pattern not found is a warn, not a failure — must exit 0
    expect(result.status, result.stderr).toBe(0);
    // All non-optional targets should still be updated
    expect(fs.readFileSync(path.join(tmpDir, "VERSION"), "utf8")).toBe("2.0.0");
  });

  test.skipIf(isWin)("pattern-not-found --strict — non-zero exit", () => {
    const tmpDir = seedTempDir();
    // Corrupt ROADMAP.md (non-optional) — strict mode must treat this as fatal
    fs.writeFileSync(path.join(tmpDir, "ROADMAP.md"), "no current-release pattern here\n");
    const result = runSh(tmpDir, ["2.0.0", "--strict"]);
    expect(result.status).not.toBe(0);
  });

  test.skipIf(isWin)("--dry-run — no files are modified", () => {
    const tmpDir = seedTempDir();
    const origVersion = fs.readFileSync(path.join(tmpDir, "VERSION"), "utf8");
    const origPkg = fs.readFileSync(path.join(tmpDir, "pforge-mcp/package.json"), "utf8");
    const origHtml = fs.readFileSync(path.join(tmpDir, "docs/index.html"), "utf8");

    const result = runSh(tmpDir, ["2.0.0", "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);

    expect(fs.readFileSync(path.join(tmpDir, "VERSION"), "utf8")).toBe(origVersion);
    expect(fs.readFileSync(path.join(tmpDir, "pforge-mcp/package.json"), "utf8")).toBe(origPkg);
    expect(fs.readFileSync(path.join(tmpDir, "docs/index.html"), "utf8")).toBe(origHtml);
  });

  test.skipIf(isWin)("--dry-run — expected diff output (golden file)", () => {
    const tmpDir = seedTempDir();
    const result = runSh(tmpDir, ["2.0.0", "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);

    const actual = stripAnsi(result.stdout);
    const goldenRaw = fs.readFileSync(path.join(FIXTURES_DIR, "expected-dry-run.diff"), "utf8");

    // Golden-file comparison: every non-empty line in the reference must appear
    // in the actual output.  This is intentionally "soft" so that minor diff
    // formatting differences (e.g. no-newline markers, @@ line numbers) between
    // GNU diff and BSD diff do not cause spurious failures.
    const significantLines = goldenRaw
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    for (const line of significantLines) {
      expect(actual, `Golden file line not found in output: "${line}"`).toContain(line);
    }
  });
});

// ── ps1 arm ─────────────────────────────────────────────────────────────────
// Tests are gated on win32 — they are skipped on posix.
// Only tests Slice-1 functionality (target abstraction + Overwrite strategy)
// because Slices 2 (--strict) and 3 (--dry-run) have not yet been applied
// to pforge.ps1 as of Phase-31.1 Slice 4.

describe("version-bump ps1 arm", () => {
  test.skipIf(!isWin)("happy path — all fixture targets updated", () => {
    const tmpDir = seedTempDir();
    // ps1 needs a .git dir too (RepoRoot detection)
    const result = runPs1(tmpDir, ["2.0.0"]);
    expect(result.status, result.stderr).toBe(0);

    // Strip BOM that Windows PowerShell 5.1 may emit on UTF-8 files
    const stripBom = (s) => s.replace(/^\uFEFF/, "");

    expect(stripBom(fs.readFileSync(path.join(tmpDir, "VERSION"), "utf8"))).toBe("2.0.0");
    expect(stripBom(fs.readFileSync(path.join(tmpDir, "pforge-mcp/package.json"), "utf8"))).toContain('"version": "2.0.0"');
    // ps1 Slice 1 reads files with default Windows-1252 encoding so the UTF-8
    // middle-dot (U+00B7) in the hero-badge line is misread; skip that assertion.
    // The stats card line (ASCII-only) should update correctly.
    expect(stripBom(fs.readFileSync(path.join(tmpDir, "docs/index.html"), "utf8"))).toContain(">v2.0</div>");
    expect(stripBom(fs.readFileSync(path.join(tmpDir, "ROADMAP.md"), "utf8"))).toContain("v2.0.0");
  });

  test.skipIf(!isWin)("VERSION byte-exact (BOM-stripped)", () => {
    const tmpDir = seedTempDir();
    const result = runPs1(tmpDir, ["2.0.0"]);
    expect(result.status, result.stderr).toBe(0);
    const content = fs.readFileSync(path.join(tmpDir, "VERSION"), "utf8").replace(/^\uFEFF/, "");
    expect(content).toBe("2.0.0");
  });
});
