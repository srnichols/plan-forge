import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { ClawError } from "../errors.mjs";

const MAX_TREE_PROCESSES = 256;
const MAX_SNAPSHOT_BYTES = 262_144;
const TREE_TIMEOUT_MS = 15_000;
const TRACK_INTERVAL_MS = 250;
const SETTLE_INTERVAL_MS = 25;
const PROC_START_INDEX = 19;
const MAX_START_LENGTH = 128;
const PROCESS_ROW = /^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)/;
const GROUP_PROCESS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)/;
const PROCESS_PORTS = Object.freeze({ run: runInspector, readFile, kill: (pid, signal) => process.kill(pid, signal) });
const GLOBAL_PROCESS_LIMIT = 4096;
const PROC_READ_BATCH = 16;
const UNKNOWN_PROCESS_DETAIL_LIMIT = 10;
const WINDOWS_SYSTEM_PID_MAX = 4;
const BOOTSTRAP_ARGUMENT = "--pforge-owned-process";
const BOOTSTRAP_MESSAGES = Object.freeze({ READY: "owned-ready", START: "owned-start", RESULT: "owned-result" });
const NODE_ENVIRONMENT_FIELDS = Object.freeze(["NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE", "NODE_DEBUG", "NODE_DEBUG_NATIVE"]);
const BOOTSTRAP_ENVIRONMENT_PREFIX = "PFORGE_CLAW_NATIVE_BOOTSTRAP_";
const SAFE_PROCESS_ERROR = /^[A-Z0-9_]{1,64}$/;

function isPositivePid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

export const PLAN_TREE_ERRORS = Object.freeze({
  UNAVAILABLE: "PLAN_PROCESS_TREE_UNAVAILABLE",
  TIMEOUT: "PLAN_PROCESS_TREE_TIMEOUT",
  LIMIT: "PLAN_PROCESS_TREE_LIMIT",
  UNCONFIRMED: "PLAN_PROCESS_SCOPE_UNCONFIRMED",
});

function runInspector(command, args, { env, timeoutMs }) {
  return new Promise((resolve) => {
    const output = { stdout: [], stderr: [], bytes: 0, failed: false };
    const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let isFinished = false;
    const finish = (code) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);
      resolve({
        code: output.failed ? -1 : code ?? -1,
        stdout: Buffer.concat(output.stdout).toString("utf8"),
        stderr: Buffer.concat(output.stderr).toString("utf8"),
        pid: child.pid,
      });
    };
    const append = (stream, chunk) => {
      if (output.failed) return;
      output.bytes += chunk.length;
      if (output.bytes >= MAX_SNAPSHOT_BYTES) {
        output.failed = true;
        child.kill();
        return;
      }
      output[stream].push(chunk);
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", () => { output.failed = true; finish(-1); });
    child.once("close", finish);
    const timer = setTimeout(() => { output.failed = true; child.kill(); }, timeoutMs);
    timer.unref?.();
  });
}

// These scripts are fixed code. Only validated, owned PID/birth identities cross the boundary.
const WINDOWS_SNAPSHOT = `
$ErrorActionPreference = "Stop"
$seeds = @(ConvertFrom-Json $env:PFORGE_CLAW_TREE_RECORDS)
$limit = [int]$env:PFORGE_CLAW_TREE_LIMIT
$queue = [System.Collections.Generic.Queue[object]]::new()
foreach ($seed in $seeds) { $queue.Enqueue($seed) }
$seen = @{}
$records = [System.Collections.Generic.List[object]]::new()
while ($queue.Count -gt 0) {
  $seed = $queue.Dequeue()
  if ($seen.ContainsKey([int]$seed.pid)) { continue }
  $seen[[int]$seed.pid] = $true
  $process = Get-Process -Id $seed.pid -ErrorAction SilentlyContinue
  if ($null -eq $process) { continue }
  try {
    $null = $process.Handle
    $start = $process.StartTime.ToUniversalTime().Ticks
  } catch {
    if ($process.HasExited) { continue }
    throw
  }
  if ($null -ne $seed.start -and [string]$start -cne [string]$seed.start) { continue }
  $records.Add(@{ pid = [int]$seed.pid; parentPid = [int]$seed.parentPid; start = [string]$start })
  if ($records.Count -gt $limit) { throw "PLAN_PROCESS_TREE_LIMIT" }
  $children = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + [int]$seed.pid))
  $end = if ($process.HasExited) { $process.ExitTime.ToUniversalTime().Ticks } else { [DateTime]::UtcNow.Ticks }
  foreach ($child in $children) {
    $owned = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $owned) { continue }
    try { $null = $owned.Handle; $born = $owned.StartTime.ToUniversalTime().Ticks } catch {
      if ($owned.HasExited) { continue }
      throw
    }
    $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$child.ProcessId)
    if ($null -ne $current -and $current.ParentProcessId -eq $seed.pid -and $born -ge $start -and $born -le $end) {
      $queue.Enqueue(@{ pid = [int]$child.ProcessId; parentPid = [int]$seed.pid; start = [string]$born })
    }
  }
}
ConvertTo-Json -InputObject @($records.ToArray()) -Compress
exit 0
`;

