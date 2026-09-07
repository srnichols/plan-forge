import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { resolveCopilotLauncher } from "../orchestrator/copilot-launcher.mjs";
import { spawnWorker } from "../orchestrator/worker-spawn.mjs";

const WINDOWS_ONLY = process.platform !== "win32";
const execFileAsync = promisify(execFile);

function createLauncherFixture(root) {
  const bootstrapDir = join(root, "globalStorage", "github.copilot-chat", "copilotCli");
  const npmDir = join(root, "npm");
  const packageDir = join(npmDir, "node_modules", "@github", "copilot");
  mkdirSync(bootstrapDir, { recursive: true });
  mkdirSync(packageDir, { recursive: true });
  const bootstrapPath = join(bootstrapDir, "copilot.ps1");
  writeFileSync(bootstrapPath, "Write-Output 'shared bootstrap executed'\nexit 23\n");
  writeFileSync(join(bootstrapDir, "copilot.bat"), `@echo off\r\npowershell.exe -NoProfile -File "${bootstrapPath}" %*\r\n`);
  writeFileSync(join(npmDir, "copilot.cmd"), "@echo off\r\necho npm wrapper executed\r\nexit /b 24\r\n");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "@github/copilot", bin: { copilot: "npm-loader.js" } }));
  writeFileSync(join(packageDir, "npm-loader.js"), "console.log(JSON.stringify({ launcher: 'installed-cli', args: process.argv.slice(2) }));\n");
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || root;
  const path = [bootstrapDir, npmDir, dirname(process.execPath), join(systemRoot, "System32"), join(systemRoot, "System32", "WindowsPowerShell", "v1.0")].join(";");
  return { bootstrapPath, path, bootstrapDir, npmDir, packageDir };
}

