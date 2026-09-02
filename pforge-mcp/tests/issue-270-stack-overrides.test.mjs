/**
 * Issue #270 — `classifyLayer(file)` took only a filename, so no operator
 * config could reach it. The scan classified by directory-name segment and
 * nothing else.
 *
 * The report calls the dead field `stackOverrides` and describes it as a
 * documented glob->layer map. Half right: the field exists in DEFAULT_CONFIG
 * and was dead, but every preset adapter that mentions it describes it as a
 * place to override *test commands* (Gradle vs Maven, Jest vs Vitest,
 * `--no-restore`). The name reserved for layer mapping is `layerGlobs` — see
 * the original classifyLayer docstring, "TEMPER-02 will promote this to a
 * config `layerGlobs` block". So `layerGlobs` is the canonical field here and
 * `stackOverrides` is honoured for layer-valued entries only, which is what
 * the reporter had already written.
 *
 * The corpus in the report is a suffix-based Fastify/Prisma monorepo laid out
 * as `src/modules/<feature>/<feature>.service.ts`. The directory-segment
 * heuristic classifies those by their *feature folder*, so
 * `src/modules/routes/route-optimization.service.ts` came back `controller`.
 * The reported consequence was a green scan whose domain and integration
 * numbers were computed over ~10-14% of their real populations, with the
 * remainder falling into `overall` silently.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  classifyLayer,
  rollupByLayer,
  computeGaps,
  ensureTemperingDirs,
  handleScan,
} from "../tempering.mjs";

/** The reporter's configuration, verbatim — written under the older field name. */
const REPORTER_CONFIG = {
  stackOverrides: {
    "src/modules/**/*.service.ts": "domain",
    "**/*.repository.ts": "integration",
    "**/*.routes.ts": "controller",
  },
};

/** The same map under the canonical field name. */
const LAYER_GLOBS_CONFIG = { layerGlobs: { ...REPORTER_CONFIG.stackOverrides } };

describe("classifyLayer honours operator layer globs (#270)", () => {
  it("maps a suffix glob to its configured layer", () => {
    expect(classifyLayer("src/modules/billing/billing.service.ts", LAYER_GLOBS_CONFIG)).toBe("domain");
    expect(classifyLayer("src/modules/billing/billing.repository.ts", LAYER_GLOBS_CONFIG)).toBe("integration");
    expect(classifyLayer("src/modules/billing/billing.routes.ts", LAYER_GLOBS_CONFIG)).toBe("controller");
  });

  it("still reads the reporter's stackOverrides spelling", () => {
    expect(classifyLayer("src/modules/billing/billing.service.ts", REPORTER_CONFIG)).toBe("domain");
    expect(classifyLayer("src/modules/billing/billing.repository.ts", REPORTER_CONFIG)).toBe("integration");
  });

  it("leaves non-layer stackOverrides values alone, so command overrides still fit there", () => {
    const mixed = {
      stackOverrides: { unit: { cmd: ["npx", "jest"] }, "**/*.repository.ts": "integration" },
    };
    expect(classifyLayer("src/modules/billing/billing.repository.ts", mixed)).toBe("integration");
    expect(classifyLayer("src/utils/format.ts", mixed)).toBe("overall");
  });

  it("prefers layerGlobs over stackOverrides when both name the same file", () => {
    const both = {
      layerGlobs: { "**/*.service.ts": "domain" },
      stackOverrides: { "**/*.service.ts": "controller" },
    };
    expect(classifyLayer("src/modules/billing/billing.service.ts", both)).toBe("domain");
  });

  it("beats the folder-name heuristic — the exact misclassification reported", () => {
    // Both live under a feature folder literally named `routes`, which the
    // built-in heuristic reads as the controller layer.
    expect(classifyLayer("src/modules/routes/route-optimization.service.ts")).toBe("controller");
    expect(classifyLayer("src/modules/routes/routes.repository.ts")).toBe("controller");

    expect(classifyLayer("src/modules/routes/route-optimization.service.ts", LAYER_GLOBS_CONFIG)).toBe("domain");
    expect(classifyLayer("src/modules/routes/routes.repository.ts", LAYER_GLOBS_CONFIG)).toBe("integration");
  });

  it("matches a `**/` glob against a file with no leading directory", () => {
    expect(classifyLayer("orders.repository.ts", LAYER_GLOBS_CONFIG)).toBe("integration");
  });

  it("falls back to the heuristic when no override matches", () => {
    expect(classifyLayer("src/controllers/user.ts", LAYER_GLOBS_CONFIG)).toBe("controller");
    expect(classifyLayer("src/utils/format.ts", LAYER_GLOBS_CONFIG)).toBe("overall");
  });

  it("ignores overrides that name a layer outside the known set", () => {
    const bad = { layerGlobs: { "src/**/*.ts": "presentation" } };
    expect(classifyLayer("src/services/a.ts", bad)).toBe("domain");
  });

  it("survives a malformed glob without throwing", () => {
    const bad = { layerGlobs: { "src/[unclosed": "domain" } };
    expect(() => classifyLayer("src/services/a.ts", bad)).not.toThrow();
    expect(classifyLayer("src/services/a.ts", bad)).toBe("domain");
  });

  it("is unchanged when no config is supplied", () => {
    expect(classifyLayer("src/services/auth.ts")).toBe("domain");
    expect(classifyLayer("src/services/auth.ts", {})).toBe("domain");
    expect(classifyLayer("src/services/auth.ts", null)).toBe("domain");
  });

  it("is case-insensitive and normalises Windows separators in overrides", () => {
    expect(classifyLayer("SRC\\modules\\Billing\\Billing.Service.ts", LAYER_GLOBS_CONFIG)).toBe("domain");
  });
});

