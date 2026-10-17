import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { ClawError } from "../errors.mjs";
import { createNativeSupervisor, hasNativeSettlementProof, NATIVE_SCOPE_ERRORS } from "./native-command-supervisor.mjs";

const SUPERVISOR_PATH = fileURLToPath(new URL("./native-command-supervisor.mjs", import.meta.url));
const SAFE_ERROR = /^[A-Z0-9_]{1,64}$/;

async function scopeAdapter({ env, cwd }) {
  if (process.platform === "win32") {
    const { openWindowsProcessScope } = await import("./windows-process-scope.mjs");
    return { open: (rootPid) => openWindowsProcessScope({ rootPid, env }) };
  }
  if (process.platform === "linux" || process.platform === "darwin") {
    const { nativePosixSupervisorLaunch, openPosixProcessScope } = await import("./posix-process-scope.mjs");
    const launch = await nativePosixSupervisorLaunch({ node: process.execPath, supervisorPath: SUPERVISOR_PATH, cwd, env });
    return { launch, open: (rootPid, rootProcess) => openPosixProcessScope({ rootPid, rootProcess, env }) };
  }
  throw new ClawError(NATIVE_SCOPE_ERRORS.UNAVAILABLE);
}

function interruptionFor({ signal, timeoutMs }) {
  const interrupted = Promise.withResolvers();
  let failure;
  let timer;
  const interrupt = (error) => { failure ??= error; interrupted.resolve(false); };
  const abort = () => interrupt(new ClawError("JOB_CANCELLED"));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => interrupt(new ClawError("COMMAND_TIMEOUT")), timeoutMs);
    timer.unref?.();
  }
  return {
    promise: interrupted.promise, failure: () => failure, interrupt,
    close() { clearTimeout(timer); signal?.removeEventListener("abort", abort); },
  };
}

function collectOutput(supervisor, { maxOutput, appendOutput }) {
  const output = { stdout: "", stderr: "" };
  const collect = (stream, chunk) => {
    const remaining = maxOutput - Buffer.byteLength(output.stdout) - Buffer.byteLength(output.stderr);
    if (remaining > 0) {
      const bounded = new StringDecoder("utf8").write(Buffer.from(chunk).subarray(0, remaining));
      output[stream] = appendOutput(output[stream], bounded, remaining);
    }
  };
  for (const stream of ["stdout", "stderr"]) {
    supervisor.child[stream].setEncoding("utf8");
    supervisor.child[stream].on("data", (chunk) => collect(stream, chunk));
  }
  return output;
}

function unconfirmed(supervisor, code = NATIVE_SCOPE_ERRORS.UNCONFIRMED) {
  return {
    rootPid: supervisor?.child.pid ?? null, rootReady: false, stoppedPids: [],
    settlementConfirmed: false, unknownProcesses: null, code,
  };
}

async function closeUnconfirmedSupervisor(supervisor) {
  if (!supervisor) return;
  // Native initialization may defer signals; the fixed private stop frame reaches its owned-child cleanup.
  await supervisor.stop();
}

async function settleScope({ supervisor, scope }) {
  if (!scope) {
    await closeUnconfirmedSupervisor(supervisor);
    return unconfirmed(supervisor);
  }
  let settlement;
  try {
    settlement = await scope.terminate();
    if (!verifiedSettlement({ supervisor, scope, settlement })) throw new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED);
    if (supervisor) await supervisor.closed;
  } finally {
    await scope.close();
  }
  return settlement;
}

function verifiedSettlement({ supervisor, scope, settlement }) {
  return hasNativeSettlementProof(settlement) && settlement.rootPid === supervisor.child.pid
    && settlement.rootStartedAt === scope.rootStartedAt;
}

function requireUninterrupted(interruption) {
  if (interruption.failure()) throw interruption.failure();
}

async function executeInScope({ command, args, options, state }) {
  const { cwd, env, maxOutput, appendOutput, onRootReady } = options;
  requireUninterrupted(state.interruption);
  const adapter = await scopeAdapter({ env, cwd });
  requireUninterrupted(state.interruption);
  const supervisor = createNativeSupervisor({ cwd, env, launch: adapter.launch });
  state.supervisor = supervisor;
  state.output = collectOutput(supervisor, { maxOutput, appendOutput });
  const ready = await Promise.race([supervisor.ready, state.interruption.promise]);
  if (!ready) throw state.interruption.failure() ?? new ClawError(NATIVE_SCOPE_ERRORS.UNAVAILABLE);
  const scope = await adapter.open(supervisor.child.pid, supervisor.child);
  state.scope = scope;
  if (scope.rootPid !== supervisor.child.pid || typeof scope.rootStartedAt !== "string") {
    throw new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED);
  }
  requireUninterrupted(state.interruption);
  await Promise.race([
    Promise.resolve(onRootReady?.({ rootPid: scope.rootPid, rootStartedAt: scope.rootStartedAt, rootReady: true })),
    state.interruption.promise,
  ]);
  requireUninterrupted(state.interruption);
  supervisor.start(command, args);
  state.completed = await Promise.race([supervisor.completion, state.interruption.promise]);
  if (!state.completed) throw state.interruption.failure() ?? new ClawError("COMMAND_FAILED");
}

function nativeError(error) {
  return error instanceof ClawError ? error : new ClawError(NATIVE_SCOPE_ERRORS.UNAVAILABLE);
}

function ownedResult(state, settlement) {
  let executionError = state.interruption.failure();
  if (!executionError && state.completed?.errorCode) executionError = new ClawError(
    SAFE_ERROR.test(state.completed.errorCode) ? state.completed.errorCode : "COMMAND_FAILED",
  );
  const error = executionError ?? state.cleanupFailure;
  return {
    code: executionError ? -1 : state.completed?.code ?? -1,
    ...state.output, ...(error ? { error } : {}),
    settlementConfirmed: settlement.settlementConfirmed, settlement,
  };
}

function validateCommand(command, args) {
  if (typeof command !== "string" || !command || command.includes("\0")
    || !Array.isArray(args) || args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    throw new ClawError("COMMAND_INVALID");
  }
}

/** Execute literal argv only after native ownership; zero live owned members, not global snapshots, supplies proof. */
export async function runOwnedProcess(command, args, options) {
  const normalized = { ...options };
  if (normalized.env === undefined) normalized.env = process.env;
  const state = {
    interruption: interruptionFor(normalized),
    output: { stdout: "", stderr: "" }, supervisor: null, scope: null, completed: null, cleanupFailure: null,
  };
  let settlement;
  try {
    validateCommand(command, args);
    if (!Number.isSafeInteger(normalized.maxOutput) || normalized.maxOutput < 0
      || typeof normalized.appendOutput !== "function"
      || (normalized.onRootReady !== undefined && typeof normalized.onRootReady !== "function")) {
      throw new ClawError("COMMAND_INVALID");
    }
    await executeInScope({ command, args, options: normalized, state });
  } catch (error) {
    state.interruption.interrupt(nativeError(error));
  }
  try {
    settlement = await settleScope(state);
  } catch (error) {
    state.cleanupFailure = nativeError(error);
    await closeUnconfirmedSupervisor(state.supervisor);
    settlement = unconfirmed(state.supervisor);
  } finally {
    state.interruption.close();
  }
  return ownedResult(state, settlement);
}
