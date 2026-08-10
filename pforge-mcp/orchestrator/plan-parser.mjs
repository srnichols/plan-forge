/** Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) S1: plan-parser sub-module */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Parse a workerTimeoutMs value from a plan body line.
 * Accepts plain numbers or shorthand strings like "30m", "1h", "90s".
 * Returns null if the value is invalid, zero, or negative (falls through to env/default).
 * @param {string|number} raw
 * @returns {number|null}
 */
export function parseWorkerTimeoutValue(raw) {
  if (raw == null) return null;
  const str = String(raw).trim().replace(/^["']|["']$/g, ""); // strip optional quotes
  // Shorthand: 30m, 1h, 90s
  const shorthandMatch = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (shorthandMatch) {
    const n = parseFloat(shorthandMatch[1]);
    const unit = shorthandMatch[2].toLowerCase();
    const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
    const ms = Math.round(n * multipliers[unit]);
    if (ms > 0) return ms;
    console.warn(`[pforge] workerTimeoutMs shorthand "${str}" resolved to ≤0; ignoring.`);
    return null;
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    if (str !== "0") console.warn(`[pforge] workerTimeoutMs value "${str}" is invalid; ignoring.`);
    return null;
  }
  return Math.round(num);
}

/**
 * Parse an `--only-slices` expression into a sorted array of slice numbers.
 * Supports comma-separated integers and inclusive dash ranges.
 *   "2,4-6" → [2, 4, 5, 6]
 *   "3"     → [3]
 *   ""      → []
 * Invalid tokens (non-integer) or descending ranges throw an Error whose
 * message contains "invalid --only-slices expression".
 * @param {string} expr
 * @returns {number[]}
 */
export function parseOnlySlicesExpr(expr) {
  if (!expr || !expr.trim()) return [];
  const parts = expr.trim().split(/\s*,\s*/);
  const result = new Set();
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const pieces = trimmed.split("-");
      if (pieces.length !== 2 || !pieces[0] || !pieces[1]) {
        throw new Error(`invalid --only-slices expression: "${part}"`);
      }
      const start = Number(pieces[0]);
      const end = Number(pieces[1]);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`invalid --only-slices expression: "${part}"`);
      }
      if (end < start) {
        throw new Error(`invalid --only-slices expression: "${part}" (descending range)`);
      }
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      const n = Number(trimmed);
      if (!Number.isInteger(n)) {
        throw new Error(`invalid --only-slices expression: "${part}"`);
      }
      result.add(n);
    }
  }
  return [...result].sort((a, b) => a - b);
}

/**
 * Parse a hardened plan Markdown file into a structured DAG.
 *
 * Handles formats:
 *   ### Slice 1: Title
 *   ### Slice 12.1 — Title
 *   ### Slice N: Title [depends: Slice 1] [P] [scope: src/**]
 *
 * @param {string} planPath - Path to the plan Markdown file
 * @returns {{ meta, scopeContract, slices, dag }}
 */
function resolvePlanPath(planPath, cwd) {
  const fullPath = resolve(planPath);
  const projectRoot = resolve(cwd);
  const normalizedFull = fullPath.toLowerCase();
  const normalizedRoot = projectRoot.toLowerCase();
  if (!normalizedFull.startsWith(normalizedRoot)) {
    throw new Error(`Plan path must be within project directory: ${planPath}`);
  }
  return fullPath;
}

function parseFrontmatterFlowSequence(key, rawValue, lineNumber) {
  const trimmed = rawValue.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(
      `frontmatter ${key} must be a YAML flow sequence (e.g. [host1, host2]) ` +
      `at line ${lineNumber} — got: ${rawValue}`
    );
  }
  const inner = trimmed.slice(1, -1).trim();
  return inner ? inner.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean) : [];
}

