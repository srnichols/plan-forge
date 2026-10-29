/**
 * `pforge self-update` when GitHub cannot be asked (#446), run end to end in every shell.
 *
 * Behind a shared egress address the 60 anonymous GitHub API requests an hour are spent by other people, and the check
 * `self-update` makes came back 403. The shells printed "unreachable, rate-limited, or timed out", ignored the answer the
 * last check had left in .forge/update-check.json, and sent no token even when the user had set one. `--force`, the way out
 * the message offered, built the tag "v" from the version the failed check did not have and ended in "Tag 'v' not found".
 *
 * Both shells run the real script against a project that holds the real update-check.mjs. A preload stands in for GitHub:
 * PF_FETCH_STUB says what the API answers and PF_FETCH_LOG records every request, so a test sees what was asked, with which
 * credential, and that nothing was downloaded.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const PS_ARGS = ["-NoProfile", "-NonInteractive"];

const SHELLS = [
  // pforge.sh writes the failure to stderr, where scripts that read stdout do not see it; pforge.ps1 uses Write-Host.
  { name: "pforge.sh", available: Boolean(BASH), failuresOnStderr: true, command: (project, args) => [BASH, ["pforge.sh", "self-update", ...args]] },
  { name: "pforge.ps1 under pwsh", available: PWSH_OK, failuresOnStderr: false, command: (project, args) => ["pwsh", [...PS_ARGS, "-File", join(project, "pforge.ps1"), "self-update", ...args]] },
  {
    name: "pforge.ps1 under Windows PowerShell 5.1",
    available: isWin,
    failuresOnStderr: false,
    command: (project, args) => ["powershell.exe", [...PS_ARGS, "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "self-update", ...args]],
  },
];

// A preload that stands in for GitHub. It answers every request the same way, which is all these tests need: the update
// check makes one request, and a test that sees a second one has found a download or a retry nobody asked for.
const FETCH_STUB = `
import { appendFileSync } from "node:fs";
const plan = JSON.parse(process.env.PF_FETCH_STUB || "{}");
globalThis.fetch = async (url, init) => {
  appendFileSync(process.env.PF_FETCH_LOG, JSON.stringify({ url: String(url), headers: init?.headers ?? {} }) + "\\n");
  new Headers(init?.headers ?? {}); // the header validation fetch does, so a header it would reject is rejected here too
  if (plan.throws) throw new TypeError(plan.throws);
  return new Response(JSON.stringify(plan.body ?? null), { status: plan.status ?? 200, headers: plan.headers ?? {} });
};
`;

const INSTALLED = "3.35.4";
const RESET_EPOCH = 1793264400; // 2026-10-29T09:00:00Z
const RATE_LIMITED = {
  status: 403,
  body: { message: "API rate limit exceeded for 203.0.113.7." },
  headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET_EPOCH) },
};
const RELEASE = (version) => ({ status: 200, body: { tag_name: `v${version}`, html_url: `https://example.test/v${version}`, published_at: "2026-10-28T12:00:00Z" } });
const TOKEN = "ghp_self_update_test_token_0123456789";

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

/** A project installed at INSTALLED, with the real update check, and optionally the answer an earlier check cached. */
function seed({ cache = null, checkModule = null } = {}) {
  const project = mkdtempSync(join(tmpdir(), "pf-self-update-"));
  tmpDirs.push(project);
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion: INSTALLED, preset: "custom" }),
    "pforge-mcp/update-check.mjs": checkModule ?? readFileSync(join(REPO_ROOT, "pforge-mcp", "update-check.mjs"), "utf8"),
    "pforge-mcp/github-request.mjs": readFileSync(join(REPO_ROOT, "pforge-mcp", "github-request.mjs"), "utf8"),
    "fetch-stub.mjs": FETCH_STUB,
  });
  if (cache) writeTree(project, { ".forge/update-check.json": JSON.stringify(cache) });
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return project;
}

