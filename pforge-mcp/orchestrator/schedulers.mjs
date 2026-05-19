/** Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) S3: schedulers sub-module */

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { buildReflexionBlock } from "../memory.mjs";
import {
  getCachedBashPath, setCachedBashPath,
} from "./state.mjs";
import { GATE_ALLOWED_PREFIXES, UNIX_TOOLS, DEFAULT_GATE_TIMEOUT_MS } from "./constants.mjs";
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
 * @returns {{ success: boolean, output: string, error: string, stderr: string, exitCode: number }}
 */
function _validateGateAllowlist(command) {
  const cmdBase = command.trim().split(/\s+/)[0].toLowerCase();
  const isAllowed = GATE_ALLOWED_PREFIXES.some((p) => cmdBase === p || cmdBase.endsWith(`/${p}`));
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
      maxBuffer: 16 * 1024 * 1024,
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

function _runWindowsBashGate(command, cwd, cmdBase, gateTimeout, failOnStderr) {
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
      maxBuffer: 16 * 1024 * 1024,
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
      maxBuffer: 16 * 1024 * 1024,
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

export function runGate(command, cwd, opts = {}) {
  const failOnStderr = opts.failOnStderr === true;
  const { cmdBase, blocked } = _validateGateAllowlist(command);
  if (blocked) return blocked;

  const gateTimeout = resolveGateTimeoutMs();

  const inlineRes = _runInlineNodeGate(command, cwd, gateTimeout, failOnStderr);
  if (inlineRes) return inlineRes;

  const winRes = _runWindowsBashGate(command, cwd, cmdBase, gateTimeout, failOnStderr);
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

// ─── Phase-28.3 Slice 4: Post-slice advisory scanner ─────────────────
//
// Non-blocking scan of completed slice trajectory for self-repair markers.
// If markers are present but no forge_meta_bug_file call was made during
// the slice, emit a `self-repair-missed` advisory to events.log.
// Pure advisory — does NOT change slice status, does NOT auto-file.

const SELF_REPAIR_MARKERS = /plan was wrong|fixed the plan|gate pattern|brittle gate|workaround|hand-fix|plan forge bug|orchestrator bug/i;

/**
 * Detect whether a completed slice likely performed self-repair work
 * but did not file a meta-bug via forge_meta_bug_file.
 *
 * @param {string|null} trajectoryContent - The trajectory text (last 200 lines).
 * @param {string|null} workerOutput - Full worker stdout text.
 * @returns {{ matched: string[] } | null} Matched markers, or null if no advisory needed.
 */
export function detectSelfRepairMissed(trajectoryContent, workerOutput) {
  if (!trajectoryContent) return null;

  // Scan trajectory for self-repair markers
  const lines = trajectoryContent.split("\n").slice(-200);
  const matched = [];
  for (const line of lines) {
    const m = line.match(SELF_REPAIR_MARKERS);
    if (m) matched.push(m[0]);
  }
  if (matched.length === 0) return null;

  // Check if forge_meta_bug_file was called anywhere in worker output
  const output = workerOutput || "";
  if (output.includes("forge_meta_bug_file")) return null;

  // Deduplicate matched markers
  return { matched: [...new Set(matched)] };
}

/**
 * Phase-31 Slice 3 (Reflexion prompt wiring): builds the final slice prompt for
 * a retry attempt by prepending the reflexion context block as a system-prompt
 * preamble so the worker sees it before all other instructions.
 *
 * Invariant: all retry paths that increment `attempt` MUST populate
 * `lastFailureContext` before calling this function, otherwise reflexion is
 * silently skipped. See the two assignment sites in `executeSlice` (~line 6256
 * and ~line 6276).
 *
 * Pure function: no fs, no network, deterministic. Safe to unit-test in isolation.
 *
 * @param {string} sliceInstructions - The fully-assembled prompt for this attempt.
 * @param {object|null} lastFailureContext - Context from the previous failed attempt,
 *   or null on the first attempt. Must conform to the `buildReflexionBlock` contract:
 *   `{ previousAttempt, gateName, model, durationMs, stderrTail }`.
 * @returns {string} `sliceInstructions` unchanged when `lastFailureContext` is null;
 *   otherwise the reflexion preamble block + "\n\n" + `sliceInstructions`.
 */
export function buildRetryPrompt(sliceInstructions, lastFailureContext) {
  if (lastFailureContext === null || lastFailureContext === undefined) {
    return sliceInstructions;
  }
  const reflexionBlock = buildReflexionBlock(lastFailureContext);
  return `${reflexionBlock}\n\n${sliceInstructions}`;
}

// ─── Schedulers (C2: Pluggable) ───────────────────────────────────────

/**
 * Sequential scheduler — executes slices one at a time in DAG order.
 * Phase 1 implementation.
 */
export class SequentialScheduler {
  constructor(eventBus) {
    this.eventBus = eventBus;
  }

  /**
   * @param {Map} nodes - DAG nodes
   * @param {string[]} order - Topological order
   * @param {Function} executeFn - async (slice) => result
   * @param {object} options - { abortSignal, resumeFrom, hub, gateCheckConfig }
   */
  async _handlePostSliceGate({ id, hub, gateCheckConfig, abortSignal }) {
    if (!(hub && gateCheckConfig?.enabled)) return { block: false };
    try {
      const gateResult = await hub.ask("brain.gate-check", { sliceId: id }, { timeoutMs: gateCheckConfig.timeoutMs || 5000 });
      if (gateResult.ok && gateResult.payload?.proceed === false) {
        this.eventBus.emit("gate-blocked", {
          sliceId: id,
          reason: gateResult.payload.reason,
          openBlockingReviews: gateResult.payload.openBlockingReviews,
          driftScore: gateResult.payload.driftScore,
          openIncidents: gateResult.payload.openIncidents,
        });
        return { block: true };
      }
      this.eventBus.emit("gate-passed", { sliceId: id });
    } catch {
      this.eventBus.emit("gate-passed", { sliceId: id, failOpen: true });
    }
    if (abortSignal?.aborted) {
      this.eventBus.emit("run-aborted", { sliceId: id, reason: "User abort" });
      return { block: true };
    }
    return { block: false };
  }

  async execute(nodes, order, executeFn, options = {}) {
    const { abortSignal, resumeFrom = null, hub = null, gateCheckConfig = null } = options;
    const results = [];
    let skipping = resumeFrom !== null;

    for (const id of order) {
      if (abortSignal?.aborted) {
        this.eventBus.emit("run-aborted", { sliceId: id, reason: "User abort" });
        break;
      }

      const slice = nodes.get(id);

      if (skipping) {
        if (id === String(resumeFrom)) {
          skipping = false;
        } else {
          results.push({ sliceId: id, status: "skipped" });
          continue;
        }
      }

      if (slice.status === "completed") {
        results.push({ sliceId: id, status: "skipped" });
        continue;
      }

      this.eventBus.emit("slice-started", { sliceId: id, title: slice.title, complexityScore: slice.complexityScore });

      try {
        const result = await executeFn(slice);
        results.push({ sliceId: id, ...result });

        if (result.status === "passed") {
          this.eventBus.emit("slice-completed", { sliceId: id, complexityScore: slice.complexityScore, ...result });
          const gateOutcome = await this._handlePostSliceGate({ id, hub, gateCheckConfig, abortSignal });
          if (gateOutcome.block) break;
        } else {
          this.eventBus.emit("slice-failed", { sliceId: id, complexityScore: slice.complexityScore, ...result });
          break; // Sequential: stop on first failure
        }
      } catch (err) {
        const failResult = { sliceId: id, status: "error", error: err.message };
        results.push(failResult);
        this.eventBus.emit("slice-failed", failResult);
        break;
      }
    }

    return results;
  }
}

/**
 * Parallel scheduler — Phase 6: executes [P]-tagged slices concurrently.
 * Respects DAG dependencies and merge points.
 * Falls back to sequential for slices without [P] or with scope conflicts.
 */
export class ParallelScheduler {
  constructor(eventBus, maxParallelism = 3) {
    this.eventBus = eventBus;
    this.maxParallelism = maxParallelism;
  }

  /**
   * Execute slices respecting DAG dependencies with parallel [P]-tagged slices.
   * Uses a readiness-based approach: slices become ready when all dependencies complete.
   */
  async execute(nodes, order, executeFn, options = {}) {
    const { abortSignal } = options;
    const results = new Map();
    const completed = new Set();
    const allResults = [];

    // Check for scope conflicts among parallel-eligible slices
    const conflicts = detectScopeConflicts(nodes);

    // Process until all slices are done
    while (completed.size < nodes.size) {
      if (abortSignal?.aborted) {
        this.eventBus.emit("run-aborted", { reason: "User abort" });
        break;
      }

      // Find ready slices: all dependencies completed
      const ready = [];
      for (const id of order) {
        if (completed.has(id)) continue;
        const node = nodes.get(id);
        const depsComplete = (node.depends || []).every((d) => completed.has(d));
        if (!depsComplete) continue;
        // Check if any dependency failed
        const depFailed = (node.depends || []).some((d) => {
          const r = results.get(d);
          return r && (r.status === "failed" || r.status === "error");
        });
        if (depFailed) {
          // Skip slices whose dependencies failed
          const skipResult = { sliceId: id, status: "skipped", reason: "dependency failed" };
          results.set(id, skipResult);
          allResults.push(skipResult);
          completed.add(id);
          continue;
        }
        ready.push(id);
      }

      if (ready.length === 0) break; // No more slices can run

      // Separate parallel-eligible from sequential
      const parallelReady = ready.filter((id) => {
        const node = nodes.get(id);
        return node.parallel && !conflicts.has(id);
      });
      const sequentialReady = ready.filter((id) => !parallelReady.includes(id));

      // Execute parallel batch (up to maxParallelism)
      if (parallelReady.length > 1) {
        const batch = parallelReady.slice(0, this.maxParallelism);
        const promises = batch.map(async (id) => {
          const slice = nodes.get(id);
          this.eventBus.emit("slice-started", { sliceId: id, title: slice.title, parallel: true, complexityScore: slice.complexityScore });
          try {
            const result = await executeFn(slice);
            const r = { sliceId: id, ...result };
            if (result.status === "passed") {
              this.eventBus.emit("slice-completed", { sliceId: id, complexityScore: slice.complexityScore, ...result, parallel: true });
            } else {
              this.eventBus.emit("slice-failed", { sliceId: id, complexityScore: slice.complexityScore, ...result, parallel: true });
            }
            return r;
          } catch (err) {
            const r = { sliceId: id, status: "error", error: err.message };
            this.eventBus.emit("slice-failed", r);
            return r;
          }
        });

        const batchResults = await Promise.all(promises);
        for (const r of batchResults) {
          results.set(r.sliceId, r);
          allResults.push(r);
          completed.add(r.sliceId);
        }
      } else {
        // Execute one at a time (sequential or single parallel)
        const id = sequentialReady[0] || parallelReady[0];
        if (!id) break;

        const slice = nodes.get(id);
        if (slice.status === "completed") {
          const r = { sliceId: id, status: "skipped" };
          results.set(id, r);
          allResults.push(r);
          completed.add(id);
          continue;
        }

        this.eventBus.emit("slice-started", { sliceId: id, title: slice.title, complexityScore: slice.complexityScore });
        try {
          const result = await executeFn(slice);
          const r = { sliceId: id, ...result };
          results.set(id, r);
          allResults.push(r);
          completed.add(id);

          if (result.status === "passed") {
            this.eventBus.emit("slice-completed", { sliceId: id, complexityScore: slice.complexityScore, ...result });
          } else {
            this.eventBus.emit("slice-failed", { sliceId: id, complexityScore: slice.complexityScore, ...result });
            // Don't break — parallel scheduler checks deps, not sequence
          }
        } catch (err) {
          const r = { sliceId: id, status: "error", error: err.message };
          results.set(id, r);
          allResults.push(r);
          completed.add(id);
          this.eventBus.emit("slice-failed", r);
        }
      }
    }

    return allResults;
  }
}

/**
 * Competitive scheduler (Phase-26 Slice 2) — for slices tagged `[competitive]`,
 * spawn N worktree variants under `.forge/worktrees/<plan>/<slice>/variant-<n>`
 * and run each through the standard slice executor in parallel. All other
 * slices (no `[competitive]` tag) execute sequentially in DAG order — this
 * scheduler is a superset of `SequentialScheduler` for non-competitive slices.
 *
 * Winner selection and loser archival are Slice 3 of this phase; Slice 2 only
 * produces a result with the shape:
 *   { sliceId, status: "competitive-pending", variants: [...], winningVariant: null }
 *
 * Opt-in: when no slice has the `[competitive]` tag, `runPlan` picks a
 * different scheduler and this class is never instantiated.
 */
export class CompetitiveScheduler {
  /**
   * @param {object} eventBus
   * @param {object} [config]
   * @param {number} [config.maxVariants=3]
   * @param {string} [config.projectDir] absolute project dir for worktrees
   * @param {string} [config.planBasename]
   * @param {object} [config.worktreeManager] injected module exports (testing)
   */
  constructor(eventBus, config = {}) {
    this.eventBus = eventBus;
    this.maxVariants = config.maxVariants ?? 3;
    this.projectDir = config.projectDir ?? null;
    this.planBasename = config.planBasename ?? null;
    this.worktreeManager = config.worktreeManager ?? null;
  }

  /**
   * Execute slices respecting DAG order. `[competitive]`-tagged slices
   * spawn N variant worktrees and run each through executeFn in parallel.
   *
   * @param {Map} nodes
   * @param {string[]} order topological order
   * @param {(slice: object) => Promise<object>} executeFn
   * @param {object} [options] { abortSignal, resumeFrom }
   * @returns {Promise<object[]>}
   */
  async execute(nodes, order, executeFn, options = {}) {
    const { abortSignal, resumeFrom = null } = options;
    const results = [];
    let skipping = resumeFrom !== null;

    for (const id of order) {
      if (abortSignal?.aborted) {
        this.eventBus.emit("run-aborted", { sliceId: id, reason: "User abort" });
        break;
      }

      const slice = nodes.get(id);

      if (skipping) {
        if (id === String(resumeFrom)) {
          skipping = false;
        } else {
          results.push({ sliceId: id, status: "skipped" });
          continue;
        }
      }

      if (slice.status === "completed") {
        results.push({ sliceId: id, status: "skipped" });
        continue;
      }

      if (slice.competitive) {
        const result = await this._executeCompetitiveSlice(slice, executeFn, abortSignal);
        results.push(result);
        // Slice 2 contract: we never consider a competitive slice "failed" here —
        // Slice 3 adds winner selection that can mark it failed/passed. Until
        // then, `competitive-pending` flows through and the run continues.
        if (result.status === "error" || result.status === "failed") break;
      } else {
        // Non-competitive path: same shape as SequentialScheduler.
        this.eventBus.emit("slice-started", {
          sliceId: id,
          title: slice.title,
          complexityScore: slice.complexityScore,
        });
        try {
          const r = await executeFn(slice);
          const entry = { sliceId: id, ...r };
          results.push(entry);
          if (r.status === "passed") {
            this.eventBus.emit("slice-completed", { sliceId: id, ...r });
          } else {
            this.eventBus.emit("slice-failed", { sliceId: id, ...r });
            break;
          }
        } catch (err) {
          const fail = { sliceId: id, status: "error", error: err.message };
          results.push(fail);
          this.eventBus.emit("slice-failed", fail);
          break;
        }
      }
    }

    return results;
  }

  _createCompetitiveWorktrees(slice, n) {
    const created = [];
    const manager = this.worktreeManager;
    if (!(manager && this.projectDir && this.planBasename)) return { created, error: null };
    for (let v = 1; v <= n; v++) {
      try {
        const wt = manager.createWorktree({
          projectDir: this.projectDir,
          planBasename: this.planBasename,
          sliceId: slice.number,
          variant: v,
        });
        created.push({ variant: v, path: wt.path });
      } catch (err) {
        for (const c of created) {
          try {
            manager.archiveWorktree({
              projectDir: this.projectDir,
              planBasename: this.planBasename,
              sliceId: slice.number,
              variant: c.variant,
            });
          } catch { /* swallow */ }
        }
        return { created, error: `competitive: worktree creation failed for variant ${v}: ${err.message}` };
      }
    }
    return { created, error: null };
  }

  _archiveCompetitiveVariants(slice, variantsToArchive) {
    const manager = this.worktreeManager;
    if (!(manager && this.projectDir && this.planBasename)) return;
    for (const v of variantsToArchive) {
      try {
        manager.archiveWorktree({
          projectDir: this.projectDir,
          planBasename: this.planBasename,
          sliceId: slice.number,
          variant: v.variant,
        });
      } catch { /* swallow */ }
    }
  }

  async _runCompetitiveVariant(slice, executeFn, variant, path) {
    const startedAt = Date.now();
    this.eventBus.emit("variant-started", { sliceId: slice.number, variant, worktreePath: path });
    try {
      const variantSlice = { ...slice, variantContext: { variant, worktreePath: path } };
      const r = await executeFn(variantSlice);
      const durationMs = Date.now() - startedAt;
      this.eventBus.emit("variant-completed", { sliceId: slice.number, variant, status: r.status, durationMs });
      return { variant, worktreePath: path, durationMs, ...r };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.eventBus.emit("variant-completed", { sliceId: slice.number, variant, status: "error", durationMs });
      return { variant, worktreePath: path, durationMs, status: "error", error: err.message };
    }
  }

  _promoteWinner(slice, winner) {
    const manager = this.worktreeManager;
    let promotion = { promoted: false };
    if (manager && this.projectDir && this.planBasename && typeof manager.promoteWinner === "function") {
      try {
        promotion = manager.promoteWinner({
          projectDir: this.projectDir,
          planBasename: this.planBasename,
          sliceId: slice.number,
          variant: winner.variant,
        });
      } catch (err) {
        promotion = { promoted: false, error: err.message };
      }
    }
    return promotion;
  }

  async _executeCompetitiveSlice(slice, executeFn, abortSignal) {
    const declaredVariants = Number.isInteger(slice.competitiveVariants)
      ? slice.competitiveVariants
      : this.maxVariants;
    const n = Math.min(5, Math.max(2, declaredVariants));

    this.eventBus.emit("competitive-slice-started", { sliceId: slice.number, title: slice.title, variants: n });

    const wt = this._createCompetitiveWorktrees(slice, n);
    if (wt.error) {
      return { sliceId: slice.number, status: "error", error: wt.error, variants: [], winningVariant: null };
    }

    if (abortSignal?.aborted) {
      return {
        sliceId: slice.number,
        status: "error",
        error: "aborted before competitive variants started",
        variants: [],
        winningVariant: null,
      };
    }

    const runs = wt.created.length > 0
      ? wt.created
      : Array.from({ length: n }, (_, i) => ({ variant: i + 1, path: null }));

    const variants = await Promise.all(
      runs.map(({ variant, path }) => this._runCompetitiveVariant(slice, executeFn, variant, path)),
    );

    this.eventBus.emit("competitive-slice-variants-completed", {
      sliceId: slice.number,
      variants: variants.map((v) => ({ variant: v.variant, status: v.status })),
    });

    const selection = selectWinner(variants);

    if (!selection.winner) {
      this._archiveCompetitiveVariants(slice, variants);
      this.eventBus.emit("competitive-slice-failed", {
        sliceId: slice.number,
        reason: "no variant passed all gates",
        variants: variants.map((v) => ({ variant: v.variant, status: v.status })),
      });
      return {
        sliceId: slice.number,
        status: "failed",
        error: "no variant passed all gates",
        variants,
        winningVariant: null,
      };
    }

    const promotion = this._promoteWinner(slice, selection.winner);
    this._archiveCompetitiveVariants(slice, variants.filter((v) => v.variant !== selection.winner.variant));

    this.eventBus.emit("competitive-slice-won", {
      sliceId: slice.number,
      winningVariant: selection.winner.variant,
      reason: selection.reason,
      promotion,
    });

    return {
      sliceId: slice.number,
      status: "passed",
      variants,
      winningVariant: selection.winner.variant,
      selectionReason: selection.reason,
      promotion,
    };
  }
}

/**
 * Phase-26 Slice 3 — deterministic winner selection across competitive variants.
 *
 * Rule (plan D2):
 *   1. Only variants whose `status === "passed"` are eligible.
 *   2. Lowest cost-to-diff ratio wins (cost_usd / max(1, diffLines)).
 *   3. Tiebreak: shortest diffLines.
 *   4. Tiebreak: earliest completedAt (or durationMs as fallback).
 *   5. Final tiebreak: lowest variant number (guarantees total ordering).
 *
 * Pure function — no IO, no side effects. The `reason` string is logged for
 * audit by the caller so operators can reconstruct why a winner was picked.
 *
 * @param {Array<object>} variants as returned by `_executeCompetitiveSlice`
 * @returns {{ winner: object|null, reason: string, eligible: object[] }}
 */
export function selectWinner(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return { winner: null, reason: "no variants", eligible: [] };
  }
  const eligible = variants.filter((v) => v && v.status === "passed");
  if (eligible.length === 0) {
    return { winner: null, reason: "no variant passed all gates", eligible: [] };
  }

  const ratio = (v) => {
    const cost = Number.isFinite(v.cost_usd) ? Number(v.cost_usd) : 0;
    const diff = Math.max(1, Number.isFinite(v.diffLines) ? Number(v.diffLines) : 1);
    return cost / diff;
  };
  const completionKey = (v) => {
    if (typeof v.completedAt === "number" && Number.isFinite(v.completedAt)) return v.completedAt;
    if (typeof v.completedAt === "string") {
      const t = Date.parse(v.completedAt);
      if (!Number.isNaN(t)) return t;
    }
    // Fall back to durationMs (shorter = earlier since all started at ~same time).
    return Number.isFinite(v.durationMs) ? v.durationMs : Number.MAX_SAFE_INTEGER;
  };

  const sorted = [...eligible].sort((a, b) => {
    const ra = ratio(a); const rb = ratio(b);
    if (ra !== rb) return ra - rb;
    const da = Number.isFinite(a.diffLines) ? a.diffLines : Number.MAX_SAFE_INTEGER;
    const db = Number.isFinite(b.diffLines) ? b.diffLines : Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    const ca = completionKey(a); const cb = completionKey(b);
    if (ca !== cb) return ca - cb;
    return (a.variant ?? 0) - (b.variant ?? 0);
  });

  const winner = sorted[0];
  const reason =
    `variant ${winner.variant}: cost/diff=${ratio(winner).toFixed(6)}` +
    `, diff=${winner.diffLines ?? "?"}` +
    `, completion=${completionKey(winner)}`;
  return { winner, reason, eligible };
}

/**
 * Detect scope conflicts among parallel-eligible slices (M6).
 * If two [P] slices have overlapping file scopes, they can't run in parallel.
 * @returns {Set<string>} IDs of slices that have conflicts (forced sequential)
 */
export function detectScopeConflicts(nodes) {
  const conflicts = new Set();
  const parallelSlices = [];

  for (const [id, node] of nodes) {
    if (node.parallel) {
      parallelSlices.push({ id, scope: node.scope || [] });
    }
  }

  // Check all pairs for overlapping scopes
  for (let i = 0; i < parallelSlices.length; i++) {
    for (let j = i + 1; j < parallelSlices.length; j++) {
      const a = parallelSlices[i];
      const b = parallelSlices[j];

      // No scope declared = global = conflicts with everything
      if (a.scope.length === 0 || b.scope.length === 0) {
        conflicts.add(a.id);
        conflicts.add(b.id);
        continue;
      }

      // Check for overlap (simple prefix match)
      for (const sa of a.scope) {
        for (const sb of b.scope) {
          const baseA = sa.replace(/\*\*/g, "");
          const baseB = sb.replace(/\*\*/g, "");
          if (baseA.startsWith(baseB) || baseB.startsWith(baseA)) {
            conflicts.add(a.id);
            conflicts.add(b.id);
          }
        }
      }
    }
  }

  return conflicts;
}
