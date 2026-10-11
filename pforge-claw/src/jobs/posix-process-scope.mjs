import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { ClawError } from "../errors.mjs";
import { NATIVE_SCOPE_ERRORS, NATIVE_SUPERVISOR_ARGUMENT } from "./native-command-supervisor.mjs";

const MAX_PATH_BYTES = 2_048;
const MAX_CONTROL_BYTES = 32_768;
const CONTROL_TIMEOUT_MS = 3_000;
const BROKER_START_TIMEOUT_MS = 2_500;
const MAX_BROKER_SCOPES = 256;
const PROC_START_INDEX = 19;
const SCOPE_ADDRESS_PREFIX = "\0pforge-claw-posix-";
const BROKERS = new Map();
const BROKER_ENVIRONMENT_FIELDS = Object.freeze([
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE",
]);
const TRUSTED_SUPERVISOR_PATH = fileURLToPath(new URL("./native-command-supervisor.mjs", import.meta.url));
const UNSEALED_RUNTIME_HOOK = /^(?:CORECLR_|COR_|COMPlus_ProfAPI|LD_(?!PRELOAD$|LIBRARY_PATH$))/;

/**
 * @typedef {{rootPid:number, rootStartedAt:string, rootReady:boolean, stoppedPids:number[],
 * settlementConfirmed:boolean, unknownProcesses:number|null, code?:string}} NativeSettlement
 * @typedef {{rootPid:number, rootStartedAt:string, terminate:()=>Promise<NativeSettlement>,
 * close:()=>Promise<void>}} PosixProcessScope
 */

