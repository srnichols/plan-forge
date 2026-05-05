/**
 * Tests for pforge-mcp/github-metrics.mjs (Phase GITHUB-D Slice 1).
 *
 * Covers:
 *   1. Successful pull — gh api mocked with fixture → records normalized correctly
 *   2. 403 auth failure → MetricsAuthError with copilot:read hint
 *   3. Empty response → [] with no error
 *   4. Idempotent writes — re-running same window skips existing dates
 *   5. loadMetrics — merged + sorted time series across multiple JSONL files
 *
 * No real Copilot Metrics API calls are made; `gh` is intercepted by createMockGh.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  pullMetrics,
  writeMetrics,
  loadMetrics,
  parseDateArg,
  MetricsAuthError,
  MetricsNotFoundError,
  MetricsError,
} from "../github-metrics.mjs";

import { createMockGh } from "./helpers/mock-gh.mjs";

// ─── Fixture loading ─────────────────────────────────────────────────────────

const __dir = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dir, "fixtures", "github-metrics");

const SAMPLE_30D = JSON.parse(readFileSync(join(FIXTURES, "sample-30d.json"), "utf-8"));
const EMPTY_ORG = JSON.parse(readFileSync(join(FIXTURES, "empty-org.json"), "utf-8"));
const AUTH_FAILURE = JSON.parse(readFileSync(join(FIXTURES, "auth-failure.json"), "utf-8"));

// ─── Suite-level tmpdir ──────────────────────────────────────────────────────

let SUITE_TMP;

beforeAll(() => {
  SUITE_TMP = resolve(tmpdir(), `pf-github-metrics-${randomUUID()}`);
  mkdirSync(SUITE_TMP, { recursive: true });
});

afterAll(() => {
  if (SUITE_TMP) rmSync(SUITE_TMP, { recursive: true, force: true });
});

// ─── parseDateArg ────────────────────────────────────────────────────────────

describe("parseDateArg", () => {
  it("parses Nd shorthand", () => {
    const result = parseDateArg("7d");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const diff = Math.round((Date.now() - new Date(result).getTime()) / 86400000);
    expect(diff).toBeCloseTo(7, 0);
  });

  it("passes ISO date through unchanged", () => {
    expect(parseDateArg("2024-11-01")).toBe("2024-11-01");
  });

  it("truncates long ISO strings to YYYY-MM-DD", () => {
    expect(parseDateArg("2024-11-01T12:00:00Z")).toBe("2024-11-01");
  });

  it("accepts Date objects", () => {
    expect(parseDateArg(new Date("2024-11-01"))).toBe("2024-11-01");
  });

  it("returns null for falsy input", () => {
    expect(parseDateArg(null)).toBeNull();
    expect(parseDateArg("")).toBeNull();
  });
});

// ─── pullMetrics — successful pull ───────────────────────────────────────────

describe("pullMetrics — successful pull", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      {
        match: ["api"],
        stdout: JSON.stringify(SAMPLE_30D),
        exit: 0,
      },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("returns one normalized record per fixture day", () => {
    const records = pullMetrics({ org: "sample-org", since: "30d", env: mock.env });
    expect(records).toHaveLength(SAMPLE_30D.length);
  });

  it("each record has the required shape", () => {
    const records = pullMetrics({ org: "sample-org", since: "30d", env: mock.env });
    for (const rec of records) {
      expect(rec.schema).toBe("1.0");
      expect(rec.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rec.org).toBe("sample-org");
      expect(typeof rec.totalActiveUsers).toBe("number");
      expect(typeof rec.totalEngagedUsers).toBe("number");
      expect(rec.codeCompletions).toBeDefined();
      expect(typeof rec.codeCompletions.totalSuggestions).toBe("number");
      expect(typeof rec.codeCompletions.totalAcceptances).toBe("number");
      expect(typeof rec.codeCompletions.acceptanceRate).toBe("number");
      expect(Array.isArray(rec.codeCompletions.languages)).toBe(true);
      expect(typeof rec.ideChatEngagedUsers).toBe("number");
      expect(typeof rec.dotcomChatEngagedUsers).toBe("number");
      expect(typeof rec.prEngagedUsers).toBe("number");
    }
  });

  it("normalizes language-level metrics correctly", () => {
    const records = pullMetrics({ org: "sample-org", since: "5d", env: mock.env });
    const day1 = records.find((r) => r.date === "2024-11-01");
    expect(day1).toBeDefined();

    const python = day1.codeCompletions.languages.find((l) => l.name === "python");
    expect(python).toBeDefined();
    expect(python.suggestions).toBe(249);
    expect(python.acceptances).toBe(123);
    expect(python.linesSuggested).toBe(225);
    expect(python.linesAccepted).toBe(135);
  });

  it("calculates acceptance rate from aggregated language totals", () => {
    const records = pullMetrics({ org: "sample-org", since: "5d", env: mock.env });
    const day1 = records.find((r) => r.date === "2024-11-01");
    const { totalSuggestions, totalAcceptances, acceptanceRate } = day1.codeCompletions;
    // python(249) + javascript(316) = 565 suggestions; 123+161 = 284 acceptances
    expect(totalSuggestions).toBe(565);
    expect(totalAcceptances).toBe(284);
    expect(acceptanceRate).toBeCloseTo(284 / 565, 3);
  });

  it("returns records sorted ascending by date", () => {
    const records = pullMetrics({ org: "sample-org", since: "30d", env: mock.env });
    const dates = records.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});

// ─── pullMetrics — 403 auth failure ─────────────────────────────────────────

describe("pullMetrics — 403 auth failure", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      {
        match: ["api"],
        stdout: JSON.stringify(AUTH_FAILURE),
        exit: 1,
      },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("throws MetricsAuthError", () => {
    expect(() => pullMetrics({ org: "my-org", env: mock.env })).toThrow(MetricsAuthError);
  });

  it("error message mentions copilot:read scope", () => {
    expect(() => pullMetrics({ org: "my-org", env: mock.env })).toThrow(/copilot:read/);
  });

  it("error message includes gh auth refresh hint", () => {
    expect(() => pullMetrics({ org: "my-org", env: mock.env })).toThrow(/gh auth refresh/);
  });
});

// ─── pullMetrics — 404 org not found ─────────────────────────────────────────

describe("pullMetrics — 404 org not found", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      {
        match: ["api"],
        stdout: JSON.stringify({ message: "Not Found", status: "404" }),
        exit: 1,
      },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("throws MetricsNotFoundError", () => {
    expect(() => pullMetrics({ org: "unknown-org", env: mock.env })).toThrow(MetricsNotFoundError);
  });

  it("error message includes org name", () => {
    expect(() => pullMetrics({ org: "unknown-org", env: mock.env })).toThrow(/unknown-org/);
  });
});

// ─── pullMetrics — empty response ────────────────────────────────────────────

describe("pullMetrics — empty response (org has no Copilot data)", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      {
        match: ["api"],
        stdout: JSON.stringify(EMPTY_ORG),
        exit: 0,
      },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("returns an empty array without throwing", () => {
    expect(() => pullMetrics({ org: "empty-org", env: mock.env })).not.toThrow();
    const records = pullMetrics({ org: "empty-org", env: mock.env });
    expect(records).toHaveLength(0);
  });
});

// ─── pullMetrics — org argument required ─────────────────────────────────────

describe("pullMetrics — argument validation", () => {
  it("throws MetricsError when org is omitted", () => {
    expect(() => pullMetrics({})).toThrow(MetricsError);
    expect(() => pullMetrics({})).toThrow(/org is required/);
  });
});

// ─── writeMetrics — idempotent writes ────────────────────────────────────────

describe("writeMetrics — idempotent writes", () => {
  let storeDir;

  beforeEach(() => {
    storeDir = join(SUITE_TMP, `store-${randomUUID()}`);
  });

  it("writes one JSONL file per date", () => {
    const records = pullMetricsFromFixture("write-org");
    const { written, skipped } = writeMetrics(records, { storeDir });
    expect(written).toHaveLength(SAMPLE_30D.length);
    expect(skipped).toHaveLength(0);
  });

  it("skips dates that already exist on a second call", () => {
    const records = pullMetricsFromFixture("idempotent-org");
    writeMetrics(records, { storeDir });

    const result2 = writeMetrics(records, { storeDir });
    expect(result2.written).toHaveLength(0);
    expect(result2.skipped).toHaveLength(SAMPLE_30D.length);
  });

  it("does not alter existing file contents on a second call", () => {
    const records = pullMetricsFromFixture("stable-org");
    writeMetrics(records, { storeDir });

    const filePath = join(storeDir, "stable-org", `${SAMPLE_30D[0].date}.jsonl`);
    const before = readFileSync(filePath, "utf-8");

    writeMetrics(records, { storeDir });

    const after = readFileSync(filePath, "utf-8");
    expect(after).toBe(before);
  });

  it("correctly overlaps with a partial existing window", () => {
    const records = pullMetricsFromFixture("partial-org");
    const [first, ...rest] = records;

    writeMetrics([first], { storeDir });
    const { written, skipped } = writeMetrics(records, { storeDir });

    expect(skipped).toContain(first.date);
    expect(written).toHaveLength(rest.length);
  });
});

// ─── loadMetrics — merged sorted time series ─────────────────────────────────

describe("loadMetrics — merged sorted time series", () => {
  let storeDir;

  beforeAll(() => {
    storeDir = join(SUITE_TMP, `load-store-${randomUUID()}`);
    writeMetrics(pullMetricsFromFixture("load-org"), { storeDir });
  });

  it("returns all records when no date range given", () => {
    const records = loadMetrics({ storeDir, org: "load-org" });
    expect(records).toHaveLength(SAMPLE_30D.length);
  });

  it("returns records sorted ascending by date", () => {
    const records = loadMetrics({ storeDir, org: "load-org" });
    const dates = records.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("filters correctly by since date (inclusive)", () => {
    const cutoff = SAMPLE_30D[2].date;
    const records = loadMetrics({ storeDir, org: "load-org", since: cutoff });
    for (const r of records) {
      expect(r.date >= cutoff).toBe(true);
    }
    expect(records.length).toBe(SAMPLE_30D.filter((d) => d.date >= cutoff).length);
  });

  it("filters correctly by until date (inclusive)", () => {
    const cutoff = SAMPLE_30D[2].date;
    const records = loadMetrics({ storeDir, org: "load-org", until: cutoff });
    for (const r of records) {
      expect(r.date <= cutoff).toBe(true);
    }
    expect(records.length).toBe(SAMPLE_30D.filter((d) => d.date <= cutoff).length);
  });

  it("returns [] when org directory does not exist", () => {
    expect(loadMetrics({ storeDir, org: "nonexistent-org" })).toHaveLength(0);
  });

  it("merges records from multiple JSONL files in date order", () => {
    const multiStore = join(SUITE_TMP, `multi-${randomUUID()}`);
    const orgA = pullMetricsFromFixture("multi-org").slice(0, 3);
    const orgB = pullMetricsFromFixture("multi-org").slice(3);
    writeMetrics(orgA, { storeDir: multiStore });
    writeMetrics(orgB, { storeDir: multiStore });

    const all = loadMetrics({ storeDir: multiStore, org: "multi-org" });
    expect(all).toHaveLength(SAMPLE_30D.length);
    const dates = all.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});

// ─── writeMetrics — argument validation ──────────────────────────────────────

describe("writeMetrics — argument validation", () => {
  it("throws MetricsError when storeDir is omitted", () => {
    expect(() => writeMetrics([], {})).toThrow(MetricsError);
  });
});

// ─── loadMetrics — argument validation ───────────────────────────────────────

describe("loadMetrics — argument validation", () => {
  it("throws MetricsError when storeDir is omitted", () => {
    expect(() => loadMetrics({ org: "x" })).toThrow(MetricsError);
  });

  it("throws MetricsError when org is omitted", () => {
    expect(() => loadMetrics({ storeDir: SUITE_TMP })).toThrow(MetricsError);
  });
});

// ─── Test helper ─────────────────────────────────────────────────────────────

/**
 * Converts raw fixture entries into normalized records under the given org slug.
 * Avoids spawning gh in write/load tests.
 */
