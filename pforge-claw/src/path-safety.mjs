import { realpath } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "./errors.mjs";

/**
 * @param {string} inputPath
 * @returns {Promise<string>}
 */
export async function realpathNearest(inputPath) {
  let candidate = path.resolve(inputPath);
  const missing = [];
  while (true) {
    try {
      const resolved = await realpath(candidate);
      return path.join(resolved, ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * @param {string} root
 * @param {string} target
 * @returns {Promise<boolean>}
 */
export async function isInside(root, target) {
  const pathApi = process.platform === "win32" ? path.win32 : path;
  const resolvedRoot = await realpathNearest(root);
  const resolvedTarget = await realpathNearest(target);
  const relative = pathApi.relative(resolvedRoot, resolvedTarget);
  const normalized = process.platform === "win32" ? relative.toLowerCase() : relative;
  return normalized === "" || (!normalized.startsWith(`..${pathApi.sep}`)
    && normalized !== ".." && !pathApi.isAbsolute(relative));
}

/**
 * @param {string} root
 * @param {string} target
 * @param {string} [code]
 * @returns {Promise<string>}
 */
export async function assertInside(root, target, code = "PATH_OUTSIDE_ROOT") {
  if (!(await isInside(root, target))) throw new ClawError(code);
  return target;
}
