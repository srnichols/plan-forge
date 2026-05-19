/**
 * UI sweep scanner — Playwright BFS link crawler + axe-core a11y pass
 * (TEMPER-03 Slice 03.1).
 *
 * Cross-stack scanner (not a preset adapter) — runs against a deployed
 * app URL rather than source code. Loads Playwright + @axe-core/playwright
 * via injected `importFn` so:
 *   1. The MCP process doesn't hard-depend on Playwright (heavy dep;
 *      browser install is non-trivial and some environments won't
 *      have it). Missing deps → scanner skips cleanly with
 *      reason="playwright-not-installed", never throws.
 *   2. Tests don't need a real browser — the fixture path injects a
 *      fake Playwright that scripts page responses.
 *
 * The scanner follows the same result contract as the preset-adapter
 * scanners (runScannerUnit / runScannerIntegration) so the top-level
 * `runTemperingRun` dispatcher can treat it uniformly:
 *   { scanner, startedAt, completedAt, verdict, pass, fail, skipped,
 *     durationMs, ... }
 *
 * Forbidden actions (enforced):
 *   - Never follows external-origin links (same-origin only)
 *   - Never issues POST/PUT/DELETE (GET/HEAD only)
 *   - Never runs against production unless config.allowProduction=true
 *   - Aborts cleanly when budget exceeded (closes browser)
 */
import { ensureScannerArtifactDir, hashUrl, seedArtifactsGitignore } from "../artifacts.mjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

// ─── Scanner config defaults ──────────────────────────────────────────

/**
 * Enterprise-leaning defaults for the UI scanner. Operators can dial
 * any of these down in `.forge/tempering/config.json` under the
 * `ui-playwright` key, but the defaults catch real violations against
 * a real-world dashboard without excessive false-positives.
 */
export const UI_SCANNER_DEFAULTS = Object.freeze({
  url: null,                          // must be set by caller or auto-detected
  maxDepth: 5,                        // BFS depth cap
  maxPages: 100,                      // absolute page-count cap
  allowProduction: false,             // forbidden unless true
  headless: true,                     // always headless in CI
  waitUntil: "networkidle",           // Playwright `page.goto()` waitUntil
  navigationTimeoutMs: 15000,         // per-page timeout
  captureScreenshots: true,
  runAccessibility: true,
  // axe-core severity levels that count as violations; moderate+ is
  // the default bar so trivial "best-practice" warnings don't flag
  // the run as failed.
  a11yMinSeverity: "moderate",        // "minor" | "moderate" | "serious" | "critical"
  // Max a11y violations (>= minSeverity) before the scanner's verdict
  // flips to "fail". 0 = strict. Larger values let the scanner warn
  // without blocking a slice.
  a11yFailThreshold: 0,
  // Same-origin is enforced by parsing config.url and comparing host;
  // this list is for extra-origin allow-list when a multi-origin SPA
  // is legitimate. Empty = strict same-origin-only.
  extraAllowedOrigins: [],
});

// ─── Utility: same-origin check ───────────────────────────────────────

/**
 * Returns true when `target` is same-origin as `base` or matches one
 * of the allow-listed extra origins.
 *
 * @param {string} target
 * @param {string} base
 * @param {string[]} extraAllowed
 */
export function isAllowedOrigin(target, base, extraAllowed = []) {
  try {
    const t = new URL(target);
    const b = new URL(base);
    if (t.origin === b.origin) return true;
    return extraAllowed.includes(t.origin);
  } catch {
    return false;
  }
}

/**
 * Production-URL heuristic — any host that isn't localhost, 127.*,
 * a private IP block, or `*.local`. Errs on the side of calling
 * things "production" so operators must explicitly opt-in via
 * `allowProduction: true` for real environments.
 */
export function looksLikeProduction(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === "localhost") return false;
    if (h === "127.0.0.1") return false;
    if (h.endsWith(".local")) return false;
    if (/^10\./.test(h)) return false;
    if (/^192\.168\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return true;
  } catch {
    return true; // unparseable → treat as prod
  }
}

// ─── Auto-detection for app URL ───────────────────────────────────────