const WINDOWS_TERMINATE = `
$ErrorActionPreference = "Stop"
$queue = [System.Collections.Generic.Queue[object]]::new()
foreach ($record in @(ConvertFrom-Json $env:PFORGE_CLAW_TREE_RECORDS)) { $queue.Enqueue($record) }
$limit = [int]$env:PFORGE_CLAW_TREE_LIMIT
$deadline = [DateTime]::UtcNow.AddMilliseconds([int]$env:PFORGE_CLAW_TREE_TIMEOUT)
$seen = @{}
$stopped = [System.Collections.Generic.List[int]]::new()
while ($queue.Count -gt 0) {
  if ([DateTime]::UtcNow -ge $deadline) { throw "PLAN_PROCESS_TREE_TIMEOUT" }
  $record = $queue.Dequeue()
  $identity = ([string]$record.pid) + ":" + [string]$record.start
  if ($seen.ContainsKey($identity)) { continue }
  $seen[$identity] = $true
  if ($seen.Count -gt $limit) { throw "PLAN_PROCESS_TREE_LIMIT" }
  $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
  if ($null -eq $process) { continue }
  try {
    $null = $process.Handle
    $start = $process.StartTime.ToUniversalTime().Ticks
  } catch {
    if ($process.HasExited) { continue }
    throw
  }
  if ([string]$start -cne [string]$record.start) { continue }
  if (-not $process.HasExited) {
    try { Stop-Process -Id $record.pid -Force -ErrorAction Stop } catch {
      if (-not $process.HasExited) { throw }
    }
  }
  $remaining = [Math]::Max(1, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
  if (-not $process.WaitForExit($remaining)) { throw "PLAN_PROCESS_TREE_TIMEOUT" }
  $end = $process.ExitTime.ToUniversalTime().Ticks
  $stopped.Add([int]$record.pid)
  # Windows preserves parent PIDs after exit. The birth interval excludes PID-reuse children.
  foreach ($child in @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + [int]$record.pid))) {
    $owned = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $owned) { continue }
    try { $null = $owned.Handle; $born = $owned.StartTime.ToUniversalTime().Ticks } catch {
      if ($owned.HasExited) { continue }
      throw
    }
    $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$child.ProcessId)
    if ($null -ne $current -and $current.ParentProcessId -eq $record.pid -and $born -ge $start -and $born -le $end) {
      $queue.Enqueue(@{ pid = [int]$child.ProcessId; parentPid = [int]$record.pid; start = [string]$born })
    }
  }
}
ConvertTo-Json -InputObject @($stopped.ToArray()) -Compress
exit 0
`;

const WINDOWS_PROCESS_INVENTORY = `
$ErrorActionPreference = "Stop"
$heldCreators = @{}
function Test-ProcessStillPresent($native, [int]$ownedProcessId) {
  try {
    return -not $native.HasExited
  } catch {
    try {
      $current = [System.Diagnostics.Process]::GetProcessById($ownedProcessId)
    } catch [System.ArgumentException] {
      return $false
    }
    $current.Dispose()
    return $true
  }
}
function Read-ProcessInventory([bool]$holdCreators) {
$records = [System.Collections.Generic.List[object]]::new()
$metadataById = @{}
foreach ($metadata in @(Get-CimInstance Win32_Process)) { $metadataById[[int]$metadata.ProcessId] = $metadata }
foreach ($native in [System.Diagnostics.Process]::GetProcesses()) {
  if ($records.Count -ge [int]$env:PFORGE_CLAW_GLOBAL_PROCESS_LIMIT) { throw "PLAN_PROCESS_TREE_LIMIT" }
  $ownedProcessId = $native.Id
  $metadata = $metadataById[[int]$ownedProcessId]
  $start = if ($null -ne $metadata.CreationDate) {
    "cim:" + [string]$metadata.CreationDate.ToUniversalTime().Ticks
  } else { $null }
  $nativeStart = $null
  try {
    if ($native.HasExited) { continue }
    $nativeStart = $native.StartTime.ToUniversalTime().Ticks
    $start = [string]$nativeStart
    if ($null -eq $metadata.CreationDate -or
      [Math]::Abs($metadata.CreationDate.ToUniversalTime().Ticks - $nativeStart) -gt 9) {
      $metadata = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$ownedProcessId)
    }
    if ($native.HasExited) { continue }
    if ($null -eq $metadata.CreationDate -or
      [Math]::Abs($metadata.CreationDate.ToUniversalTime().Ticks - $nativeStart) -gt 9) { $metadata = $null }
  } catch {
    if (-not (Test-ProcessStillPresent $native $ownedProcessId)) { continue }
    if ($null -ne $nativeStart) {
      $start = [string]$nativeStart
      $metadata = $null
    } elseif ($null -eq $metadata.CreationDate) { $start = $null }
  }
  if ($holdCreators -and $null -ne $nativeStart) {
    try {
      $null = $native.Handle
      $heldCreators[[int]$ownedProcessId] = @{ process = $native; start = [string]$nativeStart }
    } catch { $native.Dispose() }
  }
  $records.Add(@{ pid = [int]$ownedProcessId; parentPid = [int]$metadata.ParentProcessId; start = $start; state = "R" })
}
return @($records.ToArray())
}
try {
  $records = @(Read-ProcessInventory $true)
  ConvertTo-Json -InputObject @{ phase = "baseline"; records = $records; inspectorPid = $PID } -Compress
  if ([Console]::ReadLine() -cne "final") { throw "PLAN_PROCESS_TREE_UNAVAILABLE" }
  $records = @(Read-ProcessInventory $false)
  $exited = [System.Collections.Generic.List[object]]::new()
  foreach ($entry in $heldCreators.GetEnumerator()) {
    $held = $entry.Value
    try {
      if ($held.process.HasExited) {
        $exited.Add(@{ pid = [int]$entry.Key; start = $held.start;
          end = [string]$held.process.ExitTime.ToUniversalTime().Ticks })
      }
    } catch { continue }
  }
  ConvertTo-Json -InputObject @{ phase = "final"; records = $records;
    inspectorPid = $PID; exitedCreators = @($exited.ToArray()) } -Compress
} finally {
  foreach ($held in $heldCreators.Values) { $held.process.Dispose() }
}
exit 0
`;

