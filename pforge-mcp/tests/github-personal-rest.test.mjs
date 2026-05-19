/**
 * Tests for GET /api/github-personal REST endpoint (Phase-54 Slice 1).
 *
 * Actions tested:
 *   - action=profile   (default) — fetchUserProfile() proxied through HTTP
 *   - action=repo                — fetchRepoSummary() with owner+repo params
 *   - action=coauthors           — scanCopilotCoauthors() with owner+repo params
 *   - unknown action             — 400 Bad Request
 *   - auth failure               — 403 Forbidden
 *   - not found                  — 404 Not Found
 *   - rate limit                 — 429 Too Many Requests
 *   - missing required params    — 400 Bad Request
 *
 * gh is mocked via createMockGh; no real GitHub API calls are made.
 * process.env.PATH is patched per-describe-block to point at the mock binary.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createMockGh } from "./helpers/mock-gh.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const __dir   = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dir, "fixtures", "github-personal");

const USER_PROFILE    = JSON.parse(readFileSync(join(FIXTURES, "user-profile.json"), "utf-8"));
const REPO_SUMMARY    = JSON.parse(readFileSync(join(FIXTURES, "repo-summary.json"), "utf-8"));
const COMMITS_COPILOT = JSON.parse(readFileSync(join(FIXTURES, "commits-with-copilot.json"), "utf-8"));
const REPO_NOT_FOUND  = JSON.parse(readFileSync(join(FIXTURES, "repo-not-found.json"), "utf-8"));

const AUTH_FAILURE = { message: "Bad credentials", status: "401" };
const RATE_LIMIT   = { message: "API rate limit exceeded", status: "429" };

// ─── Harness ──────────────────────────────────────────────────────────────────

let server;
let baseUrl;
let tmpProject;
let savedCwd;

const ORIGINAL_PATH = process.env.PATH ?? "";

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-ghp-rest-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);
  writeFileSync(join(tmpProject, ".forge.json"), "{}", "utf-8");

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (savedCwd) process.chdir(savedCwd);
  process.env.PATH = ORIGINAL_PATH;
  delete process.env.PLAN_FORGE_PROJECT;
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

function get(path) {
  return fetch(`${baseUrl}${path}`);
}

// ─── action=profile ───────────────────────────────────────────────────────────

describe("GET /api/github-personal?action=profile — happy path", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([{ match: ["api"], stdout: JSON.stringify(USER_PROFILE), exit: 0 }]);
    process.env.PATH = `${mock.dir}${delimiter}${ORIGINAL_PATH}`;
  });

  afterEach(() => {
    mock.cleanup();
    process.env.PATH = ORIGINAL_PATH;
  });

  it("returns HTTP 200", async () => {
    const res = await get("/api/github-personal?action=profile");
    expect(res.status).toBe(200);
  });

  it("response has action='profile' and normalized data", async () => {
    const res = await get("/api/github-personal?action=profile");
    const body = await res.json();
    expect(body.action).toBe("profile");
    expect(body.data.login).toBe("octocat");
    expect(body.data.id).toBe(583231);
    expect(body.data).toHaveProperty("publicRepos");
    expect(body.data).not.toHaveProperty("public_repos");
  });

  it("default (no action param) also returns profile", async () => {
    const res = await get("/api/github-personal");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("profile");
    expect(body.data.login).toBe("octocat");
  });
});

// ─── action=repo ──────────────────────────────────────────────────────────────

describe("GET /api/github-personal?action=repo — happy path", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([{ match: ["api"], stdout: JSON.stringify(REPO_SUMMARY), exit: 0 }]);
    process.env.PATH = `${mock.dir}${delimiter}${ORIGINAL_PATH}`;
  });

  afterEach(() => {
    mock.cleanup();
    process.env.PATH = ORIGINAL_PATH;
  });

  it("returns HTTP 200 with repo summary", async () => {
    const res = await get("/api/github-personal?action=repo&owner=octocat&repo=Hello-World");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("repo");
    expect(body.data.fullName).toBe("octocat/Hello-World");
    expect(body.data.stars).toBe(80);
  });

  it("camelCase fields — no snake_case leakage", async () => {
    const res = await get("/api/github-personal?action=repo&owner=octocat&repo=Hello-World");
    const body = await res.json();
    expect(body.data).not.toHaveProperty("full_name");
    expect(body.data).not.toHaveProperty("stargazers_count");
    expect(body.data).not.toHaveProperty("open_issues_count");
  });
});

describe("GET /api/github-personal?action=repo — missing params", () => {
  it("returns 400 when owner is missing", async () => {
    const res = await get("/api/github-personal?action=repo&repo=Hello-World");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/owner/);
  });

  it("returns 400 when repo is missing", async () => {
    const res = await get("/api/github-personal?action=repo&owner=octocat");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/repo/);
  });
});

// ─── action=coauthors ─────────────────────────────────────────────────────────

describe("GET /api/github-personal?action=coauthors — happy path", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([{ match: ["api"], stdout: JSON.stringify(COMMITS_COPILOT), exit: 0 }]);
    process.env.PATH = `${mock.dir}${delimiter}${ORIGINAL_PATH}`;
  });

  afterEach(() => {
    mock.cleanup();
    process.env.PATH = ORIGINAL_PATH;
  });

  it("returns HTTP 200 with commit scan result", async () => {
    const res = await get("/api/github-personal?action=coauthors&owner=octocat&repo=Hello-World");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("coauthors");
    expect(typeof body.data.total).toBe("number");
    expect(typeof body.data.withCopilot).toBe("number");
    expect(Array.isArray(body.data.commits)).toBe(true);
  });

  it("withCopilot is greater than 0 for fixture with copilot commits", async () => {
    const res = await get("/api/github-personal?action=coauthors&owner=octocat&repo=Hello-World");
    const body = await res.json();
    expect(body.data.withCopilot).toBeGreaterThan(0);
  });
});

describe("GET /api/github-personal?action=coauthors — missing params", () => {
  it("returns 400 when owner is missing", async () => {
    const res = await get("/api/github-personal?action=coauthors&repo=Hello-World");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/owner/);
  });

  it("returns 400 when repo is missing", async () => {
    const res = await get("/api/github-personal?action=coauthors&owner=octocat");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/repo/);
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("GET /api/github-personal — auth failure", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([{ match: ["api"], stdout: JSON.stringify(AUTH_FAILURE), exit: 1 }]);
    process.env.PATH = `${mock.dir}${delimiter}${ORIGINAL_PATH}`;
  });

  afterEach(() => {
    mock.cleanup();
    process.env.PATH = ORIGINAL_PATH;
  });

  it("returns 403 with code=auth_error", async () => {
    const res = await get("/api/github-personal?action=profile");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("auth_error");
  });
});

describe("GET /api/github-personal — not found", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([{ match: ["api"], stdout: JSON.stringify(REPO_NOT_FOUND), exit: 1 }]);
    process.env.PATH = `${mock.dir}${delimiter}${ORIGINAL_PATH}`;
  });

  afterEach(() => {
    mock.cleanup();
    process.env.PATH = ORIGINAL_PATH;
  });

  it("returns 404 with code=not_found", async () => {
    const res = await get("/api/github-personal?action=repo&owner=octocat&repo=nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });
});

describe("GET /api/github-personal — rate limit", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([{ match: ["api"], stdout: JSON.stringify(RATE_LIMIT), exit: 1 }]);
    process.env.PATH = `${mock.dir}${delimiter}${ORIGINAL_PATH}`;
  });

  afterEach(() => {
    mock.cleanup();
    process.env.PATH = ORIGINAL_PATH;
  });

  it("returns 429 with code=rate_limit", async () => {
    const res = await get("/api/github-personal?action=profile");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("rate_limit");
  });
});

describe("GET /api/github-personal — unknown action", () => {
  it("returns 400 for unrecognised action value", async () => {
    const res = await get("/api/github-personal?action=bogus");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bogus/);
  });
});