/**
 * Resolve the app URL, in priority order:
 *   1. `config["ui-playwright"].url` (operator explicit)
 *   2. `env.PFORGE_TEMPERING_URL`
 *   3. Fallback: null → scanner reports skipped:"url-not-configured"
 *
 * The plan also lists `package.json` script parsing and
 * `.forge/env-config.json` lookup; those are deferred to a Slice 03.1
 * follow-up so the first cut has a tight, predictable contract.
 *
 * @param {object} config — loaded tempering config
 * @param {object} env — process.env-shaped map
 */
export function resolveAppUrl(config, env = process.env) {
  const fromConfig = config && config["ui-playwright"] && config["ui-playwright"].url;
  if (fromConfig) return String(fromConfig);
  if (env && env.PFORGE_TEMPERING_URL) return String(env.PFORGE_TEMPERING_URL);
  return null;
}

// ─── Main entry point ────────────────────────────────────────────────

function createUiSkippedFrame(base, now, reason) {
  return {
    ...base,
    skipped: true,
    reason,
    verdict: "skipped",
    pass: 0,
    fail: 0,
    durationMs: 0,
    completedAt: new Date(now()).toISOString(),
  };
}

async function loadUiDependencies(settings, importFn) {
  let playwright;
  try {
    playwright = await importFn("playwright");
  } catch {
    return { reason: "playwright-not-installed" };
  }
  if (!playwright || !playwright.chromium) {
    return { reason: "playwright-api-missing" };
  }

  let axeInjector = null;
  if (settings.runAccessibility) {
    try {
      const axeMod = await importFn("@axe-core/playwright");
      axeInjector = axeMod && (axeMod.AxeBuilder || axeMod.default);
    } catch { /* non-fatal */ }
  }

  return { playwright, axeInjector };
}

function createUiCrawlState(url) {
  return {
    visited: new Map(),
    queue: [{ url: normalizeUrl(url), depth: 0 }],
    a11yViolations: [],
    brokenLinks: [],
    pagesVisited: 0,
    budgetTripped: false,
  };
}

function shouldVisitQueuedPage(state, settings, now, hardDeadline) {
  if (now() >= hardDeadline) {
    state.budgetTripped = true;
    return false;
  }
  return state.pagesVisited < settings.maxPages;
}

function recordPageResult(state, currentUrl, pageResult) {
  state.visited.set(currentUrl, pageResult);
  if (!pageResult.ok) {
    state.brokenLinks.push({ url: currentUrl, status: pageResult.status, reason: pageResult.reason });
  }
  if (pageResult.a11yViolations) {
    for (const violation of pageResult.a11yViolations) {
      state.a11yViolations.push({ url: currentUrl, ...violation });
    }
  }
}

function enqueueAllowedLinks(state, pageResult, depth, url, settings) {
  if (!pageResult.links || depth >= settings.maxDepth) return;
  for (const link of pageResult.links) {
    if (!isAllowedOrigin(link, url, settings.extraAllowedOrigins)) continue;
    const normalized = normalizeUrl(link);
    if (!state.visited.has(normalized)) {
      state.queue.push({ url: normalized, depth: depth + 1 });
    }
  }
}

async function crawlUiPages({ playwright, context, url, settings, artifactDir, axeInjector, now, hardDeadline, state }) {
  while (state.queue.length > 0 && shouldVisitQueuedPage(state, settings, now, hardDeadline)) {
    const next = state.queue.shift();
    const currentUrl = next?.url;
    const depth = next?.depth ?? 0;
    if (!currentUrl || state.visited.has(currentUrl) || depth > settings.maxDepth) continue;

    state.pagesVisited += 1;
    const pageResult = await visitPage({
      browser: playwright,
      context,
      url: currentUrl,
      settings,
      artifactDir,
      axeInjector,
    });
    recordPageResult(state, currentUrl, pageResult);
    enqueueAllowedLinks(state, pageResult, depth, url, settings);
  }
  return state;
}

async function executeUiCrawl(playwright, crawlArgs) {
  let browser = null;
  const state = createUiCrawlState(crawlArgs.url);
  try {
    browser = await playwright.chromium.launch({ headless: crawlArgs.settings.headless !== false });
    const context = await browser.newContext();
    return { state: await crawlUiPages({ playwright: browser, context, state, ...crawlArgs }) };
  } catch (err) {
    return { error: err, state };
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
  }
}

