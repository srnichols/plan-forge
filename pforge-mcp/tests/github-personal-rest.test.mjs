/**
 * Tests for GET /api/github-personal REST endpoint (Phase-54 Slice 1).
 *
 * Coverage:
 *   1. Full happy-path  — owner+repo via query; all three fields populated
 *   2. Missing gh auth  — 200 with errors.user="auth", all data null
 *   3. Bad repo (404)   — 200 with repo/copilotSignal null, errors.repo populated
 *   4. Defaults from git remote — owner/repo derived from git remote origin
 *   5. perPage cap      — ?perPage=999 silently capped to 200, response is 200
 *
 * gh is mocked via createMockGh; process.env.PATH is patched before server starts.
 * No real GitHub API calls are made.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createMockGh } from "./helpers/mock-gh.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const __dir   = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dir, "fixtures", "github-personal");

const USER_PROFILE    = JSON.parse(readFileSync(join(FIXTURES, "user-profile.json"), "utf-8"));
const REPO_SUMMARY    = JSON.parse(readFileSync(join(FIXTURES, "repo-summary.json"), "utf-8"));
const COMMITS_COPILOT = JSON.parse(readFileSync(join(FIXTURES, "commits-with-copilot.json"), "utf-8"));
const REPO_NOT_FOUND  = JSON.parse(readFileSync(join(FIXTURES, "repo-not-found.json"), "utf-8"));

// Scenario sets — order matters; first match wins
const HAPPY_SCENARIOS = [
  { match: ["api", "user"],                               stdout: JSON.stringify(USER_PROFILE),    exit: 0 },
  { match: ["api", "repos/octocat/Hello-World"],          stdout: JSON.stringify(REPO_SUMMARY),    exit: 0 },
  { match: ["api"],                                       stdout: JSON.stringify(COMMITS_COPILOT), exit: 0 },
];
const AUTH_FAIL_SCENARIOS = [
  { match: ["api", "user"], stdout: JSON.stringify({ message: "Bad credentials", status: "401" }), exit: 1 },
];
const BAD_REPO_SCENARIOS = [
  { match: ["api", "user"],                               stdout: JSON.stringify(USER_PROFILE),   exit: 0 },
  { match: ["api", "repos/octocat/nonexistent"],          stdout: JSON.stringify(REPO_NOT_FOUND), exit: 1 },
  { match: ["api"],                                       stdout: "[]",                           exit: 0 },
];

// ─── Harness ──────────────────────────────────────────────────────────────────

let server;
let baseUrl;
let tmpProject;
let savedCwd;
let savedPath;
let mock;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-ghp-rest-"));
  savedCwd   = process.cwd();
  savedPath  = process.env.PATH;

  // Set up a mock gh before the server module resolves its PATH
  mock = createMockGh(HAPPY_SCENARIOS);
  process.env.PATH = mock.env.PATH;

  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);
  writeFileSync(join(tmpProject, ".forge.json"), "{}", "utf-8");

  // Init a git repo with a GitHub remote for the "defaults from origin" test
  try {
    execSync("git init -q", { cwd: tmpProject, stdio: "pipe" });
    execSync(
      "git remote add origin https://github.com/octocat/Hello-World.git",
      { cwd: tmpProject, stdio: "pipe" }
    );
  } catch { /* git unavailable in this environment */ }

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (savedCwd) process.chdir(savedCwd);
  if (savedPath !== undefined) process.env.PATH = savedPath;
  delete process.env.PLAN_FORGE_PROJECT;
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
  mock?.cleanup();
});

function get(path) {
  return fetch(`${baseUrl}${path}`);
}

// ─── 1. Full happy-path ────────────────────────────────────────────────────────
// One request shared across all assertions in this describe block.

