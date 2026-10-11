import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { gzipSync } from "node:zlib";
import { ClawError } from "../errors.mjs";
import { NATIVE_SCOPE_ERRORS } from "./native-command-supervisor.mjs";

const ERRORS = Object.freeze({
  ...NATIVE_SCOPE_ERRORS,
  INVALID_OPTIONS: "PLAN_PROCESS_NATIVE_INVALID",
  IDENTITY: "PLAN_PROCESS_NATIVE_IDENTITY",
  ATTACH: "PLAN_PROCESS_NATIVE_ATTACH_FAILED",
  QUERY: "PLAN_PROCESS_NATIVE_QUERY_FAILED",
  TIMEOUT: "PLAN_PROCESS_NATIVE_TIMEOUT",
  PROTOCOL: "PLAN_PROCESS_NATIVE_PROTOCOL",
  BROKER: "PLAN_PROCESS_NATIVE_BROKER_FAILED",
  CLOSED: "PLAN_PROCESS_NATIVE_CLOSED",
  BUSY: "PLAN_PROCESS_NATIVE_BUSY",
});
const SAFE_CODES = new Set(Object.values(ERRORS));
const OPERATIONS = Object.freeze({ OPEN: "open", TERMINATE: "terminate", CLOSE: "close" });
const MAX_PID = 2_147_483_647;
const MAX_NATIVE_COUNT = 4_294_967_295;
const SYSTEM_PID_MAX = 4;
const MAX_SCOPES = 64;
const MAX_REQUESTS = 4096;
const MAX_KNOWN_PIDS = 256;
const MAX_FRAME_BYTES = 16_384;
const MAX_BUFFER_BYTES = 65_536;
const STARTUP_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 7500;
const NATIVE_SETTLEMENT_TIMEOUT_MS = 5000;
const NATIVE_WAIT_INTERVAL_MS = 20;
const BROKER_IDLE_GRACE_MS = 1000;
const BROKER_STOP_TIMEOUT_MS = 2000;
const START_IDENTITY = /^[1-9]\d{14,19}$/;
const BROKER_ENVIRONMENT_FIELDS = new Set(["PATH", "SYSTEMROOT", "WINDIR"]);
const PARENT_PID_ENVIRONMENT = "PFORGE_CLAW_NATIVE_PARENT_PID";
const HOST_ENVIRONMENT = Object.freeze(Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => BROKER_ENVIRONMENT_FIELDS.has(name.toUpperCase()))));
const HOST_PROGRAM_FILES = process.env.ProgramFiles;
const MAX_HOST_PATH_DIRECTORIES = 64;
const roots = new Map();
let sharedBroker;
let brokerCreation;

