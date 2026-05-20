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
function createContractSkippedFrame(base, now, reason) {
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

function resolveContractSettings(scannerConfig) {
  return {
    enabled: true,
    specPath: null,
    baseUrl: null,
    allowMutatingMethods: false,
    maxOperations: 200,
    timeoutMs: 5000,
    graphqlEndpoint: null,
    ...(typeof scannerConfig === "object" ? scannerConfig : {}),
  };
}

function resolveContractBaseUrl(settings, config, env) {
  return settings.baseUrl || (env && env.PFORGE_TEMPERING_CONTRACT_URL) || resolveAppUrl(config, env);
}

async function runContractValidator({ specPath, baseUrl, settings, importFn, now, hardDeadline }) {
  if (/\.graphql$/i.test(specPath)) {
    return validateGraphqlSchema(specPath, baseUrl, {
      graphqlEndpoint: settings.graphqlEndpoint || "/graphql",
      timeoutMs: settings.timeoutMs,
      now,
      hardDeadline,
    });
  }
  return validateOpenApiSpec(specPath, baseUrl, {
    allowMutatingMethods: settings.allowMutatingMethods,
    maxOperations: settings.maxOperations,
    timeoutMs: settings.timeoutMs,
    importFn,
    now,
    hardDeadline,
  });
}

function resolveContractVerdict(result, fail) {
  if (result.budgetExceeded) return "budget-exceeded";
  if (result.error) return "error";
  if (fail > 0) return "fail";
  if (result.skipped) return "skipped";
  return "pass";
}

function writeContractArtifact(projectDir, runId, report) {
  const artifactDir = ensureScannerArtifactDir(projectDir, runId, "contract");
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

function resolveContractContext(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    importFn = (spec) => import(spec),
    now = () => Date.now(),
    env = process.env,
  } = ctx || {};
  return { config, projectDir, runId, sliceRef, importFn, now, env };
}

function isContractDisabled(scannerConfig) {
  return scannerConfig === false || (scannerConfig && scannerConfig.enabled === false);
}

function buildContractErrorFrame(base, now, t0, err) {
  return {
    ...base,
    verdict: "error",
    error: err.message || String(err),
    pass: 0,
    fail: 0,
    durationMs: now() - t0,
    completedAt: new Date(now()).toISOString(),
  };
}

function buildContractResult({ base, now, t0, projectDir, runId, specPath, baseUrl, result }) {
  const isGraphql = /\.graphql$/i.test(specPath);
  const violations = result.violations || [];
  const pass = result.passed || 0;
  const fail = result.failed || 0;
  const verdict = resolveContractVerdict(result, fail);
  const specType = isGraphql ? "graphql" : "openapi";
  const artifactDir = writeContractArtifact(projectDir, runId, {
    scanner: "contract",
    startedAt: base.startedAt,
    specPath,
    specType,
    baseUrl,
    violations,
    verdict,
    pass,
    fail,
  });

  return {
    ...base,
    verdict,
    specPath,
    specType,
    pass,
    fail,
    skipped: 0,
    violations,
    violationCount: violations.length,
    durationMs: now() - t0,
    artifactDir,
    completedAt: new Date(now()).toISOString(),
    ...(result.truncated ? { details: { truncated: true } } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export async function runContractScan(ctx) {
  const contractCtx = resolveContractContext(ctx);
  const t0 = contractCtx.now();
  const base = {
    scanner: "contract",
    sliceRef: contractCtx.sliceRef,
    startedAt: new Date(t0).toISOString(),
  };
  const scannerConfig = contractCtx.config.scanners?.contract;
  if (isContractDisabled(scannerConfig)) {
    return createContractSkippedFrame(base, contractCtx.now, "scanner-disabled");
  }

  const settings = resolveContractSettings(scannerConfig);
  const specPath = findSpec(contractCtx.projectDir, settings.specPath);
  if (!specPath) return createContractSkippedFrame(base, contractCtx.now, "no-spec-found");

  const baseUrl = resolveContractBaseUrl(settings, contractCtx.config, contractCtx.env);
  if (!baseUrl) return createContractSkippedFrame(base, contractCtx.now, "url-not-configured");
  if (looksLikeProduction(baseUrl) && !settings.allowProduction) {
    return createContractSkippedFrame(base, contractCtx.now, "production-url-without-opt-in");
  }

  const hardDeadline = t0 + ((contractCtx.config.runtimeBudgets && contractCtx.config.runtimeBudgets.contractMaxMs) || 300000);
  try {
    const result = await runContractValidator({
      specPath,
      baseUrl,
      settings,
      importFn: contractCtx.importFn,
      now: contractCtx.now,
      hardDeadline,
    });
    return buildContractResult({
      base,
      now: contractCtx.now,
      t0,
      projectDir: contractCtx.projectDir,
      runId: contractCtx.runId,
      specPath,
      baseUrl,
      result,
    });
  } catch (err) {
    return buildContractErrorFrame(base, contractCtx.now, t0, err);
  }
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