// The held root retains waitpid authority. Exec'ing Node here would lose the ability to reap adopted children.
const NATIVE_SOURCE = String.raw`
using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using Microsoft.Win32.SafeHandles;

public sealed class ScopeFault : Exception {
    public readonly string Code;
    public ScopeFault(string code) : base(code) { Code = code; }
}
public static class ClawPosixNative {
    public const string Unavailable = "__UNAVAILABLE__";
    public const string Unconfirmed = "__UNCONFIRMED__";
    public const string Limit = "__LIMIT__";
    public const int ECHILD = 10, EINTR = 4, ESRCH = 3, MaxProcesses = __MAX_PROCESSES__, DeadlineMs = 3000;
    public const int MaxControlChars = 32768, MaxActorChars = 2097152;
    public const int MaxEnvironmentBytes = 8388608, ReadBatchBytes = 8192;
    public const int SetChildSubreaper = 36, GetChildSubreaper = 37, KillSignal = 9, NoHang = 1;
    public const int SetFdFlags = 2, CloseOnExec = 1, SocketLevel = 1, PeerCredentialsOption = 17;
    public const long PidFdOpenCall = 434, PidFdSignalCall = 424;
    public const short POLLIN = 1, POLLNVAL = 32;
    [StructLayout(LayoutKind.Sequential)]
    public struct PollFd { public int fd; public short events; public short revents; }
    [StructLayout(LayoutKind.Sequential)]
    public struct PeerCredentials { public int pid; public uint uid; public uint gid; }
    [DllImport("libc", SetLastError=true)] public static extern int getpid();
    [DllImport("libc", SetLastError=true)] public static extern int getppid();
    [DllImport("libc", SetLastError=true)] public static extern uint getuid();
    [DllImport("libc", SetLastError=true)] public static extern int close(int fd);
    [DllImport("libc", SetLastError=true)] public static extern int fcntl(int fd, int command, int argument);
    [DllImport("libc", SetLastError=true)] public static extern int waitpid(int pid, out int status, int options);
    [DllImport("libc", SetLastError=true)] public static extern int poll([In,Out] PollFd[] fds, ulong count, int timeout);
    [DllImport("libc", SetLastError=true)] public static extern int prctl(int option, ulong arg, ulong arg3, ulong arg4, ulong arg5);
    [DllImport("libc", EntryPoint="prctl", SetLastError=true)]
    public static extern int prctlGet(int option, out int value, ulong arg3, ulong arg4, ulong arg5);
    [DllImport("libc", EntryPoint="syscall", SetLastError=true)]
    public static extern long pidfd_open(long number, int pid, uint flags);
    [DllImport("libc", EntryPoint="syscall", SetLastError=true)]
    public static extern long pidfd_send_signal(long number, int fd, int signal, IntPtr info, uint flags);
    [DllImport("libc", SetLastError=true)]
    public static extern int getsockopt(int fd, int level, int option, out PeerCredentials peer, ref uint length);
    [DllImport("libc")] public static extern void _exit(int code);
    public static string Proc(params string[] parts) {
        string target = Path.DirectorySeparatorChar + "proc";
        foreach (string part in parts) target = Path.Combine(target, part);
        return target;
    }
    public static (int Parent, string Birth) Identity(int pid) {
        string text = File.ReadAllText(Proc(pid.ToString(CultureInfo.InvariantCulture), "stat"));
        string[] fields = text.Substring(text.LastIndexOf(')') + 2).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return (int.Parse(fields[1], CultureInfo.InvariantCulture), fields[19]);
    }
    public static int OpenPid(int pid, string birth, int? parent = null) {
        var before = Identity(pid);
        if (before.Birth != birth || (parent.HasValue && before.Parent != parent.Value)) throw new ScopeFault(Unconfirmed);
        int fd = checked((int)pidfd_open(PidFdOpenCall, pid, 0));
        if (fd < 0) throw new ScopeFault(Unavailable);
        try {
            var after = Identity(pid);
            string identity = File.ReadAllText(Proc("self", "fdinfo", fd.ToString(CultureInfo.InvariantCulture)));
            if (after != before || !identity.Contains("Pid:\t" + pid.ToString(CultureInfo.InvariantCulture) + "\n"))
                throw new ScopeFault(Unconfirmed);
            return fd;
        } catch { close(fd); throw; }
    }
    public static bool HasExited(int fd, int timeout) {
        var descriptors = new[] { new PollFd { fd = fd, events = POLLIN } };
        int status = poll(descriptors, 1, timeout);
        if (status < 0 && Marshal.GetLastWin32Error() == EINTR) return false;
        if (status < 0 || (descriptors[0].revents & POLLNVAL) != 0) throw new ScopeFault(Unconfirmed);
        return (descriptors[0].revents & POLLIN) != 0;
    }
    public static void EstablishSubreaper() {
        if (prctl(SetChildSubreaper, 1, 0, 0, 0) != 0 ||
            prctlGet(GetChildSubreaper, out int enabled, 0, 0, 0) != 0 || enabled != 1)
            throw new ScopeFault(Unavailable);
        int self = OpenPid(getpid(), Identity(getpid()).Birth);
        try {
            if (HasExited(self, 0)) throw new ScopeFault(Unconfirmed);
            if (pidfd_send_signal(PidFdSignalCall, self, 0, IntPtr.Zero, 0) < 0) throw new ScopeFault(Unavailable);
        }
        finally { close(self); }
    }
    public static IEnumerable<string> InitialEnvironment() {
        using var input = File.OpenRead(Proc("self", "environ"));
        using var contents = new MemoryStream();
        var batch = new byte[ReadBatchBytes];
        int count;
        while ((count = input.Read(batch, 0, batch.Length)) > 0) {
            if (contents.Length + count > MaxEnvironmentBytes) throw new ScopeFault(Limit);
            contents.Write(batch, 0, count);
        }
        return Encoding.UTF8.GetString(contents.ToArray()).Split('\0', StringSplitOptions.RemoveEmptyEntries);
    }
    public static string ReadLine(StreamReader reader, int limit) {
        var text = new StringBuilder();
        for (;;) {
            int character = reader.Read();
            if (character < 0) return text.Length == 0 ? null : throw new ScopeFault(Unconfirmed);
            if (character == '\n') return text.ToString();
            if (text.Length >= limit) throw new ScopeFault(Limit);
            text.Append((char)character);
        }
    }
    public static StreamWriter Writer(Stream stream) {
        return new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true, NewLine = "\n" };
    }
    public static string Error(Exception exception) {
        return exception is ScopeFault fault ? fault.Code : Unconfirmed;
    }
}
`;

