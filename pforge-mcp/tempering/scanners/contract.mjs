/**
 * Contract scanner dispatcher (TEMPER-03 Slice 03.2).
 *
 * Cross-stack scanner — validates live API responses against OpenAPI
 * or GraphQL specs. Loaded lazily by runner.mjs so missing optional
 * dependencies (js-yaml) don't fail the unit+integration path.
 *
 * Follows the same result contract as ui-playwright.mjs:
 *   { scanner, startedAt, completedAt, verdict, pass, fail, skipped,
 *     durationMs, violations?, reason?, details? }
 *
 * Spec auto-detection order:
 *   config.scanners.contract.specPath →
 *   openapi.yaml → openapi.json →
 *   docs/api/openapi.yaml → docs/api/openapi.json →
 *   schema.graphql → docs/api/schema.graphql
 *
 * @module tempering/scanners/contract
 */
import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { writeFileSync } from "node:fs";
import { ensureScannerArtifactDir, seedArtifactsGitignore } from "../artifacts.mjs";
import { looksLikeProduction, resolveAppUrl } from "./ui-playwright.mjs";
import { validateOpenApiSpec } from "./contract-openapi.mjs";
import { validateGraphqlSchema } from "./contract-graphql.mjs";

// ─── Spec auto-detection paths ────────────────────────────────────────

const SPEC_SEARCH_PATHS = [
  "openapi.yaml",
  "openapi.yml",
  "openapi.json",
  "docs/api/openapi.yaml",
  "docs/api/openapi.yml",
  "docs/api/openapi.json",
  "schema.graphql",
  "docs/api/schema.graphql",
];

/**
 * Run the contract scanner. Entry point called by runner.mjs.
 *
 * @param {object} ctx
 * @param {object} ctx.config         — loaded tempering config
 * @param {string} ctx.projectDir     — project root
 * @param {string} ctx.runId          — current run ID
 * @param {{plan:string,slice:string}|null} [ctx.sliceRef]
 * @param {Function} [ctx.importFn]   — for js-yaml injection
 * @param {Function} [ctx.now]
 * @param {object}   [ctx.env]        — process.env-shaped map
 * @returns {Promise<object>} scanner result record
 */
export async function runContractScan(ctx) {
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
    scanner: "contract",
    sliceRef,
    startedAt: new Date(t0).toISOString(),
  };
  const skippedFrame = (reason) => ({
    ...base,
    skipped: true,
    reason,
    verdict: "skipped",
    pass: 0,
    fail: 0,
    durationMs: 0,
    completedAt: new Date(now()).toISOString(),
  });

  // Scanner disabled
  const scannerConfig = config.scanners?.contract;
  if (scannerConfig === false || (scannerConfig && scannerConfig.enabled === false)) {
    return skippedFrame("scanner-disabled");
  }

  // Merge settings with defaults
  const settings = {
    enabled: true,
    specPath: null,
    baseUrl: null,
    allowMutatingMethods: false,
    maxOperations: 200,
    timeoutMs: 5000,
    graphqlEndpoint: null,
    ...(typeof scannerConfig === "object" ? scannerConfig : {}),
  };

  // Resolve spec path
  const specPath = findSpec(projectDir, settings.specPath);
  if (!specPath) return skippedFrame("no-spec-found");

  // Resolve base URL
  const baseUrl = settings.baseUrl
    || (env && env.PFORGE_TEMPERING_CONTRACT_URL)
    || resolveAppUrl(config, env);
  if (!baseUrl) return skippedFrame("url-not-configured");

  // Production guard
  if (looksLikeProduction(baseUrl) && !settings.allowProduction) {
    return skippedFrame("production-url-without-opt-in");
  }

  // Budget
  const budgetMs = (config.runtimeBudgets && config.runtimeBudgets.contractMaxMs) || 300000;
  const hardDeadline = t0 + budgetMs;

  // ── Dispatch to sub-validator ──────────────────────────────────
  const isGraphql = /\.graphql$/i.test(specPath);
  let result;
  try {
    if (isGraphql) {
      result = await validateGraphqlSchema(specPath, baseUrl, {
        graphqlEndpoint: settings.graphqlEndpoint || "/graphql",
        timeoutMs: settings.timeoutMs,
        now,
        hardDeadline,
      });
    } else {
      result = await validateOpenApiSpec(specPath, baseUrl, {
        allowMutatingMethods: settings.allowMutatingMethods,
        maxOperations: settings.maxOperations,
        timeoutMs: settings.timeoutMs,
        importFn,
        now,
        hardDeadline,
      });
    }
  } catch (err) {
    const durationMs = now() - t0;
    return {
      ...base,
      verdict: "error",
      error: err.message || String(err),
      pass: 0,
      fail: 0,
      durationMs,
      completedAt: new Date(now()).toISOString(),
    };
  }

  // ── Build result frame ─────────────────────────────────────────
  const violations = result.violations || [];
  const pass = result.passed || 0;
  const fail = result.failed || 0;

  let verdict;
  if (result.budgetExceeded) verdict = "budget-exceeded";
  else if (result.error) verdict = "error";
  else if (fail > 0) verdict = "fail";
  else if (result.skipped) verdict = "skipped";
  else verdict = "pass";

  const durationMs = now() - t0;

  // Write artifact
  const artifactDir = ensureScannerArtifactDir(projectDir, runId, "contract");
  if (artifactDir) {
    seedArtifactsGitignore(projectDir);
    try {
      writeFileSync(
        pathResolve(artifactDir, "report.json"),
        JSON.stringify({
          scanner: "contract",
          startedAt: base.startedAt,
          specPath,
          specType: isGraphql ? "graphql" : "openapi",
          baseUrl,
          violations,
          verdict,
          pass,
          fail,
        }, null, 2) + "\n",
        "utf-8",
      );
    } catch { /* best-effort */ }
  }

  return {
    ...base,
    verdict,
    specPath,
    specType: isGraphql ? "graphql" : "openapi",
    pass,
    fail,
    skipped: 0,
    violations,
    violationCount: violations.length,
    durationMs,
    artifactDir,
    completedAt: new Date(now()).toISOString(),
    ...(result.truncated ? { details: { truncated: true } } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

/**
 * Find the spec file — config override first, then auto-detection.
 */
function findSpec(projectDir, configSpecPath) {
  if (configSpecPath) {
    const abs = pathResolve(projectDir, configSpecPath);
    return existsSync(abs) ? abs : null;
  }
  for (const rel of SPEC_SEARCH_PATHS) {
    const abs = pathResolve(projectDir, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}