function createWindowsInventory(env) {
  const baseline = Promise.withResolvers();
  const final = Promise.withResolvers();
  const closed = Promise.withResolvers();
  const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_PROCESS_INVENTORY], {
    env: { ...env, PFORGE_CLAW_GLOBAL_PROCESS_LIMIT: String(GLOBAL_PROCESS_LIMIT) },
    shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
  });
  let text = "";
  let bytes = 0;
  const fail = () => { baseline.resolve(null); final.resolve(null); child.kill(); };
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_SNAPSHOT_BYTES) { fail(); return; }
    text += chunk.toString("utf8");
    let newline;
    while ((newline = text.indexOf("\n")) !== -1) {
      let frame;
      try { frame = JSON.parse(text.slice(0, newline)); } catch { fail(); return; }
      text = text.slice(newline + 1);
      if (frame.phase === "baseline") baseline.resolve(frame);
      if (frame.phase === "final") final.resolve(frame);
    }
  });
  child.on("error", () => { baseline.resolve(null); final.resolve(null); });
  child.stdin.on("error", () => { baseline.resolve(null); final.resolve(null); });
  child.once("close", () => { baseline.resolve(null); final.resolve(null); closed.resolve(); });
  async function receive(waiting) {
    const deadline = new AbortController();
    try {
      const frame = await Promise.race([waiting, delay(TREE_TIMEOUT_MS, null, { signal: deadline.signal })]);
      if (!frame || !Array.isArray(frame.records) || frame.records.length > GLOBAL_PROCESS_LIMIT) {
        fail();
        throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
      }
      return frame;
    } finally {
      deadline.abort();
    }
  }
  return {
    baseline: () => receive(baseline.promise),
    final() { child.stdin.end("final\n"); return receive(final.promise); },
    async close() { child.stdin.end(); child.kill(); await closed.promise; },
  };
}

function isProcessRecord(record) {
  return isPositivePid(record?.pid)
    && Number.isSafeInteger(record.parentPid) && record.parentPid >= 0
    && typeof record.start === "string" && record.start.length > 0 && record.start.length <= MAX_START_LENGTH;
}

async function windowsOperation({ script, records, env, processes }) {
  const completed = await processes.run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...env, PFORGE_CLAW_TREE_RECORDS: JSON.stringify(records),
      PFORGE_CLAW_TREE_LIMIT: String(MAX_TREE_PROCESSES), PFORGE_CLAW_TREE_TIMEOUT: String(TREE_TIMEOUT_MS),
    },
    timeoutMs: TREE_TIMEOUT_MS, maxOutput: MAX_SNAPSHOT_BYTES,
  });
  const output = requireInspectorOutput(completed);
  try { return JSON.parse(output); } catch { throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE); }
}

function requireInspectorOutput(completed) {
  if (completed?.code !== 0 || typeof completed.stdout !== "string" || typeof completed.stderr !== "string"
    || Buffer.byteLength(completed.stdout) + Buffer.byteLength(completed.stderr) >= MAX_SNAPSHOT_BYTES) {
    throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
  }
  return completed.stdout;
}

