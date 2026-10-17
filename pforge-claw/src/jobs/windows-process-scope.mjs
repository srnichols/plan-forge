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
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
$ROOT_ACCESS = 0x101101
$SYNCHRONIZE = 0x100000
$WAIT_OBJECT_0 = 0
$WAIT_TIMEOUT = 258
$ERROR_MORE_DATA = 234
$BASIC_ACCOUNTING = 1
$PROCESS_ID_LIST = 3
$EXTENDED_LIMITS = 9
$LIMIT_FLAGS_OFFSET = 16
$DWORD_BYTES = 4
$PROCESS_TIMES_BYTES = 32
$EXIT_TIME_OFFSET = 8
$KERNEL_TIME_OFFSET = 16
$USER_TIME_OFFSET = 24
$EXTENDED_LIMIT_BYTES_64 = 144
$EXTENDED_LIMIT_BYTES_32 = 112
$ACCOUNTING_BYTES = 48
$ACTIVE_PROCESS_OFFSET = 40
$PID_LIST_HEADER_BYTES = 8
$jobs = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
$ownedRoots = [Collections.Generic.HashSet[int]]::new()
$scopeIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$requestIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$safeCodes = @(${Object.values(ERRORS).map((code) => `"${code}"`).join(",")})
$native = $null
$parentWait = $null
$parentRegistration = $null

function Stop-NativeFailure([string]$code) {
  $failure = [InvalidOperationException]::new($code)
  $failure.Data["ClawCode"] = $code
  throw $failure
}
function Get-SafeFailure($failure, [string]$fallback) {
  $code = $failure.Exception.Data["ClawCode"]
  if ($safeCodes -ccontains $code) { return [string]$code }
  return $fallback
}
function Assert-Native([bool]$valid, [string]$code) {
  if (-not $valid) { Stop-NativeFailure $code }
}
function Send-NativeFrame($frame) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $frame -Depth 4 -Compress))
  [Console]::Out.Flush()
}