// The broker receives only identity frames, never command arguments or caller credentials.
const WINDOWS_BROKER_SOURCE = String.raw`
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

internal sealed class ClawNativeFailure : Exception {
  internal readonly string Code;
  internal ClawNativeFailure(string code) : base(code) { Code = code; }
}

internal static class ClawJobApi {
  internal const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  internal const uint PROCESS_SET_QUOTA = 0x0100;
  internal const uint PROCESS_TERMINATE = 0x0001;
  internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  internal const uint SYNCHRONIZE = 0x00100000;
  internal const uint WAIT_OBJECT_0 = 0;
  internal const uint WAIT_TIMEOUT = 258;
  internal const uint INFINITE = 0xffffffff;
  internal const int ERROR_MORE_DATA = 234;
  internal const int BASIC_ACCOUNTING = 1;
  internal const int PROCESS_ID_LIST = 3;
  internal const int EXTENDED_LIMITS = 9;
  internal const int MAX_PIDS = ${MAX_KNOWN_PIDS};
  internal const int SETTLE_TIMEOUT = ${NATIVE_SETTLEMENT_TIMEOUT_MS};
  internal const int WAIT_INTERVAL = ${NATIVE_WAIT_INTERVAL_MS};

  [StructLayout(LayoutKind.Sequential)]
  internal struct FileTime { internal uint Low; internal uint High; }
  [StructLayout(LayoutKind.Sequential)]
  internal struct BasicLimits {
    internal long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    internal uint LimitFlags;
    internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    internal uint ActiveProcessLimit;
    internal UIntPtr Affinity;
    internal uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  internal struct IoCounters {
    internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    internal ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  internal struct ExtendedLimits {
    internal BasicLimits BasicLimitInformation;
    internal IoCounters IoInfo;
    internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)]
  internal struct Accounting {
    internal long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    internal uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited,
    out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool assigned);
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "QueryInformationJobObject")]
  internal static extern bool QueryAccounting(IntPtr job, int kind, out Accounting accounting, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "QueryInformationJobObject")]
  internal static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr buffer, uint size, IntPtr returned);

  internal static long Birth(IntPtr process) {
    FileTime created, exited, kernel, user;
    if (!GetProcessTimes(process, out created, out exited, out kernel, out user))
      throw new ClawNativeFailure("${ERRORS.IDENTITY}");
    long fileTime = unchecked((long)(((ulong)created.High << 32) | created.Low));
    return DateTime.FromFileTimeUtc(fileTime).Ticks;
  }
}

internal sealed class ClawJobSettlement {
  internal int[] Pids = Array.Empty<int>();
  internal bool Confirmed;
  internal uint? Unknown;
  internal string Code;
}

internal sealed class ClawOwnedJob : IDisposable {
  internal readonly int Pid;
  internal readonly long StartedAt;
  private readonly object gate = new object();
  private IntPtr process;
  private IntPtr job;
  internal ClawOwnedJob(int pid) {
    Pid = pid;
    try {
      process = ClawJobApi.OpenProcess(ClawJobApi.PROCESS_SET_QUOTA | ClawJobApi.PROCESS_TERMINATE |
        ClawJobApi.PROCESS_QUERY_LIMITED_INFORMATION | ClawJobApi.SYNCHRONIZE, false, pid);
      if (process == IntPtr.Zero || ClawJobApi.WaitForSingleObject(process, 0) != ClawJobApi.WAIT_TIMEOUT)
        throw new ClawNativeFailure("${ERRORS.ATTACH}");
      StartedAt = ClawJobApi.Birth(process);
      job = ClawJobApi.CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) throw new ClawNativeFailure("${ERRORS.ATTACH}");
      var limits = new ClawJobApi.ExtendedLimits();
      limits.BasicLimitInformation.LimitFlags = ClawJobApi.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (!ClawJobApi.SetInformationJobObject(job, ClawJobApi.EXTENDED_LIMITS, ref limits,
        (uint)Marshal.SizeOf<ClawJobApi.ExtendedLimits>()) || !ClawJobApi.AssignProcessToJobObject(job, process))
        throw new ClawNativeFailure("${ERRORS.ATTACH}");
      bool assigned;
      if (!ClawJobApi.IsProcessInJob(process, job, out assigned) || !assigned ||
        ClawJobApi.Birth(process) != StartedAt ||
        ClawJobApi.WaitForSingleObject(process, 0) != ClawJobApi.WAIT_TIMEOUT)
        throw new ClawNativeFailure("${ERRORS.IDENTITY}");
    } catch {
      Dispose();
      throw;
    }
  }

  private int[] KnownMembers() {
    const int headerBytes = 8;
    int bytes = headerBytes + ClawJobApi.MAX_PIDS * IntPtr.Size;
    IntPtr buffer = Marshal.AllocHGlobal(bytes);
    try {
      bool complete = ClawJobApi.QueryInformationJobObject(job, ClawJobApi.PROCESS_ID_LIST,
        buffer, (uint)bytes, IntPtr.Zero);
      if (!complete && Marshal.GetLastWin32Error() != ClawJobApi.ERROR_MORE_DATA)
        throw new ClawNativeFailure("${ERRORS.QUERY}");
      int listed = Marshal.ReadInt32(buffer, sizeof(uint));
      if (listed < 0 || listed > ClawJobApi.MAX_PIDS) throw new ClawNativeFailure("${ERRORS.QUERY}");
      var members = new HashSet<int> { Pid };
      for (int index = 0; index < listed && members.Count < ClawJobApi.MAX_PIDS; index++) {
        long member = Marshal.ReadIntPtr(buffer, headerBytes + index * IntPtr.Size).ToInt64();
        if (member <= ${SYSTEM_PID_MAX} || member > ${MAX_PID}) throw new ClawNativeFailure("${ERRORS.QUERY}");
        members.Add((int)member);
      }
      int[] known = new int[members.Count];
      members.CopyTo(known);
      Array.Sort(known);
      return known;
    } finally { Marshal.FreeHGlobal(buffer); }
  }

  internal ClawJobSettlement Terminate(int rootPid, string birth) {
    lock (gate) {
      if (job == IntPtr.Zero) throw new ClawNativeFailure("${ERRORS.CLOSED}");
      if (rootPid != Pid || birth != StartedAt.ToString(CultureInfo.InvariantCulture) ||
        ClawJobApi.Birth(process) != StartedAt)
        throw new ClawNativeFailure("${ERRORS.IDENTITY}");
      var settlement = new ClawJobSettlement();
      try {
        settlement.Pids = KnownMembers();
        if (!ClawJobApi.TerminateJobObject(job, 1)) throw new ClawNativeFailure("${ERRORS.QUERY}");
        var elapsed = Stopwatch.StartNew();
        while (true) {
          ClawJobApi.Accounting accounting;
          if (!ClawJobApi.QueryAccounting(job, ClawJobApi.BASIC_ACCOUNTING, out accounting,
            (uint)Marshal.SizeOf<ClawJobApi.Accounting>(), IntPtr.Zero))
            throw new ClawNativeFailure("${ERRORS.QUERY}");
          uint waited = ClawJobApi.WaitForSingleObject(process, 0);
          if (waited != ClawJobApi.WAIT_OBJECT_0 && waited != ClawJobApi.WAIT_TIMEOUT)
            throw new ClawNativeFailure("${ERRORS.QUERY}");
          settlement.Unknown = accounting.ActiveProcesses;
          if (accounting.ActiveProcesses == 0 && waited == ClawJobApi.WAIT_OBJECT_0) {
            settlement.Confirmed = true;
            return settlement;
          }
          if (elapsed.ElapsedMilliseconds >= ClawJobApi.SETTLE_TIMEOUT) {
            settlement.Code = "${ERRORS.TIMEOUT}";
            return settlement;
          }
          if (waited == ClawJobApi.WAIT_TIMEOUT)
            ClawJobApi.WaitForSingleObject(process, ClawJobApi.WAIT_INTERVAL);
          else Thread.Sleep(ClawJobApi.WAIT_INTERVAL);
        }
      } catch (ClawNativeFailure failure) {
        ClawJobApi.TerminateJobObject(job, 1);
        settlement.Confirmed = false;
        settlement.Unknown = null;
        settlement.Code = failure.Code;
        return settlement;
      }
    }
  }

  public void Dispose() {
    lock (gate) {
      bool jobClosed = true, processClosed = true;
      if (job != IntPtr.Zero) { jobClosed = ClawJobApi.CloseHandle(job); job = IntPtr.Zero; }
      if (process != IntPtr.Zero) { processClosed = ClawJobApi.CloseHandle(process); process = IntPtr.Zero; }
      if (!jobClosed || !processClosed) throw new ClawNativeFailure("${ERRORS.QUERY}");
    }
  }
}

internal sealed class ClawJobFrame {
  internal string Id, Scope, Op, Birth;
  internal int Pid;
  internal static ClawJobFrame Parse(string line) {
    using (var document = JsonDocument.Parse(line)) {
      var root = document.RootElement;
      Guid parsed;
      var frame = new ClawJobFrame {
        Id = root.GetProperty("id").GetString(), Scope = root.GetProperty("scope").GetString(),
        Op = root.GetProperty("op").GetString(), Pid = root.GetProperty("rootPid").GetInt32()
      };
      if (root.GetProperty("v").GetInt32() != 1 || root.GetProperty("t").GetString() != "request" ||
        frame.Id == null || frame.Id.Length != 32 || !Guid.TryParseExact(frame.Id, "N", out parsed) ||
        frame.Scope == null || frame.Scope.Length != 32 || !Guid.TryParseExact(frame.Scope, "N", out parsed) ||
        frame.Pid <= ${SYSTEM_PID_MAX} ||
        (frame.Op != "${OPERATIONS.OPEN}" && frame.Op != "${OPERATIONS.TERMINATE}" && frame.Op != "${OPERATIONS.CLOSE}"))
        throw new ClawNativeFailure("${ERRORS.PROTOCOL}");
      int fields = 0;
      foreach (var field in root.EnumerateObject()) {
        if (field.Name != "v" && field.Name != "t" && field.Name != "id" && field.Name != "scope" &&
          field.Name != "op" && field.Name != "rootPid" && field.Name != "rootStartedAt")
          throw new ClawNativeFailure("${ERRORS.PROTOCOL}");
        fields++;
      }
      if (frame.Op != "${OPERATIONS.OPEN}") frame.Birth = root.GetProperty("rootStartedAt").GetString();
      if (fields != (frame.Op == "${OPERATIONS.OPEN}" ? 6 : 7))
        throw new ClawNativeFailure("${ERRORS.PROTOCOL}");
      return frame;
    }
  }
}

public static class ClawWindowsJobBroker {
  private static readonly object registryGate = new object(), outputGate = new object();
  private static readonly Dictionary<string, ClawOwnedJob> jobs = new Dictionary<string, ClawOwnedJob>();
  private static readonly HashSet<int> roots = new HashSet<int>();
  private static readonly HashSet<string> requests = new HashSet<string>(), scopes = new HashSet<string>();
  private static readonly ConcurrentDictionary<string, Task> inflight = new ConcurrentDictionary<string, Task>();
  private static int parentPid, brokerPid;
  private static IntPtr parent;
  private static volatile bool stopping;

  private static void Write(object frame) {
    lock (outputGate) { Console.Out.WriteLine(JsonSerializer.Serialize(frame)); Console.Out.Flush(); }
  }
  private static void Reply(ClawJobFrame frame, ClawOwnedJob owned, ClawJobSettlement measured = null) {
    var settlement = measured ?? new ClawJobSettlement();
    Write(new {
      v = 1, t = "response", id = frame.Id, scope = frame.Scope, op = frame.Op, ok = true,
      rootPid = owned.Pid, rootStartedAt = owned.StartedAt.ToString(CultureInfo.InvariantCulture), rootReady = true,
      stoppedPids = settlement.Pids, settlementConfirmed = settlement.Confirmed,
      unknownProcesses = settlement.Unknown, code = settlement.Code
    });
  }
  private static ClawOwnedJob Open(ClawJobFrame frame) {
    lock (registryGate) {
      if (stopping || ClawJobApi.WaitForSingleObject(parent, 0) != ClawJobApi.WAIT_TIMEOUT)
        throw new ClawNativeFailure("${ERRORS.BROKER}");
      if (frame.Pid == parentPid || frame.Pid == brokerPid || roots.Contains(frame.Pid) || scopes.Contains(frame.Scope))
        throw new ClawNativeFailure("${ERRORS.IDENTITY}");
      if (jobs.Count >= ${MAX_SCOPES} || scopes.Count >= ${MAX_REQUESTS})
        throw new ClawNativeFailure("${ERRORS.LIMIT}");
      var owned = new ClawOwnedJob(frame.Pid);
      jobs.Add(frame.Scope, owned);
      roots.Add(frame.Pid);
      scopes.Add(frame.Scope);
      return owned;
    }
  }
  private static void Dispatch(ClawJobFrame frame) {
    try {
      if (frame.Op == "${OPERATIONS.OPEN}") { Reply(frame, Open(frame)); return; }
      ClawOwnedJob owned;
      lock (registryGate) {
        if (!jobs.TryGetValue(frame.Scope, out owned)) throw new ClawNativeFailure("${ERRORS.IDENTITY}");
      }
      if (frame.Pid != owned.Pid || frame.Birth != owned.StartedAt.ToString(CultureInfo.InvariantCulture))
        throw new ClawNativeFailure("${ERRORS.IDENTITY}");
      if (frame.Op == "${OPERATIONS.TERMINATE}") { Reply(frame, owned, owned.Terminate(frame.Pid, frame.Birth)); return; }
      ClawJobSettlement measured;
      try { measured = owned.Terminate(frame.Pid, frame.Birth); }
      finally {
        owned.Dispose();
        lock (registryGate) { jobs.Remove(frame.Scope); roots.Remove(owned.Pid); }
      }
      Reply(frame, owned, measured);
    } catch (Exception error) {
      Write(new {
        v = 1, t = "response", id = frame.Id, scope = frame.Scope, op = frame.Op, ok = false,
        code = error is ClawNativeFailure ? ((ClawNativeFailure)error).Code : "${ERRORS.BROKER}"
      });
    }
  }
  private static string ReadLine() {
    var line = new StringBuilder();
    while (true) {
      int character = Console.In.Read();
      if (character < 0) return line.Length == 0 ? null : throw new ClawNativeFailure("${ERRORS.PROTOCOL}");
      if (character == '\n') return line.ToString();
      if (line.Length >= ${MAX_FRAME_BYTES}) throw new ClawNativeFailure("${ERRORS.PROTOCOL}");
      if (character != '\r') line.Append((char)character);
    }
  }
  public static void Run(int ownerPid) {
    parentPid = ownerPid;
    using (var current = Process.GetCurrentProcess()) brokerPid = current.Id;
    Console.OutputEncoding = new UTF8Encoding(false);
    try {
      if (parentPid <= ${SYSTEM_PID_MAX} || parentPid == brokerPid) throw new ClawNativeFailure("${ERRORS.IDENTITY}");
      parent = ClawJobApi.OpenProcess(ClawJobApi.SYNCHRONIZE, false, parentPid);
      if (parent == IntPtr.Zero || ClawJobApi.WaitForSingleObject(parent, 0) != ClawJobApi.WAIT_TIMEOUT)
        throw new ClawNativeFailure("${ERRORS.UNAVAILABLE}");
      new Thread(() => {
        if (ClawJobApi.WaitForSingleObject(parent, ClawJobApi.INFINITE) == ClawJobApi.WAIT_OBJECT_0) Environment.Exit(0);
      }) { IsBackground = true }.Start();
      Write(new { v = 1, t = "ready", pid = brokerPid, parentPid = parentPid });
      string line;
      while ((line = ReadLine()) != null) {
        var frame = ClawJobFrame.Parse(line);
        if (requests.Count >= ${MAX_REQUESTS}) throw new ClawNativeFailure("${ERRORS.LIMIT}");
        if (!requests.Add(frame.Id)) throw new ClawNativeFailure("${ERRORS.PROTOCOL}");
        var task = Task.Run(() => Dispatch(frame));
        inflight[frame.Id] = task;
        task.ContinueWith(completed => { Task ignored; inflight.TryRemove(frame.Id, out ignored); });
      }
    } catch (Exception error) {
      Write(new { v = 1, t = "failed", code = error is ClawNativeFailure ? ((ClawNativeFailure)error).Code : "${ERRORS.PROTOCOL}" });
    } finally {
      stopping = true;
      Task.WaitAll(inflight.Values.ToArray(), ${REQUEST_TIMEOUT_MS});
      lock (registryGate) {
        foreach (var owned in jobs.Values) owned.Dispose();
        jobs.Clear();
        roots.Clear();
      }
      // Process exit closes the parent's read-only wait handle without racing its watcher.
    }
  }
}
`;
// Compress fixed own source to stay below Windows' native command-line length limit.
const COMPRESSED_BROKER_SOURCE = gzipSync(Buffer.from(WINDOWS_BROKER_SOURCE, "utf8")).toString("base64");
const WINDOWS_BROKER_BOOTSTRAP = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try {
$compressed = [IO.MemoryStream]::new([Convert]::FromBase64String("${COMPRESSED_BROKER_SOURCE}"))
$inflated = [IO.Compression.GZipStream]::new($compressed, [IO.Compression.CompressionMode]::Decompress)
$reader = [IO.StreamReader]::new($inflated, [Text.Encoding]::UTF8)
try { Add-Type -TypeDefinition $reader.ReadToEnd() -ErrorAction Stop }
finally { $reader.Dispose(); $inflated.Dispose(); $compressed.Dispose() }
[ClawWindowsJobBroker]::Run([int]$env:${PARENT_PID_ENVIRONMENT})
exit 0
} catch {
[Console]::WriteLine('{"v":1,"t":"failed","code":"${ERRORS.UNAVAILABLE}"}')
exit 1
}
`;
const WINDOWS_BROKER_COMMAND = Buffer.from(WINDOWS_BROKER_BOOTSTRAP, "utf16le").toString("base64");

function isPid(pid) {
  return Number.isSafeInteger(pid) && pid > SYSTEM_PID_MAX && pid <= MAX_PID;
}

function safeError(error, fallback = ERRORS.BROKER) {
  return new ClawError(SAFE_CODES.has(error?.code) ? error.code : fallback);
}

function brokerEnvironment() {
  return { ...HOST_ENVIRONMENT, [PARENT_PID_ENVIRONMENT]: String(process.pid) };
}

async function resolveBrokerExecutable() {
  const hostPath = Object.entries(HOST_ENVIRONMENT).find(([name]) => name.toUpperCase() === "PATH")?.[1] ?? "";
  const directories = hostPath.split(path.delimiter).filter((directory) => path.isAbsolute(directory));
  if (HOST_PROGRAM_FILES) directories.unshift(path.join(HOST_PROGRAM_FILES, "PowerShell", "7"));
  for (const directory of [...new Set(directories)].slice(0, MAX_HOST_PATH_DIRECTORIES)) {
    const command = path.join(directory, "pwsh.exe");
    try {
      await access(command);
      return command;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw new ClawError(ERRORS.UNAVAILABLE);
    }
  }
  throw new ClawError(ERRORS.UNAVAILABLE);
}

function uniqueId(reserved) {
  const id = randomUUID().replaceAll("-", "");
  if (reserved.has(id)) throw new ClawError(ERRORS.IDENTITY);
  return id;
}

function failBroker(broker, code) {
  if (broker.failure) return;
  broker.failure = SAFE_CODES.has(code) ? code : ERRORS.BROKER;
  clearTimeout(broker.startupTimer);
  clearTimeout(broker.idleTimer);
  broker.ready.reject(new ClawError(broker.failure));
  for (const pending of broker.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new ClawError(broker.failure));
  }
  broker.pending.clear();
  if (!broker.isClosed && !broker.stopping) broker.child.kill();
}

function receiveReady(broker, frame) {
  if (broker.isReady || frame.pid !== broker.child.pid || frame.parentPid !== process.pid) {
    return failBroker(broker, ERRORS.PROTOCOL);
  }
  broker.isReady = true;
  clearTimeout(broker.startupTimer);
  broker.ready.resolve(true);
}

function receiveResponse(broker, frame) {
  const pending = broker.pending.get(frame.id);
  if (frame.t !== "response" || !pending || pending.scope !== frame.scope || pending.op !== frame.op) {
    return failBroker(broker, ERRORS.PROTOCOL);
  }
  broker.pending.delete(frame.id);
  clearTimeout(pending.timer);
  pending.resolve(frame);
}

function receiveFrame(broker, frame) {
  if (!frame || typeof frame !== "object" || frame.v !== 1) return failBroker(broker, ERRORS.PROTOCOL);
  if (frame.t === "failed") return failBroker(broker, SAFE_CODES.has(frame.code) ? frame.code : ERRORS.BROKER);
  if (frame.t === "ready") return receiveReady(broker, frame);
  receiveResponse(broker, frame);
}

function consumeOutput(broker, chunk) {
  if (broker.failure) return;
  broker.buffer += broker.decoder.write(chunk);
  if (Buffer.byteLength(broker.buffer, "utf8") > MAX_BUFFER_BYTES) return failBroker(broker, ERRORS.PROTOCOL);
  let newline;
  while ((newline = broker.buffer.indexOf("\n")) !== -1) {
    const line = broker.buffer.slice(0, newline);
    broker.buffer = broker.buffer.slice(newline + 1);
    try {
      receiveFrame(broker, JSON.parse(line));
    } catch {
      failBroker(broker, ERRORS.PROTOCOL);
    }
    if (broker.failure) return;
  }
}

function createBroker(command) {
  const broker = {
    child: spawn(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", WINDOWS_BROKER_COMMAND], {
      env: brokerEnvironment(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    }),
    ready: Promise.withResolvers(), closed: Promise.withResolvers(),
    pending: new Map(), scopes: new Map(), decoder: new StringDecoder("utf8"), buffer: "",
    isReady: false, isClosed: false, stopping: false, failure: null, stderrBytes: 0,
  };
  broker.child.stdout.on("data", (chunk) => consumeOutput(broker, chunk));
  broker.child.stderr.on("data", (chunk) => {
    broker.stderrBytes += chunk.length;
    if (broker.stderrBytes > MAX_BUFFER_BYTES) failBroker(broker, ERRORS.BROKER);
  });
  broker.child.stdin.on("error", () => failBroker(broker, ERRORS.BROKER));
  broker.child.once("error", () => failBroker(broker, ERRORS.UNAVAILABLE));
  broker.child.once("close", () => {
    broker.isClosed = true;
    clearTimeout(broker.stopTimer);
    clearTimeout(broker.idleTimer);
    if (!broker.stopping) failBroker(broker, ERRORS.BROKER);
    if (sharedBroker === broker) sharedBroker = undefined;
    broker.closed.resolve();
  });
  broker.startupTimer = setTimeout(() => failBroker(broker, ERRORS.TIMEOUT), STARTUP_TIMEOUT_MS);
  broker.startupTimer.unref?.();
  return broker;
}

async function acquireBroker() {
  while (sharedBroker?.stopping || sharedBroker?.failure) await sharedBroker.closed.promise;
  if (!sharedBroker) {
    brokerCreation ??= resolveBrokerExecutable().then((command) => {
      sharedBroker = createBroker(command);
      return sharedBroker;
    }).finally(() => { brokerCreation = undefined; });
  }
  const broker = sharedBroker ?? await brokerCreation;
  clearTimeout(broker.idleTimer);
  return broker;
}

function stopBroker(broker) {
  if (!broker.stopping && !broker.isClosed) {
    broker.stopping = true;
    clearTimeout(broker.idleTimer);
    clearTimeout(broker.startupTimer);
    broker.stopTimer = setTimeout(() => {
      if (!broker.isClosed) broker.child.kill();
    }, BROKER_STOP_TIMEOUT_MS);
    broker.stopTimer.unref?.();
    broker.child.stdin.end();
  }
  return broker.closed.promise;
}

function scheduleIdleStop(broker) {
  if (broker.scopes.size || broker.pending.size || broker.stopping || broker.isClosed || broker.failure) return;
  clearTimeout(broker.idleTimer);
  broker.idleTimer = setTimeout(() => {
    if (!broker.scopes.size && !broker.pending.size) void stopBroker(broker);
  }, BROKER_IDLE_GRACE_MS);
  broker.idleTimer.unref?.();
}

async function request(broker, record, op) {
  if (broker.failure || broker.stopping || broker.isClosed) throw new ClawError(broker.failure ?? ERRORS.CLOSED);
  if (broker.pending.size >= MAX_SCOPES) throw new ClawError(ERRORS.LIMIT);
  const id = uniqueId(broker.pending);
  const waiting = Promise.withResolvers();
  const frame = {
    v: 1, t: "request", id, scope: record.id, op, rootPid: record.rootPid,
    ...(op === OPERATIONS.OPEN ? {} : { rootStartedAt: record.rootStartedAt }),
  };
  const timer = setTimeout(() => failBroker(broker, ERRORS.TIMEOUT), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  broker.pending.set(id, { ...waiting, scope: record.id, op, timer });
  broker.child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
    if (error) failBroker(broker, ERRORS.BROKER);
  });
  const response = await waiting.promise;
  if (response.ok === false) throw safeError(response);
  if (response.ok !== true) {
    failBroker(broker, ERRORS.PROTOCOL);
    throw new ClawError(ERRORS.PROTOCOL);
  }
  return response;
}

function requireIdentity(broker, record, response) {
  if (response.rootPid !== record.rootPid || response.rootReady !== true
    || typeof response.rootStartedAt !== "string" || !START_IDENTITY.test(response.rootStartedAt)
    || (record.rootStartedAt && response.rootStartedAt !== record.rootStartedAt)) {
    failBroker(broker, ERRORS.PROTOCOL);
    throw new ClawError(ERRORS.PROTOCOL);
  }
}

function failedSettlement(record, code) {
  return {
    rootPid: record.rootPid, rootStartedAt: record.rootStartedAt, rootReady: true,
    stoppedPids: [], settlementConfirmed: false, unknownProcesses: null,
    code: SAFE_CODES.has(code) ? code : ERRORS.UNCONFIRMED,
  };
}

function isNativeCount(unknown) {
  return unknown === null || (Number.isSafeInteger(unknown) && unknown >= 0 && unknown <= MAX_NATIVE_COUNT);
}

function isOwnedPidList(broker, stoppedPids) {
  return Array.isArray(stoppedPids) && stoppedPids.length <= MAX_KNOWN_PIDS
    && stoppedPids.every((pid) => isPid(pid) && pid !== process.pid && pid !== broker.child.pid)
    && new Set(stoppedPids).size === stoppedPids.length;
}

function hasZeroProof(record, response) {
  return typeof response.settlementConfirmed === "boolean"
    && (!response.settlementConfirmed || (response.unknownProcesses === 0 && response.stoppedPids.includes(record.rootPid)));
}

function readSettlement(broker, record, response) {
  requireIdentity(broker, record, response);
  if (!isNativeCount(response.unknownProcesses) || !isOwnedPidList(broker, response.stoppedPids)
    || !hasZeroProof(record, response)) {
    failBroker(broker, ERRORS.PROTOCOL);
    throw new ClawError(ERRORS.PROTOCOL);
  }
  return {
    rootPid: record.rootPid, rootStartedAt: record.rootStartedAt, rootReady: true,
    stoppedPids: [...response.stoppedPids], settlementConfirmed: response.settlementConfirmed,
    unknownProcesses: response.unknownProcesses,
    ...(response.settlementConfirmed ? {} : {
      code: SAFE_CODES.has(response.code) ? response.code : ERRORS.UNCONFIRMED,
    }),
  };
}

async function terminateScope(broker, record) {
  try {
    return readSettlement(broker, record, await request(broker, record, OPERATIONS.TERMINATE));
  } catch (error) {
    return failedSettlement(record, safeError(error).code);
  }
}

async function closeScope(broker, record) {
  try {
    if (record.termination) await record.termination;
    if (broker.failure || broker.isClosed) {
      await broker.closed.promise;
      return;
    }
    const receipt = readSettlement(broker, record, await request(broker, record, OPERATIONS.CLOSE));
    if (!receipt.settlementConfirmed) throw new ClawError(receipt.code);
  } catch (error) {
    const failure = safeError(error);
    failBroker(broker, failure.code);
    await broker.closed.promise;
    throw failure;
  } finally {
    broker.scopes.delete(record.id);
    if (roots.get(record.rootPid) === record) roots.delete(record.rootPid);
    scheduleIdleStop(broker);
  }
}

function scopeHandle(broker, record) {
  return {
    rootPid: record.rootPid, rootStartedAt: record.rootStartedAt,
    terminate() {
      if (record.termination) return record.termination;
      if (record.closing) return Promise.resolve(failedSettlement(record, ERRORS.CLOSED));
      record.termination = terminateScope(broker, record);
      return record.termination;
    },
    close() {
      record.closing ??= closeScope(broker, record);
      return record.closing;
    },
  };
}

function isOptionsObject(options) {
  return options !== null && typeof options === "object" && !Array.isArray(options);
}

function requireRootOptions(options) {
  if (process.platform !== "win32") throw new ClawError(ERRORS.UNAVAILABLE);
  try {
    if (!isOptionsObject(options)) throw new ClawError(ERRORS.INVALID_OPTIONS);
    const { rootPid, env = process.env } = options;
    if (!isPid(rootPid) || !isOptionsObject(env)) throw new ClawError(ERRORS.INVALID_OPTIONS);
    if (rootPid === process.pid || roots.has(rootPid)) throw new ClawError(ERRORS.IDENTITY);
    return rootPid;
  } catch (error) {
    throw safeError(error, ERRORS.INVALID_OPTIONS);
  }
}

/**
 * Attach a held, caller-owned live root to a private Windows Job Object before argv execution.
 * @param {{rootPid: number, env?: object}} options
 * @returns {Promise<{rootPid: number, rootStartedAt: string, terminate(): Promise<{
 * rootPid: number, rootStartedAt: string, rootReady: true, stoppedPids: number[],
 * settlementConfirmed: boolean, unknownProcesses: number|null, code?: string}>, close(): Promise<void>}>}
 */
export async function openWindowsProcessScope(options = {}) {
  const rootPid = requireRootOptions(options);
  let broker;
  try {
    broker = await acquireBroker();
  } catch (error) {
    throw safeError(error, ERRORS.UNAVAILABLE);
  }
  if (roots.has(rootPid)) throw new ClawError(ERRORS.IDENTITY);
  if (broker.scopes.size >= MAX_SCOPES) throw new ClawError(ERRORS.LIMIT);
  const record = { id: uniqueId(broker.scopes), rootPid, rootStartedAt: null };
  roots.set(rootPid, record);
  broker.scopes.set(record.id, record);
  try {
    await broker.ready.promise;
    if (rootPid === broker.child.pid) throw new ClawError(ERRORS.IDENTITY);
    const response = await request(broker, record, OPERATIONS.OPEN);
    requireIdentity(broker, record, response);
    record.rootStartedAt = response.rootStartedAt;
    return scopeHandle(broker, record);
  } catch (error) {
    roots.delete(rootPid);
    broker.scopes.delete(record.id);
    scheduleIdleStop(broker);
    if (broker.failure) await broker.closed.promise;
    throw safeError(error);
  }
}

/**
 * Await idle broker disposal. Never shuts down a broker that still owns another active scope.
 * @returns {Promise<void>}
 */
export async function closeWindowsProcessBroker() {
  const broker = sharedBroker;
  if (!broker) return;
  if (broker.scopes.size || broker.pending.size) throw new ClawError(ERRORS.BUSY);
  await stopBroker(broker);
}
