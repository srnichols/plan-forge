/**
 * Content-audit scanner — HTTP-probe + HTML-inspection reference impl
 * (Phase-39 Slice 1).
 *
 * Ported from Rummag's `scripts/audit/audit-content.mjs`. Probes a set
 * of routes against a live base URL and emits structured findings per
 * route: HTTP status, title, h1, word count, placeholder markers, and
 * client-shell detection for hydrated SPAs.
 *
 * Does NOT execute JS — this is a static-content/SSR audit. SPA support
 * (Playwright) is out of scope for v2.80.
 *
 * Follows the cross-stack scanner result contract:
 *   { scanner, startedAt, completedAt, verdict, pass, fail, skipped,
 *     durationMs, findings, ... }
 *
 * Design constraints:
 *   - Never throws — always returns a result frame
 *   - Fetcher injectable for testing (no real HTTP in tests)
 *   - Production guard via looksLikeProduction() from ui-playwright
 *   - Uses redirect: "manual" so 3xx responses are visible
 *   - Only non-ok findings are emitted into findings[] (ok routes
 *     count toward pass but don't inflate the findings array)
 *
 * @module tempering/scanners/content-audit
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { looksLikeProduction, resolveAppUrl } from "./ui-playwright.mjs";
import { ensureScannerArtifactDir, seedArtifactsGitignore } from "../artifacts.mjs";

// ─── Placeholder patterns (visible text only) ────────────────────────

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /coming soon/i,
  /under construction/i,
  /\blorem ipsum\b/i,
  /\bmock data\b/i,
  /\bsample data\b/i,
  /lipsum/i,
  /\bnot yet implemented\b/i,
  /\bwork in progress\b/i,
];

const MIN_WORD_COUNT = 30;

// Next.js / React hydration markers — pages with these present render
// content client-side so low SSR word count is expected. Classified as
// info/client-shell rather than medium/empty-shell.
const HYDRATION_MARKERS = [
  /\/_next\//,
  /__NEXT_DATA__/,
  /self\.__next_f\.push/,
  /<next-route-announcer/,
];

// ─── Scanner config defaults ─────────────────────────────────────────

export const CONTENT_AUDIT_DEFAULTS = Object.freeze({
  baseUrl: null,
  routesPath: null,
  allowProduction: false,
  userAgent: "PlanForgeContentAudit/1.0",
  timeoutMs: 10000,
  maxRoutes: 500,
});

// ─── HTML helpers ────────────────────────────────────────────────────

export function extractTag(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function wordCount(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function cleanBodyText(html) {
  return extractTag(html, "main") ?? extractTag(html, "body") ?? "";
}

export function findPlaceholders(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
  const hits = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const m = text.match(pattern);
    if (m) hits.push(m[0]);
  }
  return [...new Set(hits)];
}

export function looksLikeClientShell(body) {
  if (!body) return false;
  return HYDRATION_MARKERS.some((re) => re.test(body));
}

// ─── Classifier ──────────────────────────────────────────────────────

/**
 * Priority-ordered classifier. Returns `{ severity, class, evidence }`.
 * Order matters: client-shell MUST fire before missing-h1/empty-shell
 * to avoid false positives on hydrated SPAs.
 */
export function classifyRoute({ status, location, body, title, h1, words, placeholders }) {
  if (status === 0) return { severity: "blocker", class: "network-error", evidence: {} };
  if (status >= 500) return { severity: "blocker", class: `http-${status}`, evidence: { status } };
  if (status === 404) return { severity: "high", class: "hard-404", evidence: { status } };
  if (status >= 300 && status < 400) {
    if (location && /\/signin/i.test(location)) {
      return { severity: "info", class: "auth-gated-redirect", evidence: { status, location } };
    }
    return { severity: "info", class: `redirect-${status}`, evidence: { status, location } };
  }
  if (status !== 200) return { severity: "medium", class: `http-${status}`, evidence: { status } };
  if (placeholders.length > 0) {
    return { severity: "high", class: "placeholder-content", evidence: { placeholders } };
  }
  // Client-shell: runs BEFORE missing-h1 and empty-shell checks.
  if (words < MIN_WORD_COUNT && looksLikeClientShell(body)) {
    return { severity: "info", class: "client-shell", evidence: { words } };
  }
  if (!h1) return { severity: "medium", class: "missing-h1", evidence: { title } };
  if (!title) return { severity: "medium", class: "missing-title", evidence: { h1 } };
  if (words < MIN_WORD_COUNT) {
    return { severity: "medium", class: "empty-shell", evidence: { words } };
  }
  return { severity: "ok", class: "ok", evidence: {} };
}

