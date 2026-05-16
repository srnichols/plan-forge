/**
 * Plan Forge — Export Plan
 *
 * Converts a loose plan (e.g., from a Copilot cloud agent session) into a
 * hardened Plan Forge `Phase-X-PLAN.md` document.
 *
 * Input: Markdown text with a title (# heading) and steps (numbered or
 *   bulleted list).
 * Output: A fully-scaffolded Plan Forge plan with scope contract, forbidden
 *   actions template, per-step slices, validation gates, and a files table.
 *
 * @module export-plan
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, extname, basename } from "node:path";

// ─── Path Extraction ──────────────────────────────────────────────────────────

/**
 * Regex patterns for file path extraction.
 * Order matters — more-specific patterns first.
 */
const PATH_PATTERNS = [
  // Backtick-quoted paths: `src/foo.ts`
  /`([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]{1,10})`/g,
  // Straight-quoted paths: "src/foo.ts" or 'src/foo.ts'
  /["']([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]{1,10})["']/g,
  // Bare paths that start with known root segments: src/, lib/, test/, docs/, pforge-mcp/, .github/
  /\b((?:src|lib|tests?|spec|docs|scripts|pforge-mcp|pforge-sdk|\.github|\.forge|templates)\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]{1,10})\b/g,
];

const IGNORED_EXTENSIONS = new Set([".md", ".txt", ".html", ".svg", ".png", ".jpg", ".gif", ".ico"]);
const TEST_EXTENSIONS_RE = /\.(test|spec)\.[a-z]+$/;
const DOC_EXTENSIONS_RE = /\.(md|html|txt|svg|png|jpg|gif|ico)$/;

/**
 * Extract file paths mentioned in a piece of text.
 *
 * @param {string} text
 * @returns {string[]} Deduplicated file paths (order of first appearance)
 */
export function extractPaths(text) {
  const seen = new Set();
  const paths = [];

  for (const pattern of PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const p = m[1].replace(/\\/g, "/").replace(/^\/+/, "");
      if (!seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
    }
  }

  return paths;
}

// ─── Step Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse steps from a loose plan text. Recognises:
 *   - Numbered lists  (1. / 2. / 3.)
 *   - Checkbox items  (- [ ] / - [x])
 *   - Bulleted items  (- / * / •)
 *   - Sub-headings    (## / ###) when no list items are found
 *
 * @param {string} text
 * @returns {string[]} Ordered list of step strings (trimmed, no list prefix)
 */
export function parseSteps(text) {
  const lines = text.split(/\r?\n/);
  const steps = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Numbered: "1. ...", "10. ..."
    const numbered = /^\d+\.\s+(.+)/.exec(trimmed);
    if (numbered) { steps.push(numbered[1].trim()); continue; }

    // Checkbox: "- [ ] ..." or "- [x] ..."
    const checkbox = /^[-*]\s+\[[ xX]\]\s+(.+)/.exec(trimmed);
    if (checkbox) { steps.push(checkbox[1].trim()); continue; }

    // Bulleted: "- ..." or "* ..." or "• ..."
    const bulleted = /^[-*•]\s+(.+)/.exec(trimmed);
    if (bulleted) {
      const txt = bulleted[1].trim();
      if (txt) { steps.push(txt); }
      continue;
    }
  }

  // Fallback: treat sub-headings (## / ###) as steps if no list was found
  if (steps.length === 0) {
    for (const line of lines) {
      const heading = /^#{2,3}\s+(.+)/.exec(line.trim());
      if (heading) {
        const txt = heading[1].trim();
        if (txt && !["plan", "steps", "tasks", "implementation", "overview"].includes(txt.toLowerCase())) {
          steps.push(txt);
        }
      }
    }
  }

  return steps;
}

/**
 * Parse the title from the first `#` heading in the text.
 *
 * @param {string} text
 * @returns {string} Title or "Untitled Feature"
 */
export function parseTitle(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^#\s+(.+)/.exec(line.trim());
    if (m) return m[1].trim();
  }
  // Fallback: first non-empty non-heading line
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t.slice(0, 80);
  }
  return "Untitled Feature";
}

// ─── Phase Name Derivation ───────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "through", "during",
  "add", "adding", "update", "updating", "implement", "implementing",
  "create", "creating", "build", "building", "fix", "fixing", "refactor",
  "new", "support", "enable", "use", "using",
]);

/**
 * Derive a Plan Forge phase name slug from a title.
 * "Add rate limiting to the REST API" → "RATE-LIMIT-REST-API"
 *
 * @param {string} title
 * @returns {string} Uppercase hyphenated slug (max 4 words)
 */
export function derivePhaseSlug(title) {
  const words = title
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return words
    .slice(0, 4)
    .map((w) => w.toUpperCase())
    .join("-") || "FEATURE";
}

