import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadGateRunnerMode, resolveDevcontainerCli, devcontainerExecArgs, runDevcontainerGate,
  ensureDevcontainerUp, devcontainerHasTool, _resetDevcontainerStateForTests,
} from "../orchestrator/devcontainer-gates.mjs";
import { runGate } from "../orchestrator/gate-runner.mjs";
import { preflightGates } from "../orchestrator/gate-preflight.mjs";

/**
 * A stand-in for the Dev Containers CLI: `up` succeeds, `exec … sh -c CMD`
 * answers from a tiny script table so tests do not need Docker.
 */
const FAKE_CLI = `
const args = process.argv.slice(2);
if (args[0] === "up") { console.log(JSON.stringify({ outcome: "success" })); process.exit(0); }
if (args[0] === "exec") {
  const cmd = args[args.length - 1];
  if (cmd === "command -v cargo") process.exit(1);
  if (cmd.startsWith("command -v ")) { console.log("/usr/bin/" + cmd.slice(11)); process.exit(0); }
  if (cmd.includes("fail")) { console.error("boom in container"); process.exit(2); }
  console.log("ran in container: " + cmd + " @ " + args[args.indexOf("--workspace-folder") + 1]);
  process.exit(0);
}
process.exit(9);
`;

describe("loadGateRunnerMode", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-devc-mode-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to host", () => {
    expect(loadGateRunnerMode(dir)).toBe("host");
  });

  it("reads devcontainer and ignores unknown values", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateRunner: "devcontainer" }));
    expect(loadGateRunnerMode(dir)).toBe("devcontainer");
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateRunner: "vm" }));
    expect(loadGateRunnerMode(dir)).toBe("host");
  });
});

describe("resolveDevcontainerCli", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-devc-cli-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs a PFORGE_DEVCONTAINER_CLI .js entry with node", () => {
    const entry = join(dir, "devcontainer.js");
    writeFileSync(entry, "");
    expect(resolveDevcontainerCli({ env: { PFORGE_DEVCONTAINER_CLI: entry }, platform: "linux" }))
      .toEqual({ command: process.execPath, prefix: [entry] });
  });

  it("maps the Windows npm shim to the package's JS entry", () => {
    const npmDir = join(dir, "npm");
    const pkg = join(npmDir, "node_modules", "@devcontainers", "cli");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(npmDir, "devcontainer.cmd"), "@echo off");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@devcontainers/cli", bin: { devcontainer: "devcontainer.js" } }));
    writeFileSync(join(pkg, "devcontainer.js"), "");
    expect(resolveDevcontainerCli({ env: { PATH: npmDir }, platform: "win32" }))
      .toEqual({ command: process.execPath, prefix: [join(pkg, "devcontainer.js")] });
  });

  // A Windows temp path ("C:\\…") cannot sit in a ":"-separated PATH, so this runs off Windows only.
  it.skipIf(process.platform === "win32")("uses devcontainer from PATH directly elsewhere", () => {
    writeFileSync(join(dir, "devcontainer"), "#!/bin/sh");
    expect(resolveDevcontainerCli({ env: { PATH: dir }, platform: "linux" })).toEqual({ command: join(dir, "devcontainer"), prefix: [] });
  });

  it("returns null when the CLI is not installed", () => {
    expect(resolveDevcontainerCli({ env: { PATH: dir }, platform: "win32" })).toBeNull();
    expect(resolveDevcontainerCli({ env: { PATH: dir }, platform: "linux" })).toBeNull();
  });
});

describe("devcontainerExecArgs", () => {
  it("passes the gate to sh -c as a single argument", () => {
    expect(devcontainerExecArgs({ cli: { command: "node", prefix: ["dc.js"] }, workspaceFolder: "/p", command: `npm test && echo "done"` }))
      .toEqual(["dc.js", "exec", "--workspace-folder", "/p", "sh", "-c", `npm test && echo "done"`]);
  });
});

describe("gates in a dev container", () => {
  let dir;
  const savedCli = process.env.PFORGE_DEVCONTAINER_CLI;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pf-devc-gate-"));
    const cli = join(dir, "fake-devcontainer.js");
    writeFileSync(cli, FAKE_CLI);
    process.env.PFORGE_DEVCONTAINER_CLI = cli;
    _resetDevcontainerStateForTests();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedCli === undefined) delete process.env.PFORGE_DEVCONTAINER_CLI;
    else process.env.PFORGE_DEVCONTAINER_CLI = savedCli;
  });

  it("runDevcontainerGate reports success and output", () => {
    const r = runDevcontainerGate({ command: "npm test", cwd: dir });
    expect(r).toMatchObject({ success: true, exitCode: 0 });
    expect(r.output).toContain("ran in container: npm test");
  });

  it("runDevcontainerGate reports failure with stderr", () => {
    const r = runDevcontainerGate({ command: "npm run fail", cwd: dir });
    expect(r).toMatchObject({ success: false, exitCode: 2 });
    expect(r.error).toContain("boom in container");
  });

  it("runGate routes through the container when gateRunner is devcontainer", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateRunner: "devcontainer" }));
    const r = runGate("npm test", dir);
    expect(r.success).toBe(true);
    expect(r.output).toContain("ran in container: npm test");
  });

  it("runGate still enforces the allowlist before reaching the container", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gateRunner: "devcontainer" }));
    expect(runGate("rmdir-everything now", dir).error).toMatch(/not in allowlist/);
  });

  it("ensureDevcontainerUp starts the container once per folder", () => {
    expect(ensureDevcontainerUp({ cwd: dir })).toMatchObject({ ok: true, started: true });
    expect(ensureDevcontainerUp({ cwd: dir })).toMatchObject({ ok: true, started: false });
  });

  it("preflight looks for gate tools inside the container", () => {
    const plan = { slices: [{ number: "1", validationGate: "swift build && cargo test" }] };
    const r = preflightGates({ plan, cwd: dir, hasTool: (tool) => devcontainerHasTool({ cwd: dir, tool }) });
    expect(r.missing).toEqual([{ slice: "1", command: "swift build && cargo test", tool: "cargo" }]);
  });
});

describe("without the CLI", () => {
  it("ensureDevcontainerUp explains how to install it", () => {
    _resetDevcontainerStateForTests();
    const r = ensureDevcontainerUp({ cwd: tmpdir(), env: { PATH: "" }, platform: "linux" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/@devcontainers\/cli/);
  });
});
