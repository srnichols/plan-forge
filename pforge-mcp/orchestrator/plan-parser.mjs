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
function parseWorkerTimeoutValue(raw) {
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
export function parsePlan(planPath, cwd = process.cwd()) {
  const fullPath = resolve(planPath);
  // C4: Validate path is within project to prevent traversal
  // Normalize to lowercase for comparison on Windows where drive letters are case-insensitive
  const projectRoot = resolve(cwd);
  const normalizedFull = fullPath.toLowerCase();
  const normalizedRoot = projectRoot.toLowerCase();
  if (!normalizedFull.startsWith(normalizedRoot)) {
    throw new Error(`Plan path must be within project directory: ${planPath}`);
  }
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  const meta = parseMeta(lines);
  const scopeContract = parseScopeContract(lines);
  // Meta-bug #89: optional implicit-gate capture — when enabled, a bare
  // bash/sh code block under a slice header with no explicit
  // **Validation Gate**: marker is treated as the gate. Opt-in via
  // .forge.json → runtime.planParser.implicitGates = true (default false).
  const parserCfg = loadPlanParserConfig(cwd);
  const slices = parseSlices(lines, { implicitGates: parserCfg.implicitGates });
  const dag = buildDAG(slices);

  // v2.37 Crucible (Slice 01.4): expose crucibleId + import source on
  // plan.meta so downstream code (status, reporting, dashboard) can
  // display provenance. Enforcement happens in runPlan(), not here —
  // parsePlan() avoids enforcement/mutation side effects but may emit
  // advisory console.warn for invalid frontmatter values (e.g. Bug #127).
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    // fmIdx + 2 gives the 1-based file line number (line 1 is "---", line 2 is first fm key)
    const fmLines = fmMatch[1].split(/\r?\n/);
    for (let fmIdx = 0; fmIdx < fmLines.length; fmIdx++) {
      const fmLine = fmLines[fmIdx];
      // Phase-WORKER-GUARDRAILS Slice 4: key pattern extended to allow dots (network.allowed, network.enforce)
      const kv = fmLine.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*?)\s*$/);
      if (!kv) continue;
      let v = kv[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (kv[1] === "crucibleId") meta.crucibleId = v;
      else if (kv[1] === "lane") meta.lane = v;
      else if (kv[1] === "source") meta.crucibleSource = v;
      // Phase-WORKER-GUARDRAILS Slice 4 (A5): network.allowed — YAML flow sequence of allowed hostnames
      else if (kv[1] === "network.allowed") {
        const rawV = kv[2].trim();
        if (!rawV.startsWith("[") || !rawV.endsWith("]")) {
          throw new Error(
            `frontmatter network.allowed must be a YAML flow sequence (e.g. [host1, host2]) ` +
            `at line ${fmIdx + 2} — got: ${kv[2]}`
          );
        }
        const inner = rawV.slice(1, -1).trim();
        meta.networkAllowed = inner ? inner.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean) : [];
      }
      // Phase-WORKER-GUARDRAILS Slice 4 (A5): network.enforce — default false (log-only)
      else if (kv[1] === "network.enforce") {
        meta.networkEnforce = v.toLowerCase() === "true";
      }
      // Phase-WORKER-GUARDRAILS Slice 5 (A6): lockHash — sha256 of plan body anchors
      else if (kv[1] === "lockHash") {
        if (v.length > 0) meta.lockHash = v;
      }
      // Phase-WORKER-GUARDRAILS Slice 6 (A8): tools.deny — YAML flow sequence of MCP tool names the worker may not call
      else if (kv[1] === "tools.deny") {
        const rawV = kv[2].trim();
        if (!rawV.startsWith("[") || !rawV.endsWith("]")) {
          throw new Error(
            `frontmatter tools.deny must be a YAML flow sequence (e.g. [tool1, tool2]) ` +
            `at line ${fmIdx + 2} — got: ${kv[2]}`
          );
        }
        const inner = rawV.slice(1, -1).trim();
        meta.toolsDeny = inner ? inner.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean) : [];
      }
      else if (kv[1] === "model") {
        const rawValue = kv[2];
        const isQuotedValue =
          (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'"));
        const looksLikeNonString =
          !isQuotedValue &&
          (/^\d+(\.\d+)?$/.test(v) ||
            /^(true|false|null|~)$/i.test(v) ||
            /^[{\[]/.test(v));
        if (looksLikeNonString) {
          // eslint-disable-next-line no-console
          console.warn("[model] frontmatter model: ignored — not a string");
        } else if (v.length > 0) {
          meta.model = v;
        }
      }
    }
  }

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

function parseScopeContract(lines) {
  const contract = { inScope: [], outOfScope: [], forbidden: [] };
  let section = null;

  for (const line of lines) {
    if (line.match(/^###\s+In Scope/i)) { section = "inScope"; continue; }
    if (line.match(/^###\s+Out of Scope/i)) { section = "outOfScope"; continue; }
    if (line.match(/^###\s+Forbidden/i)) { section = "forbidden"; continue; }
    if (line.match(/^##\s/) && section) { section = null; continue; }
    if (section && line.startsWith("- ")) {
      contract[section].push(line.replace(/^-\s*/, "").trim());
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
export function parseSlices(lines, opts = {}) {
  const implicitGates = opts.implicitGates === true;
  const slices = [];
  let current = null;
  let inCodeBlock = false;
  let inValidationGate = false;
  let codeBlockContent = [];
  // Issue #130 — when set, subsequent bullet lines are appended to current.scope
  // until a blank line, another bold heading, or a non-bullet line is reached.
  // Reset whenever we hit a slice header, a fence, or a non-matching line.
  let inFilesInScopeBlock = false;
  // Meta-bug #89: track whether the current code block was captured as an
  // implicit validation gate (bare bash/sh block under a slice header with
  // no prior **Validation Gate**: marker). Lint-tracked separately from
  // explicit marker capture so callers can distinguish behaviours.
  let implicitGateActive = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code blocks
    if (line.startsWith("```")) {
      // Issue #130 \u2014 a fence always closes any open Files-in-scope window.
      inFilesInScopeBlock = false;
      if (inCodeBlock) {
        // Closing code block
        if (inValidationGate && current) {
          const body = codeBlockContent.join("\n").trim();
          current.validationGate = (current.validationGate ? current.validationGate + "\n" : "") + body;
          if (implicitGateActive) {
            current.implicitGate = true;
            implicitGateActive = false;
          }
          inValidationGate = false;
        }
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockContent = [];
        // Meta-bug #89: lint — record that this slice had a bash/sh block
        // in its body so analyzers can warn when no explicit gate marker
        // was declared. Capture language off the opening fence.
        const lang = line.slice(3).trim().toLowerCase();
        const isShellLang = lang === "bash" || lang === "sh" || lang === "";
        if (current && isShellLang) {
          current._bashBlockCount = (current._bashBlockCount || 0) + 1;
          // Implicit-gate capture (opt-in): first bare bash/sh block under
          // a slice header with no explicit **Validation Gate**: marker
          // becomes the validation gate. Default off — callers must pass
          // { implicitGates: true } to enable (see loadPlanParserConfig).
          if (implicitGates && !current.validationGate && !inValidationGate) {
            inValidationGate = true;
            implicitGateActive = true;
          }
        }
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Match slice headers (case-insensitive, flexible separators):
    //   ### Slice N: Title
    //   #### Slice N: Title (nested under Session/Group subheadings)
    //   ### slice N — Title
    //   ### SLICE N.N - Title
    //   ### Slice 2A: Title (optional single trailing alpha)
    const sliceMatch = line.match(
      /^#{2,4}\s+slice\s+([\d.]+[A-Za-z]?)\s*[:\u2014\u2013—–-]\s*(.+?)(?:\s*\[.+?\])*\s*$/ui
    );
    if (sliceMatch) {
      // Save previous slice
      if (current) slices.push(current);
      // Issue #130 \u2014 reset any open Files-in-scope window when crossing a
      // slice boundary so file lists never leak between slices.
      inFilesInScopeBlock = false;

      const rawNumber = sliceMatch[1];
      const rawTitle = sliceMatch[2].trim();
      const rawTags = line; // Re-parse tags from full line

      current = {
        number: rawNumber,
        title: rawTitle,
        depends: [],
        parallel: false,
        competitive: false,
        competitiveVariants: null,
        scope: [],
        buildCommand: null,
        testCommand: null,
        validationGate: null,
        stopCondition: null,
        workerTimeoutMs: null,
        tasks: [],
        rawLines: [],
      };

      // Parse tags from the full header line
      // Fuzzy depends: [depends: ...], [depends on: ...], [dep: ...], [needs: ...]
      const dependsMatch = rawTags.match(/\[(?:depends\s+on|depends|dep|needs):\s*([^\]]+)\]/i);
      if (dependsMatch) {
        current.depends = dependsMatch[1]
          .split(",")
          .map((d) => normalizeSliceId(d));
      }

      // Fuzzy parallel: [P], [parallel], [parallel-safe]
      const parallelMatch = rawTags.match(/\[(?:P|parallel(?:-safe)?)\]/i);
      if (parallelMatch) current.parallel = true;

      // Phase-26 Slice 2 — [competitive] tag triggers CompetitiveScheduler.
      // Same-slice best-of-N via isolated worktrees. Opt-in per slice.
      const competitiveMatch = rawTags.match(/\[competitive(?::\s*(\d+))?\]/i);
      if (competitiveMatch) {
        current.competitive = true;
        if (competitiveMatch[1]) {
          current.competitiveVariants = parseInt(competitiveMatch[1], 10);
        }
      } else {
        current.competitive = false;
      }

      const scopeMatch = rawTags.match(/\[scope:\s*([^\]]+)\]/i);
      if (scopeMatch) {
        current.scope = scopeMatch[1].split(",").map((s) => s.trim());
      }

      // Check for status marker (✅)
      if (rawTitle.includes("✅") || rawTags.includes("✅")) {
        current.status = "completed";
      }

      continue;
    }

    if (!current) continue;

    // Collect raw lines for the current slice
    current.rawLines.push(line);

    // Parse build command (case-insensitive)
    const buildMatch = line.match(/\*\*Build [Cc]ommand\*\*:\s*`(.+?)`/i);
    if (buildMatch) current.buildCommand = buildMatch[1];

    // Parse test command (case-insensitive)
    const testMatch = line.match(/\*\*Test [Cc]ommand\*\*:\s*`(.+?)`/i);
    if (testMatch) current.testCommand = testMatch[1];

    // Detect validation gate section
    // Supports two formats:
    //   1. **Validation Gate**: <inline text>  (prose description, no code block)
    //   2. **Validation Gate**:\n```bash\n<commands>\n```  (fenced code block)
    // Issue #130 — also accept **Exit gate** as an alias for Validation Gate;
    // many hand-authored plans use that label and the absence of a parser
    // match silently produced "No validation gate defined" + false-positive passes.
    const gateMatch = line.match(/\*\*(?:Validation Gate|Exit [Gg]ate)\*?\*?\s*:?\s*(.*)$/i);
    if (gateMatch) {
      inFilesInScopeBlock = false;
      const inlineText = (gateMatch[1] || "").trim();
      if (inlineText && current) {
        // Inline gate text — extract backtick-wrapped commands or use prose
        const backtickCmds = [];
        const backtickRe = /`([^`]+)`/g;
        let bm;
        while ((bm = backtickRe.exec(inlineText)) !== null) backtickCmds.push(bm[1]);
        if (backtickCmds.length > 0) {
          current.validationGate = (current.validationGate ? current.validationGate + "\n" : "") + backtickCmds.join("\n");
        } else {
          // Store prose description as gate (regression guard won't execute it, but it's discoverable)
          current.validationGateDescription = inlineText;
        }
      }
      inValidationGate = true;
      continue;
    }

    // Parse stop condition
    const stopMatch = line.match(/\*\*Stop Condition\*\*:\s*(.+)/);
    if (stopMatch) current.stopCondition = stopMatch[1].trim();

    // Parse per-slice worker timeout override
    const workerTimeoutMatch = line.match(/\*\*WorkerTimeoutMs\*\*:\s*(.+)/i);
    if (workerTimeoutMatch) {
      const parsed = parseWorkerTimeoutValue(workerTimeoutMatch[1].trim());
      if (parsed !== null) current.workerTimeoutMs = parsed;
    }

    // Parse body-line **Depends On:** — merges with any [depends: ...] header tag.
    // Formats supported (colon can be inside OR outside the bold markers):
    //   **Depends On:** Slice 1, Slice 2A (auth required)
    //   **Depends On**: Slice 0
    const dependsBodyMatch = line.match(/\*\*Depends\s+On:?\*\*:?\s*(.+)/i);
    if (dependsBodyMatch) {
      // Strip trailing parenthetical notes, then split on commas
      const rawDeps = dependsBodyMatch[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
      const bodyDeps = rawDeps
        .split(/\s*,\s*/)
        .map((d) => normalizeSliceId(d))
        .filter((d) => d.length > 0);
      // Merge with header-tag deps, de-dup
      for (const d of bodyDeps) {
        if (!current.depends.includes(d)) current.depends.push(d);
      }
    }

    // Parse body-line **Context Files:** — merges with any [scope: ...] header tag.
    // Extracts backtick-wrapped paths. Colon may appear inside OR outside bold markers.
    //   **Context Files:** `path/to/file.md`, `.github/instructions/auth.md`
    const contextBodyMatch = line.match(/\*\*Context Files:?\*\*:?\s*(.+)/i);
    if (contextBodyMatch) {
      const backticks = contextBodyMatch[1].match(/`([^`]+)`/g) || [];
      const files = backticks.map((s) => s.replace(/`/g, "").trim()).filter((s) => s.length > 0);
      for (const f of files) {
        if (!current.scope.includes(f)) current.scope.push(f);
      }
    }

    // Issues #108/#109/#113/#115: plans frequently use **Files:** to list the
    // files a slice will create or modify. Without parsing this, the
    // orchestrator-injected SCOPE clause was built only from [scope: ...] /
    // **Context Files:** and contradicted the plan's own Files list. Merge
    // them so SCOPE always covers what the plan declares as in-scope.
    //
    // Match: **Files:** `a.ts`, `b.ts`  /  **Files**: a.ts, b.ts
    //        **Files in scope**: `a.ts`, `b.ts`
    // We only treat backtick-wrapped or whitespace-separated path-like tokens
    // as files; prose lines that happen to start with the word "Files" are
    // ignored when no path tokens are found.
    //
    // Issue #130 — also accept the multi-line bullet-list form:
    //   **Files in scope**
    //   - `path/to/file.tsx` — prose description
    //   - `path/to/other.tsx` — more prose
    // The orchestrator silently no-op'd Phase-57 Slice 5 because it parsed
    // **Context Files** as the edit allow-list and never saw **Files in scope**.
    const filesBodyMatch = line.match(/^\s*[-*]?\s*\*\*Files(?:\s+in\s+scope)?:?\*\*:?\s*(.*)$/i);
    if (filesBodyMatch) {
      const rest = (filesBodyMatch[1] || "").trim();
      const backticks = rest.match(/`([^`]+)`/g) || [];
      let candidates = backticks.map((s) => s.replace(/`/g, "").trim());
      if (candidates.length === 0 && rest.length > 0) {
        // No backticks — fall back to comma/whitespace splitting and keep
        // only tokens that look like a path (contain '/' or '.' or end in *).
        candidates = rest
          .split(/[\s,]+/)
          .map((s) => s.trim().replace(/[.,;]+$/, ""))
          .filter((s) => s.length > 0 && /[\/.*]/.test(s));
      }
      for (const f of candidates) {
        if (!current.scope.includes(f)) current.scope.push(f);
      }
      // Issue #130 — if the heading line carried no inline files, the file
      // list is on subsequent bullet lines. Open a multi-line capture window.
      inFilesInScopeBlock = candidates.length === 0;
      continue;
    }

    // Issue #130 — multi-line `**Files in scope**` bullet capture. While the
    // window is open, every `- `/`* ` line is parsed for backtick-wrapped or
    // path-like tokens. The window closes on a blank line, a new bold heading,
    // or any non-bullet line.
    if (inFilesInScopeBlock) {
      const trimmed = line.trim();
      if (!trimmed) {
        inFilesInScopeBlock = false;
      } else if (/^\*\*/.test(trimmed) || /^#/.test(trimmed)) {
        inFilesInScopeBlock = false;
        // fall through so this line is parsed by the rules below
      } else {
        const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
        if (bulletMatch) {
          const body = bulletMatch[1];
          const backticks = body.match(/`([^`]+)`/g) || [];
          let candidates = backticks.map((s) => s.replace(/`/g, "").trim());
          if (candidates.length === 0) {
            // First whitespace-separated token that looks like a path.
            const firstToken = body.split(/[\s,]+/)[0].replace(/[.,;]+$/, "");
            if (firstToken && /[\/.*]/.test(firstToken)) candidates = [firstToken];
          }
          for (const f of candidates) {
            if (!current.scope.includes(f)) current.scope.push(f);
          }
          continue;
        } else {
          inFilesInScopeBlock = false;
          // fall through
        }
      }
    }

    // Parse numbered tasks
    const taskMatch = line.match(/^\d+\.\s+(.+)/);
    if (taskMatch) current.tasks.push(taskMatch[1].trim());
  }

  // Push last slice
  if (current) slices.push(current);

  return slices;
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
