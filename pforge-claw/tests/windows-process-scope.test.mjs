import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeSupervisor, NATIVE_SCOPE_ERRORS } from "../src/jobs/native-command-supervisor.mjs";
import { closeWindowsProcessBroker, openWindowsProcessScope } from "../src/jobs/windows-process-scope.mjs";

// +60000ms allows native broker startup and Windows scheduling, never evidence of settlement.
const NATIVE_TOLERANCE_MS = 60_000;
const POLL_INTERVAL_MS = 25;
const MAX_NATIVE_PID = 2_147_483_647;
const IDLE_GRACE_MS = 1000;
const MAX_ENCODED_COMMAND_LENGTH = 30_000;
const NATIVE_COMMAND_TIMEOUT_MS = 5000;
const COLD_TEST_TIMEOUT_MS = 30_000;
const COMPILER_STALL_MS = 6000;
const FAKE_BROKER_PID = 123_456_789;
const FAKE_ROOT_PID = 123_456_788;
const FAKE_BIRTH = "639272939750000000";
const ADAPTER_URL = new URL("../src/jobs/windows-process-scope.mjs", import.meta.url);
const SUPERVISOR_URL = new URL("../src/jobs/native-command-supervisor.mjs", import.meta.url);
const WORKTREE_URL = new URL("../src/jobs/worktree.mjs", import.meta.url);
const fixtures = [];
const mockCleanups = [];

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function endpoint() {
  const actors = new Map();
  const roots = [];
  const scopes = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline === -1) return;
      const frame = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      actors.set(frame.token, { ...frame, socket });
    });
    socket.on("error", () => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const fixture = { server, port: server.address().port, actors, roots, scopes };
  fixtures.push(fixture);
  return fixture;
}

function actorCode({ port, token }) {
  return `
    const socket = require("node:net").connect(${port}, "127.0.0.1", () => {
      socket.write(JSON.stringify({token:${JSON.stringify(token)},pid:process.pid}) + "\\n");
    });
    socket.on("data", () => process.exit(0));
    socket.on("error", () => process.exit(0));
    socket.on("end", () => process.exit(0));
  `;
}

function creatorCode(fixture, token) {
  return `
    import("node:child_process").then(({spawn}) => {
      const leaf = spawn(process.execPath,
        ["-e", ${JSON.stringify(actorCode({ port: fixture.port, token }))}],
        {detached:true,stdio:"ignore",shell:false});
      leaf.unref();
      process.stdout.write(String(leaf.pid));
    });
  `;
}

async function actor(fixture, token) {
  await vi.waitFor(() => expect(fixture.actors.has(token)).toBe(true), {
    timeout: NATIVE_TOLERANCE_MS, interval: POLL_INTERVAL_MS,
  });
  return fixture.actors.get(token);
}

