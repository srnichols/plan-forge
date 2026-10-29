/**
 * Shell integration tests for `pforge update --from-github` — Phase AUTO-UPDATE-01, Slice 1.
 *
 * These tests invoke the actual CLI entry point of update-from-github.mjs.
 * `resolve-tag` runs against a stubbed GitHub API (a --import preload that replaces globalThis.fetch), so
 * a rate-limited or offline runner cannot fail the suite (#409). The one test that asks the real API is
 * opt-in: set CI_LIVE_NETWORK=1 (CI_SKIP_NETWORK=1 still skips it). Every release is checked against the
 * live API by scripts/release/verify-public.mjs.
 *
 * Note: These test the Node.js CLI wrapper, not the full PS1/bash flow
 * (which requires tar + full project structure). The shell scripts delegate
 * to this module, so testing the module's CLI is the right boundary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const CLI_PATH = resolve(import.meta.dirname || ".", "..", "update-from-github.mjs");
const TMP_DIR = resolve(import.meta.dirname || ".", ".tmp-ufg-shell-test");

const SKIP = process.env.CI_SKIP_NETWORK === "1" || process.env.CI_SKIP_NETWORK === "true";
const LIVE = process.env.CI_LIVE_NETWORK === "1" || process.env.CI_LIVE_NETWORK === "true";

// Windows + Node v24 libuv bug: `execFile("node", [cli])` of a subprocess that
// holds a network handle at exit can trigger
//   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src/win/async.c, line 76`
// at process teardown, which the parent surfaces as a non-zero exit even though
// the CLI completed correctly. Reproducible on Node 24.11.1 + Windows. Not
// caused by CLI logic; skip on Windows until upstream Node ships the fix.
const SKIP_WIN_LIBUV = process.platform === "win32";

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

describe("update-from-github CLI", () => {
  it("resolve-tag with explicit tag returns it verbatim", async () => {
    const { stdout } = await execFileP("node", [CLI_PATH, "resolve-tag", "--tag", "v2.50.0"]);
    const result = JSON.parse(stdout.trim());
    expect(result.ok).toBe(true);
    expect(result.tag).toBe("v2.50.0");
  }, 15_000);

  it("resolve-tag rejects HEAD", async () => {
    try {
      await execFileP("node", [CLI_PATH, "resolve-tag", "--tag", "HEAD"]);
      expect.fail("Should have thrown");
    } catch (err) {
      const output = err.stdout || "";
      if (output) {
        const result = JSON.parse(output.trim());
        expect(result.ok).toBe(false);
        expect(result.code).toBe("ERR_NO_HEAD_TAG");
      } else {
        expect(err.code).not.toBe(0);
      }
    }
  }, 15_000);

  // #446 — `pforge self-update --force` built "v" from a check that had failed. resolve-tag said ok with it and the
  // download then reported "Tag 'v' not found on GitHub".
  it.each(["v", "V", "main", "v1"])("resolve-tag rejects the tag %j, which names no version, and exits 1 without asking GitHub", (tag) => {
    const run = spawnSync(process.execPath, [CLI_PATH, "resolve-tag", "--tag", tag], { encoding: "utf8", timeout: 30_000, env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "" } });
    const result = JSON.parse(run.stdout.trim());
    expect(result).toMatchObject({ ok: false, code: "ERR_INVALID_TAG" });
    expect(result.message).toContain(`'${tag}'`);
    expect(run.status).toBe(1);
  }, 30_000);

  it("download requires --tag", async () => {
    try {
      await execFileP("node", [CLI_PATH, "download", "--project-dir", TMP_DIR]);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err.stderr || "").toContain("--tag required");
    }
  }, 15_000);

  it("audit appends log entry from stdin", async () => {
    const entry = JSON.stringify({ tag: "v2.50.0", sha256: "abc", sizeBytes: 100, outcome: "success", filesChanged: 3, source: "manual" });
    const { spawn } = await import("node:child_process");
    const result = await new Promise((resolve, reject) => {
      const child = spawn("node", [CLI_PATH, "audit", "--project-dir", TMP_DIR], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("close", (code) => resolve({ stdout, stderr, code }));
      child.on("error", reject);
      child.stdin.write(entry);
      child.stdin.end();
    });
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.ok).toBe(true);

    const logPath = join(TMP_DIR, ".forge", "update-audit.log");
    expect(existsSync(logPath)).toBe(true);
    const logged = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(logged.tag).toBe("v2.50.0");
    expect(logged.from).toBe("github");
  }, 15_000);

  it("unknown action returns error", async () => {
    try {
      await execFileP("node", [CLI_PATH, "bogus"]);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err.stderr || "").toContain("Unknown action");
    }
  }, 15_000);

  (LIVE && !SKIP && !SKIP_WIN_LIBUV ? it : it.skip)("resolve-tag without --tag hits GitHub API (live; opt in with CI_LIVE_NETWORK=1)", async () => {
    const { stdout } = await execFileP("node", [CLI_PATH, "resolve-tag"], { timeout: 10_000 });
    const result = JSON.parse(stdout.trim());
    expect(result.ok).toBe(true);
    expect(result.tag).toMatch(/^v?\d+\.\d+/);
  });
});

// A preload that stands in for the network: UFG_FETCH_STUB maps a URL fragment to { status, body, headers } or
// { throws }, and every request is appended to UFG_FETCH_LOG so a test can see what was asked.
const FETCH_STUB = `
import { appendFileSync } from "node:fs";
const stub = JSON.parse(process.env.UFG_FETCH_STUB);
globalThis.fetch = async (url, init) => {
  appendFileSync(process.env.UFG_FETCH_LOG, JSON.stringify({ url: String(url), headers: init?.headers ?? {} }) + "\\n");
  const found = Object.entries(stub).find(([part]) => String(url).includes(part));
  if (!found || found[1].throws) throw new TypeError(found ? found[1].throws : "fetch failed");
  return new Response(JSON.stringify(found[1].body ?? null), { status: found[1].status ?? 200, headers: found[1].headers ?? {} });
};
`;

function resolveTagStubbed(stub, { env = {} } = {}) {
  const preload = join(TMP_DIR, "fetch-stub.mjs");
  const log = join(TMP_DIR, "fetch-log.jsonl");
  writeFileSync(preload, FETCH_STUB);
  const run = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, CLI_PATH, "resolve-tag"], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "", UFG_FETCH_STUB: JSON.stringify(stub), UFG_FETCH_LOG: log, ...env },
  });
  let out = null;
  try { out = JSON.parse(run.stdout.trim()); } catch { /* the assertions show the raw output through detail */ }
  const requests = existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { status: run.status, out, requests, detail: `exit ${run.status}; stdout: ${run.stdout}; stderr: ${run.stderr}` };
}

