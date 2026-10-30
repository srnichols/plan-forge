/**
 * `/api/update-status` and `/api/self-update` when GitHub cannot be asked and the cache answers instead (#446).
 *
 * A forced check that GitHub does not answer falls back to a cache entry that is still fresh. `pforge self-update` prints
 * which check it used and why; these two routes dropped the reason, so `/api/update-status?force=1` (the dashboard's "check
 * now", whose title says it bypasses the cache) answered from the cache as though GitHub had just been asked. And an entry
 * the installer wrote is not a GitHub answer: it must not stand in for one.
 *
 * The routes run in this process against a scratch project (PLAN_FORGE_PROJECT), and the one thing stubbed is the call to
 * api.github.com. Nothing here can start an update: the self-update cases all end before it would.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SCRATCH_ROOT = resolve(import.meta.dirname, "..", ".vitest-scratch");
const RESET_EPOCH = 1793264400; // 2026-10-29T09:00:00Z

let project;
let savedCwd;
let realFetch;
let createExpressApp;
let githubRequests;

// Importing the server loads its whole graph, which takes most of the default 30 s hook timeout on a cold or loaded runner.
const IMPORT_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  project = join(SCRATCH_ROOT, `pforge-update-fallback-${process.pid}-${Date.now()}`);
  mkdirSync(project, { recursive: true });
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = project;
  process.chdir(project);
  realFetch = globalThis.fetch;
  ({ createExpressApp } = await import("../server.mjs"));
  // The server fixes its project directory when it is first imported. A runner that shares one process between test files
  // (--no-isolate) may have imported it for another project already, and these tests write a cache file into it: stop
  // rather than write into that project's .forge.
  const { PROJECT_DIR } = await import("../server/state.mjs");
  expect(PROJECT_DIR, "the server was already loaded for another project, so this suite would write into its .forge").toBe(project);
}, IMPORT_TIMEOUT_MS);

afterAll(() => {
  if (savedCwd) process.chdir(savedCwd);
  delete process.env.PLAN_FORGE_PROJECT;
  rmSync(project, { recursive: true, force: true });
});

const cacheFile = () => join(project, ".forge", "update-check.json");

beforeEach(() => {
  delete process.env.PFORGE_NO_UPDATE_CHECK;
  rmSync(cacheFile(), { force: true });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function seedCache(entry) {
  mkdirSync(join(project, ".forge"), { recursive: true });
  writeFileSync(cacheFile(), JSON.stringify(entry));
}

const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
// What GitHub's last answer left: far ahead of this install, or far behind it.
const newerRelease = () => ({ latest: "999.0.0", checkedAt: hourAgo(), url: "https://example.test/v999.0.0", publishedAt: "2026-10-28T12:00:00Z" });
const olderRelease = () => ({ latest: "0.0.1", checkedAt: hourAgo(), url: "https://example.test/v0.0.1", publishedAt: "2020-01-01T00:00:00Z" });

const githubReply = (status, headers = {}, body = {}) => () => {
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => lower[name.toLowerCase()] ?? null }, json: async () => body };
};
const RATE_LIMITED = githubReply(403, { "x-ratelimit-limit": 60, "x-ratelimit-remaining": 0, "x-ratelimit-reset": RESET_EPOCH });

/** Answer api.github.com with `reply`, and every other request (the one to the app under test) with the real fetch. */
function stubGitHub(reply) {
  githubRequests = [];
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith("https://api.github.com/")) return realFetch(url, init);
    githubRequests.push(String(url));
    return Promise.resolve(reply());
  };
}

async function withApp(run) {
  const server = createExpressApp().listen(0);
  await new Promise((resolveListening) => server.once("listening", resolveListening));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}

const status = (query = "") => withApp(async (baseUrl) => (await realFetch(`${baseUrl}/api/update-status${query}`)).json());

async function selfUpdateFrames() {
  return withApp(async (baseUrl) => {
    const text = await (await realFetch(`${baseUrl}/api/self-update`, { method: "POST" })).text();
    return text.split("\n\n").filter(Boolean).map((frame) => JSON.parse(frame.replace(/^data:\s*/, "")));
  });
}

