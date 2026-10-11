import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { ClawError } from "../errors.mjs";
import {
  nativeSupervisorRootExit, NATIVE_SCOPE_ERRORS, NATIVE_SCOPE_MAX_PROCESSES, NATIVE_SUPERVISOR_ARGUMENT,
  NATIVE_SUPERVISOR_STOP_MESSAGE,
} from "./native-command-supervisor.mjs";

const MAX_PATH_BYTES = 2_048;
const MAX_CONTROL_BYTES = 32_768;
const CONTROL_TIMEOUT_MS = 3_000;
const PROC_START_INDEX = 19;
const SCOPE_ADDRESS_PREFIX = "\0pforge-claw-posix-";
const TRUSTED_SUPERVISOR_PATH = fileURLToPath(new URL("./native-command-supervisor.mjs", import.meta.url));
const UNSEALED_RUNTIME_HOOK = /^(?:CORECLR_|COR_|COMPlus_ProfAPI|LD_(?!PRELOAD$|LIBRARY_PATH$))/;

/**
 * @typedef {{rootPid:number, rootStartedAt:string, rootReady:boolean, stoppedPids:number[],
 * settlementConfirmed:boolean, unknownProcesses:number|null, code?:string}} NativeSettlement
 * @typedef {{rootPid:number, rootStartedAt:string, terminate:()=>Promise<NativeSettlement>,
 * close:()=>Promise<void>}} PosixProcessScope
 */

// The held root retains waitpid authority. Exec'ing Node here would lose the ability to reap adopted children.
const NATIVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$script:Unavailable = '__UNAVAILABLE__'
$script:Unconfirmed = '__UNCONFIRMED__'
$script:Limit = '__LIMIT__'
$script:MaxProcesses = __MAX_PROCESSES__
$script:DeadlineMs = 3000
$script:ECHILD = 10
$script:EINTR = 4
$script:ESRCH = 3
$script:SetChildSubreaper = 36
$script:GetChildSubreaper = 37
$script:PidFdOpenCall = 434
$script:PidFdSignalCall = 424
$script:KillSignal = 9
$script:NoHang = 1
$script:SetFdFlags = 2
$script:CloseOnExec = 1
$script:UnixDomain = 1
$script:StreamSocket = 1
$script:SocketCloseOnExec = 524288
$script:SocketLevel = 1
$script:PeerCredentialsOption = 17
$script:PeerCredentialsBytes = 12
$script:NativeIntBytes = 4
$script:PollBytes = 8
$script:SpawnActionsBytes = 256
$script:IpcDescriptor = 3
$script:ReadBatchBytes = 16384
$script:DecodeSlackChars = 4
$script:SelectIntervalMicroseconds = 100000
$script:MaxActorBytes = 2097152
$script:MaxControlBytes = 32768
$script:MaxEnvironmentBytes = 8388608
$script:MaxPidDigits = 16
$script:NativeEntries = @{ prctlGet = 'prctl'; pidfd_open = 'syscall'; pidfd_send_signal = 'syscall';
    spawn_init = 'posix_spawn_file_actions_init'; spawn_destroy = 'posix_spawn_file_actions_destroy';
    spawn_dup2 = 'posix_spawn_file_actions_adddup2'; spawn_close = 'posix_spawn_file_actions_addclose' }
$script:Utf8 = [Text.UTF8Encoding]::new($false, $true)
$script:Stopped = [Collections.Generic.HashSet[int]]::new()
$script:ExceededLimit = $false
$script:Channels = [Collections.Generic.List[object]]::new()
$script:Buffers = [Collections.Generic.List[IntPtr]]::new()