async function independentCreator(fixture) {
  const token = randomUUID();
  const child = spawn(process.execPath, ["-e", creatorCode(fixture, token)], {
    shell: false, windowsHide: true, stdio: "ignore",
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await closed;
  const survivor = await actor(fixture, token);
  expect(child.exitCode).toBe(0);
  expect(isAlive(survivor.pid)).toBe(true);
  return survivor;
}

async function heldRoot(fixture, open = openWindowsProcessScope) {
  const supervisor = createNativeSupervisor({ env: process.env });
  fixture.roots.push(supervisor);
  expect(await supervisor.ready).toBe(true);
  const scope = await open({ rootPid: supervisor.child.pid, env: process.env });
  fixture.scopes.push(scope);
  expect(scope.rootPid).toBe(supervisor.child.pid);
  expect(scope.rootStartedAt).toMatch(/^[1-9]\d{14,19}$/);
  expect(supervisor.child.stdout.readableLength).toBe(0);
  return { supervisor, scope };
}

async function settle(root) {
  const receipt = await root.scope.terminate();
  await root.supervisor.closed;
  expect(receipt).toMatchObject({
    rootPid: root.supervisor.child.pid, rootStartedAt: root.scope.rootStartedAt,
    rootReady: true, settlementConfirmed: true, unknownProcesses: 0,
  });
  expect(receipt.stoppedPids).toContain(root.supervisor.child.pid);
  expect(isAlive(root.supervisor.child.pid)).toBe(false);
  return receipt;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:crypto");
  vi.doUnmock("node:fs/promises");
  for (const fixture of fixtures.splice(0)) {
    for (const owned of fixture.actors.values()) {
      if (!owned.socket.destroyed) owned.socket.end("stop\n");
    }
    await Promise.all(fixture.scopes.map((scope) => scope.close()));
    for (const root of fixture.roots) {
      if (root.child.exitCode === null && root.child.signalCode === null) root.child.kill();
      await root.closed;
      expect(isAlive(root.child.pid)).toBe(false);
    }
    for (const owned of fixture.actors.values()) {
      await vi.waitFor(() => expect(isAlive(owned.pid)).toBe(false), {
        timeout: NATIVE_TOLERANCE_MS, interval: POLL_INTERVAL_MS,
      });
      owned.socket.destroy();
    }
    await new Promise((resolve) => fixture.server.close(resolve));
  }
  for (const cleanup of mockCleanups.splice(0)) await cleanup();
  await closeWindowsProcessBroker();
}, NATIVE_TOLERANCE_MS);

describe.runIf(process.platform === "win32")("Windows native ownership critical regressions", () => {
  it("terminates a detached owned leaf whose fast creator vanished before native settlement is true", async () => {
    const fixture = await endpoint();
    const token = randomUUID();
    const root = await heldRoot(fixture);
    root.supervisor.start(process.execPath, ["-e", creatorCode(fixture, token)]);
    expect(await root.supervisor.completion).toEqual({ code: 0 });
    const leaf = await actor(fixture, token);
    expect(isAlive(leaf.pid)).toBe(true);
    await settle(root);
    expect(isAlive(leaf.pid)).toBe(false);
  }, NATIVE_TOLERANCE_MS);

  it("proves zero without killing or blocking an unrelated survivor of a born-and-vanished independent creator", async () => {
    const fixture = await endpoint();
    const token = randomUUID();
    const root = await heldRoot(fixture);
    root.supervisor.start(process.execPath, ["-e", actorCode({ port: fixture.port, token })]);
    const owned = await actor(fixture, token);
    const survivor = await independentCreator(fixture);
    owned.socket.end("complete\n");
    expect(await root.supervisor.completion).toEqual({ code: 0 });
    const receipt = await settle(root);
    expect(isAlive(survivor.pid)).toBe(true);
    expect(receipt.stoppedPids).not.toContain(survivor.pid);
  }, NATIVE_TOLERANCE_MS);

  it("proves four concurrent distinct roots independently without weakening safety for an unrelated survivor", async () => {
    const fixture = await endpoint();
    const tokens = Array.from({ length: 4 }, () => randomUUID());
    const roots = await Promise.all(tokens.map(() => heldRoot(fixture)));
    roots.forEach((root, index) => {
      root.supervisor.start(process.execPath, ["-e", creatorCode(fixture, tokens[index])]);
    });
    const owned = await Promise.all(tokens.map((token) => actor(fixture, token)));
    const survivor = await independentCreator(fixture);
    expect(new Set(roots.map((root) => root.scope.rootPid)).size).toBe(4);
    for (const root of roots) expect(await root.supervisor.completion).toEqual({ code: 0 });
    const first = await settle(roots[0]);
    expect(first.stoppedPids).not.toContain(survivor.pid);
    for (let index = 1; index < roots.length; index += 1) {
      expect(isAlive(roots[index].scope.rootPid)).toBe(true);
      expect(isAlive(owned[index].pid)).toBe(true);
    }
    await roots[0].scope.close();
    const receipts = await Promise.all(roots.slice(1).map(settle));
    for (const receipt of receipts) expect(receipt.stoppedPids).not.toContain(survivor.pid);
    for (const entry of owned) expect(isAlive(entry.pid)).toBe(false);
    expect(isAlive(survivor.pid)).toBe(true);
  }, NATIVE_TOLERANCE_MS);
});

function brokerFixture(respond) {
  const children = [];
  const requests = [];
  const launch = vi.fn(() => {
    const child = new EventEmitter();
    child.pid = FAKE_BROKER_PID;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    };
    child.kill = vi.fn(() => { finish(); return true; });
    let buffered = "";
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk) => {
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const request = JSON.parse(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        requests.push(request);
        const response = respond?.({ child, request, requests }) ?? {
          v: 1, t: "response", id: request.id, scope: request.scope, op: request.op, ok: true,
          rootPid: request.rootPid, rootStartedAt: FAKE_BIRTH, rootReady: true,
          stoppedPids: request.op === "open" ? [] : [request.rootPid],
          settlementConfirmed: request.op !== "open", unknownProcesses: request.op === "open" ? null : 0,
        };
        if (response !== false) {
          queueMicrotask(() => child.stdout.write(typeof response === "string"
            ? response : `${JSON.stringify(response)}\n`));
        }
      }
    });
    child.stdin.once("finish", finish);
    queueMicrotask(() => child.stdout.write(`${JSON.stringify({
      v: 1, t: "ready", pid: child.pid, parentPid: process.pid,
    })}\n`));
    children.push(child);
    return child;
  });
  return { children, requests, launch };
}

async function mockAdapter(respond) {
  vi.resetModules();
  const broker = brokerFixture(respond);
  vi.doMock("node:child_process", () => ({ spawn: broker.launch }));
  vi.doMock("node:fs/promises", () => ({ access: vi.fn(async () => {}) }));
  const adapter = await import("../src/jobs/windows-process-scope.mjs");
  const { ClawError: ErrorType } = await import("../src/errors.mjs");
  const scopes = [];
  mockCleanups.push(async () => {
    await Promise.all(scopes.map((scope) => scope.close()));
    await adapter.closeWindowsProcessBroker();
  });
  return {
    ...broker, ErrorType, closeBroker: adapter.closeWindowsProcessBroker,
    async open(options) {
      const scope = await adapter.openWindowsProcessScope(options);
      scopes.push(scope);
      return scope;
    },
  };
}

async function capturedAdapter(transformBootstrap) {
  await closeWindowsProcessBroker();
  vi.resetModules();
  const children = [];
  vi.doMock("node:child_process", () => ({
    spawn(command, args, options) {
      if (transformBootstrap && command.toLowerCase().endsWith("pwsh.exe")) {
        args = [...args];
        const index = args.indexOf("-EncodedCommand") + 1;
        const bootstrap = Buffer.from(args[index], "base64").toString("utf16le");
        args[index] = Buffer.from(transformBootstrap(bootstrap), "utf16le").toString("base64");
      }
      const child = spawn(command, args, options);
      children.push(child);
      return child;
    },
  }));
  const adapter = await import("../src/jobs/windows-process-scope.mjs");
  mockCleanups.push(() => adapter.closeWindowsProcessBroker());
  return { open: adapter.openWindowsProcessScope, closeBroker: adapter.closeWindowsProcessBroker, children };
}

