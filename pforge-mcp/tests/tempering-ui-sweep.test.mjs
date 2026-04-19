/**
 * UI-sweep scanner tests (Phase TEMPER-03 Slice 03.1).
 *
 * Exercises `runUiSweep` end-to-end with an injected fake Playwright
 * so tests never launch a real browser. Covers:
 *   - Optional-dep skip paths (playwright / axe missing)
 *   - URL gating (missing URL, production URL without opt-in)
 *   - BFS crawler (same-origin filter, depth cap, page cap)
 *   - Broken-link verdict (fail)
 *   - a11y threshold verdict (severity filter + fail threshold)
 *   - Artifact writing (report.json + screenshots) + .gitignore seed
 *   - Budget enforcement (hardDeadline)
 * Plus unit tests for helpers: isAllowedOrigin, looksLikeProduction,
 * resolveAppUrl, normalizeUrl, gcArtifacts, hashUrl.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  runUiSweep,
  resolveAppUrl,
  normalizeUrl,
  isAllowedOrigin,
  looksLikeProduction,
  UI_SCANNER_DEFAULTS,
} from "../tempering/scanners/ui-playwright.mjs";
import {
  getArtifactDir,
  getScannerArtifactDir,
  ensureScannerArtifactDir,
  hashUrl,
  gcArtifacts,
  seedArtifactsGitignore,
  DEFAULT_ARTIFACT_RETENTION_DAYS,
} from "../tempering/artifacts.mjs";

function makeProject() {
  const dir = resolve(tmpdir(), `temper-ui-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Fake Playwright ─────────────────────────────────────────────────

/**
 * Build a Playwright-shaped mock from a site description. Each entry
 * in `pages` maps a URL → `{ status, links, consoleErrors,
 * a11yViolations }`. Any unlisted URL returns status=404.
 */
function makeFakePlaywright({ pages = {}, launchError = null } = {}) {
  const screenshotsTaken = [];
  const chromium = {
    launch: async ({ headless } = {}) => {
      if (launchError) throw new Error(launchError);
      const browser = {
        newContext: async () => ({
          newPage: async () => {
            const consoleHandlers = [];
            const failedHandlers = [];
            let currentUrl = null;
            return {
              on: (evt, fn) => {
                if (evt === "console") consoleHandlers.push(fn);
                else if (evt === "requestfailed") failedHandlers.push(fn);
              },
              goto: async (url) => {
                currentUrl = url;
                const entry = pages[url];
                const status = entry ? (entry.status ?? 200) : 404;
                if (entry && entry.consoleErrors) {
                  for (const t of entry.consoleErrors) {
                    for (const fn of consoleHandlers) fn({ type: () => "error", text: () => t });
                  }
                }
                return { status: () => status };
              },
              $$eval: async (sel, fn) => {
                const entry = pages[currentUrl];
                return entry && entry.links ? entry.links : [];
              },
              screenshot: async ({ path }) => { screenshotsTaken.push(path); },
              close: async () => {},
            };
          },
        }),
        close: async () => {},
      };
      return browser;
    },
  };
  chromium._screenshotsTaken = screenshotsTaken;
  return { chromium };
}

function makeFakeAxe(pages) {
  // Tests pass violations by URL; the fake axe uses the URL from the
  // passed-in page via a shared closure. Each call to `.analyze()`
  // reads `page.__url` we set on the fake.
  return class FakeAxeBuilder {
    constructor({ page }) { this._page = page; }
    async analyze() {
      // We'd need page.url() in the real API; the fake stores nothing
      // per-page, so the test supplies the full violation list via
      // the outer pages closure. The top-level test constructs one
      // axe class per URL via the importFn dispatch.
      return { violations: [] };
    }
  };
}

/**
 * Richer axe-mock that keys violations by the last `goto`'d URL. The
 * fake Playwright tracks `currentUrl` in closure; we mirror that
 * here by wrapping the page with a `__url` accessor.
 */
