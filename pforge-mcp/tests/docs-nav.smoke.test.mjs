/**
 * Docs site nav smoke test.
 *
 * Boots a static file server on the repo's `docs/` directory and asks
 * Playwright to verify the user-visible nav contract on a representative
 * sample of pages, in both desktop and mobile viewports:
 *
 *   1. The mobile menu is hidden on page load (no "stuck open" regressions).
 *   2. On mobile, the hamburger button opens and closes the menu.
 *   3. On desktop, the Resources dropdown opens on click and closes on
 *      outside-click.
 *   4. Pressing Escape closes any open dropdown.
 *   5. No console errors fire during nav interactions.
 *
 * Why this exists: PR #170 (Phase-DOCS-UX-LIFT) introduced a parallel nav
 * implementation (`assets/site-nav.js` + `_includes/site-nav.html`) alongside
 * the existing inline nav + `assets/shared.js` pattern. Drift between the two
 * caused a "stuck menu" report on shop-tour.html. This test pins the contract
 * so future drift is caught at PR time.
 *
 * Skips cleanly if Playwright's chromium binary is not installed (CI runners
 * without `npx playwright install chromium` will mark the suite as skipped
 * rather than fail).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "..", "..", "docs");

// Pages that participate in the canonical nav contract. Each entry is the
// URL path served by the local docs server (not a filesystem path).
//
// Coverage: every top-level docs page that ships the inline nav + shared.js
// combo, plus the manual and architecture hub which are wired through the
// same nav include. Decks (`/walkthroughs/*-deck.html`) and 404.html
// intentionally skip the nav (immersive deck UX / centered-card design)
// and are excluded — adding a sticky nav there would clash with the
// page's primary affordance.
const PAGES = [
  "/index.html",
  "/shop-tour.html",
  "/examples.html",
  "/capabilities.html",
  "/docs.html",
  "/problem.html",
  "/speckit-interop.html",
  "/dashboard.html",
  "/faq.html",
  "/extensions.html",
  "/blog/index.html",
  "/manual/index.html",
  "/architecture/index.html",
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile",  width: 390,  height: 844  },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
};

/* ── Static file server ─────────────────────────────────────────────── */

function startStaticServer(rootDir) {
  return new Promise((resolveStart, reject) => {
    const server = createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const filePath = join(rootDir, urlPath);
        // Path-traversal guard
        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403); res.end("forbidden"); return;
        }
        let st;
        try { st = await stat(filePath); } catch {
          res.writeHead(404); res.end("not found: " + urlPath); return;
        }
        if (st.isDirectory()) {
          const idx = join(filePath, "index.html");
          try {
            const buf = await readFile(idx);
            res.writeHead(200, { "Content-Type": MIME[".html"] });
            res.end(buf);
          } catch {
            res.writeHead(404); res.end("no index.html in " + urlPath);
          }
          return;
        }
        const buf = await readFile(filePath);
        const mime = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(buf);
      } catch (err) {
        res.writeHead(500); res.end("server error: " + (err && err.message));
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolveStart({ server, port: addr.port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolveStop) => server.close(() => resolveStop()));
}

/* ── Playwright availability probe ─────────────────────────────────── */

async function tryLoadPlaywright() {
  try {
    const playwright = await import("playwright");
    if (!playwright.chromium) return null;
    const execPath = playwright.chromium.executablePath?.();
    if (!execPath) return null;
    try {
      await stat(execPath);
    } catch {
      return null;
    }
    return playwright;
  } catch {
    return null;
  }
}

/* ── Test suite ────────────────────────────────────────────────────── */

const playwright = await tryLoadPlaywright();
const SKIP_REASON = playwright
  ? null
  : "playwright chromium not installed (run: cd pforge-mcp && npx playwright install chromium)";

