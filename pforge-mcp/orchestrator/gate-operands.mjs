/** Plan Forge — meta-bug #337: a gate that names test files must find them */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** `vitest`, `jest`, or a path to either: `node_modules/vitest/vitest.mjs`, `node_modules/.bin/jest`. */
const RUNNER_TOKEN_RE = /^(?:.*[\\/])?(?:vitest|jest)(?:\.m?js)?$/i;
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
/** Anything that is a pattern or shell syntax rather than one literal path. */
const NOT_A_LITERAL_PATH_RE = /[*?[\]{}$`()<>|&;]/;
/** Flags whose next token is a value, never a file operand (`-t "parses a.test.mjs"`). */
const VALUE_FLAGS = new Set(["-t", "--testNamePattern", "-c", "--config", "--reporter", "--outputFile", "--exclude", "--project", "--shard"]);
/** Flags that move the runner's root: relative operands then mean something other than "relative to the gate's cwd". */
const ROOT_FLAGS = new Set(["-r", "--root", "--dir"]);

const tokenize = (command) => [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);

/** Test-file operands after the runner token, skipping flags and their values. */
function testOperandsAfterRunner(tokens, runnerAt) {
  const operands = [];
  for (let i = runnerAt + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (VALUE_FLAGS.has(token)) {
      i++;
    } else if (!token.startsWith("-") && TEST_FILE_RE.test(token) && !NOT_A_LITERAL_PATH_RE.test(token)) {
      operands.push(token);
    }
  }
  return operands;
}

/**
 * Meta-bug #337 — the test files a gate names that do not exist.
 *
 * vitest and jest treat positional arguments as filters, so a missing file is
 * silently ignored as long as another operand matches. A Phase-62 gate named
 * `tests/placement.test.mjs` and `tests/k8s-manifests.test.mjs`, passed with
 * "1 file, 20 tests", and the first file had never been created.
 *
 * Only literal test-file paths are checked. Globs, substring filters and
 * anything after a flag that moves the runner's root are left alone, so a gate
 * is never failed over an operand that was not a path to begin with.
 *
 * @param {string} command - one gate command line
 * @param {string} cwd - directory the gate runs in
 * @returns {string[]} operands exactly as written, each once
 */
export function findMissingTestOperands(command, cwd) {
  const tokens = tokenize(String(command ?? ""));
  const runnerAt = tokens.findIndex((token) => RUNNER_TOKEN_RE.test(token));
  if (runnerAt < 0 || tokens.some((token) => ROOT_FLAGS.has(token))) return [];
  const missing = [];
  for (const operand of testOperandsAfterRunner(tokens, runnerAt)) {
    const path = isAbsolute(operand) ? operand : resolve(cwd, operand);
    if (!existsSync(path) && !missing.includes(operand)) missing.push(operand);
  }
  return missing;
}