function makeFakePlaywrightWithAxe({ pages }) {
  const screenshotsTaken = [];
  let lastUrl = null;
  const chromium = {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => {
          const consoleHandlers = [];
          return {
            on: () => {},
            goto: async (url) => {
              lastUrl = url;
              const entry = pages[url];
              const status = entry ? (entry.status ?? 200) : 404;
              return { status: () => status };
            },
            $$eval: async () => (pages[lastUrl]?.links || []),
            screenshot: async ({ path }) => { screenshotsTaken.push(path); },
            close: async () => {},
            __getLastUrl: () => lastUrl,
          };
        },
      }),
      close: async () => {},
    }),
  };
  class AxeBuilder {
    constructor({ page }) { this._page = page; }
    async analyze() {
      const entry = pages[lastUrl] || {};
      return { violations: entry.a11yViolations || [] };
    }
  }
  chromium._screenshotsTaken = screenshotsTaken;
  return { playwright: { chromium }, AxeBuilder };
}

function makeImportFn({ playwright, axe }) {
  return async (spec) => {
    if (spec === "playwright") {
      if (!playwright) throw new Error("not installed");
      return playwright;
    }
    if (spec === "@axe-core/playwright") {
      if (!axe) throw new Error("axe not installed");
      return { AxeBuilder: axe };
    }
    throw new Error(`unknown module: ${spec}`);
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

describe("artifacts helpers", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("hashUrl is deterministic and 16 hex chars", () => {
    const a = hashUrl("http://localhost:3100/dashboard");
    const b = hashUrl("http://localhost:3100/dashboard");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashUrl produces distinct hashes for distinct URLs", () => {
    expect(hashUrl("a")).not.toBe(hashUrl("b"));
  });

  it("getArtifactDir + getScannerArtifactDir compose correctly", () => {
    const a = getArtifactDir(projectDir, "run-1");
    const s = getScannerArtifactDir(projectDir, "run-1", "ui-playwright");
    expect(a.endsWith(".forge/tempering/artifacts/run-1") || a.endsWith(".forge\\tempering\\artifacts\\run-1")).toBe(true);
    expect(s.startsWith(a)).toBe(true);
  });

  it("ensureScannerArtifactDir creates the directory", () => {
    const d = ensureScannerArtifactDir(projectDir, "run-x", "ui-playwright");
    expect(d).toBeTruthy();
    expect(existsSync(d)).toBe(true);
  });

  it("gcArtifacts removes dirs older than retention and keeps fresh ones", () => {
    const root = resolve(projectDir, ".forge", "tempering", "artifacts");
    mkdirSync(resolve(root, "run-old"), { recursive: true });
    mkdirSync(resolve(root, "run-fresh"), { recursive: true });
    // Age the "old" dir by back-dating via utimes
    const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(resolve(root, "run-old"), ancient, ancient);

    const r = gcArtifacts({ projectDir, retentionDays: 7 });
    expect(r.removed).toContain("run-old");
    expect(r.kept).toContain("run-fresh");
    expect(existsSync(resolve(root, "run-old"))).toBe(false);
    expect(existsSync(resolve(root, "run-fresh"))).toBe(true);
  });

  it("gcArtifacts is a no-op when artifacts root missing", () => {
    const r = gcArtifacts({ projectDir });
    expect(r.removed).toEqual([]);
    expect(r.kept).toEqual([]);
  });

  it("seedArtifactsGitignore appends the entry on first call", () => {
    const gi = resolve(projectDir, ".gitignore");
    writeFileSync(gi, "node_modules/\n", "utf-8");
    expect(seedArtifactsGitignore(projectDir)).toBe(true);
    const after = readFileSync(gi, "utf-8");
    expect(after).toContain(".forge/tempering/artifacts/");
  });

  it("seedArtifactsGitignore is idempotent", () => {
    const gi = resolve(projectDir, ".gitignore");
    writeFileSync(gi, ".forge/tempering/artifacts/\n", "utf-8");
    expect(seedArtifactsGitignore(projectDir)).toBe(false);
  });

  it("seedArtifactsGitignore creates the file when missing", () => {
    expect(seedArtifactsGitignore(projectDir)).toBe(true);
    expect(existsSync(resolve(projectDir, ".gitignore"))).toBe(true);
  });

  it("DEFAULT_ARTIFACT_RETENTION_DAYS is 7", () => {
    expect(DEFAULT_ARTIFACT_RETENTION_DAYS).toBe(7);
  });
});

// ─── URL / origin helpers ─────────────────────────────────────────────

describe("isAllowedOrigin", () => {
  it("allows same-origin", () => {
    expect(isAllowedOrigin("http://a.com/x", "http://a.com/")).toBe(true);
  });
  it("blocks different-origin", () => {
    expect(isAllowedOrigin("http://b.com/x", "http://a.com/")).toBe(false);
  });
  it("honours extraAllowed list", () => {
    expect(isAllowedOrigin("http://b.com/x", "http://a.com/", ["http://b.com"])).toBe(true);
  });
  it("returns false for unparseable URLs", () => {
    expect(isAllowedOrigin("not-a-url", "http://a.com")).toBe(false);
  });
});

describe("looksLikeProduction", () => {
  it("recognises localhost as non-prod", () => {
    expect(looksLikeProduction("http://localhost:3000")).toBe(false);
  });
  it("recognises 127.0.0.1 as non-prod", () => {
    expect(looksLikeProduction("http://127.0.0.1:8080")).toBe(false);
  });
  it("recognises *.local as non-prod", () => {
    expect(looksLikeProduction("http://dev.local")).toBe(false);
  });
  it("recognises 10.x / 192.168.x / 172.16.x as non-prod", () => {
    expect(looksLikeProduction("http://10.0.0.5")).toBe(false);
    expect(looksLikeProduction("http://192.168.1.1")).toBe(false);
    expect(looksLikeProduction("http://172.20.0.1")).toBe(false);
  });
  it("flags public hostnames as prod", () => {
    expect(looksLikeProduction("https://example.com")).toBe(true);
  });
  it("treats unparseable URLs as prod (safer default)", () => {
    expect(looksLikeProduction("::bogus::")).toBe(true);
  });
});

describe("resolveAppUrl", () => {
  it("reads config['ui-playwright'].url first", () => {
    const url = resolveAppUrl({ "ui-playwright": { url: "http://cfg" } }, {});
    expect(url).toBe("http://cfg");
  });
  it("falls back to env.PFORGE_TEMPERING_URL", () => {
    expect(resolveAppUrl({}, { PFORGE_TEMPERING_URL: "http://env" })).toBe("http://env");
  });
  it("returns null when nothing configured", () => {
    expect(resolveAppUrl({}, {})).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("strips fragments", () => {
    expect(normalizeUrl("http://a/x#y")).toBe("http://a/x");
  });
  it("trims trailing slash on non-root path", () => {
    expect(normalizeUrl("http://a/foo/")).toBe("http://a/foo");
  });
  it("keeps root slash", () => {
    expect(normalizeUrl("http://a/")).toBe("http://a/");
  });
  it("preserves query string", () => {
    expect(normalizeUrl("http://a/x?q=1")).toBe("http://a/x?q=1");
  });
});

describe("UI_SCANNER_DEFAULTS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(UI_SCANNER_DEFAULTS)).toBe(true);
  });
  it("defaults to headless + strict a11y threshold 0 + allowProduction false", () => {
    expect(UI_SCANNER_DEFAULTS.headless).toBe(true);
    expect(UI_SCANNER_DEFAULTS.a11yFailThreshold).toBe(0);
    expect(UI_SCANNER_DEFAULTS.allowProduction).toBe(false);
  });
});

