/**
 * Plan Forge — Diff-Classify PreCommit chain entry.
 * Shared implementation behind check-diff-classify.sh and check-diff-classify.ps1.
 *
 * Classifies the WHOLE staged diff against the diff-classify safety categories
 * and prints the chain verdict PreCommit.mjs expects:
 *   { "blocked": true, "message": "..." }   severity >= high, or diff unreadable
 *   { "blocked": false, "advisory": "..." } severity medium
 *   {}                                      low / none / nothing staged
 *
 * The wrappers used to pass the diff to Node through an environment variable.
 * PowerShell joined git's output lines with spaces (no line was "+"-prefixed
 * any more, so nothing was flagged), and a diff over the platform's variable
 * size limit (32 KiB on Windows, 128 KiB per string on Linux) never reached
 * Node at all. Node now reads the staged diff itself, bounded by the same
 * reader forge_diff_classify uses (meta-bugs #288–#291), and classifies every
 * line instead of the module's default 3,000-line window.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SEVERITY_BLOCK_INDEX = 3;
const SEVERITY_ADVISORY_INDEX = 2;

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
}

function emit(verdict) {
  process.stdout.write(JSON.stringify(verdict));
}

const root = repoRoot();
const classifierPath = join(root, "pforge-mcp", "diff-classify.mjs");
const readerPath = join(root, "pforge-mcp", "server", "git-diff-reader.mjs");

if (!existsSync(classifierPath) || !existsSync(readerPath)) {
  // Plan Forge runtime not installed in this repository — nothing to classify with.
  process.stdout.write("{}");
} else {
  const { readGitDiff } = await import(pathToFileURL(readerPath).href);
  let diff = null;
  try {
    diff = readGitDiff({ cwd: root, gitArgs: ["diff", "--cached"] });
  } catch (err) {
    // An unreadable or oversized staged diff is unclassified, not clean.
    const reason = (err.stderr ? String(err.stderr).trim() : "") || err.message;
    emit({ blocked: true, message: `diff-classify could not read the staged diff, so the commit was not classified: ${reason}` });
  }

  if (diff === "") {
    process.stdout.write("{}");
  } else if (diff !== null) {
    const { classifyDiff, SEVERITY_ORDER } = await import(pathToFileURL(classifierPath).href);
    const result = classifyDiff(diff, { maxLines: Number.MAX_SAFE_INTEGER });
    const idx = SEVERITY_ORDER.indexOf(result.severity);
    const cats = [...new Set(result.findings.map((f) => f.category))].join(", ");
    if (idx >= SEVERITY_BLOCK_INDEX) {
      emit({ blocked: true, message: `diff-classify blocked [${result.severity}]: ${cats}` });
    } else if (idx === SEVERITY_ADVISORY_INDEX) {
      emit({ blocked: false, advisory: `diff-classify warning [medium]: ${cats}` });
    } else {
      process.stdout.write("{}");
    }
  }
}