function maybeApplyModelFrontmatter(meta, rawValue, value) {
  const isQuotedValue =
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"));
  const looksLikeNonString =
    !isQuotedValue &&
    (/^\d+(\.\d+)?$/.test(value) ||
      /^(true|false|null|~)$/i.test(value) ||
      /^[{\[]/.test(value));
  if (looksLikeNonString) {
    // eslint-disable-next-line no-console
    console.warn("[model] frontmatter model: ignored — not a string");
    return;
  }
  if (value.length > 0) meta.model = value;
}

function applyPlanFrontmatter({ meta, key, rawValue, value, lineNumber }) {
  if (key === "crucibleId") {
    meta.crucibleId = value;
    return;
  }
  if (key === "lane") {
    meta.lane = value;
    return;
  }
  if (key === "source") {
    meta.crucibleSource = value;
    return;
  }
  if (key === "network.allowed") {
    meta.networkAllowed = parseFrontmatterFlowSequence(key, rawValue, lineNumber);
    return;
  }
  if (key === "network.enforce") {
    meta.networkEnforce = value.toLowerCase() === "true";
    return;
  }
  if (key === "lockHash") {
    if (value.length > 0) meta.lockHash = value;
    return;
  }
  if (key === "tools.deny") {
    meta.toolsDeny = parseFrontmatterFlowSequence(key, rawValue, lineNumber);
    return;
  }
  if (key === "model") {
    maybeApplyModelFrontmatter(meta, rawValue, value);
  }
}

function parsePlanFrontmatter(meta, content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) return;
  const fmLines = fmMatch[1].split(/\r?\n/);
  for (let fmIdx = 0; fmIdx < fmLines.length; fmIdx++) {
    const fmLine = fmLines[fmIdx];
    const kv = fmLine.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*?)\s*$/);
    if (!kv) continue;
    let value = kv[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    applyPlanFrontmatter({ meta: meta, key: kv[1], rawValue: kv[2], value: value, lineNumber: fmIdx + 2 });
  }
}

export function parsePlan(planPath, cwd = process.cwd()) {
  const fullPath = resolvePlanPath(planPath, cwd);
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const meta = parseMeta(lines);
  const scopeContract = parseScopeContract(lines);
  const parserCfg = loadPlanParserConfig(cwd);
  const slices = parseSlices(lines, { implicitGates: parserCfg.implicitGates });
  const dag = buildDAG(slices);

  parsePlanFrontmatter(meta, content);

  return { meta, scopeContract, slices, dag };
}

/**
 * Compute the lockHash for a plan per decision #6 (Phase-WORKER-GUARDRAILS A6).
 *
 * Hash scope: sha256 over the concatenation of (per slice, in document order):
 *   - `### Slice N:` header line
 *   - `**Scope** (files in scope):` bullet list
 *   - `**Validation Gate**:` code block content
 * Plus the plan's top-level `### Forbidden Actions` (or `### Forbidden`) list.
 *
 * Frontmatter is stripped before hashing so editing only the frontmatter
 * (e.g. updating the lockHash field itself) does not invalidate the hash.
 *
 * @param {string} planContent - raw plan file content
 * @returns {string} sha256 hex digest
 */