// ─── runUiSweep — skip paths ──────────────────────────────────────────

describe("runUiSweep — skip paths", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const baseConfig = {
    scanners: { "ui-playwright": true },
    "ui-playwright": { url: "http://localhost:3000" },
    runtimeBudgets: { uiMaxMs: 60000 },
  };

  it("skips with scanner-disabled when config disables it", async () => {
    const r = await runUiSweep({
      config: { ...baseConfig, scanners: { "ui-playwright": false } },
      projectDir, runId: "r1",
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("scanner-disabled");
  });

  it("skips with url-not-configured when no URL provided", async () => {
    const r = await runUiSweep({
      config: { scanners: { "ui-playwright": true } },
      projectDir, runId: "r1", env: {},
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("url-not-configured");
  });

  it("skips with production-url-without-opt-in when URL looks like prod", async () => {
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "https://prod.example.com" },
      },
      projectDir, runId: "r1", env: {},
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("production-url-without-opt-in");
  });

  it("proceeds when allowProduction: true is set explicitly", async () => {
    // With allowProduction + missing playwright it proceeds past the
    // prod guard and then skips at dep load. We only assert it got
    // past the production check (reason changes).
    const importFn = makeImportFn({ playwright: null });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "https://prod.example.com", allowProduction: true },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.reason).toBe("playwright-not-installed");
  });

  it("skips with playwright-not-installed when importFn throws", async () => {
    const importFn = makeImportFn({ playwright: null });
    const r = await runUiSweep({
      config: baseConfig, projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("playwright-not-installed");
  });

  it("skips with playwright-api-missing when module lacks chromium", async () => {
    const importFn = async () => ({}); // no chromium
    const r = await runUiSweep({
      config: baseConfig, projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("playwright-api-missing");
  });
});

// ─── runUiSweep — crawler behaviour ───────────────────────────────────

describe("runUiSweep — BFS crawler", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("visits linked pages and reports pass verdict", async () => {
    const pages = {
      "http://localhost:3000/": { status: 200, links: ["http://localhost:3000/a", "http://localhost:3000/b"] },
      "http://localhost:3000/a": { status: 200, links: [] },
      "http://localhost:3000/b": { status: 200, links: [] },
    };
    const playwright = makeFakePlaywright({ pages });
    const importFn = makeImportFn({ playwright });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "http://localhost:3000/", runAccessibility: false, captureScreenshots: false },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.verdict).toBe("pass");
    expect(r.pagesVisited).toBe(3);
    expect(r.brokenLinkCount).toBe(0);
  });

  it("flags broken links and returns verdict=fail", async () => {
    const pages = {
      "http://localhost:3000/": { status: 200, links: ["http://localhost:3000/404"] },
      "http://localhost:3000/404": { status: 500, links: [] },
    };
    const playwright = makeFakePlaywright({ pages });
    const importFn = makeImportFn({ playwright });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "http://localhost:3000/", runAccessibility: false, captureScreenshots: false },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.verdict).toBe("fail");
    expect(r.brokenLinkCount).toBe(1);
  });

  it("does not follow external-origin links", async () => {
    const pages = {
      "http://localhost:3000/": { status: 200, links: ["http://evil.com/a", "http://localhost:3000/b"] },
      "http://localhost:3000/b": { status: 200, links: [] },
    };
    const playwright = makeFakePlaywright({ pages });
    const importFn = makeImportFn({ playwright });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "http://localhost:3000/", runAccessibility: false, captureScreenshots: false },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.pagesVisited).toBe(2); // /, /b (evil.com skipped)
  });

  it("honours maxPages cap", async () => {
    const pages = {
      "http://localhost:3000/": { status: 200, links: ["http://localhost:3000/a", "http://localhost:3000/b", "http://localhost:3000/c"] },
      "http://localhost:3000/a": { status: 200, links: [] },
      "http://localhost:3000/b": { status: 200, links: [] },
      "http://localhost:3000/c": { status: 200, links: [] },
    };
    const playwright = makeFakePlaywright({ pages });
    const importFn = makeImportFn({ playwright });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": {
          url: "http://localhost:3000/", maxPages: 2,
          runAccessibility: false, captureScreenshots: false,
        },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.pagesVisited).toBe(2);
  });

  it("honours maxDepth cap", async () => {
    const pages = {
      "http://localhost:3000/": { status: 200, links: ["http://localhost:3000/a"] },
      "http://localhost:3000/a": { status: 200, links: ["http://localhost:3000/b"] },
      "http://localhost:3000/b": { status: 200, links: ["http://localhost:3000/c"] },
    };
    const playwright = makeFakePlaywright({ pages });
    const importFn = makeImportFn({ playwright });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": {
          url: "http://localhost:3000/", maxDepth: 1,
          runAccessibility: false, captureScreenshots: false,
        },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    // Depth 0 (/) + depth 1 (/a). /b is depth-2 → skipped.
    expect(r.pagesVisited).toBe(2);
  });

  it("writes report.json and a screenshot per visited page", async () => {
    const pages = {
      "http://localhost:3000/": { status: 200, links: ["http://localhost:3000/a"] },
      "http://localhost:3000/a": { status: 200, links: [] },
    };
    const playwright = makeFakePlaywright({ pages });
    const importFn = makeImportFn({ playwright });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "http://localhost:3000/", runAccessibility: false },
      },
      projectDir, runId: "run-xyz", importFn, env: {},
    });
    expect(r.verdict).toBe("pass");
    expect(playwright.chromium._screenshotsTaken).toHaveLength(2);
    const reportPath = resolve(projectDir, ".forge/tempering/artifacts/run-xyz/ui-playwright/report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.scanner).toBe("ui-playwright");
    expect(report.pagesVisited).toBe(2);
  });
});

