/**
 * Plan Forge — OpenBrain Memory Integration
 *
 * Integrates persistent semantic memory into the orchestrator pipeline.
 * When OpenBrain is configured, the orchestrator:
 *   - Injects memory search results into worker prompts (before each slice)
 *   - Instructs workers to capture decisions (after each slice)
 *   - Captures run summaries as thoughts (after completion)
 *
 * All integration is opt-in: if OpenBrain is not configured, all functions
 * return empty strings / no-ops. Zero impact on non-OpenBrain users.
 *
 * @module memory
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

/**
 * Default keyword patterns mapped to targeted search queries for `search_thoughts`.
 * Matched against slice titles to generate domain-specific context requests.
 * G3.4 (v2.36): projects can override via `.forge.json` → `openbrain.keywordMap`
 * using the same shape — see `loadKeywordSearchMap()`.
 */
const DEFAULT_KEYWORD_SEARCH_MAP = [
  { pattern: /\b(database|migration|schema|alter|seed|index|ef\s+core|dbcontext|repository)\b/i, query: "database migration patterns" },
  { pattern: /\b(auth|token|rbac|jwt|oauth|password|credential|permission|role)\b/i, query: "authentication authorization patterns" },
  { pattern: /\b(api|endpoint|route|controller|http|rest|graphql)\b/i, query: "API endpoint design patterns" },
  { pattern: /\b(test|spec|jest|xunit|mocha|vitest|coverage)\b/i, query: "testing patterns conventions" },
  { pattern: /\b(deploy|ci|cd|pipeline|docker|kubernetes|container)\b/i, query: "deployment pipeline patterns" },
  { pattern: /\b(ui|component|react|vue|angular|frontend|css)\b/i, query: "UI component patterns" },
  { pattern: /\b(cache|redis|memcache|invalidat)\b/i, query: "caching invalidation patterns" },
  { pattern: /\b(error|exception|logging|monitor|alert)\b/i, query: "error handling logging patterns" },
  { pattern: /\b(memory|openbrain|context|semantic)\b/i, query: "memory context integration patterns" },
];

// Back-compat alias — some downstream code / tests imported this symbol.
const KEYWORD_SEARCH_MAP = DEFAULT_KEYWORD_SEARCH_MAP;

/**
 * G3.4 (v2.36): load the active keyword-search map. Order of precedence:
 *   1. `.forge.json` → `openbrain.keywordMap: [{ pattern: "regex", flags?: "i", query: "..." }, ...]`
 *   2. Built-in `DEFAULT_KEYWORD_SEARCH_MAP`
 *
 * Invalid entries (missing pattern/query, malformed regex) are skipped with
 * a console warning — never throws. Returns an array of `{pattern: RegExp, query: string}`.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {Array<{pattern: RegExp, query: string}>}
 */
export function loadKeywordSearchMap(cwd = process.cwd()) {
  try {
    const cfgPath = resolve(cwd, ".forge.json");
    if (!existsSync(cfgPath)) return DEFAULT_KEYWORD_SEARCH_MAP;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    const custom = cfg?.openbrain?.keywordMap;
    if (!Array.isArray(custom) || custom.length === 0) return DEFAULT_KEYWORD_SEARCH_MAP;

    const compiled = [];
    for (const entry of custom) {
      if (!entry || typeof entry.pattern !== "string" || typeof entry.query !== "string") continue;
      try {
        const flags = typeof entry.flags === "string" ? entry.flags : "i";
        compiled.push({ pattern: new RegExp(entry.pattern, flags), query: entry.query });
      } catch (err) {
        console.error(`[memory] skipping invalid keywordMap entry (${entry.pattern}): ${err.message}`);
      }
    }
    return compiled.length > 0 ? compiled : DEFAULT_KEYWORD_SEARCH_MAP;
  } catch {
    return DEFAULT_KEYWORD_SEARCH_MAP;
  }
}

/**
 * Load project-level context to prepend to slice prompts.
 *
 * Reads key project files (README, architecture docs) and generates
 * slice-specific `search_thoughts` instructions based on keywords in the
 * slice title.  Returns an empty string when cwd is falsy or nothing
 * useful can be found — callers can concatenate unconditionally.
 *
 * @param {string} cwd - Working directory
 * @param {string} projectName - Project name for scoping OpenBrain searches
 * @param {string} sliceTitle - Title of the current slice (keyword matching)
 * @returns {string} Context block to prepend to the slice prompt, or ""
 */
export function loadProjectContext(cwd, projectName, sliceTitle) {
  if (!cwd) return "";

  const parts = [];

  // ── Project file snippets ──────────────────────────────────────────────
  const candidates = [
    { path: resolve(cwd, "README.md"),                   label: "Project README",  maxLines: 50 },
    { path: resolve(cwd, "ARCHITECTURE.md"),             label: "Architecture",    maxLines: 80 },
    { path: resolve(cwd, "docs", "ARCHITECTURE.md"),     label: "Architecture",    maxLines: 80 },
    { path: resolve(cwd, ".github", "CONTRIBUTING.md"),  label: "Contributing",    maxLines: 30 },
    { path: resolve(cwd, "CONTRIBUTING.md"),             label: "Contributing",    maxLines: 30 },
  ];

  const seen = new Set();
  for (const { path: filePath, label, maxLines } of candidates) {
    if (seen.has(label)) continue; // only first match per label
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        const snippet = content.split("\n").slice(0, maxLines).join("\n");
        parts.push(`### ${label}\n${snippet}`);
        seen.add(label);
      }
    } catch { /* skip unreadable files */ }
  }

  if (parts.length > 0) {
    parts.unshift("--- PROJECT CONTEXT ---");
    parts.push("--- END PROJECT CONTEXT ---");
  }

  // ── Slice-specific deep-context searches ──────────────────────────────
  if (sliceTitle && projectName) {
    // G3.4 (v2.36): use the configurable map instead of the frozen default.
    const keywordMap = loadKeywordSearchMap(cwd);
    const matchedQueries = keywordMap
      .filter(({ pattern }) => pattern.test(sliceTitle))
      .map(({ query }) => query);

    if (matchedQueries.length > 0) {
      parts.push("");
      parts.push("--- DEEP CONTEXT (OpenBrain) ---");
      parts.push("Search for domain-specific prior decisions before starting:");
      for (const query of matchedQueries) {
        parts.push(`  Use search_thoughts tool with query: "${query}", project: "${projectName}", limit: 5`);
      }
      parts.push("Apply findings to avoid repeating known patterns and mistakes.");
      parts.push("--- END DEEP CONTEXT ---");
    }
  }

  return parts.length > 0 ? parts.join("\n") + "\n" : "";
}

/**
 * Check if OpenBrain is configured in .vscode/mcp.json.
 */