async function posixSnapshot(env, processes) {
  const completed = await processes.run("ps", ["-axo", "pid=,ppid=,lstart=,stat="], {
    env: { ...env, LC_ALL: "C" }, timeoutMs: TREE_TIMEOUT_MS, maxOutput: MAX_SNAPSHOT_BYTES,
  });
  return requireInspectorOutput(completed).split(/\r?\n/).map((line) => PROCESS_ROW.exec(line)).filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]), start: match[3], state: match[4] }));
}

async function processIdentity(record, platform, processes) {
  if (platform !== "linux") return record;
  try {
    const proc = path.join(path.parse(process.cwd()).root, "proc", String(record.pid), "stat");
    const text = await processes.readFile(proc, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 1).trim().split(/\s+/);
    return {
      ...record, parentPid: Number(fields[1]), groupPid: Number(fields[2]),
      start: fields[PROC_START_INDEX], state: fields[0],
    };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
  }
}

function processStillOwned(record, expected) {
  return record && record.start === expected.start && !record.state?.startsWith("Z");
}

function ownsSnapshotRecord(record, expected, platform) {
  if (!record || record.state?.startsWith("Z")) return false;
  if (expected.start && !processStillOwned(record, expected)) return false;
  if (!expected.start) return expected.parentPid === undefined || record.parentPid === expected.parentPid;
  if (platform === "darwin" && record.parentPid !== expected.parentPid) {
    throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
  }
  return true;
}

async function collectPosixTree({ records, rootPid, rootExited, env, platform, processes, groupPid }) {
  const current = await posixSnapshot(env, processes);
  const collected = [];
  const queue = records.length ? [...records] : rootExited ? [] : [{ pid: rootPid }];
  if (groupPid) {
    const global = await globalProcessSnapshot({ env, platform, processes });
    queue.push(...global.records.filter((record) => record.groupPid === groupPid));
  }
  const seen = new Set();
  while (queue.length) {
    const expected = queue.shift();
    if (seen.has(expected.pid)) continue;
    seen.add(expected.pid);
    const row = current.find((record) => record.pid === expected.pid);
    const record = row ? await processIdentity(row, platform, processes) : null;
    if (!ownsSnapshotRecord(record, expected, platform)) continue;
    collected.push(record);
    if (collected.length > MAX_TREE_PROCESSES) throw new ClawError(PLAN_TREE_ERRORS.LIMIT);
    queue.push(...current.filter((child) => child.parentPid === record.pid)
      .map((child) => ({ pid: child.pid, parentPid: record.pid })));
  }
  return collected;
}

