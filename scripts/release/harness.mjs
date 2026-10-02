/**
 * Shared helpers for the release rehearsal scripts (#300).
 *
 * The scripts drive the real installers and updaters in both shells, PowerShell
 * (`pwsh`) and Bash (Git Bash on Windows), against `git archive` payloads, which
 * is exactly what consumers download. One Node implementation exercises both
 * shells, so there is no PowerShell/Bash twin to keep in step.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const IS_WIN = process.platform === "win32";
const SHELL_TIMEOUT_MS = 900_000; // one setup or update; generous for cold npm installs
const SEMVER_PARTS = 3;
export const SHORT_SHA = 8;
const GIT_IDENTITY = ["-c", "user.name=rehearsal", "-c", "user.email=rehearsal@example.invalid"];
const CLEAN_VERSION = /^\d+\.\d+\.\d+$/;

// ─── Arguments ──────────────────────────────────────────────────────────────

/** Parse `--name value` / `--flag` pairs into an object; empty values count as unset. */
export function parseArgs(argv, flags = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flags.includes(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    if (value !== "") out[key] = value;
  }
  return out;
}

// ─── Shells and git ─────────────────────────────────────────────────────────

export function findBash() {
  if (!IS_WIN) return "bash";
  const candidates = [
    process.env.PFORGE_GIT_BASH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error("Git Bash not found; set PFORGE_GIT_BASH to bash.exe");
  return found;
}

export function requirePwsh() {
  const r = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
  if (r.status !== 0) throw new Error("pwsh (PowerShell 7) not found on PATH");
}

export function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function gitQuiet(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** A Windows path as Git Bash sees it (`/c/Users/...`); unchanged elsewhere. */
export function toBashPath(bash, p) {
  if (!IS_WIN) return p;
  const r = spawnSync(bash, ["-c", 'cygpath -u "$1"', "_", p], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : p.replace(/\\/g, "/");
}

function runLogged(cmd, args, { cwd, log }) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: SHELL_TIMEOUT_MS, env: process.env });
  writeFileSync(log, `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}\n` : ""}`);
  return r.error ? -1 : r.status;
}

/** Run a PowerShell script with -File; output goes to `log`. Returns the exit code. */
export function runPwsh(script, args, opts) {
  return runLogged("pwsh", ["-NoProfile", "-File", script, ...args], opts);
}

/** Run a Bash command line (paths already in Bash form); output goes to `log`. */
export function runBash(bash, commandLine, opts) {
  return runLogged(bash, ["-c", commandLine], opts);
}

/** Single-quote a value for a Bash command line. */
export function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// ─── Workspace ──────────────────────────────────────────────────────────────

export function makeWorkRoot(name, logsDir) {
  const root = logsDir ? resolve(logsDir) : join(tmpdir(), name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

/** Extract `ref` from `repoDir` the way consumers receive it (`git archive` honours export-ignore). */
export function expandRef(repoDir, ref, dest) {
  mkdirSync(dest, { recursive: true });
  const tar = join(dest, "payload.tar");
  git(["archive", "--format=tar", "-o", tar, ref], repoDir);
  // A relative archive name keeps GNU tar from reading `C:` as a remote host.
  const r = spawnSync("tar", ["-xf", "payload.tar"], { cwd: dest, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar -xf failed for ${ref}: ${r.stderr}`);
  rmSync(tar);
  return dest;
}