function Fail-Scope([string]$code, [int]$errno = 0) {
    $fault = [InvalidOperationException]::new($code)
    $fault.Data['NativeErrno'] = $errno
    throw $fault
}
function Scope-Code($failure) {
    $exception = $failure.Exception
    while ($null -ne $exception) {
        if ($exception.Message -in @($Unavailable, $Unconfirmed, $Limit)) { return $exception.Message }
        $exception = $exception.InnerException
    }
    return $Unconfirmed
}
function Native-Memory([int]$bytes) {
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes)
    $Buffers.Add($pointer)
    return $pointer
}
function Proc-Path([string[]]$parts) {
    $target = [IO.Path]::Combine([IO.Path]::DirectorySeparatorChar.ToString(), 'proc')
    foreach ($part in $parts) { $target = [IO.Path]::Combine($target, $part) }
    return $target
}
function Process-Identity([int]$processId) {
    $text = [IO.File]::ReadAllText((Proc-Path @([string]$processId, 'stat')))
    $fields = $text.Substring($text.LastIndexOf(')') + 2).Split([char[]]@(' '), [StringSplitOptions]::RemoveEmptyEntries)
    return @{ Parent = [int]$fields[1]; Birth = $fields[19] }
}

# Only libc import metadata is emitted; no C# compiler or persisted assembly participates in startup.
function Add-NativeMethod([string]$name, [type]$returnType, [type[]]$parameters) {
    $entry = $(if ($NativeEntries.ContainsKey($name)) { $NativeEntries[$name] } else { $name })
    $method = $script:NativeBuilder.DefineMethod($name,
        [Reflection.MethodAttributes]'Public,Static,PinvokeImpl', $returnType, $parameters)
    $attribute = [Runtime.InteropServices.DllImportAttribute]
    $constructor = $attribute.GetConstructor([type[]]@([string]))
    $fields = [Reflection.FieldInfo[]]@($attribute.GetField('EntryPoint'), $attribute.GetField('SetLastError'),
        $attribute.GetField('CallingConvention'), $attribute.GetField('CharSet'), $attribute.GetField('ExactSpelling'))
    $values = [object[]]@($entry, $true, [Runtime.InteropServices.CallingConvention]::Cdecl,
        [Runtime.InteropServices.CharSet]::Ansi, $true)
    $method.SetCustomAttribute([Reflection.Emit.CustomAttributeBuilder]::new($constructor,
        [object[]]@('libc'), $fields, $values))
    $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
}
function Initialize-NativeImports {
    $assembly = [Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly(
        [Reflection.AssemblyName]::new('Claw.Posix.Imports'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
    $script:NativeBuilder = $assembly.DefineDynamicModule('libc').DefineType('ClawPosixImports',
        [Reflection.TypeAttributes]'Public,Abstract,Sealed')
    Add-NativeMethod 'getpid' ([int]) @()
    Add-NativeMethod 'getppid' ([int]) @()
    Add-NativeMethod 'getuid' ([uint32]) @()
    Add-NativeMethod 'close' ([int]) @([int])
    Add-NativeMethod 'fcntl' ([int]) @([int], [int], [int])
    Add-NativeMethod 'waitpid' ([int]) @([int], [IntPtr], [int])
    Add-NativeMethod 'poll' ([int]) @([IntPtr], [uint64], [int])
    Add-NativeMethod 'prctl' ([int]) @([int], [uint64], [uint64], [uint64], [uint64])
    Add-NativeMethod 'prctlGet' ([int]) @([int], [IntPtr], [uint64], [uint64], [uint64])
    Add-NativeMethod 'pidfd_open' ([long]) @([long], [int], [uint32])
    Add-NativeMethod 'pidfd_send_signal' ([long]) @([long], [int], [int], [IntPtr], [uint32])
    Add-NativeMethod 'getsockopt' ([int]) @([int], [int], [int], [IntPtr], [IntPtr])
    Add-NativeMethod 'socketpair' ([int]) @([int], [int], [int], [IntPtr])
    Add-NativeMethod 'spawn_init' ([int]) @([IntPtr])
    Add-NativeMethod 'spawn_destroy' ([int]) @([IntPtr])
    Add-NativeMethod 'spawn_dup2' ([int]) @([IntPtr], [int], [int])
    Add-NativeMethod 'spawn_close' ([int]) @([IntPtr], [int])
    Add-NativeMethod 'posix_spawn' ([int]) @([IntPtr], [string], [IntPtr], [IntPtr], [IntPtr], [IntPtr])
    Add-NativeMethod '_exit' ([void]) @([int])
    $script:Native = $script:NativeBuilder.CreateType()
    $script:StatusMemory = Native-Memory $NativeIntBytes
    $script:PollMemory = Native-Memory $PollBytes
    $script:PeerMemory = Native-Memory $PeerCredentialsBytes
    $script:LengthMemory = Native-Memory $NativeIntBytes
}
function Open-PidFd([int]$processId, [string]$birth, [int]$parent = 0) {
    $before = Process-Identity $processId
    if ($before.Birth -cne $birth -or ($parent -gt 0 -and $before.Parent -ne $parent)) { Fail-Scope $Unconfirmed }
    $descriptor = [int]$Native::pidfd_open($PidFdOpenCall, $processId, 0)
    $errno = [Runtime.InteropServices.Marshal]::GetLastPInvokeError()
    if ($descriptor -lt 0) { Fail-Scope $Unavailable $errno }
    try {
        $after = Process-Identity $processId
        $identity = [IO.File]::ReadAllText((Proc-Path @('self', 'fdinfo', [string]$descriptor)))
        if ($after.Birth -cne $before.Birth -or $after.Parent -ne $before.Parent -or
            -not $identity.Contains("Pid:" + [char]9 + $processId + [char]10)) { Fail-Scope $Unconfirmed }
        return $descriptor
    } catch { $null = $Native::close($descriptor); throw }
}
function Establish-Subreaper {
    if ($Native::prctl($SetChildSubreaper, 1, 0, 0, 0) -ne 0 -or
        $Native::prctlGet($GetChildSubreaper, $StatusMemory, 0, 0, 0) -ne 0 -or
        [Runtime.InteropServices.Marshal]::ReadInt32($StatusMemory) -ne 1) { Fail-Scope $Unavailable }
    $descriptor = Open-PidFd $script:RootPid $script:RootBirth
    try {
        [Runtime.InteropServices.Marshal]::WriteInt32($PollMemory, $descriptor)
        [Runtime.InteropServices.Marshal]::WriteInt16($PollMemory, 4, 1)
        [Runtime.InteropServices.Marshal]::WriteInt16($PollMemory, 6, 0)
        if ($Native::poll($PollMemory, 1, 0) -lt 0 -or
            [Runtime.InteropServices.Marshal]::ReadInt16($PollMemory, 6) -ne 0 -or
            $Native::pidfd_send_signal($PidFdSignalCall, $descriptor, 0, [IntPtr]::Zero, 0) -lt 0) { Fail-Scope $Unavailable }
    } finally { $null = $Native::close($descriptor) }
}
function Initial-Environment {
    $stream = [IO.File]::OpenRead((Proc-Path @('self', 'environ')))
    $contents = [IO.MemoryStream]::new()
    $batch = [byte[]]::new(8192)
    try {
        while (($count = $stream.Read($batch, 0, $batch.Length)) -gt 0) {
            if ($contents.Length + $count -gt $MaxEnvironmentBytes) { Fail-Scope $Limit }
            $contents.Write($batch, 0, $count)
        }
        return $Utf8.GetString($contents.ToArray()).Split([char[]]@([char]0), [StringSplitOptions]::RemoveEmptyEntries)
    } finally { $stream.Dispose(); $contents.Dispose() }
}
function New-Vector([string[]]$entries) {
    $strings = [Collections.Generic.List[IntPtr]]::new()
    $pointer = [IntPtr]::Zero
    try {
        foreach ($entry in $entries) { $strings.Add([Runtime.InteropServices.Marshal]::StringToCoTaskMemUTF8($entry)) }
        $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal(($strings.Count + 1) * [IntPtr]::Size)
        for ($index = 0; $index -lt $strings.Count; $index++) {
            [Runtime.InteropServices.Marshal]::WriteIntPtr($pointer, $index * [IntPtr]::Size, $strings[$index])
        }
        [Runtime.InteropServices.Marshal]::WriteIntPtr($pointer, $strings.Count * [IntPtr]::Size, [IntPtr]::Zero)
        return @{ Pointer = $pointer; Strings = $strings }
    } catch {
        foreach ($entry in $strings) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($entry) }
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
        throw
    }
}
function Close-Vector($vector) {
    if ($null -eq $vector) { return }
    foreach ($entry in $vector.Strings) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($entry) }
    [Runtime.InteropServices.Marshal]::FreeHGlobal($vector.Pointer)
}
function New-Channel($socket, [string]$kind) {
    $socket.SendTimeout = $DeadlineMs
    $channel = @{ Socket = $socket; Kind = $kind; Text = ''; Decoder = $Utf8.GetDecoder() }
    $Channels.Add($channel)
    return $channel
}
function Channel-FromFd([int]$descriptor, [string]$kind) {
    $handle = [Net.Sockets.SafeSocketHandle]::new([IntPtr]$descriptor, $true)
    return New-Channel ([Net.Sockets.Socket]::new($handle)) $kind
}
function Write-Line($channel, [string]$line) {
    $bytes = $Utf8.GetBytes($line + [char]10)
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $count = $channel.Socket.Send($bytes, $offset, $bytes.Length - $offset, [Net.Sockets.SocketFlags]::None)
        if ($count -le 0) { Fail-Scope $Unconfirmed }
        $offset += $count
    }
}
function Write-Frame($channel, $frame) {
    Write-Line $channel (ConvertTo-Json -InputObject $frame -Compress -Depth 8)
}
function Start-Supervisor($config) {
    $pair = Native-Memory (2 * $NativeIntBytes)
    if ($Native::socketpair($UnixDomain, ($StreamSocket -bor $SocketCloseOnExec), 0, $pair) -ne 0) { Fail-Scope $Unavailable }
    $parentFd = [Runtime.InteropServices.Marshal]::ReadInt32($pair)
    $childFd = [Runtime.InteropServices.Marshal]::ReadInt32($pair, 4)
    $actions = Native-Memory $SpawnActionsBytes
    $initialized = $false
    $argv = $null
    $environment = $null
    try {
        if ($Native::spawn_init($actions) -ne 0) { Fail-Scope $Unavailable }
        $initialized = $true
        if ($Native::spawn_dup2($actions, $childFd, $IpcDescriptor) -ne 0 -or
            $Native::spawn_close($actions, $parentFd) -ne 0 -or
            ($childFd -ne $IpcDescriptor -and $Native::spawn_close($actions, $childFd) -ne 0)) { Fail-Scope $Unavailable }
        $entries = [Collections.Generic.List[string]]::new()
        # PowerShell changes PATH; the kernel's original exec environment preserves the actor's exact values.
        foreach ($entry in (Initial-Environment)) {
            if (-not $entry.StartsWith('NODE_CHANNEL_FD=') -and
                -not $entry.StartsWith('NODE_CHANNEL_SERIALIZATION_MODE=')) { $entries.Add($entry) }
        }
        $entries.Add('NODE_CHANNEL_FD=' + $IpcDescriptor)
        $entries.Add('NODE_CHANNEL_SERIALIZATION_MODE=json')
        $argv = New-Vector @($config.node, $config.supervisorPath, $config.argument)
        $environment = New-Vector ($entries.ToArray())
        if ($Native::posix_spawn($StatusMemory, $config.node, $actions, [IntPtr]::Zero,
            $argv.Pointer, $environment.Pointer) -ne 0) { Fail-Scope $Unavailable }
        $script:InnerPid = [Runtime.InteropServices.Marshal]::ReadInt32($StatusMemory)
        $script:Inner = Channel-FromFd $parentFd 'inner'
        $parentFd = -1
    } finally {
        Close-Vector $argv
        Close-Vector $environment
        if ($initialized) { $null = $Native::spawn_destroy($actions) }
        $null = $Native::close($childFd)
        if ($parentFd -ge 0) { $null = $Native::close($parentFd) }
    }
}
function Record-Stopped([int]$processId) {
    if ($Stopped.Contains($processId)) { return }
    if ($Stopped.Count -ge $MaxProcesses) { $script:ExceededLimit = $true }
    else { $null = $Stopped.Add($processId) }
}
function Stop-OwnedChild([int]$processId) {
    $descriptor = -1
    try {
        $identity = Process-Identity $processId
        if ($identity.Parent -ne $RootPid) { Fail-Scope $Unconfirmed }
        $descriptor = Open-PidFd $processId $identity.Birth $RootPid
        $sent = $Native::pidfd_send_signal($PidFdSignalCall, $descriptor, $KillSignal, [IntPtr]::Zero, 0)
        $errno = [Runtime.InteropServices.Marshal]::GetLastPInvokeError()
        if ($sent -lt 0 -and $errno -ne $ESRCH) { Fail-Scope $Unconfirmed $errno }
        Record-Stopped $processId
    } catch [IO.FileNotFoundException] { return }
    catch [IO.DirectoryNotFoundException] { return }
    finally { if ($descriptor -ge 0) { $null = $Native::close($descriptor) } }
}
function Stop-ListedChildren($clock) {
    foreach ($task in [IO.Directory]::EnumerateDirectories((Proc-Path @('self', 'task')))) {
        try { $reader = [IO.File]::OpenText([IO.Path]::Combine($task, 'children')) }
        catch [IO.FileNotFoundException] { continue }
        catch [IO.DirectoryNotFoundException] { continue }
        try {
            $token = [Text.StringBuilder]::new()
            while (($character = $reader.Read()) -ge 0) {
                if ($clock.ElapsedMilliseconds -ge $DeadlineMs) { Fail-Scope $Unconfirmed }
                if ([char]::IsWhiteSpace([char]$character)) {
                    if ($token.Length -eq 0) { continue }
                    Stop-OwnedChild ([int]$token.ToString())
                    $null = $token.Clear()
                } else {
                    if ($token.Length -ge $MaxPidDigits) { Fail-Scope $Unconfirmed }
                    $null = $token.Append([char]$character)
                }
            }
            if ($token.Length -gt 0) { Stop-OwnedChild ([int]$token.ToString()) }
        } finally { $reader.Dispose() }
    }
}
function Stop-Children {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        while ($clock.ElapsedMilliseconds -lt $DeadlineMs) {
            do {
                $reaped = $Native::waitpid(-1, $StatusMemory, $NoHang)
                $errno = [Runtime.InteropServices.Marshal]::GetLastPInvokeError()
                if ($reaped -gt 0) { Record-Stopped $reaped }
            } while ($reaped -gt 0 -and $clock.ElapsedMilliseconds -lt $DeadlineMs)
            if ($reaped -lt 0 -and $errno -eq $ECHILD) {
                return @{ Zero = $true; Code = $(if ($ExceededLimit) { $Limit } else { $null }) }
            }
            if ($reaped -lt 0 -and $errno -ne $EINTR) { Fail-Scope $Unconfirmed $errno }
            Stop-ListedChildren $clock
            [Threading.Thread]::Sleep(1)
        }
        return @{ Zero = $false; Code = $Unconfirmed }
    } catch { return @{ Zero = $false; Code = (Scope-Code $_) } }
}
function Accept-Control {
    $socket = $script:Listener.Accept()
    try {
        [Runtime.InteropServices.Marshal]::WriteInt32($LengthMemory, $PeerCredentialsBytes)
        if ($Native::getsockopt($socket.Handle.ToInt32(), $SocketLevel, $PeerCredentialsOption, $PeerMemory, $LengthMemory) -ne 0) {
            Fail-Scope $Unconfirmed
        }
        $peerUid = [uint32]([long][Runtime.InteropServices.Marshal]::ReadInt32($PeerMemory, $NativeIntBytes) -band
            [long]([uint32]::MaxValue))
        if ([Runtime.InteropServices.Marshal]::ReadInt32($LengthMemory) -ne $PeerCredentialsBytes -or
            [Runtime.InteropServices.Marshal]::ReadInt32($PeerMemory) -ne $OwnerPid -or $peerUid -ne $OwnerUid) {
            Fail-Scope $Unconfirmed
        }
        if ($null -ne $script:Control) { Fail-Scope $Unconfirmed }
        $script:Control = New-Channel $socket 'control'
    } catch { $socket.Dispose(); throw }
}
function Is-NativeInteger($value) {
    return $value -is [int] -or $value -is [long]
}
function Receive-Frame($channel, [string]$line) {
    $frame = ConvertFrom-Json -InputObject $line -AsHashtable -NoEnumerate
    if ($frame -isnot [Collections.IDictionary] -or -not (Is-NativeInteger $frame.v) -or $frame.v -ne 1) {
        Fail-Scope $Unconfirmed
    }
    if ($channel.Kind -in @('outer', 'inner') -and $frame.t -isnot [string]) { Fail-Scope $Unconfirmed }
    if ($channel.Kind -eq 'control' -and $frame.operation -isnot [string]) { Fail-Scope $Unconfirmed }
    if ($channel.Kind -eq 'outer') {
        if ($frame.t -ceq '__STOP_MESSAGE__') { $script:Stopping = $true; return }
        if ($frame.t -cne 'owned-start') { Fail-Scope $Unconfirmed }
        if (-not $script:Attached -or $script:Started -or $script:Stopping) { Fail-Scope $Unconfirmed }
        $script:Started = $true
        Write-Line $script:Inner $line
    } elseif ($channel.Kind -eq 'inner') {
        if ($frame.t -ceq 'owned-ready' -and (Is-NativeInteger $frame.pid) -and $frame.pid -eq $InnerPid -and -not $script:Ready) {
            $script:Ready = $true
            Write-Frame $script:Outer @{ v = 1; t = 'owned-ready'; pid = $RootPid }
        } elseif ($frame.t -ceq 'owned-result' -and $script:Started -and (Is-NativeInteger $frame.code)) {
            Write-Line $script:Outer $line
        } else { Fail-Scope $Unconfirmed }
    } elseif (-not $script:Attached) {
        if ($frame.operation -cne 'attach' -or -not (Is-NativeInteger $frame.rootPid) -or $frame.rootPid -ne $RootPid -or
            $frame.rootStartedAt -isnot [string] -or $frame.rootStartedAt -cne $RootBirth) { Fail-Scope $Unconfirmed }
        $script:Attached = $true
        Write-Frame $channel @{ v = 1; rootPid = $RootPid; rootStartedAt = $RootBirth; rootReady = $true;
            subreaper = $true; pidfd = $true }
    } else {
        if ($frame.operation -cne 'terminate') { Fail-Scope $Unconfirmed }
        $script:SendReceipt = $true
        $script:Stopping = $true
    }
}
function Read-Channel($channel) {
    $count = $channel.Socket.Receive($script:ReadBytes, [Net.Sockets.SocketFlags]::None)
    if ($count -eq 0) {
        if ($channel.Kind -eq 'inner') { Fail-Scope $Unconfirmed }
        $script:Stopping = $true
        return
    }
    $characters = $channel.Decoder.GetChars($script:ReadBytes, 0, $count, $script:ReadChars, 0, $false)
    $channel.Text += [string]::new($script:ReadChars, 0, $characters)
    $maximum = $(if ($channel.Kind -eq 'control') { $MaxControlBytes } else { $MaxActorBytes })
    if ($Utf8.GetByteCount($channel.Text) -gt $maximum) { Fail-Scope $Limit }
    while (($end = $channel.Text.IndexOf([char]10)) -ge 0) {
        $line = $channel.Text.Substring(0, $end)
        $channel.Text = $channel.Text.Substring($end + 1)
        Receive-Frame $channel $line
        if ($script:Stopping) { return }
    }
}
function Invoke-NativeRoot([string]$encoded) {
    $exitCode = 1
    $script:Attached = $false
    $script:Started = $false
    $script:Ready = $false
    $script:Stopping = $false
    $script:SendReceipt = $false
    $script:Control = $null
    $script:Outer = $null
    $script:Listener = $null
    try {
        Initialize-NativeImports
        $script:RootPid = $Native::getpid()
        $script:OwnerPid = $Native::getppid()
        $script:OwnerUid = $Native::getuid()
        $script:RootBirth = (Process-Identity $RootPid).Birth
        $descriptor = [int][Environment]::GetEnvironmentVariable('NODE_CHANNEL_FD')
        if ($Native::fcntl($descriptor, $SetFdFlags, $CloseOnExec) -lt 0) { Fail-Scope $Unavailable }
        $script:Outer = Channel-FromFd $descriptor 'outer'
        Establish-Subreaper
        $config = ConvertFrom-Json -InputObject ($Utf8.GetString([Convert]::FromBase64String($encoded))) -AsHashtable
        $script:Listener = [Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::Unix,
            [Net.Sockets.SocketType]::Stream, [Net.Sockets.ProtocolType]::Unspecified)
        $address = [char]0 + 'pforge-claw-posix-' + $RootPid + '-' + $RootBirth
        $script:Listener.Bind([Net.Sockets.UnixDomainSocketEndPoint]::new($address))
        $script:Listener.Listen(1)
        $script:ReadBytes = [byte[]]::new($ReadBatchBytes)
        $script:ReadChars = [char[]]::new($ReadBatchBytes + $DecodeSlackChars)
        if ($script:Outer.Socket.Poll(0, [Net.Sockets.SelectMode]::SelectRead)) { Read-Channel $script:Outer }
        if (-not $script:Stopping) { Start-Supervisor $config }
        # A single readiness loop services both private sockets; no blocking reader occupies the CLR worker pool.
        while (-not $script:Stopping) {
            $readable = [Collections.ArrayList]::new()
            foreach ($channel in $Channels) { $null = $readable.Add($channel.Socket) }
            $null = $readable.Add($script:Listener)
            [Net.Sockets.Socket]::Select($readable, $null, $null, $SelectIntervalMicroseconds)
            foreach ($socket in $readable) {
                if ($socket -eq $script:Listener) { Accept-Control }
                else {
                    foreach ($channel in $Channels) {
                        if ($channel.Socket -eq $socket) { Read-Channel $channel; break }
                    }
                }
                if ($script:Stopping) { break }
            }
        }
        $receipt = Stop-Children
        if ($script:SendReceipt) {
            Write-Frame $script:Control @{ v = 1; rootPid = $RootPid; rootStartedAt = $RootBirth; rootReady = $true;
                zeroChildren = $receipt.Zero; stoppedPids = @($Stopped); code = $receipt.Code;
                unknownProcesses = $(if ($receipt.Zero) { 0 } else { $null }) }
        }
        if ($receipt.Zero) { $exitCode = 0 }
    } catch {
        $code = Scope-Code $_
        try {
            if ($null -ne $script:Outer) {
                Write-Frame $script:Outer @{ v = 1; t = 'owned-result'; code = -1; errorCode = $code }
            }
        } catch { $exitCode = 1 }
        if ($null -ne $script:Native -and $null -ne $script:StatusMemory) { $null = Stop-Children }
    } finally {
        foreach ($channel in $Channels) { $channel.Socket.Dispose() }
        if ($null -ne $script:Listener) { $script:Listener.Dispose() }
        foreach ($pointer in $Buffers) { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
    }
    if ($null -ne $script:Native) { $Native::_exit($exitCode) }
    [Environment]::Exit($exitCode)
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

function nativeSource() {
  return NATIVE_SCRIPT.replaceAll("__UNAVAILABLE__", NATIVE_SCOPE_ERRORS.UNAVAILABLE)
    .replaceAll("__UNCONFIRMED__", NATIVE_SCOPE_ERRORS.UNCONFIRMED)
    .replaceAll("__LIMIT__", NATIVE_SCOPE_ERRORS.LIMIT)
    .replaceAll("__STOP_MESSAGE__", NATIVE_SUPERVISOR_STOP_MESSAGE)
    .replaceAll("__MAX_PROCESSES__", String(NATIVE_SCOPE_MAX_PROCESSES));
}

function powershellArguments(source, invocation) {
  const script = `${source}\n${invocation}`;
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
 * Prepare a compiler-free PowerShell/libc subreaper root around the existing Node supervisor.
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
    args: powershellArguments(nativeSource(), `Invoke-NativeRoot '${config}'`),
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
    && receipt.code == null && Array.isArray(receipt.stoppedPids) && receipt.stoppedPids.length <= NATIVE_SCOPE_MAX_PROCESSES
    && receipt.stoppedPids.every((pid) => Number.isSafeInteger(pid) && pid > 0);
}

async function waitForNativeRootExit(rootPid, rootExit) {
  let timer;
  try {
    const exit = await Promise.race([
      rootExit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED)), CONTROL_TIMEOUT_MS);
      }),
    ]);
    return exit.rootPid === rootPid;
  } finally { clearTimeout(timer); }
}