const ROOT_SOURCE = String.raw`
public sealed class ClawPosixRoot {
    const string ReadyMessage = "owned-ready", StartMessage = "owned-start", ResultMessage = "owned-result";
    const int UnixDomain = 1, StreamSocket = 1, SocketCloseOnExec = 524288;
    const int SpawnActionsBytes = 256, MaxPidDigits = 16;
    [DllImport("libc", SetLastError=true)] static extern int socketpair(int domain, int type, int protocol, [Out] int[] pair);
    [DllImport("libc", SetLastError=true)] static extern int posix_spawn_file_actions_init(IntPtr actions);
    [DllImport("libc", SetLastError=true)] static extern int posix_spawn_file_actions_destroy(IntPtr actions);
    [DllImport("libc", SetLastError=true)] static extern int posix_spawn_file_actions_adddup2(IntPtr actions, int source, int target);
    [DllImport("libc", SetLastError=true)] static extern int posix_spawn_file_actions_addclose(IntPtr actions, int fd);
    [DllImport("libc", SetLastError=true)]
    static extern int posix_spawn(out int pid, string executable, IntPtr actions, IntPtr attrs, IntPtr argv, IntPtr env);
    sealed class Vector : IDisposable {
        readonly List<IntPtr> strings = new List<IntPtr>();
        public readonly IntPtr Pointer;
        public Vector(IEnumerable<string> entries) {
            foreach (string entry in entries) strings.Add(Marshal.StringToCoTaskMemUTF8(entry));
            Pointer = Marshal.AllocHGlobal((strings.Count + 1) * IntPtr.Size);
            for (int index = 0; index < strings.Count; index++) Marshal.WriteIntPtr(Pointer, index * IntPtr.Size, strings[index]);
            Marshal.WriteIntPtr(Pointer, strings.Count * IntPtr.Size, IntPtr.Zero);
        }
        public void Dispose() {
            foreach (IntPtr entry in strings) Marshal.FreeCoTaskMem(entry);
            Marshal.FreeHGlobal(Pointer);
        }
    }
    readonly object state = new object(), outputLock = new object();
    readonly int rootPid, ownerPid;
    readonly string rootBirth;
    readonly HashSet<int> stopped = new HashSet<int>();
    readonly StreamWriter outerWriter;
    readonly StreamReader outerReader;
    StreamWriter innerWriter;
    bool attached, terminating, started, exceededLimit;

    ClawPosixRoot(int fd) {
        rootPid = ClawPosixNative.getpid(); ownerPid = ClawPosixNative.getppid();
        rootBirth = ClawPosixNative.Identity(rootPid).Birth;
        if (ClawPosixNative.fcntl(fd, ClawPosixNative.SetFdFlags, ClawPosixNative.CloseOnExec) < 0)
            throw new ScopeFault(ClawPosixNative.Unavailable);
        var socket = new Socket(new SafeSocketHandle((IntPtr)fd, true));
        var stream = new NetworkStream(socket, true);
        outerWriter = ClawPosixNative.Writer(stream);
        outerReader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);
    }
    void SendOuter(object frame) {
        lock (outputLock) outerWriter.WriteLine(JsonSerializer.Serialize(frame));
    }
    static void StartReader(ThreadStart read) {
        // A held IPC read must not occupy the pool that would otherwise deliver its START.
        new Thread(read) { IsBackground = true }.Start();
    }
    void StartSupervisor(JsonElement config) {
        var pair = new int[2];
        if (socketpair(UnixDomain, StreamSocket | SocketCloseOnExec, 0, pair) != 0)
            throw new ScopeFault(ClawPosixNative.Unavailable);
        IntPtr actions = Marshal.AllocHGlobal(SpawnActionsBytes);
        bool initialized = false;
        try {
            if (posix_spawn_file_actions_init(actions) != 0) throw new ScopeFault(ClawPosixNative.Unavailable);
            initialized = true;
            if (posix_spawn_file_actions_adddup2(actions, pair[1], 3) != 0 ||
                posix_spawn_file_actions_addclose(actions, pair[0]) != 0 ||
                (pair[1] != 3 && posix_spawn_file_actions_addclose(actions, pair[1]) != 0))
                throw new ScopeFault(ClawPosixNative.Unavailable);
            string node = config.GetProperty("node").GetString();
            var environment = new List<string>();
            // PowerShell mutates PATH at startup; the kernel retains our original exec environment.
            foreach (string entry in ClawPosixNative.InitialEnvironment()) {
                if (!entry.StartsWith("NODE_CHANNEL_FD=", StringComparison.Ordinal) &&
                    !entry.StartsWith("NODE_CHANNEL_SERIALIZATION_MODE=", StringComparison.Ordinal)) environment.Add(entry);
            }
            environment.Add("NODE_CHANNEL_FD=3"); environment.Add("NODE_CHANNEL_SERIALIZATION_MODE=json");
            using var argv = new Vector(new[] { node, config.GetProperty("supervisorPath").GetString(),
                config.GetProperty("argument").GetString() });
            using var env = new Vector(environment);
            if (posix_spawn(out int child, node, actions, IntPtr.Zero, argv.Pointer, env.Pointer) != 0)
                throw new ScopeFault(ClawPosixNative.Unavailable);
        } finally {
            if (initialized) posix_spawn_file_actions_destroy(actions);
            Marshal.FreeHGlobal(actions);
            ClawPosixNative.close(pair[1]);
        }
        var stream = new NetworkStream(new Socket(new SafeSocketHandle((IntPtr)pair[0], true)), true);
        innerWriter = ClawPosixNative.Writer(stream);
        var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);
        StartReader(() => Relay(reader));
    }
    void Relay(StreamReader reader) {
        try {
            string line;
            while ((line = ClawPosixNative.ReadLine(reader, ClawPosixNative.MaxActorChars)) != null) {
                using var document = JsonDocument.Parse(line);
                var frame = document.RootElement;
                if (frame.GetProperty("t").GetString() == ReadyMessage)
                    SendOuter(new { v = 1, t = ReadyMessage, pid = rootPid });
                else { lock (outputLock) outerWriter.WriteLine(line); }
            }
        } catch { if (!terminating) SendFailure(ClawPosixNative.Unconfirmed); }
    }
    void SendFailure(string code) {
        try { SendOuter(new { v = 1, t = ResultMessage, code = -1, errorCode = code }); }
        catch { terminating = true; }
    }
    void ReadParent() {
        try {
            string line;
            while ((line = ClawPosixNative.ReadLine(outerReader, ClawPosixNative.MaxActorChars)) != null) {
                using var document = JsonDocument.Parse(line);
                var frame = document.RootElement;
                if (frame.GetProperty("t").GetString() != StartMessage) continue;
                lock (state) {
                    if (!attached || terminating || started) throw new ScopeFault(ClawPosixNative.Unconfirmed);
                    started = true;
                    innerWriter.WriteLine(line);
                }
            }
        } catch (Exception exception) { SendFailure(ClawPosixNative.Error(exception)); }
        StopChildren();
        ClawPosixNative._exit(0);
    }
    IEnumerable<int> Children() {
        foreach (string task in Directory.EnumerateDirectories(ClawPosixNative.Proc("self", "task"))) {
            StreamReader input;
            try { input = File.OpenText(Path.Combine(task, "children")); }
            catch (FileNotFoundException) { continue; }
            catch (DirectoryNotFoundException) { continue; }
            using (input) {
                var token = new StringBuilder();
                int character;
                while ((character = input.Read()) >= 0) {
                    if (char.IsWhiteSpace((char)character)) {
                        if (token.Length == 0) continue;
                        yield return int.Parse(token.ToString(), CultureInfo.InvariantCulture);
                        token.Clear();
                    } else {
                        if (token.Length >= MaxPidDigits) throw new ScopeFault(ClawPosixNative.Unconfirmed);
                        token.Append((char)character);
                    }
                }
                if (token.Length > 0) yield return int.Parse(token.ToString(), CultureInfo.InvariantCulture);
            }
        }
    }
    void RecordStopped(int pid) {
        if (stopped.Contains(pid)) return;
        if (stopped.Count >= ClawPosixNative.MaxProcesses) exceededLimit = true;
        else stopped.Add(pid);
    }
    void StopChild(int pid) {
        int fd = -1;
        try {
            var identity = ClawPosixNative.Identity(pid);
            if (identity.Parent != rootPid) throw new ScopeFault(ClawPosixNative.Unconfirmed);
            fd = ClawPosixNative.OpenPid(pid, identity.Birth, rootPid);
            if (ClawPosixNative.pidfd_send_signal(ClawPosixNative.PidFdSignalCall, fd,
                ClawPosixNative.KillSignal, IntPtr.Zero, 0) < 0 &&
                Marshal.GetLastWin32Error() != ClawPosixNative.ESRCH) throw new ScopeFault(ClawPosixNative.Unconfirmed);
            RecordStopped(pid);
        } catch (FileNotFoundException) { return; }
        catch (DirectoryNotFoundException) { return; }
        finally { if (fd >= 0) ClawPosixNative.close(fd); }
    }
    (bool Zero, string Code) StopChildren() {
        lock (state) {
            terminating = true;
            var elapsed = Stopwatch.StartNew();
            try {
                while (elapsed.ElapsedMilliseconds < ClawPosixNative.DeadlineMs) {
                    int reaped;
                    do {
                        reaped = ClawPosixNative.waitpid(-1, out int status, ClawPosixNative.NoHang);
                        if (reaped > 0) RecordStopped(reaped);
                    } while (reaped > 0);
                    int error = Marshal.GetLastWin32Error();
                    if (reaped < 0 && error == ClawPosixNative.ECHILD)
                        return (true, exceededLimit ? ClawPosixNative.Limit : null);
                    if (reaped < 0 && error != ClawPosixNative.EINTR) throw new ScopeFault(ClawPosixNative.Unconfirmed);
                    foreach (int pid in Children()) {
                        if (elapsed.ElapsedMilliseconds >= ClawPosixNative.DeadlineMs)
                            return (false, ClawPosixNative.Unconfirmed);
                        StopChild(pid);
                    }
                    Thread.Sleep(1);
                }
                return (false, ClawPosixNative.Unconfirmed);
            } catch (Exception exception) { return (false, ClawPosixNative.Error(exception)); }
        }
    }
    void Control(Socket listener) {
        using var socket = listener.Accept();
        uint length = 12;
        if (ClawPosixNative.getsockopt(socket.Handle.ToInt32(), ClawPosixNative.SocketLevel,
            ClawPosixNative.PeerCredentialsOption, out var peer, ref length) != 0 ||
            peer.pid != ownerPid || peer.uid != ClawPosixNative.getuid()) return;
        using var stream = new NetworkStream(socket, false);
        using var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);
        using var writer = ClawPosixNative.Writer(stream);
        using var request = JsonDocument.Parse(ClawPosixNative.ReadLine(reader, ClawPosixNative.MaxControlChars));
        var attach = request.RootElement;
        if (attach.GetProperty("rootPid").GetInt32() != rootPid ||
            attach.GetProperty("rootStartedAt").GetString() != rootBirth) throw new ScopeFault(ClawPosixNative.Unconfirmed);
        lock (state) attached = true;
        writer.WriteLine(JsonSerializer.Serialize(new {
            v = 1, rootPid, rootStartedAt = rootBirth, rootReady = true, subreaper = true, pidfd = true
        }));
        string command = ClawPosixNative.ReadLine(reader, ClawPosixNative.MaxControlChars);
        if (command != null) {
            using var operation = JsonDocument.Parse(command);
            if (operation.RootElement.GetProperty("operation").GetString() != "terminate")
                throw new ScopeFault(ClawPosixNative.Unconfirmed);
        }
        var receipt = StopChildren();
        if (command != null) writer.WriteLine(JsonSerializer.Serialize(new {
            v = 1, rootPid, rootStartedAt = rootBirth, rootReady = true, zeroChildren = receipt.Zero,
            stoppedPids = stopped, unknownProcesses = receipt.Zero ? (int?)0 : null, code = receipt.Code
        }));
        ClawPosixNative._exit(receipt.Zero ? 0 : 1);
    }
    public static void Run(string encoded) {
        ClawPosixRoot root = null;
        try {
            int fd = int.Parse(Environment.GetEnvironmentVariable("NODE_CHANNEL_FD"), CultureInfo.InvariantCulture);
            root = new ClawPosixRoot(fd);
            ClawPosixNative.EstablishSubreaper();
            using var config = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(encoded)));
            using var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            listener.Bind(new UnixDomainSocketEndPoint("\0pforge-claw-posix-" + root.rootPid + "-" + root.rootBirth));
            listener.Listen(1);
            root.StartSupervisor(config.RootElement);
            StartReader(root.ReadParent);
            root.Control(listener);
            root.StopChildren();
            ClawPosixNative._exit(1);
        } catch (Exception exception) {
            if (root != null) { root.SendFailure(ClawPosixNative.Error(exception)); root.StopChildren(); }
            ClawPosixNative._exit(1);
        }
    }
}
`;