async function nativeBindingObservation() {
  const probe = String.raw`
    $imports = @($native.GetMethods() | ForEach-Object {
      $attributes = $_.GetCustomAttributes([Runtime.InteropServices.DllImportAttribute],$false)
      if ($attributes.Count -eq 1) {
        @{ name=$_.Name; lastError=$attributes[0].SetLastError; entry=$attributes[0].EntryPoint
           library=$attributes[0].Value; charset=$attributes[0].CharSet.ToString()
           convention=$attributes[0].CallingConvention.ToString()
           returns=$_.ReturnType.Name; parameters=@($_.GetParameters() | ForEach-Object { $_.ParameterType.Name })
           preserveSig=($_.MethodImplementationFlags -band [Reflection.MethodImplAttributes]::PreserveSig) -ne 0 }
      }
    })
    $controlAssembly = [Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly(
      [Reflection.AssemblyName]::new("Claw.Win01.Control"),[Reflection.Emit.AssemblyBuilderAccess]::Run)
    $control = $controlAssembly.DefineDynamicModule("Control").DefineType("Control",[Reflection.TypeAttributes]"Public,Abstract,Sealed")
    $import = [Runtime.InteropServices.DllImportAttribute]
    $ctor = $import.GetConstructor([Type[]]@([string]))
    $fields = [Reflection.FieldInfo[]]@($import.GetField("SetLastError"),$import.GetField("EntryPoint"),
      $import.GetField("CharSet"),$import.GetField("CallingConvention"))
    foreach ($definition in @(
      @{ name="ResetLastError"; entry="SetLastError"; returns=[void]; parameters=[Type[]]@([uint32]) },
      @{ name="Query"; entry="QueryInformationJobObject"; returns=[bool]; parameters=[Type[]]@([IntPtr],[int],[IntPtr],[uint32],[IntPtr]) }
    )) {
      $method = $control.DefineMethod($definition.name,[Reflection.MethodAttributes]"Public,Static,PinvokeImpl",
        [Reflection.CallingConventions]::Standard,$definition.returns,$definition.parameters)
      $values = [object[]]@($true,$definition.entry,[Runtime.InteropServices.CharSet]::Unicode,
        [Runtime.InteropServices.CallingConvention]::Winapi)
      $method.SetCustomAttribute([Reflection.Emit.CustomAttributeBuilder]::new($ctor,[object[]]@("kernel32.dll"),$fields,$values))
      $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
    }
    $control = $control.CreateType()
    $probeJob = $native::CreateJobObject([IntPtr]::Zero,$null)
    $probeBuffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($ACCOUNTING_BYTES)
    try {
      if ($probeJob -eq [IntPtr]::Zero) { throw "WIN01_PROBE_CREATE_FAILED" }
      $control::ResetLastError(0)
      $nativeSuccess = $native::QueryInformationJobObject($probeJob,$BASIC_ACCOUNTING,$probeBuffer,1,[IntPtr]::Zero)
      $nativeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      $control::ResetLastError(0)
      $controlSuccess = $control::Query($probeJob,$BASIC_ACCOUNTING,$probeBuffer,1,[IntPtr]::Zero)
      $controlError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      [Console]::Error.WriteLine("WIN01_ABI:" + (ConvertTo-Json -Depth 4 -Compress -InputObject @{
        imports=$imports; nativeSuccess=$nativeSuccess; nativeError=$nativeError
        controlSuccess=$controlSuccess; controlError=$controlError
        powershell=$PSVersionTable.PSVersion.ToString(); dotnet=[Environment]::Version.ToString()
      }))
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($probeBuffer)
      [void]$native::CloseHandle($probeJob)
    }
  `;
  const encodedProbe = Buffer.from(probe, "utf8").toString("base64");
  const adapter = await capturedAdapter((bootstrap) => bootstrap.replace(
    "$broker = [ScriptBlock]::Create($reader.ReadToEnd())",
    `$brokerSource = $reader.ReadToEnd()
     $probe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedProbe}"))
     $broker = [ScriptBlock]::Create($brokerSource.Replace('$native = New-NativeBindings',
       '$native = New-NativeBindings' + [Environment]::NewLine + $probe))`,
  ));
  const fixture = await endpoint();
  const supervisor = createNativeSupervisor();
  fixture.roots.push(supervisor);
  expect(await supervisor.ready).toBe(true);
  const opening = adapter.open({ rootPid: supervisor.child.pid });
  await vi.waitFor(() => expect(adapter.children).toHaveLength(1));
  let diagnostics = "";
  adapter.children[0].stderr.setEncoding("utf8").on("data", (chunk) => { diagnostics += chunk; });
  const scope = await opening;
  fixture.scopes.push(scope);
  await settle({ supervisor, scope });
  await scope.close();
  await adapter.closeBroker();
  expect(isAlive(adapter.children[0].pid)).toBe(false);
  const line = diagnostics.split(/\r?\n/).find((value) => value.startsWith("WIN01_ABI:"));
  expect(line).toBeTypeOf("string");
  return JSON.parse(line.slice("WIN01_ABI:".length));
}