function selfUpdate(shell, project, { args = [], env = {}, stub = {} } = {}) {
  const log = join(project, "fetch-log.jsonl");
  const preload = `--import=${pathToFileURL(join(project, "fetch-stub.mjs")).href}`;
  const base = { ...process.env, PF_FETCH_STUB: JSON.stringify(stub), PF_FETCH_LOG: log };
  for (const name of ["PFORGE_NO_UPDATE_CHECK", "GITHUB_TOKEN", "GH_TOKEN", "PFORGE_SELF_UPDATE"]) delete base[name];
  base.NODE_OPTIONS = [process.env.NODE_OPTIONS, preload].filter(Boolean).join(" ");
  const [command, commandArgs] = shell.command(project, args);
  const run = spawnSync(command, commandArgs, { cwd: project, encoding: "utf8", timeout: 170_000, env: { ...base, ...env } });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const requests = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { status: run.status, output, stdout: run.stdout ?? "", stderr: run.stderr ?? "", requests, detail: `exit ${run.status}\n${output}` };
}

const utcLabel = (iso) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

describe.each(SHELLS)("pforge self-update when GitHub cannot be asked, in $name", (shell) => {
  const it_ = it.skipIf(!shell.available);
  const SLOW = 180_000;

  it_("says a rate limit is a rate limit, when it resets and what raises it, and does not call the install current", () => {
    const run = selfUpdate(shell, seed(), { stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).toMatch(/rate limit/i);
    expect(run.output).toContain("09:00 UTC");
    expect(run.output).toContain("GITHUB_TOKEN");
    expect(run.output).toContain("GH_TOKEN");
    expect(run.output).toContain(`v${INSTALLED}`);
    expect(run.output).toContain("NOT a confirmation");
    expect(run.output).not.toContain("Already current");
    expect(run.output).not.toContain("unreachable, rate-limited, or timed out");
    // Without --force there is nothing to say about --force.
    expect(run.output).not.toMatch(/--force installs/);
    if (shell.failuresOnStderr) {
      expect(run.stderr).toContain("Could not check for updates");
      expect(run.stdout).not.toContain("Could not check for updates");
    }
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].url).toContain("/releases/latest");
    expect(run.requests[0].headers).not.toHaveProperty("authorization");
  }, SLOW);

  it_("sends GH_TOKEN, never prints it, and with --force refuses instead of building a tag from a version it does not have", () => {
    const project = seed();
    const run = selfUpdate(shell, project, { args: ["--force", "--yes"], env: { GH_TOKEN: TOKEN }, stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(2);
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0].headers.authorization).toBe(`token ${TOKEN}`);
    expect(run.output).not.toContain(TOKEN);
    expect(run.output).toMatch(/rate limit/i);
    // The token was sent and accepted, so setting one is not the cure and the message must not say it is.
    expect(run.output).not.toMatch(/GITHUB_TOKEN|GH_TOKEN/);
    expect(run.output).toMatch(/--force/);
    expect(run.output).toMatch(/successful check/);
    expect(run.output).not.toMatch(/Forcing heal/);
    expect(run.output).not.toMatch(/--tag v(\s|$)/);
    expect(run.requests.some((request) => request.url.includes("/tarball/"))).toBe(false);
    expect(existsSync(join(project, ".forge", "cache"))).toBe(false);
  }, SLOW);

  it_("uses the answer the last check cached, says so, and carries on", () => {
    const checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const project = seed({ cache: { latest: "3.35.5", checkedAt, url: "https://example.test/v3.35.5", publishedAt: null } });
    const run = selfUpdate(shell, project, { args: ["--dry-run"], stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(0);
    expect(run.output).toMatch(/rate limit/i);
    expect(run.output).toContain(`Using the release check made at ${utcLabel(checkedAt)} instead.`);
    expect(run.output).toContain(`New release available: v3.35.5 (you have v${INSTALLED})`);
    expect(run.output).toContain("[dry-run] Would run: pforge update --from-github --tag v3.35.5");
    expect(run.output).not.toContain("Already current");
    expect(run.requests).toHaveLength(1);
  }, SLOW);

  it_("with --force and a cached answer, installs the version the cache names, not a tag with no version", () => {
    const checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const project = seed({ cache: { latest: "3.35.5", checkedAt, url: "https://example.test/v3.35.5", publishedAt: null } });
    const run = selfUpdate(shell, project, { args: ["--force", "--dry-run"], stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(0);
    expect(run.output).toContain("--tag v3.35.5");
    expect(run.output).not.toMatch(/--tag v(\s|$)/);
  }, SLOW);

  it_("still heals an install that is as new as the cached release with --force, naming the version", () => {
    const checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const project = seed({ cache: { latest: INSTALLED, checkedAt, url: `https://example.test/v${INSTALLED}`, publishedAt: null } });
    const run = selfUpdate(shell, project, { args: ["--force", "--dry-run"], stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(0);
    expect(run.output).toContain(`Forcing heal to latest tagged release: v${INSTALLED} (you have v${INSTALLED})`);
    expect(run.output).toContain(`[dry-run] Would run: pforge update --from-github --tag v${INSTALLED}`);
    expect(run.output).not.toMatch(/--tag v(\s|$)/);
  }, SLOW);

  it_("does not use a cached answer that is older than the cache allows", () => {
    const checkedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const project = seed({ cache: { latest: "3.35.5", checkedAt, url: "https://example.test/v3.35.5", publishedAt: null } });
    const run = selfUpdate(shell, project, { args: ["--dry-run"], stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).toContain("NOT a confirmation");
    expect(run.output).not.toContain("Using the release check");
  }, SLOW);

  // `pforge update` leaves "the version I just installed" in the cache so the next unforced check does not have to ask
  // GitHub. After a pinned older tag, or from a -dev sibling clone, that is not what GitHub would say.
  it_("does not take the version the installer cached for a release check", () => {
    const checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const project = seed({ cache: { latest: INSTALLED, checkedAt, url: `https://example.test/v${INSTALLED}`, publishedAt: null, source: "install" } });
    const run = selfUpdate(shell, project, { stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).toContain("NOT a confirmation");
    expect(run.output).toMatch(/rate limit/i);
    expect(run.output).not.toContain("Already current");
    expect(run.output).not.toContain("Using the release check");
  }, SLOW);

  it_("does not offer a -dev version from the cache as a release to install", () => {
    const checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const project = seed({ cache: { latest: "3.36.0-dev", checkedAt, url: "https://example.test/v3.36.0-dev", publishedAt: null } });
    const run = selfUpdate(shell, project, { args: ["--force", "--dry-run"], stub: RATE_LIMITED });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).not.toContain("3.36.0-dev");
    expect(run.output).not.toMatch(/--tag v3\.36/);
  }, SLOW);

  it_("tells a network that is down from a rate limit", () => {
    const run = selfUpdate(shell, seed(), { stub: { throws: "getaddrinfo ENOTFOUND api.github.com" } });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).toMatch(/could not be reached/i);
    expect(run.output).not.toMatch(/rate limit/i);
    expect(run.output).toContain("NOT a confirmation");
  }, SLOW);

  it_("says an update check that is turned off is turned off, and with --force does not build a tag from it", () => {
    const run = selfUpdate(shell, seed(), { args: ["--force", "--dry-run"], env: { PFORGE_NO_UPDATE_CHECK: "1" }, stub: RELEASE("3.35.5") });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).toContain("PFORGE_NO_UPDATE_CHECK");
    expect(run.output).not.toMatch(/Forcing heal/);
    expect(run.output).not.toMatch(/--tag v(\s|$)/);
    expect(run.requests).toHaveLength(0);
  }, SLOW);

  it_("does not call the install current when the update check itself cannot run", () => {
    const run = selfUpdate(shell, seed({ checkModule: "export const broken = true;\n" }), { stub: RELEASE("3.35.5") });
    expect(run.status, run.detail).toBe(1);
    // Windows PowerShell 5.1 turns what node writes to stderr into its own terminating error before the script can word one.
    expect(run.output).toMatch(/Failed to parse update check output|NativeCommandError/);
    expect(run.output).not.toContain("Already current");
  }, SLOW);

  it_("never builds a tag from an answer that names no version, even one that claims a newer release", () => {
    const noVersion = "export async function runSelfUpdateCheck() { return { isNewer: true }; }\n";
    const run = selfUpdate(shell, seed({ checkModule: noVersion }), { args: ["--force", "--yes"], stub: RELEASE("3.35.5") });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).toContain("NOT a confirmation");
    // The answer carried no reason, so the shell falls back to the general sentence rather than saying nothing.
    expect(run.output).toMatch(/Could not check for updates — GitHub API unreachable, rate-limited, or timed out\./);
    expect(run.output).not.toMatch(/Forcing heal/);
    expect(run.output).not.toMatch(/New release available/);
    expect(run.output).not.toMatch(/--tag v(\s|$)/);
  }, SLOW);

  it_("takes an answer that says the check failed at its word, whatever else the answer holds", () => {
    const contradiction = "export async function runSelfUpdateCheck() { return { checkFailed: true, reason: { kind: 'network', message: 'the stub says the check failed' }, latest: '3.35.5', isNewer: true }; }\n";
    const run = selfUpdate(shell, seed({ checkModule: contradiction }), { args: ["--dry-run"], stub: RELEASE("3.35.5") });
    expect(run.status, run.detail).toBe(2);
    expect(run.output).toContain("the stub says the check failed");
    expect(run.output).toContain("NOT a confirmation");
    expect(run.output).not.toMatch(/New release available/);
  }, SLOW);

  it_("still says the install is current when it is", () => {
    const run = selfUpdate(shell, seed(), { stub: RELEASE(INSTALLED) });
    expect(run.status, run.detail).toBe(0);
    expect(run.output).toContain(`Already current (v${INSTALLED})`);
    expect(run.output).not.toContain("Using the release check");
  }, SLOW);

  it_("still offers a newer release it asked GitHub about, and sends the token it was given", () => {
    const run = selfUpdate(shell, seed(), { args: ["--dry-run"], env: { GITHUB_TOKEN: TOKEN }, stub: RELEASE("3.35.5") });
    expect(run.status, run.detail).toBe(0);
    expect(run.output).toContain(`New release available: v3.35.5 (you have v${INSTALLED})`);
    expect(run.output).toContain("[dry-run] Would run: pforge update --from-github --tag v3.35.5");
    expect(run.output).not.toContain("Using the release check");
    expect(run.output).not.toContain(TOKEN);
    expect(run.requests[0].headers.authorization).toBe(`token ${TOKEN}`);
  }, SLOW);
});

describe("Guard: both shells print what runSelfUpdateCheck says, so the wording lives in one place", () => {
  const SH = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8");
  const PS1 = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf8");

  it("pforge.sh and pforge.ps1 both ask runSelfUpdateCheck, not checkForUpdate, for the answer", () => {
    expect(SH).toMatch(/import \{ runSelfUpdateCheck \} from '\.\/pforge-mcp\/update-check\.mjs'/);
    expect(PS1).toMatch(/import \{ runSelfUpdateCheck \} from '\.\/pforge-mcp\/update-check\.mjs'/);
    expect(SH).not.toMatch(/import \{ checkForUpdate \}/);
    expect(PS1).not.toMatch(/import \{ checkForUpdate \}/);
  });

  it("pforge.sh and pforge.ps1 both print the reason, the cached-answer notice and the failed live check from the JSON", () => {
    for (const field of ["reason.message", "liveCheckFailed.message", "notice"]) {
      expect(SH, `pforge.sh reads ${field}`).toContain(field);
      expect(PS1, `pforge.ps1 reads ${field}`).toContain(field);
    }
  });

  it("pforge.sh and pforge.ps1 both stop before building a tag when the check named no version", () => {
    expect(SH).toMatch(/\[ -z "\$latest_ver" \]/);
    expect(PS1).toMatch(/-not \$checkJson\.latest/);
  });
});
