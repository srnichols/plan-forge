import { ChildProcess, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeSupervisor, nativeSupervisorRootExit, NATIVE_SCOPE_ERRORS,
  NATIVE_SUPERVISOR_STOP_MESSAGE,
} from "../src/jobs/native-command-supervisor.mjs";
import {
  nativePosixSupervisorLaunch, openPosixProcessScope,
} from "../src/jobs/posix-process-scope.mjs";

vi.mock("node:fs/promises", { spy: true });

const supervisorPath = fileURLToPath(new URL("../src/jobs/native-command-supervisor.mjs", import.meta.url));
const adapterPath = fileURLToPath(new URL("../src/jobs/posix-process-scope.mjs", import.meta.url));
const OWNED_DEADLINE_MS = 5_000;
const MAX_PROBE_BYTES = 16_384;
const resources = [];
let fixtureSequence = 0;

const MAC_NATIVE_MEASUREMENT = String.raw`
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
public static class ClawMacNativeMeasurement {
    const int UniqueInfoFlavor = 17, UniqueInfoBytes = 56;
    [StructLayout(LayoutKind.Sequential)]
    public struct UniqueInfo {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst=16)] public byte[] uuid;
        public ulong uniqueId, parentUniqueId;
        public int pidVersion, originalParentVersion;
        public ulong reserved2, reserved3;
    }
    [DllImport("libSystem.B.dylib")] static extern int getpid();
    [DllImport("libSystem.B.dylib")] static extern int getppid();
    [DllImport("libSystem.B.dylib")] static extern uint getuid();
    [DllImport("libproc.dylib", SetLastError=true)]
    static extern int proc_pidinfo(int pid, int flavor, ulong argument, out UniqueInfo identity, int bytes);
    static object Identity(int pid) {
        int bytes = proc_pidinfo(pid, UniqueInfoFlavor, 0, out var identity, UniqueInfoBytes);
        return new {
            pid, bytes, uniqueId = identity.uniqueId.ToString(CultureInfo.InvariantCulture),
            parentUniqueId = identity.parentUniqueId.ToString(CultureInfo.InvariantCulture),
            identity.pidVersion, identity.originalParentVersion
        };
    }
    public static string Run() {
        if (Marshal.SizeOf<UniqueInfo>() != UniqueInfoBytes) throw new InvalidOperationException("MAC_NATIVE_ABI_MISMATCH");
        string system = Path.Combine(Path.DirectorySeparatorChar + "usr", "lib", "libSystem.B.dylib");
        if (!NativeLibrary.TryLoad(system, out var library)) throw new InvalidOperationException("MAC_NATIVE_LIBRARY_UNAVAILABLE");
        try {
            var symbols = new Dictionary<string, bool>();
            foreach (string symbol in new[] { "responsibility_spawnattrs_setdisclaim",
                "responsibility_get_pid_responsible_for_pid", "posix_spawnattr_init", "posix_spawnattr_setflags" })
                symbols[symbol] = NativeLibrary.TryGetExport(library, symbol, out var address);
            return JsonSerializer.Serialize(new {
                platform = "darwin", uid = getuid(), self = Identity(getpid()), parent = Identity(getppid()),
                symbols, settlementConfirmed = false, facility = "macos-authoritative-descendant-scope",
                measurement = "symbol-availability-and-native-birth-only"
            });
        } finally { NativeLibrary.Free(library); }
    }
}
`;

