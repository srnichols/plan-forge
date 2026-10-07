import { execFile } from "node:child_process";
import { readFile, stat as statFile } from "node:fs/promises";
import { promisify } from "node:util";
import { ClawError } from "./errors.mjs";

const execFileAsync = promisify(execFile);
export const TOKEN_SHAPES = Object.freeze([
  ["github-token", /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ["telegram-token", /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g],
  ["api-key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
]);

function trackName(name) {
  return typeof name === "string" ? name : name?.name;
}

export async function createSecrets({ env = process.env, file, trackNames = [] } = {}) {
  let fileValues = {};
  if (file) {
    try {
      fileValues = JSON.parse(await readFile(file, "utf8"));
      if (fileValues === null || typeof fileValues !== "object" || Array.isArray(fileValues)) {
        throw new ClawError("SECRETS_PARSE", { file });
      }
    } catch (error) {
      if (error instanceof ClawError) throw error;
      if (error.code === "ENOENT") fileValues = {};
      else throw new ClawError("SECRETS_PARSE", { file });
    }
  }
  for (const [name, value] of Object.entries(fileValues)) {
    if (typeof value !== "string") throw new ClawError("SECRETS_INVALID_TYPE", { name });
  }
  const names = new Set([...Object.keys(fileValues), ...trackNames.map(trackName).filter(Boolean)]);
  const values = () => [...names].flatMap((name) => {
    const value = Object.hasOwn(env, name) && env[name] !== undefined ? env[name] : fileValues[name];
    return typeof value === "string" && value.length > 0 ? [[name, value]] : [];
  });
  const get = (name) => {
    const value = Object.hasOwn(env, name) && env[name] !== undefined ? env[name] : fileValues[name];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const redact = (text) => {
    let result = String(text);
    const replacements = values().sort((left, right) => right[1].length - left[1].length);
    for (const [name, value] of replacements) result = result.split(value).join(`«redacted:${name}»`);
    for (const [shape, pattern] of TOKEN_SHAPES) result = result.replace(pattern, `«redacted:${shape}»`);
    return result;
  };
  return {
    get,
    getSecret: get,
    has: (name) => get(name) !== null,
    redact,
    names: [...names],
  };
}

export async function checkSecretsFilePermissions(
  file,
  { platform = process.platform, stat, runIcacls } = {},
) {
  if (platform === "win32") {
    const executeIcacls = runIcacls ?? (async (target) => {
      const output = await execFileAsync("icacls", [target], { timeout: 5000, windowsHide: true });
      return `${output.stdout}\n${output.stderr}`;
    });
    let output;
    try {
      output = await executeIcacls(file);
    } catch {
      return { status: "warn", code: "SECRETS_ACL_UNVERIFIED", message: "Secrets-file access could not be verified.", hint: "Restrict the file to the current user." };
    }
    const broadAccess = /\*S-1-1-0|\bEveryone\b|\*S-1-5-32-545|BUILTIN\\Users|\*S-1-5-11|Authenticated Users/i;
    if (broadAccess.test(String(output))) {
      return { status: "warn", code: "SECRETS_ACL_BROAD", message: "Secrets file grants access to a broad Windows group.", hint: "Restrict the file ACL to the current user." };
    }
    return { status: "ok", code: "SECRETS_ACL_RESTRICTED", message: "Secrets-file access appears restricted.", hint: "" };
  }
  const getStat = stat ?? statFile;
  try {
    const metadata = await getStat(file);
    if ((metadata.mode & 0o077) !== 0) {
      return { status: "warn", code: "SECRETS_WORLD_READABLE", message: "Secrets file permissions allow group or other access.", hint: `chmod 600 ${file}` };
    }
    return { status: "ok", code: "SECRETS_PERMISSIONS_RESTRICTED", message: "Secrets-file permissions are restricted.", hint: "" };
  } catch (error) {
    return { status: "skip", code: error.code === "ENOENT" ? "SECRETS_FILE_MISSING" : "SECRETS_PERMISSIONS_UNVERIFIED", message: "Secrets-file permissions could not be checked.", hint: "" };
  }
}