export function newConsumer(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(["init", "-q"], dir);
  git([...GIT_IDENTITY, "commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

export function commitAll(dir, message) {
  gitQuiet(["add", "-A"], dir);
  gitQuiet([...GIT_IDENTITY, "commit", "-q", "-m", message], dir);
}

// ─── File assertions ────────────────────────────────────────────────────────

export function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "") : null;
}

export function has(path, text) {
  const body = readText(path);
  return body !== null && body.includes(text);
}

export function sameText(a, b) {
  const x = readText(a);
  const y = readText(b);
  return x !== null && y !== null && x.replace(/\r/g, "") === y.replace(/\r/g, "");
}

export function readJson(path) {
  const body = readText(path);
  return body === null ? null : JSON.parse(body);
}

function jsonKey(obj, dotted) {
  return dotted.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/** Evaluate one release-checks.json entry against a consumer project. */
export function evaluateFileCheck(projectDir, check) {
  const path = join(projectDir, check.path);
  if (check.jsonKey) {
    const found = jsonKey(readJson(path), check.jsonKey);
    return { ok: found === check.equals, detail: String(found) };
  }
  if (check.contains) return { ok: has(path, check.contains), detail: "" };
  if (check.notContains) return { ok: existsSync(path) && !has(path, check.notContains), detail: "" };
  return { ok: existsSync(path), detail: "" };
}

/** The release-checks.json entries that apply to a consumer in this situation. */
export function selectFileChecks(spec, { preset, fresh, previousWrapper = false }) {
  return (spec.checks ?? []).filter((c) =>
    (!c.preset || c.preset === preset)
    && (c.when !== "fresh" || fresh)
    // Behaviour only the new wrapper performs; the first update still runs the previous release's code.
    && (c.when !== "current-wrapper" || !previousWrapper));
}

// ─── Results ────────────────────────────────────────────────────────────────

export class Checks {
  /** @param {{ quiet?: boolean }} [options] quiet: do not echo each line to stderr */
  constructor({ quiet = false } = {}) {
    this.lines = [];
    this.failed = 0;
    this.quiet = quiet;
  }

  add(label, ok, detail = "") {
    if (!ok) this.failed++;
    this.#record(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  }

  note(text) {
    this.#record(`--- ${text}`);
  }

  #record(line) {
    this.lines.push(line);
    if (!this.quiet) process.stderr.write(`${line}\n`);
  }

  /** Print the summary, save it to `root/results.txt`, and return the process exit code. */
  finish(root) {
    const passed = this.lines.filter((l) => l.startsWith("PASS")).length;
    const summary = `${passed} passed, ${this.failed} failed. Logs: ${root}`;
    writeFileSync(join(root, "results.txt"), `${this.lines.join("\n")}\n${summary}\n`);
    console.log(summary);
    return this.failed ? 1 : 0;
  }
}

// ─── Versions and tags ──────────────────────────────────────────────────────

export function isCleanVersion(version) {
  return CLEAN_VERSION.test(version);
}

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < SEMVER_PARTS; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function versionAt(repoDir, ref) {
  return git(["show", `${ref}:VERSION`], repoDir).trim();
}

/** Clean `X.Y.Z` versions of the `v*` tags, from local tags or from origin; null when unreadable. */
export function listTagVersions(repoDir, { remote = false } = {}) {
  const raw = remote
    ? gitQuiet(["ls-remote", "--tags", "--refs", "origin", "v*"], repoDir)
    : gitQuiet(["tag", "--list", "v*"], repoDir);
  if (raw === null) return null;
  return raw.split(/\r?\n/)
    .map((line) => line.replace(/^.*refs\/tags\//, "").replace(/^v/, ""))
    .filter(isCleanVersion);
}

/** The highest released version below `version`, from local tags. */
export function previousTag(repoDir, version) {
  const below = (listTagVersions(repoDir) ?? []).filter((v) => compareVersions(v, version) < 0);
  below.sort(compareVersions);
  if (below.length === 0) throw new Error(`no release tag below ${version}; pass --previous-tag`);
  return `v${below[below.length - 1]}`;
}

/** Commit an origin tag points at (annotated tags peeled), or null when absent. */
function remoteTagCommit(repoDir, tag) {
  const out = gitQuiet(["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], repoDir) ?? "";
  const refs = out.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/));
  const entry = refs.find(([, ref]) => ref.endsWith("^{}")) ?? refs[0];
  return entry ? entry[0] : null;
}

/**
 * #128 — refuse a release that would collide with or fall behind what is already
 * on origin: the tag must not exist on another commit, and the version must be
 * newer than every other released tag.
 */
export function checkTagCollision(checks, repoDir, version, releaseSha) {
  const tag = `v${version}`;
  const remote = listTagVersions(repoDir, { remote: true });
  if (remote === null) {
    checks.note(`origin unreachable, tag collision check skipped for ${tag}`);
    return;
  }
  const tagSha = remoteTagCommit(repoDir, tag);
  checks.add(`${tag} is not tagged on origin at another commit (#128)`, !tagSha || tagSha === releaseSha, tagSha ? `origin ${tag} is ${tagSha.slice(0, SHORT_SHA)}` : "");
  const newer = remote.filter((v) => compareVersions(v, version) > 0).sort(compareVersions);
  checks.add(`${version} is newer than every release tag on origin`, newer.length === 0, newer.length ? `origin has v${newer[newer.length - 1]}` : "");
}
