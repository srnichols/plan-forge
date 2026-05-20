/**
 * OpenAPI 3.x contract validator (TEMPER-03 Slice 03.2).
 *
 * Validates a live API against its OpenAPI spec by:
 *   1. Parsing the spec (JSON or YAML via injected `importFn`)
 *   2. Enumerating paths × methods (GET/HEAD by default)
 *   3. Firing requests with `X-Tempering-Scan: true` header
 *   4. Checking response status against spec `responses` keys
 *   5. Shallow key+type check on JSON response bodies
 *
 * Intentionally shallow — no `$ref` resolution, no full JSON Schema
 * validation. Deep validation (e.g. via ajv) is extension territory.
 *
 * @module tempering/scanners/contract-openapi
 */
import { readFileSync } from "node:fs";

// Methods considered non-mutating (safe to fire without opt-in)
const SAFE_METHODS = new Set(["get", "head", "options"]);

/**
 * Validate a live API against an OpenAPI spec.
 *
 * @param {string} specPath    — absolute path to the spec file
 * @param {string} baseUrl     — base URL of the running API
 * @param {object} opts
 * @param {boolean} [opts.allowMutatingMethods=false]
 * @param {number}  [opts.maxOperations=200]
 * @param {number}  [opts.timeoutMs=5000]
 * @param {Function} [opts.importFn] — dynamic import for js-yaml
 * @param {Function} [opts.now]
 * @param {number}  [opts.hardDeadline] — epoch ms budget ceiling
 * @returns {Promise<{ operations: number, passed: number, failed: number, violations: Array, truncated?: boolean }>}
 */
function parseSpecFailure(reason, skipped = false) {
  return { operations: 0, passed: 0, failed: 0, violations: [], ...(skipped ? { skipped: true } : { error: true }), reason };
}

async function parseOpenApiSpec(specPath, importFn) {
  try {
    const raw = readFileSync(specPath, "utf-8");
    if (!/\.ya?ml$/i.test(specPath)) {
      return { spec: JSON.parse(raw) };
    }
    return loadYamlOpenApiSpec(raw, importFn);
  } catch (err) {
    return { error: parseSpecFailure(`parse-error: ${err.message}`) };
  }
}

async function loadYamlOpenApiSpec(raw, importFn) {
  let yaml;
  try {
    yaml = await importFn("js-yaml");
  } catch {
    return { error: parseSpecFailure("yaml-parser-not-installed", true) };
  }
  const loadFn = yaml.load || yaml.default?.load;
  if (!loadFn) {
    return { error: parseSpecFailure("yaml-parser-not-installed", true) };
  }
  try {
    return { spec: loadFn(raw) };
  } catch (err) {
    return { error: parseSpecFailure(`parse-error: ${err.message}`) };
  }
}

function enumerateOpenApiOperations(spec, allowMutatingMethods) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!shouldIncludeOpenApiOperation(method, op, allowMutatingMethods)) continue;
      operations.push({ path, method: method.toLowerCase(), op });
    }
  }
  return operations;
}

function shouldIncludeOpenApiOperation(method, op, allowMutatingMethods) {
  if (typeof op !== "object" || op === null) return false;
  return allowMutatingMethods || SAFE_METHODS.has(method.toLowerCase());
}

function capOpenApiOperations(operations, maxOperations) {
  return {
    toRun: operations.slice(0, maxOperations),
    truncated: operations.length > maxOperations,
  };
}