async function measureMacNativeCapabilities() {
  let command;
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter).filter(path.isAbsolute)) {
    const candidate = path.join(directory, "pwsh");
    try { await access(candidate); command = candidate; break; } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
    }
  }
  if (!command) throw new Error("MAC_NATIVE_POWERSHELL_UNAVAILABLE");
  const script = `$ErrorActionPreference="Stop"\nAdd-Type -TypeDefinition @'\n${MAC_NATIVE_MEASUREMENT}\n'@\n[ClawMacNativeMeasurement]::Run()`;
  const hostFields = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE"];
  const env = Object.fromEntries(hostFields.filter((field) => Object.hasOwn(process.env, field))
    .map((field) => [field, process.env[field]]));
  const child = spawn(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")], { env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let bytes = 0;
  let failed = false;
  const capture = (chunk, isOutput) => {
    bytes += chunk.length;
    if (bytes > MAX_PROBE_BYTES) { failed = true; child.kill("SIGKILL"); }
    else if (isOutput) output += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk) => capture(chunk, true));
  child.stderr.on("data", (chunk) => capture(chunk, false));
  child.once("error", () => { failed = true; });
  const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, OWNED_DEADLINE_MS);
  const code = await new Promise((resolve) => child.once("close", resolve));
  clearTimeout(timer);
  if (failed || code !== 0) throw new Error("MAC_NATIVE_MEASUREMENT_FAILED");
  return JSON.parse(output.trim());
}

async function birth(pid) {
  const text = await readFile(path.join(path.sep, "proc", String(pid), "stat"), "utf8");
  const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
  return { state: fields[0], parentPid: Number(fields[1]), startedAt: fields[19] };
}

async function isLive(pid) {
  try { return !["Z", "X"].includes((await birth(pid)).state); } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return false;
    throw error;
  }
}

async function held(env = process.env, prepareLaunch = (launch) => launch) {
  const launch = prepareLaunch(await nativePosixSupervisorLaunch({
    node: process.execPath, supervisorPath, cwd: process.cwd(), env,
  }));
  const supervisor = createNativeSupervisor({ cwd: process.cwd(), env, launch });
  const resource = { supervisor, stdout: "", stderr: "" };
  resources.push(resource);
  supervisor.child.stdout.on("data", (chunk) => { resource.stdout += chunk.toString("utf8"); });
  supervisor.child.stderr.on("data", (chunk) => { resource.stderr += chunk.toString("utf8"); });
  expect(await supervisor.ready, resource.stderr).toBe(true);
  resource.scope = await openPosixProcessScope({
    rootPid: supervisor.child.pid, rootProcess: supervisor.child, env,
  });
  return resource;
}

async function execute(resource, script, args = []) {
  resource.supervisor.start(process.execPath, ["--input-type=module", "-e", script, "--", ...args]);
  return resource.supervisor.completion;
}

async function stop(resource) {
  const receipt = await resource.scope.terminate();
  await resource.supervisor.closed;
  expect(receipt).toMatchObject({
    rootPid: resource.supervisor.child.pid,
    rootStartedAt: resource.scope.rootStartedAt,
    rootReady: true,
    settlementConfirmed: true,
    unknownProcesses: 0,
  });
  expect(receipt.stoppedPids).toContain(receipt.rootPid);
  expect(await isLive(receipt.rootPid)).toBe(false);
  return receipt;
}

function detachedLeafScript() {
  const leaf = "setInterval(() => {}, 1000)";
  const creator = `const {spawn}=await import("node:child_process");
    const leaf=spawn(process.execPath,["-e",${JSON.stringify(leaf)}],{detached:true,stdio:"ignore"});
    process.stdout.write(String(leaf.pid)+"\\n"); leaf.unref();`;
  return `const {spawn}=await import("node:child_process");
    const creator=spawn(process.execPath,["--input-type=module","-e",${JSON.stringify(creator)}],
      {detached:true,stdio:["ignore","inherit","inherit"]}); creator.unref();`;
}

async function independentLeaf() {
  fixtureSequence += 1;
  const address = `\0pforge-claw-posix-fixture-${process.pid}-${fixtureSequence}`;
  const connection = Promise.withResolvers();
  const server = net.createServer((socket) => connection.resolve(socket));
  resources.push({ server });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, resolve);
  });
  const leaf = `const net=require("node:net");
    const socket=net.createConnection(${JSON.stringify(address)});
    socket.on("connect",()=>socket.write(String(process.pid)+"\\n"));
    socket.on("data",()=>{socket.end();process.exit(0)});
    socket.on("end",()=>process.exit(0));`;
  const creator = spawn(process.execPath, ["--input-type=module", "-e", `const {spawn}=await import("node:child_process");
    const leaf=spawn(process.execPath,["-e",${JSON.stringify(leaf)}],{detached:true,stdio:"ignore"});
    leaf.unref();`], { stdio: "ignore", shell: false });
  const creatorClosed = new Promise((resolve) => creator.once("close", resolve));
  const socket = await connection.promise;
  resources.push({ socket });
  const pid = await new Promise((resolve) => socket.once("data", (chunk) => resolve(Number(chunk.toString().trim()))));
  await creatorClosed;
  const identity = await birth(pid);
  return { pid, identity, socket };
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ scope, supervisor, socket, server }) => {
    if (socket) { socket.end("stop\n"); socket.destroy(); }
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scope) await scope.close();
    else if (supervisor) { supervisor.child.kill("SIGKILL"); await supervisor.closed; }
  }));
});

