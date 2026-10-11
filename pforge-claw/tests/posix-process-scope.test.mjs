import { ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeSupervisor, nativeSupervisorRootExit, NATIVE_SCOPE_ERRORS,
  NATIVE_SUPERVISOR_STOP_MESSAGE,
} from "../src/jobs/native-command-supervisor.mjs";
import {
  nativePosixSupervisorLaunch, openPosixProcessScope,
} from "../src/jobs/posix-process-scope.mjs";

vi.mock("node:fs/promises", { spy: true });
vi.mock("node:child_process", { spy: true });

const supervisorPath = fileURLToPath(new URL("../src/jobs/native-command-supervisor.mjs", import.meta.url));
const adapterPath = fileURLToPath(new URL("../src/jobs/posix-process-scope.mjs", import.meta.url));
const OWNED_DEADLINE_MS = 5_000;
const MAX_PROBE_BYTES = 16_384;
const EXITED_PROC_STATES = Object.freeze(["Z", "X"]);
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
  try { return !EXITED_PROC_STATES.includes((await birth(pid)).state); } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return false;
    throw error;
  }
}

function expectLiveGeneration(identity, startedAt) {
  expect(identity.startedAt).toBe(startedAt);
  expect(EXITED_PROC_STATES).not.toContain(identity.state);
}

async function creatorGenerationExited(pid, startedAt) {
  try {
    const identity = await birth(pid);
    if (identity.startedAt !== startedAt) throw new Error("DETACHED_CREATOR_PID_REUSED");
    return EXITED_PROC_STATES.includes(identity.state);
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error.code)) return true;
    throw error;
  }
}

function collectNativeText(resource, stream) {
  const decoder = new StringDecoder("utf8");
  const output = resource.supervisor.child[stream];
  output.on("data", (chunk) => { resource[stream] += decoder.write(chunk); });
  output.once("end", () => { resource[stream] += decoder.end(); });
}

function rewriteNativeLauncher(launch, rewrite) {
  const args = [...launch.args];
  const encodedIndex = args.indexOf("-EncodedCommand") + 1;
  expect(encodedIndex).toBeGreaterThan(0);
  const script = Buffer.from(args[encodedIndex], "base64").toString("utf16le");
  args[encodedIndex] = Buffer.from(rewrite(script), "utf16le").toString("base64");
  return { command: launch.command, args };
}