function buildFetchOptions(method, op, timeoutMs) {
  const headers = { "X-Tempering-Scan": "true" };
  const fetchOpts = {
    method: method.toUpperCase(),
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (!SAFE_METHODS.has(method)) {
    const body = synthesizeBody(op);
    if (body !== undefined) {
      fetchOpts.body = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
  }
  return fetchOpts;
}

function createFetchViolation(err) {
  const reason = err.name === "TimeoutError"
    ? "timeout"
    : err.cause?.code === "ECONNREFUSED" || /ECONNREFUSED/.test(err.message)
      ? "connection-refused"
      : `fetch-error: ${err.message}`;
  return { expected: null, actual: null, reason };
}

function matchResponseStatus(response, op) {
  const specResponses = op.responses || {};
  const statusStr = String(response.status);
  return {
    specResponses,
    statusStr,
    statusMatch: specResponses[statusStr] || specResponses[`${statusStr[0]}XX`] || specResponses.default,
  };
}

async function validateOpenApiOperation({ baseUrl, path, method, op, timeoutMs }) {
  const url = resolveUrl(baseUrl, path);
  let response;
  try {
    response = await fetch(url, buildFetchOptions(method, op, timeoutMs));
  } catch (err) {
    return { passed: false, violation: { path, method, ...createFetchViolation(err) } };
  }

  const statusCheck = matchResponseStatus(response, op);
  if (!statusCheck.statusMatch) {
    return {
      passed: false,
      violation: {
        path,
        method,
        expected: Object.keys(statusCheck.specResponses).join(", "),
        actual: statusCheck.statusStr,
        reason: "status-mismatch",
      },
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      passed: false,
      violation: { path, method, expected: null, actual: statusCheck.statusStr, reason: "auth-required" },
    };
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { passed: true };
  }

  const shapeResult = await checkResponseShape(response, statusCheck.statusMatch);
  if (!shapeResult) {
    return { passed: true };
  }
  return {
    passed: false,
    violation: { path, method, ...shapeResult, reason: "shape-mismatch" },
  };
}

export async function validateOpenApiSpec(specPath, baseUrl, opts = {}) {
  const {
    allowMutatingMethods = false,
    maxOperations = 200,
    timeoutMs = 5000,
    importFn = (spec) => import(spec),
    now = () => Date.now(),
    hardDeadline = Infinity,
  } = opts;

  const parsedSpec = await parseOpenApiSpec(specPath, importFn);
  if (parsedSpec.error) {
    return parsedSpec.error;
  }

  const spec = parsedSpec.spec;
  if (!spec || !spec.paths) {
    return parseSpecFailure("no-paths-in-spec");
  }

  const operations = enumerateOpenApiOperations(spec, allowMutatingMethods);
  const { toRun, truncated } = capOpenApiOperations(operations, maxOperations);
  const violations = [];
  let passed = 0;
  let failed = 0;

  for (const operation of toRun) {
    if (now() >= hardDeadline) {
      return { operations: toRun.length, passed, failed, violations, truncated, budgetExceeded: true };
    }
    const result = await validateOpenApiOperation({ baseUrl, timeoutMs, ...operation });
    if (result.passed) {
      passed++;
    } else {
      failed++;
      violations.push(result.violation);
    }
  }

  return { operations: toRun.length, passed, failed, violations, truncated };
}

/**
 * Resolve a spec path template against the base URL. Replaces
 * `{param}` placeholders with `__test__` so the URL is valid.
 */
function resolveUrl(base, path) {
  const resolved = path.replace(/\{[^}]+\}/g, "__test__");
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${b}${resolved}`;
}

/**
 * Synthesize a request body from the OpenAPI operation spec.
 * Priority: examples → example → minimal from schema → undefined.
 */
function synthesizeBody(op) {
  const rb = op.requestBody;
  if (!rb || !rb.content) return undefined;
  const jsonContent = rb.content["application/json"];
  if (!jsonContent) return undefined;

  // Spec-provided examples (highest priority)
  if (jsonContent.examples) {
    const first = Object.values(jsonContent.examples)[0];
    if (first && first.value !== undefined) return first.value;
  }
  if (jsonContent.example !== undefined) return jsonContent.example;

  // Minimal from schema
  if (jsonContent.schema) return {};
  return undefined;
}

/**
 * Shallow key+type check on a JSON response body against the spec
 * schema. Only checks top-level `required` properties. Returns a
 * violation descriptor or null if OK.
 */
async function parseResponseJson(response) {
  try {
    return { body: await response.json() };
  } catch {
    return { error: { expected: "valid JSON", actual: "parse-error", reason: "parse-error" } };
  }
}

function validateRequiredResponseKey(body, schema, key) {
  if (!(key in body)) {
    return { expected: `key "${key}"`, actual: `missing key "${key}"` };
  }
  return validateResponsePropertyType(body[key], schema.properties && schema.properties[key], key);
}

function validateResponsePropertyType(value, propSchema, key) {
  if (!propSchema || !propSchema.type) return null;
  const actualType = Array.isArray(value) ? "array" : typeof value;
  if (propSchema.type === "integer") {
    return actualType === "number" ? null : { expected: `"${key}" as integer`, actual: `"${key}" is ${actualType}` };
  }
  if (propSchema.type === actualType || (propSchema.type === "number" && actualType === "number")) {
    return null;
  }
  return { expected: `"${key}" as ${propSchema.type}`, actual: `"${key}" is ${actualType}` };
}

async function checkResponseShape(response, statusMatch) {
  const parsed = await parseResponseJson(response);
  if (parsed.error) {
    return parsed.error;
  }

  const schema = statusMatch?.content?.["application/json"]?.schema;
  if (!schema || !schema.required || !Array.isArray(schema.required)) return null;
  if (typeof parsed.body !== "object" || parsed.body === null) {
    return { expected: `object with keys: ${schema.required.join(", ")}`, actual: typeof parsed.body };
  }

  for (const key of schema.required) {
    const violation = validateRequiredResponseKey(parsed.body, schema, key);
    if (violation) return violation;
  }
  return null;
}