async function signalOwnedProcess({ record, signal, env, platform, processes }) {
  const row = (await posixSnapshot(env, processes)).find((entry) => entry.pid === record.pid);
  const current = row ? await processIdentity(row, platform, processes) : null;
  if (!ownsSnapshotRecord(current, record, platform)) return false;
  try {
    processes.kill(record.pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
  }
}

async function awaitProcessFrozen({ record, env, platform, processes, deadline }) {
  while (true) {
    const row = (await posixSnapshot(env, processes)).find((entry) => entry.pid === record.pid);
    const current = row ? await processIdentity(row, platform, processes) : null;
    if (!ownsSnapshotRecord(current, record, platform)) return false;
    if (current.state.toUpperCase().startsWith("T")) return true;
    if (Date.now() >= deadline) throw new ClawError(PLAN_TREE_ERRORS.TIMEOUT);
    await delay(SETTLE_INTERVAL_MS);
  }
}

async function freezePendingProcesses({ pending, frozen, env, platform, processes, deadline }) {
  for (const record of pending) {
    if (!(await signalOwnedProcess({ record, signal: "SIGSTOP", env, platform, processes }))) continue;
    if (await awaitProcessFrozen({ record, env, platform, processes, deadline })) frozen.set(record.pid, record);
  }
}

async function terminatePosixTree({ capture, env, platform, processes }) {
  const frozen = new Map();
  const killed = new Set();
  const deadline = Date.now() + TREE_TIMEOUT_MS;
  try {
    // Freeze each discovered parent before taking another snapshot, preventing reparenting/spawn races.
    while (true) {
      if (Date.now() >= deadline) throw new ClawError(PLAN_TREE_ERRORS.TIMEOUT);
      const live = await capture();
      const pending = live.filter((record) => !frozen.has(record.pid));
      if (!pending.length) break;
      await freezePendingProcesses({ pending, frozen, env, platform, processes, deadline });
    }
    for (const record of [...frozen.values()].reverse()) {
      if (await signalOwnedProcess({ record, signal: "SIGKILL", env, platform, processes })) killed.add(record.pid);
    }
    while (true) {
      const live = await collectPosixTree({
        records: [...frozen.values()], rootExited: true, env, platform, processes,
      });
      if (!live.length) return [...frozen.keys()];
      if (Date.now() >= deadline) throw new ClawError(PLAN_TREE_ERRORS.TIMEOUT);
      await delay(SETTLE_INTERVAL_MS);
    }
  } finally {
    const live = await collectPosixTree({ records: [...frozen.values()], rootExited: true, env, platform, processes });
    for (const record of live) {
      if (!killed.has(record.pid)) await signalOwnedProcess({ record, signal: "SIGCONT", env, platform, processes });
    }
  }
}

/**
 * Track only descendants of the spawned foreground child and bind every PID to its birth identity.
 * @param {{child: import("node:child_process").ChildProcess, env?: object, platform?: string,
 * processes?: {run: Function, readFile: Function, kill: Function}}} options
 * @returns {{terminate: () => Promise<number[]>, close: () => Promise<void>,
 * settlement: () => {settlementConfirmed: boolean, ownedPids: number[], code?: string}}}
 */
function createProcessTree({
  child, env = process.env, platform = process.platform, processes = PROCESS_PORTS, track = true, groupPid,
}, initialRoot) {
  const owned = new Map();
  const tracking = new AbortController();
  let rootExited = false;
  let termination;
  let lastError;
  let rootObserved = false;
  let settlementConfirmed = false;
  let terminatedPids = [];
  if (initialRoot) { owned.set(initialRoot.pid, initialRoot); rootObserved = true; }
  child.once("exit", () => { rootExited = true; });
  const records = () => [...owned.values()];
  async function capture() {
    const seeds = records().filter((record) => platform === "win32" || !rootExited || record.pid !== child.pid);
    const found = platform === "win32"
      ? await windowsOperation({
        script: WINDOWS_SNAPSHOT,
        records: seeds.length ? seeds : rootExited ? [] : [{ pid: child.pid, parentPid: 0, start: null }], env, processes,
      })
      : await collectPosixTree({ records: seeds, rootPid: child.pid, rootExited, env, platform, processes, groupPid });
    if (!Array.isArray(found) || found.some((record) => !isProcessRecord(record))) {
      throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
    }
    if (!rootObserved && rootExited) return [];
    if (new Set([...owned.keys(), ...found.map((record) => record.pid)]).size > MAX_TREE_PROCESSES) {
      throw new ClawError(PLAN_TREE_ERRORS.LIMIT);
    }
    for (const record of found) {
      owned.set(record.pid, record);
      if (record.pid === child.pid) rootObserved = true;
    }
    return found;
  }
  const monitor = track && isPositivePid(child.pid) ? (async () => {
    while (!tracking.signal.aborted && !rootExited) {
      try { await capture(); } catch (error) { lastError = error; }
      try { await delay(TRACK_INTERVAL_MS, undefined, { signal: tracking.signal }); } catch (error) {
        if (error.name !== "AbortError") throw error;
      }
    }
  })() : Promise.resolve();
  async function close() {
    tracking.abort();
    await monitor;
  }
  async function stop() {
    const wasRootLive = !rootExited;
    await close();
    if (!isPositivePid(child.pid)) { child.kill(); settlementConfirmed = true; return []; }
    await capture();
    if (!owned.size && !rootExited) throw lastError ?? new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
    const stopped = await (platform === "win32"
      ? windowsOperation({ script: WINDOWS_TERMINATE, records: records(), env, processes })
      : terminatePosixTree({ capture, env, platform, processes }));
    if (!Array.isArray(stopped) || stopped.some((pid) => !isPositivePid(pid))) {
      throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
    }
    terminatedPids = stopped;
    settlementConfirmed = rootObserved && wasRootLive;
    return stopped;
  }
  return {
    terminate: () => termination ??= stop(), close,
    identities: () => records(),
    settlement: () => ({
      settlementConfirmed, ownedPids: [...terminatedPids],
      ...(settlementConfirmed ? {} : { code: PLAN_TREE_ERRORS.UNAVAILABLE }),
    }),
  };
}

export function createPlanProcessTree(options) {
  return createProcessTree(options);
}

async function globalProcessSnapshot({ env, platform = process.platform, processes = PROCESS_PORTS }) {
  const completed = await processes.run("ps", ["-axo", "pid=,ppid=,pgid=,lstart=,stat="], {
    env: { ...env, LC_ALL: "C", PFORGE_CLAW_GLOBAL_PROCESS_LIMIT: String(GLOBAL_PROCESS_LIMIT) },
    timeoutMs: TREE_TIMEOUT_MS, maxOutput: MAX_SNAPSHOT_BYTES,
  });
  const output = requireInspectorOutput(completed);
  const rows = output.split(/\r?\n/).map((line) => GROUP_PROCESS_ROW.exec(line)).filter(Boolean).map((match) => ({
      pid: Number(match[1]), parentPid: Number(match[2]), groupPid: Number(match[3]), start: match[4], state: match[5],
    }));
  if (!Array.isArray(rows) || rows.length > GLOBAL_PROCESS_LIMIT) throw new ClawError(PLAN_TREE_ERRORS.LIMIT);
  const records = [];
  for (let index = 0; index < rows.length; index += PROC_READ_BATCH) {
    const identified = await Promise.all(rows.slice(index, index + PROC_READ_BATCH)
      .map((record) => processIdentity(record, platform, processes)));
    records.push(...identified.filter((record) => record && !record.state?.startsWith("Z")));
  }
  return { records, inspectorPid: completed.pid };
}

function supervisorEnvironment(env = process.env) {
  const prepared = { ...env };
  if (Object.keys(prepared).some((key) => key.startsWith(BOOTSTRAP_ENVIRONMENT_PREFIX))) {
    throw new ClawError("COMMAND_ENV_INVALID");
  }
  for (const field of NODE_ENVIRONMENT_FIELDS) {
    const keys = Object.keys(prepared).filter((key) => process.platform === "win32"
      ? key.toUpperCase() === field : key === field);
    if (keys.length > 1) throw new ClawError("COMMAND_ENV_INVALID");
    if (!keys.length) continue;
    prepared[`${BOOTSTRAP_ENVIRONMENT_PREFIX}${field}`] = prepared[keys[0]];
    prepared[`${BOOTSTRAP_ENVIRONMENT_PREFIX}${field}_NAME`] = keys[0];
    delete prepared[keys[0]];
  }
  return prepared;
}

function executionEnvironment() {
  const prepared = { ...process.env };
  for (const field of NODE_ENVIRONMENT_FIELDS) {
    const value = `${BOOTSTRAP_ENVIRONMENT_PREFIX}${field}`;
    const name = `${value}_NAME`;
    if (Object.hasOwn(prepared, name)) prepared[prepared[name]] = prepared[value];
    delete prepared[value];
    delete prepared[name];
  }
  return prepared;
}

function createSupervisor({ cwd, env, appendOutput, maxOutput }) {
  const ready = Promise.withResolvers();
  const execution = Promise.withResolvers();
  const closed = Promise.withResolvers();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), BOOTSTRAP_ARGUMENT, path.resolve(cwd ?? process.cwd())], {
    cwd, env: supervisorEnvironment(env), shell: false, windowsHide: true,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const state = { child, ready: ready.promise, execution: execution.promise, closed: closed.promise,
    tree: null, baseline: null, root: null, inventory: null, stdout: "", stderr: "", isReady: false };
  const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
  const collect = (stream, chunk) => {
    const remaining = maxOutput - Buffer.byteLength(state.stdout) - Buffer.byteLength(state.stderr);
    if (remaining <= 0) return;
    const decoded = decoders[stream].write(chunk);
    const bounded = new StringDecoder("utf8").write(Buffer.from(decoded).subarray(0, Math.max(0, remaining)));
    state[stream] = appendOutput(state[stream], bounded, remaining);
  };
  child.stdout.on("data", (chunk) => collect("stdout", chunk));
  child.stderr.on("data", (chunk) => collect("stderr", chunk));
  child.on("message", (frame) => {
    if (frame?.v !== 1) return;
    if (frame.t === BOOTSTRAP_MESSAGES.READY && frame.pid === child.pid) ready.resolve(frame);
    if (frame.t === BOOTSTRAP_MESSAGES.RESULT && Number.isInteger(frame.code)) execution.resolve(frame);
  });
  child.once("error", () => { ready.resolve(null); execution.resolve(null); });
  child.once("close", () => { ready.resolve(null); execution.resolve(null); closed.resolve(); });
  return state;
}

