#!/usr/bin/env node
/**
 * Checks the text of a project that setup.ps1 installed with `-Preset custom -Agent all` (#417).
 *
 *   node scripts/check-installed-text.mjs <project dir>      # prints each problem; exit 1 if there are any
 *
 * Windows PowerShell 5.1 writes text in the system code page unless told otherwise. That turned an em dash into
 * the single byte 0x97 and an arrow into "?" in the files setup generates. These are the checks that catch it:
 * every text file is valid UTF-8, the files that carry a dash or an arrow still do, a file read and written back
 * keeps its dashes, and the generated JSON has no byte order mark. The same install under PowerShell 7 passes,
 * so a pass says nothing about which shell ran it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIPPED = /(^|\/)(node_modules|\.git)(\/|$)/;
const UTF8_BOM = Buffer.from("\uFEFF", "utf8");
/** An em dash read as the system code page and written back as UTF-8. */
const MOJIBAKE = "\u00e2\u20ac";

/** Files setup generates for `-Preset custom -Agent all`, and a character each must still contain. */
const EXPECTED_TEXT = [
  [".gitignore", "produced by pforge \u2014 never commit"],
  ["docs/plans/auto/README.md", "\u2014"],
  ["CLAUDE.md", "\u2192"],
  ["GEMINI.md", "\u2192"],
  [".github/copilot-instructions.md", "\u2014"],
];

const JSON_FILES = [".forge.json", ".vscode/mcp.json", ".forge/capabilities.json", ".claude/mcp.json", ".gemini/settings.json"];

/** Every file under `root`, as a forward-slash path relative to it, without node_modules and .git. */
export function listProjectFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (SKIPPED.test(rel)) continue;
    if (statSync(full).isDirectory()) listProjectFiles(root, full, out);
    else out.push(rel);
  }
  return out;
}

function readIfPresent(project, file) {
  try {
    return readFileSync(join(project, file));
  } catch {
    return null;
  }
}

/** The text files that are not valid UTF-8. A file with a NUL byte is binary and is left alone. */
function notUtf8(project, files) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const isNotUtf8 = (file) => {
    const bytes = readFileSync(join(project, file));
    if (bytes.includes(0)) return false;
    try {
      decoder.decode(bytes);
      return false;
    } catch {
      return true;
    }
  };
  return files.filter(isNotUtf8).map((file) => `${file}: not valid UTF-8 (written in the system code page)`);
}

/** The generated files that must still carry their dash or arrow, and must not carry a mis-decoded one. */
function lostCharacters(project) {
  return EXPECTED_TEXT.flatMap(([file, expected]) => {
    const bytes = readIfPresent(project, file);
    if (bytes === null) return [`${file}: missing`];
    const text = bytes.toString("utf8");
    const problems = [];
    if (!text.includes(expected)) problems.push(`${file}: no longer contains ${JSON.stringify(expected)}`);
    if (text.includes(MOJIBAKE)) problems.push(`${file}: has an em dash decoded in the wrong code page`);
    return problems;
  });
}

/** The generated JSON that is missing, is not JSON, or starts with a byte order mark. */
function badJson(project) {
  return JSON_FILES.flatMap((file) => {
    const bytes = readIfPresent(project, file);
    if (bytes === null) return [`${file}: missing`];
    const problems = [];
    if (bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) problems.push(`${file}: starts with a byte order mark`);
    try {
      JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      problems.push(`${file}: is not valid JSON`);
    }
    return problems;
  });
}

/** @returns {string[]} what is wrong with the project's text; empty when nothing is */
export function checkInstalledText(project) {
  const files = listProjectFiles(project);
  if (files.length === 0) return [`${project}: no files`];
  return [...notUtf8(project, files), ...lostCharacters(project), ...badJson(project)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const project = process.argv[2];
  if (!project) {
    console.error(`usage: node ${fileURLToPath(import.meta.url)} <project dir>`);
    process.exitCode = 2;
  } else {
    const problems = checkInstalledText(resolve(project));
    for (const problem of problems) console.error(`  ${problem}`);
    console.log(problems.length ? `${problems.length} problem(s) in the installed text` : "The installed text is UTF-8, with its dashes and arrows, and the JSON has no byte order mark");
    process.exitCode = problems.length ? 1 : 0;
  }
}