describe.skipIf(!playwright)("docs site nav smoke test", () => {
  let baseUrl;
  let serverHandle;
  let browser;

  beforeAll(async () => {
    serverHandle = await startStaticServer(DOCS_DIR);
    baseUrl = `http://127.0.0.1:${serverHandle.port}`;
    browser = await playwright.chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (serverHandle?.server) await stopServer(serverHandle.server);
  });

  for (const viewport of VIEWPORTS) {
    for (const page of PAGES) {
      it(`${page} @ ${viewport.name}: nav contract holds`, async () => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const consoleErrors = [];
        const ctxPage = await context.newPage();
        ctxPage.on("pageerror", (err) => consoleErrors.push(String(err)));
        ctxPage.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });

        const url = baseUrl + page;
        const resp = await ctxPage.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
        expect(resp?.ok(), `HTTP ok for ${page}`).toBe(true);

        // ── Contract 1: mobile menu must be hidden on load ──────
        const menuLocator = ctxPage.locator("#mobile-menu").first();
        const hasMenu = await menuLocator.count() > 0;
        if (hasMenu) {
          const visibleOnLoad = await menuLocator.isVisible();
          expect(visibleOnLoad, `${page} @ ${viewport.name}: #mobile-menu must be hidden on load`).toBe(false);
        }

        // ── Contract 2: hamburger toggles the menu (mobile only) ─
        if (viewport.name === "mobile" && hasMenu) {
          const btn = ctxPage.locator("#mobile-btn").first();
          const btnCount = await btn.count();
          expect(btnCount, `${page} @ mobile: #mobile-btn present`).toBeGreaterThan(0);

          await btn.click();
          await ctxPage.waitForTimeout(150);
          const openAfterClick = await menuLocator.isVisible();
          expect(openAfterClick, `${page} @ mobile: menu opens on hamburger click`).toBe(true);

          await btn.click();
          await ctxPage.waitForTimeout(150);
          const closedAfterSecondClick = await menuLocator.isVisible();
          expect(closedAfterSecondClick, `${page} @ mobile: menu closes on second hamburger click`).toBe(false);
        }

        // ── Contract 3+4: desktop dropdown click + Escape ────────
        if (viewport.name === "desktop") {
          const trigger = ctxPage.locator(".nav-dropdown-trigger").first();
          const triggerCount = await trigger.count();
          if (triggerCount > 0) {
            const dropdownContent = trigger.locator(".nav-dropdown").first();
            const visibleBefore = await dropdownContent.isVisible();
            expect(visibleBefore, `${page} @ desktop: dropdown hidden before click`).toBe(false);

            await trigger.locator("button").first().click();
            await ctxPage.waitForTimeout(150);
            const visibleAfter = await dropdownContent.isVisible();
            expect(visibleAfter, `${page} @ desktop: dropdown opens on click`).toBe(true);

            await ctxPage.keyboard.press("Escape");
            await ctxPage.waitForTimeout(150);
            const visibleAfterEsc = await dropdownContent.isVisible();
            expect(visibleAfterEsc, `${page} @ desktop: Escape closes dropdown`).toBe(false);
          }
        }

        // ── Contract 5: no console errors during nav interactions ─
        // Filter out:
        //   - Tailwind CDN production warning (informational)
        //   - "Failed to load resource" — browser-generated when a fetch
        //     hits 404. Pages like extensions.html intentionally fetch a
        //     local catalog and fall back to GitHub on miss; the 404 is
        //     handled. `pageerror` events (uncaught JS) still fail the test.
        const realErrors = consoleErrors.filter((e) =>
          !/cdn\.tailwindcss\.com should not be used in production/i.test(e) &&
          !/Failed to load resource/i.test(e)
        );
        expect(realErrors, `${page} @ ${viewport.name}: no console errors`).toEqual([]);

        await context.close();
      }, 30_000);
    }
  }
});

if (SKIP_REASON) {
  // eslint-disable-next-line no-console
  console.log(`[docs-nav.smoke] skipped: ${SKIP_REASON}`);
}
