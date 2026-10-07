import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";
import { ClawError } from "../errors.mjs";

export const STREAM_RE = /^[a-z][a-z0-9-]{0,63}$/;
export const STALE_LOCK_GRACE_MS = 5000;
const LOCK_RETRIES = 3;

function deepRedact(value, redact, seen = new WeakMap()) {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, child] of Object.entries(value)) copy[key] = deepRedact(child, redact, seen);
  return copy;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeRecord(record, redact, now) {
  if (!isPlainObject(record)) throw new ClawError("STORE_BAD_RECORD");
  let json;
  try {
    json = JSON.stringify(deepRedact({ ...record, v: record.v ?? 1, ts: now().toISOString() }, redact));
  } catch {
    throw new ClawError("STORE_BAD_RECORD");
  }
  const line = redact(json);
  try {
    return { line, record: JSON.parse(line) };
  } catch {
    throw new ClawError("STORE_REDACT_INVALID");
  }
}

function hasTornTail(file) {
  if (!existsSync(file)) return false;
  const size = statSync(file).size;
  if (size === 0) return false;
  const descriptor = openSync(file, "r");
  try {
    const lastByte = Buffer.alloc(1);
    readSync(descriptor, lastByte, 0, 1, size - 1);
    return lastByte[0] !== 0x0a;
  } finally {
    closeSync(descriptor);
  }
}

function parseLine({ bytes, stream, lineNumber, end, terminated }) {
  if (bytes.length === 0) return null;
  try {
    return { record: JSON.parse(bytes.toString("utf8")), end };
  } catch {
    if (!terminated) return null;
    throw new ClawError("STORE_CORRUPT", { stream, line: lineNumber });
  }
}

function* parseLines({ bytes, stream, fromByte }) {
  let cursor = fromByte;
  let lineNumber = 1;
  for (let index = 0; index < fromByte; index += 1) {
    if (bytes[index] === 0x0a) lineNumber += 1;
  }
  while (cursor < bytes.length) {
    const newline = bytes.indexOf(0x0a, cursor);
    if (newline === -1) {
      const parsed = parseLine({
        bytes: bytes.subarray(cursor),
        stream,
        lineNumber,
        end: bytes.length,
        terminated: false,
      });
      if (parsed) yield parsed;
      return;
    }
    const parsed = parseLine({
      bytes: bytes.subarray(cursor, newline),
      stream,
      lineNumber,
      end: newline + 1,
      terminated: true,
    });
    if (parsed) yield parsed;
    cursor = newline + 1;
    lineNumber += 1;
  }
}

function removeLock(file) {
  try {
    unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function classifyHolder({ file, now, kill }) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return "retry";
    if (error.code) throw new ClawError("STATE_LOCKED", { pid: null });
    lock = null;
  }
  if (!Number.isInteger(lock?.pid) || lock.pid <= 0) {
    let age;
    try {
      age = now().getTime() - statSync(file).mtimeMs;
    } catch (error) {
      if (error.code === "ENOENT") return "retry";
      throw new ClawError("STATE_LOCKED", { pid: null });
    }
    if (age < STALE_LOCK_GRACE_MS) throw new ClawError("STATE_LOCKED", { pid: null });
    removeLock(file);
    return "retry";
  }
  try {
    kill(lock.pid, 0);
    throw new ClawError("STATE_LOCKED", { pid: lock.pid });
  } catch (error) {
    if (error instanceof ClawError) throw error;
    if (error.code === "ESRCH") {
      removeLock(file);
      return "retry";
    }
    throw new ClawError("STATE_LOCKED", { pid: lock.pid });
  }
}

