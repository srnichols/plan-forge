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
export async function validateOpenApiSpec(specPath, baseUrl, opts = {}) {
  const {
    allowMutatingMethods = false,
    maxOperations = 200,
    timeoutMs = 5000,
    importFn = (spec) => import(spec),
    now = () => Date.now(),
    hardDeadline = Infinity,
  } = opts;

  // ── Parse spec ─────────────────────────────────────────────────
  let spec;
  try {
    const raw = readFileSync(specPath, "utf-8");
    if (/\.ya?ml$/i.test(specPath)) {
      let yaml;
      try {
        yaml = await importFn("js-yaml");
      } catch {
        return { operations: 0, passed: 0, failed: 0, violations: [], skipped: true, reason: "yaml-parser-not-installed" };
      }
      const loadFn = yaml.load || yaml.default?.load;
      if (!loadFn) {
        return { operations: 0, passed: 0, failed: 0, violations: [], skipped: true, reason: "yaml-parser-not-installed" };
      }
      spec = loadFn(raw);
    } else {
      spec = JSON.parse(raw);
    }
  } catch (err) {
    return { operations: 0, passed: 0, failed: 0, violations: [], error: true, reason: `parse-error: ${err.message}` };
  }

  if (!spec || !spec.paths) {
    return { operations: 0, passed: 0, failed: 0, violations: [], error: true, reason: "no-paths-in-spec" };
  }

  // ── Enumerate operations ───────────────────────────────────────
  const operations = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const [method, opObj] of Object.entries(pathItem)) {
      if (typeof opObj !== "object" || opObj === null) continue;
      if (!allowMutatingMethods && !SAFE_METHODS.has(method.toLowerCase())) continue;
      operations.push({ path, method: method.toLowerCase(), op: opObj });
    }
  }

  // Cap
  let truncated = false;
  const toRun = operations.slice(0, maxOperations);
  if (operations.length > maxOperations) truncated = true;

  // ── Fire requests ──────────────────────────────────────────────
  const violations = [];
  let passed = 0;
  let failed = 0;

  for (const { path, method, op } of toRun) {
    if (now() >= hardDeadline) {
      return { operations: toRun.length, passed, failed, violations, truncated, budgetExceeded: true };
    }

    const url = resolveUrl(baseUrl, path);
    const fetchOpts = {
      method: method.toUpperCase(),
      headers: { "X-Tempering-Scan": "true" },
      signal: AbortSignal.timeout(timeoutMs),
    };

    // Request body for mutating methods
    if (!SAFE_METHODS.has(method)) {
      const body = synthesizeBody(op);
      if (body !== undefined) {
        fetchOpts.body = JSON.stringify(body);
        fetchOpts.headers["Content-Type"] = "application/json";
      }
    }

    let response;
    try {
      response = await fetch(url, fetchOpts);
    } catch (err) {
      failed++;
      const reason = err.name === "TimeoutError" ? "timeout"
        : err.cause?.code === "ECONNREFUSED" || /ECONNREFUSED/.test(err.message) ? "connection-refused"
        : `fetch-error: ${err.message}`;
      violations.push({ path, method, expected: null, actual: null, reason });
      continue;
    }

    // Status check — response status must appear in spec responses keys
    const specResponses = op.responses || {};
    const statusStr = String(response.status);
    const statusMatch = specResponses[statusStr]
      || specResponses[`${statusStr[0]}XX`]
      || specResponses.default;

    if (!statusMatch) {
      failed++;
      violations.push({
        path,
        method,
        expected: Object.keys(specResponses).join(", "),
        actual: statusStr,
        reason: "status-mismatch",
      });
      continue;
    }

    // Auth detection
    if (response.status === 401 || response.status === 403) {
      failed++;
      violations.push({ path, method, expected: null, actual: statusStr, reason: "auth-required" });
      continue;
    }

    // Shape check (JSON only, shallow)
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const shapeResult = await checkResponseShape(response, statusMatch);
      if (shapeResult) {
        failed++;
        violations.push({ path, method, ...shapeResult, reason: "shape-mismatch" });
        continue;
      }
    }

    passed++;
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
async function checkResponseShape(response, statusMatch) {
  let body;
  try {
    body = await response.json();
  } catch {
    return { expected: "valid JSON", actual: "parse-error", reason: "parse-error" };
  }

  const schema = statusMatch?.content?.["application/json"]?.schema;
  if (!schema || !schema.required || !Array.isArray(schema.required)) return null;
  if (typeof body !== "object" || body === null) {
    return { expected: `object with keys: ${schema.required.join(", ")}`, actual: typeof body };
  }

  for (const key of schema.required) {
    if (!(key in body)) {
      return { expected: `key "${key}"`, actual: `missing key "${key}"` };
    }
    // Shallow type check
    const propSchema = schema.properties && schema.properties[key];
    if (propSchema && propSchema.type) {
      const actualType = Array.isArray(body[key]) ? "array" : typeof body[key];
      if (propSchema.type === "integer" && actualType !== "number") {
        return { expected: `"${key}" as integer`, actual: `"${key}" is ${actualType}` };
      }
      if (propSchema.type !== "integer" && propSchema.type !== actualType) {
        // Allow integer ↔ number coercion
        if (!(propSchema.type === "number" && actualType === "number")) {
          return { expected: `"${key}" as ${propSchema.type}`, actual: `"${key}" is ${actualType}` };
        }
      }
    }
  }
  return null;
}
