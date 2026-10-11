import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNativeSupervisor, hasNativeSettlementProof, NATIVE_SCOPE_MAX_PROCESSES, NATIVE_SUPERVISOR_ARGUMENT,
} from "../src/jobs/native-command-supervisor.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";

const owned = [];
const TEST_TIMEOUT_MS = 15_000;

async function supervisor(env = process.env) {
  const cwd = await g1Directory("native-command-supervisor-");
  const root = createNativeSupervisor({ cwd, env });
  const output = { stdout: "", stderr: "" };
  root.child.stdout.setEncoding("utf8");
  root.child.stderr.setEncoding("utf8");
  root.child.stdout.on("data", (chunk) => { output.stdout += chunk; });
  root.child.stderr.on("data", (chunk) => { output.stderr += chunk; });
  owned.push({ root, cwd });
  expect(await root.ready).toBe(true);
  return { root, cwd, output };
}

afterEach(async () => {
  for (const { root, cwd } of owned.splice(0)) {
    root.child.kill();
    await root.closed;
    await rm(cwd, { recursive: true, force: true });
  }
});

describe("held native command supervisor", () => {
  it("does not claim a private IPC channel when imported by another program with the same flag", async () => {
    const cwd = await g1Directory("native-command-library-");
    const program = path.join(cwd, "library-import.mjs");
    await writeFile(program, `
      await import(${JSON.stringify(new URL("../src/jobs/native-command-supervisor.mjs", import.meta.url).href)});
      process.send({libraryImport:true});process.disconnect();
    `);
    const child = spawn(process.execPath, [program, NATIVE_SUPERVISOR_ARGUMENT], {
      cwd, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
    });

    const closed = new Promise((resolve) => child.once("close", resolve));
    owned.push({ cwd, root: { child, closed } });
    const messages = [];
    child.on("message", (message) => messages.push(message));
    expect(await closed).toBe(0);
    expect(messages).toEqual([{ libraryImport: true }]);
  }, TEST_TIMEOUT_MS);

  it("waits for the owner before executing exact literal argv and reports actual child completion", async () => {
    const { root, cwd, output } = await supervisor();
    const marker = path.join(cwd, "actor.json");
    const script = path.join(cwd, "actor.mjs");
    await writeFile(script, `
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));
      process.stdout.write("literal output");process.stderr.write("literal error");process.exitCode=23;
    `);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    const args = [script, 'quoted "literal"', "$not-a-shell;$(literal)", "ending\\"];
    root.start(process.execPath, args);
    expect(await root.completion).toEqual({ code: 23 });
    const actor = JSON.parse(await readFile(marker, "utf8"));
    expect(actor.args).toEqual(args.slice(1));
    expect(actor.pid).not.toBe(root.child.pid);
    expect(output).toEqual({ stdout: "literal output", stderr: "literal error" });
  }, TEST_TIMEOUT_MS);

  it("seals supervisor loaders and restores the exact loader environment to the actual actor", async () => {
    const directory = await g1Directory("native-command-preload-");
    const preload = path.join(directory, "preload.mjs");
    const marker = path.join(directory, "preload.json");
    await mkdir(directory, { recursive: true });
    await writeFile(preload, `
      import { writeFileSync } from "node:fs";
      process.env.CLAW_NATIVE_ACTOR_ONLY="loaded";
      writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));
    `);
    try {
      const { root, output } = await supervisor({
        ...process.env, NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(preload).href)}`,
      });
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
      root.start(process.execPath, ["-e", 'process.stdout.write(process.env.CLAW_NATIVE_ACTOR_ONLY||"missing")']);
      expect(await root.completion).toEqual({ code: 0 });
      expect(output.stdout).toBe("loaded");
      expect(JSON.parse(await readFile(marker, "utf8")).pid).not.toBe(root.child.pid);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it("refuses duplicate execution and invalid argv before sending a command", async () => {
    const { root } = await supervisor();
    expect(() => root.start(process.execPath, ["nul\0argument"])).toThrowError(expect.objectContaining({
      code: "COMMAND_INVALID",
    }));
    root.start(process.execPath, ["-e", "process.exitCode=0"]);
    expect(() => root.start(process.execPath, [])).toThrowError(expect.objectContaining({ code: "COMMAND_FAILED" }));
    expect(await root.completion).toEqual({ code: 0 });
  }, TEST_TIMEOUT_MS);

  it("returns only the typed missing-executable error without treating root readiness as execution", async () => {
    const { root, cwd } = await supervisor();
    root.start(path.join(cwd, "not-an-executable"), []);
    expect(await root.completion).toEqual({ code: -1, errorCode: "ENOENT" });
  }, TEST_TIMEOUT_MS);

  it.runIf(process.platform === "win32")("refuses case variants of the private bootstrap namespace before launch", async () => {
    const cwd = await g1Directory("native-command-private-env-");
    let root;
    try {
      expect(() => {
        root = createNativeSupervisor({
          cwd, env: { ...process.env, pforge_claw_native_bootstrap_NODE_OPTIONS: "caller-owned" },
        });
      }).toThrowError(expect.objectContaining({ code: "COMMAND_ENV_INVALID" }));
    } finally {
      if (root) {
        root.child.kill();
        await root.closed;
      }
      await rm(cwd, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);
});

describe("native settlement metadata guard", () => {
  const complete = {
    rootPid: 100, rootStartedAt: "native-birth", rootReady: true,
    settlementConfirmed: true, unknownProcesses: 0, stoppedPids: [100],
  };

  it("requires identity, readiness and an explicit native zero-member measurement", () => {
    expect(hasNativeSettlementProof(complete)).toBe(true);
  });

  it.each([
    null, {}, { ...complete, rootReady: false }, { ...complete, rootStartedAt: "" },
    { ...complete, code: "PLAN_PROCESS_SCOPE_UNCONFIRMED" },
    { ...complete, settlementConfirmed: false }, { ...complete, unknownProcesses: null },
    { ...complete, stoppedPids: [] }, { ...complete, stoppedPids: [100, "101"] },
    { ...complete, stoppedPids: Array.from({ length: NATIVE_SCOPE_MAX_PROCESSES + 1 }, () => 100) },
  ])("does not infer proof from missing, contradictory or unbounded metadata", (scope) => {
    expect(hasNativeSettlementProof(scope)).toBe(false);
  });
});
