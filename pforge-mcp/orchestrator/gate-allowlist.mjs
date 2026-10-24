/**
 * Plan Forge — a project's additions to the gate command allowlist (meta-bug #367).
 *
 * The built-in list (`GATE_ALLOWED_PREFIXES`) was a constant with no way to
 * extend it, so a gate using `az`, `terraform` or any tool the framework did not
 * foresee was an error from the lint and refused at run time, and the message
 * told a plan author to edit a source constant. A project now lists what it
 * needs as `gateAllowedPrefixes` in `.forge.json`.
 *
 * An entry is a command (`helm`) or a command and up to two subcommand words
 * (`terraform validate`), so a project can allow the read-only subcommand of a
 * tool without the rest of it. Like the built-in list this guards against
 * prose and slips, not against a determined gate: it reads the start of the
 * line. isGateCommandAllowed(), the regression guard's check, still refuses the
 * destructive patterns it blocks, whatever a project lists; runGate() has no
 * such blocklist.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gateCommandWords, isGatePrefixAllowed, resolveGateCommandToken } from "./constants.mjs";

const MAX_ENTRIES = 100;
const MAX_ENTRY_CHARS = 80;
const MAX_ENTRY_WORDS = 3;
/** One word of an entry: no shell syntax, quoting, globbing or option flags. Entries are lower-cased first. */
const ENTRY_WORD_RE = /^[a-z0-9._][\w.+\-/]*$/;
/** A word that reads as a subcommand: `bicep`, `validate`, `apply`, not `-chdir=infra` or `./path`. */
const SUBCOMMAND_RE = /^[a-z][a-z0-9-]*$/;

function normalizeEntry(value) {
  if (typeof value !== "string") return null;
  const entry = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!entry || entry.length > MAX_ENTRY_CHARS) return null;
  const words = entry.split(" ");
  if (words.length > MAX_ENTRY_WORDS) return null;
  return words.every((word) => ENTRY_WORD_RE.test(word)) ? entry : null;
}

/**
 * The usable entries of a `gateAllowedPrefixes` value: trimmed, lower-cased and
 * single-spaced, without duplicates, at most 100. Anything that is not a plain
 * command, such as `az; rm -rf /` or `echo $HOME`, is dropped rather than trusted.
 *
 * @param {unknown} value
 * @returns {string[]} empty unless `value` is an array
 */
export function parseGateAllowedPrefixes(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const item of value) {
    const entry = normalizeEntry(item);
    if (entry && !entries.includes(entry)) entries.push(entry);
    if (entries.length === MAX_ENTRIES) break;
  }
  return entries;
}

/**
 * @param {string} [cwd] - the project root
 * @returns {string[]} the project's `gateAllowedPrefixes`; empty when `.forge.json` is missing or unreadable
 */
export function loadGateAllowedPrefixes(cwd = process.cwd()) {
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (!existsSync(configPath)) return [];
    return parseGateAllowedPrefixes(JSON.parse(readFileSync(configPath, "utf-8")).gateAllowedPrefixes);
  } catch {
    return [];
  }
}

/** Do `words` open with the entry's words? The command also matches as a path ending in it: `/usr/bin/az`. */
function startsWithEntry(words, entry) {
  const [command, ...subcommands] = entry.split(" ");
  const [first] = words;
  if (first !== command && !first?.endsWith(`/${command}`)) return false;
  return subcommands.every((word, index) => words[index + 1] === word);
}

/**
 * Is a gate line's command allowed: by the built-in list, or by one of the
 * project's entries? Leading variable assignments are skipped, as everywhere.
 *
 * @param {string} line
 * @param {string[]} [extra] - the project's entries, from loadGateAllowedPrefixes
 * @returns {boolean}
 */
export function isGateLineAllowed(line, extra = []) {
  if (isGatePrefixAllowed(resolveGateCommandToken(line))) return true;
  if (extra.length === 0) return false;
  const words = gateCommandWords(line);
  return extra.some((entry) => startsWithEntry(words, entry));
}

/**
 * The entry that would allow a blocked line: its command, and its first word
 * after it when that reads as a subcommand (`az bicep`, `terraform validate`),
 * so the suggestion stays as narrow as the line. "" when no valid entry can be
 * made of it.
 *
 * @param {string} line
 * @returns {string}
 */
export function gateAllowlistEntryFor(line) {
  const [first = "", second = ""] = gateCommandWords(line);
  const command = first.split("/").pop();
  return normalizeEntry(SUBCOMMAND_RE.test(second) ? `${command} ${second}` : command) ?? "";
}

/**
 * How to allow a blocked line, for the lint's and the runtime's messages.
 * Written to follow "…is not in the gate allowlist." and, in the lint, to be
 * followed by ", or rewrite the command".
 *
 * @param {string} line
 * @returns {string}
 */
export function gateAllowlistAdvice(line) {
  const entry = gateAllowlistEntryFor(line);
  const example = entry ? `"gateAllowedPrefixes": ["${entry}"]` : '"gateAllowedPrefixes"';
  return `Allow it with ${example} in .forge.json (an entry is a command, or a command and subcommand)`;
}