export function computeLockHash(planContent) {
  // Strip frontmatter so it does not participate in the hash
  const body = planContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const lines = body.split(/\r?\n/);
  const parts = [];

  // ── Pass 1: Forbidden Actions bullet list ─────────────────────────────────
  let inForbidden = false;
  for (const line of lines) {
    if (/^###\s+Forbidden(\s+Actions)?\b/i.test(line)) {
      inForbidden = true;
      continue;
    }
    if (inForbidden) {
      if (/^##/.test(line)) { inForbidden = false; continue; }
      parts.push(line);
    }
  }

  // ── Pass 2: Per-slice Scope list + Validation Gate block ──────────────────
  let inSlice = false;
  let inScope = false;
  let inGate = false;
  let inFence = false;

  for (const line of lines) {
    // New slice header
    if (/^#{2,4}\s+Slice\s+\d+\b/.test(line)) {
      inSlice = true;
      inScope = false;
      inGate = false;
      inFence = false;
      parts.push(line);
      continue;
    }

    if (!inSlice) continue;

    // Code fence boundary
    if (line.startsWith("```")) {
      if (inFence) {
        // Closing fence
        if (inGate) { parts.push(line); inGate = false; }
        inFence = false;
      } else {
        inFence = true;
        if (inGate) parts.push(line);
        inScope = false;
      }
      continue;
    }

    // Inside a code fence — capture if inside gate
    if (inFence) {
      if (inGate) parts.push(line);
      continue;
    }

    // Scope marker (accepts either column-0 `**Scope**…` or list-item `- **Scope**…` form)
    if (/^\s*(?:[-*]\s+)?\*\*Scope\*\*\s*\(files in scope\)\s*:/i.test(line)) {
      inScope = true;
      inGate = false;
      parts.push(line);
      continue;
    }

    // Validation Gate marker (accepts either column-0 or list-item form)
    if (/^\s*(?:[-*]\s+)?\*\*Validation Gate\*\*\s*:/i.test(line)) {
      inScope = false;
      inGate = true;
      parts.push(line);
      continue;
    }

    // Any other bold section heading (not scope/gate) resets state — both forms
    if (/^\s*(?:[-*]\s+)?\*\*[A-Z][^*]*\*\*\s*:/.test(line)) {
      inScope = false;
      inGate = false;
      continue;
    }

    // Capture scope bullet lines
    if (inScope) {
      if (/^\s*[-*]/.test(line)) {
        parts.push(line);
      } else if (line.trim() === "") {
        inScope = false;
      }
    }
  }

  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function parseMeta(lines) {
  const meta = { title: "", status: "", branch: "", plan: "" };
  for (const line of lines) {
    if (line.startsWith("# ")) {
      meta.title = line.replace(/^#+\s*/, "").trim();
      break;
    }
  }
  for (const line of lines) {
    const statusMatch = line.match(/\*\*Status\*\*:\s*(.+)/);
    if (statusMatch) meta.status = statusMatch[1].trim();
    const branchMatch = line.match(/\*\*Feature Branch\*\*:\s*`([^`]+)`/);
    if (branchMatch) meta.branch = branchMatch[1];
  }
  return meta;
}

function isScopeContractTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  // Skip separator rows like | --- | :---: |
  return !/^\|[\s:|-]+\|?\s*$/.test(trimmed);
}

function applyScopeContractTableRow(contract, line) {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  const rowText = cells.join(" ").toLowerCase();
  // Check the compound phrases before the "in scope" substring to avoid
  // "out of scope" being misread as "in scope".
  let category = null;
  if (/out[\s-]*of[\s-]*scope/.test(rowText)) category = "outOfScope";
  else if (/forbidden/.test(rowText)) category = "forbidden";
  else if (/in[\s-]*scope/.test(rowText)) category = "inScope";
  if (!category) return;
  appendUniqueValues(contract[category], extractBacktickValues(cells.join(" ")));
}

export function parseScopeContract(lines) {
  const contract = { inScope: [], outOfScope: [], forbidden: [] };
  let section = null;
  let inContractSection = false;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      inContractSection = /scope\s+contract/i.test(h2[1]);
      section = null;
      continue;
    }
    if (line.match(/^###\s+In Scope/i)) { section = "inScope"; continue; }
    if (line.match(/^###\s+Out of Scope/i)) { section = "outOfScope"; continue; }
    if (line.match(/^###\s+Forbidden/i)) { section = "forbidden"; continue; }
    if (section && line.startsWith("- ")) {
      contract[section].push(line.replace(/^-\s*/, "").trim());
      continue;
    }
    // Markdown-table Scope Contract (meta-bug #231): only inside the
    // `## Scope Contract` section so slice-level tables never leak in.
    if (inContractSection && isScopeContractTableRow(line)) {
      applyScopeContractTableRow(contract, line);
    }
  }
  return contract;
}

/**
 * Parse slices from plan Markdown. Supports multiple header formats.
 *
 * Tags parsed from headers (M6):
 *   [depends: Slice 1]           → dependency
 *   [depends: Slice 1, Slice 3]  → multiple dependencies
 *   [P]                          → parallel-eligible (Phase 6)
 *   [scope: src/auth/**]         → file scope metadata
 */
function appendUniqueValues(target, values) {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function appendValidationGateText(current, body) {
  current.validationGate = (current.validationGate ? current.validationGate + "\n" : "") + body;
}

function createSliceRecord(sliceMatch, rawTags) {
  const rawNumber = sliceMatch[1];
  const rawTitle = sliceMatch[2].trim();
  const current = {
    number: rawNumber,
    title: rawTitle,
    depends: [],
    parallel: false,
    competitive: false,
    competitiveVariants: null,
    scope: [],
    contextFiles: [],
    buildCommand: null,
    testCommand: null,
    validationGate: null,
    stopCondition: null,
    workerTimeoutMs: null,
    tasks: [],
    rawLines: [],
  };

  const dependsMatch = rawTags.match(/\[(?:depends\s+on|depends|dep|needs):\s*([^\]]+)\]/i);
  if (dependsMatch) {
    current.depends = dependsMatch[1]
      .split(",")
      .map((d) => normalizeSliceId(d));
  }

  if (/\[(?:P|parallel(?:-safe)?)\]/i.test(rawTags)) current.parallel = true;

  const competitiveMatch = rawTags.match(/\[competitive(?::\s*(\d+))?\]/i);
  if (competitiveMatch) {
    current.competitive = true;
    if (competitiveMatch[1]) current.competitiveVariants = parseInt(competitiveMatch[1], 10);
  }

  const scopeMatch = rawTags.match(/\[scope:\s*([^\]]+)\]/i);
  if (scopeMatch) current.scope = scopeMatch[1].split(",").map((s) => s.trim());
  if (rawTitle.includes("✅") || rawTags.includes("✅")) current.status = "completed";

  return current;
}

function handleCodeFenceLine(state, line) {
  if (!line.startsWith("```")) return false;
  state.inFilesInScopeBlock = false;

  if (state.inCodeBlock) {
    if (state.inValidationGate && state.current) {
      appendValidationGateText(state.current, state.codeBlockContent.join("\n").trim());
      if (state.implicitGateActive) {
        state.current.implicitGate = true;
        state.implicitGateActive = false;
      }
      state.inValidationGate = false;
    }
    state.codeBlockContent = [];
    state.inCodeBlock = false;
    return true;
  }

  state.inCodeBlock = true;
  state.codeBlockContent = [];
  const lang = line.slice(3).trim().toLowerCase();
  const isShellLang = lang === "bash" || lang === "sh" || lang === "";
  if (state.current && isShellLang) {
    state.current._bashBlockCount = (state.current._bashBlockCount || 0) + 1;
    if (state.implicitGates && !state.current.validationGate && !state.inValidationGate) {
      state.inValidationGate = true;
      state.implicitGateActive = true;
    }
  }
  return true;
}

function handleCodeBlockContentLine(state, line) {
  if (!state.inCodeBlock) return false;
  state.codeBlockContent.push(line);
  return true;
}

function handleSliceHeaderLine(state, line) {
  const sliceMatch = line.match(
    /^#{2,4}\s+slice\s+([\d.]+[A-Za-z]?)\s*[:\u2014\u2013—–-]\s*(.+?)(?:\s*\[.+?\])*\s*$/ui
  );
  if (!sliceMatch) return false;
  if (state.current) state.slices.push(state.current);
  state.inFilesInScopeBlock = false;
  state.current = createSliceRecord(sliceMatch, line);
  return true;
}

function handleValidationGateLine(state, line) {
  const gateMatch = line.match(/\*\*(?:Validation Gate|Exit [Gg]ate)\*?\*?\s*:?\s*(.*)$/i);
  if (!gateMatch) return false;
  state.inFilesInScopeBlock = false;
  const inlineText = (gateMatch[1] || "").trim();
  if (inlineText && state.current) {
    const backtickCmds = [];
    const backtickRe = /`([^`]+)`/g;
    let bm;
    while ((bm = backtickRe.exec(inlineText)) !== null) backtickCmds.push(bm[1]);
    if (backtickCmds.length > 0) appendValidationGateText(state.current, backtickCmds.join("\n"));
    else state.current.validationGateDescription = inlineText;
  }
  state.inValidationGate = true;
  return true;
}

function applyBuildCommand(current, line) {
  const buildMatch = line.match(/\*\*Build [Cc]ommand\*\*:\s*`(.+?)`/i);
  if (buildMatch) current.buildCommand = buildMatch[1];
}

function applyTestCommand(current, line) {
  const testMatch = line.match(/\*\*Test [Cc]ommand\*\*:\s*`(.+?)`/i);
  if (testMatch) current.testCommand = testMatch[1];
}

function applyStopCondition(current, line) {
  const stopMatch = line.match(/\*\*Stop Condition\*\*:\s*(.+)/);
  if (stopMatch) current.stopCondition = stopMatch[1].trim();
}

function applyWorkerTimeout(current, line) {
  const workerTimeoutMatch = line.match(/\*\*WorkerTimeoutMs\*\*:\s*(.+)/i);
  if (!workerTimeoutMatch) return;
  const parsed = parseWorkerTimeoutValue(workerTimeoutMatch[1].trim());
  if (parsed !== null) current.workerTimeoutMs = parsed;
}

function applyBodyDependencies(current, line) {
  const dependsBodyMatch = line.match(/\*\*Depends\s+On:?\*\*:?\s*(.+)/i);
  if (!dependsBodyMatch) return;
  // Bug #225: split on commas, then pull the LEADING slice-id token out of each
  // phrase. The hardener authors prose deps like
  //   "**Depends On**: S1 (consumes presets.ts), and Group B merge checkpoint."
  // Running normalizeSliceId() on the whole phrase left unmatched prose in
  // node.depends, which the scheduler could never satisfy → 0-slice phantom run.
  const bodyDeps = dependsBodyMatch[1]
    .split(/\s*,\s*/)
    .map((d) => extractLeadingSliceId(d))
    .filter((d) => d && d.length > 0);
  appendUniqueValues(current.depends, bodyDeps);
}

/**
 * Extract the leading slice-id token from a free-text dependency phrase.
 * Tolerates the prose forms the hardener emits: "Slice 1", "S1", "1", "2.3A".
 * Returns the normalized id, or null when the phrase has no leading slice id
 * (e.g. "none (foundation)", "and Group B merge checkpoint.").
 *
 * @param {string} phrase
 * @returns {string|null}
 */
function extractLeadingSliceId(phrase) {
  const m = String(phrase).trim().match(/^(?:slice\s+)?s?(\d+(?:\.\d+)?)([A-Za-z]?)\b/i);
  if (!m) return null;
  const normalized = normalizeSliceId(m[1] + m[2]);
  return normalized.length > 0 ? normalized : null;
}

function extractBacktickValues(text) {
  const backticks = text.match(/`([^`]+)`/g) || [];
  return backticks.map((s) => s.replace(/`/g, "").trim()).filter((s) => s.length > 0);
}

function applyContextFiles(current, line) {
  const contextBodyMatch = line.match(/\*\*Context Files:?\*\*:?\s*(.+)/i);
  if (!contextBodyMatch) return;
  // Context Files are read-only references, not the editable scope allowlist
  // (meta-bug #231): keep them out of `scope` so they cannot be modified and
  // so scope enforcement is not silently widened to instruction docs.
  if (!current.contextFiles) current.contextFiles = [];
  appendUniqueValues(current.contextFiles, extractBacktickValues(contextBodyMatch[1]));
}

function extractInlineScopeCandidates(rest) {
  const backtickValues = extractBacktickValues(rest);
  if (backtickValues.length > 0) return backtickValues;
  if (!rest) return [];
  return rest
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/[.,;]+$/, ""))
    .filter((s) => s.length > 0 && /[\/.*]/.test(s));
}

function extractBulletScopeCandidates(body) {
  const backtickValues = extractBacktickValues(body);
  if (backtickValues.length > 0) return backtickValues;
  const firstToken = body.split(/[\s,]+/)[0].replace(/[.,;]+$/, "");
  return firstToken && /[\/.*]/.test(firstToken) ? [firstToken] : [];
}

function handleFilesHeading(state, line) {
  // Accept any bold heading that begins with "Files" or "Scope" so markers
  // like `**Scope (files):**` and `**Scope** (files in scope):` are honored
  // (meta-bug #231), with the colon inside or outside the bold span.
  const filesBodyMatch = line.match(/^\s*[-*]?\s*\*\*\s*(?:files|scope)\b[^*]*\*\*\s*(?:\([^)]*\))?\s*:?\s*(.*)$/i);
  if (!filesBodyMatch) return false;
  const candidates = extractInlineScopeCandidates((filesBodyMatch[1] || "").trim());
  appendUniqueValues(state.current.scope, candidates);
  state.inFilesInScopeBlock = candidates.length === 0;
  return true;
}

function handleFilesInScopeContinuation(state, line) {
  if (!state.inFilesInScopeBlock) return false;
  const trimmed = line.trim();
  if (!trimmed) {
    state.inFilesInScopeBlock = false;
    return false;
  }
  if (/^\*\*/.test(trimmed) || /^#/.test(trimmed)) {
    state.inFilesInScopeBlock = false;
    return false;
  }
  const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
  if (!bulletMatch) {
    state.inFilesInScopeBlock = false;
    return false;
  }
  appendUniqueValues(state.current.scope, extractBulletScopeCandidates(bulletMatch[1]));
  return true;
}

function applyTaskLine(current, line) {
  const taskMatch = line.match(/^\d+\.\s+(.+)/);
  if (taskMatch) current.tasks.push(taskMatch[1].trim());
}

export function parseSlices(lines, opts = {}) {
  const state = {
    implicitGates: opts.implicitGates === true,
    slices: [],
    current: null,
    inCodeBlock: false,
    inValidationGate: false,
    codeBlockContent: [],
    inFilesInScopeBlock: false,
    implicitGateActive: false,
  };

  for (const line of lines) {
    if (handleCodeFenceLine(state, line)) continue;
    if (handleCodeBlockContentLine(state, line)) continue;
    if (handleSliceHeaderLine(state, line)) continue;
    if (!state.current) continue;

    state.current.rawLines.push(line);
    applyBuildCommand(state.current, line);
    applyTestCommand(state.current, line);
    if (handleValidationGateLine(state, line)) continue;
    applyStopCondition(state.current, line);
    applyWorkerTimeout(state.current, line);
    applyBodyDependencies(state.current, line);
    applyContextFiles(state.current, line);
    if (handleFilesHeading(state, line)) continue;
    if (handleFilesInScopeContinuation(state, line)) continue;
    applyTaskLine(state.current, line);
  }

  if (state.current) state.slices.push(state.current);
  return state.slices;
}

/**
 * Normalize a slice ID: strip "Slice " prefix, trim, uppercase trailing alpha.
 * e.g. "Slice 2a" → "2A", " 3 " → "3", "2B" → "2B"
 */
export function normalizeSliceId(raw) {
  const m = String(raw).trim().replace(/^slice\s+/i, "").match(/^([\d.]+)([A-Za-z]?)$/);
  return m ? m[1] + m[2].toUpperCase() : String(raw).trim();
}

/**
 * Compare two slice IDs for sorting. Numeric part first, then optional alpha suffix.
 * Empty suffix sorts before any letter: 2 < 2A < 2B < 3.
 */
export function compareSliceIds(a, b) {
  const re = /^([\d.]+)([A-Za-z]?)$/;
  const ma = String(a).match(re);
  const mb = String(b).match(re);
  if (!ma || !mb) return String(a).localeCompare(String(b));
  const na = parseFloat(ma[1]);
  const nb = parseFloat(mb[1]);
  if (na !== nb) return na - nb;
  const sa = ma[2].toUpperCase();
  const sb = mb[2].toUpperCase();
  if (sa === sb) return 0;
  if (sa === "") return -1;
  if (sb === "") return 1;
  return sa.localeCompare(sb);
}

/**
 * Build a DAG from parsed slices.
 * If no explicit dependencies, assume sequential (each depends on prior).
 *
 * @returns {{ nodes: Map, order: string[] }}
 */
export function buildDAG(slices) {
  const nodes = new Map();

  // Create nodes
  for (const slice of slices) {
    nodes.set(slice.number, {
      ...slice,
      children: [],
      inDegree: 0,
    });
  }

  // Build edges
  const hasAnyDeps = slices.some((s) => s.depends.length > 0);

  if (hasAnyDeps) {
    // Explicit dependency mode — use declared dependencies
    for (const slice of slices) {
      for (const dep of slice.depends) {
        const parent = nodes.get(dep);
        if (parent) {
          parent.children.push(slice.number);
          nodes.get(slice.number).inDegree++;
        }
      }
    }
  } else {
    // Sequential mode — each slice depends on the previous one
    for (let i = 1; i < slices.length; i++) {
      const prev = slices[i - 1].number;
      const curr = slices[i].number;
      nodes.get(prev).children.push(curr);
      nodes.get(curr).inDegree++;
    }
  }

  // Topological sort (Kahn's algorithm)
  const order = topologicalSort(nodes);

  return { nodes, order };
}

function topologicalSort(nodes) {
  const queue = [];
  const order = [];
  const inDegree = new Map();

  for (const [id, node] of nodes) {
    inDegree.set(id, node.inDegree);
    if (node.inDegree === 0) queue.push(id);
  }

  // Deterministic tiebreak: sort ready queue by slice ID
  queue.sort(compareSliceIds);

  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    const node = nodes.get(id);
    const newlyReady = [];
    for (const child of node.children) {
      inDegree.set(child, inDegree.get(child) - 1);
      if (inDegree.get(child) === 0) newlyReady.push(child);
    }
    // Insert newly ready nodes in sorted order
    if (newlyReady.length > 0) {
      newlyReady.sort(compareSliceIds);
      queue.push(...newlyReady);
      queue.sort(compareSliceIds);
    }
  }

  if (order.length !== nodes.size) {
    throw new Error("Cycle detected in slice dependencies — cannot build DAG");
  }

  return order;
}


/**
 * Meta-bug #89: plan-parser configuration loader.
 * Returns { implicitGates } with defaults. Opt-in only — false by default
 * so existing plans with illustrative bash blocks in slice prose are not
 * accidentally executed as gates.
 */
export function loadPlanParserConfig(cwd = process.cwd()) {
  const defaults = { implicitGates: false };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (!existsSync(configPath)) return defaults;
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const block = raw?.runtime?.planParser;
    if (!block || typeof block !== "object") return defaults;
    return {
      implicitGates: block.implicitGates === true,
    };
  } catch {
    return defaults;
  }
}