function getScoringA11yViolations(a11yViolations, minSeverity) {
  const severityRank = { minor: 0, moderate: 1, serious: 2, critical: 3 };
  const minRank = severityRank[minSeverity] ?? 1;
  return a11yViolations.filter((violation) => (severityRank[violation.impact] ?? 0) >= minRank);
}

function determineUiVerdict({ budgetTripped, brokenLinks, scoringViolations, settings }) {
  if (budgetTripped) return "budget-exceeded";
  if (brokenLinks.length > 0) return "fail";
  if (scoringViolations.length > settings.a11yFailThreshold) return "fail";
  return "pass";
}

function writeUiReport(artifactDir, { startedAt, url, pagesVisited, brokenLinks, a11yViolations, settings, verdict }) {
  if (!artifactDir) return;
  try {
    writeFileSync(
      pathResolve(artifactDir, "report.json"),
      JSON.stringify({
        scanner: "ui-playwright",
        startedAt,
        url,
        pagesVisited,
        brokenLinks,
        a11yViolations,
        settings,
        verdict,
      }, null, 2) + "\n",
      "utf-8",
    );
  } catch { /* best-effort */ }
}

function writeUiScreenshotManifest(artifactDir, settings, visited, projectDir, runId) {
  if (!artifactDir || !settings.captureScreenshots) return;
  try {
    const manifestEntries = [];
    for (const [visitedUrl] of visited) {
      const urlHash = hashUrl(visitedUrl);
      const screenshotPath = pathResolve(artifactDir, `${urlHash}.png`);
      if (existsSync(screenshotPath)) {
        manifestEntries.push({ url: visitedUrl, urlHash, path: screenshotPath });
      }
    }
    writeScreenshotManifest(projectDir, manifestEntries, runId);
  } catch { /* best-effort */ }
}

/**
 * Run the UI sweep scanner. Contract mirrors runScannerUnit /
 * runScannerIntegration from runner.mjs:
 *
 * @param {object} ctx
 * @param {object} ctx.config
 * @param {string} ctx.projectDir
 * @param {string} ctx.runId
 * @param {{plan:string, slice:string}|null} [ctx.sliceRef]
 * @param {Function} [ctx.importFn] — injectable dynamic import
 * @param {Function} [ctx.now]
 * @returns {Promise<object>} scanner result record
 */
export async function runUiSweep(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    importFn = (spec) => import(spec),
    now = () => Date.now(),
    env = process.env,
  } = ctx || {};

  const t0 = now();
  const base = {
    scanner: "ui-playwright",
    sliceRef,
    startedAt: new Date(t0).toISOString(),
  };

  if (!config || !config.scanners || config.scanners["ui-playwright"] === false) {
    return createUiSkippedFrame(base, now, "scanner-disabled");
  }

  const settings = { ...UI_SCANNER_DEFAULTS, ...(config["ui-playwright"] || {}) };
  const url = resolveAppUrl(config, env);
  if (!url) return createUiSkippedFrame(base, now, "url-not-configured");
  if (looksLikeProduction(url) && !settings.allowProduction) {
    return createUiSkippedFrame(base, now, "production-url-without-opt-in");
  }

  const deps = await loadUiDependencies(settings, importFn);
  if (deps.reason) {
    return createUiSkippedFrame(base, now, deps.reason);
  }

  const artifactDir = settings.captureScreenshots
    ? ensureScannerArtifactDir(projectDir, runId, "ui-playwright")
    : null;
  if (artifactDir) {
    seedArtifactsGitignore(projectDir);
  }

  const hardDeadline = t0 + ((config.runtimeBudgets && config.runtimeBudgets.uiMaxMs) || 600000);
  const crawl = await executeUiCrawl(deps.playwright, {
    url,
    settings,
    artifactDir,
    axeInjector: deps.axeInjector,
    now,
    hardDeadline,
  });

  if (crawl.error) {
    return {
      ...base,
      verdict: "error",
      error: crawl.error.message || String(crawl.error),
      pagesVisited: crawl.state?.pagesVisited || 0,
      brokenLinks: crawl.state?.brokenLinks || [],
      a11yViolationCount: crawl.state?.a11yViolations?.length || 0,
      durationMs: now() - t0,
      completedAt: new Date(now()).toISOString(),
    };
  }

  const { visited, a11yViolations, brokenLinks, pagesVisited, budgetTripped } = crawl.state;
  const scoringViolations = getScoringA11yViolations(a11yViolations, settings.a11yMinSeverity);
  const verdict = determineUiVerdict({ budgetTripped, brokenLinks, scoringViolations, settings });
  writeUiReport(artifactDir, {
    startedAt: base.startedAt,
    url,
    pagesVisited,
    brokenLinks,
    a11yViolations,
    settings,
    verdict,
  });

  const durationMs = now() - t0;
  writeUiScreenshotManifest(artifactDir, settings, visited, projectDir, runId);

  return {
    ...base,
    verdict,
    pagesVisited,
    pass: pagesVisited - brokenLinks.length,
    fail: brokenLinks.length + scoringViolations.length,
    skipped: 0,
    brokenLinkCount: brokenLinks.length,
    a11yViolationCount: a11yViolations.length,
    a11yScoringCount: scoringViolations.length,
    budgetTripped,
    durationMs,
    artifactDir,
    completedAt: new Date(now()).toISOString(),
  };
}

