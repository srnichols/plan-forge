/**
 * Plan Forge — Crucible Enforcement (Slice 01.4).
 *
 * Requires every `pforge run-plan` invocation to carry a `crucibleId:`
 * frontmatter or pass `--manual-import` to bypass (audited).
 *
 * Frontmatter format (3-line YAML-ish, no external dep):
 *   ---
 *   key: value
 *   ---
 *   <body>
 *
 * Audit log: `.forge/crucible/manual-imports.jsonl`
 *   Each line: {timestamp, planPath, source, reason?, crucibleId?}
 *
 * The `source` tag supports multiple bypass paths:
 *   - "human"       — user passed --manual-import explicitly
 *   - "speckit"     — Spec Kit importer (Step 0 prompt) wrote an
 *                     `imported-speckit-*` crucibleId but audit
 *                     records the origin so it's discoverable
 *   - "grandfather" — crucible-migrate.mjs stamped a legacy plan
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a `---\n…\n---` YAML-ish frontmatter block.
 * Returns `{ frontmatter, body, raw }` where frontmatter is a flat
 * string-to-string map. Scalar values only — no arrays, no nested maps.
 * Unknown lines inside the block are ignored.
 *
 * @param {string} content
 * @returns {{frontmatter: Record<string,string>, body: string, raw: string|null}}
 */
export function parseFrontmatter(content) {
  if (typeof content !== "string" || !content.startsWith("---")) {
    return { frontmatter: {}, body: content || "", raw: null };
  }
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: content, raw: null };
  const raw = m[1];
  const frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (!kv) continue;
    let v = kv[2];
    // Strip optional surrounding quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    frontmatter[kv[1]] = v;
  }
  return { frontmatter, body: content.slice(m[0].length), raw };
}

/**
 * Structured error produced when a plan lacks `crucibleId:` and the
 * caller did not pass `--manual-import`.
 *
 * The same message is thrown from `enforceCrucibleId` so the CLI and
 * the MCP dispatcher can both surface it to the user verbatim.
 */
export class CrucibleEnforcementError extends Error {
  constructor(planPath, frontmatter = {}) {
    super(
      "Plan missing crucibleId — run it through Crucible first " +
      "(forge_crucible_submit), or pass --manual-import to bypass (logged).",
    );
    this.name = "CrucibleEnforcementError";
    this.code = "CRUCIBLE_ID_REQUIRED";
    this.planPath = planPath;
    this.frontmatter = frontmatter;
  }
}

/**
 * Validate that a plan file carries an acceptable `crucibleId:` field.
 * Audits bypass events when `manualImport` is true.
 *
 * @param {string} planPath     — absolute or project-relative path
 * @param {object} [opts]
 * @param {boolean} [opts.manualImport=false]
 * @param {string}  [opts.source="human"]  audit tag when bypassing
 * @param {string}  [opts.reason]          free-form note for audit
 * @param {string}  [opts.cwd=process.cwd()] project dir for audit log
 * @returns {{ ok: true, crucibleId: string, bypassed: boolean, frontmatter: Record<string,string> }}
 * @throws {CrucibleEnforcementError}
 */
export function enforceCrucibleId(planPath, opts = {}) {
  const {
    manualImport = false,
    source = "human",
    reason = null,
    cwd = process.cwd(),
  } = opts;

  const fullPath = resolve(cwd, planPath);
  let content = "";
  try { content = readFileSync(fullPath, "utf-8"); }
  catch (err) {
    // Surface file-not-found as a plain Error — enforcement only fires
    // when we can read the plan.
    throw new Error(`Plan file not readable: ${planPath} (${err.code || err.message})`);
  }

  const { frontmatter } = parseFrontmatter(content);
  const crucibleId = frontmatter.crucibleId || "";

  if (crucibleId) {
    return { ok: true, crucibleId, bypassed: false, frontmatter };
  }

  if (!manualImport) {
    throw new CrucibleEnforcementError(fullPath, frontmatter);
  }

  // Bypass accepted — write audit entry and succeed.
  logManualImport(cwd, {
    timestamp: new Date().toISOString(),
    planPath: fullPath,
    source,
    reason: reason || null,
    crucibleId: null,
  });
  return { ok: true, crucibleId: "", bypassed: true, frontmatter };
}

/**
 * Append a JSONL entry to `.forge/crucible/manual-imports.jsonl`.
 * Directory is created on demand. Failure to write is swallowed so a
 * full disk doesn't block execution — the gate itself has already
 * decided to allow the run.
 *
 * @param {string} cwd
 * @param {object} entry
 */
export function logManualImport(cwd, entry) {
  try {
    const dir = resolve(cwd, ".forge", "crucible");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "manual-imports.jsonl");
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* best-effort */ }
}

/**
 * Read all manual-import audit entries. Used by tests and the
 * governance view (Slice 01.6). Returns [] on any read error.
 *
 * @param {string} cwd
 * @returns {Array<object>}
 */
export function readManualImports(cwd) {
  try {
    const path = resolve(cwd, ".forge", "crucible", "manual-imports.jsonl");
    if (!existsSync(path)) return [];
    const text = readFileSync(path, "utf-8");
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Write a key-value pair into the plan's frontmatter (upsert). Used by
 * the Spec Kit importer and the grandfather migration to stamp a
 * `crucibleId:` on a legacy or imported plan file without touching the
 * body.
 *
 * Idempotent when `onlyIfMissing` is true — existing values are kept.
 *
 * Returns `{ changed: boolean, content: string }`. Callers decide
 * whether to persist.
 *
 * @param {string} content
 * @param {Record<string,string>} kv
 * @param {{onlyIfMissing?: boolean}} [opts]
 */
export function upsertFrontmatter(content, kv, opts = {}) {
  const { onlyIfMissing = false } = opts;
  const { frontmatter, body, raw } = parseFrontmatter(content);
  let changed = false;
  const merged = { ...frontmatter };
  for (const [k, v] of Object.entries(kv)) {
    if (onlyIfMissing && merged[k]) continue;
    if (merged[k] === v) continue;
    merged[k] = v;
    changed = true;
  }
  if (!changed && raw !== null) {
    return { changed: false, content };
  }
  const lines = Object.entries(merged).map(([k, v]) => `${k}: ${v}`);
  const block = `---\n${lines.join("\n")}\n---\n`;
  // Preserve a single blank line between frontmatter and body
  const bodyTrimmed = body.replace(/^\r?\n+/, "");
  return { changed: true, content: `${block}\n${bodyTrimmed}` };
}

// Re-export the audit dir path for tooling/tests.
export function manualImportLogPath(cwd) {
  return resolve(cwd, ".forge", "crucible", "manual-imports.jsonl");
}

// Quiet-unused export to keep dirname import tree-shake-safe in tests
// that only import parseFrontmatter.
void dirname;