async function requireSupervisorReady({ state, env, interrupted, onRootReady }) {
  const deadline = new AbortController();
  try {
    const frame = await Promise.race([
      state.ready, interrupted,
      delay(TREE_TIMEOUT_MS, null, { signal: deadline.signal }),
    ]);
    if (!frame) throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
    if (process.platform === "win32") state.inventory = createWindowsInventory(env);
    const baseline = state.inventory ? await state.inventory.baseline() : await globalProcessSnapshot({ env });
    const root = baseline.records.find((record) => record.pid === state.child.pid);
    if (!isProcessRecord(root) || state.child.exitCode !== null || state.child.signalCode !== null) {
      throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
    }
    if (process.platform !== "win32" && root.groupPid !== state.child.pid) throw new ClawError(PLAN_TREE_ERRORS.UNAVAILABLE);
    state.baseline = baseline.records;
    state.root = root;
    state.tree = createProcessTree({
      child: state.child, env, track: false,
      ...(process.platform !== "win32" ? { groupPid: state.child.pid } : {}),
    }, root);
    state.isReady = true;
    await onRootReady?.({ rootPid: root.pid, rootStartedAt: root.start, rootReady: true });
  } finally {
    deadline.abort();
  }
}

function controllerAncestors(records) {
  const ancestors = new Set([process.pid]);
  let parent = process.ppid;
  while (isPositivePid(parent) && !ancestors.has(parent)) {
    ancestors.add(parent);
    parent = records.find((record) => record.pid === parent)?.parentPid;
  }
  return ancestors;
}