// ─── Route loading ───────────────────────────────────────────────────

/**
 * Load routes from explicit input, or fall back to
 * `.forge/audits/routes.json`. Returns `string[]` of path segments
 * (e.g., `["/", "/about", "/campaigns/:id"]`).
 */
export function loadRoutes({ routes, projectDir, settings }) {
  // Explicit routes take priority
  if (Array.isArray(routes) && routes.length > 0) return routes;

  // Fallback: .forge/audits/routes.json
  const routesFile = settings.routesPath
    ? pathResolve(projectDir, settings.routesPath)
    : pathResolve(projectDir, ".forge", "audits", "routes.json");

  if (existsSync(routesFile)) {
    try {
      const data = JSON.parse(readFileSync(routesFile, "utf-8"));
      if (Array.isArray(data.routes)) return data.routes;
      if (Array.isArray(data)) return data;
    } catch { /* malformed file — fall through */ }
  }

  return [];
}

// ─── Default fetcher ─────────────────────────────────────────────────

async function defaultFetcher(url, { userAgent, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": userAgent },
    });
    const body = res.status >= 200 && res.status < 400 ? await res.text() : "";
    const location = res.headers.get("location");
    return { ok: true, status: res.status, location, body };
  } catch (e) {
    return { ok: false, status: 0, location: null, body: "", error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Seed substitution ──────────────────────────────────────────────

/**
 * Expand parameterized routes using seed values.
 * E.g., route `/campaigns/:id` with seeds `{ id: "abc123" }`
 * → `/campaigns/abc123`.
 */
export function expandRoute(route, seeds) {
  if (!seeds || typeof seeds !== "object") return { expanded: route, seed: null };
  let expanded = route;
  let usedSeed = null;
  for (const [key, value] of Object.entries(seeds)) {
    const pattern = `:${key}`;
    if (expanded.includes(pattern)) {
      expanded = expanded.replace(pattern, String(value));
      usedSeed = usedSeed || {};
      usedSeed[key] = value;
    }
  }
  return { expanded, seed: usedSeed };
}

// ─── Main entry point ────────────────────────────────────────────────

/**
 * Run the content-audit scanner. Probes each route via HTTP and
 * classifies the response. Non-ok findings are emitted into the
 * `findings[]` array with the shared contract fields.
 *
 * @param {object} ctx
 * @param {object} [ctx.config]     — loaded tempering config
 * @param {string} ctx.projectDir   — project root
 * @param {string} ctx.runId        — current run ID
 * @param {{plan:string,slice:string}|null} [ctx.sliceRef]
 * @param {Function} [ctx.now]      — injectable clock
 * @param {object}   [ctx.env]      — process.env-shaped map
 * @param {Function} [ctx.fetcher]  — injectable HTTP fetcher for tests
 * @param {string[]} [ctx.routes]   — explicit route list (overrides file)
 * @param {object}   [ctx.seeds]    — seed values for parameterized routes
 * @returns {Promise<object>} scanner result record
 */
function createContentAuditSkippedFrame(base, now, reason) {
  return {
    ...base,
    skipped: true,
    reason,
    verdict: "skipped",
    pass: 0,
    fail: 0,
    durationMs: 0,
    findings: [],
    completedAt: new Date(now()).toISOString(),
  };
}

function resolveContentAuditSettings(scannerConfig) {
  return {
    ...CONTENT_AUDIT_DEFAULTS,
    ...(typeof scannerConfig === "object" ? scannerConfig : {}),
  };
}

function resolveContentAuditBaseUrl(settings, config, env) {
  return settings.baseUrl || (env && env.PFORGE_TEMPERING_URL) || resolveAppUrl(config, env);
}

function buildAuditUrl(baseUrl, expandedRoute) {
  return baseUrl.replace(/\/+$/, "") + (expandedRoute.startsWith("/") ? expandedRoute : `/${expandedRoute}`);
}

async function auditRoute({ route, seeds, baseUrl, fetcher, settings }) {
  const { expanded, seed } = expandRoute(route, seeds);
  const url = buildAuditUrl(baseUrl, expanded);
  const response = await fetcher(url, {
    userAgent: settings.userAgent,
    timeoutMs: settings.timeoutMs,
  });
  const body = response.body ?? "";
  const title = extractTag(body, "title");
  const h1 = extractTag(body, "h1");
  const words = wordCount(cleanBodyText(body));
  const placeholders = findPlaceholders(body);
  const verdict = classifyRoute({
    status: response.status,
    location: response.location,
    body,
    title,
    h1,
    words,
    placeholders,
  });
  return {
    verdict,
    finding: verdict.severity === "ok"
      ? null
      : {
          class: verdict.class,
          route,
          severity: verdict.severity,
          evidence: { ...verdict.evidence, url, status: response.status, title, h1, words },
          ...(seed ? { seed } : {}),
        },
  };
}

function resolveContentAuditVerdict(findings, budgetTripped) {
  if (budgetTripped) return "budget-exceeded";
  if (findings.some((finding) => finding.severity === "blocker" || finding.severity === "high")) return "fail";
  if (findings.length > 0) return "warn";
  return "pass";
}

function writeContentAuditArtifact(projectDir, runId, report) {
  const artifactDir = ensureScannerArtifactDir(projectDir, runId, "content-audit");
  if (!artifactDir) return artifactDir;
  seedArtifactsGitignore(projectDir);
  try {
    writeFileSync(
      pathResolve(artifactDir, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf-8",
    );
  } catch { /* best-effort */ }
  return artifactDir;
}

export async function runContentAudit(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    now = () => Date.now(),
    env = process.env,
    fetcher = defaultFetcher,
    routes: explicitRoutes = null,
    seeds = null,
  } = ctx || {};

  const t0 = now();
  const base = {
    scanner: "content-audit",
    sliceRef,
    startedAt: new Date(t0).toISOString(),
  };

  const scannerConfig = config.scanners?.["content-audit"];
  if (scannerConfig === false || (scannerConfig && scannerConfig.enabled === false)) {
    return createContentAuditSkippedFrame(base, now, "scanner-disabled");
  }

  const settings = resolveContentAuditSettings(scannerConfig);
  const baseUrl = resolveContentAuditBaseUrl(settings, config, env);
  if (!baseUrl) return createContentAuditSkippedFrame(base, now, "url-not-configured");
  if (looksLikeProduction(baseUrl) && !settings.allowProduction) {
    return createContentAuditSkippedFrame(base, now, "production-url-without-opt-in");
  }

  const routeList = loadRoutes({
    routes: explicitRoutes,
    projectDir: projectDir || ".",
    settings,
  });
  if (routeList.length === 0) return createContentAuditSkippedFrame(base, now, "no-routes");

  const capped = routeList.slice(0, settings.maxRoutes);
  const hardDeadline = t0 + ((config.runtimeBudgets && config.runtimeBudgets.contentAuditMaxMs) || 300000);
  const findings = [];
  let passCount = 0;
  let failCount = 0;
  let budgetTripped = false;

  for (const route of capped) {
    if (now() >= hardDeadline) {
      budgetTripped = true;
      break;
    }
    const result = await auditRoute({ route, seeds, baseUrl, fetcher, settings });
    if (!result.finding) {
      passCount++;
      continue;
    }
    failCount++;
    findings.push(result.finding);
  }

  const overallVerdict = resolveContentAuditVerdict(findings, budgetTripped);
  const durationMs = now() - t0;
  const artifactDir = writeContentAuditArtifact(projectDir, runId, {
    scanner: "content-audit",
    startedAt: base.startedAt,
    baseUrl,
    routeCount: capped.length,
    verdict: overallVerdict,
    findings,
    summary: { pass: passCount, fail: failCount },
  });

  return {
    ...base,
    verdict: overallVerdict,
    pass: passCount,
    fail: failCount,
    skipped: 0,
    findings,
    findingCount: findings.length,
    routesProbed: Math.min(capped.length, passCount + failCount),
    budgetTripped,
    durationMs,
    artifactDir,
    completedAt: new Date(now()).toISOString(),
  };
}

// ─── Default export (scanner module interface) ───────────────────────

export default {
  name: "content-audit",
  run: runContentAudit,
};