// ─── Per-page work ────────────────────────────────────────────────────

/**
 * Visit a single URL: navigate, capture screenshot, collect console
 * errors, capture same-origin links, optionally run axe-core. Never
 * throws — returns a page-result frame with `ok: false` on failure so
 * the crawler can continue.
 */
async function visitPage({ browser, context, url, settings, artifactDir, axeInjector }) {
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type && msg.type() === "error") consoleErrors.push(msg.text ? msg.text() : String(msg));
  });
  page.on("requestfailed", (req) => {
    failedRequests.push({ url: req.url ? req.url() : "", failure: req.failure ? req.failure() : null });
  });

  let status = 0;
  let ok = false;
  let reason = null;
  let links = [];
  let a11yViolations = null;

  try {
    const response = await page.goto(url, {
      waitUntil: settings.waitUntil || "networkidle",
      timeout: settings.navigationTimeoutMs || 15000,
    });
    status = response && response.status ? response.status() : 0;
    ok = status >= 200 && status < 400;
    if (!ok) reason = `http-${status}`;

    // Link extraction — same-origin filter is applied upstream.
    links = await page.$$eval("a[href]", (anchors) =>
      anchors
        .map((a) => a.href)
        .filter((h) => typeof h === "string" && /^https?:/.test(h)),
    ).catch(() => []);

    // Screenshot
    if (artifactDir && settings.captureScreenshots) {
      try {
        const out = pathResolve(artifactDir, `${hashUrl(url)}.png`);
        await page.screenshot({ path: out, fullPage: false });
      } catch { /* ignore */ }
    }

    // Accessibility pass
    if (axeInjector && settings.runAccessibility) {
      try {
        const builder = new axeInjector({ page });
        const results = await builder.analyze();
        a11yViolations = Array.isArray(results?.violations)
          ? results.violations.map((v) => ({
              id: v.id,
              impact: v.impact || "minor",
              help: v.help,
              nodes: Array.isArray(v.nodes) ? v.nodes.length : 0,
            }))
          : [];
      } catch { /* a11y per-page failure is non-fatal */ }
    }
  } catch (err) {
    ok = false;
    reason = err && err.message ? err.message : "navigation-failed";
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }

  return { status, ok, reason, links, consoleErrors, failedRequests, a11yViolations };
}

/**
 * Write (or overwrite) the screenshot manifest at
 * `.forge/tempering/screenshot-manifest.json`. Each entry has
 * `{ url, urlHash, path }`. Passing an empty array clears a stale manifest.
 *
 * @param {string} projectDir
 * @param {Array<{url:string, urlHash:string, path:string}>} entries
 * @param {string} _runId — reserved for future per-run manifests
 */
export function writeScreenshotManifest(projectDir, entries, _runId) {
  const manifestDir = pathResolve(projectDir, ".forge", "tempering");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    pathResolve(manifestDir, "screenshot-manifest.json"),
    JSON.stringify(entries),
    "utf-8",
  );
}

/**
 * Normalize a URL for deduplication — strips fragment + trailing
 * slash on the path. Query strings are preserved because they often
 * drive real routes (e.g. `/search?q=x`).
 */
export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return String(raw || "");
  }
}