function unknownProcesses({ current, baseline, root, platform = process.platform }) {
  const ancestors = controllerAncestors(current.records);
  const prior = new Map(baseline.map((record) => [record.pid, record]));
  const present = new Map(current.records.map((record) => [record.pid, record]));
  const exited = new Map((current.exitedCreators ?? []).map((record) => [record.pid, record]));
  return current.records.filter((record) => {
    if (record.pid === current.inspectorPid || ancestors.has(record.pid)) return false;
    if (record.start === null && record.pid > WINDOWS_SYSTEM_PID_MAX) return true;
    const before = prior.get(record.pid);
    if (before?.start !== record.start) {
      if (platform !== "win32") {
        const preciseBirth = platform === "linux" ? BigInt(record.start) < BigInt(root.start)
          : Date.parse(record.start) < Date.parse(root.start);
        if (preciseBirth) return false;
        return !hasOriginalPosixGroup({ record, prior, present, root });
      }
      return !hasOriginalWindowsCreator({ record, prior, present, exited, root });
    }
    // A coarse POSIX birth clock cannot distinguish same-tick/second PID reuse; fail closed.
    if (platform === "linux") return BigInt(record.start) >= BigInt(root.start);
    if (platform === "darwin") return Date.parse(record.start) >= Date.parse(root.start);
    return false;
  });
}

function hasOriginalWindowsCreator({ record, prior, present, exited, root }) {
  const visited = new Set();
  let parentPid = record.parentPid;
  let descendant = record;
  // Unlike POSIX adoption, Windows retains the creator PID; qualify it by its exact birth identity.
  while (isPositivePid(parentPid) && !visited.has(parentPid)) {
    visited.add(parentPid);
    const parent = present.get(parentPid) ?? exited.get(parentPid);
    if (!parent) return false;
    if (parentPid === root.pid && parent.start === root.start) return false;
    if (!isCreatorLifetime(parent, descendant)) return false;
    const previous = prior.get(parentPid);
    if (previous && (previous.start !== null || parent.pid <= WINDOWS_SYSTEM_PID_MAX) && previous.start === parent.start) return true;
    descendant = parent;
    parentPid = parent.parentPid;
  }
  return false;
}

function isCreatorLifetime(parent, descendant) {
  if (!isEarlierWindowsCreator(parent, descendant)) return false;
  return !parent.end || BigInt(descendant.start) <= BigInt(parent.end);
}

function hasOriginalPosixGroup({ record, prior, present, root }) {
  if (record.groupPid === root.groupPid) return false;
  if (hasStablePosixGroup(record, prior, present)) return true;
  const visited = new Set();
  let child = record;
  while (child.parentPid > 1 && !visited.has(child.pid)) {
    visited.add(child.pid);
    const parent = present.get(child.parentPid);
    if (!isForeignGroupParent(parent, child, root)) return false;
    const previous = prior.get(parent.pid);
    if (previous?.start === parent.start) return true;
    child = parent;
  }
  return false;
}

function isForeignGroupParent(parent, child, root) {
  return parent && parent.pid !== root.pid && parent.groupPid !== root.groupPid
    && parent.groupPid === child.groupPid;
}

function hasStablePosixGroup(record, prior, present) {
  for (const previous of prior.values()) {
    if (previous.groupPid !== record.groupPid) continue;
    const member = present.get(previous.pid);
    if (member?.start === previous.start && member.groupPid === record.groupPid) return true;
  }
  return false;
}

function isEarlierWindowsCreator(parent, child) {
  const parentStart = String(parent.start ?? "").replace(/^cim:/, "");
  const childStart = String(child.start ?? "").replace(/^cim:/, "");
  if (!/^\d+$/.test(parentStart) || !/^\d+$/.test(childStart)) return parent.pid <= WINDOWS_SYSTEM_PID_MAX;
  return BigInt(parentStart) <= BigInt(childStart);
}

async function stopSupervisor({ state, env }) {
  let code;
  let stoppedPids = [];
  let confirmed = false;
  try {
    if (state.tree) {
      stoppedPids = await state.tree.terminate();
      confirmed = state.tree.settlement().settlementConfirmed;
    } else if (isPositivePid(state.child.pid)) {
      state.child.kill("SIGKILL");
      stoppedPids = [state.child.pid];
    }
  } catch (error) {
    code = error.code ?? PLAN_TREE_ERRORS.UNAVAILABLE;
    state.child.kill("SIGKILL");
  }
  await state.closed;
  if (!state.isReady || !confirmed) return {
    rootPid: state.child.pid ?? null, rootReady: state.isReady, stoppedPids,
    settlementConfirmed: false, unknownProcesses: null, code: code ?? PLAN_TREE_ERRORS.UNAVAILABLE,
  };
  try {
    const current = await finalInventory(state, env);
    const unknown = unknownProcesses({ current, baseline: state.baseline, root: state.root });
    return {
      rootPid: state.root.pid, rootStartedAt: state.root.start, rootReady: true, stoppedPids,
      settlementConfirmed: unknown.length === 0, unknownProcesses: unknown.length,
      ...(unknown.length ? {
        code: PLAN_TREE_ERRORS.UNCONFIRMED,
        unknownProcessIdentities: unknown.slice(0, UNKNOWN_PROCESS_DETAIL_LIMIT).map((record) => ({
          pid: record.pid, parentPid: record.parentPid, start: record.start,
          previousStart: state.baseline.find((previous) => previous.pid === record.pid)?.start ?? null,
        })),
      } : {}),
    };
  } catch (error) {
    return { rootPid: state.root.pid, rootReady: true, stoppedPids, settlementConfirmed: false,
      unknownProcesses: null, code: error.code ?? PLAN_TREE_ERRORS.UNAVAILABLE };
  }
}