export function isOpenBrainConfigured(cwd) {
  const mcpConfigPaths = [
    resolve(cwd, ".vscode", "mcp.json"),
    resolve(cwd, ".claude", "mcp.json"),
  ];

  for (const configPath of mcpConfigPaths) {
    try {
      if (existsSync(configPath)) {
        const config = readFileSync(configPath, "utf-8");
        if (config.includes("openbrain") || config.includes("open-brain")) {
          return true;
        }
      }
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * Build memory search instructions to prepend to a worker prompt.
 * The worker (gh copilot) will execute the search_thoughts call.
 *
 * @param {string} projectName - Project name for scoping
 * @param {object} slice - Slice metadata
 * @returns {string} Memory context block to prepend to prompt
 */
export function buildMemorySearchBlock(projectName, slice) {
  return `
--- MEMORY CONTEXT (OpenBrain) ---
Before starting work, search for relevant prior decisions:

1. Search for project conventions:
   Use the search_thoughts tool with query: "conventions patterns ${slice.title}"
   project: "${projectName}", type: "convention", limit: 5

2. Search for prior lessons on similar work:
   Use the search_thoughts tool with query: "${slice.title} ${slice.tasks?.[0] || ''}"
   project: "${projectName}", limit: 5

Apply any relevant findings. Do NOT repeat mistakes documented in prior thoughts.
--- END MEMORY CONTEXT ---
`;
}

/**
 * Build memory capture instructions to append to a worker prompt.
 * The worker will capture key decisions after completing work.
 *
 * @param {string} projectName - Project name
 * @param {object} slice - Slice metadata
 * @param {string} planName - Plan file name
 * @returns {string} Capture instructions block
 */
export function buildMemoryCaptureBlock(projectName, slice, planName) {
  return `
--- MEMORY CAPTURE (OpenBrain) ---
After completing all tasks and passing validation gates, capture key decisions:

Use the capture_thought tool for each significant decision:
- content: "Decision: <what you decided and why>"
- project: "${projectName}"
- source: "plan-forge-orchestrator/${planName}/slice-${slice.number}"
- created_by: "gh-copilot-worker"

Capture:
1. Architecture decisions made during this slice
2. Patterns chosen (and why alternatives were rejected)
3. Any gotchas or constraints discovered
4. Conventions established that future slices should follow

Do NOT capture trivial facts. Focus on decisions that would save time in future phases.
--- END MEMORY CAPTURE ---
`;
}

/**
 * Build a Reflexion-style "previous attempt summary" prompt block for retries.
 *
 * Phase-25 Slice 1 (L1 — Reflexion). On retry attempt N ≥ 2, `executeSlice`
 * prepends this Markdown block to the worker prompt so the worker can learn
 * from the previous failure instead of repeating it.
 *
 * Contract (Phase-25 MUST #1):
 *   - Header: `## Previous attempt (N-1) summary`
 *   - Contains: gate name, chosen model, duration, stderr tail (≤2KB)
 *   - Markdown prose format (D1) — workers consume prose well
 *
 * Pure function: no fs, no network, deterministic. Safe to test in isolation.
 *
 * @param {object} ctx
 * @param {number} ctx.previousAttempt - The 1-based attempt number that failed (the one being summarized).
 * @param {string} [ctx.gateName] - Gate command that failed (e.g. "npx vitest run"). Defaults to "unknown".
 * @param {string} [ctx.model] - Model used for the failed attempt (e.g. "claude-sonnet-4.5"). Defaults to "auto".
 * @param {number} [ctx.durationMs] - Duration of the failed attempt in milliseconds. Defaults to 0.
 * @param {string} [ctx.stderrTail] - Stderr / gate-error text from the failed attempt. Truncated to last 2KB.
 * @returns {string} Markdown block ready to prepend to the worker prompt.
 */
export function buildReflexionBlock(ctx = {}) {
  const MAX_STDERR_BYTES = 2048;
  const previousAttempt = Number.isFinite(ctx.previousAttempt) && ctx.previousAttempt > 0
    ? ctx.previousAttempt
    : 1;
  const gateName = typeof ctx.gateName === "string" && ctx.gateName.length > 0
    ? ctx.gateName
    : "unknown";
  const model = typeof ctx.model === "string" && ctx.model.length > 0
    ? ctx.model
    : "auto";
  const durationMs = Number.isFinite(ctx.durationMs) && ctx.durationMs >= 0
    ? Math.round(ctx.durationMs)
    : 0;

  const rawStderr = typeof ctx.stderrTail === "string" ? ctx.stderrTail : "";
  let stderrTail = rawStderr;
  let truncated = false;
  if (rawStderr.length > MAX_STDERR_BYTES) {
    stderrTail = rawStderr.slice(-MAX_STDERR_BYTES);
    truncated = true;
  }

  const tailBody = stderrTail.length > 0 ? stderrTail : "(no stderr captured)";

  return [
    `## Previous attempt (${previousAttempt}) summary`,
    "",
    `- **Gate that failed**: \`${gateName}\``,
    `- **Model used**: \`${model}\``,
    `- **Duration**: ${durationMs}ms`,
    "",
    truncated
      ? `**Failure output (stderr tail, truncated to last ${MAX_STDERR_BYTES} bytes):**`
      : "**Failure output (stderr tail, ≤2KB):**",
    "",
    "```",
    tailBody,
    "```",
    "",
    "Use this summary to avoid repeating the same mistake. Address the specific error above before the next gate run.",
    "",
  ].join("\n");
}

// ─── Phase-25 Slice 2: Trajectory notes (L8) ──────────────────────────

/**
 * Sentinels used by `buildTrajectorySuffix` / `extractTrajectory` to bracket
 * the worker's trajectory note in its stdout.
 */
export const TRAJECTORY_BEGIN_SENTINEL = "<!-- PFORGE_TRAJECTORY:BEGIN -->";
export const TRAJECTORY_END_SENTINEL = "<!-- PFORGE_TRAJECTORY:END -->";

/**
 * Phase-25 D2: maximum words retained in a persisted trajectory note.
 * Overage truncated with a `[truncated]` marker.
 */
export const TRAJECTORY_MAX_WORDS = 500;

/**
 * Build the trajectory-note prompt suffix appended to a slice worker prompt.
 * Asks the worker to emit a first-person prose note wrapped in sentinels so
 * later slices in the same plan can learn from the approach (Phase-25 L8,
 * scenario 5 — "Operator verbalizes intent for the next slice").
 *
 * Pure function: deterministic, no fs, no network.
 *
 * @returns {string} Prompt suffix (newline-prefixed + suffixed for clean concat).
 */
export function buildTrajectorySuffix() {
  return `
--- TRAJECTORY NOTE (Phase-25 L8) ---
After your work is complete and the validation gate has been run, emit a
brief first-person prose note (≤${TRAJECTORY_MAX_WORDS} words) wrapped in
sentinels so later slices in the same plan can learn from your approach.

Format — exactly these three lines, in order:
${TRAJECTORY_BEGIN_SENTINEL}
<your prose note — a few short paragraphs>
${TRAJECTORY_END_SENTINEL}

Cover, in plain prose:
- The approach you chose and why.
- Any dead-ends you ruled out.
- Gotchas a future slice should watch for.
- Key file or function names a later slice may need to touch.

This is NOT a summary of the plan. Do not include commands, code blocks,
bullet lists of commits, or machine-readable structures — prose only.
--- END TRAJECTORY NOTE ---
`;
}

/**
 * Extract the trajectory sentinel block from worker stdout.
 * Returns the trimmed content between sentinels, or null when not present.
 *
 * @param {string} output
 * @returns {string|null}
 */
export function extractTrajectory(output) {
  if (typeof output !== "string") return null;
  const beginIdx = output.indexOf(TRAJECTORY_BEGIN_SENTINEL);
  if (beginIdx < 0) return null;
  const endIdx = output.indexOf(TRAJECTORY_END_SENTINEL, beginIdx + TRAJECTORY_BEGIN_SENTINEL.length);
  if (endIdx < 0) return null;
  const body = output.slice(beginIdx + TRAJECTORY_BEGIN_SENTINEL.length, endIdx).trim();
  return body.length > 0 ? body : null;
}

/**
 * Cap a trajectory note at `maxWords` words. When capped, append "\n\n[truncated]"
 * per Phase-25 D2. Whitespace is normalized to single spaces in the word count
 * but the original prose layout is preserved up to the cut.
 *
 * @param {string} content
 * @param {number} [maxWords=TRAJECTORY_MAX_WORDS]
 * @returns {string}
 */
export function capTrajectoryWords(content, maxWords = TRAJECTORY_MAX_WORDS) {
  if (typeof content !== "string") return "";
  const trimmed = content.trim();
  if (trimmed.length === 0) return "";
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= maxWords) return trimmed;
  // Preserve original layout up to the nth word. Walk the raw string and stop
  // once we've consumed `maxWords` whitespace-separated runs.
  let count = 0;
  let cutAt = trimmed.length;
  let inWord = false;
  for (let i = 0; i < trimmed.length; i++) {
    const isWs = /\s/.test(trimmed[i]);
    if (!isWs && !inWord) {
      count++;
      inWord = true;
      if (count > maxWords) {
        cutAt = i;
        break;
      }
    } else if (isWs) {
      inWord = false;
    }
  }
  return trimmed.slice(0, cutAt).trimEnd() + "\n\n[truncated]";
}

/**
 * Sanitize an untrusted string for safe use as a filesystem path component.
 * Keeps `[A-Za-z0-9._-]` only, collapses everything else to `_`, strips any
 * remaining `..` sequences (to prevent path traversal), and caps length.
 */
function sanitizePathComponent(s) {
  let cleaned = String(s ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
  // Collapse any `..` sequences (even the trailing ones left after other
  // chars were replaced) to prevent escaping the intended directory root.
  while (cleaned.includes("..")) {
    cleaned = cleaned.replace(/\.\./g, "_");
  }
  cleaned = cleaned.slice(0, 128);
  return cleaned.length > 0 ? cleaned : "_";
}

/**
 * Persist a trajectory note to `.forge/trajectories/<plan>/slice-<id>.md`.
 * Word-capped to `TRAJECTORY_MAX_WORDS` (Phase-25 MUST #2 + D2).
 *
 * @param {object} opts
 * @param {string} [opts.cwd=process.cwd()]
 * @param {string} opts.planBasename - Plan file name without extension.
 * @param {(string|number)} opts.sliceId
 * @param {string} opts.content - Raw trajectory prose.
 * @returns {string} Absolute path of the written file.
 */
export function writeTrajectory({ cwd = process.cwd(), planBasename, sliceId, content }) {
  if (!planBasename || typeof planBasename !== "string") {
    throw new Error("writeTrajectory: planBasename is required");
  }
  if (sliceId === undefined || sliceId === null || sliceId === "") {
    throw new Error("writeTrajectory: sliceId is required");
  }
  const safePlan = sanitizePathComponent(planBasename);
  const safeSlice = sanitizePathComponent(String(sliceId));
  const dir = resolve(cwd, ".forge", "trajectories", safePlan);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `slice-${safeSlice}.md`);
  const capped = capTrajectoryWords(content);
  writeFileSync(path, capped, "utf-8");
  return path;
}

/**
 * Read a single trajectory note. Returns `null` when the file does not exist.
 */
export function readTrajectory({ cwd = process.cwd(), planBasename, sliceId }) {
  if (!planBasename || sliceId === undefined || sliceId === null || sliceId === "") return null;
  const safePlan = sanitizePathComponent(planBasename);
  const safeSlice = sanitizePathComponent(String(sliceId));
  const path = resolve(cwd, ".forge", "trajectories", safePlan, `slice-${safeSlice}.md`);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * List every trajectory note for a plan, sorted numerically by slice id when
 * possible. Returns `[]` when the directory does not exist.
 */
export function listTrajectories({ cwd = process.cwd(), planBasename }) {
  if (!planBasename) return [];
  const safePlan = sanitizePathComponent(planBasename);
  const dir = resolve(cwd, ".forge", "trajectories", safePlan);
  if (!existsSync(dir)) return [];
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const f of files) {
    const m = /^slice-(.+)\.md$/.exec(f);
    if (!m) continue;
    const sliceId = m[1];
    const fullPath = resolve(dir, f);
    let content = "";
    try { content = readFileSync(fullPath, "utf-8"); } catch { /* skip unreadable */ }
    entries.push({ sliceId, path: fullPath, content });
  }
  entries.sort((a, b) => {
    const an = Number(a.sliceId);
    const bn = Number(b.sliceId);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.sliceId.localeCompare(b.sliceId);
  });
  return entries;
}

// ─── Phase-25 Slice 3: Auto-skill library (L2 — Voyager) ──────────────

/** Subdirectory under `.forge/` where auto-skill candidates are stored. */
const AUTOSKILL_DIR = "skills-auto";

/** SHA-256 prefix length used in auto-skill file names (Phase-25 D4). */
export const AUTOSKILL_SHA_PREFIX_LEN = 12;

/** Default promotion threshold for auto-skill reuses (Phase-25 D3). */
export const AUTOSKILL_DEFAULT_THRESHOLD = 3;

/**
 * Derive domain keywords for a slice by matching its title (and, if present,
 * its file list) against the keyword search map. Returns canonical query
 * strings (e.g. "database migration patterns") — the same vocabulary used by
 * `buildMemorySearchBlock`, so auto-skills and memory search share indexing.
 *
 * @param {object} slice
 * @param {string} [cwd=process.cwd()]
 * @returns {string[]} Unique list of matched domain query strings.
 */
export function extractDomainKeywords(slice, cwd = process.cwd()) {
  if (!slice) return [];
  const fileList = Array.isArray(slice.files) ? slice.files : [];
  const haystack = [slice.title || "", ...fileList].join(" ").toLowerCase();
  const map = loadKeywordSearchMap(cwd);
  const hits = [];
  for (const entry of map) {
    if (entry.pattern.test(haystack) && !hits.includes(entry.query)) {
      hits.push(entry.query);
    }
  }
  return hits;
}

function inferAutoSkillSliceType(slice) {
  const t = String(slice?.title || "").toLowerCase();
  if (/\btest|spec\b/.test(t)) return "test";
  if (/\bdoc|readme|changelog|manual\b/.test(t)) return "doc";
  if (/\bdeploy|ship|release\b/.test(t)) return "deploy";
  if (/\bfix|bug|hotfix\b/.test(t)) return "fix";
  return "execute";
}

function autoSkillPrefix(summary, commands) {
  const h = createHash("sha256");
  h.update(String(summary || ""));
  h.update("\n");
  h.update((Array.isArray(commands) ? commands : []).join("\n"));
  return h.digest("hex").slice(0, AUTOSKILL_SHA_PREFIX_LEN);
}

/**
 * Parse a slice's validationGate (string or string[]) into an array of
 * runnable shell commands, dropping blank lines and `#` comments.
 */
function parseGateCommands(rawGate) {
  let lines = [];
  if (Array.isArray(rawGate)) {
    lines = rawGate;
  } else if (typeof rawGate === "string") {
    lines = rawGate.split("\n");
  } else {
    return [];
  }
  return lines
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

/**
 * Build an auto-skill record from a passing slice. Pure function — no fs.
 * Returns `null` when the slice has no validation-gate commands to capture.
 *
 * MUST #3 schema: { sha256Prefix, summary, commands[], contextSignature,
 *                   reuseCount: 0, createdAt }.
 *
 * @param {object} args
 * @param {object} args.slice
 * @param {string} [args.planBasename]
 * @param {string} [args.cwd]
 * @param {string} [args.now] ISO timestamp override (for deterministic tests).
 * @returns {object|null}
 */
export function extractAutoSkill({ slice, planBasename = "", cwd = process.cwd(), now } = {}) {
  if (!slice || typeof slice !== "object") return null;
  const commands = parseGateCommands(slice.validationGate);
  if (commands.length === 0) return null;

  const domainKeywords = extractDomainKeywords(slice, cwd);
  const titleHash = createHash("sha256")
    .update(String(slice.title || ""))
    .digest("hex")
    .slice(0, 8);
  const summary = String(slice.title || `slice-${slice.number ?? "unknown"}`).slice(0, 200);
  const sha256Prefix = autoSkillPrefix(summary, commands);
  const createdAt = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();

  return {
    sha256Prefix,
    summary,
    commands,
    contextSignature: {
      sliceType: inferAutoSkillSliceType(slice),
      domainKeywords,
      titleHash,
      planBasename: typeof planBasename === "string" ? planBasename : "",
    },
    reuseCount: 0,
    createdAt,
  };
}

/**
 * Serialize an auto-skill record to its Markdown-on-disk form. Frontmatter
 * uses JSON-encoded scalars where quoting matters, so the parser round-trips
 * exotic characters in commands and summaries.
 */
export function renderAutoSkillMarkdown(record) {
  if (!record) throw new Error("renderAutoSkillMarkdown: record required");
  const cs = record.contextSignature || {};
  const domainKeywords = Array.isArray(cs.domainKeywords) ? cs.domainKeywords : [];
  const lines = [
    "---",
    `sha256Prefix: ${record.sha256Prefix}`,
    `summary: ${JSON.stringify(String(record.summary || ""))}`,
    `createdAt: ${record.createdAt}`,
    `reuseCount: ${Number(record.reuseCount || 0)}`,
    "contextSignature:",
    `  sliceType: ${cs.sliceType || "execute"}`,
    `  titleHash: ${cs.titleHash || ""}`,
    `  planBasename: ${cs.planBasename || ""}`,
    `  domainKeywords: [${domainKeywords.map((k) => JSON.stringify(k)).join(", ")}]`,
    "commands:",
    ...record.commands.map((c) => `  - ${JSON.stringify(String(c))}`),
    "---",
    "",
    `# Auto-skill: ${record.summary}`,
    "",
    "Captured by Plan-Forge Phase-25 auto-skill library (L2).",
    "Reuse this recipe when a future slice matches the domain keywords above.",
    "",
    "## Commands that worked",
    "",
    ...record.commands.flatMap((c) => ["```", c, "```", ""]),
  ];
  return lines.join("\n");
}

/**
 * Parse an auto-skill record from its Markdown-on-disk form. Tolerant of
 * hand-edits — returns `null` on clearly malformed files.
 */
export function parseAutoSkillMarkdown(text) {
  if (typeof text !== "string") return null;
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  const sha256Prefix = (/^sha256Prefix:\s*(\S+)$/m.exec(fm) || [])[1];
  if (!sha256Prefix) return null;

  const summaryLine = (/^summary:\s*(.+)$/m.exec(fm) || [])[1] || "";
  let summary = summaryLine;
  try { summary = JSON.parse(summaryLine); } catch { /* keep raw */ }

  const createdAt = (/^createdAt:\s*(\S+)$/m.exec(fm) || [])[1] || "";
  const reuseCount = Number((/^reuseCount:\s*(\S+)$/m.exec(fm) || [])[1] || 0) || 0;

  const cs = {
    sliceType: (/^\s*sliceType:\s*(\S+)$/m.exec(fm) || [])[1] || "execute",
    titleHash: (/^\s*titleHash:\s*(\S+)$/m.exec(fm) || [])[1] || "",
    planBasename: (/^\s*planBasename:\s*(\S+)$/m.exec(fm) || [])[1] || "",
    domainKeywords: [],
  };
  const kwMatch = /^\s*domainKeywords:\s*\[([^\]]*)\]$/m.exec(fm);
  if (kwMatch) {
    try {
      const parsed = JSON.parse("[" + kwMatch[1] + "]");
      if (Array.isArray(parsed)) cs.domainKeywords = parsed.filter((s) => typeof s === "string");
    } catch { /* leave empty */ }
  }

  const commands = [];
  // `commands` is always serialized as the last frontmatter key (see
  // renderAutoSkillMarkdown), so we can safely read from the `commands:` line
  // through the end of the frontmatter block.
  const cmdSectionMatch = /\ncommands:\n([\s\S]*)$/.exec(fm);
  if (cmdSectionMatch) {
    for (const raw of cmdSectionMatch[1].split("\n")) {
      const m = /^\s*-\s*(.+)$/.exec(raw);
      if (!m) continue;
      let v = m[1].trim();
      try { v = JSON.parse(v); } catch { /* keep raw */ }
      if (typeof v === "string" && v.length > 0) commands.push(v);
    }
  }

  return { sha256Prefix, summary, commands, contextSignature: cs, reuseCount, createdAt };
}

/**
 * Persist an auto-skill record to `.forge/skills-auto/<sha256Prefix>.md`.
 * Idempotent by prefix — overwrites an existing file to support reuseCount updates.
 *
 * @returns {string} Absolute path of the written file.
 */
export function writeAutoSkill({ cwd = process.cwd(), record }) {
  if (!record || !record.sha256Prefix) {
    throw new Error("writeAutoSkill: record.sha256Prefix required");
  }
  const dir = resolve(cwd, ".forge", AUTOSKILL_DIR);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${record.sha256Prefix}.md`);
  writeFileSync(path, renderAutoSkillMarkdown(record), "utf-8");
  return path;
}

/** Read a single auto-skill by prefix. Returns `null` when missing or malformed. */
export function readAutoSkill({ cwd = process.cwd(), sha256Prefix }) {
  if (!sha256Prefix) return null;
  const path = resolve(cwd, ".forge", AUTOSKILL_DIR, `${sha256Prefix}.md`);
  if (!existsSync(path)) return null;
  try {
    return parseAutoSkillMarkdown(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** List every auto-skill candidate. Returns `[]` when the directory does not exist. */
export function listAutoSkills({ cwd = process.cwd() } = {}) {
  const dir = resolve(cwd, ".forge", AUTOSKILL_DIR);
  if (!existsSync(dir)) return [];
  let files;
  try { files = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const rec = readAutoSkill({ cwd, sha256Prefix: f.slice(0, -3) });
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Retrieve auto-skills whose `contextSignature.domainKeywords` overlap the
 * given slice's domain keywords. Ranked by `reuseCount` desc, then `createdAt`
 * desc. Returns up to `limit` records (default 3).
 */
export function retrieveAutoSkills({ cwd = process.cwd(), slice, limit = 3 } = {}) {
  if (!slice) return [];
  const keywords = extractDomainKeywords(slice, cwd);
  if (keywords.length === 0) return [];
  const all = listAutoSkills({ cwd });
  const matches = all.filter((s) => {
    const kw = s.contextSignature?.domainKeywords || [];
    return kw.some((k) => keywords.includes(k));
  });
  matches.sort((a, b) => {
    const dr = (b.reuseCount || 0) - (a.reuseCount || 0);
    if (dr !== 0) return dr;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  const cap = Number.isFinite(limit) && limit > 0 ? limit : 3;
  return matches.slice(0, cap);
}

/**
 * Atomically bump `reuseCount` for a given skill. Returns the new count, or
 * `null` when the skill is missing.
 */
export function incrementAutoSkillReuse({ cwd = process.cwd(), sha256Prefix }) {
  const rec = readAutoSkill({ cwd, sha256Prefix });
  if (!rec) return null;
  rec.reuseCount = (Number(rec.reuseCount) || 0) + 1;
  writeAutoSkill({ cwd, record: rec });
  return rec.reuseCount;
}

/**
 * MUST #4 promotion gate. Returns `true` when a skill is eligible for
 * promotion to `.github/skills/auto-<name>/SKILL.md`. Default threshold = 3
 * (Phase-25 D3); callers override via `runtime.autoSkill.promoteThreshold`.
 */
export function shouldPromoteAutoSkill(skill, threshold = AUTOSKILL_DEFAULT_THRESHOLD) {
  if (!skill) return false;
  const n = Number(skill.reuseCount || 0);
  const t = Number.isFinite(threshold) && threshold > 0 ? threshold : AUTOSKILL_DEFAULT_THRESHOLD;
  return n >= t;
}

// ─── Phase-26 Slice 8: Auto-skill promotion — state machine ──────────────────

/**
 * Sidecar state file tracking per-skill lifecycle decisions:
 * `pending` (eligible but not yet actioned), `promoted`, `rejected`, `deferred`.
 * The markdown candidate files stay untouched; this file records the decision.
 *
 * Schema (inside .forge/skills-auto/state.json):
 *   { "<sha256Prefix>": { status, deferredUntil?: ISO, actionedAt: ISO } }
 */
const AUTOSKILL_STATE_FILE = "state.json";

/** Defer window for `deferAutoSkill` — Phase-26 MUST (Defer 7d). */
export const AUTOSKILL_DEFER_MS = 7 * 24 * 60 * 60 * 1000;

function autoSkillStatePath(cwd) {
  return resolve(cwd, ".forge", AUTOSKILL_DIR, AUTOSKILL_STATE_FILE);
}

function readAutoSkillState(cwd) {
  const path = autoSkillStatePath(cwd);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeAutoSkillState(cwd, state) {
  const path = autoSkillStatePath(cwd);
  mkdirSync(resolve(cwd, ".forge", AUTOSKILL_DIR), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Derive the on-disk status of an auto-skill candidate.
 *   - "promoted"  when `.github/skills/auto-<prefix>/SKILL.md` exists
 *   - "rejected"  when state.json says so (file may also be under rejected/)
 *   - "deferred"  when state.json says so AND `deferredUntil > now`
 *   - "pending"   otherwise (default)
 *
 * Pure w.r.t. its arguments; reads only.
 */
export function getAutoSkillStatus({ cwd = process.cwd(), sha256Prefix, now = Date.now() } = {}) {
  if (!sha256Prefix) return "pending";
  const promotedPath = resolve(cwd, ".github", "skills", `auto-${sha256Prefix}`, "SKILL.md");
  if (existsSync(promotedPath)) return "promoted";
  const state = readAutoSkillState(cwd);
  const entry = state[sha256Prefix];
  if (!entry) return "pending";
  if (entry.status === "rejected") return "rejected";
  if (entry.status === "deferred") {
    const until = entry.deferredUntil ? Date.parse(entry.deferredUntil) : 0;
    if (Number.isFinite(until) && until > now) return "deferred";
    // expired defer → back to pending
    return "pending";
  }
  if (entry.status === "promoted") return "promoted";
  return "pending";
}

/**
 * List auto-skill candidates eligible for promotion.
 * A candidate is "pending" when:
 *   - `reuseCount >= threshold` (Phase-25 D3 default 3; override via
 *     `runtime.autoSkill.promoteThreshold`)
 *   - NOT already promoted (`.github/skills/auto-<prefix>/SKILL.md` absent)
 *   - NOT rejected (state.json)
 *   - NOT currently deferred (state.json `deferredUntil` in the future)
 *
 * @returns {Array<object>} pending skill records, ordered by reuseCount desc.
 */
export function listPendingAutoSkills({ cwd = process.cwd(), threshold, now = Date.now() } = {}) {
  const t = Number.isFinite(threshold) && threshold > 0
    ? Math.floor(threshold)
    : AUTOSKILL_DEFAULT_THRESHOLD;
  const all = listAutoSkills({ cwd });
  const out = [];
  for (const skill of all) {
    if (!shouldPromoteAutoSkill(skill, t)) continue;
    const status = getAutoSkillStatus({ cwd, sha256Prefix: skill.sha256Prefix, now });
    if (status !== "pending") continue;
    out.push(skill);
  }
  out.sort((a, b) => (b.reuseCount || 0) - (a.reuseCount || 0));
  return out;
}

/**
 * Promote an auto-skill to `.github/skills/auto-<sha256Prefix>/SKILL.md`.
 * Copies the current rendered markdown; records `promoted` in state.json so
 * the candidate no longer appears in `listPendingAutoSkills`.
 *
 * @returns {{ ok: boolean, promotedPath?: string, error?: string }}
 */
export function acceptAutoSkill({ cwd = process.cwd(), sha256Prefix, now = new Date() } = {}) {
  if (!sha256Prefix) return { ok: false, error: "sha256Prefix required" };
  const record = readAutoSkill({ cwd, sha256Prefix });
  if (!record) return { ok: false, error: `auto-skill ${sha256Prefix} not found` };
  const skillDir = resolve(cwd, ".github", "skills", `auto-${sha256Prefix}`);
  mkdirSync(skillDir, { recursive: true });
  const promotedPath = resolve(skillDir, "SKILL.md");
  writeFileSync(promotedPath, renderAutoSkillMarkdown(record), "utf-8");
  const state = readAutoSkillState(cwd);
  state[sha256Prefix] = {
    status: "promoted",
    actionedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
  writeAutoSkillState(cwd, state);
  return { ok: true, promotedPath };
}

/**
 * Reject an auto-skill candidate. Moves the candidate file to
 * `.forge/skills-auto/rejected/<sha256Prefix>.md` and records the decision.
 *
 * @returns {{ ok: boolean, rejectedPath?: string, error?: string }}
 */
export function rejectAutoSkill({ cwd = process.cwd(), sha256Prefix, reason = "", now = new Date() } = {}) {
  if (!sha256Prefix) return { ok: false, error: "sha256Prefix required" };
  const srcPath = resolve(cwd, ".forge", AUTOSKILL_DIR, `${sha256Prefix}.md`);
  if (!existsSync(srcPath)) return { ok: false, error: `auto-skill ${sha256Prefix} not found` };
  const rejectedDir = resolve(cwd, ".forge", AUTOSKILL_DIR, "rejected");
  mkdirSync(rejectedDir, { recursive: true });
  const rejectedPath = resolve(rejectedDir, `${sha256Prefix}.md`);
  writeFileSync(rejectedPath, readFileSync(srcPath, "utf-8"), "utf-8");
  try {
    unlinkSync(srcPath);
  } catch { /* best effort — state record is authoritative */ }
  const state = readAutoSkillState(cwd);
  state[sha256Prefix] = {
    status: "rejected",
    reason: String(reason || ""),
    actionedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
  writeAutoSkillState(cwd, state);
  return { ok: true, rejectedPath };
}

/**
 * Defer an auto-skill candidate for `AUTOSKILL_DEFER_MS` (7 days). The
 * candidate returns to `pending` automatically once the defer window expires.
 *
 * @returns {{ ok: boolean, deferredUntil?: string, error?: string }}
 */
export function deferAutoSkill({ cwd = process.cwd(), sha256Prefix, now = Date.now() } = {}) {
  if (!sha256Prefix) return { ok: false, error: "sha256Prefix required" };
  const nowMs = typeof now === "number" ? now : Date.parse(String(now));
  if (!Number.isFinite(nowMs)) return { ok: false, error: "invalid now" };
  const record = readAutoSkill({ cwd, sha256Prefix });
  if (!record) return { ok: false, error: `auto-skill ${sha256Prefix} not found` };
  const deferredUntil = new Date(nowMs + AUTOSKILL_DEFER_MS).toISOString();
  const state = readAutoSkillState(cwd);
  state[sha256Prefix] = {
    status: "deferred",
    deferredUntil,
    actionedAt: new Date(nowMs).toISOString(),
  };
  writeAutoSkillState(cwd, state);
  return { ok: true, deferredUntil };
}


/**
 * Build a prompt block listing retrieved auto-skills for worker injection.
 * Returns `""` when no skills are provided.
 */
export function buildAutoSkillContext(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return "";
  const lines = [
    "",
    "--- AUTO-SKILL CONTEXT (Phase-25 L2) ---",
    "These recipes worked on past slices matching your domain keywords.",
    "Consider their commands when deciding your approach — but you remain",
    "responsible for the current slice's validation gate.",
    "",
  ];
  for (const s of skills) {
    lines.push(`### ${s.summary} (reused ${s.reuseCount}×)`);
    lines.push("");
    for (const c of s.commands) lines.push("- `" + c + "`");
    lines.push("");
  }
  lines.push("--- END AUTO-SKILL CONTEXT ---");
  lines.push("");
  return lines.join("\n");
}

/**
 * Build a run summary thought for capture after completion.
 *
 * @param {object} summary - Run summary object
 * @param {string} projectName - Project name
 * @returns {{ content: string, project: string, source: string, created_by: string }}
 */
export function buildRunSummaryThought(summary, projectName) {
  const parts = [
    `Plan execution completed: ${summary.plan}`,
    `Status: ${summary.status}`,
    `Slices: ${summary.results?.passed || 0} passed, ${summary.results?.failed || 0} failed`,
    `Duration: ${Math.round((summary.totalDuration || 0) / 1000)}s`,
  ];

  if (summary.cost?.total_cost_usd > 0) {
    parts.push(`Cost: $${summary.cost.total_cost_usd}`);
  }

  if (summary.sweep?.ran) {
    parts.push(`Sweep: ${summary.sweep.clean ? "clean" : `${summary.sweep.markerCount || "?"} markers`}`);
  }

  if (summary.analyze?.score != null) {
    parts.push(`Consistency score: ${summary.analyze.score}/100`);
  }

  // Include per-slice outcomes for learning
  if (summary.sliceResults) {
    for (const sr of summary.sliceResults) {
      if (sr.status === "failed") {
        parts.push(`Slice ${sr.number || sr.sliceId} FAILED: ${sr.gateError || sr.error || "unknown"}`);
      }
    }
  }

  return {
    content: parts.join(". "),
    project: projectName,
    source: `plan-forge-orchestrator/${summary.plan}`,
    created_by: "plan-forge-orchestrator",
  };
}

/**
 * Build a cost anomaly thought if current run cost differs significantly.
 *
 * @param {object} summary - Current run summary
 * @param {object} costReport - Historical cost report
 * @param {string} projectName - Project name
 * @returns {object|null} Thought to capture, or null if no anomaly
 */
export function buildCostAnomalyThought(summary, costReport, projectName) {
  if (!summary.cost?.total_cost_usd || !costReport?.total_cost_usd || costReport.runs < 2) {
    return null;
  }

  const avgCostPerRun = costReport.total_cost_usd / costReport.runs;
  const currentCost = summary.cost.total_cost_usd;
  const ratio = currentCost / avgCostPerRun;

  if (ratio > 2.0) {
    return {
      content: `Cost anomaly: ${summary.plan} cost $${currentCost} (${ratio.toFixed(1)}x the average of $${avgCostPerRun.toFixed(2)}). Review slice complexity or model selection.`,
      project: projectName,
      source: `plan-forge-orchestrator/${summary.plan}`,
      created_by: "plan-forge-orchestrator",
      type: "insight",
    };
  }

  return null;
}

// ─── Watcher anomaly → thought shaping (v2.35.1 / G3.1) ─────────────────

/**
 * Shape a watcher anomaly into a capturable thought.
 *
 * Pure function: given an anomaly object + run metadata, returns the
 * `{ content, type, source }` triple that callers pass to `captureMemory()`.
 * Keeps the source attribution format consistent with GX.4: `<tool>/<code>`.
 *
 * Severity → type mapping:
 *   - "info"        → "lesson" (e.g. all-skipped is a learning, not a gotcha)
 *   - "warn"/"error"→ "gotcha" (recurring patterns worth remembering)
 *
 * @param {{ severity: string, code: string, message: string }} anomaly
 * @param {{ targetPath?: string, runId?: string|null, runState?: string }} meta
 * @param {"forge_watch"|"forge_watch_live"} [tool="forge_watch"]
 * @returns {{ content: string, type: string, source: string }}
 */
export function shapeWatcherAnomalyThought(anomaly, meta = {}, tool = "forge_watch") {
  const type = anomaly.severity === "info" ? "lesson" : "gotcha";
  const prefix = tool === "forge_watch_live" ? "Live watcher anomaly" : "Watcher anomaly";
  const parts = [`${prefix} [${anomaly.code}]: ${anomaly.message}`];
  if (meta.targetPath) parts.push(`targetPath=${meta.targetPath}`);
  parts.push(`runId=${meta.runId || "n/a"}`);
  if (meta.runState) parts.push(`state=${meta.runState}`);
  return {
    content: parts.join(". "),
    type,
    source: `${tool}/${anomaly.code}`,
  };
}

/**
 * Deduplicate watcher anomalies within a single session by `code|message`.
 * Pure function — the caller decides what to do with the result.
 *
 * @param {Array<{ code: string, message: string }>} anomalies
 * @returns {Array} unique anomalies preserving first-seen order
 */
export function dedupeWatcherAnomalies(anomalies) {
  if (!Array.isArray(anomalies)) return [];
  const seen = new Set();
  const out = [];
  for (const a of anomalies) {
    if (!a || !a.code) continue;
    const key = `${a.code}|${a.message || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ─── G2.6 — OpenBrain queue state + DLQ ────────────────────────────────

/**
 * G2.6 (v2.36): wrap an enqueued thought with bookkeeping fields so a worker
 * (or the SessionStart drain hook) can track delivery state across attempts.
 *
 * Pure function — caller appends the result to `.forge/openbrain-queue.jsonl`.
 *
 *  _v             — schema version (G2.2)
 *  _status        — "pending" | "processing" | "failed" | "delivered"
 *  _attempts      — number of delivery attempts so far
 *  _enqueuedAt    — ISO timestamp the thought was first queued
 *  _nextAttemptAt — ISO timestamp the next delivery attempt is allowed
 *
 * @param {object} thought - The captured thought (content/type/source/etc.)
 * @returns {object} enriched queue record
 */
export function shapeQueueRecord(thought) {
  const now = new Date().toISOString();
  return {
    _v: 1,
    _status: "pending",
    _attempts: 0,
    _enqueuedAt: now,
    _nextAttemptAt: now,
    ...thought,
  };
}

/**
 * G2.6 (v2.36): given a current attempt count, return the next-attempt
 * timestamp using exponential backoff with jitter.
 *
 *   attempt 1 → 30s, 2 → 60s, 3 → 120s, 4 → 240s, 5 → 480s
 *   jitter ±20% to avoid thundering herd
 *
 * @param {number} attempts - Current attempt count (after increment)
 * @param {number} [now=Date.now()]
 * @returns {string} ISO timestamp
 */
export function nextBackoffTimestamp(attempts, now = Date.now()) {
  const base = 30_000 * Math.pow(2, Math.max(0, attempts - 1)); // ms
  const jitter = base * (Math.random() * 0.4 - 0.2); // ±20%
  return new Date(now + base + jitter).toISOString();
}

/**
 * G2.6 (v2.36): decide what to do with a queue record after a failed
 * delivery attempt. Pure function — returns either the updated record
 * (still in queue) or a DLQ marker (move to .forge/openbrain-dlq.jsonl).
 *
 *   maxAttempts (default 5) — after this many failures, move to DLQ.
 *
 * @param {object} record - Queue record from shapeQueueRecord
 * @param {{maxAttempts?: number, error?: string, now?: number}} [opts]
 * @returns {{action: "retry"|"dlq", record: object}}
 */
export function applyDeliveryFailure(record, opts = {}) {
  const { maxAttempts = 5, error = "unknown", now = Date.now() } = opts;
  const attempts = (record._attempts || 0) + 1;
  if (attempts >= maxAttempts) {
    return {
      action: "dlq",
      record: {
        ...record,
        _status: "failed",
        _attempts: attempts,
        _failedAt: new Date(now).toISOString(),
        _lastError: String(error).slice(0, 500),
      },
    };
  }
  return {
    action: "retry",
    record: {
      ...record,
      _status: "pending",
      _attempts: attempts,
      _lastError: String(error).slice(0, 500),
      _nextAttemptAt: nextBackoffTimestamp(attempts, now),
    },
  };
}

/**
 * G2.6 (v2.36): partition queue records into those eligible for delivery
 * right now vs those still in backoff. Pure function — caller dispatches
 * the eligible records to the actual ingestor.
 *
 * @param {Array<object>} records
 * @param {number} [now=Date.now()]
 * @returns {{ready: Array, deferred: Array}}
 */
export function partitionByBackoff(records, now = Date.now()) {
  const ready = [];
  const deferred = [];
  if (!Array.isArray(records)) return { ready, deferred };
  const cutoff = now;
  for (const r of records) {
    if (!r || r._status === "delivered" || r._status === "failed") continue;
    const next = r._nextAttemptAt ? Date.parse(r._nextAttemptAt) : 0;
    if (Number.isFinite(next) && next <= cutoff) ready.push(r);
    else deferred.push(r);
  }
  return { ready, deferred };
}

// ─── G2.8 — Capture observability ──────────────────────────────────────

/**
 * G2.8 (v2.36): build a stats record summarising a drain pass for the
 * `.forge/openbrain-stats.jsonl` ledger. Lets the dashboard show queue
 * health (delivered vs deferred vs DLQ over time) without re-reading
 * the queue file every render.
 *
 * Pure function — caller writes the result.
 *
 * @param {{attempted: number, delivered: number, deferred: number, dlq: number, durationMs: number, source?: string}} pass
 * @returns {object}
 */
export function buildDrainStatsRecord(pass) {
  return {
    _v: 1,
    timestamp: new Date().toISOString(),
    source: pass.source || "drain",
    attempted: pass.attempted | 0,
    delivered: pass.delivered | 0,
    deferred: pass.deferred | 0,
    dlq: pass.dlq | 0,
    durationMs: pass.durationMs | 0,
  };
}

// ─── Phase-28.4 — OpenBrain queue drain orchestrator ────────────────────

/**
 * Phase-28.4 (v2.62.3): drain eligible records from the OpenBrain queue.
 * Pure function — composes partitionByBackoff, calls injected dispatcher,
 * calls applyDeliveryFailure on failures, returns structured result.
 * Zero filesystem I/O — caller handles persistence.
 *
 * @param {Array<object>} records - Queue records from openbrain-queue.jsonl
 * @param {(record: object) => Promise<{ok: boolean, error?: string}>} dispatcher - Injected delivery function
 * @param {{maxBatch?: number, maxAttempts?: number, now?: number, source?: string}} [opts]
 * @returns {Promise<{delivered: Array, deferred: Array, dlq: Array, archive: Array, stats: object}>}
 */
export async function drainOpenBrainQueue(records, dispatcher, opts = {}) {
  const { maxBatch = 50, maxAttempts = 5, now = Date.now(), source = "drain" } = opts;
  const t0 = now;

  const { ready, deferred } = partitionByBackoff(records, now);

  // Slice to batch ceiling; surplus records go back to deferred untouched
  const batch = ready.slice(0, maxBatch);
  const surplus = ready.slice(maxBatch);
  const allDeferred = [...deferred, ...surplus];

  const delivered = [];
  const archive = [];
  const dlq = [];
  const retrying = [];

  for (const record of batch) {
    let result;
    try {
      result = await dispatcher(record);
    } catch (err) {
      result = { ok: false, error: String(err?.message || err || "unknown") };
    }

    if (result && result.ok) {
      const done = {
        ...record,
        _status: "delivered",
        _deliveredAt: new Date(now).toISOString(),
      };
      delivered.push(done);
      archive.push(done);
    } else {
      const error = result?.error || "unknown";
      const outcome = applyDeliveryFailure(record, { maxAttempts, error, now });
      if (outcome.action === "dlq") {
        dlq.push(outcome.record);
      } else {
        retrying.push(outcome.record);
      }
    }
  }

  const stats = buildDrainStatsRecord({
    attempted: batch.length,
    delivered: delivered.length,
    deferred: allDeferred.length + retrying.length,
    dlq: dlq.length,
    durationMs: Date.now() - t0,
    source,
  });

  return {
    delivered,
    deferred: [...allDeferred, ...retrying],
    dlq,
    archive,
    stats,
  };
}

// ─── G3.2 — Similarity-based dedupe ────────────────────────────────────

/**
 * G3.2 (v2.36): tokenise a string into a bag of lowercase word tokens.
 * Pure helper used by `cosineSimilarity` and `dedupeThoughtsBySimilarity`.
 *
 * @param {string} text
 * @returns {Map<string, number>} token → count
 */
export function tokenize(text) {
  const out = new Map();
  if (!text || typeof text !== "string") return out;
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
  for (const t of tokens) out.set(t, (out.get(t) || 0) + 1);
  return out;
}

/**
 * G3.2 (v2.36): cosine similarity between two token bags (0..1).
 * Pure — used to suppress near-duplicate thoughts before they land in L2/L3.
 * Uses term-frequency vectors; intentionally simple, no IDF.
 *
 * @param {string|Map<string,number>} a
 * @param {string|Map<string,number>} b
 * @returns {number} in [0, 1]
 */
export function cosineSimilarity(a, b) {
  const va = a instanceof Map ? a : tokenize(a);
  const vb = b instanceof Map ? b : tokenize(b);
  if (va.size === 0 || vb.size === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (const [, v] of va) magA += v * v;
  for (const [, v] of vb) magB += v * v;
  const smaller = va.size < vb.size ? va : vb;
  const larger = smaller === va ? vb : va;
  for (const [t, v] of smaller) {
    const w = larger.get(t);
    if (w) dot += v * w;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * G3.2 (v2.36): dedupe a batch of thoughts by cosine similarity on their
 * `content` field. Keeps the first occurrence; drops later ones whose
 * similarity to any kept thought exceeds `threshold` (default 0.9).
 *
 * Pure function — caller decides which survivors to persist.
 *
 * @param {Array<{content?: string}>} thoughts
 * @param {{threshold?: number}} [opts]
 * @returns {{kept: Array, dropped: Array<{thought: object, similarTo: object, similarity: number}>}}
 */
export function dedupeThoughtsBySimilarity(thoughts, opts = {}) {
  const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.9;
  const kept = [];
  const dropped = [];
  const vectors = [];
  if (!Array.isArray(thoughts)) return { kept, dropped };
  for (const t of thoughts) {
    if (!t || typeof t.content !== "string" || t.content.length === 0) {
      kept.push(t); // nothing to compare — pass through untouched
      vectors.push(null);
      continue;
    }
    const vec = tokenize(t.content);
    let match = null;
    let bestScore = 0;
    for (let i = 0; i < vectors.length; i++) {
      if (!vectors[i]) continue;
      const score = cosineSimilarity(vec, vectors[i]);
      if (score >= threshold && score > bestScore) {
        match = kept[i];
        bestScore = score;
      }
    }
    if (match) {
      dropped.push({ thought: t, similarTo: match, similarity: Math.round(bestScore * 1000) / 1000 });
    } else {
      kept.push(t);
      vectors.push(vec);
    }
  }
  return { kept, dropped };
}

// ─── G3.3 — Proactive search prompt for watcher anomalies ─────────────

/**
 * G3.3 (v2.36): build an OpenBrain search-instruction block tailored to a
 * watcher anomaly. The MCP tool embeds this block in its response so the
 * caller (agent) proactively asks OpenBrain for prior findings on the same
 * anomaly code before reacting — closing the "observer is amnesic" loop.
 *
 * Returns "" when projectName is falsy or the anomaly is shapeless.
 *
 * @param {{code?: string, message?: string}} anomaly
 * @param {string} projectName
 * @returns {string}
 */
export function buildWatcherSearchPrompt(anomaly, projectName) {
  if (!anomaly || !anomaly.code || !projectName) return "";
  const query = `watcher anomaly ${anomaly.code}`;
  const lines = [
    "--- PRIOR FINDINGS (OpenBrain) ---",
    `Before reacting to anomaly '${anomaly.code}', check prior occurrences:`,
    `  Use search_thoughts tool with query: "${query}", project: "${projectName}", limit: 5`,
    "If matches exist, apply their documented mitigations. If not, record this occurrence via capture_thought after investigation.",
    "--- END PRIOR FINDINGS ---",
  ];
  return lines.join("\n") + "\n";
}

// ─── G3.5 — Thought TTL / expiresAt ────────────────────────────────────

/**
 * G3.5 (v2.36): stamp an `expiresAt` field on a thought based on type.
 * Mutates-free: returns a shallow clone. Used by `captureMemory()` so
 * short-lived observations don't haunt searches forever.
 *
 *   lesson   → 365d
 *   decision → 180d
 *   gotcha   → 90d
 *   pattern  → no expiry
 *   convention → no expiry
 *   (default) 90d
 *
 * Caller-supplied `expiresAt` wins.
 *
 * @param {object} thought
 * @param {{now?: number, overrides?: Record<string, number>}} [opts]
 * @returns {object}
 */
export function stampThoughtExpiry(thought, opts = {}) {
  if (!thought || typeof thought !== "object") return thought;
  if (thought.expiresAt) return thought;
  const DAY = 24 * 60 * 60 * 1000;
  const defaults = { lesson: 365, decision: 180, gotcha: 90, pattern: null, convention: null };
  const byType = { ...defaults, ...(opts.overrides || {}) };
  const days = byType[thought.type];
  if (days == null) return thought; // no expiry
  const now = opts.now ?? Date.now();
  return { ...thought, expiresAt: new Date(now + days * DAY).toISOString() };
}

/**
 * G3.5 (v2.36): filter out thoughts whose `expiresAt` is in the past.
 * Missing/invalid `expiresAt` means never-expires.
 *
 * @param {Array<object>} thoughts
 * @param {number} [now=Date.now()]
 * @returns {Array<object>}
 */
export function filterUnexpiredThoughts(thoughts, now = Date.now()) {
  if (!Array.isArray(thoughts)) return [];
  return thoughts.filter((t) => {
    if (!t || !t.expiresAt) return true;
    const ts = Date.parse(t.expiresAt);
    return !Number.isFinite(ts) || ts > now;
  });
}

// ─── G3.6 — Capture telemetry ──────────────────────────────────────────

/**
 * G3.6 (v2.36): shape a capture-telemetry record. Every `captureMemory()`
 * call emits one of these to `.forge/telemetry/memory-captures.jsonl` so
 * we can answer "who's capturing what, and how often" without scraping
 * the memory files themselves.
 *
 * @param {{tool: string, type: string, source: string, content?: string, project?: string, deduped?: boolean}} ctx
 * @returns {object}
 */
export function buildCaptureTelemetry(ctx) {
  const contentLen = typeof ctx.content === "string" ? ctx.content.length : 0;
  return {
    _v: 1,
    timestamp: new Date().toISOString(),
    tool: ctx.tool || "unknown",
    type: ctx.type || "unknown",
    source: ctx.source || "unknown",
    project: ctx.project || null,
    contentLen,
    deduped: !!ctx.deduped,
  };
}

// ─── G3.7 — Search-result caching ──────────────────────────────────────

/**
 * G3.7 (v2.36): the MCP layer caches OpenBrain search results to
 * `.forge/memory-search-cache.jsonl` so agents don't re-query for the
 * same slice. Default TTL 1h.
 *
 * Pure helper: given a cached entry `{cachedAt, ttlMs}`, decide whether
 * it's still fresh.
 *
 * @param {{cachedAt: string|number, ttlMs?: number}} entry
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function isCacheEntryFresh(entry, now = Date.now()) {
  if (!entry || !entry.cachedAt) return false;
  const ts = typeof entry.cachedAt === "number" ? entry.cachedAt : Date.parse(entry.cachedAt);
  if (!Number.isFinite(ts)) return false;
  const ttl = typeof entry.ttlMs === "number" ? entry.ttlMs : 60 * 60 * 1000;
  return now - ts < ttl;
}

/**
 * G3.7 (v2.36): shape a cache entry. `key` should be a deterministic hash
 * of (query, project, limit) — the caller decides. We don't hash here so
 * the helper stays pure + dep-free.
 *
 * @param {{key: string, query: string, project: string, limit: number, results: Array<object>, ttlMs?: number}} ctx
 * @returns {object}
 */
export function buildCacheEntry(ctx) {
  return {
    _v: 1,
    key: ctx.key,
    query: ctx.query,
    project: ctx.project,
    limit: ctx.limit,
    results: Array.isArray(ctx.results) ? ctx.results : [],
    cachedAt: new Date().toISOString(),
    ttlMs: typeof ctx.ttlMs === "number" ? ctx.ttlMs : 60 * 60 * 1000,
  };
}

// ─── GX.4 — Source-attribution format ──────────────────────────────────

/**
 * GX.4 (v2.36): standardised source-attribution format is
 *   `<tool>` or `<tool>/<subsystem>` — e.g. `forge_watch/quorum-dissent`.
 *
 * - tool must match /^forge_[a-z_]+$/
 * - subsystem (when present) must match /^[a-z0-9_-]+$/
 *
 * Returns `{ valid: boolean, reason?: string }`.
 *
 * @param {string} source
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateSourceFormat(source) {
  if (typeof source !== "string" || source.length === 0) {
    return { valid: false, reason: "source must be a non-empty string" };
  }
  const parts = source.split("/");
  if (parts.length > 2) {
    return { valid: false, reason: "source must be '<tool>' or '<tool>/<subsystem>' (exactly one '/')" };
  }
  const [tool, subsystem] = parts;
  if (!/^forge_[a-z_]+$/.test(tool)) {
    return { valid: false, reason: `tool segment '${tool}' must match /^forge_[a-z_]+$/` };
  }
  if (subsystem !== undefined && !/^[a-z0-9_-]+$/.test(subsystem)) {
    return { valid: false, reason: `subsystem segment '${subsystem}' must match /^[a-z0-9_-]+$/` };
  }
  return { valid: true };
}

// ─── GX.3 — forge_memory_report aggregator ─────────────────────────────

function _safeStat(path) {
  try { return statSync(path); } catch { return null; }
}

function _readJsonl(path, limit = Infinity) {
  try {
    const text = readFileSync(path, "utf-8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const slice = Number.isFinite(limit) && lines.length > limit ? lines.slice(-limit) : lines;
    const out = [];
    for (const line of slice) {
      try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return out;
  } catch {
    return [];
  }
}

function _summariseFile(forgeDir, name) {
  const path = join(forgeDir, name);
  const st = _safeStat(path);
  if (!st) return { name, exists: false, size: 0, records: 0 };
  const records = _readJsonl(path);
  const versions = {};
  for (const r of records) {
    const v = r && r._v != null ? String(r._v) : "none";
    versions[v] = (versions[v] || 0) + 1;
  }
  return { name, exists: true, size: st.size, records: records.length, versions };
}

/**
 * GX.3 (v2.36): aggregate the health of every memory surface into a
 * single report — L2 files, OpenBrain queue state, drain stats trend,
 * capture telemetry, search cache. Consumed by the `forge_memory_report`
 * MCP tool (and by the dashboard Memory tab in a follow-up PR).
 *
 * Pure-ish: only reads from `.forge/` — never writes, never calls network.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {object}
 */
export function buildMemoryReport(cwd = process.cwd()) {
  const forgeDir = resolve(cwd, ".forge");
  const telemetryDir = join(forgeDir, "telemetry");
  const exists = existsSync(forgeDir);

  const l2Files = [
    "liveguard-memories.jsonl",
    "openbrain-queue.jsonl",
    "openbrain-dlq.jsonl",
    "openbrain-stats.jsonl",
    "hub-events.jsonl",
    "drift-history.jsonl",
    "incidents.jsonl",
    "regression-history.jsonl",
    "env-diff-history.jsonl",
    "memory-search-cache.jsonl",
  ].map((n) => _summariseFile(forgeDir, n));

  // Queue health (derived from openbrain-queue.jsonl)
  const queueRecords = exists ? _readJsonl(join(forgeDir, "openbrain-queue.jsonl")) : [];
  const queueBuckets = { pending: 0, delivered: 0, failed: 0, deferred: 0 };
  const now = Date.now();
  for (const r of queueRecords) {
    const status = r?._status || "pending";
    if (status === "delivered") queueBuckets.delivered++;
    else if (status === "failed") queueBuckets.failed++;
    else {
      const next = r?._nextAttemptAt ? Date.parse(r._nextAttemptAt) : 0;
      if (Number.isFinite(next) && next > now) queueBuckets.deferred++;
      else queueBuckets.pending++;
    }
  }
  const dlq = exists ? _readJsonl(join(forgeDir, "openbrain-dlq.jsonl")).length : 0;

  // Drain trend — last 20 drain passes
  const drainRecords = exists ? _readJsonl(join(forgeDir, "openbrain-stats.jsonl"), 20) : [];
  const drainTrend = {
    passes: drainRecords.length,
    lastAttempted: drainRecords.at(-1)?.attempted ?? 0,
    lastDelivered: drainRecords.at(-1)?.delivered ?? 0,
    totalDelivered: drainRecords.reduce((a, r) => a + (r.delivered | 0), 0),
    totalDeferred: drainRecords.reduce((a, r) => a + (r.deferred | 0), 0),
  };

  // Capture telemetry — last 500 records
  const telemetryPath = join(telemetryDir, "memory-captures.jsonl");
  const telemetryRecords = _readJsonl(telemetryPath, 500);
  const telemetry = {
    total: telemetryRecords.length,
    dedupedCount: telemetryRecords.filter((r) => r.deduped).length,
    byTool: {},
    byType: {},
  };
  for (const r of telemetryRecords) {
    if (r?.tool) telemetry.byTool[r.tool] = (telemetry.byTool[r.tool] || 0) + 1;
    if (r?.type) telemetry.byType[r.type] = (telemetry.byType[r.type] || 0) + 1;
  }

  // Search cache health
  const cacheRecords = exists ? _readJsonl(join(forgeDir, "memory-search-cache.jsonl")) : [];
  const uniqueKeys = new Set(cacheRecords.map((r) => r?.key).filter(Boolean));
  const freshEntries = cacheRecords.filter((r) => isCacheEntryFresh(r, now)).length;
  const cache = {
    totalEntries: cacheRecords.length,
    uniqueKeys: uniqueKeys.size,
    freshEntries,
  };

  // Orphan audit — files in .forge/ not listed in the known registry
  const knownFiles = new Set([
    "liveguard-memories.jsonl", "openbrain-queue.jsonl", "openbrain-dlq.jsonl",
    "openbrain-stats.jsonl", "hub-events.jsonl", "drift-history.jsonl",
    "incidents.jsonl", "regression-history.jsonl", "env-diff-history.jsonl",
    "memory-search-cache.jsonl", "runs",
  ]);
  const orphans = [];
  if (exists) {
    try {
      for (const entry of readdirSync(forgeDir)) {
        if (entry.startsWith(".")) continue;
        if (knownFiles.has(entry)) continue;
        if (entry === "telemetry") continue;
        // Tolerate .bak files (from migrate-memory) and directories
        if (entry.endsWith(".bak") || /\.bak-\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
        orphans.push(entry);
      }
    } catch { /* ignore */ }
  }

  return {
    _v: 1,
    timestamp: new Date().toISOString(),
    cwd,
    forgeDirExists: exists,
    l2Files,
    queue: { ...queueBuckets, dlq },
    drainTrend,
    telemetry,
    cache,
    orphans,
  };
}

// ─── GX.2 — L3 → L1 preload on plan-start ──────────────────────────────

/**
 * GX.2 (v2.36): build a "plan boot context" — a small bundle of OpenBrain
 * search hints derived from the plan itself. Emitted into the L1 hub at
 * `run-started` time so the dashboard, watchers, and the first worker
 * see prior decisions about *this plan* and *its slice domains* before
 * the first slice starts (instead of waiting until mid-slice for the
 * worker's own `search_thoughts` call).
 *
 * The hints are deterministic — the actual L3 lookup is still performed
 * by the agent (we don't have OpenBrain credentials server-side). What
 * GX.2 closes is the "no semantic context at boot" gap.
 *
 * Pure function. Returns an empty `hints` array when projectName/plan
 * are absent — caller can broadcast unconditionally.
 *
 * @param {{slices?: Array<{title?: string, name?: string}>, name?: string}} plan
 * @param {string} projectName
 * @param {{maxHints?: number}} [opts]
 * @returns {{_v: number, projectName: string, planName: string, hints: Array<{kind: string, query: string, limit: number}>}}
 */
export function buildPlanBootContext(plan, projectName, opts = {}) {
  const maxHints = typeof opts.maxHints === "number" ? opts.maxHints : 8;
  const planName = (plan && (plan.name || plan.planName)) || "";
  const out = { _v: 1, projectName: projectName || "", planName, hints: [] };
  if (!projectName || !plan) return out;

  // 1) Plan-level hint — prior runs of this exact plan
  if (planName) {
    out.hints.push({ kind: "plan-history", query: `plan ${planName}`, limit: 5 });
  }

  // 2) Slice-keyword hints — dedup by query string
  const map = loadKeywordSearchMap();
  const seen = new Set();
  const slices = Array.isArray(plan.slices) ? plan.slices : [];
  for (const slice of slices) {
    const title = (slice && (slice.title || slice.name)) || "";
    if (!title) continue;
    for (const { pattern, query } of map) {
      if (seen.has(query)) continue;
      if (pattern.test(title)) {
        out.hints.push({ kind: "slice-keyword", query, limit: 5 });
        seen.add(query);
        if (out.hints.length >= maxHints) return out;
      }
    }
  }

  return out;
}

// ─── Phase-26 Slice 7: Gate-suggestion accept counter (C4) ───────────────────

/**
 * Path to the gate-suggestions event ledger. Append-only JSONL.
 * One record per user action (accept / reject / defer).
 */
const GATE_SUGGESTIONS_PATH = ".forge/gate-suggestions.jsonl";

/**
 * Derive a stable per-suggestion key from its domain and suggested command.
 * Same `(domain, suggestedCommand)` tuple across plans yields the same key
 * so accept counts aggregate. Truncated SHA-256 (12 hex chars) keeps the key
 * short but collision-resistant at this cardinality.
 *
 * @param {{ domain: string, suggestedCommand: string }} suggestion
 * @returns {string}
 */
export function computeGateSuggestionKey(suggestion) {
  const domain = String(suggestion?.domain || "");
  const command = String(suggestion?.suggestedCommand || "");
  return createHash("sha256").update(`${domain}\u0000${command}`).digest("hex").slice(0, 12);
}

/**
 * Append an `accept` event for a gate suggestion to `.forge/gate-suggestions.jsonl`.
 * Returns the suggestion's current `acceptCount` after this record is persisted.
 *
 * Schema:
 *   { type: "accept", suggestionKey, sliceNumber, sliceTitle, domain,
 *     suggestedCommand, at: ISO-timestamp }
 *
 * Phase-26 MUST #C4 / D8: per-suggestion counter, not global; used by
 * `synthesizeGateSuggestions` in `enforce` mode to decide when to auto-inject
 * (threshold: 5 accepts).
 *
 * @param {object} suggestion - a suggestion object from `synthesizeGateSuggestions`
 * @param {string} [cwd=process.cwd()]
 * @returns {{ suggestionKey: string, acceptCount: number }}
 */
export function recordGateAccept(suggestion, cwd = process.cwd()) {
  if (!suggestion || typeof suggestion !== "object") {
    throw new Error("recordGateAccept: suggestion object required");
  }
  const suggestionKey = computeGateSuggestionKey(suggestion);
  const record = {
    type: "accept",
    suggestionKey,
    sliceNumber: suggestion.sliceNumber ?? null,
    sliceTitle: suggestion.sliceTitle || "",
    domain: suggestion.domain || "",
    suggestedCommand: suggestion.suggestedCommand || "",
    at: new Date().toISOString(),
  };
  const path = resolve(cwd, GATE_SUGGESTIONS_PATH);
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
  return { suggestionKey, acceptCount: getGateSuggestionCounter(suggestionKey, cwd) };
}

/**
 * Count `accept` events recorded for a given suggestion key.
 * Reads `.forge/gate-suggestions.jsonl` and returns 0 when the ledger is
 * missing, empty, or malformed.
 *
 * @param {string} suggestionKey
 * @param {string} [cwd=process.cwd()]
 * @returns {number}
 */
export function getGateSuggestionCounter(suggestionKey, cwd = process.cwd()) {
  if (!suggestionKey) return 0;
  const path = resolve(cwd, GATE_SUGGESTIONS_PATH);
  if (!existsSync(path)) return 0;
  let count = 0;
  for (const record of _readJsonl(path)) {
    if (record && record.type === "accept" && record.suggestionKey === suggestionKey) {
      count += 1;
    }
  }
  return count;
}


