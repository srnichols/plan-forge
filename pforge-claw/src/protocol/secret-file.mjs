import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";

const fileUpdates = new Map();

async function updateSecretFile({ file, name, value, remove = false }) {
  let contents = {};
  try {
    contents = JSON.parse(await readFile(file, "utf8"));
    if (!contents || typeof contents !== "object" || Array.isArray(contents)) throw new Error();
  } catch (error) {
    if (error.code !== "ENOENT") throw new ClawError("SECRET_WRITE_FAILED", { name });
  }
  if (remove) delete contents[name];
  else contents[name] = value;
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, JSON.stringify(contents, null, 2), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } catch {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") throw new ClawError("SECRET_WRITE_FAILED", { name });
    }
    throw new ClawError("SECRET_WRITE_FAILED", { name });
  }
}

export function writeSecret({ file, name, value }) {
  if (typeof name !== "string" || !name || typeof value !== "string" || !value) {
    return Promise.reject(new ClawError("SECRET_WRITE_FAILED", { name }));
  }
  return queueSecretUpdate({ file, name, value });
}

export function deleteSecret({ file, name }) {
  if (typeof name !== "string" || !name) {
    return Promise.reject(new ClawError("SECRET_WRITE_FAILED", { name }));
  }
  return queueSecretUpdate({ file, name, remove: true });
}

async function queueSecretUpdate(options) {
  if (typeof options.file !== "string" || !options.file) throw new ClawError("SECRET_WRITE_FAILED", { name: options.name });
  const resolved = path.resolve(options.file);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const previous = fileUpdates.get(key) ?? Promise.resolve();
  const update = () => updateSecretFile({ ...options, file: resolved });
  const pending = previous.then(update, update);
  fileUpdates.set(key, pending);
  try {
    return await pending;
  } finally {
    if (fileUpdates.get(key) === pending) fileUpdates.delete(key);
  }
}