function finalInventory(state, env) {
  return state.inventory ? state.inventory.final() : globalProcessSnapshot({ env });
}

/**
 * Hold a genuine IPC-owned native root before starting literal argv. Physical proof requires
 * awaited owned-tree stop and no new/ambiguous live process outside the pre-execution inventory.
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, env?: object, signal?: AbortSignal, timeoutMs?: number, maxOutput: number,
 * appendOutput: Function, onRootReady?: Function}} options
 * @returns {Promise<{code: number, stdout: string, stderr: string, error?: Error,
 * settlementConfirmed: boolean, settlement: object}>}
 */
export async function runOwnedProcess(command, args, {
  cwd, env = process.env, signal, timeoutMs, maxOutput, appendOutput, onRootReady,
}) {
  const state = createSupervisor({ cwd, env, appendOutput, maxOutput });
  const interruption = ownedInterruption({ signal, timeoutMs });
  let completed;
  try {
    await requireSupervisorReady({ state, env, interrupted: interruption.promise, onRootReady });
    if (!interruption.failure()) {
      state.child.send({ v: 1, t: BOOTSTRAP_MESSAGES.START, command, args });
      completed = await Promise.race([state.execution, interruption.promise]);
      if (!completed && !interruption.failure()) interruption.interrupt(new ClawError("COMMAND_FAILED"));
    }
  } catch (error) {
    interruption.interrupt(error);
  }
  try {
    const settlement = await stopSupervisor({ state, env });
    return ownedProcessResult({ state, completed, settlement, failure: interruption.failure() });
  } finally {
    interruption.close();
    await state.inventory?.close();
  }
}

function ownedInterruption({ signal, timeoutMs }) {
  const interruption = Promise.withResolvers();
  let failure;
  let timer;
  const interrupt = (error) => { failure ??= error; interruption.resolve(null); };
  const onAbort = () => interrupt(new ClawError("JOB_CANCELLED"));
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => interrupt(new ClawError("COMMAND_TIMEOUT")), timeoutMs);
    timer.unref?.();
  }
  return {
    promise: interruption.promise, interrupt, failure: () => failure,
    close() { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); },
  };
}

function ownedProcessResult({ state, completed, settlement, failure }) {
  const nativeError = completed?.errorCode;
  if (!failure && nativeError) failure = new ClawError(SAFE_PROCESS_ERROR.test(nativeError) ? nativeError : "COMMAND_FAILED");
  return {
    code: failure ? -1 : completed?.code ?? -1, stdout: state.stdout, stderr: state.stderr,
    ...(failure ? { error: failure } : {}), settlementConfirmed: settlement.settlementConfirmed, settlement,
  };
}

function runOwnedBootstrap() {
  let started = false;
  process.on("message", (frame) => {
    if (started || frame?.v !== 1 || frame.t !== BOOTSTRAP_MESSAGES.START) return;
    started = true;
    if (typeof frame.command !== "string" || !Array.isArray(frame.args)
      || frame.args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
      process.send({ v: 1, t: BOOTSTRAP_MESSAGES.RESULT, code: -1, errorCode: "COMMAND_INVALID" });
      return;
    }
    let child;
    try {
      child = spawn(frame.command, frame.args, {
        cwd: process.cwd(), env: executionEnvironment(), shell: false, windowsHide: true, stdio: "inherit",
      });
    } catch {
      process.send({ v: 1, t: BOOTSTRAP_MESSAGES.RESULT, code: -1, errorCode: "COMMAND_INVALID" });
      return;
    }
    let nativeError;
    child.once("error", (error) => { nativeError = error.code; });
    child.once("close", (code) => process.send({
      v: 1, t: BOOTSTRAP_MESSAGES.RESULT, code: code ?? -1, pid: child.pid ?? null,
      ...(nativeError ? { errorCode: nativeError } : {}),
    }));
  });
  process.send({ v: 1, t: BOOTSTRAP_MESSAGES.READY, pid: process.pid });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  && process.argv[2] === BOOTSTRAP_ARGUMENT && typeof process.send === "function") runOwnedBootstrap();