describe("rollupByLayer threads config through (#270)", () => {
  const records = [
    { file: "src/modules/routes/route-optimization.service.ts", linesTotal: 100, linesHit: 50 },
    { file: "src/modules/routes/routes.repository.ts", linesTotal: 100, linesHit: 90 },
    { file: "src/modules/routes/routes.routes.ts", linesTotal: 100, linesHit: 60 },
  ];

  it("without config, the whole feature folder lands in controller", () => {
    const rollup = rollupByLayer(records);
    expect(rollup.controller.files).toBe(3);
    expect(rollup.domain.files).toBe(0);
    expect(rollup.integration.files).toBe(0);
  });

  it("with config, each file lands in its configured layer", () => {
    const rollup = rollupByLayer(records, LAYER_GLOBS_CONFIG);
    expect(rollup.domain.files).toBe(1);
    expect(rollup.domain.percent).toBe(50);
    expect(rollup.integration.files).toBe(1);
    expect(rollup.integration.percent).toBe(90);
    expect(rollup.controller.files).toBe(1);
    expect(rollup.controller.percent).toBe(60);
  });

  it("counts files no layer claimed, so a thin layer cannot read as measured", () => {
    const rollup = rollupByLayer([
      { file: "src/services/a.ts", linesTotal: 10, linesHit: 10 },
      { file: "src/utils/format.ts", linesTotal: 90, linesHit: 20 },
      { file: "index.ts", linesTotal: 10, linesHit: 1 },
    ]);
    expect(rollup.unclassified.files).toBe(2);
    expect(rollup.unclassified.total).toBe(100);
    expect(rollup.domain.files).toBe(1);
    // overall still covers everything, classified or not
    expect(rollup.overall.total).toBe(110);
  });
});

describe("computeGaps threads config through (#270)", () => {
  it("attributes the worst-offender file list using the configured layer", () => {
    const records = [
      { file: "src/modules/routes/route-optimization.service.ts", linesTotal: 100, linesHit: 50 },
      { file: "src/modules/routes/routes.repository.ts", linesTotal: 100, linesHit: 95 },
    ];
    const rollup = rollupByLayer(records, LAYER_GLOBS_CONFIG);
    const gaps = computeGaps(rollup, { domain: 90, integration: 80 }, records, LAYER_GLOBS_CONFIG);

    const domainGap = gaps.find((g) => g.layer === "domain");
    expect(domainGap).toBeDefined();
    expect(domainGap.actual).toBe(50);
    expect(domainGap.files.map((f) => f.file)).toEqual([
      "src/modules/routes/route-optimization.service.ts",
    ]);
    // integration is at 95 against a minimum of 80 — no gap
    expect(gaps.find((g) => g.layer === "integration")).toBeUndefined();
  });

  it("reports a configured minimum whose layer classified nothing", () => {
    const records = [{ file: "src/utils/format.ts", linesTotal: 100, linesHit: 20 }];
    const rollup = rollupByLayer(records);
    const gaps = computeGaps(rollup, { domain: 90, overall: 80 }, records);

    const domainGap = gaps.find((g) => g.layer === "domain");
    expect(domainGap, "a minimum over zero classified files must not pass silently").toBeDefined();
    expect(domainGap.unclassified).toBe(true);
    expect(domainGap.actual).toBeNull();
  });

  it("stays quiet when a layer is simply absent from a small project", () => {
    // No stray files: `src/services/a.ts` is the whole project, so controller
    // and integration are genuinely not present rather than misclassified.
    // You cannot fail a minimum for code you do not have.
    const records = [{ file: "src/services/a.ts", linesTotal: 100, linesHit: 95 }];
    const rollup = rollupByLayer(records);
    const gaps = computeGaps(rollup, { domain: 90, integration: 80, controller: 60, overall: 80 }, records);
    expect(gaps).toEqual([]);
  });

  it("does not report unclassified when the layer has files", () => {
    const records = [{ file: "src/services/a.ts", linesTotal: 100, linesHit: 95 }];
    const rollup = rollupByLayer(records);
    const gaps = computeGaps(rollup, { domain: 90 }, records);
    expect(gaps).toEqual([]);
  });
});