async function holdExclusiveLock(path) {
  const script = [
    "$handle = [IO.File]::Open($env:PFORGE_TEST_LOCK_PATH, 'Open', 'ReadWrite', 'None')",
    "[Console]::Out.WriteLine('LOCKED')",
    "[Console]::Out.Flush()",
    "$null = [Console]::ReadLine()",
    "$handle.Dispose()",
  ].join("; ");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, PFORGE_TEST_LOCK_PATH: path },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  await new Promise((fulfill, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Lock fixture exited before readiness: ${code}`)));
    child.stdout.on("data", (chunk) => { if (chunk.toString().includes("LOCKED")) fulfill(); });
  });
  return child;
}

describe.skipIf(WINDOWS_ONLY)("meta #264 - shared Copilot bootstrap contention", () => {
  let fixtureDir;

  beforeEach(() => { fixtureDir = mkdtempSync(join(tmpdir(), "pforge-copilot-lock-")); });
  afterEach(() => { rmSync(fixtureDir, { recursive: true, force: true }); });

  it("launches the installed CLI with literal arguments while the shared bootstrap is locked", async () => {
    const fixture = createLauncherFixture(fixtureDir);
    const lock = await holdExclusiveLock(fixture.bootstrapPath);
    try {
      await expect(execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", fixture.bootstrapPath], { windowsHide: true }))
        .rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("used by another process") });
      const outcome = await spawnWorker("Harmless fixture only", {
        cwd: fixtureDir,
        worker: "gh-copilot",
        model: "fixture-model&literal",
        timeout: 10_000,
        extraEnv: { PATH: fixture.path },
      });
      expect({ exitCode: outcome.exitCode, stderr: outcome.stderr }).toEqual({ exitCode: 0, stderr: "" });
      const output = JSON.parse(outcome.output);
      expect(output.launcher).toBe("installed-cli");
      expect(output.args.slice(-2)).toEqual(["--model", "fixture-model&literal"]);
      expect(output.args).toContain("--allow-all");
    } finally {
      const closed = once(lock, "close");
      lock.stdin.end("release\n");
      await closed;
    }
  }, 20_000);

  it("runs two workers from different directories without touching the locked bootstrap", async () => {
    const fixture = createLauncherFixture(fixtureDir);
    const lock = await holdExclusiveLock(fixture.bootstrapPath);
    try {
      const directories = ["run-one", "run-two"].map((name) => join(fixtureDir, name));
      for (const directory of directories) mkdirSync(directory);
      const outcomes = await Promise.all(directories.map((cwd) => spawnWorker("Harmless fixture only", {
        cwd, worker: "gh-copilot", timeout: 10_000, extraEnv: { PATH: fixture.path },
      })));
      expect(outcomes.map(({ exitCode }) => exitCode)).toEqual([0, 0]);
      expect(outcomes.map(({ output }) => JSON.parse(output).launcher)).toEqual(["installed-cli", "installed-cli"]);
    } finally {
      const closed = once(lock, "close");
      lock.stdin.end("release\n");
      await closed;
    }
  }, 20_000);
});

describe("Copilot launcher resolution", () => {
  let fixtureDir;
  let fixture;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "pforge-launcher-"));
    fixture = createLauncherFixture(fixtureDir);
  });
  afterEach(() => { rmSync(fixtureDir, { recursive: true, force: true }); });

  const args = ["--model", "value with spaces & literal"];

  function resolveFixture(extra = {}) {
    return resolveCopilotLauncher({ command: "copilot", args, cwd: fixtureDir, platform: "win32", env: { PATH: fixture.path }, ...extra });
  }

  it("uses the named package bin instead of a mutable wrapper", async () => {
    const launcher = await resolveFixture();
    expect(launcher.command).toBe(process.execPath);
    expect(launcher.args).toEqual([join(fixture.packageDir, "npm-loader.js"), ...args]);
    expect(launcher.direct).toBe(true);
    expect(launcher.bypassedBootstrap).toBe(join(fixture.bootstrapDir, "copilot.bat"));
  });

  it("uses a native install when that is next on PATH", async () => {
    const nativeDir = join(fixtureDir, "native");
    mkdirSync(nativeDir);
    const nativePath = join(nativeDir, "copilot.exe");
    writeFileSync(nativePath, "fixture descriptor only");
    const launcher = await resolveFixture({ env: { PATH: [fixture.bootstrapDir, nativeDir].join(";") } });
    expect(launcher).toMatchObject({ command: nativePath, args, direct: true });
  });

  it("preserves a custom launcher before the bootstrapper on PATH", async () => {
    const customDir = join(fixtureDir, "custom");
    mkdirSync(customDir);
    writeFileSync(join(customDir, "copilot.cmd"), "custom wrapper");
    const launcher = await resolveFixture({ env: { PATH: `${customDir};${fixture.path}` } });
    expect(launcher).toEqual({ command: "copilot", args, direct: false });
  });

  it.each(["claude", "gh", "copilot.exe"])("does not rewrite an explicitly selected command: %s", async (command) => {
    expect(await resolveFixture({ command })).toEqual({ command, args, direct: false });
  });

  it.each(["linux", "darwin"])("leaves %s launches unchanged", async (platform) => {
    expect(await resolveFixture({ platform })).toEqual({ command: "copilot", args, direct: false });
  });

  it("rejects bootstrap-only installations instead of launching an interactive installer", async () => {
    await expect(resolveFixture({ env: { PATH: fixture.bootstrapDir } })).rejects.toThrow("Install the standalone Copilot CLI");
  });

  it("does not read or execute a package bin outside the installed package", async () => {
    writeFileSync(join(fixture.packageDir, "package.json"), JSON.stringify({ name: "@github/copilot", bin: { copilot: "../../../outside.js" } }));
    await expect(resolveFixture()).rejects.toThrow("unrecognized script");
  });

  it("does not accept an unrelated package as the Copilot CLI", async () => {
    writeFileSync(join(fixture.packageDir, "package.json"), JSON.stringify({ name: "unrelated", bin: "npm-loader.js" }));
    await expect(resolveFixture()).rejects.toThrow("unrecognized script");
  });

  it("leaves normal missing-command handling intact when no bootstrapper is found", async () => {
    expect(await resolveFixture({ env: { PATH: fixtureDir } })).toEqual({ command: "copilot", args, direct: false });
  });
});