describe("GET /api/update-status?force=1 when GitHub cannot be asked (#446)", () => {
  it("answers from the cache and says GitHub could not be asked, and why", async () => {
    seedCache(newerRelease());
    stubGitHub(RATE_LIMITED);
    const body = await status("?force=1");
    expect(githubRequests).toHaveLength(1);
    expect(body).toMatchObject({ available: true, latest: "999.0.0", fromCache: true, failure: { kind: "rate-limited", resetAt: "2026-10-29T09:00:00.000Z" } });
    expect(body.failure.message).toContain("rate limit");
    expect(body).not.toHaveProperty("checkFailed");
    expect(typeof body.checkedAt).toBe("string");
  });

  it("says it of an answer that is not newer too, so the button cannot call it 'up to date' on GitHub's word", async () => {
    seedCache(olderRelease());
    stubGitHub(RATE_LIMITED);
    const body = await status("?force=1");
    expect(body).toMatchObject({ available: false, latest: "0.0.1", fromCache: true, failure: { kind: "rate-limited" } });
  });

  it("does not add a failure to an answer GitHub just gave", async () => {
    seedCache(olderRelease());
    stubGitHub(githubReply(200, {}, { tag_name: "v999.0.0", html_url: "https://example.test/v999.0.0" }));
    const body = await status("?force=1");
    expect(body).toMatchObject({ available: true, latest: "999.0.0", fromCache: false });
    expect(body).not.toHaveProperty("failure");
    expect(body).not.toHaveProperty("checkFailed");
  });

  it("does not add a failure to an unforced answer from a fresh cache, which never asked GitHub", async () => {
    seedCache(newerRelease());
    stubGitHub(RATE_LIMITED);
    const body = await status("");
    expect(githubRequests).toHaveLength(0);
    expect(body).toMatchObject({ available: true, latest: "999.0.0", fromCache: true });
    expect(body).not.toHaveProperty("failure");
  });

  it("does not answer from an entry the installer wrote: no check could be made", async () => {
    seedCache({ latest: "0.0.1", checkedAt: hourAgo(), url: "https://example.test/v0.0.1", publishedAt: null, source: "install" });
    stubGitHub(RATE_LIMITED);
    const body = await status("?force=1");
    expect(body).toMatchObject({ available: false, checkFailed: true, failure: { kind: "rate-limited" } });
    expect(body).not.toHaveProperty("latest");
  });
});

describe("POST /api/self-update when GitHub cannot be asked (#446)", () => {
  it("says which check it is going by, then goes on with it", async () => {
    seedCache(olderRelease());
    stubGitHub(RATE_LIMITED);
    const frames = await selfUpdateFrames();
    expect(frames.map((frame) => frame.state)).toEqual(["checking", "checking", "done"]);
    expect(frames[1].detail).toContain("GitHub could not be asked for a fresh check");
    expect(frames[1].detail).toContain("rate limit");
    expect(frames[1].detail).toMatch(/Using the release check made at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC instead\./);
    expect(frames[2].detail).toContain("Already current");
  });

  it("says nothing of the sort when GitHub answered", async () => {
    seedCache(newerRelease());
    stubGitHub(githubReply(200, {}, { tag_name: "v0.0.1", html_url: "https://example.test/v0.0.1" }));
    const frames = await selfUpdateFrames();
    expect(frames.map((frame) => frame.state)).toEqual(["checking", "done"]);
    expect(frames[1].detail).toContain("Already current");
  });

  it("stops, and says why, when the only entry is one the installer wrote", async () => {
    seedCache({ latest: "0.0.1", checkedAt: hourAgo(), url: "https://example.test/v0.0.1", publishedAt: null, source: "install" });
    stubGitHub(RATE_LIMITED);
    const frames = await selfUpdateFrames();
    expect(frames.map((frame) => frame.state)).toEqual(["checking", "failed"]);
    expect(frames[1].detail).toContain("Could not check for updates");
    expect(frames[1].detail).toContain("rate limit");
  });
});