function New-NativeBindings {
  # Fixed P/Invoke metadata avoids invoking the C# compiler on each cold broker.
  $assembly = [Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly(
    [Reflection.AssemblyName]::new("Claw.Windows.JobApi"), [Reflection.Emit.AssemblyBuilderAccess]::Run)
  $module = $assembly.DefineDynamicModule("Claw.Windows.JobApi")
  $type = $module.DefineType("ClawJobApi", [Reflection.TypeAttributes]"Public,Abstract,Sealed")
  $signatures = @(
    @{ name="OpenProcess"; entry="OpenProcess"; returns=[IntPtr]; parameters=[Type[]]@([uint32],[bool],[int]) },
    @{ name="CloseHandle"; entry="CloseHandle"; returns=[bool]; parameters=[Type[]]@([IntPtr]) },
    @{ name="GetProcessTimes"; entry="GetProcessTimes"; returns=[bool]; parameters=[Type[]]@([IntPtr],[IntPtr],[IntPtr],[IntPtr],[IntPtr]) },
    @{ name="CreateJobObject"; entry="CreateJobObjectW"; returns=[IntPtr]; parameters=[Type[]]@([IntPtr],[string]) },
    @{ name="SetInformationJobObject"; entry="SetInformationJobObject"; returns=[bool]; parameters=[Type[]]@([IntPtr],[int],[IntPtr],[uint32]) },
    @{ name="AssignProcessToJobObject"; entry="AssignProcessToJobObject"; returns=[bool]; parameters=[Type[]]@([IntPtr],[IntPtr]) },
    @{ name="IsProcessInJob"; entry="IsProcessInJob"; returns=[bool]; parameters=[Type[]]@([IntPtr],[IntPtr],[IntPtr]) },
    @{ name="TerminateJobObject"; entry="TerminateJobObject"; returns=[bool]; parameters=[Type[]]@([IntPtr],[uint32]) },
    @{ name="WaitForSingleObject"; entry="WaitForSingleObject"; returns=[uint32]; parameters=[Type[]]@([IntPtr],[uint32]) },
    @{ name="QueryInformationJobObject"; entry="QueryInformationJobObject"; returns=[bool]; parameters=[Type[]]@([IntPtr],[int],[IntPtr],[uint32],[IntPtr]) }
  )
  $importType = [Runtime.InteropServices.DllImportAttribute]
  $constructor = $importType.GetConstructor([Type[]]@([string]))
  $fields = [Reflection.FieldInfo[]]@($importType.GetField("SetLastError"), $importType.GetField("EntryPoint"),
    $importType.GetField("CharSet"), $importType.GetField("CallingConvention"))
  foreach ($signature in $signatures) {
    # The attribute must create the import map; updating an existing map loses SetLastError.
    $method = $type.DefineMethod($signature.name,
      [Reflection.MethodAttributes]"Public,Static,PinvokeImpl", [Reflection.CallingConventions]::Standard,
      $signature.returns, $signature.parameters)
    $values = [object[]]@($true, $signature.entry, [Runtime.InteropServices.CharSet]::Unicode,
      [Runtime.InteropServices.CallingConvention]::Winapi)
    $method.SetCustomAttribute([Reflection.Emit.CustomAttributeBuilder]::new($constructor, [object[]]@("kernel32.dll"),
      $fields, $values))
    $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
  }
  # A managed wait callback must not run a PowerShell scriptblock on an unowned thread.
  $callback = $type.DefineMethod("ParentExited", [Reflection.MethodAttributes]"Public,Static", [void],
    [Type[]]@([object],[bool]))
  $il = $callback.GetILGenerator()
  $done = $il.DefineLabel()
  $il.Emit([Reflection.Emit.OpCodes]::Ldarg_1)
  $il.Emit([Reflection.Emit.OpCodes]::Brtrue_S,$done)
  $il.Emit([Reflection.Emit.OpCodes]::Ldc_I4_0)
  $il.Emit([Reflection.Emit.OpCodes]::Call, [Environment].GetMethod("Exit", [Type[]]@([int])))
  $il.MarkLabel($done)
  $il.Emit([Reflection.Emit.OpCodes]::Ret)
  return $type.CreateType()
}

function Get-NativeBirth([IntPtr]$processHandle) {
  $times = [Runtime.InteropServices.Marshal]::AllocHGlobal($PROCESS_TIMES_BYTES)
  try {
    $valid = $native::GetProcessTimes($processHandle, $times, [IntPtr]::Add($times,$EXIT_TIME_OFFSET),
      [IntPtr]::Add($times,$KERNEL_TIME_OFFSET), [IntPtr]::Add($times,$USER_TIME_OFFSET))
    Assert-Native $valid "${ERRORS.IDENTITY}"
    $birth = [DateTime]::FromFileTimeUtc([Runtime.InteropServices.Marshal]::ReadInt64($times)).Ticks
    return $birth.ToString([Globalization.CultureInfo]::InvariantCulture)
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($times) }
}
function Close-OwnedScope($scope) {
  $jobClosed = $true
  $rootClosed = $true
  if ($scope.job -ne [IntPtr]::Zero) {
    $jobClosed = $native::CloseHandle($scope.job)
    $scope.job = [IntPtr]::Zero
  }
  if ($scope.process -ne [IntPtr]::Zero) {
    $rootClosed = $native::CloseHandle($scope.process)
    $scope.process = [IntPtr]::Zero
  }
  Assert-Native ($jobClosed -and $rootClosed) "${ERRORS.QUERY}"
}
function New-OwnedScope($frame) {
  Assert-Native ($native::WaitForSingleObject($parentWait.SafeWaitHandle.DangerousGetHandle(),0) -eq $WAIT_TIMEOUT) "${ERRORS.BROKER}"
  Assert-Native ($frame.rootPid -ne $parentPid -and $frame.rootPid -ne $brokerPid -and
    -not $ownedRoots.Contains($frame.rootPid) -and -not $scopeIds.Contains($frame.scope)) "${ERRORS.IDENTITY}"
  Assert-Native ($jobs.Count -lt ${MAX_SCOPES} -and $scopeIds.Count -lt ${MAX_REQUESTS}) "${ERRORS.LIMIT}"
  $scope = @{ rootPid=[int]$frame.rootPid; rootStartedAt=$null; process=[IntPtr]::Zero; job=[IntPtr]::Zero }
  $limits = [IntPtr]::Zero
  $assigned = [IntPtr]::Zero
  try {
    $scope.process = $native::OpenProcess($ROOT_ACCESS,$false,$scope.rootPid)
    Assert-Native ($scope.process -ne [IntPtr]::Zero) "${ERRORS.ATTACH}"
    Assert-Native ($native::WaitForSingleObject($scope.process,0) -eq $WAIT_TIMEOUT) "${ERRORS.ATTACH}"
    $scope.rootStartedAt = Get-NativeBirth $scope.process
    $scope.job = $native::CreateJobObject([IntPtr]::Zero,$null)
    Assert-Native ($scope.job -ne [IntPtr]::Zero) "${ERRORS.ATTACH}"
    # Windows ABI offsets are independent of managed struct packing; pointer widths select the extent.
    $limitBytes = if ([IntPtr]::Size -eq 8) { $EXTENDED_LIMIT_BYTES_64 } else { $EXTENDED_LIMIT_BYTES_32 }
    $limits = [Runtime.InteropServices.Marshal]::AllocHGlobal($limitBytes)
    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($limitBytes),0,$limits,$limitBytes)
    [Runtime.InteropServices.Marshal]::WriteInt32($limits,$LIMIT_FLAGS_OFFSET,$JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
    Assert-Native ($native::SetInformationJobObject($scope.job,$EXTENDED_LIMITS,$limits,$limitBytes)) "${ERRORS.ATTACH}"
    Assert-Native ($native::AssignProcessToJobObject($scope.job,$scope.process)) "${ERRORS.ATTACH}"
    $assigned = [Runtime.InteropServices.Marshal]::AllocHGlobal($DWORD_BYTES)
    Assert-Native ($native::IsProcessInJob($scope.process,$scope.job,$assigned)) "${ERRORS.IDENTITY}"
    Assert-Native ([Runtime.InteropServices.Marshal]::ReadInt32($assigned) -eq 1) "${ERRORS.IDENTITY}"
    Assert-Native ((Get-NativeBirth $scope.process) -ceq $scope.rootStartedAt) "${ERRORS.IDENTITY}"
    Assert-Native ($native::WaitForSingleObject($scope.process,0) -eq $WAIT_TIMEOUT) "${ERRORS.IDENTITY}"
    $jobs.Add($frame.scope,$scope)
    [void]$ownedRoots.Add($scope.rootPid)
    [void]$scopeIds.Add($frame.scope)
    return $scope
  } catch {
    Close-OwnedScope $scope
    throw
  } finally {
    if ($limits -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($limits) }
    if ($assigned -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($assigned) }
  }
}
function Get-OwnedPids($scope) {
  $bytes = $PID_LIST_HEADER_BYTES + ${MAX_KNOWN_PIDS} * [IntPtr]::Size
  $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes)
  try {
    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($bytes),0,$buffer,$bytes)
    $complete = $native::QueryInformationJobObject($scope.job,$PROCESS_ID_LIST,$buffer,$bytes,[IntPtr]::Zero)
    Assert-Native ($complete -or [Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq $ERROR_MORE_DATA) "${ERRORS.QUERY}"
    $listed = [Runtime.InteropServices.Marshal]::ReadInt32($buffer,$DWORD_BYTES)
    Assert-Native ($listed -ge 0 -and $listed -le ${MAX_KNOWN_PIDS}) "${ERRORS.QUERY}"
    $members = [Collections.Generic.HashSet[int]]::new()
    [void]$members.Add($scope.rootPid)
    for ($index=0; $index -lt $listed -and $members.Count -lt ${MAX_KNOWN_PIDS}; $index++) {
      $member = [Runtime.InteropServices.Marshal]::ReadIntPtr($buffer,$PID_LIST_HEADER_BYTES + $index * [IntPtr]::Size).ToInt64()
      Assert-Native ($member -gt ${SYSTEM_PID_MAX} -and $member -le ${MAX_PID}) "${ERRORS.QUERY}"
      [void]$members.Add([int]$member)
    }
    [int[]]$known = @($members)
    [Array]::Sort($known)
    return $known
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
}
function Stop-OwnedScope($scope) {
  Assert-Native ($scope.job -ne [IntPtr]::Zero) "${ERRORS.CLOSED}"
  Assert-Native ((Get-NativeBirth $scope.process) -ceq $scope.rootStartedAt) "${ERRORS.IDENTITY}"
  $settlement = @{ stoppedPids=@(); settlementConfirmed=$false; unknownProcesses=$null; code=$null }
  $accounting = [Runtime.InteropServices.Marshal]::AllocHGlobal($ACCOUNTING_BYTES)
  try {
    $settlement.stoppedPids = [int[]]@(Get-OwnedPids $scope)
    Assert-Native ($native::TerminateJobObject($scope.job,1)) "${ERRORS.QUERY}"
    $elapsed = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
      Assert-Native ($native::QueryInformationJobObject($scope.job,$BASIC_ACCOUNTING,$accounting,$ACCOUNTING_BYTES,[IntPtr]::Zero)) "${ERRORS.QUERY}"
      $activeProcesses = [uint32][Runtime.InteropServices.Marshal]::ReadInt32($accounting,$ACTIVE_PROCESS_OFFSET)
      $waited = $native::WaitForSingleObject($scope.process,0)
      Assert-Native ($waited -eq $WAIT_OBJECT_0 -or $waited -eq $WAIT_TIMEOUT) "${ERRORS.QUERY}"
      $settlement.unknownProcesses = $activeProcesses
      if ($activeProcesses -eq 0 -and $waited -eq $WAIT_OBJECT_0) {
        $settlement.settlementConfirmed = $true
        return $settlement
      }
      if ($elapsed.ElapsedMilliseconds -ge ${NATIVE_SETTLEMENT_TIMEOUT_MS}) {
        $settlement.code = "${ERRORS.TIMEOUT}"
        return $settlement
      }
      if ($waited -eq $WAIT_TIMEOUT) { [void]$native::WaitForSingleObject($scope.process,${NATIVE_WAIT_INTERVAL_MS}) }
      else { [Threading.Thread]::Sleep(${NATIVE_WAIT_INTERVAL_MS}) }
    }
  } catch {
    [void]$native::TerminateJobObject($scope.job,1)
    $settlement.unknownProcesses = $null
    $settlement.code = Get-SafeFailure $_ "${ERRORS.QUERY}"
    return $settlement
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($accounting) }
}
function Read-NativeLine {
  $line = [Text.StringBuilder]::new()
  while ($true) {
    $character = [Console]::In.Read()
    if ($character -lt 0) {
      Assert-Native ($line.Length -eq 0) "${ERRORS.PROTOCOL}"
      return $null
    }
    if ($character -eq 10) { return $line.ToString() }
    Assert-Native ($line.Length -lt ${MAX_FRAME_BYTES}) "${ERRORS.PROTOCOL}"
    if ($character -ne 13) { [void]$line.Append([char]$character) }
  }
}
function Read-NativeFrame([string]$line) {
  try { $frame = ConvertFrom-Json -InputObject $line -AsHashtable }
  catch { Stop-NativeFailure "${ERRORS.PROTOCOL}" }
  Assert-Native ($frame -is [Collections.IDictionary]) "${ERRORS.PROTOCOL}"
  Assert-Native (($frame.v -is [int] -or $frame.v -is [long]) -and $frame.v -eq 1 -and
    $frame.t -is [string] -and $frame.t -ceq "request") "${ERRORS.PROTOCOL}"
  Assert-Native ($frame.id -is [string] -and $frame.id -cmatch "\A[a-f0-9]{32}\z" -and
    $frame.scope -is [string] -and $frame.scope -cmatch "\A[a-f0-9]{32}\z") "${ERRORS.PROTOCOL}"
  Assert-Native (($frame.rootPid -is [int] -or $frame.rootPid -is [long]) -and
    $frame.rootPid -gt ${SYSTEM_PID_MAX} -and $frame.rootPid -le ${MAX_PID}) "${ERRORS.PROTOCOL}"
  Assert-Native (@("${OPERATIONS.OPEN}","${OPERATIONS.TERMINATE}","${OPERATIONS.CLOSE}") -ccontains $frame.op) "${ERRORS.PROTOCOL}"
  foreach ($name in $frame.Keys) {
    Assert-Native (@("v","t","id","scope","op","rootPid","rootStartedAt") -ccontains $name) "${ERRORS.PROTOCOL}"
  }
  $fields = if ($frame.op -ceq "${OPERATIONS.OPEN}") { 6 } else { 7 }
  Assert-Native ($frame.Count -eq $fields) "${ERRORS.PROTOCOL}"
  if ($fields -eq 7) { Assert-Native ($frame.rootStartedAt -is [string]) "${ERRORS.PROTOCOL}" }
  return $frame
}
function Send-OwnedResponse($frame,$scope,$settlement) {
  if ($null -eq $settlement) {
    $settlement = @{ stoppedPids=@(); settlementConfirmed=$false; unknownProcesses=$null; code=$null }
  }
  Send-NativeFrame @{
    v=1; t="response"; id=$frame.id; scope=$frame.scope; op=$frame.op; ok=$true
    rootPid=$scope.rootPid; rootStartedAt=$scope.rootStartedAt; rootReady=$true
    stoppedPids=@($settlement.stoppedPids); settlementConfirmed=$settlement.settlementConfirmed
    unknownProcesses=$settlement.unknownProcesses; code=$settlement.code
  }
}
try {
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $native = New-NativeBindings
  $parentPid = [int]$env:${PARENT_PID_ENVIRONMENT}
  $current = [Diagnostics.Process]::GetCurrentProcess()
  try { $brokerPid = $current.Id } finally { $current.Dispose() }
  Assert-Native ($parentPid -gt ${SYSTEM_PID_MAX} -and $parentPid -ne $brokerPid) "${ERRORS.IDENTITY}"
  $parentHandle = $native::OpenProcess($SYNCHRONIZE,$false,$parentPid)
  Assert-Native ($parentHandle -ne [IntPtr]::Zero) "${ERRORS.UNAVAILABLE}"
  $parentWait = [Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset)
  $parentWait.SafeWaitHandle = [Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($parentHandle,$true)
  Assert-Native ($native::WaitForSingleObject($parentHandle,0) -eq $WAIT_TIMEOUT) "${ERRORS.UNAVAILABLE}"
  $callback = [Delegate]::CreateDelegate([Threading.WaitOrTimerCallback],$native.GetMethod("ParentExited"))
  $parentRegistration = [Threading.ThreadPool]::RegisterWaitForSingleObject($parentWait,$callback,$null,-1,$true)
  Send-NativeFrame @{ v=1; t="ready"; pid=$brokerPid; parentPid=$parentPid }
  while ($null -ne ($line = Read-NativeLine)) {
    $frame = Read-NativeFrame $line
    Assert-Native ($requestIds.Count -lt ${MAX_REQUESTS}) "${ERRORS.LIMIT}"
    Assert-Native ($requestIds.Add($frame.id)) "${ERRORS.PROTOCOL}"
    try {
      if ($frame.op -ceq "${OPERATIONS.OPEN}") {
        Send-OwnedResponse $frame (New-OwnedScope $frame) $null
        continue
      }
      Assert-Native ($jobs.ContainsKey($frame.scope)) "${ERRORS.IDENTITY}"
      $scope = $jobs[$frame.scope]
      Assert-Native ($scope.rootPid -eq $frame.rootPid -and $scope.rootStartedAt -ceq $frame.rootStartedAt) "${ERRORS.IDENTITY}"
      if ($frame.op -ceq "${OPERATIONS.TERMINATE}") {
        Send-OwnedResponse $frame $scope (Stop-OwnedScope $scope)
        continue
      }
      try { $settlement = Stop-OwnedScope $scope }
      finally {
        Close-OwnedScope $scope
        [void]$jobs.Remove($frame.scope)
        [void]$ownedRoots.Remove($scope.rootPid)
      }
      Send-OwnedResponse $frame $scope $settlement
    } catch {
      Send-NativeFrame @{ v=1; t="response"; id=$frame.id; scope=$frame.scope; op=$frame.op; ok=$false
        code=(Get-SafeFailure $_ "${ERRORS.BROKER}") }
    }
  }
} catch {
  Send-NativeFrame @{ v=1; t="failed"; code=(Get-SafeFailure $_ "${ERRORS.UNAVAILABLE}") }
} finally {
  foreach ($scope in $jobs.Values) {
    try { Close-OwnedScope $scope }
    catch { Send-NativeFrame @{ v=1; t="failed"; code="${ERRORS.QUERY}" } }
  }
  if ($null -ne $parentRegistration) { [void]$parentRegistration.Unregister($null) }
  if ($null -ne $parentWait) { $parentWait.Dispose() }
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
try { $broker = [ScriptBlock]::Create($reader.ReadToEnd()) }
finally { $reader.Dispose(); $inflated.Dispose(); $compressed.Dispose() }
& $broker
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