function ownedRootCertificate(rootPid, rootProcess) {
  const certificate = nativeSupervisorRootExit(rootProcess);
  if (!certificate || certificate.rootPid !== rootPid || certificate.exited) {
    throw unavailable("owned-native-child-handle");
  }
  return certificate;
}

async function terminateScope({ identity, transport, rootExit }) {
  try {
    transport.socket.write('{"v":1,"operation":"terminate"}\n');
    const receipt = await transport.receive();
    if (!hasZeroDescendantReceipt(receipt, identity)) {
      return failedSettlement(identity, receipt?.code === NATIVE_SCOPE_ERRORS.LIMIT
        ? NATIVE_SCOPE_ERRORS.LIMIT : NATIVE_SCOPE_ERRORS.UNCONFIRMED);
    }
    if (!(await waitForNativeRootExit(identity.rootPid, rootExit))) return failedSettlement(identity);
    return {
      ...identity, rootReady: true, stoppedPids: [...new Set([...receipt.stoppedPids, identity.rootPid])],
      settlementConfirmed: true, unknownProcesses: 0,
    };
  } catch { return failedSettlement(identity); }
}

function ownedScope({ identity, transport, rootExit }) {
  let settlement;
  let closing;
  const terminate = () => {
    settlement ??= terminateScope({ identity, transport, rootExit });
    return settlement;
  };
  const close = () => {
    closing ??= (async () => {
      await terminate();
      transport.socket.destroy();
    })();
    return closing;
  };
  return { ...identity, terminate, close };
}