function tryAcquire(file, pid, now) {
  try {
    writeFileSync(file, JSON.stringify({ pid, ts: now().toISOString() }), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

export function createStore(dir, {
  redact = (text) => text,
  now = () => new Date(),
  pid = process.pid,
  kill = (processId, signal) => process.kill(processId, signal),
} = {}) {
  let counter = 0;
  const directory = dir;
  mkdirSync(directory, { recursive: true });
  const streamPath = (stream) => {
    if (typeof stream !== "string" || !STREAM_RE.test(stream)) {
      throw new ClawError("STORE_BAD_STREAM");
    }
    return join(directory, `${stream}.jsonl`);
  };
  const readJson = (name, fallback) => {
    try {
      return JSON.parse(readFileSync(join(directory, name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  };
  const writeJsonAtomic = (name, value) => {
    if (name !== basename(name)) throw new ClawError("STORE_WRITE_FAILED", { name });
    const target = join(directory, name);
    const temporary = `${target}.${pid}.${counter++}.tmp`;
    let descriptor;
    try {
      descriptor = openSync(temporary, "wx");
      writeSync(descriptor, JSON.stringify(value));
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      try {
        renameSync(temporary, target);
      } catch (error) {
        if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
        renameSync(temporary, target);
      }
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        unlinkSync(temporary);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") throw new ClawError("STORE_WRITE_FAILED", { name });
      }
      throw new ClawError("STORE_WRITE_FAILED", { name });
    }
  };
  const read = function* readStream(stream, { fromByte = 0 } = {}) {
    const file = streamPath(stream);
    let contents;
    try {
      contents = readFileSync(file);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    yield* parseLines({ bytes: contents, stream, fromByte, });
  };
  const foldFrom = (stream, reducer, initial, fromByte) => {
    let state = initial;
    let offset = fromByte;
    let count = 0;
    for (const { record, end } of read(stream, { fromByte })) {
      state = reducer(state, record);
      offset = end;
      count += 1;
    }
    return { state, offset, count };
  };
  const loadSnapshot = (stream) => readJson(`${stream}.snapshot.json`, null);
  const isSnapshotValid = (snapshot, stream, size, file) => {
    if (!snapshot || snapshot.v !== 1 || snapshot.stream !== stream) return false;
    if (!Number.isInteger(snapshot.offset) || snapshot.offset < 0 || snapshot.offset > size) return false;
    if (snapshot.offset === 0) return true;
    const descriptor = openSync(file, "r");
    try {
      const previousByte = Buffer.alloc(1);
      readSync(descriptor, previousByte, 0, 1, snapshot.offset - 1);
      return previousByte[0] === 0x0a;
    } finally {
      closeSync(descriptor);
    }
  };
  const fold = (stream, reducer, initial) => {
    const file = streamPath(stream);
    const snapshot = loadSnapshot(stream);
    let size = 0;
    try {
      size = statSync(file).size;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const useSnapshot = isSnapshotValid(snapshot, stream, size, file);
    const accumulator = useSnapshot ? structuredClone(snapshot.state) : initial;
    return foldFrom(stream, reducer, accumulator, useSnapshot ? snapshot.offset : 0).state;
  };
  const snapshot = (stream, reducer, initial) => {
    const result = foldFrom(stream, reducer, initial, 0);
    writeJsonAtomic(`${stream}.snapshot.json`, {
      v: 1,
      stream,
      offset: result.offset,
      count: result.count,
      state: result.state,
      ts: now().toISOString(),
    });
    return { offset: result.offset, count: result.count };
  };
  const lock = () => {
    const file = join(directory, "dispatcher.lock");
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      if (tryAcquire(file, pid, now)) {
        return () => {
          let contents;
          try {
            contents = JSON.parse(readFileSync(file, "utf8"));
          } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
          }
          if (contents.pid === pid) removeLock(file);
        };
      }
      if (classifyHolder({ file, now, kill }) !== "retry") break;
    }
    throw new ClawError("STATE_LOCKED");
  };
  return { append: (stream, record) => {
    const file = streamPath(stream);
    const { line, record: stored } = serializeRecord(record, redact, now);
    const prefix = hasTornTail(file) ? "\n" : "";
    appendFileSync(file, `${prefix}${line}\n`);
    return stored;
  }, read, fold, snapshot, writeJsonAtomic, readJson, lock };
}