describe("update-from-github CLI resolve-tag against a stubbed GitHub API (#409)", () => {
  const RELEASE = { status: 200, body: { tag_name: "v9.9.9" } };
  const tags = (...names) => ({ status: 200, body: names.map((name) => ({ name })) });

  it("prints the latest release tag, asking GitHub's releases endpoint the way the API expects", () => {
    const r = resolveTagStubbed({ "/releases/latest": RELEASE, "/tags": tags("v9.9.9", "v9.9.8") });
    expect(r.out, r.detail).toEqual({ ok: true, tag: "v9.9.9" });
    expect(r.status, r.detail).toBe(0);
    expect(r.requests).toHaveLength(2);
    expect(r.requests[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/latest$/);
    expect(r.requests[1].url).toMatch(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/tags\b/);
    // GitHub rejects an API request that has no user agent
    expect(r.requests.map((q) => q.headers)).toEqual(Array(2).fill({ accept: "application/vnd.github+json", "user-agent": "plan-forge-update" }));
  });

  it("sends GITHUB_TOKEN as an authorization header", () => {
    const r = resolveTagStubbed({ "/releases/latest": RELEASE, "/tags": tags("v9.9.9") }, { env: { GITHUB_TOKEN: "not-a-real-token" } });
    expect(r.out, r.detail).toEqual({ ok: true, tag: "v9.9.9" });
    expect(r.requests.map((q) => q.headers.authorization)).toEqual(["token not-a-real-token", "token not-a-real-token"]);
  });

  it("sends GH_TOKEN, the variable the GitHub CLI reads, the same way (#446)", () => {
    const r = resolveTagStubbed({ "/releases/latest": RELEASE, "/tags": tags("v9.9.9") }, { env: { GH_TOKEN: "not-a-real-gh-token" } });
    expect(r.out, r.detail).toEqual({ ok: true, tag: "v9.9.9" });
    expect(r.requests.map((q) => q.headers.authorization)).toEqual(["token not-a-real-gh-token", "token not-a-real-gh-token"]);
  });

  it("says when a rate limit resets and what raises it, and never prints the token (#446)", () => {
    const limited = { status: 403, body: { message: "API rate limit exceeded" }, headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793264400" } };
    const anonymous = resolveTagStubbed({ "/releases/latest": limited });
    expect(anonymous.out, anonymous.detail).toMatchObject({ ok: false, code: "ERR_RATE_LIMITED" });
    expect(anonymous.out.message).toContain("09:00 UTC");
    expect(anonymous.out.message).toContain("GITHUB_TOKEN");
    expect(anonymous.out.message).toContain("GH_TOKEN");

    const withToken = resolveTagStubbed({ "/releases/latest": limited }, { env: { GH_TOKEN: "not-a-real-gh-token" } });
    expect(withToken.out, withToken.detail).toMatchObject({ ok: false, code: "ERR_RATE_LIMITED" });
    expect(withToken.detail).not.toContain("not-a-real-gh-token");
    expect(withToken.out.message).not.toMatch(/GITHUB_TOKEN|GH_TOKEN/);
  });

  it("warns when a newer stable tag exists than the latest release, ignoring pre-releases", () => {
    const r = resolveTagStubbed({ "/releases/latest": RELEASE, "/tags": tags("v10.0.0-rc.1", "v9.9.10", "v9.9.9") });
    expect(r.out, r.detail).toMatchObject({ ok: true, tag: "v9.9.9", warning: { drift: true, newestTag: "v9.9.10", releaseTag: "v9.9.9" } });
  });

  it("still resolves when only the tag listing cannot be fetched", () => {
    const r = resolveTagStubbed({ "/releases/latest": RELEASE, "/tags": { throws: "offline" } });
    expect(r.out, r.detail).toEqual({ ok: true, tag: "v9.9.9" });
    expect(r.status, r.detail).toBe(0);
  });

  it.each([
    ["a rate-limited API", { status: 403, body: { message: "API rate limit exceeded" } }, "ERR_RATE_LIMITED"],
    ["an HTTP error, whatever the body", { status: 500, body: { tag_name: "v9.9.9" } }, "ERR_API"],
    ["a response without tag_name", { status: 200, body: {} }, "ERR_API"],
    ["a request that cannot be made", { throws: "getaddrinfo ENOTFOUND api.github.com" }, "ERR_NETWORK"],
  ])("reports %s and exits 1", (_what, release, code) => {
    const r = resolveTagStubbed({ "/releases/latest": release });
    expect(r.out, r.detail).toMatchObject({ ok: false, code });
    expect(r.status, r.detail).toBe(1);
  });
});