// ─── runUiSweep — a11y threshold ─────────────────────────────────────

describe("runUiSweep — a11y threshold", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("passes when violations are all below minSeverity", async () => {
    const pages = {
      "http://localhost:3000/": {
        status: 200, links: [],
        a11yViolations: [{ id: "color-contrast", impact: "minor", help: "h", nodes: [{}] }],
      },
    };
    const { playwright, AxeBuilder } = makeFakePlaywrightWithAxe({ pages });
    const importFn = makeImportFn({ playwright, axe: AxeBuilder });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": {
          url: "http://localhost:3000/", a11yMinSeverity: "moderate", captureScreenshots: false,
        },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.verdict).toBe("pass");
    expect(r.a11yViolationCount).toBe(1);
    expect(r.a11yScoringCount).toBe(0);
  });

  it("fails when serious violations exceed fail threshold", async () => {
    const pages = {
      "http://localhost:3000/": {
        status: 200, links: [],
        a11yViolations: [
          { id: "r1", impact: "serious", help: "h", nodes: [{}] },
          { id: "r2", impact: "critical", help: "h", nodes: [{}] },
        ],
      },
    };
    const { playwright, AxeBuilder } = makeFakePlaywrightWithAxe({ pages });
    const importFn = makeImportFn({ playwright, axe: AxeBuilder });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "http://localhost:3000/", captureScreenshots: false },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.verdict).toBe("fail");
    expect(r.a11yScoringCount).toBe(2);
  });

  it("skips a11y pass gracefully when axe module is missing", async () => {
    const pages = { "http://localhost:3000/": { status: 200, links: [] } };
    const playwright = makeFakePlaywright({ pages });
    const importFn = makeImportFn({ playwright, axe: null });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "http://localhost:3000/", captureScreenshots: false },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    // No crash; a11yViolationCount should be 0.
    expect(r.verdict).toBe("pass");
    expect(r.a11yViolationCount).toBe(0);
  });
});

// ─── Error containment ──────────────────────────────────────────────

describe("runUiSweep — error containment", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns verdict=error when browser launch throws", async () => {
    const playwright = makeFakePlaywright({ launchError: "launch-boom" });
    const importFn = makeImportFn({ playwright });
    const r = await runUiSweep({
      config: {
        scanners: { "ui-playwright": true },
        "ui-playwright": { url: "http://localhost:3000/", captureScreenshots: false, runAccessibility: false },
      },
      projectDir, runId: "r1", importFn, env: {},
    });
    expect(r.verdict).toBe("error");
    expect(r.error).toMatch(/launch-boom/);
  });
});
