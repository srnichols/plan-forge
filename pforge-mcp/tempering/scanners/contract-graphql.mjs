/**
 * GraphQL schema contract validator (TEMPER-03 Slice 03.2).
 *
 * Validates a live GraphQL API against a local `schema.graphql` by:
 *   1. Regex-parsing root Query/Mutation field names from the file
 *   2. Fetching the introspection query from the endpoint
 *   3. Diffing local fields vs introspected fields
 *   4. Firing sample `{ <field> { __typename } }` queries
 *
 * No `graphql-js` dependency — uses simple regex extraction.
 * Introspection disabled → graceful skip (not a failure).
 *
 * @module tempering/scanners/contract-graphql
 */
import { readFileSync } from "node:fs";

const INTROSPECTION_QUERY = '{ __schema { queryType { name } mutationType { name } types { name kind fields { name } } } }';

/**
 * Validate a live GraphQL API against a local schema file.
 *
 * @param {string} schemaPath   — absolute path to schema.graphql
 * @param {string} baseUrl      — base URL of the API server
 * @param {object} opts
 * @param {string} [opts.graphqlEndpoint] — path override (default: /graphql)
 * @param {number} [opts.timeoutMs=5000]
 * @param {number} [opts.maxQueries=50]
 * @param {Function} [opts.now]
 * @param {number} [opts.hardDeadline]
 * @returns {Promise<{ queries: number, passed: number, failed: number, violations: Array }>}
 */
function graphqlResult(reason, extra = {}) {
  return { queries: 0, passed: 0, failed: 0, violations: [], ...extra, reason };
}

function readSchemaText(schemaPath) {
  try {
    return { ok: true, schemaText: readFileSync(schemaPath, "utf-8") };
  } catch (err) {
    return { ok: false, result: graphqlResult(`schema-read-error: ${err.message}`, { error: true }) };
  }
}

async function fetchIntrospectionData(endpoint, timeoutMs) {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tempering-Scan": "true",
      },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resp.status >= 400) {
      return { ok: false, result: graphqlResult("introspection-disabled", { skipped: true }) };
    }
    const json = await resp.json();
    if (json.errors && json.errors.length > 0 && !json.data) {
      return { ok: false, result: graphqlResult("introspection-disabled", { skipped: true }) };
    }
    return { ok: true, data: json.data };
  } catch (err) {
    const reason = /ECONNREFUSED/.test(err.message) ? "connection-refused" : `introspection-error: ${err.message}`;
    return { ok: false, result: graphqlResult(reason, { error: true }) };
  }
}

function pushMissingRootFieldViolations(violations, fields, rootType, introspected) {
  for (const field of fields) {
    if (introspected.has(field)) continue;
    violations.push({
      field,
      rootType,
      reason: "missing-from-introspection",
      expected: `${rootType}.${field} in introspection`,
      actual: "not found",
    });
  }
}

async function runGraphqlQueryProbe(endpoint, field, timeoutMs) {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tempering-Scan": "true",
      },
      body: JSON.stringify({ query: `{ ${field} { __typename } }` }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await resp.json();
    if (json.errors && json.errors.length > 0) {
      return {
        ok: false,
        violation: {
          field,
          rootType: "Query",
          reason: "query-error",
          expected: `data.${field} without errors`,
          actual: json.errors[0].message || "GraphQL error",
        },
      };
    }
    if (json.data && field in json.data) return { ok: true };
    return {
      ok: false,
      violation: {
        field,
        rootType: "Query",
        reason: "missing-data-field",
        expected: `data.${field}`,
        actual: "field missing from response",
      },
    };
  } catch (err) {
    return {
      ok: false,
      violation: {
        field,
        rootType: "Query",
        reason: /ECONNREFUSED/.test(err.message) ? "connection-refused" : "fetch-error",
        expected: null,
        actual: err.message,
      },
    };
  }
}

export async function validateGraphqlSchema(schemaPath, baseUrl, opts = {}) {
  const {
    graphqlEndpoint = "/graphql",
    timeoutMs = 5000,
    maxQueries = 50,
    now = () => Date.now(),
    hardDeadline = Infinity,
  } = opts;

  const schemaRead = readSchemaText(schemaPath);
  if (!schemaRead.ok) return schemaRead.result;

  const localQueryFields = extractRootFields(schemaRead.schemaText, "Query");
  const localMutationFields = extractRootFields(schemaRead.schemaText, "Mutation");
  if (localQueryFields.length + localMutationFields.length === 0) {
    return graphqlResult("no-root-fields-found", { skipped: true });
  }

  const endpoint = resolveEndpoint(baseUrl, graphqlEndpoint);
  const introspection = await fetchIntrospectionData(endpoint, timeoutMs);
  if (!introspection.ok) return introspection.result;

  const violations = [];
  const introspectedFields = extractIntrospectedRootFields(introspection.data);
  pushMissingRootFieldViolations(violations, localQueryFields, "Query", introspectedFields.query);
  pushMissingRootFieldViolations(violations, localMutationFields, "Mutation", introspectedFields.mutation);

  const queryFields = localQueryFields.slice(0, maxQueries);
  let passed = 0;
  let failed = 0;

  for (const field of queryFields) {
    if (now() >= hardDeadline) {
      return { queries: queryFields.length, passed, failed, violations, budgetExceeded: true };
    }
    const probe = await runGraphqlQueryProbe(endpoint, field, timeoutMs);
    if (probe.ok) {
      passed++;
      continue;
    }
    failed++;
    violations.push(probe.violation);
  }

  return { queries: queryFields.length, passed, failed, violations };
}

/**
 * Extract root field names from a schema.graphql type block using regex.
 * Handles `type Query { ... }` and `extend type Query { ... }`.
 */
export function extractRootFields(schemaText, typeName) {
  const fields = new Set();
  // Match `type <typeName> {` or `extend type <typeName> {` blocks
  const blockRegex = new RegExp(
    `(?:extend\\s+)?type\\s+${typeName}\\s*\\{([^}]*)\\}`,
    "gs",
  );
  let match;
  while ((match = blockRegex.exec(schemaText)) !== null) {
    const body = match[1];
    // Each field line: `fieldName(args): Type`
    const fieldRegex = /^\s*(\w+)\s*[\(:{]/gm;
    let fm;
    while ((fm = fieldRegex.exec(body)) !== null) {
      fields.add(fm[1]);
    }
  }
  return [...fields];
}

/**
 * Extract root field names from introspection data.
 */
function extractIntrospectedRootFields(data) {
  const result = { query: new Set(), mutation: new Set() };
  if (!data || !data.__schema) return result;

  const queryTypeName = data.__schema.queryType?.name || "Query";
  const mutationTypeName = data.__schema.mutationType?.name || "Mutation";

  for (const type of (data.__schema.types || [])) {
    if (type.name === queryTypeName && type.fields) {
      for (const f of type.fields) result.query.add(f.name);
    }
    if (type.name === mutationTypeName && type.fields) {
      for (const f of type.fields) result.mutation.add(f.name);
    }
  }
  return result;
}

function resolveEndpoint(baseUrl, path) {
  const b = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}