describe("Guard: POSIX ownership uses supported native facilities", () => {
  it("exports the same held-root launch and scope API on every OS", () => {
    expect(nativePosixSupervisorLaunch).toBeTypeOf("function");
    expect(openPosixProcessScope).toBeTypeOf("function");
    expect(createNativeSupervisor).toBeTypeOf("function");
  });

  it("rejects invalid roots before executing any platform helper", async () => {
    for (const rootPid of [0, -1, NaN, "1", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(openPosixProcessScope({ rootPid })).rejects.toMatchObject({
        code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
      });
    }
  });

  it("does not implement settlement with OS-wide snapshots or unsupported kqueue flags", async () => {
    const source = await readFile(adapterPath, "utf8");
    expect(source).not.toContain('spawn("ps"');
    expect(source).not.toContain("setpriv");
    expect(source).not.toContain("NOTE_TRACK");
    expect(source).toContain("pidfd");
    expect(source).toContain("waitpid");
    expect(source).toContain("ECHILD");
    expect(source).toContain("$before = Process-Identity");
    expect(source).toContain("$after = Process-Identity");
    expect(source).toContain("$after.Birth -cne $before.Birth");
    expect(source).toContain("Proc-Path @('self', 'fdinfo'");
    expect(source).not.toContain("Add-Type");
    expect(source).toContain("DefineMethod");
    expect(source).toContain("GetField('SetLastError')");
    expect(source).toContain("[Net.Sockets.Socket]::Select");
  });

  it("keeps helper discovery and observer environment independent from the argv actor", async () => {
    const source = await readFile(adapterPath, "utf8");
    expect(source).toContain("process.env.PATH");
    expect(source).not.toContain("brokerEnvironment");
    expect(source).toContain("nativeSupervisorRootExit(rootProcess)");
    expect(source).not.toContain("String(env.PATH");
    const supervisor = await readFile(supervisorPath, "utf8");
    expect(supervisor).toContain("supervisorEnvironment");
    expect(supervisor).toContain("actorEnvironment");
  });

  it.skipIf(process.platform === "linux")("reports the precise unavailable platform facility, never a fallback launch", async () => {
    await expect(nativePosixSupervisorLaunch({
      node: process.execPath, supervisorPath, cwd: process.cwd(), env: process.env,
    })).rejects.toMatchObject({
      code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
      details: { platform: process.platform, facility: expect.any(String) },
    });
  });
});

describe.skipIf(process.platform !== "linux")("Linux native subreaper ownership", () => {
  it("establishes native ownership and reaps the real scope when the C# compiler is unavailable", async () => {
    const resource = await held(process.env, (launch) => {
      const args = [...launch.args];
      const encodedIndex = args.indexOf("-EncodedCommand") + 1;
      expect(encodedIndex).toBeGreaterThan(0);
      const fixedScript = Buffer.from(args[encodedIndex], "base64").toString("utf16le");
      const refuseCompiler = 'function global:Add-Type { throw "OWNED_NATIVE_COMPILER_REFUSED" }\n';
      args[encodedIndex] = Buffer.from(refuseCompiler + fixedScript, "utf16le").toString("base64");
      return { command: launch.command, args };
    });
    expect(await execute(resource, "process.exitCode=7")).toEqual({ code: 7 });
    await stop(resource);
  });

  it("retains native errno metadata rather than certifying an invented ECHILD", async () => {
    const resource = await held(process.env, (launch) => {
      const args = [...launch.args];
      const encodedIndex = args.indexOf("-EncodedCommand") + 1;
      const fixedScript = Buffer.from(args[encodedIndex], "base64").toString("utf16le");
      const checkErrno = `Initialize-NativeImports
        $null = $Native::close(-1)
        if ([Runtime.InteropServices.Marshal]::GetLastPInvokeError() -ne 9) { Fail-Scope $Unconfirmed }`;
      expect(fixedScript).toContain("        Initialize-NativeImports\n");
      args[encodedIndex] = Buffer.from(fixedScript.replace("        Initialize-NativeImports\n",
        `${checkErrno}\n`), "utf16le").toString("base64");
      return { command: launch.command, args };
    });
    expect(await execute(resource, "process.exitCode=7")).toEqual({ code: 7 });
    await stop(resource);
  });

  it("refuses a real kernel subreaper capability error before READY or literal argv", async () => {
    const launch = await nativePosixSupervisorLaunch({
      node: process.execPath, supervisorPath, cwd: process.cwd(), env: process.env,
    });
    const encodedIndex = launch.args.indexOf("-EncodedCommand") + 1;
    const fixedScript = Buffer.from(launch.args[encodedIndex], "base64").toString("utf16le");
    expect(fixedScript).toContain("$script:SetChildSubreaper = 36");
    launch.args[encodedIndex] = Buffer.from(fixedScript.replace("$script:SetChildSubreaper = 36",
      "$script:SetChildSubreaper = -1"), "utf16le").toString("base64");
    const supervisor = createNativeSupervisor({ cwd: process.cwd(), env: process.env, launch });
    resources.push({ supervisor });
    supervisor.child.stdout.resume();
    supervisor.child.stderr.resume();
    expect(await supervisor.ready).toBe(false);
    expect(await supervisor.completion).toEqual({ code: -1, errorCode: NATIVE_SCOPE_ERRORS.UNAVAILABLE });
    await supervisor.closed;
    expect(await isLive(supervisor.child.pid)).toBe(false);
  });

  it("rejects a string version on private IPC without certifying settlement", async () => {
    const resource = await held();
    resource.supervisor.child.send({ v: "1", t: NATIVE_SUPERVISOR_STOP_MESSAGE });
    expect(await resource.supervisor.completion).toEqual({ code: -1, errorCode: NATIVE_SCOPE_ERRORS.UNCONFIRMED });
    await resource.supervisor.closed;
    const receipt = await resource.scope.terminate();
    expect(receipt).toMatchObject({
      settlementConfirmed: false, unknownProcesses: null, code: NATIVE_SCOPE_ERRORS.UNCONFIRMED,
    });
    expect(resource.stdout).toBe("");
    expect(await isLive(resource.scope.rootPid)).toBe(false);
  });

  it("preserves multibyte literal argv across fragmented private IPC reads", async () => {
    const resource = await held();
    const argument = "é🛠漢".repeat(4_096);
    expect(await execute(resource, "process.stdout.write(process.argv[1])", [argument])).toEqual({ code: 0 });
    await stop(resource);
    expect(resource.stdout).toBe(argument);
  });

  it("uses the retained real native child wait together with ECHILD, not a second compiler process", async () => {
    const source = await readFile(adapterPath, "utf8");
    expect(source).not.toContain("ClawPosixObserver");
    expect(source).toContain("rootProcess");
    expect(source).toContain("ECHILD");
    const supervisorSource = await readFile(supervisorPath, "utf8");
    expect(supervisorSource).toContain("NATIVE_ROOT_EXITS.set(child");
    expect(supervisorSource).toContain('child.once("exit"');
    for (let index = 0; index < 3; index += 1) {
      const resource = await held();
      expect(await execute(resource, "process.exitCode=7")).toEqual({ code: 7 });
      await stop(resource);
      await resource.scope.close();
    }
  }, 20_000);

  it("rejects a caller-supplied fake exit certificate before consuming native root authority", async () => {
    const launch = await nativePosixSupervisorLaunch({
      node: process.execPath, supervisorPath, cwd: process.cwd(), env: process.env,
    });
    const supervisor = createNativeSupervisor({ cwd: process.cwd(), env: process.env, launch });
    const resource = { supervisor };
    resources.push(resource);
    expect(await supervisor.ready).toBe(true);
    const counterfeitChild = new ChildProcess();
    counterfeitChild.pid = supervisor.child.pid;
    counterfeitChild.exitCode = 0;
    for (const rootProcess of [{ pid: supervisor.child.pid, exitCode: 0 }, counterfeitChild]) {
      await expect((async () => {
        resource.scope = await openPosixProcessScope({ rootPid: supervisor.child.pid, rootProcess });
      })()).rejects.toMatchObject({ code: NATIVE_SCOPE_ERRORS.UNAVAILABLE });
    }
    expect(await isLive(supervisor.child.pid)).toBe(true);
    resource.scope = await openPosixProcessScope({
      rootPid: supervisor.child.pid, rootProcess: supervisor.child,
    });
    expect(await execute(resource, "process.exitCode=7")).toEqual({ code: 7 });
    await stop(resource);
  }, OWNED_DEADLINE_MS);

  it("retains native exit state so a completed root certificate cannot be rebound to a reused PID", async () => {
    const resource = await held();
    const certificate = nativeSupervisorRootExit(resource.supervisor.child);
    expect(Object.isFrozen(certificate)).toBe(true);
    expect(certificate.exited).toBe(false);
    expect(await execute(resource, "process.exitCode=7")).toEqual({ code: 7 });
    await stop(resource);
    expect(certificate.exited).toBe(true);
    await expect(openPosixProcessScope({
      rootPid: certificate.rootPid, rootProcess: resource.supervisor.child,
    })).rejects.toMatchObject({
      code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
      details: { facility: "owned-native-child-handle" },
    });
  }, OWNED_DEADLINE_MS);

  it("holds real ownership before fast literal argv and proves root death within the existing 5s gate", async () => {
    // +0ms tolerance intentionally preserves the caller's original 5s deadline; elapsed time is not proof.
    const started = performance.now();
    const env = {
      ...process.env, PATH: path.join(process.cwd(), "not-a-runtime"),
      NODE_OPTIONS: "--no-warnings", DOTNET_STARTUP_HOOKS: "actor-only-value",
      PFORGE_POSIX_LITERAL_VALUE: "fixture value with 'quotes' and $punctuation",
    };
    const resource = await held(env);
    expect(resource.stdout).toBe("");
    expect(resource.scope.rootPid).toBe(resource.supervisor.child.pid);
    expect(resource.scope.rootStartedAt).toBe((await birth(resource.scope.rootPid)).startedAt);
    const args = ['literal "quote" and space', "$not-a-shell;$(not-run)", "trailing\\", ""];
    expect(await execute(resource, `process.stdout.write(JSON.stringify({
      argv:process.argv.slice(1),value:process.env.PFORGE_POSIX_LITERAL_VALUE,
      path:process.env.PATH,nodeOptions:process.env.NODE_OPTIONS,hooks:process.env.DOTNET_STARTUP_HOOKS,
      cwd:process.cwd()}));
      process.stderr.write("stderr");`, args)).toEqual({ code: 0 });
    await stop(resource);
    expect(JSON.parse(resource.stdout)).toEqual({
      argv: args, value: env.PFORGE_POSIX_LITERAL_VALUE, path: env.PATH,
      nodeOptions: env.NODE_OPTIONS, hooks: env.DOTNET_STARTUP_HOOKS, cwd: process.cwd(),
    });

    expect(resource.stderr).toBe("stderr");
    expect(performance.now() - started).toBeLessThan(OWNED_DEADLINE_MS);
  });

  it("stops a double-detached leaf after both unobserved creators exit", async () => {
    const resource = await held();
    expect(await execute(resource, detachedLeafScript())).toEqual({ code: 0 });
    await vi.waitFor(() => expect(resource.stdout.trim()).toMatch(/^\d+$/), { timeout: 1_000 });
    const leafPid = Number(resource.stdout.trim());
    const leafBirth = await birth(leafPid);
    expect(leafBirth.parentPid).toBe(resource.scope.rootPid);
    expect(await isLive(leafPid)).toBe(true);
    const receipt = await stop(resource);
    expect(receipt.stoppedPids).toContain(leafPid);
    expect(await isLive(leafPid)).toBe(false);
  });

  it("does not starve private start IPC behind the held stream on a bounded native worker pool", async () => {
    const resource = await held({
      ...process.env, DOTNET_ThreadPool_ForceMinWorkerThreads: "1", DOTNET_ThreadPool_ForceMaxWorkerThreads: "1",
    });
    expect(await execute(resource, "process.stdout.write('native-start-complete')")).toEqual({ code: 0 });
    await stop(resource);
    expect(resource.stdout).toBe("native-start-complete");
  });

  it("does not block or kill an independent survivor whose creator vanished between observations", async () => {
    const resource = await held();
    const independent = await independentLeaf();
    expect(independent.identity.parentPid).not.toBe(resource.scope.rootPid);
    expect(await execute(resource, "process.stdout.write('owned-fast')")).toEqual({ code: 0 });
    const receipt = await stop(resource);
    expect(receipt.stoppedPids).not.toContain(independent.pid);
    expect(await birth(independent.pid)).toMatchObject({
      startedAt: independent.identity.startedAt,
    });
    expect(await isLive(independent.pid)).toBe(true);
  });

  it("separates four concurrent held roots, escaped leaves and an independent creator", async () => {
    const independent = await independentLeaf();
    const roots = await Promise.all(Array.from({ length: 4 }, () => held()));
    expect(new Set(roots.map(({ scope }) => scope.rootPid)).size).toBe(4);
    const receipts = await Promise.all(roots.map(async (resource) => {
      expect(await execute(resource, detachedLeafScript())).toEqual({ code: 0 });
      await vi.waitFor(() => expect(resource.stdout.trim()).toMatch(/^\d+$/), { timeout: 1_000 });
      const leafPid = Number(resource.stdout.trim());
      const receipt = await stop(resource);
      expect(receipt.stoppedPids).toContain(leafPid);
      expect(await isLive(leafPid)).toBe(false);
      return receipt;
    }));
    for (const receipt of receipts) {
      for (const other of roots) {
        if (other.scope.rootPid !== receipt.rootPid) expect(receipt.stoppedPids).not.toContain(other.scope.rootPid);
      }
      expect(receipt.stoppedPids).not.toContain(independent.pid);
    }
    expect(await isLive(independent.pid)).toBe(true);
  });

  it("settles repeated fast code0 commands without treating code0 as the proof", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const resource = await held();
      expect(await execute(resource, "process.exit(0)")).toEqual({ code: 0 });
      expect(await isLive(resource.scope.rootPid)).toBe(true);
      await stop(resource);
    }
  }, 20_000);

  it("stops an executing owned command on cancellation and records actual zero membership", async () => {
    const resource = await held();
    resource.supervisor.start(process.execPath, ["-e", `process.stdout.write(String(process.pid));
      setInterval(()=>{},1000);`]);
    await vi.waitFor(() => expect(resource.stdout).toMatch(/^\d+$/), { timeout: 1_000 });
    const actorPid = Number(resource.stdout);
    const receipt = await stop(resource);
    expect(receipt.stoppedPids).toContain(actorPid);
    expect(await isLive(actorPid)).toBe(false);
  });

  it("denies root death without the native zero-children attestation", async () => {
    const resource = await held();
    resource.supervisor.child.kill("SIGKILL");
    await resource.supervisor.closed;
    const receipt = await resource.scope.terminate();
    expect(receipt).toMatchObject({
      rootPid: resource.scope.rootPid,
      rootStartedAt: resource.scope.rootStartedAt,
      rootReady: true,
      settlementConfirmed: false,
      unknownProcesses: null,
      code: NATIVE_SCOPE_ERRORS.UNCONFIRMED,
    });
  });

  it("does not attach to an unrelated real process or signal its PID", async () => {
    const independent = await independentLeaf();
    await expect(openPosixProcessScope({ rootPid: independent.pid, env: process.env })).rejects.toMatchObject({
      code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
    });
    expect(await isLive(independent.pid)).toBe(true);
    expect((await birth(independent.pid)).startedAt).toBe(independent.identity.startedAt);
  });

  it("denies a held ordinary Node root that has no established native ownership", async () => {
    const supervisor = createNativeSupervisor({ cwd: process.cwd(), env: process.env });
    resources.push({ supervisor });
    expect(await supervisor.ready).toBe(true);
    await expect(openPosixProcessScope({
      rootPid: supervisor.child.pid, rootProcess: supervisor.child,
    })).rejects.toMatchObject({
      code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
      details: { facility: "held-subreaper-root" },
    });
  });

  it("denies a caller-selected image or supervisor before native launch", async () => {
    await expect(nativePosixSupervisorLaunch({
      node: path.join(path.sep, "not-the-current-node"), supervisorPath, cwd: process.cwd(),
    })).rejects.toMatchObject({ code: NATIVE_SCOPE_ERRORS.UNAVAILABLE });
    await expect(nativePosixSupervisorLaunch({
      node: process.execPath, supervisorPath: adapterPath, cwd: process.cwd(),
    })).rejects.toMatchObject({ code: NATIVE_SCOPE_ERRORS.UNAVAILABLE });
  });

  it("refuses EACCES and EPERM at the OS executable edge before launching a command", async () => {
    try {
      for (const code of ["EACCES", "EPERM"]) {
        vi.mocked(access).mockRejectedValue(Object.assign(new Error("owned executable-access denial"), { code }));
        await expect(nativePosixSupervisorLaunch({
          node: process.execPath, supervisorPath, cwd: process.cwd(), env: process.env,
        })).rejects.toMatchObject({
          code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
          details: { facility: "powershell7" },
        });
      }
    } finally { vi.mocked(access).mockRestore(); }
  });

  it("denies unsealed startup-code hooks before returning a native launch", async () => {
    for (const field of ["CORECLR_PROFILER_PATH", "COR_PROFILER_PATH", "LD_AUDIT"]) {
      let isDenied = false;
      try {
        await nativePosixSupervisorLaunch({
          node: process.execPath, supervisorPath, cwd: process.cwd(),
          env: { ...process.env, [field]: "owned-non-executable-hook-canary" },
        });
      } catch (error) {
        isDenied = error.code === NATIVE_SCOPE_ERRORS.UNAVAILABLE
          && error.details.facility === "unsealed-native-launcher-environment";
      }
      expect(isDenied).toBe(true);
    }
  });

  it("returns the same settlement and closes idempotently", async () => {
    const resource = await held();
    expect(await execute(resource, "process.exit(0)")).toEqual({ code: 0 });
    const receipt = await stop(resource);
    expect(await resource.scope.terminate()).toEqual(receipt);
    await resource.scope.close();
    await resource.scope.close();
  });
});

describe.skipIf(process.platform !== "darwin")("macOS native capability measurement", () => {
  it("measures supported symbols and native own-process birth without crediting ownership", async () => {
    const measurement = await measureMacNativeCapabilities();
    expect(measurement).toMatchObject({
      platform: "darwin", uid: process.getuid(), settlementConfirmed: false,
      facility: "macos-authoritative-descendant-scope",
      self: { bytes: 56, uniqueId: expect.stringMatching(/^\d+$/) },
      parent: { pid: process.pid, bytes: 56, uniqueId: expect.stringMatching(/^\d+$/) },
    });
    for (const present of Object.values(measurement.symbols)) expect(present).toBeTypeOf("boolean");
    process.stdout.write(`MAC_NATIVE_MEASUREMENT ${JSON.stringify(measurement)}\n`);
    await expect(nativePosixSupervisorLaunch({
      node: process.execPath, supervisorPath, cwd: process.cwd(), env: process.env,
    })).rejects.toMatchObject({
      code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
      details: { platform: "darwin", facility: "macos-authoritative-descendant-scope" },
    });
  });
});