const BROKER_SOURCE = String.raw`
public static class ClawPosixObserver {
    static readonly Dictionary<int, int> handles = new Dictionary<int, int>();
    static readonly object state = new object(), outputLock = new object();
    static void Send(object frame) {
        lock (outputLock) { Console.Out.WriteLine(JsonSerializer.Serialize(frame)); Console.Out.Flush(); }
    }
    static object Execute(JsonElement request) {
        int id = request.GetProperty("id").GetInt32(), pid = request.GetProperty("rootPid").GetInt32();
        string operation = request.GetProperty("operation").GetString();
        if (operation == "open") {
            lock (state) {
                if (handles.Count >= ClawPosixNative.MaxProcesses) throw new ScopeFault(ClawPosixNative.Limit);
                if (handles.ContainsKey(pid)) throw new ScopeFault(ClawPosixNative.Unconfirmed);
                handles[pid] = ClawPosixNative.OpenPid(pid, request.GetProperty("rootStartedAt").GetString(),
                    ClawPosixNative.getppid());
            }
            return new { id, ok = true };
        }
        if (operation == "dispose") {
            lock (state) {
                if (handles.Remove(pid, out int descriptor)) ClawPosixNative.close(descriptor);
            }
            return new { id, ok = true };
        }
        if (operation != "wait") throw new ScopeFault(ClawPosixNative.Unconfirmed);
        int fd;
        lock (state) if (!handles.TryGetValue(pid, out fd)) throw new ScopeFault(ClawPosixNative.Unconfirmed);
        var elapsed = Stopwatch.StartNew();
        while (elapsed.ElapsedMilliseconds < ClawPosixNative.DeadlineMs) {
            if (ClawPosixNative.HasExited(fd, (int)(ClawPosixNative.DeadlineMs - elapsed.ElapsedMilliseconds)))
                return new { id, ok = true, exited = true };
        }
        throw new ScopeFault(ClawPosixNative.Unconfirmed);
    }
    public static void Run() {
        Send(new { v = 1, ready = true });
        try {
            string line;
            var input = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
            while ((line = ClawPosixNative.ReadLine(input, ClawPosixNative.MaxControlChars)) != null) {
                using var document = JsonDocument.Parse(line);
                var request = document.RootElement.Clone();
                try { Send(Execute(request)); }
                catch (Exception exception) { Send(new {
                    id = request.GetProperty("id").GetInt32(), ok = false, code = ClawPosixNative.Error(exception)
                }); }
            }
        } finally {
            lock (state) { foreach (int fd in handles.Values) ClawPosixNative.close(fd); handles.Clear(); }
        }
    }
}
`;

