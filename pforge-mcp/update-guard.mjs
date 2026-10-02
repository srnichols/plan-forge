/**
 * Plan Forge — update guard for framework guidance files (#280).
 *
 * `pforge update` used to overwrite instruction, prompt, agent, skill, hook and
 * runbook files unconditionally, which replaced projects' own edits and put
 * setup's rendered placeholders (`<YOUR PROJECT NAME>` …) back. Both CLI shells
 * now route those files through this module so the decision lives in one place:
 *
 *   new         the project does not have the file              → add it
 *   same        the project already has the (rendered) new text  → nothing to do
 *   update      the project has a version Plan Forge shipped     → replace it
 *   customized  the project's text matches no shipped version    → keep it and
 *               save the new version under .forge/update-pending/ (or, with
 *               --overwrite-customized, back it up and replace it)
 *
 * "Shipped" means the content hash appears in shipped-guidance-hashes.json, an
 * index of every guidance file version in Plan Forge's release history
 * (scripts/build-shipped-guidance-hashes.mjs). Markdown is compared with the
 * project's placeholder values turned back into tokens, so setup's rendering
 * does not look like a customization.
 *
 * CLI (paths in the list are relative, so no shell has to translate them):
 *   node update-guard.mjs plan  --source <dir> --project <dir> --list <tsv> [--index <file>]
 *   node update-guard.mjs apply --source <dir> --project <dir> --list <tsv> [--index <file>] [--overwrite-customized]
 * The index defaults to the shipped-guidance-hashes.json next to this module, so
 * a project's installed copy of the guard can run against any update source.
 * List lines: "<path in source>\t<path in project>". Output lines are tab-separated:
 *   plan:  <new|same|update|customized>\t<path in project>
 *   apply: <added|updated|unchanged|kept|overwrote>\t<path in project>\t<pending or backup path>
 *
 * @module update-guard
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PENDING_DIR = ".forge/update-pending";
export const BACKUP_DIR = ".forge/update-backups";
export const INDEX_FILE = "shipped-guidance-hashes.json";
export const DEFAULT_INDEX_PATH = join(dirname(fileURLToPath(import.meta.url)), INDEX_FILE);

/** Hash prefix length: 64 bits is ample to tell ~1k shipped versions apart. */
export const HASH_HEX_CHARS = 16;

/** Placeholders setup renders in Markdown, and the .forge.json key holding each value. */
export const PLACEHOLDERS = Object.freeze([
  Object.freeze({ token: "<YOUR PROJECT NAME>", key: "projectName" }),
  Object.freeze({ token: "<YOUR TECH STACK>", key: "stack" }),
  Object.freeze({ token: "<DATE>", key: "setupDate" }),
]);

/** Strip a BOM and every CR so Windows checkouts compare equal to the shipped text. */
export function normalizeText(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r/g, "");
}

export function contentHash(text) {
  return createHash("sha256").update(normalizeText(text), "utf8").digest("hex").slice(0, HASH_HEX_CHARS);
}

/** Placeholder values setup used for this project, from .forge.json. Missing or empty values are left out. */
export function readPlaceholderValues(projectRoot) {
  const values = {};
  try {
    const config = JSON.parse(readFileSync(join(projectRoot, ".forge.json"), "utf8"));
    for (const { key } of PLACEHOLDERS) {
      if (typeof config[key] === "string" && config[key].trim()) values[key] = config[key];
    }
  } catch { /* no or unreadable .forge.json: leave tokens as they are */ }
  return values;
}

export function renderPlaceholders(text, values) {
  return PLACEHOLDERS.reduce((out, { token, key }) => (values[key] ? out.split(token).join(values[key]) : out), text);
}

/** Turn rendered values back into tokens, longest value first so one value cannot split another. */
export function unrenderPlaceholders(text, values) {
  return PLACEHOLDERS
    .filter(({ key }) => values[key])
    .sort((a, b) => values[b.key].length - values[a.key].length)
    .reduce((out, { token, key }) => out.split(values[key]).join(token), text);
}

export function loadShippedHashes(indexPath = DEFAULT_INDEX_PATH) {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!Array.isArray(index.hashes)) throw new Error(`${INDEX_FILE} has no hashes array`);
  return new Set(index.hashes);
}

/**
 * Decide what update should do with one guidance file.
 * @returns {{ action: "new"|"same"|"update"|"customized", content: string }}
 *          content is the text to write: rendered Markdown, or the source text.
 */
