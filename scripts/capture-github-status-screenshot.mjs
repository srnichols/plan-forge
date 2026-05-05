// One-off screenshot generator for the GitHub-stack readiness terminal output.
// Renders a stylised "terminal" view of `pforge github status` against the
// testbed and saves a PNG that matches the manual's screenshot convention.
//
// Run with:  node --experimental-vm-modules scripts/capture-github-status-screenshot.mjs
// (Playwright lives in pforge-mcp/node_modules, so we import via absolute path.)
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const playwrightUrl = pathToFileURL(
  resolve(repoRoot, "pforge-mcp/node_modules/playwright/index.mjs")
).href;
const { chromium } = await import(playwrightUrl);

const testbed = "E:\\GitHub\\plan-forge-testbed";
const outPath = resolve(repoRoot, "docs/manual/assets/screenshots/github-status-testbed.png");

// 1. Run the introspection — capture human output.
const stdoutBuf = execFileSync("node", [
  resolve(repoRoot, "pforge-mcp/github-introspect.mjs"),
  "--project", testbed,
], { encoding: "utf8", maxBuffer: 1024 * 1024 });

// 2. Build a styled HTML page that looks like a dark terminal pane.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body { margin:0; padding:0; background:#0b1220; }
  .term {
    font-family: "JetBrains Mono","Cascadia Code","Consolas",monospace;
    font-size: 13px;
    line-height: 1.55;
    color: #cbd5e1;
    background: #0b1220;
    border: 1px solid rgba(148,163,184,0.18);
    border-radius: 12px;
    padding: 24px 28px;
    margin: 28px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    white-space: pre;
    width: max-content;
    min-width: 760px;
  }
  .head { display:flex; gap:8px; padding-bottom:14px; }
  .dot { width:12px; height:12px; border-radius:50%; }
  .r { background:#ef4444; } .y { background:#f59e0b; } .g { background:#10b981; }
  .prompt { color:#a78bfa; }
  .cmd { color:#f8fafc; }
  body { display:flex; align-items:flex-start; justify-content:flex-start; }
</style></head><body>
<div class="term">
  <div class="head"><div class="dot r"></div><div class="dot y"></div><div class="dot g"></div></div>
  <span class="prompt">PS&nbsp;E:\\GitHub\\plan-forge-testbed&gt;</span>
  <span class="cmd">pforge github status</span>
${escapeHtml(stdoutBuf)}</div>
</body></html>`;

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// 3. Render and screenshot via playwright.
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const term = await page.locator(".term");
  const buf = await term.screenshot({ type: "png", omitBackground: false });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  console.log(`wrote ${outPath} (${buf.length} bytes)`);
} finally {
  await browser.close();
}
