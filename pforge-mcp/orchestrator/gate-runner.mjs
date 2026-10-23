import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  getCachedBashPath, setCachedBashPath,
} from "./state.mjs";
import { GATE_ALLOWED_PREFIXES, UNIX_TOOLS, DEFAULT_GATE_TIMEOUT_MS, GATE_MAX_BUFFER, resolveGateCommandToken, isGatePrefixAllowed } from "./constants.mjs";
import { loadGateRunnerMode, runDevcontainerGate } from "./devcontainer-gates.mjs";
import { findMissingTestOperands } from "./gate-operands.mjs";
export { GATE_ALLOWED_PREFIXES, UNIX_TOOLS, DEFAULT_GATE_TIMEOUT_MS };

/**
 * Resolve the gate timeout in milliseconds.
 * Priority: PFORGE_GATE_TIMEOUT_MS env var → default (600 000 ms / 10 min).
 * @returns {number}
 */
export function resolveGateTimeoutMs() {
  const envVal = process.env.PFORGE_GATE_TIMEOUT_MS;
  if (envVal != null && envVal !== "") {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_GATE_TIMEOUT_MS;
}

// ─── Windows bash dispatch ─────────────────────────────────────────────

// cachedBashPath state lives in orchestrator/state.mjs (Phase-53 S1).

/** Reset bash path probe cache — for tests only. */
export function __resetBashPathCache() {
  setCachedBashPath(undefined);
}

/**
 * Locate bash.exe on Windows. Probe order:
 *   1. PFORGE_BASH_PATH env (always re-checked; not cached)
 *   2. Cached result from a previous probe
 *   3. Fixed Git-for-Windows locations
 *   4. `where bash` PATH search
 *
 * @returns {string|null} Absolute path to bash, or null if not found.
 */
export function resolveBashPath() {
  const envPath = (process.env.PFORGE_BASH_PATH || "").trim();
  if (envPath && existsSync(envPath)) return envPath;

  if (getCachedBashPath() !== undefined) return getCachedBashPath();

  const fixed = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  for (const p of fixed) {
    if (existsSync(p)) {
      setCachedBashPath(p);
      return getCachedBashPath();
    }
  }

  try {
    const raw = execFileSync("where", ["bash"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    for (const candidate of raw.split(/\r?\n/)) {
      const line = candidate.trim();
      if (line && existsSync(line)) {
        setCachedBashPath(line);
        return getCachedBashPath();
      }
    }
  } catch {
    // `where` failed or bash not on PATH
  }

  setCachedBashPath(null);
  return null;
}

/**
 * Coalesce multi-line gate commands from a validation gate block.
 * Joins lines inside unmatched quotes into single commands, strips
 * inline comments and standalone comment lines.
 *
 * @param {string} gateText - Raw validation gate text block
 * @returns {string[]} Array of complete, executable gate commands
 */
export function coalesceGateLines(gateText) {
  const rawLines = gateText.split("\n");
  const commands = [];
  let pending = "";
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (pending) {
      pending += "\n" + trimmed;
      const dblQuotes = (pending.match(/"/g) || []).length;
      if (dblQuotes % 2 === 0) {
        commands.push(pending);
        pending = "";
      }
    } else {
      const stripped = trimmed.replace(/\s{2,}#\s.*$/, "");
      if (!stripped || stripped.startsWith("#")) continue;
      // Skip markdown-style numbered list items (e.g. "1. Server generates CSRF...")
      // and bulleted prose (e.g. "- Install dependencies"). These are documentation,
      // not shell commands, and would fail the allowlist check with a misleading error.
      if (/^(\d+\.|[-*+])\s+\S/.test(stripped)) continue;
      if (looksLikeProse(stripped)) continue;
      const dblQuotes = (stripped.match(/"/g) || []).length;
      if (dblQuotes % 2 !== 0) {
        pending = stripped;
      } else {
        commands.push(stripped);
      }
    }
  }
  if (pending) commands.push(pending);
  return commands;
}

/**
 * Compute Levenshtein edit distance between two short strings.
 * Used by runGate() to surface "did you mean X?" suggestions on allowlist misses.
 * Small inputs only (command base tokens) — O(m*n) is fine.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array(cols);
  let curr = new Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[cols - 1];
}

/**
 * Detect obvious template-placeholder tokens in gate commands
 * (e.g. "{{cmd}}", "<CMD>", "$CMD", or literal words like "item"/"command"
 * that typically leak in from plan templates that weren't filled in).
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isPlaceholderToken(token) {
  if (!token) return false;
  if (/^[{<$].+[}>]?$/.test(token)) return true;
  return ["item", "command", "cmd", "tool", "runner", "your-tool", "your_cmd", "todo"].includes(token);
}

/**
 * Suggest the closest allowlisted command to an unrecognized token.
 * Returns null when no reasonable match exists (distance > 2).
 *
 * @param {string} token
 * @returns {string|null}
 */
export function suggestAllowedCommand(token) {
  if (!token) return null;
  let best = null;
  let bestDist = Infinity;
  for (const cmd of GATE_ALLOWED_PREFIXES) {
    const d = editDistance(token, cmd);
    if (d < bestDist) { bestDist = d; best = cmd; }
  }
  return bestDist <= 2 ? best : null;
}

/**
 * Run a validation gate command directly (no AI worker needed).
 * Commands are validated against an allowlist of common build/test tools.
 *
 * Issue #133: pass/fail is strictly determined by the child process's
 * exit code. Stderr content alone never causes a failure (Prisma's
 * "Loaded Prisma config from prisma.config.ts" banner used to false-fail
 * gates that exited 0). Stderr is captured separately so callers can
 * surface it for diagnostics. Opt-in via `failOnStderr` if a gate
 * genuinely needs strict-stderr behaviour.
 *
 * Issue #131: `node -e "<script>"` (and `node -p "<expr>"`) commands are
 * executed via `execFileSync('node', ['-e', script], { shell: false })`
 * so PowerShell never sees the script. Previously, `$transaction` was
 * expanded to "" and `\b`/`\s`/`\d` regex escapes were stripped before
 * node received the argv \u2014 producing false-fail gates with shipped
 * deliverables.
 *
 * @param {string} command - Shell command to run
 * @param {string} cwd - Working directory
 * @param {object} [opts]
 * @param {boolean} [opts.failOnStderr=false] - Issue #133 opt-in: treat
 *   non-empty stderr as failure even when exit code is 0.
 * @param {string} [opts.workdir] - Meta-bug #321: project-relative directory to
 *   run in (a workspace package whose tests need their own cwd); it may not
 *   leave the project. `.forge.json` and the Dev Container stay the project's.
 * @returns {{ success: boolean, output: string, error: string, stderr: string, exitCode: number }}
 */
function _validateGateAllowlist(command) {
  const cmdBase = resolveGateCommandToken(command);
  const isAllowed = isGatePrefixAllowed(cmdBase);
  if (isAllowed) return { cmdBase, blocked: null };
  const hints = [];
  if (isPlaceholderToken(cmdBase)) {
    hints.push(`'${cmdBase}' looks like an unfilled template placeholder \u2014 edit your plan file and replace it with a real build/test command.`);
  }
  const suggestion = suggestAllowedCommand(cmdBase);
  if (suggestion) hints.push(`Did you mean '${suggestion}'?`);
  const hintSuffix = hints.length ? ` ${hints.join(" ")}` : "";
  return {
    cmdBase,
    blocked: {
      success: false,
      output: "",
      stderr: "",
      error: `Validation gate blocked: '${cmdBase}' not in allowlist.${hintSuffix} Allowed: ${GATE_ALLOWED_PREFIXES.join(", ")}`,
      exitCode: -1,
    },
  };
}

function _runInlineNodeGate(command, cwd, gateTimeout, failOnStderr) {
  const m = command.match(/^\s*node\s+(-e|-p|--eval|--print)\s+(.+)$/i);
  if (!m) return null;
  const flag = m[1].startsWith("--") ? m[1] : (m[1] === "-p" ? "--print" : "--eval");
  let script = m[2].trim();
  if ((script.startsWith('"') && script.endsWith('"')) || (script.startsWith("'") && script.endsWith("'"))) {
    script = script.slice(1, -1);
  }
  try {
    const stdoutBuf = execFileSync("node", [flag, script], {
      cwd,
      encoding: "utf-8",
      timeout: gateTimeout,
      maxBuffer: GATE_MAX_BUFFER,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    return { success: true, output: (stdoutBuf || "").trim(), stderr: "", error: "", exitCode: 0 };
  } catch (err) {
    const exitCode = typeof err.status === "number" ? err.status : 1;
    const stderrText = (err.stderr || "").toString();
    const stdoutText = (err.stdout || "").toString();
    if (exitCode === 0 && !failOnStderr) {
      return { success: true, output: stdoutText.trim(), stderr: stderrText.trim(), error: "", exitCode };
    }
    return {
      success: false,
      output: stdoutText.trim(),
      stderr: stderrText.trim(),
      error: stderrText.trim() || err.message || "node -e gate failed",
      exitCode,
    };
  }
}

function _resolveBashArgs(command, isBashWrapped) {
  if (!isBashWrapped) return ["-c", command];
  const m = command.match(/^bash(?:\.exe)?\s+-c\s+(.+)$/i);
  if (!m) return ["-c", command];
  let body = m[1].trim();
  if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'"))) {
    body = body.slice(1, -1);
  }
  return ["-c", body];
}

function _runWindowsBashGate({ command, cwd, cmdBase, gateTimeout, failOnStderr }) {
  if (process.platform !== "win32") return null;
  const cmdName = cmdBase.split("/").pop().split("\\").pop().replace(/\.(exe|cmd|bat)$/i, "");
  const hasShellChain = /(^|[^&|])(\s;\s|\s&&\s|\s\|\|\s)/.test(command);
  const isBashWrapped = cmdName === "bash";
  if (!(UNIX_TOOLS.includes(cmdName) || hasShellChain || isBashWrapped)) return null;

  const bashPath = resolveBashPath();
  if (bashPath === null) {
    return {
      success: false,
      output: "",
      stderr: "",
      error: `gate requires bash but none found on Windows. Install Git for Windows or set PFORGE_BASH_PATH to a bash.exe path. Detected Unix tool: '${cmdName}'.`,
      exitCode: -1,
    };
  }

  const bashArgs = _resolveBashArgs(command, isBashWrapped);
  try {
    const output = execFileSync(bashPath, bashArgs, {
      cwd,
      encoding: "utf-8",
      timeout: gateTimeout,
      maxBuffer: GATE_MAX_BUFFER,
      env: {
        ...process.env,
        NO_COLOR: "1",
        PATH: `${cwd}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return { success: true, output: (output || "").trim(), stderr: "", error: "", exitCode: 0 };
  } catch (err) {
    const exitCode = typeof err.status === "number" ? err.status : 1;
    const stdoutText = (err.stdout || "").toString().trim();
    const stderrText = (err.stderr || err.message || "").toString().trim();
    if (exitCode === 0 && !failOnStderr) {
      return { success: true, output: stdoutText, stderr: stderrText, error: "", exitCode };
    }
    return { success: false, output: stdoutText, stderr: stderrText, error: stderrText, exitCode };
  }
}

function _runDefaultGate(command, cwd, gateTimeout, failOnStderr) {
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: gateTimeout,
      maxBuffer: GATE_MAX_BUFFER,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { success: true, output: (output || "").trim(), stderr: "", error: "", exitCode: 0 };
  } catch (err) {
    const exitCode = typeof err.status === "number" ? err.status : 1;
    const stdoutText = (err.stdout || "").toString().trim();
    const stderrText = (err.stderr || err.message || "").toString().trim();
    if (exitCode === 0 && !failOnStderr) {
      return { success: true, output: stdoutText, stderr: stderrText, error: "", exitCode };
    }
    return { success: false, output: stdoutText, stderr: stderrText, error: stderrText, exitCode };
  }
}

// Vite keys its module graph by path, so a lowercase Windows drive letter makes vitest
// resolve twice and the runner state is undefined at the first describe() (#248). The
// orchestrator inherits a lowercase cwd from the VS Code extension host.
export function normalizeGateCwd(dir) {
  if (typeof dir !== "string") return dir;
  return dir.replace(/^([a-z]):/, (_m, d) => `${d.toUpperCase()}:`);
}

/** Single-quote `text` for a POSIX shell. */
const shellQuote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;

/**
 * Meta-bug #321 — the command as the Dev Container's `sh -c` should run it when
 * the gate belongs in a project subdirectory: `cd 'pkg' && command`. The
 * container exec has no working-directory option of its own.
 *
 * @param {string} command
 * @param {string|null|undefined} workdir - project-relative directory, if any
 * @returns {string}
 */
export function gateCommandInWorkdir(command, workdir) {
  return workdir ? `cd ${shellQuote(workdir)} && ${command}` : command;
}

/**
 * Where a gate runs. `workdir` is a project-relative subdirectory (a workspace
 * package whose tests must run from the package itself); it may not leave the
 * project. `cwd` is null when it does.
 *
 * @returns {{ cwd: string|null, relativeDir: string|null }}
 */
function _gateWorkdir(projectRoot, workdir) {
  if (typeof workdir !== "string" || workdir === "" || workdir === ".") return { cwd: projectRoot, relativeDir: null };
  const cwd = resolve(projectRoot, workdir);
  const within = relative(projectRoot, cwd);
  if (within === "") return { cwd: projectRoot, relativeDir: null };
  if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) return { cwd: null, relativeDir: null };
  return { cwd, relativeDir: within.split(sep).join("/") };
}

function _failedBeforeRunning(error) {
  return { success: false, output: "", stderr: "", error, exitCode: -1 };
}

export function runGate(command, rawCwd, opts = {}) {
  const projectRoot = normalizeGateCwd(rawCwd);
  const workdir = _gateWorkdir(projectRoot, opts.workdir);
  if (!workdir.cwd) return _failedBeforeRunning(`Validation gate blocked: workdir '${opts.workdir}' is outside the project.`);
  const cwd = workdir.cwd;
  const failOnStderr = opts.failOnStderr === true;
  const { cmdBase, blocked } = _validateGateAllowlist(command);
  if (blocked) return blocked;

  // Meta-bug #337: vitest and jest treat file arguments as filters, so a test
  // file the slice never created is silently ignored while a sibling matches.
  const missingTests = findMissingTestOperands(command, cwd);
  if (missingTests.length > 0) {
    return _failedBeforeRunning(
      `Validation gate failed: the test file(s) it names do not exist: ${missingTests.join(", ")}. ` +
      "vitest and jest treat file arguments as filters, so a missing file is silently ignored and the gate would pass without running it. " +
      "Create the file(s), or correct the path.",
    );
  }

  const gateTimeout = resolveGateTimeoutMs();

  // `.forge.json` and the Dev Container belong to the project root, not to a package inside it.
  if (loadGateRunnerMode(projectRoot) === "devcontainer") {
    return runDevcontainerGate({ command: gateCommandInWorkdir(command, workdir.relativeDir), cwd: projectRoot, gateTimeout, failOnStderr });
  }

  const inlineRes = _runInlineNodeGate(command, cwd, gateTimeout, failOnStderr);
  if (inlineRes) return inlineRes;

  const winRes = _runWindowsBashGate({ command: command, cwd: cwd, cmdBase: cmdBase, gateTimeout: gateTimeout, failOnStderr: failOnStderr });
  if (winRes) return winRes;

  return _runDefaultGate(command, cwd, gateTimeout, failOnStderr);
}

/**
 * Detect plan-prose lines that are not executable commands.
 * Conservative — prefers under-matching to avoid false-positives on real commands.
 * @param {string} line - A single gate line
 * @returns {boolean} true if the line looks like documentation prose, not a command
 */
export function looksLikeProse(line) {
  if (!line || typeof line !== "string") return false;
  const trimmed = line.trim();
  if (!trimmed) return false;

  // 1. Numbered-list prose: "1. Server generates..." — decimal + period + space + letter
  if (/^\d+\.\s+[a-zA-Z]/.test(trimmed)) return true;

  // 2. Currency tokens: $10.00, $5 — "$" must be followed by a digit (NOT $PATH, $VAR)
  if (/(?:^|[^A-Za-z_])\$\d/.test(trimmed) || /\\\$\d/.test(trimmed)) return true;

  // 3. Mermaid / diagram keywords at start-of-line
  if (/^(sequenceDiagram|graph\s|flowchart\s|classDiagram|erDiagram|gantt|pie\s)/i.test(trimmed)) return true;

  // 4. Markdown table row
  if (/^\|\s/.test(trimmed)) return true;

  // 5. Formula-like assignment with arithmetic op (distinguishes from env-var NODE_ENV=test)
  if (/^[a-z_]\w*\s*=\s*.*[+\-*/x×]/.test(trimmed)) return true;

  // 6. Box-drawing characters (U+2500–U+257F): lines like ┌──────┐, │ text │, └──────┘
  // These appear in plan files as visual borders and are never valid shell commands.
  // Range: 0x2500 .. 0x257F
  if (/[\u2500-\u257F]/.test(trimmed)) return true;

  return false;
}