export function classifyFile({ sourceText, projectText, isMarkdown, values, shippedHashes }) {
  const content = isMarkdown ? renderPlaceholders(sourceText, values) : sourceText;
  if (projectText === null) return { action: "new", content };
  if (normalizeText(projectText) === normalizeText(content)) return { action: "same", content };
  const forms = isMarkdown ? [projectText, unrenderPlaceholders(projectText, values)] : [projectText];
  const shipped = forms.some((text) => shippedHashes.has(contentHash(text)));
  return { action: shipped ? "update" : "customized", content };
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function writeWithDirs(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Classify every listed file. */
export function planUpdates(entries, { sourceRoot, projectRoot, shippedHashes, values = readPlaceholderValues(projectRoot) }) {
  return entries.map(({ sourcePath, projectPath }) => {
    const isMarkdown = projectPath.toLowerCase().endsWith(".md");
    const { action, content } = classifyFile({
      sourceText: readFileSync(join(sourceRoot, sourcePath), "utf8"),
      projectText: readIfExists(join(projectRoot, projectPath)),
      isMarkdown,
      values,
      shippedHashes,
    });
    return { sourcePath, projectPath, action, content, isMarkdown };
  });
}

/** Apply a plan. Non-Markdown files are copied byte for byte, as before. */
export function applyUpdates(plan, { sourceRoot, projectRoot, overwriteCustomized = false, stamp = new Date().toISOString().replace(/[:.]/g, "-") }) {
  return plan.map((item) => {
    const target = join(projectRoot, item.projectPath);
    const write = () => (item.isMarkdown ? writeWithDirs(target, item.content) : (mkdirSync(dirname(target), { recursive: true }), copyFileSync(join(sourceRoot, item.sourcePath), target)));
    switch (item.action) {
      case "new":
        write();
        return { result: "added", projectPath: item.projectPath, detail: "" };
      case "update":
        write();
        return { result: "updated", projectPath: item.projectPath, detail: "" };
      case "same":
        return { result: "unchanged", projectPath: item.projectPath, detail: "" };
      default: {
        if (overwriteCustomized) {
          const backup = `${BACKUP_DIR}/${stamp}/${item.projectPath}`;
          writeWithDirs(join(projectRoot, backup), readFileSync(target, "utf8"));
          write();
          return { result: "overwrote", projectPath: item.projectPath, detail: backup };
        }
        const pending = `${PENDING_DIR}/${item.projectPath}`;
        writeWithDirs(join(projectRoot, pending), item.content);
        return { result: "kept", projectPath: item.projectPath, detail: pending };
      }
    }
  });
}

export function parseList(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sourcePath, projectPath] = line.split("\t");
    if (!sourcePath || !projectPath) throw new Error(`malformed list line: ${line}`);
    return { sourcePath: sourcePath.replace(/\\/g, "/"), projectPath: projectPath.replace(/\\/g, "/") };
  });
}

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_NO_INDEX = 3;
const MODES = Object.freeze(["plan", "apply"]);
const USAGE = "usage: update-guard.mjs <plan|apply> --source <dir> --project <dir> --list <tsv> [--index <file>] [--overwrite-customized]\n";

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const opts = { mode, overwriteCustomized: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--overwrite-customized") opts.overwriteCustomized = true;
    else if (["--source", "--project", "--list", "--index"].includes(rest[i])) opts[rest[i].slice(2)] = rest[++i];
  }
  return opts;
}

function isUsable(opts) {
  return MODES.includes(opts.mode) && Boolean(opts.source && opts.project && opts.list);
}

export function runCli(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const opts = parseArgs(argv);
  if (!isUsable(opts)) {
    stderr.write(USAGE);
    return EXIT_USAGE;
  }
  let shippedHashes;
  try {
    shippedHashes = loadShippedHashes(opts.index || DEFAULT_INDEX_PATH);
  } catch (err) {
    stderr.write(`update-guard: cannot read ${INDEX_FILE}: ${err.message}\n`);
    return EXIT_NO_INDEX;
  }
  const roots = { sourceRoot: opts.source, projectRoot: opts.project };
  const plan = planUpdates(parseList(readFileSync(opts.list, "utf8")), { ...roots, shippedHashes });
  const lines = opts.mode === "plan"
    ? plan.map((item) => `${item.action}\t${item.projectPath}\n`)
    : applyUpdates(plan, { ...roots, overwriteCustomized: opts.overwriteCustomized }).map((r) => `${r.result}\t${r.projectPath}\t${r.detail}\n`);
  for (const line of lines) stdout.write(line);
  return EXIT_OK;
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isMain) {
  process.exitCode = runCli(process.argv.slice(2));
}