// ─── handleScan end-to-end: the reporter's repo shape ─────────────────

const created = [];
afterEach(() => {
  while (created.length) {
    try { rmSync(created.pop(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** A suffix-based Fastify/Prisma layout: src/modules/<feature>/<feature>.<role>.ts */
function makeSuffixProject(layerGlobs) {
  const dir = resolve(tmpdir(), `temper-270-${randomUUID()}`);
  mkdirSync(resolve(dir, "coverage"), { recursive: true });
  created.push(dir);
  writeFileSync(resolve(dir, "package.json"), "{}", "utf-8");
  writeFileSync(
    resolve(dir, "coverage", "lcov.info"),
    [
      "SF:src/modules/routes/route-optimization.service.ts\nLF:100\nLH:50\nend_of_record",
      "SF:src/modules/billing/billing.service.ts\nLF:100\nLH:60\nend_of_record",
      "SF:src/modules/routes/routes.repository.ts\nLF:100\nLH:95\nend_of_record",
      "SF:src/modules/billing/billing.routes.ts\nLF:100\nLH:80\nend_of_record",
      "",
    ].join("\n"),
    "utf-8",
  );
  ensureTemperingDirs(dir);
  if (layerGlobs) {
    writeFileSync(
      resolve(dir, ".forge", "tempering", "config.json"),
      JSON.stringify({ coverageMinima: { domain: 90, integration: 80, controller: 60, overall: 80 }, layerGlobs }, null, 2),
      "utf-8",
    );
  }
  return dir;
}

describe("handleScan reads layer globs from config.json (#270)", () => {
  const hub = { broadcast: () => {} };

  it("without overrides, not one file is attributed correctly", () => {
    const result = handleScan({ projectDir: makeSuffixProject(null), hub });
    expect(result.ok).toBe(true);
    // Measured, not assumed. The two files under the feature folder named
    // `routes` are BOTH read as controller — including the .service.ts and the
    // .repository.ts. The two under `billing` match no directory rule at all,
    // so a genuine controller (billing.routes.ts) falls out of the layer table
    // entirely. domain and integration are gated at 90 and 80 over zero files.
    expect(result.coverage.controller.files).toBe(2);
    expect(result.coverage.domain.files).toBe(0);
    expect(result.coverage.integration.files).toBe(0);
    expect(result.coverage.unclassified.files).toBe(2);
  });

  it("with overrides, each file is attributed to its configured layer", () => {
    const dir = makeSuffixProject({
      "src/modules/**/*.service.ts": "domain",
      "**/*.repository.ts": "integration",
      "**/*.routes.ts": "controller",
    });
    const result = handleScan({ projectDir: dir, hub });
    expect(result.ok).toBe(true);
    expect(result.coverage.domain.files).toBe(2);
    expect(result.coverage.domain.percent).toBe(55);
    expect(result.coverage.integration.files).toBe(1);
    expect(result.coverage.integration.percent).toBe(95);
    expect(result.coverage.controller.files).toBe(1);
    expect(result.coverage.controller.percent).toBe(80);
    expect(result.coverage.unclassified.files).toBe(0);
  });

  it("will not report green when a gated layer measured nothing", () => {
    const dir = makeSuffixProject(null);
    // Only unclassifiable files, but the default minima still gate every layer.
    writeFileSync(
      resolve(dir, "coverage", "lcov.info"),
      "SF:src/modules/billing/billing.helper.ts\nLF:100\nLH:99\nend_of_record\n",
      "utf-8",
    );
    const result = handleScan({ projectDir: dir, hub });
    expect(result.status).toBe("amber");
    expect(result.reason).toMatch(/layerGlobs/);
    const unmeasured = result.coverageVsMinima.filter((g) => g.unclassified);
    expect(unmeasured.map((g) => g.layer).sort()).toEqual(["controller", "domain", "integration"]);
  });
});