async function held(env = process.env, prepareLaunch = (launch) => launch, cwd = process.cwd()) {
  const launch = prepareLaunch(await nativePosixSupervisorLaunch({
    node: process.execPath, supervisorPath, cwd, env,
  }));
  const supervisor = createNativeSupervisor({ cwd, env, launch });
  const resource = { supervisor, stdout: "", stderr: "" };
  resources.push(resource);
  for (const stream of ["stdout", "stderr"]) collectNativeText(resource, stream);
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

async function rejectPrivateVersion(version) {
  const resource = await held();
  resource.supervisor.child.send({ v: version, t: NATIVE_SUPERVISOR_STOP_MESSAGE });
  expect(await resource.supervisor.completion).toEqual({ code: -1, errorCode: NATIVE_SCOPE_ERRORS.UNCONFIRMED });
  await resource.supervisor.closed;
  expect(await resource.scope.terminate()).toMatchObject({
    settlementConfirmed: false, unknownProcesses: null, code: NATIVE_SCOPE_ERRORS.UNCONFIRMED,
  });
  expect(resource.stdout).toBe("");
  expect(await isLive(resource.scope.rootPid)).toBe(false);
}

async function commandFixture() {
  const fixtures = path.resolve("tests", ".posix-command-fixtures");
  await mkdir(fixtures, { recursive: true });
  const directory = await mkdtemp(path.join(fixtures, "argv-"));
  resources.push({ directory });
  return directory;
}

async function plainCommand(command, args, { cwd, env }) {
  const supervisor = createNativeSupervisor({ cwd, env });
  const resource = { supervisor, stdout: "", stderr: "" };
  for (const stream of ["stdout", "stderr"]) collectNativeText(resource, stream);
  try {
    expect(await supervisor.ready).toBe(true);
    supervisor.start(command, args);
    const completed = await supervisor.completion;
    await supervisor.stop();
    return { code: completed.code, errorCode: completed.errorCode ?? null,
      stdout: resource.stdout, stderr: resource.stderr };
  } finally { await supervisor.stop(); }
}

function detachedLeafScript(gateAddress) {
  const leaf = "setInterval(() => {}, 1000)";
  const gate = gateAddress ? `const{createConnection}=await import("node:net");
    const gate=createConnection(${JSON.stringify(gateAddress)});
    const connected=new Promise((resolve,reject)=>{gate.once("connect",resolve);gate.once("error",reject)});
    const released=new Promise(resolve=>{gate.once("data",resolve);gate.once("end",resolve)});` : "";
  const announcement = gateAddress ? `await connected;
    gate.write(JSON.stringify({pid:process.pid})+"\\n");await released;gate.end();` : "";
  const creator = `${gate}const {spawn}=await import("node:child_process");
    const leaf=spawn(process.execPath,["-e",${JSON.stringify(leaf)}],{detached:true,stdio:"ignore"});
    process.stdout.write(String(leaf.pid)+"\\n"); leaf.unref();${announcement}`;
  return `const {spawn}=await import("node:child_process");
    const creator=spawn(process.execPath,["--input-type=module","-e",${JSON.stringify(creator)}],
      {detached:true,stdio:["ignore","inherit","inherit"]}); creator.unref();`;
}

async function detachedCreatorGate() {
  fixtureSequence += 1;
  const gate = { address: `\0pforge-posix-adoption-${process.pid}-${fixtureSequence}`, creator: null };
  const server = net.createServer((socket) => {
    resources.push({ socket });
    gate.socket = socket;
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk.toString("ascii");
      try {
        if (text.length > MAX_PROBE_BYTES) throw new Error("DETACHED_CREATOR_GATE_LIMIT");
        if (!text.includes("\n")) return;
        const creator = JSON.parse(text.slice(0, text.indexOf("\n")));
        if (!Number.isSafeInteger(creator.pid) || creator.pid <= 0)
          throw new Error("DETACHED_CREATOR_GATE_IDENTITY");
        gate.creator = creator;
      } catch (error) { gate.error = error; socket.destroy(); }
    });
    socket.once("error", (error) => { gate.error = error; });
    socket.once("end", () => { if (!gate.creator) gate.error = new Error("DETACHED_CREATOR_GATE_EOF"); });
  });
  resources.push({ server });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(gate.address, resolve); });
  return gate;
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
  await Promise.all(resources.splice(0).map(async ({ scope, supervisor, socket, server, directory }) => {
    if (socket) { socket.end("stop\n"); socket.destroy(); }
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scope) await scope.close();
    else if (supervisor) { supervisor.child.kill("SIGKILL"); await supervisor.closed; }
    if (directory) await rm(directory, { recursive: true, force: true });
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

  it("keeps the fixed native frame and environment path independent of utility cmdlets", async () => {
    const source = await readFile(adapterPath, "utf8");
    for (const command of ["ConvertTo-Json", "ConvertFrom-Json", "Where-Object", "Import-Module"])
      expect(source).not.toContain(command);
    expect(source).toContain("[Text.Json.JsonDocument]::Parse");
    expect(source).toContain("[Text.Json.Utf8JsonWriter]::new");
    expect(source).toContain("TryGetInt64");
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
  it.each(["path", "empty-path", "path-denied-then-found", "path-notdir-then-found", "relative",
    "default-path", "text-executable", "missing", "permission", "directory", "argument-limit", "signal"])(
    "matches real Node spawn argv/PATH/status/error semantics for %s", async (kind) => {
      const cwd = await commandFixture();
      const bin = path.join(cwd, "bin");
      const denied = path.join(cwd, "denied");
      await mkdir(bin);
      await mkdir(denied);
      await symlink(process.execPath, path.join(bin, "actor"));
      await symlink(process.execPath, path.join(cwd, "actor"));
      await writeFile(path.join(denied, "actor"), "not executable");
      const relative = path.join(cwd, "report.mjs");
      await writeFile(relative, `import{readFileSync}from"node:fs";process.stdout.write(JSON.stringify({argv:process.argv.slice(2),argv0:process.argv0,cwd:process.cwd(),stdinBytes:readFileSync(0).length}));process.stderr.write("stderr");process.exitCode=7;`);
      const env = { ...process.env, PATH: bin };
      let command = "actor";
      let args = [relative, "literal quote'\";$value", "trailing\\", "", "é🛠漢"];
      if (kind === "empty-path") env.PATH = "";
      if (kind === "path-denied-then-found") env.PATH = [denied, bin].join(path.delimiter);
      if (kind === "path-notdir-then-found") env.PATH = [relative, bin].join(path.delimiter);
      if (kind === "relative") command = `.${path.sep}actor`;
      if (kind === "default-path") { delete env.PATH; command = "true"; args = []; }
      if (kind === "text-executable") {
        command = `.${path.sep}plain-command`;
        await writeFile(path.join(cwd, "plain-command"), 'printf "%s" "$1"; printf "stderr" >&2; exit 7\n');
        await chmod(path.join(cwd, "plain-command"), 0o755);
        args = ["literal quote'\";$value", "", "é🛠漢"];
      }
      if (kind === "missing") { command = path.join(cwd, "missing"); args = []; }
      if (kind === "permission") { command = path.join(denied, "actor"); args = []; }
      if (kind === "directory") { command = bin; args = []; }
      if (kind === "argument-limit") args = [relative, "x".repeat(131_072)];
      if (kind === "signal") args = ["-e", 'process.kill(process.pid, "SIGTERM")'];
      const baseline = await plainCommand(command, args, { cwd, env });
      const resource = await held(env, (launch) => launch, cwd);
      resource.supervisor.start(command, args);
      const actual = await resource.supervisor.completion;
      await stop(resource);
      expect({
        code: actual.code, errorCode: actual.errorCode ?? null, stdout: resource.stdout, stderr: resource.stderr,
      }).toEqual(baseline);
    });

  it.each(["2026-10-11T19:15:30.000Z", "\ud800", "\udc00"])(
    "matches real Node literal argv encoding for %j", async (argument) => {
      const cwd = await commandFixture();
      const env = { ...process.env };
      const args = ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", argument];
      const baseline = await plainCommand(process.execPath, args, { cwd, env });
      const resource = await held(env, (launch) => launch, cwd);
      resource.supervisor.start(process.execPath, args);
      const actual = await resource.supervisor.completion;
      await stop(resource);
      expect({
        code: actual.code, errorCode: actual.errorCode ?? null, stdout: resource.stdout, stderr: resource.stderr,
      }).toEqual(baseline);
    });

  it("restores actor-only bootstrap values and removes private Node channel metadata", async () => {
    const cwd = await commandFixture();
    const fields = {
      NODE_OPTIONS: "--no-warnings", NODE_PATH: "actor-module-canary", PSModulePath: "actor-only-modules",
      DOTNET_STARTUP_HOOKS: "actor-only-hooks", DOTNET_ADDITIONAL_DEPS: "actor-only-deps",
      DOTNET_SHARED_STORE: "actor-only-store", LD_LIBRARY_PATH: "actor-only-library-directory",
      NODE_DEBUG: "", NODE_DEBUG_NATIVE: "",
    };
    const env = { ...process.env, ...fields, PATH: "actor-only-path", EMPTY_CANARY: "" };
    const resource = await held(env, (launch) => launch, cwd);
    const names = [...Object.keys(fields), "PATH", "EMPTY_CANARY"];
    expect(await execute(resource, `process.stdout.write(JSON.stringify({
      values:Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,process.env[name]])),
      cwd:process.cwd(),channel:process.env.NODE_CHANNEL_FD??null,mode:process.env.NODE_CHANNEL_SERIALIZATION_MODE??null,
      send:typeof process.send,privateFields:Object.keys(process.env).filter(name=>name.startsWith("PFORGE_CLAW_NATIVE_BOOTSTRAP_"))
    }));`)).toEqual({ code: 0 });
    await stop(resource);
    expect(JSON.parse(resource.stdout)).toEqual({
      values: { ...fields, PATH: env.PATH, EMPTY_CANARY: "" }, cwd, channel: null, mode: null,
      send: "undefined", privateFields: [],
    });
  });

  it("rejects invalid literal command frames before an actor is created", async () => {
    const resource = await held();
    resource.supervisor.child.send({ v: 1, t: "owned-start", command: process.execPath, args: [null] });
    expect(await resource.supervisor.completion).toEqual({ code: -1, errorCode: "COMMAND_INVALID" });
    const receipt = await stop(resource);
    expect(receipt.stoppedPids).toEqual([receipt.rootPid]);
    expect(resource.stdout).toBe("");
  });

  it("resets an ignored native signal for the literal actor without changing root authority", async () => {
    const resource = await held(process.env, (launch) => rewriteNativeLauncher(launch, (script) =>
      script.replace("    $script:Native = $script:NativeBuilder.CreateType()",
        "    Add-NativeMethod 'signal' ([IntPtr]) @([int], [IntPtr])\n    $script:Native = $script:NativeBuilder.CreateType()")
      .replace("        Establish-Subreaper\n", "        Establish-Subreaper\n        $null = $Native::signal(15, [IntPtr]1)\n")));
    resource.supervisor.start("sh", ["-c", 'kill -TERM $$; printf "signal incorrectly ignored"']);
    expect(await resource.supervisor.completion).toEqual({ code: -1 });
    await stop(resource);
    expect(resource.stdout).toBe("");
  });

  it("does not execute START before native attach and never certifies that refused path", async () => {
    const launch = await nativePosixSupervisorLaunch({ node: process.execPath, supervisorPath, cwd: process.cwd() });
    const supervisor = createNativeSupervisor({ cwd: process.cwd(), launch });
    resources.push({ supervisor });
    supervisor.child.stdout.resume();
    supervisor.child.stderr.resume();
    expect(await supervisor.ready).toBe(true);
    supervisor.start(process.execPath, ["-e", "process.exitCode=7"]);
    expect(await supervisor.completion).toEqual({ code: -1, errorCode: NATIVE_SCOPE_ERRORS.UNCONFIRMED });
    await supervisor.closed;
    await expect(openPosixProcessScope({
      rootPid: supervisor.child.pid, rootProcess: supervisor.child,
    })).rejects.toMatchObject({ code: NATIVE_SCOPE_ERRORS.UNAVAILABLE });
  });

  it("makes native READY independent of a second Node loader held before actor START", async () => {
    const fixtures = path.resolve("tests", ".posix-bootstrap-fixtures");
    await mkdir(fixtures, { recursive: true });
    const directory = await mkdtemp(path.join(fixtures, "loader-hold-"));
    resources.push({ directory });
    fixtureSequence += 1;
    const address = `\0pforge-posix-loader-${process.pid}-${fixtureSequence}`;
    let connections = 0;
    let releaseActor = false;
    const sockets = [];
    const server = net.createServer((socket) => {
      connections += 1;
      sockets.push(socket);
      resources.push({ socket });
      if (releaseActor) socket.end("release");
    });
    resources.push({ server });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(address, resolve);
    });
    const loader = path.join(directory, "held-loader.mjs");
    await writeFile(loader, `
      import { createConnection } from "node:net";
      const channel = createConnection(${JSON.stringify(address)});
      await new Promise((resolve, reject) => { channel.once("data", resolve); channel.once("error", reject); });
      channel.destroy();
    `);
    const actual = await vi.importActual("node:child_process");
    const loaderOptions = `--import=${pathToFileURL(loader).href}`;
    vi.mocked(spawn).mockImplementation((command, args, options) => actual.spawn(command, args,
      path.basename(command) === "pwsh" ? { ...options, env: { ...options.env, NODE_OPTIONS: loaderOptions } } : options));
    let supervisor;
    let scope;
    let timer;
    try {
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      const launch = await nativePosixSupervisorLaunch({ node: process.execPath, supervisorPath, cwd: process.cwd(), env });
      supervisor = createNativeSupervisor({ cwd: process.cwd(), env, launch });
      supervisor.child.stdout.resume();
      supervisor.child.stderr.resume();
      const deadline = new Promise((_, reject) => {
        // +0ms preserves the native3s control bound; an actual loader/socket gate, not time, selects the dependency.
        timer = setTimeout(() => reject(new Error("SECOND_NODE_BOOTSTRAP_BLOCKED_NATIVE_READY")), 3_000);
      });
      expect(await Promise.race([supervisor.ready, deadline])).toBe(true);
      scope = await openPosixProcessScope({ rootPid: supervisor.child.pid, rootProcess: supervisor.child });
      expect(connections).toBe(0);
      releaseActor = true;
      for (const socket of sockets) socket.end("release");
      supervisor.start(process.execPath, ["-e", "process.exitCode=7"]);
      expect(await supervisor.completion).toEqual({ code: 7 });
      const receipt = await scope.terminate();
      expect(receipt).toMatchObject({ rootReady: true, settlementConfirmed: true, unknownProcesses: 0 });
      expect(receipt.stoppedPids).toContain(receipt.rootPid);
      expect(connections).toBe(1);
      await supervisor.closed;
    } finally {
      clearTimeout(timer);
      vi.mocked(spawn).mockRestore();
      for (const socket of sockets) socket.end("release");
      if (scope) await scope.close();
      else if (supervisor) await supervisor.stop();
    }
  });

  it("establishes native ownership and reaps the real scope when the C# compiler is unavailable", async () => {
    const resource = await held(process.env, (launch) => rewriteNativeLauncher(launch,
      (script) => 'function global:Add-Type { throw "OWNED_NATIVE_COMPILER_REFUSED" }\n' + script));
    expect(await execute(resource, "process.exitCode=7")).toEqual({ code: 7 });
    await stop(resource);
  });

  it("completes native READY, attach, argv and genuine zero without utility cmdlets or module autoload", async () => {
    const refuseUtilities = String.raw`
$PSModuleAutoLoadingPreference = 'None'
function global:ConvertTo-Json {
    [Console]::Error.WriteLine('OWNED_NATIVE_UTILITY_CMDLET_REFUSED|ConvertTo-Json')
    throw 'OWNED_NATIVE_UTILITY_CMDLET_REFUSED'
}
function global:ConvertFrom-Json {
    [Console]::Error.WriteLine('OWNED_NATIVE_UTILITY_CMDLET_REFUSED|ConvertFrom-Json')
    throw 'OWNED_NATIVE_UTILITY_CMDLET_REFUSED'
}
function global:Where-Object {
    [Console]::Error.WriteLine('OWNED_NATIVE_UTILITY_CMDLET_REFUSED|Where-Object')
    throw 'OWNED_NATIVE_UTILITY_CMDLET_REFUSED'
}
function global:Import-Module { throw 'OWNED_NATIVE_MODULE_IMPORT_REFUSED' }
`;
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        // +0ms retains the original3s READY bound; real utility refusal, not elapsed time, selects the dependency.
        timer = setTimeout(() => reject(new Error("NATIVE_UTILITY_DEPENDENT_READY")), 3_000);
      });
      const resource = await Promise.race([held(process.env, (launch) => rewriteNativeLauncher(launch,
        (script) => refuseUtilities + script)), deadline]);
      clearTimeout(timer);
      const args = ['literal "quote" and space', "", "é🛠漢", "trailing\\"];
      expect(await execute(resource, "process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exitCode=7;",
        args)).toEqual({ code: 7 });
      await stop(resource);
      expect(JSON.parse(resource.stdout)).toEqual(args);
      expect(resource.stderr).toBe("");
    } finally { clearTimeout(timer); }
  });

  it.each([true, null, 1.5])("rejects a noninteger private frame version %j without granting native proof", rejectPrivateVersion);

  it.each(["1.0", "1e0"])("rejects lexical noninteger version %s on the real peer-checked attach socket", async (version) => {
    const launch = await nativePosixSupervisorLaunch({ node: process.execPath, supervisorPath, cwd: process.cwd() });
    const supervisor = createNativeSupervisor({ cwd: process.cwd(), launch });
    resources.push({ supervisor });
    supervisor.child.stdout.resume();
    supervisor.child.stderr.resume();
    expect(await supervisor.ready).toBe(true);
    const identity = await birth(supervisor.child.pid);
    const socket = net.createConnection(`\0pforge-claw-posix-${supervisor.child.pid}-${identity.startedAt}`);
    resources.push({ socket });
    await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    socket.write(`{"v":${version},"operation":"attach","rootPid":${supervisor.child.pid},`
      + `"rootStartedAt":${JSON.stringify(identity.startedAt)}}\n`);
    expect(await supervisor.completion).toEqual({ code: -1, errorCode: NATIVE_SCOPE_ERRORS.UNCONFIRMED });
    await supervisor.closed;
    await expect(openPosixProcessScope({
      rootPid: supervisor.child.pid, rootProcess: supervisor.child,
    })).rejects.toMatchObject({ code: NATIVE_SCOPE_ERRORS.UNAVAILABLE });
    expect(await isLive(supervisor.child.pid)).toBe(false);
  });

  it("retains native errno metadata rather than certifying an invented ECHILD", async () => {
    const resource = await held(process.env, (launch) => rewriteNativeLauncher(launch, (script) => {
      const checkErrno = `Initialize-NativeImports
        $null = $Native::close(-1)
        if ([Runtime.InteropServices.Marshal]::GetLastPInvokeError() -ne 9) { Fail-Scope $Unconfirmed }`;
      expect(script).toContain("        Initialize-NativeImports\n");
      return script.replace("        Initialize-NativeImports\n", `${checkErrno}\n`);
    }));
    expect(await execute(resource, "process.exitCode=7")).toEqual({ code: 7 });
    await stop(resource);
  });

  it("refuses a real kernel subreaper capability error before READY or literal argv", async () => {
    const launch = rewriteNativeLauncher(await nativePosixSupervisorLaunch({
      node: process.execPath, supervisorPath, cwd: process.cwd(), env: process.env,
    }), (script) => {
      expect(script).toContain("$script:SetChildSubreaper = 36");
      return script.replace("$script:SetChildSubreaper = 36", "$script:SetChildSubreaper = -1");
    });
    const supervisor = createNativeSupervisor({ cwd: process.cwd(), env: process.env, launch });
    resources.push({ supervisor });
    supervisor.child.stdout.resume();
    supervisor.child.stderr.resume();
    expect(await supervisor.ready).toBe(false);
    expect(await supervisor.completion).toEqual({ code: -1, errorCode: NATIVE_SCOPE_ERRORS.UNAVAILABLE });
    await supervisor.closed;
    expect(await isLive(supervisor.child.pid)).toBe(false);
  });

  it("rejects a string version on private IPC without certifying settlement", () => rejectPrivateVersion("1"));

  it("preserves multibyte literal argv across fragmented private IPC reads", async () => {
    const resource = await held();
    const argument = "é🛠漢".repeat(4_096);
    expect(await execute(resource, "process.stdout.write(process.argv[1])", [argument])).toEqual({ code: 0 });
    await stop(resource);
    expect(resource.stdout).toBe(argument);
  });

  it("preserves raw native output split inside a multibyte character after the first fragment is consumed", async () => {
    const resource = await held();
    const argument = "é🛠漢".repeat(4_096);
    const expectedBytes = Buffer.from(argument, "utf8");
    const splitByte = 4;
    const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const rawFragments = [];
    resource.supervisor.child.stdout.on("data", (chunk) => rawFragments.push(chunk));
    const firstFragment = new Promise((resolve) => resource.supervisor.child.stdout.once("data", resolve));
    fixtureSequence += 1;
    const address = `\0pforge-claw-posix-utf8-${process.pid}-${fixtureSequence}`;
    const connected = Promise.withResolvers();
    const reportedArgv = Promise.withResolvers();
    const server = net.createServer((socket) => {
      resources.push({ socket });
      socket.once("data", (chunk) => reportedArgv.resolve(JSON.parse(chunk.toString("utf8"))));
      connected.resolve(socket);
    });
    resources.push({ server });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(address, resolve);
    });
    const executing = execute(resource, `
      const { createConnection } = await import("node:net");
      const { createHash } = await import("node:crypto");
      const channel = createConnection(${JSON.stringify(address)});
      await new Promise((resolve, reject) => { channel.once("connect", resolve); channel.once("error", reject); });
      const bytes = Buffer.from(process.argv[1], "utf8");
      channel.write(JSON.stringify({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
      const released = new Promise((resolve) => channel.once("data", resolve));
      await new Promise((resolve) => process.stdout.write(bytes.subarray(0, ${splitByte}), resolve));
      await released;
      await new Promise((resolve) => process.stdout.write(bytes.subarray(${splitByte}), resolve));
      channel.end();
    `, [argument]);
    const socket = await connected.promise;
    const argv = await reportedArgv.promise;
    const firstChunk = await firstFragment;
    socket.write("continue");
    expect(await executing).toEqual({ code: 0 });
    await stop(resource);
    expect(Buffer.isBuffer(firstChunk), JSON.stringify({
      firstChunkType: typeof firstChunk, firstChunkIsBuffer: Buffer.isBuffer(firstChunk), splitByte,
    })).toBe(true);
    expect(rawFragments.length).toBeGreaterThanOrEqual(2);
    expect(rawFragments.every((chunk) => Buffer.isBuffer(chunk))).toBe(true);
    expect(firstChunk.equals(expectedBytes.subarray(0, splitByte))).toBe(true);
    const raw = Buffer.concat(rawFragments);
    expect(argv).toEqual({ bytes: expectedBytes.length, sha256: digest(expectedBytes) });
    expect(raw.length).toBe(expectedBytes.length);
    expect(digest(raw)).toBe(digest(expectedBytes));
    expect(raw.equals(expectedBytes)).toBe(true);
    expect(resource.stdout === argument, JSON.stringify({
      splitByte, argvBytes: argv.bytes, rawBytes: raw.length, rawSha256: digest(raw),
      decodedBytes: Buffer.byteLength(resource.stdout), decodedSha256: digest(resource.stdout),
      replacementCharacters: [...resource.stdout].filter((character) => character === "\uFFFD").length,
    })).toBe(true);
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
    const gate = await detachedCreatorGate();
    expect(await execute(resource, detachedLeafScript(gate.address))).toEqual({ code: 0 });
    let creatorBirth, creatorPid, leafBirth, leafPid;
    // +0ms keeps publication, generation exit and same-birth adoption inside the existing single 1s observation budget.
    await vi.waitUntil(async () => {
      if (gate.error) throw gate.error;
      if (!gate.creator || !/^\d+$/.test(resource.stdout.trim())) return false;
      leafPid ??= Number(resource.stdout.trim());
      const currentLeaf = await birth(leafPid);
      expectLiveGeneration(await birth(resource.scope.rootPid), resource.scope.rootStartedAt);
      if (!creatorBirth) {
        creatorPid = gate.creator.pid;
        creatorBirth = await birth(creatorPid);
        expect(creatorBirth).toMatchObject({ parentPid: resource.scope.rootPid });
        expect(EXITED_PROC_STATES).not.toContain(creatorBirth.state);
        expect(currentLeaf.parentPid).toBe(creatorPid);
        expect(await creatorGenerationExited(creatorPid, creatorBirth.startedAt)).toBe(false);
        leafBirth = currentLeaf;
        gate.socket.end("release\n");
        return false;
      }
      expectLiveGeneration(currentLeaf, leafBirth.startedAt);
      if (!await creatorGenerationExited(creatorPid, creatorBirth.startedAt)) return false;
      leafBirth = currentLeaf;
      return leafBirth.parentPid === resource.scope.rootPid;
    }, { timeout: 1_000 });
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