/**
 * Bind the retained native ChildProcess wait to the held root's identity and measured waitpid/ECHILD receipt.
 * @param {{rootPid:number, rootProcess:import("node:child_process").ChildProcess, env?:NodeJS.ProcessEnv}} options
 * @returns {Promise<PosixProcessScope>}
 */
export async function openPosixProcessScope({ rootPid, rootProcess } = {}) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) throw unavailable("positive-root-pid");
  requireLinux();
  const certificate = ownedRootCertificate(rootPid, rootProcess);
  const identity = { rootPid, rootStartedAt: await rootBirth(rootPid) };
  if (certificate.exited) throw unavailable("owned-native-child-handle");
  const transport = scopeTransport(identity);
  try {
    transport.socket.write(`${JSON.stringify({ v: 1, operation: "attach", ...identity })}\n`);
    const hello = await transport.receive();
    if (!matchesIdentity(hello, identity) || hello.subreaper !== true || hello.pidfd !== true)
      throw unavailable("held-subreaper-root");
    if (certificate.exited) throw unavailable("owned-native-child-handle");
    return ownedScope({ identity, transport, rootExit: certificate.exit });
  } catch (error) {
    transport.socket.destroy();
    throw error instanceof ClawError && [NATIVE_SCOPE_ERRORS.UNAVAILABLE, NATIVE_SCOPE_ERRORS.LIMIT].includes(error.code)
      ? error : unavailable("held-subreaper-root");
  }
}
