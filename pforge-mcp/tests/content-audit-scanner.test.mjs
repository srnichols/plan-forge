/**
 * Content-audit scanner tests (Phase-39 Slice 1).
 *
 * Exercises `runContentAudit` end-to-end with an injected fake fetcher
 * so tests never make real HTTP requests. Covers:
 *   - Scanner disabled → skipped
 *   - Missing URL → skipped
 *   - No routes → skipped
 *   - Production URL guard
 *   - Happy path with mixed findings (pass/fail routes)
 *   - client-shell beats missing-h1 (priority order)
 *   - Explicit routes win over routes.json fallback
 *   - Placeholder detection
 *   - Seed substitution for parameterized routes
 *   - 3xx redirect visibility (manual redirect handling)
 *   - Default export shape { name, run }
 *   - Classifier unit tests
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  runContentAudit,
  classifyRoute,
  extractTag,
  wordCount,
  cleanBodyText,
  findPlaceholders,
  looksLikeClientShell,
  loadRoutes,
  expandRoute,
  CONTENT_AUDIT_DEFAULTS,
} from "../tempering/scanners/content-audit.mjs";
import contentAuditModule from "../tempering/scanners/content-audit.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-content-audit-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeConfig(overrides = {}) {
  return {
    scanners: { "content-audit": { enabled: true, ...overrides } },
    runtimeBudgets: { contentAuditMaxMs: 300000 },
    "ui-playwright": { url: "http://localhost:3000" },
  };
}

function makeFetcher(pages = {}) {
  return async (url, _opts) => {
    const entry = pages[url];
    if (!entry) return { ok: false, status: 404, location: null, body: "<html><body>Not Found</body></html>" };
    return {
      ok: entry.status >= 200 && entry.status < 400,
      status: entry.status ?? 200,
      location: entry.location ?? null,
      body: entry.body ?? "",
    };
  };
}

function htmlPage({ title, h1, bodyText, extra = "" }) {
  return `<html><head><title>${title || ""}</title></head><body><h1>${h1 || ""}</h1><main>${bodyText || ""} ${extra}</main></body></html>`;
}

function longText(words = 50) {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
}

let tmpDir;
beforeEach(() => { tmpDir = makeTmpDir(); });
afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

// ─── Default export shape ────────────────────────────────────────────

describe("default export", () => {
  it("exports { name, run } with name === 'content-audit'", () => {
    expect(contentAuditModule).toBeDefined();
    expect(contentAuditModule.name).toBe("content-audit");
    expect(typeof contentAuditModule.run).toBe("function");
    expect(contentAuditModule.run).toBe(runContentAudit);
  });
});

// ─── Skip paths ──────────────────────────────────────────────────────

describe("skip paths", () => {
  it("skips when scanner is disabled", async () => {
    const r = await runContentAudit({
      config: { scanners: { "content-audit": false } },
      projectDir: tmpDir,
      runId: "test-run",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });

  it("skips when scanner.enabled is false", async () => {
    const r = await runContentAudit({
      config: { scanners: { "content-audit": { enabled: false } } },
      projectDir: tmpDir,
      runId: "test-run",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });

  it("skips when no base URL is configured", async () => {
    const r = await runContentAudit({
      config: { scanners: { "content-audit": {} } },
      projectDir: tmpDir,
      runId: "test-run",
      env: {},
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("url-not-configured");
  });

  it("skips when no routes are available", async () => {
    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      env: {},
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("no-routes");
  });

  it("skips on production URL without opt-in", async () => {
    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "https://example.com" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/"],
      env: {},
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("production-url-without-opt-in");
  });
});

// ─── Happy path ──────────────────────────────────────────────────────

describe("happy path", () => {
  it("probes routes and classifies findings", async () => {
    const fetcher = makeFetcher({
      "http://localhost:3000/": {
        status: 200,
        body: htmlPage({ title: "Home", h1: "Welcome", bodyText: longText(50) }),
      },
      "http://localhost:3000/about": {
        status: 200,
        body: htmlPage({ title: "About", h1: "About Us", bodyText: longText(50) }),
      },
      "http://localhost:3000/broken": {
        status: 500,
        body: "Internal Server Error",
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/", "/about", "/broken"],
      fetcher,
      env: {},
    });

    expect(r.scanner).toBe("content-audit");
    expect(r.verdict).toBe("fail");
    expect(r.pass).toBe(2);
    expect(r.fail).toBe(1);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].class).toBe("http-500");
    expect(r.findings[0].severity).toBe("blocker");
    expect(r.findings[0].route).toBe("/broken");
  });

  it("does not include ok routes in findings", async () => {
    const fetcher = makeFetcher({
      "http://localhost:3000/": {
        status: 200,
        body: htmlPage({ title: "Home", h1: "Welcome", bodyText: longText(50) }),
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/"],
      fetcher,
      env: {},
    });

    expect(r.verdict).toBe("pass");
    expect(r.findings).toHaveLength(0);
    expect(r.pass).toBe(1);
  });
});

// ─── Client-shell beats missing-h1 ──────────────────────────────────

describe("client-shell priority", () => {
  it("classifies client-shell before missing-h1 on hydrated pages", async () => {
    const hydratedPage = `<html><head><title>App</title></head><body>
      <script src="/_next/static/chunks/main.js"></script>
      <div id="__next"><p>Loading...</p></div>
    </body></html>`;

    const fetcher = makeFetcher({
      "http://localhost:3000/app": { status: 200, body: hydratedPage },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/app"],
      fetcher,
      env: {},
    });

    // Should be client-shell (info), NOT missing-h1 (medium)
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].class).toBe("client-shell");
    expect(r.findings[0].severity).toBe("info");
  });

  it("classifies missing-h1 on non-hydrated pages", async () => {
    const plainPage = `<html><head><title>Plain</title></head><body>
      <main>Just some text here nothing else.</main>
    </body></html>`;

    const fetcher = makeFetcher({
      "http://localhost:3000/plain": { status: 200, body: plainPage },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/plain"],
      fetcher,
      env: {},
    });

    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].class).toBe("missing-h1");
    expect(r.findings[0].severity).toBe("medium");
  });
});

// ─── Route loading priority ─────────────────────────────────────────

describe("route loading", () => {
  it("explicit routes override routes.json", async () => {
    // Write a routes.json with different routes
    const auditsDir = resolve(tmpDir, ".forge", "audits");
    mkdirSync(auditsDir, { recursive: true });
    writeFileSync(
      resolve(auditsDir, "routes.json"),
      JSON.stringify({ routes: ["/from-file"] }),
    );

    const fetcher = makeFetcher({
      "http://localhost:3000/explicit": {
        status: 200,
        body: htmlPage({ title: "Explicit", h1: "Explicit", bodyText: longText(50) }),
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/explicit"],
      fetcher,
      env: {},
    });

    expect(r.routesProbed).toBe(1);
    expect(r.pass).toBe(1);
  });

  it("falls back to .forge/audits/routes.json", async () => {
    const auditsDir = resolve(tmpDir, ".forge", "audits");
    mkdirSync(auditsDir, { recursive: true });
    writeFileSync(
      resolve(auditsDir, "routes.json"),
      JSON.stringify({ routes: ["/fallback"] }),
    );

    const fetcher = makeFetcher({
      "http://localhost:3000/fallback": {
        status: 200,
        body: htmlPage({ title: "Fallback", h1: "Fallback", bodyText: longText(50) }),
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      fetcher,
      env: {},
    });

    expect(r.routesProbed).toBe(1);
    expect(r.pass).toBe(1);
  });
});

// ─── Redirect visibility ─────────────────────────────────────────────

describe("redirect handling", () => {
  it("3xx redirects are visible in findings", async () => {
    const fetcher = makeFetcher({
      "http://localhost:3000/old": {
        status: 302,
        location: "/new",
        body: "",
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/old"],
      fetcher,
      env: {},
    });

    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].class).toBe("redirect-302");
    expect(r.findings[0].severity).toBe("info");
  });

  it("auth-gated redirect classified correctly", async () => {
    const fetcher = makeFetcher({
      "http://localhost:3000/admin": {
        status: 307,
        location: "/signin?return_to=/admin",
        body: "",
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/admin"],
      fetcher,
      env: {},
    });

    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].class).toBe("auth-gated-redirect");
    expect(r.findings[0].severity).toBe("info");
  });
});

// ─── Placeholder detection ───────────────────────────────────────────

describe("placeholder detection", () => {
  it("detects placeholder content in visible text", async () => {
    const page = htmlPage({
      title: "WIP",
      h1: "Feature Page",
      bodyText: `${longText(50)} TODO: implement this feature. Lorem ipsum dolor sit amet.`,
    });

    const fetcher = makeFetcher({
      "http://localhost:3000/wip": { status: 200, body: page },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/wip"],
      fetcher,
      env: {},
    });

    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].class).toBe("placeholder-content");
    expect(r.findings[0].severity).toBe("high");
  });
});

// ─── Seed substitution ──────────────────────────────────────────────

describe("seed substitution", () => {
  it("expands parameterized routes with seed values", async () => {
    const fetcher = makeFetcher({
      "http://localhost:3000/campaigns/abc123": {
        status: 200,
        body: htmlPage({ title: "Campaign", h1: "Campaign ABC", bodyText: longText(50) }),
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/campaigns/:id"],
      seeds: { id: "abc123" },
      fetcher,
      env: {},
    });

    expect(r.pass).toBe(1);
    expect(r.findings).toHaveLength(0);
  });
});

// ─── Artifact writing ────────────────────────────────────────────────

describe("artifacts", () => {
  it("writes report.json artifact", async () => {
    const fetcher = makeFetcher({
      "http://localhost:3000/": {
        status: 200,
        body: htmlPage({ title: "Home", h1: "Home", bodyText: longText(50) }),
      },
    });

    const r = await runContentAudit({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmpDir,
      runId: "test-run",
      routes: ["/"],
      fetcher,
      env: {},
    });

    expect(r.artifactDir).toBeTruthy();
    const reportPath = resolve(r.artifactDir, "report.json");
    expect(existsSync(reportPath)).toBe(true);

    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.scanner).toBe("content-audit");
    expect(report.baseUrl).toBe("http://localhost:3000");
  });
});

// ─── Classifier unit tests ──────────────────────────────────────────

describe("classifyRoute", () => {
  it("network-error on status 0", () => {
    const r = classifyRoute({ status: 0, body: "", words: 0, placeholders: [] });
    expect(r.class).toBe("network-error");
    expect(r.severity).toBe("blocker");
  });

  it("hard-404", () => {
    const r = classifyRoute({ status: 404, body: "", words: 0, placeholders: [] });
    expect(r.class).toBe("hard-404");
    expect(r.severity).toBe("high");
  });

  it("ok for healthy page", () => {
    const r = classifyRoute({
      status: 200, body: "", title: "Home", h1: "Welcome",
      words: 100, placeholders: [],
    });
    expect(r.class).toBe("ok");
    expect(r.severity).toBe("ok");
  });
});

// ─── Helper unit tests ──────────────────────────────────────────────

describe("helpers", () => {
  it("extractTag finds title", () => {
    expect(extractTag("<title>Hello World</title>", "title")).toBe("Hello World");
  });

  it("wordCount counts words", () => {
    expect(wordCount("hello world foo bar")).toBe(4);
    expect(wordCount("")).toBe(0);
    expect(wordCount(null)).toBe(0);
  });

  it("findPlaceholders finds TODO", () => {
    const hits = findPlaceholders("<p>This is a TODO item</p>");
    expect(hits).toContain("TODO");
  });

  it("findPlaceholders ignores placeholder attr", () => {
    const hits = findPlaceholders('<input placeholder="Enter name">');
    expect(hits).toHaveLength(0);
  });

  it("looksLikeClientShell detects Next.js markers", () => {
    expect(looksLikeClientShell('<script src="/_next/static/chunks/main.js"></script>')).toBe(true);
    expect(looksLikeClientShell("<html><body>Plain HTML</body></html>")).toBe(false);
  });

  it("expandRoute substitutes parameters", () => {
    const { expanded, seed } = expandRoute("/campaigns/:id", { id: "abc" });
    expect(expanded).toBe("/campaigns/abc");
    expect(seed).toEqual({ id: "abc" });
  });

  it("expandRoute returns original when no seeds match", () => {
    const { expanded, seed } = expandRoute("/static", { id: "abc" });
    expect(expanded).toBe("/static");
    expect(seed).toBeNull();
  });

  it("loadRoutes prefers explicit routes", () => {
    const routes = loadRoutes({
      routes: ["/a", "/b"],
      projectDir: tmpDir,
      settings: CONTENT_AUDIT_DEFAULTS,
    });
    expect(routes).toEqual(["/a", "/b"]);
  });
});
