/**
 * Plan Forge — gate tool preflight and unrunnable-gate classification.
 *
 * A validation gate that needs a tool the machine lacks (`cargo`, `pnpm`,
 * `dotnet`) can never pass. Before: the run spent every earlier slice, then the
 * failing slice's retries, before reporting "validation gate failed".
 *
 *   - preflightGates: at run start, resolve each gate's executables on PATH
 *     (and node_modules/.bin) and report the missing ones.
 *   - classifyUnrunnableGate: when a gate fails because its command was not
 *     found, say so — a worker retry cannot install a system tool.
 *
 * Config: `.forge.json` → `gatePreflight`: "warn" (default) | "block" | "off".
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { coalesceGateLines, resolveBashPath, UNIX_TOOLS } from "./gate-runner.mjs";

const PREFLIGHT_MODES = Object.freeze(["warn", "block", "off"]);
const DEFAULT_MODE = "warn";
const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const EXECUTABLE_SUFFIX = /\.(exe|cmd|bat|com)$/i;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;
/** A bare program name; anything else (script fragments, stray quotes) is not a command to look up. */
const PROGRAM_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const SEGMENT_SEPARATOR = /&&|\|\||;|\|/;

const SHELL_BUILTINS = new Set([
  "cd", "echo", "test", "[", "[[", "exit", "true", "false", "set", "export", "printf", "pushd", "popd",
  "source", ".", "eval", "exec", "if", "then", "else", "elif", "fi", "for", "do", "done", "while", "until",
  "case", "esac", "read", "shift", "return", "unset", "alias", "type", "command", ":", "!", "{", "}", "(", ")", "time",
]);
/** Runners that resolve or download the tool themselves. */
const SELF_RESOLVING_RUNNERS = new Set(["npx", "bunx"]);

/** First word of `segment` after env assignments (and an `env` prefix). */
function programOf(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i])) i++;
  if (tokens[i] === "env") {
    i++;
    while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i])) i++;
  }
  return tokens[i] ?? null;
}

function isCheckableProgram(program) {
  if (!program || SHELL_BUILTINS.has(program) || SELF_RESOLVING_RUNNERS.has(program)) return false;
  return PROGRAM_NAME.test(program);
}

/**
 * The executables a gate line needs, in order, without duplicates. Quoted text
 * is ignored, so commands inside `bash -c "…"` or `echo "…"` are not checked.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function gateCommandTools(line) {
  const tools = [];
  for (const segment of String(line || "").replace(QUOTED, "").split(SEGMENT_SEPARATOR)) {
    const program = programOf(segment);
    if (!isCheckableProgram(program)) continue;
    const tool = program.replace(EXECUTABLE_SUFFIX, "");
    if (!tools.includes(tool)) tools.push(tool);
  }
  return tools;
}

function searchDirs({ cwd, env, platform }) {
  const separator = platform === "win32" ? ";" : ":";
  return [join(cwd, "node_modules", ".bin"), ...String(env.PATH ?? env.Path ?? "").split(separator).filter(Boolean)];
}

function executableNames(tool, { env, platform }) {
  if (platform !== "win32") return [tool];
  const exts = String(env.PATHEXT || WINDOWS_DEFAULT_PATHEXT).split(";").filter(Boolean);
  return [tool, ...exts.map((ext) => tool + ext.toLowerCase()), ...exts.map((ext) => tool + ext)];
}

function isToolAvailable(tool, ctx) {
  // On Windows, runGate sends Unix tools through Git Bash, which supplies them.
  if (ctx.platform === "win32" && UNIX_TOOLS.includes(tool) && resolveBashPath() !== null) return true;
  const names = executableNames(tool, ctx);
  return searchDirs(ctx).some((dir) => names.some((name) => ctx.exists(join(dir, name))));
}

/**
 * @param {object} opts
 * @param {{ slices: { number: string|number, validationGate?: string }[] }} opts.plan
 * @param {string} opts.cwd
 * @param {object} [opts.env]
 * @param {string} [opts.platform]
 * @param {(path: string) => boolean} [opts.exists]
 * @returns {{ checked: number, missing: { slice: string, command: string, tool: string }[] }}
 */
export function preflightGates({ plan, cwd, env = process.env, platform = process.platform, exists = existsSync }) {
  const ctx = { cwd, env, platform, exists };
  const missing = [];
  let checked = 0;
  for (const slice of plan.slices ?? []) {
    if (!slice.validationGate) continue;
    checked++;
    const reported = new Set();
    for (const command of coalesceGateLines(slice.validationGate)) {
      for (const tool of gateCommandTools(command)) {
        if (reported.has(tool) || isToolAvailable(tool, ctx)) continue;
        reported.add(tool);
        missing.push({ slice: String(slice.number), command, tool });
      }
    }
  }
  return { checked, missing };
}

const NOT_FOUND_PATTERNS = Object.freeze([
  /([^\s:'"]+): command not found/,
  /\b\d+: ([^\s:'"]+): not found/,
  /'([^']+)' is not recognized as an internal or external command/i,
  /The term '([^']+)' is not recognized as (?:the )?name of a cmdlet/i,
]);

/**
 * When a gate failed because its command does not exist, name the tool. A
 * missing project script (a path) is left to the retry: the worker may create it.
 *
 * @param {{ success?: boolean, output?: string, stderr?: string, error?: string }|null} gateResult
 * @returns {{ tool: string, reason: string }|null}
 */
export function classifyUnrunnableGate(gateResult) {
  if (!gateResult || gateResult.success) return null;
  const text = [gateResult.error, gateResult.stderr, gateResult.output].filter(Boolean).join("\n");
  for (const pattern of NOT_FOUND_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const program = match[1];
    if (!isCheckableProgram(program)) return null;
    const tool = program.replace(EXECUTABLE_SUFFIX, "");
    return {
      tool,
      reason: `gate command '${tool}' is not installed or not on PATH — a retry cannot fix that. Install it, or change the gate.`,
    };
  }
  return null;
}

/**
 * @param {string} cwd
 * @returns {"warn"|"block"|"off"}
 */
export function loadGatePreflightMode(cwd) {
  try {
    const path = resolve(cwd, ".forge.json");
    if (!existsSync(path)) return DEFAULT_MODE;
    const mode = JSON.parse(readFileSync(path, "utf8")).gatePreflight;
    return PREFLIGHT_MODES.includes(mode) ? mode : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}
