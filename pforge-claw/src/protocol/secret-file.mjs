import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";

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
  return updateSecretFile({ file, name, value });
}

export function deleteSecret({ file, name }) {
  if (typeof name !== "string" || !name) {
    return Promise.reject(new ClawError("SECRET_WRITE_FAILED", { name }));
  }
  return updateSecretFile({ file, name, remove: true });
}
