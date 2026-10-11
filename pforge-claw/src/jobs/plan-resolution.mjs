import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { isInside } from "./worktree.mjs";

export const PLAN_RESOLVE_LIMITS = Object.freeze({ default: 20, max: 50 });
const REQUEST_FIELDS = Object.freeze(["input", "exact", "limit"]);
const INPUT_LENGTH_LIMIT = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f]/;
const RESULT_KINDS = Object.freeze(["exact", "unique", "multiple", "none"]);
const MESSAGE_LENGTH_LIMIT = 2048;

function normalizeInput(input) {
  if (typeof input !== "string" || !input.trim() || input.length > INPUT_LENGTH_LIMIT
    || CONTROL_CHARACTERS.test(input)) throw new ClawError("PLAN_RESOLVE_INVALID");
  const value = input.trim();
  const portable = value.split(path.win32.sep).join(path.posix.sep);
  if (path.posix.isAbsolute(portable) || path.win32.parse(value).root || value.includes(":")
    || portable.split(path.posix.sep).includes("..")) throw new ClawError("PLAN_PATH_ESCAPE");
  return path.posix.normalize(portable);
}

/** Validates the serialized home-read DTO; root and cancellation are never accepted in its body. */
export function parsePlanResolveRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || Object.keys(request).some((key) => !REQUEST_FIELDS.includes(key))) {
    throw new ClawError("PLAN_RESOLVE_INVALID");
  }
  const input = normalizeInput(request.input);
  if (request.exact !== undefined && typeof request.exact !== "boolean") throw new ClawError("PLAN_RESOLVE_INVALID");
  const limit = request.limit ?? PLAN_RESOLVE_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > PLAN_RESOLVE_LIMITS.max) {
    throw new ClawError("PLAN_RESOLVE_INVALID");
  }
  return { input, exact: request.exact ?? false, limit };
}

function validResultPath(candidate) {
  try {
    return typeof candidate === "string" && normalizeInput(candidate) === candidate;
  } catch {
    return false;
  }
}

function validResultCounts(result) {
  const count = result.candidates.length;
  if (!Number.isInteger(result.total) || result.total < count
    || !Number.isInteger(result.limit) || result.limit < 1 || result.limit > PLAN_RESOLVE_LIMITS.max
    || count > result.limit || typeof result.truncated !== "boolean"
    || result.truncated !== (result.total > count)) return false;
  if (result.kind === "none") return result.total === 0;
  if (result.kind === "multiple") return result.total > 1 && count > 0;
  return result.total === 1 && count === 1 && !result.truncated;
}

/** Validates the authenticated response at the adapter boundary without touching dispatcher files. */
export function validatePlanResolution(result) {
  if (!result || !RESULT_KINDS.includes(result.kind) || !Array.isArray(result.candidates)
    || !result.candidates.every(validResultPath) || !validResultCounts(result)
    || typeof result.message !== "string" || !result.message || result.message.length > MESSAGE_LENGTH_LIMIT) {
    throw new ClawError("PLAN_RESOLVE_BAD_RESULT");
  }
  return result;
}

function checkpoint(signal) {
  if (signal !== undefined && typeof signal?.throwIfAborted !== "function") throw new ClawError("PLAN_RESOLVE_INVALID");
  signal?.throwIfAborted();
}

async function canonicalRoot(root, signal) {
  if (typeof root !== "string" || !root) throw new ClawError("PLAN_ROOT_UNAVAILABLE");
  try {
    const canonical = await realpath(root);
    checkpoint(signal);
    const metadata = await stat(canonical);
    checkpoint(signal);
    if (!metadata.isDirectory()) throw new ClawError("PLAN_ROOT_UNAVAILABLE");
    return canonical;
  } catch (error) {
    checkpoint(signal);
    if (error instanceof ClawError) throw error;
    throw new ClawError("PLAN_ROOT_UNAVAILABLE");
  }
}

async function exactCandidate({ root, input, signal }) {
  checkpoint(signal);
  const target = path.resolve(root, ...input.split(path.posix.sep));
  try {
    if (!(await isInside(root, target))) throw new ClawError("PLAN_PATH_ESCAPE");
    checkpoint(signal);
    if (!(await stat(target)).isFile()) return null;
    checkpoint(signal);
    const canonical = await realpath(target);
    checkpoint(signal);
    if (!(await isInside(root, canonical))) throw new ClawError("PLAN_PATH_ESCAPE");
    checkpoint(signal);
    return path.relative(root, canonical).split(path.sep).join(path.posix.sep);
  } catch (error) {
    checkpoint(signal);
    if (error instanceof ClawError) throw error;
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw new ClawError("PLAN_RESOLVE_FAILED");
  }
}

async function matchingCandidates({ root, input, signal }) {
  const directory = path.join(root, "docs", "plans");
  checkpoint(signal);
  if (!(await isInside(root, directory))) throw new ClawError("PLAN_PATH_ESCAPE");
  checkpoint(signal);
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    checkpoint(signal);
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw new ClawError("PLAN_RESOLVE_FAILED");
  }
  checkpoint(signal);
  const query = input.toLowerCase();
  const matches = names.filter((name) => name.toLowerCase().endsWith("-plan.md")
    && name.toLowerCase().includes(query)).sort((left, right) => left.localeCompare(right));
  const candidates = [];
  for (const name of matches) {
    const candidate = await exactCandidate({ root, input: path.posix.join("docs", "plans", name), signal });
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function resolutionReply({ kind, candidates, limit, input }) {
  const total = candidates.length;
  const truncated = total > limit;
  let message = `Resolved ${total} plan${total === 1 ? "" : "s"}.`;
  if (!total) message = `No plan found matching "${input}".`;
  if (kind === "multiple") message = truncated
    ? "More plans match than can be shown; narrow the name or provide an exact repository-relative path."
    : "More than one plan matches; choose a canonical path.";
  return { kind, candidates: candidates.slice(0, limit), total, truncated, limit, message };
}

/** Runs only on the authenticated configured project home, returning canonical relative paths and no file content. */
export async function resolvePlan({ root, input, exact, limit, signal } = {}) {
  checkpoint(signal);
  const request = parsePlanResolveRequest({
    input, ...(exact !== undefined ? { exact } : {}), ...(limit !== undefined ? { limit } : {}),
  });
  const canonical = await canonicalRoot(root, signal);
  const candidate = await exactCandidate({ root: canonical, input: request.input, signal });
  if (candidate) return resolutionReply({ kind: "exact", candidates: [candidate], ...request });
  const candidates = request.exact ? [] : await matchingCandidates({ root: canonical, input: request.input, signal });
  checkpoint(signal);
  const kind = candidates.length === 1 ? "unique" : candidates.length ? "multiple" : "none";
  return resolutionReply({ kind, candidates, ...request });
}