function pullMetricsFromFixture(org) {
  return SAMPLE_30D.map((raw) => ({
    schema: "1.0",
    date: raw.date,
    org,
    totalActiveUsers: raw.total_active_users ?? 0,
    totalEngagedUsers: raw.total_engaged_users ?? 0,
    codeCompletions: {
      totalEngagedUsers: raw.copilot_ide_code_completions?.total_engaged_users ?? 0,
      totalSuggestions: (raw.copilot_ide_code_completions?.languages ?? []).reduce(
        (s, l) => s + (l.total_code_suggestions ?? 0),
        0
      ),
      totalAcceptances: (raw.copilot_ide_code_completions?.languages ?? []).reduce(
        (s, l) => s + (l.total_code_acceptances ?? 0),
        0
      ),
      acceptanceRate: 0,
      languages: (raw.copilot_ide_code_completions?.languages ?? []).map((l) => ({
        name: l.name,
        engagedUsers: l.total_engaged_users ?? 0,
        suggestions: l.total_code_suggestions ?? 0,
        acceptances: l.total_code_acceptances ?? 0,
        linesSuggested: l.total_code_lines_suggested ?? 0,
        linesAccepted: l.total_code_lines_accepted ?? 0,
      })),
    },
    ideChatEngagedUsers: raw.copilot_ide_chat?.total_engaged_users ?? 0,
    dotcomChatEngagedUsers: raw.copilot_dotcom_chat?.total_engaged_users ?? 0,
    prEngagedUsers: raw.copilot_dotcom_pull_requests?.total_engaged_users ?? 0,
  }));
}
