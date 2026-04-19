/**
 * Contract scanner tests (TEMPER-03 Slice 03.2).
 *
 * Exercises the contract scanner dispatcher + OpenAPI + GraphQL sub-validators
 * in isolation via mocked fetch + filesystem fixtures.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runContractScan } from "../tempering/scanners/contract.mjs";
import { validateOpenApiSpec } from "../tempering/scanners/contract-openapi.mjs";
import { validateGraphqlSchema, extractRootFields } from "../tempering/scanners/contract-graphql.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures", "temper", "contract");

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-contract-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeConfig(overrides = {}) {
  return {
    scanners: { contract: { enabled: true, ...overrides } },
    runtimeBudgets: { contractMaxMs: 300000 },
    "ui-playwright": { url: null },
    ...overrides._root,
  };
}

// ─── contract.mjs dispatcher (11 tests) ──────────────────────────────

describe("contract.mjs dispatcher", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("1. scanner disabled → skipped", async () => {
    const r = await runContractScan({
      config: { scanners: { contract: false } },
      projectDir: tmp,
      runId: "run-test",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });

  it("2. no spec found → skipped: no-spec-found", async () => {
    const r = await runContractScan({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmp,
      runId: "run-test",
      env: {},
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("no-spec-found");
  });

  it("3. URL not configured → skipped: url-not-configured", async () => {
    // Put a spec in place but no URL
    writeFileSync(resolve(tmp, "openapi.json"), '{"openapi":"3.0.3","paths":{}}');
    const r = await runContractScan({
      config: makeConfig(),
      projectDir: tmp,
      runId: "run-test",
      env: {},
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("url-not-configured");
  });

  it("4. production URL without opt-in → skipped", async () => {
    writeFileSync(resolve(tmp, "openapi.json"), '{"openapi":"3.0.3","paths":{}}');
    const r = await runContractScan({
      config: makeConfig({ baseUrl: "https://api.production.com" }),
      projectDir: tmp,
      runId: "run-test",
      env: {},
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("production-url-without-opt-in");
  });

  it("5. OpenAPI YAML detected at standard path", async () => {
    // Copy the fixture
    writeFileSync(
      resolve(tmp, "openapi.yaml"),
      readFileSync(resolve(FIXTURES, "openapi-valid.yaml"), "utf-8"),
    );
    const r = await runContractScan({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmp,
      runId: "run-test",
      env: {},
      importFn: (spec) => {
        if (spec === "js-yaml") return import("js-yaml");
        return import(spec);
      },
    });
    // Will fail due to ECONNREFUSED but should detect the spec
    expect(r.scanner).toBe("contract");
    expect(r.specType).toBe("openapi");
  });

  it("6. OpenAPI JSON detected at standard path", async () => {
    writeFileSync(
      resolve(tmp, "openapi.json"),
      readFileSync(resolve(FIXTURES, "openapi-invalid.json"), "utf-8"),
    );
    const r = await runContractScan({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmp,
      runId: "run-test",
      env: {},
    });
    expect(r.scanner).toBe("contract");
    expect(r.specType).toBe("openapi");
  });

  it("7. config specPath override takes priority", async () => {
    mkdirSync(resolve(tmp, "custom"), { recursive: true });
    writeFileSync(resolve(tmp, "custom", "my-api.json"), '{"openapi":"3.0.3","paths":{"/health":{"get":{"responses":{"200":{"description":"ok"}}}}}}');
    const r = await runContractScan({
      config: makeConfig({ specPath: "custom/my-api.json", baseUrl: "http://localhost:3000" }),
      projectDir: tmp,
      runId: "run-test",
      env: {},
    });
    expect(r.specPath).toBe(resolve(tmp, "custom", "my-api.json"));
  });

  it("8. budget enforcement trips mid-scan → verdict: budget-exceeded", async () => {
    writeFileSync(resolve(tmp, "openapi.json"), JSON.stringify({
      openapi: "3.0.3",
      paths: {
        "/a": { get: { responses: { "200": { description: "ok" } } } },
        "/b": { get: { responses: { "200": { description: "ok" } } } },
      },
    }));
    let callCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const r = await runContractScan({
        config: makeConfig({ baseUrl: "http://localhost:3000" }),
        projectDir: tmp,
        runId: "run-test",
        env: {},
        now: (() => { let t = 1000; return () => (t += 400000); })(), // each call jumps past budget
      });
      expect(r.verdict).toBe("budget-exceeded");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("9. dispatcher routes .yaml → OpenAPI, schema.graphql → GraphQL", async () => {
    // YAML spec
    writeFileSync(resolve(tmp, "openapi.yaml"), '');
    let r = await runContractScan({
      config: makeConfig({ specPath: "openapi.yaml", baseUrl: "http://localhost:3000" }),
      projectDir: tmp, runId: "run-test", env: {},
      importFn: () => { throw new Error("no yaml"); },
    });
    // YAML parse will fail → error or skipped
    expect(r.scanner).toBe("contract");

    // GraphQL spec
    rmSync(resolve(tmp, "openapi.yaml"));
    writeFileSync(resolve(tmp, "schema.graphql"), readFileSync(resolve(FIXTURES, "schema.graphql"), "utf-8"));
    r = await runContractScan({
      config: makeConfig({ specPath: "schema.graphql", baseUrl: "http://localhost:3000" }),
      projectDir: tmp, runId: "run-test", env: {},
    });
    expect(r.specType).toBe("graphql");
  });

  it("10. result frame has required fields", async () => {
    writeFileSync(resolve(tmp, "openapi.json"), '{"openapi":"3.0.3","paths":{}}');
    const r = await runContractScan({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmp,
      runId: "run-test",
      env: {},
    });
    expect(r).toHaveProperty("scanner", "contract");
    expect(r).toHaveProperty("verdict");
    expect(r).toHaveProperty("startedAt");
    expect(r).toHaveProperty("completedAt");
    expect(r).toHaveProperty("durationMs");
    expect(typeof r.pass).toBe("number");
    expect(typeof r.fail).toBe("number");
  });

  it("11. artifact report.json written to correct directory", async () => {
    writeFileSync(resolve(tmp, "openapi.json"), '{"openapi":"3.0.3","paths":{}}');
    const r = await runContractScan({
      config: makeConfig({ baseUrl: "http://localhost:3000" }),
      projectDir: tmp,
      runId: "run-test",
      env: {},
    });
    const reportPath = resolve(tmp, ".forge", "tempering", "artifacts", "run-test", "contract", "report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf-8"));
    expect(report.scanner).toBe("contract");
  });
});

// ─── contract-openapi.mjs (9 tests) ──────────────────────────────────

describe("contract-openapi.mjs", () => {
  let tmp;
  let origFetch;
  beforeEach(() => {
    tmp = makeTmpDir();
    origFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const specPath = () => resolve(FIXTURES, "openapi-valid.yaml");
  const jsonSpecPath = () => resolve(FIXTURES, "openapi-invalid.json");

  function mockYamlImport() {
    return async (spec) => {
      if (spec === "js-yaml") return await import("js-yaml");
      return await import(spec);
    };
  }

  it("12. valid spec + matching responses → all pass", async () => {
    // Use a JSON spec to avoid js-yaml dependency
    const spec = resolve(tmp, "valid.json");
    writeFileSync(spec, JSON.stringify({
      openapi: "3.0.3",
      paths: {
        "/pets": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: { "application/json": { schema: { type: "array" } } },
              },
            },
          },
        },
      },
    }));
    globalThis.fetch = async () => {
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const r = await validateOpenApiSpec(spec, "http://localhost:3000");
    expect(r.passed).toBeGreaterThan(0);
    expect(r.failed).toBe(0);
    expect(r.violations).toHaveLength(0);
  });

  it("13. response status mismatch → violation", async () => {
    globalThis.fetch = async () => {
      return new Response("", { status: 500 });
    };
    const r = await validateOpenApiSpec(jsonSpecPath(), "http://localhost:3000");
    expect(r.failed).toBeGreaterThan(0);
    const v = r.violations.find((v) => v.reason === "status-mismatch");
    expect(v).toBeDefined();
  });

  it("14. response shape mismatch (missing key) → violation", async () => {
    // The spec requires `items` and `total` but we return only `items`
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const r = await validateOpenApiSpec(jsonSpecPath(), "http://localhost:3000");
    expect(r.failed).toBeGreaterThan(0);
    const v = r.violations.find((v) => v.reason === "shape-mismatch");
    expect(v).toBeDefined();
  });

  it("15. unreachable endpoint → connection-refused violation", async () => {
    globalThis.fetch = async () => {
      const err = new Error("fetch failed");
      err.cause = { code: "ECONNREFUSED" };
      throw err;
    };
    const r = await validateOpenApiSpec(jsonSpecPath(), "http://localhost:3000");
    expect(r.failed).toBeGreaterThan(0);
    expect(r.violations[0].reason).toBe("connection-refused");
  });

  it("16. spec with examples → uses examples", async () => {
    // Use JSON spec so no js-yaml needed
    const spec = resolve(tmp, "with-examples.json");
    writeFileSync(spec, JSON.stringify({
      openapi: "3.0.3",
      paths: {
        "/pets": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object" },
                  examples: { default: { value: { name: "Fido" } } },
                },
              },
            },
            responses: { "201": { description: "created" } },
          },
        },
      },
    }));
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      if (opts.body) capturedBody = JSON.parse(opts.body);
      return new Response("{}", { status: 201 });
    };
    const r = await validateOpenApiSpec(spec, "http://localhost:3000", {
      allowMutatingMethods: true,
    });
    expect(capturedBody).toEqual({ name: "Fido" });
  });

  it("17. spec without examples → synthesized body", async () => {
    const noExampleSpec = resolve(tmp, "no-example.json");
    writeFileSync(noExampleSpec, JSON.stringify({
      openapi: "3.0.3",
      paths: {
        "/items": {
          post: {
            requestBody: {
              content: { "application/json": { schema: { type: "object" } } },
            },
            responses: { "201": { description: "created" } },
          },
        },
      },
    }));
    let capturedBody;
    globalThis.fetch = async (url, opts) => {
      if (opts.body) capturedBody = JSON.parse(opts.body);
      return new Response("{}", { status: 201 });
    };
    await validateOpenApiSpec(noExampleSpec, "http://localhost:3000", {
      allowMutatingMethods: true,
    });
    expect(capturedBody).toEqual({});
  });

  it("18. non-JSON response → shape check skipped, status still validated", async () => {
    globalThis.fetch = async () => {
      return new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const r = await validateOpenApiSpec(jsonSpecPath(), "http://localhost:3000");
    // Should pass (status 200 matches spec) — no shape mismatch since not JSON
    expect(r.passed).toBe(1);
    expect(r.violations.filter(v => v.reason === "shape-mismatch")).toHaveLength(0);
  });

  it("19. malformed YAML → error result (not throw)", async () => {
    // Mock js-yaml to be available but have the parse fail
    const badYaml = resolve(tmp, "bad.yaml");
    writeFileSync(badYaml, ": : invalid: [yaml");
    const fakeYaml = {
      load: (str) => { throw new Error("bad YAML"); },
    };
    const r = await validateOpenApiSpec(badYaml, "http://localhost:3000", {
      importFn: async (spec) => {
        if (spec === "js-yaml") return fakeYaml;
        return await import(spec);
      },
    });
    expect(r.error).toBe(true);
    expect(r.reason).toMatch(/parse-error/);
  });

  it("20. maxOperations cap respected + truncated: true", async () => {
    const manyPaths = {};
    for (let i = 0; i < 10; i++) manyPaths[`/p${i}`] = { get: { responses: { "200": { description: "ok" } } } };
    const spec = resolve(tmp, "many.json");
    writeFileSync(spec, JSON.stringify({ openapi: "3.0.3", paths: manyPaths }));
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    const r = await validateOpenApiSpec(spec, "http://localhost:3000", { maxOperations: 3 });
    expect(r.operations).toBe(3);
    expect(r.truncated).toBe(true);
  });
});

// ─── contract-graphql.mjs (5 tests) ──────────────────────────────────

describe("contract-graphql.mjs", () => {
  let tmp;
  let origFetch;
  beforeEach(() => {
    tmp = makeTmpDir();
    origFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  const schemaPath = () => resolve(FIXTURES, "schema.graphql");

  it("21. schema parsed, sample queries generated", () => {
    const fields = extractRootFields(
      readFileSync(schemaPath(), "utf-8"),
      "Query",
    );
    expect(fields).toContain("pets");
    expect(fields).toContain("pet");
    expect(fields).toContain("health");
  });

  it("22. introspection diff detects missing root field → violation", async () => {
    // Introspection returns only `pets` — `pet` and `health` missing
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.query.includes("__schema")) {
        return new Response(JSON.stringify({
          data: {
            __schema: {
              queryType: { name: "Query" },
              mutationType: { name: "Mutation" },
              types: [
                { name: "Query", kind: "OBJECT", fields: [{ name: "pets" }] },
                { name: "Mutation", kind: "OBJECT", fields: [{ name: "createPet" }, { name: "deletePet" }] },
              ],
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // Sample queries
      return new Response(JSON.stringify({ data: { [body.query.match(/\{\s*(\w+)/)?.[1]]: { __typename: "Pet" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const r = await validateGraphqlSchema(schemaPath(), "http://localhost:3000");
    const missingViolations = r.violations.filter(v => v.reason === "missing-from-introspection");
    expect(missingViolations.length).toBeGreaterThan(0);
  });

  it("23. query returns GraphQL errors[] → violation", async () => {
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.query.includes("__schema")) {
        return new Response(JSON.stringify({
          data: {
            __schema: {
              queryType: { name: "Query" },
              mutationType: null,
              types: [
                { name: "Query", kind: "OBJECT", fields: [{ name: "pets" }, { name: "pet" }, { name: "health" }] },
              ],
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        errors: [{ message: "Cannot query field" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const r = await validateGraphqlSchema(schemaPath(), "http://localhost:3000");
    expect(r.failed).toBeGreaterThan(0);
    expect(r.violations.some(v => v.reason === "query-error")).toBe(true);
  });

  it("24. introspection disabled (4xx) → graceful skip", async () => {
    globalThis.fetch = async () => {
      return new Response("Forbidden", { status: 403 });
    };
    const r = await validateGraphqlSchema(schemaPath(), "http://localhost:3000");
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("introspection-disabled");
  });

  it("25. no schema.graphql → error", async () => {
    const r = await validateGraphqlSchema(
      resolve(tmp, "nonexistent.graphql"),
      "http://localhost:3000",
    );
    expect(r.error).toBe(true);
    expect(r.reason).toMatch(/schema-read-error/);
  });
});