function unavailable(facility) {
  return new ClawError(NATIVE_SCOPE_ERRORS.UNAVAILABLE, { platform: process.platform, facility });
}

function requireLinux() {
  if (process.platform !== "linux") throw unavailable(process.platform === "darwin"
    ? "macos-authoritative-descendant-scope" : "linux-subreaper-pidfd");
  if (!["x64", "arm64"].includes(process.arch)) throw unavailable("linux-64bit-pidfd-abi");
}

function nativeSource(body) {
  return `${NATIVE_SOURCE}${body}`.replaceAll("__UNAVAILABLE__", NATIVE_SCOPE_ERRORS.UNAVAILABLE)
    .replaceAll("__UNCONFIRMED__", NATIVE_SCOPE_ERRORS.UNCONFIRMED)
    .replaceAll("__LIMIT__", NATIVE_SCOPE_ERRORS.LIMIT)
    .replaceAll("__MAX_PROCESSES__", String(MAX_BROKER_SCOPES));
}

function powershellArguments(source, invocation) {
  const script = `$ErrorActionPreference = "Stop"\nAdd-Type -TypeDefinition @'\n${source}\n'@\n${invocation}`;
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
}

async function powershellPath() {
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter).filter(path.isAbsolute)) {
    const command = path.resolve(directory, "pwsh");
    try { await access(command, constants.X_OK); return command; } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw unavailable("powershell7");
    }
  }
  throw unavailable("powershell7");
}

function validateLaunchPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")
    || Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES) throw unavailable("fixed-supervisor-path");
}

function validateBootstrapEnvironment(env) {
  if (Object.keys(env).some((name) => UNSEALED_RUNTIME_HOOK.test(name) && env[name] !== undefined && env[name] !== ""))
    throw unavailable("unsealed-native-launcher-environment");
}

/**
 * Prepare a fixed native subreaper root, retaining reaping authority around the existing Node supervisor.
 * @param {{node:string, supervisorPath:string, cwd?:string, env?:NodeJS.ProcessEnv}} options
 * @returns {Promise<{command:string, args:string[]}>}
 */
export async function nativePosixSupervisorLaunch({ node, supervisorPath, cwd, env = process.env } = {}) {
  requireLinux();
  validateBootstrapEnvironment(env);
  validateLaunchPath(node);
  validateLaunchPath(supervisorPath);
  if (cwd !== undefined) validateLaunchPath(cwd);
  if (node !== process.execPath || path.resolve(supervisorPath) !== TRUSTED_SUPERVISOR_PATH)
    throw unavailable("fixed-supervisor-path");
  const command = await powershellPath();
  const config = Buffer.from(JSON.stringify({ node, supervisorPath, argument: NATIVE_SUPERVISOR_ARGUMENT })).toString("base64");
  return {
    command,
    args: powershellArguments(nativeSource(ROOT_SOURCE), `[ClawPosixRoot]::Run('${config}')`),
  };
}

