/** Plan Forge — Phase-53 S9: gate helper sub-module */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, basename, dirname, join, relative, extname, isAbsolute } from "node:path";
import { parsePlan } from "./plan-parser.mjs";
import { GATE_ALLOWED_PREFIXES, UNIX_TOOLS } from "./constants.mjs";
import { coalesceGateLines, looksLikeProse, runGate, resolveGateTimeoutMs } from "./schedulers.mjs";
import { recall as brainRecall, loadReviewerConfig, invokeReviewer } from "../brain.mjs";

export function extractPlanReleaseVersion(planPath) {
  if (!planPath || typeof planPath !== "string") return null;

  // 1. Filename: ...-v2.67.4-... or ...-v2.67-... Pre-release suffix is
  //    intentionally NOT captured from the filename (too easy to swallow
  //    "-PLAN.md" etc.) — use frontmatter or chore(release) line for that.
  const fname = planPath.split(/[\\/]/).pop() || "";
  const fnameMatch = fname.match(/[-_]v(\d+\.\d+(?:\.\d+)?)\b/);
  if (fnameMatch) return fnameMatch[1];

  // 2./3. Body scan (frontmatter `version:` or chore(release) line)
  let body = "";
  try {
    body = readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }

  const fmMatch = body.match(/(?:^|\n)version:\s*['"]?v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)['"]?/);
  if (fmMatch) return fmMatch[1];

  const choreMatch = body.match(/chore\(release\):\s*v(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/);
  if (choreMatch) return choreMatch[1];

  return null;
}

/**
 * Check whether a plan's target release version collides with a tag that
 * already exists on `origin`. Prevents the "retrograde release disaster"
 * (re-running an old plan against newer master, producing a `chore(release):`
 * commit + tag that overwrites a shipped release).
 *
 * Behaviour:
 *   - Returns `{ collision: false, version: null }` when no version is detected
 *     (non-release plan — bail out as no-op).
 *   - Returns `{ collision: false, version, originSha: null }` when the tag does
 *     not exist on origin.
 *   - Returns `{ collision: true, version, originSha }` when the tag already
 *     exists on origin.
 *
 * If `git ls-remote` itself fails (no network, no remote, etc.) returns
 * `{ collision: false, version, error }` — the orchestrator treats this as
 * advisory-only so offline runs aren't blocked.
 *
 * @param {string} planPath - Path to plan markdown file
 * @param {string} [cwd=process.cwd()] - Project root (where git is invoked)
 * @param {{ runner?: (cmd: string, opts: object) => string }} [opts] - Test seam
 * @returns {{ version: string|null, collision: boolean, originSha: string|null, error: string|null }}
 */
export function detectVersionCollision(planPath, cwd = process.cwd(), opts = {}) {
  const version = extractPlanReleaseVersion(planPath);
  if (!version) {
    return { version: null, collision: false, originSha: null, error: null };
  }

  const tagRef = `refs/tags/v${version}`;
  const runner = opts.runner || ((cmd, options) => execSync(cmd, options).toString());

  try {
    const out = runner(`git ls-remote --tags origin ${tagRef}`, {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = (out || "").trim();
    if (!trimmed) {
      return { version, collision: false, originSha: null, error: null };
    }
    // Output format: "<sha>\trefs/tags/v2.67.4"
    const sha = trimmed.split(/\s+/)[0] || null;
    return { version, collision: true, originSha: sha, error: null };
  } catch (err) {
    return {
      version,
      collision: false,
      originSha: null,
      error: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * Extract validation gates from a parsed plan file.
 * Delegates to parsePlan() — does not duplicate parsing logic.
 * @param {string} planFilePath - Absolute or project-relative path to a plan markdown file
 * @param {string} [cwd=process.cwd()] - Project root (used for path-traversal check)
 * @returns {Array<{sliceNumber: string, sliceTitle: string, gates: string[]}>}
 */
export function parseValidationGates(planFilePath, cwd = process.cwd()) {
  const plan = parsePlan(planFilePath, cwd);
  return plan.slices
    .filter(s => s.validationGate)
    .map(s => ({
      sliceNumber: s.number,
      sliceTitle: s.title,
      gates: s.validationGate
        .split("\n")
        .map(l => l.replace(/\s{2,}#\s.*$/, "").trim())
        .filter(l => l.length > 0),
    }));
}

/**
 * Lint all validation gate commands in a plan file.
 * Catches common issues that cause gate failures at runtime:
 *   - Commands not in the allowlist
 *   - Standalone comment lines (# ...) that get treated as commands
 *   - /dev/stdin usage (not cross-platform — fails on Windows)
 *   - curl localhost:* in non-final slices (requires running server)
 *   - `node *.test.mjs` for vitest test files (must use npx vitest)
 *
 * @param {string} planFilePath - Path to the plan Markdown file
 * @returns {{ warnings: Array, errors: Array, passed: boolean }}
 */
function _parseDisableDirectivesAndComments(rawLines, slice, warnings) {
  const disabledRules = new Set();
  for (const raw of rawLines) {
    const disableMatch = raw.match(/^#\s*pforge-lint-disable\s+(.+)$/i);
    if (disableMatch) {
      for (const rid of disableMatch[1].split(",").map(s => s.trim().toUpperCase()).filter(Boolean)) {
        disabledRules.add(rid);
      }
    } else if (raw.startsWith("#")) {
      const loc = `Slice ${slice.number} ("${slice.title}")`;
      warnings.push({
        slice: slice.number,
        command: raw,
        rule: "comment-line",
        severity: "warn",
        message: `${loc}: Standalone comment '${raw.slice(0, 60)}...' will be treated as a command. Remove or prefix with a real command.`,
      });
    }
  }
  return disabledRules;
}

function _resolveCmdToken(line) {
  const tokens = line.split(/\s+/);
  let cmdIdx = 0;
  while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
    cmdIdx++;
  }
  return (tokens[cmdIdx] || tokens[0]).toLowerCase();
}

function _pushWRule({ test, ruleId, rule, msg, line, slice, loc, strictMode, disabledRules, warnings, errors }) {
  if (!test || disabledRules.has(ruleId)) return;
  const _sev = strictMode ? "error" : "warn";
  (_sev === "error" ? errors : warnings).push({
    slice: slice.number,
    command: line,
    ruleId,
    rule,
    severity: _sev,
    message: `${loc}: ${msg}`,
  });
}

function _lintBasicRules(line, slice, loc, cmdToken, { lastSliceNumber, warnings, errors }) {
  if (line.includes("/dev/stdin")) {
    errors.push({
      slice: slice.number, command: line, rule: "unix-only-path", severity: "error",
      message: `${loc}: '/dev/stdin' is Unix-only — fails on Windows. Use readFileSync(0,'utf8') for cross-platform stdin.`,
    });
  }
  const isAllowed = GATE_ALLOWED_PREFIXES.some(p => cmdToken === p || cmdToken.endsWith(`/${p}`));
  if (!isAllowed) {
    errors.push({
      slice: slice.number, command: line, rule: "blocked-command", severity: "error",
      message: `${loc}: '${cmdToken}' is not in the gate allowlist. Add it to GATE_ALLOWED_PREFIXES or rewrite the command.`,
    });
  }
  if (/curl\s.*localhost[:\s]/.test(line) && slice.number !== lastSliceNumber) {
    warnings.push({
      slice: slice.number, command: line, rule: "runtime-gate", severity: "warn",
      message: `${loc}: curl to localhost requires a running server. Move runtime API checks to vitest integration tests.`,
    });
  }
  if (/^node\s+.*\.test\.(mjs|js|ts)/.test(line)) {
    warnings.push({
      slice: slice.number, command: line, rule: "vitest-direct-node", severity: "warn",
      message: `${loc}: 'node *.test.*' fails for vitest test files. Use 'npx vitest run <file>' instead.`,
    });
  }
  if (/\bpforge\s+analyze\b/.test(line)) {
    warnings.push({
      slice: slice.number, command: line, rule: "pforge-analyze-in-gate", severity: "warn",
      message: `${loc}: 'pforge analyze' in a gate exits 1 on noisy text-match heuristics (false-negatived all Phase-38.1–38.8 Slice 5 gates). Omit it — the orchestrator auto-runs analyze post-execution. Use 'pforge regression-guard <plan>' for a doc-integrity check instead.`,
    });
  }
  if (UNIX_TOOLS.includes(cmdToken) && !/^bash\s+-c/.test(line)) {
    warnings.push({
      slice: slice.number, command: line, rule: "windows-unavailable", severity: "warn",
      message: `${loc}: '${cmdToken}' is not available in cmd.exe on Windows. Wrap in 'bash -c' or use a 'node -e' equivalent.`,
    });
  }
  if (/\/tmp\/|\/dev\/null/.test(line)) {
    warnings.push({
      slice: slice.number, command: line, rule: "unix-only-path", severity: "warn",
      message: `${loc}: Unix-only path (/tmp/ or /dev/null) — fails on Windows. Use os.tmpdir() or NUL.`,
    });
  }
  if (/^pforge\s/.test(line)) {
    warnings.push({
      slice: slice.number, command: line, rule: "project-script", severity: "warn",
      message: `${loc}: 'pforge' is a project script, not on PATH during gate execution. Use 'pwsh ./pforge.ps1' or rewrite as 'node -e'.`,
    });
  }
  if (/^node\s+-e\s+".*\/\//.test(line) && !line.includes("http://") && !line.includes("https://")) {
    warnings.push({
      slice: slice.number, command: line, rule: "js-comment-in-eval", severity: "warn",
      message: `${loc}: node -e contains '//' which acts as a line comment on a single line, breaking the code. Remove JS comments from gate commands.`,
    });
  }
}

function _lintWRules(line, slice, loc, cmdToken, { strictMode, disabledRules, warnings, errors }) {
  _pushWRule({
    test: /^bash\s+-c\b/.test(line),
    ruleId: "W1", rule: "bash-prefix",
    msg: `'bash -c' prefix detected — fails on Windows (bash not in PATH). Rewrite as a direct node/npx command or use 'pwsh -Command' instead.`,
    line, slice, loc, strictMode, disabledRules, warnings, errors,
  });
  _pushWRule({
    test: !/^bash\s+-c\b/.test(line) && /^(node|npx|pwsh)\b.*\|/.test(line),
    ruleId: "W2", rule: "pipeline-node",
    msg: `Shell pipeline with '${cmdToken}' as left operand — cmd.exe may handle this differently. Consider wrapping in a 'node -e' script that uses child_process for portability.`,
    line, slice, loc, strictMode, disabledRules, warnings, errors,
  });
  _pushWRule({
    test: /^node\s+-e\s+.*\\\\[sdwSDWbBntr]/.test(line),
    ruleId: "W3", rule: "regex-escape",
    msg: `node -e contains '\\\\<metachar>' — the double-backslash is likely an over-escape; cmd.exe strips one level, so the regex may not match as intended. Use a single '\\' for regex escapes inside node -e strings.`,
    line, slice, loc, strictMode, disabledRules, warnings, errors,
  });
  _pushWRule({
    test: /\bcd\s+\S+.*&&/.test(line),
    ruleId: "W4", rule: "cd-chain",
    msg: `'cd dir && command' chain — on Windows cmd.exe the directory change does not persist for the next command. Use a --cwd flag or run commands from the target directory directly.`,
    line, slice, loc, strictMode, disabledRules, warnings, errors,
  });
  _pushWRule({
    test: /^node\s+-e\s+".*\\"/.test(line),
    ruleId: "W5", rule: "node-e-nested-double-quote",
    msg: `node -e contains nested '\\"' (escaped double-quote) — mangled by PowerShell before reaching Node, produces runtime SyntaxError. Use single quotes inside the inline JS, or invoke a helper script via 'node script.mjs'.`,
    line, slice, loc, strictMode, disabledRules, warnings, errors,
  });
}

function _lintCommandLine(line, slice, {
  lastSliceNumber,
  disabledRules,
  strictMode,
  warnings,
  errors,
  portabilityWarnings,
}) {
  const loc = `Slice ${slice.number} ("${slice.title}")`;
  if (looksLikeProse(line)) {
    warnings.push({
      slice: slice.number, command: line, rule: "prose-detected", severity: "warn",
      message: `${loc}: Line looks like prose, not a command: '${line.slice(0, 60)}...' — will be skipped at runtime.`,
    });
    return;
  }
  const cmdToken = _resolveCmdToken(line);
  _lintBasicRules(line, slice, loc, cmdToken, { lastSliceNumber, warnings, errors });
  _lintWRules(line, slice, loc, cmdToken, { strictMode, disabledRules, warnings, errors });

  const portResult = validateGatePortability(line);
  for (const pw of portResult.warnings) {
    portabilityWarnings.push({ ...pw, slice: slice.number, command: line });
  }
}

export function lintGateCommands(planFilePath, cwd = process.cwd()) {
  const plan = (planFilePath !== null && typeof planFilePath === "object")
    ? planFilePath
    : parsePlan(planFilePath, cwd);
  const warnings = [];
  const errors = [];
  const portabilityWarnings = [];
  // Strict mode: PFORGE_GATE_LINT_STRICT=1 promotes all W-rule warnings to errors.
  const strictMode = process.env.PFORGE_GATE_LINT_STRICT === "1";
  const lastSliceNumber = plan.slices.length > 0
    ? plan.slices[plan.slices.length - 1].number
    : null;

  for (const slice of plan.slices) {
    if (!slice.validationGate) continue;
    const rawLines = slice.validationGate.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const disabledRules = _parseDisableDirectivesAndComments(rawLines, slice, warnings);
    const commands = coalesceGateLines(slice.validationGate);
    for (const line of commands) {
      _lintCommandLine(line, slice, {
        lastSliceNumber,
        disabledRules,
        strictMode,
        warnings,
        errors,
        portabilityWarnings,
      });
    }
  }

  const allFindings = [...errors, ...warnings, ...portabilityWarnings];
  const result = {
    warnings,
    errors,
    portabilityWarnings,
    passed: errors.length === 0,
    summary: `${errors.length} error(s), ${warnings.length} warning(s), ${portabilityWarnings.length} portability warning(s) across ${plan.slices.length} slices`,
    find: (predicate) => allFindings.find(predicate),
    filter: (predicate) => allFindings.filter(predicate),
  };
  return result;
}

/**
 * Check a single gate command for cross-platform portability issues.
 * Returns non-blocking warnings for shell constructs that may behave
 * differently (or fail) across bash, zsh, cmd.exe, and PowerShell.
 * @param {string} command - A single gate command string
 * @returns {{ warnings: Array<{pattern: string, message: string, suggestion: string}> }}
 */
export function validateGatePortability(command) {
  if (!command || typeof command !== "string" || !command.trim()) {
    return { warnings: [] };
  }
  const warnings = [];

  // 1. Pipe into brace-group with read — behavior differs across shells
  if (/\|\s*\{[^}]*\bread\b/.test(command)) {
    warnings.push({
      pattern: "pipe-to-brace-read",
      message: "Pipe to brace-group with 'read' — variable may be lost in a subshell on some shells.",
      suggestion: "Use process substitution or a temp file instead of piping into a brace-group.",
    });
  }

  // 2. Nested double-quotes inside bash -c — escaping is fragile across platforms
  if (/bash\s+-c\s+".*\\"/.test(command) || /bash\s+-c\s+".*\\.+"/.test(command)) {
    warnings.push({
      pattern: "nested-double-quotes",
      message: "Nested double-quotes inside bash -c — escaping is fragile across platforms.",
      suggestion: "Use single-quotes for the outer bash -c argument, or use a script file.",
    });
  }

  // 3. Command substitution containing a pipe — complex nesting, error-prone
  if (/\$\(.*\|.*\)/.test(command)) {
    warnings.push({
      pattern: "cmd-substitution-pipe",
      message: "Command substitution containing a pipe — complex nesting is error-prone cross-platform.",
      suggestion: "Break into separate commands or use a temporary variable.",
    });
  }

  // 4. `bash -c "..."` chained with `&&` to another command — known broken on
  // Windows when the second command is `node -e "..."` containing `(` from
  // JSON.parse, regex literals, etc. The Windows cmd→bash shim mangles outer
  // quoting and inner parens (Phase 51 S0 hit this exact pattern).
  // The fix proven by Phase 41 and Phase 51 is to split each command onto
  // its own line so runGate() dispatches them separately via the inline-node
  // fast path (no shell involved).
  if (/^\s*bash\s+-c\s+["'].*["']\s*&&\s+/.test(command)) {
    warnings.push({
      pattern: "bash-c-chained-with-and",
      message: "`bash -c \"...\" && <cmd>` chains are mangled by the Windows cmd\u2192bash quoting shim when <cmd> contains nested quotes or parens (e.g. `node -e \"JSON.parse(...)\"`). Phase 51 S0 hit this.",
      suggestion: "Split into one command per line. Each line is dispatched separately by runGate(); inline-`node -e` lines bypass the shell entirely. Pattern: `node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run TESTS', {stdio:'inherit',shell:true});\"` on its own line.",
    });
  }

  // 5. `bash -c "cd X && ..."` — cwd-changing wrapper. Same root cause as #4:
  // the `&&` chain inside bash -c is fragile through the Windows shim and the
  // `node -e "process.chdir(X); execSync(...)"` form is strictly better
  // because it bypasses bash entirely.
  if (/^\s*bash\s+-c\s+["']\s*cd\s+\S+\s*&&\s+/.test(command)) {
    warnings.push({
      pattern: "bash-c-cd-prefix",
      message: "`bash -c \"cd X && ...\"` wraps a cwd change in bash, which is fragile through the Windows cmd\u2192bash shim and unnecessary.",
      suggestion: "Use the per-line node pattern: `node -e \"process.chdir('X'); require('child_process').execSync('<cmd>', {stdio:'inherit',shell:true});\"`. This runs through runGate()'s inline-node fast path (no shell), so quoting survives Windows verbatim.",
    });
  }

  return { warnings };
}

/**
 * Check whether a line would pass the gate allowlist (prefix-based) without the prose guard.
 * Used by regressionGuard to implement the precedence rule: allowlisted commands win over prose heuristic.
 * @param {string} cmd - The command line to check
 * @returns {boolean} true if the command matches an allowlist prefix
 */
function wouldPassAllowlist(cmd) {
  if (!cmd || typeof cmd !== "string") return false;
  const trimmed = cmd.trim();
  const tokens = trimmed.split(/\s+/);
  let cmdIdx = 0;
  while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
    cmdIdx++;
  }
  const cmdToken = (tokens[cmdIdx] || tokens[0] || "").toLowerCase();
  return GATE_ALLOWED_PREFIXES.some((p) => cmdToken === p || cmdToken.endsWith(`/${p}`));
}

/**
 * Check if a command string is permitted in validation gates.
 * Uses the same GATE_ALLOWED_PREFIXES allowlist as runGate() and lintGateCommands().
 * Skips leading env-var assignments (e.g., "NODE_ENV=test npm test").
 * Additionally blocks known-dangerous patterns (e.g., rm -rf /) regardless of prefix.
 * @param {string} cmd - The command line to check
 * @returns {boolean} true if the command is allowed, false if blocked
 */
export function isGateCommandAllowed(cmd) {
  if (!cmd || typeof cmd !== "string") return false;
  const trimmed = cmd.trim();

  // Block known-dangerous patterns first — allowlist cannot override these
  const BLOCKED_PATTERNS = [
    /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+[/~*]/i,  // rm -rf / or rm -fr ~
    /\brm\s+-[a-z]*\s+\/(\s|$)/,                                          // rm -* /
    /\bdd\s+.*of=\/dev\/(sda|hda|nvme)/i,                                 // dd to raw block device
    /\bmkfs\b/i,                                                           // format filesystem
    /\b:>\s*\/dev\/(sda|hda)/i,                                           // truncate block device
  ];
  if (BLOCKED_PATTERNS.some((p) => p.test(trimmed))) return false;

  const tokens = trimmed.split(/\s+/);
  let cmdIdx = 0;
  while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
    cmdIdx++;
  }
  const cmdToken = (tokens[cmdIdx] || tokens[0] || "").toLowerCase();
  if (GATE_ALLOWED_PREFIXES.some((p) => cmdToken === p || cmdToken.endsWith(`/${p}`))) {
    return true;
  }

  // Heuristic prose detection only applies after allowlist matching so
  // command-like lines such as `node -e ...` win over noisy prose heuristics.
  if (looksLikeProse(trimmed)) return false;
  return false;
}

/**
 * Run regression guard — extract validation gate commands from plan files,
 * check each against the allowlist, execute allowed commands, and report results.
 *
 * Stop condition: if parseValidationGates cannot reliably extract commands from a plan
 * (e.g., no bash-block gates found), falls back to `testCommand` fields from parsed slices.
 *
 * @param {string[]} files - Changed file paths to guard (informational — included in result)
 * @param {object} [options]
 * @param {string} [options.plan] - Path to a specific plan file (relative to cwd). If omitted, scans docs/plans/
 * @param {boolean} [options.failFast=false] - Stop on first gate failure
 * @param {string} [options.cwd=process.cwd()] - Project root
 * @returns {Promise<{files: string[], gatesChecked: number, passed: number, failed: number, blocked: number, skipped: number, success: boolean, results: object[]}>}
 */
function _resolvePlanPaths(plan, cwd) {
  if (plan) {
    const resolved = resolve(cwd, plan);
    return existsSync(resolved) ? [resolved] : [];
  }
  const plansDir = resolve(cwd, "docs", "plans");
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir)
    .filter((f) => f.endsWith("-PLAN.md") || f.endsWith("-plan.md"))
    .map((f) => resolve(plansDir, f));
}

function _collectFallbackGates(parsed, planPath, gateItems) {
  for (const s of parsed.slices) {
    if (s.testCommand) {
      gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: s.testCommand, source: "testCommand" });
    } else if (s.buildCommand) {
      gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: s.buildCommand, source: "buildCommand" });
    } else if (s.validationGateDescription) {
      const backtickRe = /`([^`]+)`/g;
      let bm;
      while ((bm = backtickRe.exec(s.validationGateDescription)) !== null) {
        const candidate = bm[1].trim();
        if (/^(dotnet|npm|npx|node|bash|pwsh|powershell|python|go|cargo|make|mvn|gradle)\b/i.test(candidate)) {
          gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: candidate, source: "prose-gate" });
        }
      }
    }
  }
}

function _collectGateItemsFromPlans(planPaths, cwd) {
  const gateItems = [];
  for (const planPath of planPaths) {
    try {
      const parsed = parsePlan(planPath, cwd);
      const sliceGates = parsed.slices
        .filter(s => s.validationGate)
        .map(s => ({
          sliceNumber: s.number,
          sliceTitle: s.title,
          gates: s.validationGate
            .split("\n")
            .map(l => l.replace(/\s{2,}#\s.*$/, "").trim())
            .filter(l => l.length > 0),
        }));

      let foundGates = false;
      for (const sg of sliceGates) {
        for (const cmd of sg.gates) {
          gateItems.push({ planFile: basename(planPath), sliceNumber: sg.sliceNumber, sliceTitle: sg.sliceTitle, cmd, source: "validation-gate" });
          foundGates = true;
        }
      }
      if (!foundGates) _collectFallbackGates(parsed, planPath, gateItems);
    } catch { /* unreadable plan — skip */ }
  }
  return gateItems;
}

function _prioritizeByHotspots(gateItems, cwd) {
  try {
    const hotspotCache = resolve(cwd, ".forge", "hotspot-cache.json");
    if (!existsSync(hotspotCache)) return;
    const cached = JSON.parse(readFileSync(hotspotCache, "utf-8"));
    const hotFiles = new Set((cached.hotspots || []).slice(0, 10).map(h => h.file));
    if (hotFiles.size === 0) return;
    gateItems.sort((a, b) => {
      const aHot = a.cmd && [...hotFiles].some(h => a.cmd.includes(h)) ? 1 : 0;
      const bHot = b.cmd && [...hotFiles].some(h => b.cmd.includes(h)) ? 1 : 0;
      return bHot - aHot;
    });
  } catch { /* best-effort prioritization */ }
}

function _classifyAndSkipGate(gate, cwd, results) {
  if (looksLikeProse(gate.cmd) && !wouldPassAllowlist(gate.cmd)) {
    results.push({ ...gate, status: "skipped", reason: "liveguard-prose-skipped" });
    try {
      appendForgeJsonl("liveguard-events.jsonl", {
        timestamp: new Date().toISOString(),
        type: "liveguard-prose-skipped",
        severity: "info",
        sliceNumber: gate.sliceNumber,
        command: gate.cmd,
      }, cwd);
    } catch { /* best-effort telemetry */ }
    return "skipped";
  }
  if (!isGateCommandAllowed(gate.cmd)) {
    results.push({ ...gate, status: "blocked", reason: `'${gate.cmd.split(/\s+/)[0]}' not in gate allowlist` });
    return "blocked";
  }
  return null;
}

function _runGate(gate, cwd, results) {
  try {
    const output = execSync(gate.cmd, { cwd, stdio: "pipe", timeout: resolveGateTimeoutMs(), encoding: "utf-8" });
    results.push({ ...gate, status: "passed", output: (output || "").trim().slice(0, 500) });
    return "passed";
  } catch (err) {
    const errOut = ((err.stderr || "") + (err.stdout || "")).trim().slice(0, 500) || err.message;
    results.push({ ...gate, status: "failed", output: errOut });
    return "failed";
  }
}

export async function regressionGuard(files, { plan, failFast = false, cwd = process.cwd() } = {}) {
  const planPaths = _resolvePlanPaths(plan, cwd);
  const gateItems = _collectGateItemsFromPlans(planPaths, cwd);
  _prioritizeByHotspots(gateItems, cwd);

  const results = [];
  let passed = 0, failed = 0, blocked = 0, skipped = 0;

  for (const gate of gateItems) {
    const classification = _classifyAndSkipGate(gate, cwd, results);
    if (classification === "skipped") { skipped++; continue; }
    if (classification === "blocked") { blocked++; continue; }

    const outcome = _runGate(gate, cwd, results);
    if (outcome === "passed") {
      passed++;
    } else {
      failed++;
      if (failFast) {
        const remaining = gateItems.slice(gateItems.indexOf(gate) + 1);
        for (const rem of remaining) {
          results.push({ ...rem, status: "skipped", reason: "fail-fast: previous gate failed" });
          skipped++;
        }
        break;
      }
    }
  }

  return {
    files: files || [],
    gatesChecked: gateItems.length,
    passed,
    failed,
    blocked,
    skipped,
    success: failed === 0,
    results,
  };
}

/**
 * Emit a telemetry record for a tool invocation. Best-effort — never throws.
 * @param {string} toolName - Tool identifier (e.g. "forge_smith")
 * @param {object|string} inputs - Tool input parameters
 * @param {*} result - Tool result (truncated to 2000 chars)
 * @param {number} durationMs - Execution time in milliseconds
 * @param {string} status - "ok" | "error" | "timeout"
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {object} The telemetry record written
 */
const LIVEGUARD_TOOLS = new Set([
  "forge_drift_report", "forge_incident_capture", "forge_dep_watch",
  "forge_regression_guard", "forge_runbook", "forge_hotspot",
  "forge_health_trend", "forge_alert_triage", "forge_deploy_journal",
  "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
  "forge_quorum_analyze", "forge_liveguard_run",
  // Phase TEMPER-06 Slice 06.1 — Bug Registry tools
  "forge_bug_register", "forge_bug_list", "forge_bug_update_status",
  // Phase TEMPER-06 Slice 06.3 — Closed-loop fix validation
  "forge_bug_validate_fix",
  // Phase FORGE-SHOP-02 Slice 02.1 — Review Queue tools
  "forge_review_add", "forge_review_list", "forge_review_resolve",
  // Phase TEMPER-07 Slice 07.1 — Agent delegation
  "forge_delegate_to_agent",
  // Phase FORGE-SHOP-03 Slice 03.1 — Notification tools
  "forge_notify_send", "forge_notify_test",
]);