async function coldNativeWorker(fixture, { blockCompiler = false } = {}) {
  // The 30s outer scheduling tolerance never changes the real 5s command gate; clocks are diagnostic only.
  const compilerEdge = blockCompiler ? `
    function Add-Type {
      [CmdletBinding()] param([string]$TypeDefinition)
      [Threading.Thread]::Sleep(${COMPILER_STALL_MS})
      Microsoft.PowerShell.Utility\\Add-Type @PSBoundParameters
    }
  ` : "";
  const script = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { performance } from "node:perf_hooks";
    const launch = childProcess.spawn;
    // Metrics use outer scheduling tolerance; the actual command deadline remains five seconds.
    const started = performance.now();
    const elapsedMs = () => performance.now() - started;
    let brokerPid;
    let rootPid;
    let brokerStarts = 0;
    childProcess.spawn = (command, args, options) => {
      if (command.toLowerCase().endsWith("pwsh.exe")) {
        brokerStarts++;
        const encodedIndex = args.indexOf("-EncodedCommand") + 1;
        if (${Boolean(blockCompiler)}) {
          args = [...args];
          const ownSource = Buffer.from(args[encodedIndex], "base64").toString("utf16le");
          args[encodedIndex] = Buffer.from(${JSON.stringify(compilerEdge)} + ownSource, "utf16le").toString("base64");
        }
      }
      const child = launch(command, args, options);
      if (command.toLowerCase().endsWith("pwsh.exe")) brokerPid = child.pid;
      if (args.includes("--pforge-command-supervisor")) rootPid = child.pid;
      return child;
    };
    syncBuiltinESMExports();
    const { run } = await import(${JSON.stringify(WORKTREE_URL.href)});
    const { closeWindowsProcessBroker } = await import(${JSON.stringify(ADAPTER_URL.href)});
    const native = await run(process.execPath, ["-e", "process.exitCode=7"], {
      requireSettlement:true, timeoutMs:${NATIVE_COMMAND_TIMEOUT_MS}
    });
    await closeWindowsProcessBroker();
    // Wall-clock diagnostics use the outer scheduling tolerance, not settlement or deadline evidence.
    const safeCode = (code) => /^[A-Z][A-Z0-9_]{0,63}$/.test(code ?? "") ? code : null;
    process.stdout.write(JSON.stringify({
      code:native.code, errorCode:safeCode(native.error?.code),
      settlementConfirmed:native.settlementConfirmed, rootReady:native.settlement?.rootReady === true,
      identityPresent:typeof native.settlement?.rootStartedAt === "string",
      unknownProcesses:native.settlement?.unknownProcesses ?? null,
      rootPid,brokerPid,brokerStarts,elapsedMs:elapsedMs()
    }));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.resume();
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  fixture.roots.push({ child, closed });
  expect(await closed).toBe(0);
  const receipt = JSON.parse(output);
  expect(receipt.brokerStarts).toBe(1);
  expect(isAlive(receipt.rootPid)).toBe(false);
  expect(isAlive(receipt.brokerPid)).toBe(false);
  return receipt;
}

async function withWindowsPlatform(operation) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    return await operation();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