// ─── Validation Gate Generation ──────────────────────────────────────────────

/**
 * Generate a validation gate for a slice based on its files.
 *
 * @param {string[]} files Paths mentioned in this slice
 * @param {string}   stepText Original step text
 * @returns {string} Shell command block (bash-compatible)
 */
export function buildGate(files, stepText) {
  const testFiles = files.filter((f) => TEST_EXTENSIONS_RE.test(f));
  const codeFiles = files.filter((f) => !DOC_EXTENSIONS_RE.test(f) && !TEST_EXTENSIONS_RE.test(f));

  // Test file → run vitest
  if (testFiles.length > 0) {
    const testArg = testFiles.map((f) => f.replace(/^pforge-mcp\//, "")).join(" ");
    return `cd pforge-mcp && npx vitest run ${testArg} --reporter=dot 2>&1 | tail -5 | grep -qE 'Test Files.*passed' && echo ok`;
  }

  // Code files → existence check
  if (codeFiles.length > 0) {
    const checks = codeFiles.map((f) => `test -f ${f}`).join(" && ");
    return `${checks} && echo ok`;
  }

  // Default placeholder gate
  return `node -e "console.log('ok')" # TODO: replace with a real validation command`;
}

// ─── Slice Builder ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} Slice
 * @property {number}   number    Slice ordinal (1-based)
 * @property {string}   goal      Human description (the raw step text)
 * @property {string[]} files     File paths extracted from the step
 * @property {string}   gate      Shell command for the validation gate
 * @property {boolean}  isNew     True for any file marked new (no indicator → assume new)
 */

/**
 * Build a Slice descriptor from a step string.
 *
 * @param {string} step Step text
 * @param {number} n    Slice ordinal (1-based)
 * @returns {Slice}
 */
export function buildSlice(step, n) {
  const files = extractPaths(step);
  const gate = buildGate(files, step);
  const isNew = /\bnew\b|create|add|introduce/i.test(step);

  return { number: n, goal: step, files, gate, isNew };
}

// ─── Document Renderer ───────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Format a single slice section in Plan Forge style.
 *
 * @param {Slice}  slice
 * @param {Slice|null} prevSlice  Preceding slice (for Depends On chain)
 * @returns {string}
 */
function renderSlice(slice, prevSlice) {
  const filesBlock =
    slice.files.length > 0
      ? slice.files.map((f) => `- \`${f}\`${slice.isNew ? " (new)" : ""}`).join("\n")
      : "- <!-- TODO: list affected files -->";

  const dependsOn = prevSlice ? `\n**Depends On**: Slice ${prevSlice.number}\n` : "";

  return `### Slice ${slice.number}: ${slice.goal} [sequential]

**Goal**: ${slice.goal}.

**Files**:
${filesBlock}
${dependsOn}
**Validation Gate**:
\`\`\`bash
${slice.gate}
\`\`\`

---`;
}

/**
 * Render a full hardened Plan Forge plan document.
 *
 * @param {Object} params
 * @param {string}   params.title       Feature title
 * @param {string}   params.phaseSlug   UPPERCASE-SLUG for phase name
 * @param {string}   params.description Optional description text from input
 * @param {Slice[]}  params.slices
 * @param {string[]} params.allFiles    Union of files across all slices (deduplicated)
 * @param {string}   [params.sourceNote] Attribution note (e.g. "Exported from Copilot cloud agent session plan")
 * @returns {string}
 */
function renderPlan({ title, phaseSlug, description, slices, allFiles, sourceNote }) {
  const codeFiles = allFiles.filter((f) => !DOC_EXTENSIONS_RE.test(f));
  const docFiles = allFiles.filter((f) => DOC_EXTENSIONS_RE.test(f));

  const inScopeLines =
    codeFiles.length > 0
      ? codeFiles.map((f) => `- \`${f}\``).join("\n")
      : "- <!-- TODO: list files in scope -->";

  const filesTable =
    allFiles.length > 0
      ? allFiles.map((f, i) => `| \`${f}\` | ${i + 1} |`).join("\n")
      : "| <!-- TODO --> | 1 |";

  const sliceSections = slices
    .map((s, i) => renderSlice(s, i > 0 ? slices[i - 1] : null))
    .join("\n\n");

  const descriptionNote = description ? `\n${description}\n` : "";
  const sourceAttr = sourceNote ? `\n> **Source**: ${sourceNote}` : "";

  return `# Phase-${phaseSlug}: ${title} (HARDENED)

> **Status**: Hardened, ready for execution (Step 3)
> **Tracks**: Code + Tests + Docs
> **Estimated cost**: TBD (${slices.length} slices)
> **Pipeline**: Specify ✅ → Pre-flight ✅ → **Harden ✅** → Execute → Sweep → Review → Ship
> **Exported**: ${TODAY}${sourceAttr}

---
${descriptionNote}
## Scope Contract

### In Scope

${inScopeLines}

### Out of Scope

- <!-- TODO: list what is explicitly NOT in scope -->

### Forbidden Actions

- **Do NOT break existing tests.** All existing tests must pass after each slice.
- **Do NOT add dependencies** without documenting the reason here.
- **Do NOT skip validation gates.** Each slice gate must pass before the next slice begins.
- <!-- TODO: add project-specific forbidden actions -->

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|---|---|---|
| 1 | <!-- Decision topic --> | OPEN | <!-- Decide before executing --> |

---

## Acceptance Criteria

${slices.map((s, i) => `- [ ] **Slice ${i + 1}**: ${s.goal}`).join("\n")}

---

## Execution Slices

${sliceSections}

---

## Files Modified (Exhaustive)

| File | Slice(s) |
|---|---|
${filesTable}

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| <!-- Risk --> | <!-- Mitigation --> |
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ExportPlanOptions
 * @property {string}  [phaseName]   Override the derived phase slug (UPPERCASE-SLUG)
 * @property {string}  [outputPath]  If given, write the plan to this file path
 * @property {string}  [cwd]         Working directory for resolving outputPath
 * @property {string}  [sourceNote]  Attribution text in the plan header
 */

/**
 * @typedef {Object} ExportPlanResult
 * @property {boolean}  ok
 * @property {string}   plan        The rendered Plan Forge Markdown
 * @property {string}   title       Parsed title
 * @property {string}   phaseSlug   Derived or overridden phase slug
 * @property {number}   sliceCount  Number of slices generated
 * @property {string[]} files       All file paths extracted across all slices
 * @property {string}   [outputPath] Path written to (when opts.outputPath is set)
 * @property {string}   [error]
 */

/**
 * Convert a loose plan document into a hardened Plan Forge plan.
 *
 * @param {string}            input  Markdown text
 * @param {ExportPlanOptions} [opts]
 * @returns {ExportPlanResult}
 */
export function exportPlan(input, opts = {}) {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, error: "Input must be a non-empty string" };
  }

  const title = parseTitle(input);
  const steps = parseSteps(input);
  const phaseSlug = opts.phaseName
    ? opts.phaseName.toUpperCase().replace(/\s+/g, "-")
    : derivePhaseSlug(title);

  if (steps.length === 0) {
    return {
      ok: false,
      error:
        "No steps found in the input. Provide a numbered list (1. 2. 3.) or bulleted list (- / * / •).",
    };
  }

  const slices = steps.map((step, i) => buildSlice(step, i + 1));

  const allFiles = deduplicate(slices.flatMap((s) => s.files));

  // Extract a description paragraph (first prose paragraph after the title)
  const description = extractDescription(input);

  const plan = renderPlan({
    title,
    phaseSlug,
    description,
    slices,
    allFiles,
    sourceNote: opts.sourceNote ?? "Exported from loose plan via forge_export_plan",
  });

  const result = {
    ok: true,
    plan,
    title,
    phaseSlug,
    sliceCount: slices.length,
    files: allFiles,
    message: `Exported ${slices.length}-slice plan for "${title}" (Phase-${phaseSlug})`,
  };

  if (opts.outputPath) {
    const cwd = opts.cwd ?? process.cwd();
    const outAbs = resolve(cwd, opts.outputPath);
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, plan, "utf-8");
    result.outputPath = outAbs;
    result.message += `. Written to ${outAbs}`;
  }

  return result;
}

/**
 * Read a loose plan from a file and export it.
 *
 * @param {string}            inputPath  Path to the loose plan Markdown file
 * @param {ExportPlanOptions} [opts]
 * @returns {ExportPlanResult}
 */
export function exportPlanFromFile(inputPath, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const absPath = resolve(cwd, inputPath);
  if (!existsSync(absPath)) {
    return { ok: false, error: `Input file not found: ${absPath}` };
  }
  const input = readFileSync(absPath, "utf-8");
  return exportPlan(input, opts);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function deduplicate(arr) {
  return [...new Set(arr)];
}

/**
 * Extract a short description paragraph from the loose plan text.
 * Looks for the first prose paragraph after the first heading.
 *
 * @param {string} text
 * @returns {string}
 */
function extractDescription(text) {
  const lines = text.split(/\r?\n/);
  let pastTitle = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (t.startsWith("#")) {
      pastTitle = true;
      continue;
    }

    if (!pastTitle) continue;

    // Skip list items — those become steps
    if (/^(\d+\.|[-*•]|\[[ xX]\])/.test(t)) continue;

    // First non-empty non-heading non-list line after the title is the description
    return t.slice(0, 300);
  }

  return "";
}