function readFrames(stream, receive, fail) {
  const decoder = new StringDecoder("utf8");
  let buffered = "";
  stream.on("data", (chunk) => {
    buffered += decoder.write(chunk);
    if (Buffer.byteLength(buffered, "utf8") > MAX_CONTROL_BYTES) { fail(); return; }
    let end;
    while ((end = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try { receive(JSON.parse(line)); } catch { fail(); return; }
    }
  });
  stream.once("error", fail);
}

function brokerEnvironment() {
  const env = { POWERSHELL_TELEMETRY_OPTOUT: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1" };
  for (const field of BROKER_ENVIRONMENT_FIELDS) {
    if (Object.hasOwn(process.env, field)) env[field] = process.env[field];
  }
  return env;
}

function makeBroker(command) {
  const ready = Promise.withResolvers();
  const closed = Promise.withResolvers();
  const pending = new Map();
  const child = spawn(command, powershellArguments(nativeSource(BROKER_SOURCE), "[ClawPosixObserver]::Run()"), {
    env: brokerEnvironment(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
  });
  const broker = { child, pending, ready: ready.promise, closed: closed.promise, users: 0, sequence: 0 };
  const fail = () => {
    ready.reject(unavailable("linux-pidfd-observer"));
    for (const request of pending.values()) request.reject(new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED));
    pending.clear();
  };
  const timer = setTimeout(() => { fail(); child.kill("SIGKILL"); }, BROKER_START_TIMEOUT_MS);
  readFrames(child.stdout, (frame) => {
    if (frame.v === 1 && frame.ready === true) { clearTimeout(timer); ready.resolve(); return; }
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    if (frame.ok === true) request.resolve(frame);
    else request.reject(new ClawError(Object.values(NATIVE_SCOPE_ERRORS).includes(frame.code)
      ? frame.code : NATIVE_SCOPE_ERRORS.UNCONFIRMED));
  }, fail);
  child.stdin.on("error", fail);
  child.once("error", fail);
  child.once("close", () => { clearTimeout(timer); fail(); closed.resolve(); });
  return broker;
}

function brokerRequest(broker, operation, identity) {
  const request = Promise.withResolvers();
  broker.sequence += 1;
  const id = broker.sequence;
  const timer = setTimeout(() => {
    broker.pending.delete(id);
    request.reject(new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED));
  }, CONTROL_TIMEOUT_MS);
  broker.pending.set(id, request);
  broker.child.stdin.write(`${JSON.stringify({ id, operation, ...identity })}\n`);
  return request.promise.finally(() => clearTimeout(timer));
}

async function acquireBroker(command) {
  let broker = BROKERS.get(command);
  if (!broker) { broker = makeBroker(command); BROKERS.set(command, broker); }
  if (broker.users >= MAX_BROKER_SCOPES) throw new ClawError(NATIVE_SCOPE_ERRORS.LIMIT);
  broker.users += 1;
  try { await broker.ready; return broker; } catch (error) { await releaseBroker(command, broker); throw error; }
}

async function releaseBroker(command, broker) {
  broker.users -= 1;
  if (broker.users > 0) return;
  if (BROKERS.get(command) === broker) BROKERS.delete(command);
  broker.child.stdin.end();
  const timer = setTimeout(() => broker.child.kill("SIGKILL"), CONTROL_TIMEOUT_MS);
  try { await broker.closed; } finally { clearTimeout(timer); }
}

async function rootBirth(rootPid) {
  try {
    const text = await readFile(path.join(path.sep, "proc", String(rootPid), "stat"), "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
    if (["Z", "X"].includes(fields[0]) || Number(fields[1]) !== process.pid) throw unavailable("held-subreaper-root");
    const birth = fields[PROC_START_INDEX];
    if (!/^\d+$/.test(birth ?? "")) throw unavailable("linux-process-birth");
    return birth;
  } catch { throw unavailable("held-subreaper-root"); }
}

function scopeTransport(identity) {
  const socket = net.createConnection(`${SCOPE_ADDRESS_PREFIX}${identity.rootPid}-${identity.rootStartedAt}`);
  const waiting = [];
  const frames = [];
  let failure;
  const fail = () => {
    failure = new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED);
    for (const request of waiting.splice(0)) request.reject(failure);
  };
  readFrames(socket, (frame) => {
    const request = waiting.shift();
    if (request) request.resolve(frame);
    else frames.push(frame);
  }, fail);
  socket.once("close", fail);
  return {
    socket,
    receive() {
      if (frames.length) return Promise.resolve(frames.shift());
      if (failure) return Promise.reject(failure);
      const request = Promise.withResolvers();
      waiting.push(request);
      const timer = setTimeout(() => { fail(); socket.destroy(); }, CONTROL_TIMEOUT_MS);
      return request.promise.finally(() => clearTimeout(timer));
    },
  };
}

function matchesIdentity(frame, identity) {
  return frame?.v === 1 && frame.rootPid === identity.rootPid
    && frame.rootStartedAt === identity.rootStartedAt && frame.rootReady === true;
}

function failedSettlement(identity, code = NATIVE_SCOPE_ERRORS.UNCONFIRMED) {
  return { ...identity, rootReady: true, stoppedPids: [], settlementConfirmed: false, unknownProcesses: null, code };
}

function hasZeroDescendantReceipt(receipt, identity) {
  return matchesIdentity(receipt, identity) && receipt.zeroChildren === true && receipt.unknownProcesses === 0
    && receipt.code == null && Array.isArray(receipt.stoppedPids) && receipt.stoppedPids.length <= MAX_BROKER_SCOPES
    && receipt.stoppedPids.every((pid) => Number.isSafeInteger(pid) && pid > 0);
}

async function terminateScope({ identity, transport, broker }) {
  try {
    transport.socket.write('{"v":1,"operation":"terminate"}\n');
    const receipt = await transport.receive();
    if (!hasZeroDescendantReceipt(receipt, identity)) {
      return failedSettlement(identity, receipt?.code === NATIVE_SCOPE_ERRORS.LIMIT
        ? NATIVE_SCOPE_ERRORS.LIMIT : NATIVE_SCOPE_ERRORS.UNCONFIRMED);
    }
    const exit = await brokerRequest(broker, "wait", identity);
    if (exit.exited !== true) return failedSettlement(identity);
    return {
      ...identity, rootReady: true, stoppedPids: [...new Set([...receipt.stoppedPids, identity.rootPid])],
      settlementConfirmed: true, unknownProcesses: 0,
    };
  } catch { return failedSettlement(identity); }
}

function ownedScope({ identity, transport, broker, command }) {
  let settlement;
  let closing;
  const terminate = () => {
    settlement ??= terminateScope({ identity, transport, broker });
    return settlement;
  };
  const close = () => {
    closing ??= (async () => {
      await terminate();
      transport.socket.destroy();
      try { await brokerRequest(broker, "dispose", identity); } catch {
        broker.child.stdin.end();
      }
      await releaseBroker(command, broker);
    })();
    return closing;
  };
  return { ...identity, terminate, close };
}

/**
 * Attach only to a native held root; proof requires its waitpid/ECHILD receipt and pidfd-observed root exit.
 * @param {{rootPid:number, env?:NodeJS.ProcessEnv}} options
 * @returns {Promise<PosixProcessScope>}
 */
export async function openPosixProcessScope({ rootPid } = {}) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) throw unavailable("positive-root-pid");
  requireLinux();
  const identity = { rootPid, rootStartedAt: await rootBirth(rootPid) };
  const transport = scopeTransport(identity);
  let broker;
  let command;
  try {
    transport.socket.write(`${JSON.stringify({ v: 1, operation: "attach", ...identity })}\n`);
    const hello = await transport.receive();
    if (!matchesIdentity(hello, identity) || hello.subreaper !== true || hello.pidfd !== true)
      throw unavailable("held-subreaper-root");
    command = await powershellPath();
    broker = await acquireBroker(command);
    await brokerRequest(broker, "open", identity);
    return ownedScope({ identity, transport, broker, command });
  } catch (error) {
    transport.socket.destroy();
    if (broker) await releaseBroker(command, broker);
    throw error instanceof ClawError && [NATIVE_SCOPE_ERRORS.UNAVAILABLE, NATIVE_SCOPE_ERRORS.LIMIT].includes(error.code)
      ? error : unavailable("held-subreaper-root");
  }
}
