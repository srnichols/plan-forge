import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClawError } from "../errors.mjs";

export const NATIVE_SUPERVISOR_ARGUMENT = "--pforge-command-supervisor";
export const NATIVE_SCOPE_MAX_PROCESSES = 256;
export const NATIVE_SCOPE_ERRORS = Object.freeze({
  UNAVAILABLE: "PLAN_PROCESS_NATIVE_UNAVAILABLE",
  UNCONFIRMED: "PLAN_PROCESS_SCOPE_UNCONFIRMED",
  LIMIT: "PLAN_PROCESS_TREE_LIMIT",
});
const MESSAGES = Object.freeze({ READY: "owned-ready", START: "owned-start", RESULT: "owned-result" });
const BOOTSTRAP_ENVIRONMENT_FIELDS = Object.freeze([
  "NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE", "NODE_DEBUG", "NODE_DEBUG_NATIVE",
  "PSModulePath", "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS", "DOTNET_SHARED_STORE",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
]);
const ENVIRONMENT_PREFIX = "PFORGE_CLAW_NATIVE_BOOTSTRAP_";
const SAFE_ERROR = /^[A-Z0-9_]{1,64}$/;

function nativeRootIdentity(scope) {
  return Number.isSafeInteger(scope.rootPid) && scope.rootPid > 0
    && typeof scope.rootStartedAt === "string" && scope.rootStartedAt.length > 0;
}

function stoppedNativeMembers(scope) {
  return Array.isArray(scope.stoppedPids) && scope.stoppedPids.length <= NATIVE_SCOPE_MAX_PROCESSES
    && scope.stoppedPids.every((pid) => Number.isSafeInteger(pid) && pid > 0)
    && scope.stoppedPids.includes(scope.rootPid);
}

/** Validate native zero-member evidence before it can be credited by execution or preflight. */
export function hasNativeSettlementProof(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return false;
  if (scope.rootReady !== true || scope.settlementConfirmed !== true || scope.unknownProcesses !== 0) return false;
  if (scope.code !== undefined) return false;
  return nativeRootIdentity(scope) && stoppedNativeMembers(scope);
}

function supervisorEnvironment(env) {
  const prepared = { ...env };
  if (Object.keys(prepared).some((name) => (process.platform === "win32" ? name.toUpperCase() : name)
    .startsWith(ENVIRONMENT_PREFIX))) throw new ClawError("COMMAND_ENV_INVALID");
  for (const field of BOOTSTRAP_ENVIRONMENT_FIELDS) {
    const names = Object.keys(prepared).filter((name) => process.platform === "win32"
      ? name.toUpperCase() === field.toUpperCase() : name === field);
    if (names.length > 1) throw new ClawError("COMMAND_ENV_INVALID");
    if (!names.length) continue;
    prepared[`${ENVIRONMENT_PREFIX}${field}`] = prepared[names[0]];
    prepared[`${ENVIRONMENT_PREFIX}${field}_NAME`] = names[0];
    delete prepared[names[0]];
  }
  return prepared;
}

function actorEnvironment() {
  const prepared = { ...process.env };
  for (const field of BOOTSTRAP_ENVIRONMENT_FIELDS) {
    const value = `${ENVIRONMENT_PREFIX}${field}`;
    const name = `${value}_NAME`;
    if (Object.hasOwn(prepared, name)) prepared[prepared[name]] = prepared[value];
    delete prepared[value];
    delete prepared[name];
  }
  return prepared;
}

/** Create a held, private-IPC root. The owner must establish native containment before start. */
export function createNativeSupervisor({ cwd, env = process.env, launch } = {}) {
  const ready = Promise.withResolvers();
  const completion = Promise.withResolvers();
  const closed = Promise.withResolvers();
  const child = spawn(launch?.command ?? process.execPath, launch?.args ?? [
    fileURLToPath(import.meta.url), NATIVE_SUPERVISOR_ARGUMENT,
  ], {
    cwd, env: supervisorEnvironment(env), shell: false, windowsHide: true,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let started = false;
  child.on("message", (frame) => {
    if (frame?.v !== 1) return;
    if (frame.t === MESSAGES.READY && frame.pid === child.pid) ready.resolve(true);
    if (frame.t === MESSAGES.RESULT && Number.isInteger(frame.code)) {
      completion.resolve({
        code: frame.code,
        ...(SAFE_ERROR.test(frame.errorCode ?? "") ? { errorCode: frame.errorCode } : {}),
      });
    }
  });
  child.once("error", (error) => {
    ready.resolve(false);
    completion.resolve({ code: -1, errorCode: SAFE_ERROR.test(error.code ?? "") ? error.code : "COMMAND_FAILED" });
  });
  child.once("close", () => {
    ready.resolve(false);
    completion.resolve({ code: -1, errorCode: "COMMAND_FAILED" });
    closed.resolve();
  });
  return {
    child, ready: ready.promise, completion: completion.promise, closed: closed.promise,
    start(command, args) {
      if (started || !child.connected) throw new ClawError("COMMAND_FAILED");
      if (typeof command !== "string" || !command || command.includes("\0")
        || !Array.isArray(args) || args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
        throw new ClawError("COMMAND_INVALID");
      }
      started = true;
      child.send({ v: 1, t: MESSAGES.START, command, args }, (error) => {
        if (error) completion.resolve({ code: -1, errorCode: "COMMAND_FAILED" });
      });
    },
  };
}

function executeFrame(frame) {
  let child;
  try {
    if (typeof frame.command !== "string" || !frame.command || frame.command.includes("\0")
      || !Array.isArray(frame.args) || frame.args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
      throw new ClawError("COMMAND_INVALID");
    }
    child = spawn(frame.command, frame.args, {
      cwd: process.cwd(), env: actorEnvironment(), shell: false, windowsHide: true, stdio: "inherit",
    });
  } catch {
    process.send?.({ v: 1, t: MESSAGES.RESULT, code: -1, errorCode: "COMMAND_INVALID" });
    return;
  }
  let errorCode;
  child.once("error", (error) => { errorCode = SAFE_ERROR.test(error.code ?? "") ? error.code : "COMMAND_FAILED"; });
  child.once("close", (code) => process.send?.({
    v: 1, t: MESSAGES.RESULT, code: errorCode ? -1 : code ?? -1, ...(errorCode ? { errorCode } : {}),
  }));
}

function supervise() {
  let started = false;
  process.on("message", (frame) => {
    if (started || frame?.v !== 1 || frame.t !== MESSAGES.START) return;
    started = true;
    executeFrame(frame);
  });
  process.send?.({ v: 1, t: MESSAGES.READY, pid: process.pid });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  && process.argv[2] === NATIVE_SUPERVISOR_ARGUMENT && typeof process.send === "function") supervise();
