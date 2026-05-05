/**
 * Tests for Phase GITHUB-D Slice 5:
 *   - GET /api/github-metrics REST endpoint (server.mjs)
 *   - Dashboard tab module render helpers (dashboard/github-metrics-tab.mjs)
 *
 * Endpoint coverage:
 *   1. Returns 200 with merged data when JSONL store has data
 *   2. Returns 200 with empty arrays when store is empty (not 404)
 *   3. Returns 200 without org param — metrics array is empty, costReport present
 *
 * Tab module coverage:
 *   4. renderAdoptionPanel — produces adoption panel HTML with data-panel="adoption"
 *   5. renderOrchestrationPanel — produces orchestration panel HTML with data-panel="orchestration"
 *   6. renderPerTeamTable — produces per-team panel HTML with data-panel="per-team"
 *   7. renderEmptyState — shows populate command with copy-button
 *   8. renderAdoptionPanel with empty records — falls back to empty-state
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Harness ────────────────────────────────────────────────────────────────

let server;
let baseUrl;
let tmpProject;
let storeDir;
let savedCwd;

const SAMPLE_ORG = "test-org";

function makeRecord(date, org = SAMPLE_ORG) {
  return {
    schema: "1.0",
    date,
    org,
    totalActiveUsers: 10,
    totalEngagedUsers: 7,
    codeCompletions: {
      totalEngagedUsers: 6,
      totalSuggestions: 100,
      totalAcceptances: 50,
      acceptanceRate: 0.5,
      languages: [{ name: "javascript", engagedUsers: 5, suggestions: 100, acceptances: 50, linesSuggested: 200, linesAccepted: 80 }],
    },
    ideChatEngagedUsers: 3,
    dotcomChatEngagedUsers: 2,
    prEngagedUsers: 4,
  };
}

function writeJsonl(path, records) {
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(path, lines, "utf-8");
}

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-gm-dashboard-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);

  // Minimal .forge.json so server initialises without errors
  writeFileSync(join(tmpProject, ".forge.json"), "{}", "utf-8");

  // Write sample metrics into .forge/github-metrics/<org>/
  storeDir = join(tmpProject, ".forge", "github-metrics");
  const orgDir = join(storeDir, SAMPLE_ORG);
  mkdirSync(orgDir, { recursive: true });
  writeJsonl(join(orgDir, "2024-11-01.jsonl"), [makeRecord("2024-11-01")]);
  writeJsonl(join(orgDir, "2024-11-02.jsonl"), [makeRecord("2024-11-02")]);
  writeJsonl(join(orgDir, "2024-11-03.jsonl"), [makeRecord("2024-11-03")]);

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (savedCwd) process.chdir(savedCwd);
  delete process.env.PLAN_FORGE_PROJECT;
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

// ─── REST endpoint ───────────────────────────────────────────────────────────

describe("GET /api/github-metrics — with data", () => {
  it("returns HTTP 200", async () => {
    const res = await get(`/api/github-metrics?org=${SAMPLE_ORG}`);
    expect(res.status).toBe(200);
  });

  it("returns metrics array with 3 records for test-org", async () => {
    const res = await get(`/api/github-metrics?org=${SAMPLE_ORG}`);
    const body = await res.json();
    expect(Array.isArray(body.metrics)).toBe(true);
    expect(body.metrics).toHaveLength(3);
  });

  it("records are sorted ascending by date", async () => {
    const res = await get(`/api/github-metrics?org=${SAMPLE_ORG}`);
    const body = await res.json();
    const dates = body.metrics.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("response includes org and _meta.recordCount", async () => {
    const res = await get(`/api/github-metrics?org=${SAMPLE_ORG}`);
    const body = await res.json();
    expect(body.org).toBe(SAMPLE_ORG);
    expect(body._meta.recordCount).toBe(3);
  });

  it("response includes costReport (may be null when no runs)", async () => {
    const res = await get(`/api/github-metrics?org=${SAMPLE_ORG}`);
    const body = await res.json();
    expect("costReport" in body).toBe(true);
  });

  it("since filter is respected", async () => {
    const res = await get(`/api/github-metrics?org=${SAMPLE_ORG}&since=2024-11-02`);
    const body = await res.json();
    for (const r of body.metrics) {
      expect(r.date >= "2024-11-02").toBe(true);
    }
    expect(body.metrics.length).toBe(2);
  });

  it("until filter is respected", async () => {
    const res = await get(`/api/github-metrics?org=${SAMPLE_ORG}&until=2024-11-02`);
    const body = await res.json();
    for (const r of body.metrics) {
      expect(r.date <= "2024-11-02").toBe(true);
    }
    expect(body.metrics.length).toBe(2);
  });
});

describe("GET /api/github-metrics — empty store", () => {
  it("returns HTTP 200 (not 404) when store is empty", async () => {
    const res = await get("/api/github-metrics?org=nonexistent-org");
    expect(res.status).toBe(200);
  });

  it("returns empty metrics array for unknown org", async () => {
    const res = await get("/api/github-metrics?org=nonexistent-org");
    const body = await res.json();
    expect(Array.isArray(body.metrics)).toBe(true);
    expect(body.metrics).toHaveLength(0);
  });

  it("_meta.recordCount is 0 for unknown org", async () => {
    const res = await get("/api/github-metrics?org=nonexistent-org");
    const body = await res.json();
    expect(body._meta.recordCount).toBe(0);
  });
});

describe("GET /api/github-metrics — no org param", () => {
  it("returns HTTP 200 with empty metrics array when org is omitted", async () => {
    const res = await get("/api/github-metrics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.metrics)).toBe(true);
    expect(body.metrics).toHaveLength(0);
    expect(body.org).toBeNull();
  });
});

// ─── Tab module render helpers ───────────────────────────────────────────────

describe("renderAdoptionPanel", () => {
  let renderAdoptionPanel;

  beforeAll(async () => {
    ({ renderAdoptionPanel } = await import("../dashboard/github-metrics-tab.mjs"));
  });

  it("renders a panel with data-panel='adoption'", () => {
    const records = [makeRecord("2024-11-01"), makeRecord("2024-11-02")];
    const html = renderAdoptionPanel(records);
    expect(html).toContain('data-panel="adoption"');
  });

  it("includes acceptance-rate sparkline", () => {
    const records = [makeRecord("2024-11-01")];
    const html = renderAdoptionPanel(records);
    expect(html).toContain('data-metric="acceptance-rate"');
  });

  it("includes pr-engaged-users sparkline", () => {
    const records = [makeRecord("2024-11-01")];
    const html = renderAdoptionPanel(records);
    expect(html).toContain('data-metric="pr-engaged-users"');
  });

  it("includes chat-users sparkline", () => {
    const records = [makeRecord("2024-11-01")];
    const html = renderAdoptionPanel(records);
    expect(html).toContain('data-metric="chat-users"');
  });

  it("falls back to empty-state when records array is empty", () => {
    const html = renderAdoptionPanel([]);
    expect(html).toContain('data-panel="empty"');
  });
});

describe("renderOrchestrationPanel", () => {
  let renderOrchestrationPanel;

  beforeAll(async () => {
    ({ renderOrchestrationPanel } = await import("../dashboard/github-metrics-tab.mjs"));
  });

  it("renders a panel with data-panel='orchestration'", () => {
    const html = renderOrchestrationPanel({ totalRuns: 5, totalSlices: 20, totalCostUsd: 1.23 });
    expect(html).toContain('data-panel="orchestration"');
  });

  it("includes runs, slices, and cost-usd sparklines", () => {
    const html = renderOrchestrationPanel({ totalRuns: 3, totalSlices: 12, totalCostUsd: 0.5 });
    expect(html).toContain('data-metric="runs"');
    expect(html).toContain('data-metric="slices"');
    expect(html).toContain('data-metric="cost-usd"');
  });

  it("renders correctly with null costReport (graceful defaults)", () => {
    const html = renderOrchestrationPanel(null);
    expect(html).toContain('data-panel="orchestration"');
    expect(html).toContain("$0.00");
  });
});

describe("renderPerTeamTable", () => {
  let renderPerTeamTable;

  beforeAll(async () => {
    ({ renderPerTeamTable } = await import("../dashboard/github-metrics-tab.mjs"));
  });

  it("renders a panel with data-panel='per-team'", () => {
    const rows = [{ team: "platform", adoptedPrs: 12, runs: 5, costUsd: 1.0, driftScore: 88 }];
    const html = renderPerTeamTable(rows);
    expect(html).toContain('data-panel="per-team"');
  });

  it("renders a table with aria-label", () => {
    const rows = [{ team: "team-a", adoptedPrs: 5, runs: 2, costUsd: 0.3, driftScore: 90 }];
    const html = renderPerTeamTable(rows);
    expect(html).toContain('aria-label="Per-team metrics"');
  });

  it("shows empty-state message when rows array is empty", () => {
    const html = renderPerTeamTable([]);
    expect(html).toContain('data-panel="per-team"');
    expect(html).toContain("No per-team data available");
  });

  it("escapes HTML in team name to prevent XSS", () => {
    const rows = [{ team: '<script>alert("x")</script>', adoptedPrs: 0, runs: 0, costUsd: 0 }];
    const html = renderPerTeamTable(rows);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderEmptyState", () => {
  let renderEmptyState;

  beforeAll(async () => {
    ({ renderEmptyState } = await import("../dashboard/github-metrics-tab.mjs"));
  });

  it("renders a panel with data-panel='empty'", () => {
    const html = renderEmptyState();
    expect(html).toContain('data-panel="empty"');
  });

  it("includes a copy-button", () => {
    const html = renderEmptyState();
    expect(html).toContain('class="gm-copy-btn"');
  });

  it("includes the populate command with default placeholder", () => {
    const html = renderEmptyState();
    expect(html).toContain("pforge github metrics pull");
    expect(html).toContain("&lt;org-name&gt;");
  });

  it("includes org name when provided", () => {
    const html = renderEmptyState("my-company");
    expect(html).toContain("--org my-company");
  });
});