describe("Windows process scope common boundary contract", () => {
  it.each([0, -1, 4, 1.5, Number.MAX_SAFE_INTEGER, "123", null])("refuses invalid root %s without launching a helper", async (rootPid) => {
    const broker = await mockAdapter();
    await expect(broker.open({ rootPid })).rejects.toBeInstanceOf(broker.ErrorType);
    expect(broker.launch).not.toHaveBeenCalled();
  });

  it("refuses unsupported hosts before attempting a broker or reporting success", async () => {
    const broker = await mockAdapter();
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      await expect(broker.open({ rootPid: FAKE_ROOT_PID })).rejects.toMatchObject({
        code: NATIVE_SCOPE_ERRORS.UNAVAILABLE,
      });
      expect(broker.launch).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", descriptor);
    }
  });

  it("never assigns the parent Node or its broker to an owned job", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      await expect(broker.open({ rootPid: process.pid })).rejects.toBeInstanceOf(broker.ErrorType);
      expect(broker.launch).not.toHaveBeenCalled();
      await expect(broker.open({ rootPid: FAKE_BROKER_PID })).rejects.toMatchObject({
        code: "PLAN_PROCESS_NATIVE_IDENTITY",
      });
      expect(broker.requests).toHaveLength(0);
      await broker.closeBroker();
      expect(broker.children[0].stdin.writableEnded).toBe(true);
    });
  });

  it.each([
    "malformed-in-memory-fixture\n",
    '{"v":1,"t":"response","id":"unowned","scope":"unowned","op":"open","ok":true}\n',
  ])("rejects malformed or unowned IPC and stops only the owned helper", async (response) => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter(() => response);
      await expect(broker.open({ rootPid: FAKE_ROOT_PID })).rejects.toMatchObject({
        code: "PLAN_PROCESS_NATIVE_PROTOCOL",
      });
      expect(broker.children[0].kill).toHaveBeenCalledTimes(1);
    });
  });

  it("masks native errors rather than forwarding exception text or credential-like values", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter(({ request }) => ({
        v: 1, t: "response", id: request.id, scope: request.scope, op: request.op,
        ok: false, code: "native exception includes private in-memory fixture",
      }));
      await expect(broker.open({ rootPid: FAKE_ROOT_PID })).rejects.toMatchObject({
        message: "PLAN_PROCESS_NATIVE_BROKER_FAILED", code: "PLAN_PROCESS_NATIVE_BROKER_FAILED", details: {},
      });
      await broker.closeBroker();
      expect(broker.children[0].stdin.writableEnded).toBe(true);
    });
  });

  it("reuses one broker for four scopes, exact IDs, independent settlement, and awaited idle shutdown", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      const scopes = await Promise.all(Array.from({ length: 4 }, (_, index) => broker.open({ rootPid: FAKE_ROOT_PID - index })));
      expect(broker.launch).toHaveBeenCalledTimes(1);
      expect(new Set(broker.requests.map((request) => request.scope)).size).toBe(4);
      const first = await scopes[0].terminate();
      expect(first.settlementConfirmed).toBe(true);
      await scopes[0].close();
      expect(broker.children[0].stdin.writableEnded).toBe(false);
      const receipts = await Promise.all(scopes.slice(1).map((scope) => scope.terminate()));
      expect(receipts.every((receipt) => receipt.settlementConfirmed && receipt.unknownProcesses === 0)).toBe(true);
      await Promise.all(scopes.map((scope) => scope.close()));
      await broker.closeBroker();
      expect(broker.children[0].stdin.writableEnded).toBe(true);
      expect(new Set(broker.requests.map((request) => request.id)).size).toBe(broker.requests.length);
    });
  });

  it("serializes duplicate termination and close without reattaching a reused root identity", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      await expect(broker.open({ rootPid: FAKE_ROOT_PID })).rejects.toMatchObject({
        code: "PLAN_PROCESS_NATIVE_IDENTITY",
      });
      const receipts = await Promise.all([scope.terminate(), scope.terminate(), scope.terminate()]);
      expect(receipts[0]).toEqual(receipts[1]);
      await Promise.all([scope.close(), scope.close()]);
      expect(broker.requests.filter((request) => request.op === "terminate")).toHaveLength(1);
      expect(broker.requests.filter((request) => request.op === "close")).toHaveLength(1);
      const next = await broker.open({ rootPid: FAKE_ROOT_PID });
      expect(broker.launch).toHaveBeenCalledTimes(1);
      expect(broker.requests.filter((request) => request.op === "open")[0].scope)
        .not.toBe(broker.requests.filter((request) => request.op === "open")[1].scope);
      await next.close();
    });
  });

  it("refuses a scope ID collision instead of replacing another root's reservation", async () => {
    await withWindowsPlatform(async () => {
      vi.doMock("node:crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
      const broker = await mockAdapter();
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      await expect(broker.open({ rootPid: FAKE_ROOT_PID - 1 })).rejects.toMatchObject({
        code: "PLAN_PROCESS_NATIVE_IDENTITY",
      });
      expect(broker.requests.filter((request) => request.op === "open")).toHaveLength(1);
      expect(broker.children[0].kill).not.toHaveBeenCalled();
      await scope.close();
      await broker.closeBroker();
    });
  });

  it("denies false proof when a successful-looking response reports nonzero native membership", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter(({ request }) => request.op === "terminate" ? {
        v: 1, t: "response", id: request.id, scope: request.scope, op: request.op, ok: true,
        rootPid: request.rootPid, rootStartedAt: FAKE_BIRTH, rootReady: true,
        stoppedPids: [request.rootPid], settlementConfirmed: true, unknownProcesses: 1,
      } : undefined);
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      expect(await scope.terminate()).toMatchObject({
        rootReady: true, settlementConfirmed: false, unknownProcesses: null, code: "PLAN_PROCESS_NATIVE_PROTOCOL",
      });
      await scope.close();
      expect(broker.children[0].kill).toHaveBeenCalledTimes(1);
    });
  });

  it("denies stale birth identities even if a reply has the expected root PID", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter(({ request }) => request.op === "terminate" ? {
        v: 1, t: "response", id: request.id, scope: request.scope, op: request.op, ok: true,
        rootPid: request.rootPid, rootStartedAt: "639272939750000001", rootReady: true,
        stoppedPids: [request.rootPid], settlementConfirmed: true, unknownProcesses: 0,
      } : undefined);
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      expect(await scope.terminate()).toMatchObject({
        settlementConfirmed: false, code: "PLAN_PROCESS_NATIVE_PROTOCOL",
      });
      await scope.close();
    });
  });

  it("returns unknown rather than zero when native query fails, then closes the exact scope", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter(({ request }) => request.op === "terminate" ? {
        v: 1, t: "response", id: request.id, scope: request.scope, op: request.op,
        ok: false, code: "PLAN_PROCESS_NATIVE_QUERY_FAILED",
      } : undefined);
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      expect(await scope.terminate()).toMatchObject({
        settlementConfirmed: false, unknownProcesses: null, stoppedPids: [],
        code: "PLAN_PROCESS_NATIVE_QUERY_FAILED",
      });
      await scope.close();
      expect(broker.requests.filter((request) => request.op === "close")).toHaveLength(1);
    });
  });

  it("reports false after broker crash rather than manufacturing zero membership", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      broker.children[0].kill();
      expect(await scope.terminate()).toMatchObject({
        rootPid: FAKE_ROOT_PID, rootStartedAt: FAKE_BIRTH, rootReady: true,
        settlementConfirmed: false, unknownProcesses: null, stoppedPids: [],
        code: "PLAN_PROCESS_NATIVE_BROKER_FAILED",
      });
      await scope.close();
    });
  });

  it("does not infer settlement from closing a scope without a terminate receipt", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      await scope.close();
      expect(await scope.terminate()).toMatchObject({
        settlementConfirmed: false, unknownProcesses: null, code: "PLAN_PROCESS_NATIVE_CLOSED",
      });
    });
  });

  it("reuses a bounded idle broker across eight sequential private jobs and explicitly awaits its disposal", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      for (let index = 0; index < 8; index += 1) {
        const scope = await broker.open({ rootPid: FAKE_ROOT_PID - index });
        expect(await scope.terminate()).toMatchObject({ settlementConfirmed: true, unknownProcesses: 0 });
        await scope.close();
      }
      expect(broker.launch).toHaveBeenCalledTimes(1);
      expect(broker.requests.filter((request) => request.op === "open")).toHaveLength(8);
      await broker.closeBroker();
      expect(broker.children[0].stdin.writableEnded).toBe(true);
    });
  });

  it("refuses broker disposal while another scope is active rather than killing that scope", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
      await expect(broker.closeBroker()).rejects.toMatchObject({ code: "PLAN_PROCESS_NATIVE_BUSY" });
      expect(broker.children[0].kill).not.toHaveBeenCalled();
      expect(await scope.terminate()).toMatchObject({ settlementConfirmed: true });
      await scope.close();
      await broker.closeBroker();
    });
  });

  it("uses only the trusted absolute host broker path and minimal host environment, not job loader overrides", async () => {
    await withWindowsPlatform(async () => {
      const broker = await mockAdapter();
      const scope = await broker.open({ rootPid: FAKE_ROOT_PID, env: {
        Path: "untrusted-job-shadow", PSModulePath: "untrusted-job-loader",
        DOTNET_STARTUP_HOOKS: "untrusted-job-dotnet", NODE_OPTIONS: "--untrusted-job-node",
        PFORGE_CLAW_IN_MEMORY_FIXTURE: "private-in-memory-value",
      } });
      const [command, args, options] = broker.launch.mock.calls[0];
      expect(command).not.toContain("untrusted-job");
      expect(command).toMatch(/pwsh\.exe$/);
      expect(options.env).not.toHaveProperty("PSModulePath");
      expect(options.env).not.toHaveProperty("DOTNET_STARTUP_HOOKS");
      expect(options.env).not.toHaveProperty("NODE_OPTIONS");
      expect(options.env).not.toHaveProperty("PFORGE_CLAW_IN_MEMORY_FIXTURE");
      expect(Object.values(options.env)).not.toContain("untrusted-job-shadow");
      expect(args.at(-1).length).toBeLessThan(MAX_ENCODED_COMMAND_LENGTH);
      await scope.close();
      await broker.closeBroker();
    });
  });

  it("cancels bounded idle shutdown for a new scope, then stops the broker without treating elapsed time as proof", async () => {
    await withWindowsPlatform(async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const broker = await mockAdapter();
        const scope = await broker.open({ rootPid: FAKE_ROOT_PID });
        await scope.close();
        vi.advanceTimersByTime(IDLE_GRACE_MS / 2);
        const next = await broker.open({ rootPid: FAKE_ROOT_PID - 1 });
        vi.advanceTimersByTime(IDLE_GRACE_MS);
        expect(broker.children[0].stdin.writableEnded).toBe(false);
        await next.close();
        vi.advanceTimersByTime(IDLE_GRACE_MS);
        expect(broker.children[0].stdin.writableEnded).toBe(true);
        expect(await next.terminate()).toMatchObject({ settlementConfirmed: false, unknownProcesses: null });
        await broker.closeBroker();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe.runIf(process.platform === "win32")("Windows actual native broker failure and lifecycle", () => {
  it("rejects a nonexistent PID with a safe native attach error and closes its idle helper", async () => {
    await expect(openWindowsProcessScope({ rootPid: MAX_NATIVE_PID })).rejects.toMatchObject({
      code: "PLAN_PROCESS_NATIVE_ATTACH_FAILED", message: "PLAN_PROCESS_NATIVE_ATTACH_FAILED", details: {},
    });
    await closeWindowsProcessBroker();
  }, NATIVE_TOLERANCE_MS);

  it("rejects duplicate current-job identity without stopping the original held root", async () => {
    const fixture = await endpoint();
    const root = await heldRoot(fixture);
    await expect(openWindowsProcessScope({ rootPid: root.scope.rootPid })).rejects.toMatchObject({
      code: "PLAN_PROCESS_NATIVE_IDENTITY",
    });
    expect(isAlive(root.scope.rootPid)).toBe(true);
    await settle(root);
  }, NATIVE_TOLERANCE_MS);

  it("proves owned zero when the held root exited before termination but a detached member remained", async () => {
    const fixture = await endpoint();
    const token = randomUUID();
    const root = await heldRoot(fixture);
    root.supervisor.start(process.execPath, ["-e", creatorCode(fixture, token)]);
    const leaf = await actor(fixture, token);
    root.supervisor.child.kill();
    await root.supervisor.closed;
    expect(isAlive(leaf.pid)).toBe(true);
    await settle(root);
    expect(isAlive(leaf.pid)).toBe(false);
  }, NATIVE_TOLERANCE_MS);

  it("automatically kills all job members on broker crash, but never reports unmeasured zero", async () => {
    const adapter = await capturedAdapter();
    const fixture = await endpoint();
    const token = randomUUID();
    const root = await heldRoot(fixture, adapter.open);
    root.supervisor.start(process.execPath, ["-e", creatorCode(fixture, token)]);
    const leaf = await actor(fixture, token);
    expect(adapter.children).toHaveLength(1);
    const broker = adapter.children[0];
    const closed = new Promise((resolve) => broker.once("close", resolve));
    broker.kill();
    await closed;
    const receipt = await root.scope.terminate();
    expect(receipt).toMatchObject({
      rootReady: true, settlementConfirmed: false, unknownProcesses: null,
      code: "PLAN_PROCESS_NATIVE_BROKER_FAILED",
    });
    await root.supervisor.closed;
    await vi.waitFor(() => expect(isAlive(leaf.pid)).toBe(false), {
      timeout: NATIVE_TOLERANCE_MS, interval: POLL_INTERVAL_MS,
    });
    await root.scope.close();
    await adapter.closeBroker();
    expect(isAlive(broker.pid)).toBe(false);
  }, NATIVE_TOLERANCE_MS);

  it.each(["eof", "malformed"])("closes native job handles on broker %s without timed or root-close proof", async (failure) => {
    const adapter = await capturedAdapter();
    const fixture = await endpoint();
    const token = randomUUID();
    const root = await heldRoot(fixture, adapter.open);
    root.supervisor.start(process.execPath, ["-e", creatorCode(fixture, token)]);
    const leaf = await actor(fixture, token);
    const broker = adapter.children[0];
    const closed = new Promise((resolve) => broker.once("close", resolve));
    if (failure === "eof") broker.stdin.end();
    else broker.stdin.write("malformed-own-fixture\n");
    await closed;
    expect(await root.scope.terminate()).toMatchObject({
      rootReady: true, settlementConfirmed: false, unknownProcesses: null,
    });
    await root.supervisor.closed;
    await vi.waitFor(() => expect(isAlive(leaf.pid)).toBe(false), {
      timeout: NATIVE_TOLERANCE_MS, interval: POLL_INTERVAL_MS,
    });
    await root.scope.close();
    await adapter.closeBroker();
    expect(isAlive(broker.pid)).toBe(false);
  }, NATIVE_TOLERANCE_MS);

  it("reuses one actual broker across eight sequential literal-argv jobs, measuring each zero before closing", async () => {
    const adapter = await capturedAdapter();
    const fixture = await endpoint();
    const args = ['literal "quote" and space', "$not-a-shell;$(not-run)", "trailing\\"];
    for (let index = 0; index < 8; index += 1) {
      const root = await heldRoot(fixture, adapter.open);
      let output = "";
      root.supervisor.child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
      root.supervisor.start(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "--", ...args]);
      expect(await root.supervisor.completion).toEqual({ code: 0 });
      await settle(root);
      expect(JSON.parse(output)).toEqual(args);
      await root.scope.close();
    }
    expect(adapter.children).toHaveLength(1);
    const broker = adapter.children[0];
    await adapter.closeBroker();
    expect(isAlive(broker.pid)).toBe(false);
  }, NATIVE_TOLERANCE_MS);

  it("terminates only private job children when the owning parent Node exits", async () => {
    const fixture = await endpoint();
    const leafToken = randomUUID();
    const parentToken = randomUUID();
    const script = `
      import childProcess from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      import net from "node:net";
      const launch = childProcess.spawn;
      let brokerPid;
      childProcess.spawn = (command, args, options) => {
        const child = launch(command, args, options);
        if (command.toLowerCase().endsWith("pwsh.exe")) brokerPid = child.pid;
        return child;
      };
      syncBuiltinESMExports();
      const { createNativeSupervisor } = await import(${JSON.stringify(SUPERVISOR_URL.href)});
      const { openWindowsProcessScope } = await import(${JSON.stringify(ADAPTER_URL.href)});
      const root = createNativeSupervisor();
      await root.ready;
      await openWindowsProcessScope({rootPid:root.child.pid});
      root.start(process.execPath, ["-e", ${JSON.stringify(creatorCode(fixture, leafToken))}]);
      await root.completion;
      const socket = net.connect(${fixture.port}, "127.0.0.1", () => socket.write(JSON.stringify({
        token:${JSON.stringify(parentToken)},pid:process.pid,rootPid:root.child.pid,brokerPid
      }) + "\\n"));
      socket.on("data", () => process.exit(0));
      socket.on("error", () => process.exit(1));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.stderr.resume();
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    fixture.roots.push({ child, closed });
    const control = await actor(fixture, parentToken);
    const leaf = await actor(fixture, leafToken);
    const survivor = await independentCreator(fixture);
    expect(isAlive(control.rootPid)).toBe(true);
    expect(isAlive(control.brokerPid)).toBe(true);
    control.socket.end("exit\n");
    expect(await closed).toBe(0);
    await vi.waitFor(() => {
      expect(isAlive(control.rootPid)).toBe(false);
      expect(isAlive(control.brokerPid)).toBe(false);
      expect(isAlive(leaf.pid)).toBe(false);
    }, { timeout: NATIVE_TOLERANCE_MS, interval: POLL_INTERVAL_MS });
    expect(isAlive(survivor.pid)).toBe(true);
  }, NATIVE_TOLERANCE_MS);
});

describe.runIf(process.platform === "win32")("WIN-01 actual emitted native ABI", () => {
  it.each(["metadata", "last-error"])("preserves native %s on all production imports", async (check) => {
    const observation = await nativeBindingObservation();
    const diagnostic = JSON.stringify({
      importCount: observation.imports.length, lastErrorImports: observation.imports.filter((entry) => entry.lastError).length,
      nativeError: observation.nativeError, controlError: observation.controlError,
      powershell: observation.powershell, dotnet: observation.dotnet,
    });
    expect(observation.imports).toHaveLength(10);
    const parameters = {
      OpenProcess: ["UInt32", "Boolean", "Int32"],
      CloseHandle: ["IntPtr"],
      GetProcessTimes: ["IntPtr", "IntPtr", "IntPtr", "IntPtr", "IntPtr"],
      CreateJobObject: ["IntPtr", "String"],
      SetInformationJobObject: ["IntPtr", "Int32", "IntPtr", "UInt32"],
      AssignProcessToJobObject: ["IntPtr", "IntPtr"],
      IsProcessInJob: ["IntPtr", "IntPtr", "IntPtr"],
      TerminateJobObject: ["IntPtr", "UInt32"],
      WaitForSingleObject: ["IntPtr", "UInt32"],
      QueryInformationJobObject: ["IntPtr", "Int32", "IntPtr", "UInt32", "IntPtr"],
    };
    for (const entry of observation.imports) {
      const returns = ["OpenProcess", "CreateJobObject"].includes(entry.name) ? "IntPtr"
        : entry.name === "WaitForSingleObject" ? "UInt32" : "Boolean";
      expect(entry).toMatchObject({
        library: "kernel32.dll", charset: "Unicode", convention: "Winapi", preserveSig: true,
        entry: entry.name === "CreateJobObject" ? "CreateJobObjectW" : entry.name,
        returns, parameters: parameters[entry.name],
      });
    }
    expect(observation.nativeSuccess).toBe(false);
    expect(observation.controlSuccess).toBe(false);
    expect(observation.controlError).toBe(24);
    if (check === "metadata") expect(observation.imports.every((entry) => entry.lastError), diagnostic).toBe(true);
    else expect(observation.nativeError, diagnostic).toBe(observation.controlError);
  }, NATIVE_TOLERANCE_MS);
});

describe.runIf(process.platform === "win32")("Windows cold native ownership deadline", () => {
  it("starts four cold independent native owners within the existing five-second command deadlines", async () => {
    const fixture = await endpoint();
    const receipts = await Promise.all(Array.from({ length: 4 }, () => coldNativeWorker(fixture)));
    expect(new Set(receipts.map((receipt) => receipt.rootPid)).size).toBe(4);
    expect(new Set(receipts.map((receipt) => receipt.brokerPid)).size).toBe(4);
    for (const receipt of receipts) {
      expect(receipt, JSON.stringify(receipt)).toMatchObject({
        code: 7, errorCode: null, rootReady: true, identityPresent: true,
        settlementConfirmed: true, unknownProcesses: 0,
      });
    }
  }, COLD_TEST_TIMEOUT_MS);

  it("does not spend the native execution deadline on a blocked compiler during cold ownership", async () => {
    const fixture = await endpoint();
    // The compiler edge is delayed, not native ownership or zero-member proof; no broker is warmed.
    const receipt = await coldNativeWorker(fixture, { blockCompiler: true });
    expect(receipt, JSON.stringify(receipt)).toMatchObject({
      code: 7, errorCode: null, rootReady: true, identityPresent: true,
      settlementConfirmed: true, unknownProcesses: 0,
    });
  }, COLD_TEST_TIMEOUT_MS);
});

describe("Guard: Windows ownership has no global census or guessed PID termination", () => {
  it("contains native private job, root identity, no-breakaway limits and actual zero queries", async () => {
    const source = await readFile(ADAPTER_URL, "utf8");
    expect(source).toContain("CreateJobObject");
    expect(source).toContain("AssignProcessToJobObject");
    expect(source).toContain("IsProcessInJob");
    expect(source).toContain("GetProcessTimes");
    expect(source).toContain("TerminateJobObject");
    expect(source).toContain("QueryInformationJobObject");
    expect(source).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    expect(source).toContain("$activeProcesses -eq 0 -and $waited -eq $WAIT_OBJECT_0");
    expect(source).toContain("WaitForSingleObject");
    expect(source).toContain("$method = $type.DefineMethod($signature.name");
    expect(source).not.toContain("DefinePInvokeMethod(");
    expect(source).not.toContain("Add-Type");
    expect(source).not.toMatch(/Get-CimInstance|Get-Process|Win32_Process|TerminateProcess|Stop-Process|taskkill|ParentProcessId/);
    expect(source).not.toMatch(/JOB_OBJECT_LIMIT_(?:SILENT_)?BREAKAWAY_OK/);
    expect(source).not.toMatch(/spawnSync|execSync|\bexec\s*\(|shell:\s*true/);
    expect(source.split(/\r?\n/).length).toBeLessThan(1000);
  });

  it("keeps actual argv only in the held supervisor's private IPC, never in the job broker", async () => {
    const source = await readFile(ADAPTER_URL, "utf8");
    const supervisor = await readFile(SUPERVISOR_URL, "utf8");
    expect(source).not.toContain("frame.command");
    expect(source).not.toContain("frame.args");
    expect(supervisor).toContain("child.send");
    expect(supervisor).toContain("command, args");
    expect(source).toContain("-EncodedCommand");
    expect(fileURLToPath(ADAPTER_URL)).toContain("windows-process-scope.mjs");
  });
});