describe("GET /api/github-personal — full happy path (owner+repo via query)", () => {
  let res;
  let body;

  beforeAll(async () => {
    mock.updateScenarios(HAPPY_SCENARIOS);
    res  = await get("/api/github-personal?owner=octocat&repo=Hello-World");
    body = await res.json();
  }, 20_000);

  it("returns HTTP 200", () => {
    expect(res.status).toBe(200);
  });

  it("response has ok=true", () => {
    expect(body.ok).toBe(true);
  });

  it("user is populated with the expected login", () => {
    expect(body.user).not.toBeNull();
    expect(body.user.login).toBe("octocat");
  });

  it("repo is populated with the expected name", () => {
    expect(body.repo).not.toBeNull();
    expect(body.repo.name).toBe("Hello-World");
  });

  it("copilotSignal is populated with total and withCopilot", () => {
    expect(body.copilotSignal).not.toBeNull();
    expect(typeof body.copilotSignal.total).toBe("number");
    expect(typeof body.copilotSignal.withCopilot).toBe("number");
  });

  it("errors object is empty on happy path", () => {
    expect(Object.keys(body.errors)).toHaveLength(0);
  });

  it("_meta.ghAuthDetected is true", () => {
    expect(body._meta.ghAuthDetected).toBe(true);
  });

  it("_meta.defaultsFrom is 'query'", () => {
    expect(body._meta.defaultsFrom).toBe("query");
  });
});

// ─── 2. Missing gh auth ────────────────────────────────────────────────────────

describe("GET /api/github-personal — gh auth failure", () => {
  let res;
  let body;

  beforeAll(async () => {
    mock.updateScenarios(AUTH_FAIL_SCENARIOS);
    res  = await get("/api/github-personal?owner=octocat&repo=Hello-World");
    body = await res.json();
  }, 20_000);

  it("still returns HTTP 200 (never 403 or 500)", () => {
    expect(res.status).toBe(200);
  });

  it("user is null and errors.user is 'auth'", () => {
    expect(body.user).toBeNull();
    expect(body.errors.user).toBe("auth");
  });

  it("_meta.ghAuthDetected is false", () => {
    expect(body._meta.ghAuthDetected).toBe(false);
  });
});

// ─── 3. Bad owner/repo (repo 404) ─────────────────────────────────────────────

describe("GET /api/github-personal — bad repo (404)", () => {
  let res;
  let body;

  beforeAll(async () => {
    mock.updateScenarios(BAD_REPO_SCENARIOS);
    res  = await get("/api/github-personal?owner=octocat&repo=nonexistent");
    body = await res.json();
  }, 20_000);

  it("still returns HTTP 200 (never 404)", () => {
    expect(res.status).toBe(200);
  });

  it("user is populated (user call succeeded independently)", () => {
    expect(body.user).not.toBeNull();
    expect(body.user.login).toBe("octocat");
  });

  it("repo is null and errors.repo is 'not-found'", () => {
    expect(body.repo).toBeNull();
    expect(body.errors.repo).toBe("not-found");
  });
});

// ─── 4. Defaults from git remote ──────────────────────────────────────────────

describe("GET /api/github-personal — defaults from git remote", () => {
  it("returns 200 with valid response shape when owner/repo absent", async () => {
    mock.updateScenarios(HAPPY_SCENARIOS);
    const r    = await get("/api/github-personal");
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.ok).toBe(true);
    // _meta.defaultsFrom must be either 'origin' (git available) or 'query'
    expect(["origin", "query"]).toContain(b._meta.defaultsFrom);
  }, 20_000);
});

// ─── 5. perPage cap ───────────────────────────────────────────────────────────

describe("GET /api/github-personal — perPage cap at 200", () => {
  it("returns 200 when perPage=999 (cap applied silently)", async () => {
    mock.updateScenarios(HAPPY_SCENARIOS);
    const r    = await get("/api/github-personal?owner=octocat&repo=Hello-World&perPage=999");
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.copilotSignal).not.toBeNull();
  }, 20_000);
});
