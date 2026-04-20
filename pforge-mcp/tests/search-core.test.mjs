import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  search,
  parseQuery,
  parseSince,
  scoreRecord,
  clearCache,
  resetOpenBrainSentinel,
} from "../search/core.mjs";
import { L2_SOURCES, SOURCE_WEIGHTS } from "../search/sources.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-search-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupForge(tmpDir) {
  mkdirSync(resolve(tmpDir, ".forge", "runs", "run-001"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "bugs"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "incidents"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "tempering"), { recursive: true });
  mkdirSync(resolve(tmpDir, "docs", "plans"), { recursive: true });
}

function writeJsonl(filePath, records) {
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

let tmpDir;

beforeEach(() => {
  tmpDir = makeTmpDir();
  setupForge(tmpDir);
  clearCache();
  resetOpenBrainSentinel();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }
});

// ─── Token matching ────────────────────────────────────────────────────

describe("parseQuery", () => {
  it("tokenizes case-insensitively and splits on whitespace", () => {
    const { tokens } = parseQuery("Hello World");
    expect(tokens).toEqual(["hello", "world"]);
  });

  it("returns empty tokens for empty string", () => {
    expect(parseQuery("").tokens).toEqual([]);
    expect(parseQuery(null).tokens).toEqual([]);
  });

  it("handles multiple spaces and tabs", () => {
    const { tokens } = parseQuery("  foo   bar  baz  ");
    expect(tokens).toEqual(["foo", "bar", "baz"]);
  });
});

// ─── parseSince ────────────────────────────────────────────────────────

describe("parseSince", () => {
  it("parses ISO 8601 timestamp", () => {
    const d = parseSince("2025-01-15T10:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2025-01-15T10:00:00.000Z");
  });

  it("parses relative expressions", () => {
    const before = Date.now();
    const d = parseSince("24h");
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBeGreaterThan(before - 24 * 3600 * 1000 - 1000);
    expect(d.getTime()).toBeLessThanOrEqual(before - 24 * 3600 * 1000 + 1000);
  });

  it("throws ERR_BAD_SINCE for invalid units", () => {
    try {
      parseSince("3x");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err.code).toBe("ERR_BAD_SINCE");
    }
  });

  it("returns null for falsy input", () => {
    expect(parseSince(null)).toBeNull();
    expect(parseSince("")).toBeNull();
  });
});

// ─── L2 source mappers ────────────────────────────────────────────────

describe("L2 source: run", () => {
  it("parses events.log into a run record", () => {
    const eventsPath = resolve(tmpDir, ".forge", "runs", "run-001", "events.log");
    writeJsonl(eventsPath, [
      { type: "slice-start", sliceTitle: "Add auth module", timestamp: "2025-06-01T10:00:00Z" },
      { type: "slice-complete", sliceTitle: "Add auth module", timestamp: "2025-06-01T10:05:00Z" },
    ]);
    const result = search({ query: "auth module" }, { cwd: tmpDir });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].source).toBe("run");
    expect(result.hits[0].recordRef).toBe("run-001");
  });

  it("handles empty events.log gracefully", () => {
    writeFileSync(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), "");
    const result = search({ query: "anything" }, { cwd: tmpDir });
    // Should not crash — may return 0 hits from runs
    expect(result).toBeDefined();
  });
});

describe("L2 source: bug", () => {
  it("parses bug JSON into a searchable record", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "bugs", "BUG-42.json"),
      JSON.stringify({ title: "Login regression", description: "Users cannot log in after deploy", tags: ["auth", "critical"], timestamp: new Date().toISOString() })
    );
    const result = search({ query: "login regression" }, { cwd: tmpDir });
    const hit = result.hits.find((h) => h.source === "bug");
    expect(hit).toBeDefined();
    expect(hit.recordRef).toBe("BUG-42");
  });

  it("skips corrupt JSON files", () => {
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "BAD.json"), "not json{{{");
    const result = search({ query: "anything" }, { cwd: tmpDir });
    expect(result).toBeDefined();
  });
});

describe("L2 source: incident", () => {
  it("parses incident JSON", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "incidents", "INC-01.json"),
      JSON.stringify({ title: "Database outage", severity: "high", summary: "Primary DB unreachable for 5 min", timestamp: new Date().toISOString() })
    );
    const result = search({ query: "database outage" }, { cwd: tmpDir });
    const hit = result.hits.find((h) => h.source === "incident");
    expect(hit).toBeDefined();
    expect(hit.recordRef).toBe("INC-01");
  });

  it("handles empty incidents directory", () => {
    const result = search({ query: "outage" }, { cwd: tmpDir });
    expect(result).toBeDefined();
  });
});

describe("L2 source: tempering", () => {
  it("parses tempering result JSON", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "tempering", "TEMP-01.json"),
      JSON.stringify({ failingRules: ["no-any", "strict-null"], offendingPaths: ["src/auth.ts"], timestamp: new Date().toISOString() })
    );
    const result = search({ query: "no-any strict-null" }, { cwd: tmpDir });
    const hit = result.hits.find((h) => h.source === "tempering");
    expect(hit).toBeDefined();
  });

  it("skips empty tempering results", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "tempering", "TEMP-02.json"),
      JSON.stringify({})
    );
    const result = search({ query: "anything" }, { cwd: tmpDir });
    expect(result).toBeDefined();
  });
});

describe("L2 source: hub-event", () => {
  it("parses hub-events.jsonl", () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { type: "slice-complete", correlationId: "run-abc", timestamp: new Date().toISOString() },
      { type: "incident-opened", correlationId: "inc-001", timestamp: new Date().toISOString() },
    ]);
    const result = search({ query: "incident-opened" }, { cwd: tmpDir });
    const hit = result.hits.find((h) => h.source === "hub-event");
    expect(hit).toBeDefined();
  });

  it("handles missing hub-events.jsonl", () => {
    const result = search({ query: "anything" }, { cwd: tmpDir });
    expect(result).toBeDefined();
  });
});

describe("L2 source: review", () => {
  it("parses review-queue.json", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "review-queue.json"),
      JSON.stringify([
        { id: "REV-01", title: "Auth flow needs review", tags: ["auth", "security"], timestamp: new Date().toISOString() },
      ])
    );
    const result = search({ query: "auth flow" }, { cwd: tmpDir });
    const hit = result.hits.find((h) => h.source === "review");
    expect(hit).toBeDefined();
    expect(hit.recordRef).toBe("REV-01");
  });

  it("handles malformed review-queue.json", () => {
    writeFileSync(resolve(tmpDir, ".forge", "review-queue.json"), "broken");
    const result = search({ query: "anything" }, { cwd: tmpDir });
    expect(result).toBeDefined();
  });
});

describe("L2 source: memory", () => {
  it("parses liveguard-memories.jsonl", () => {
    writeJsonl(resolve(tmpDir, ".forge", "liveguard-memories.jsonl"), [
      { id: "mem-1", summary: "Auth tokens expire silently", tags: ["auth"], timestamp: new Date().toISOString() },
    ]);
    const result = search({ query: "tokens expire" }, { cwd: tmpDir });
    const hit = result.hits.find((h) => h.source === "memory");
    expect(hit).toBeDefined();
  });

  it("handles missing memory file", () => {
    const result = search({ query: "memory" }, { cwd: tmpDir });
    expect(result).toBeDefined();
  });
});

describe("L2 source: plan", () => {
  it("parses Phase-*.md files", () => {
    writeFileSync(
      resolve(tmpDir, "docs", "plans", "Phase-AUTH-01.md"),
      `---\nphase: AUTH-01\nstatus: draft\n---\n\n# Phase AUTH-01: OAuth2 login flow\n\nDescription here.`
    );
    const result = search({ query: "OAuth2 login" }, { cwd: tmpDir });
    const hit = result.hits.find((h) => h.source === "plan");
    expect(hit).toBeDefined();
    expect(hit.recordRef).toBe("Phase-AUTH-01");
  });

  it("handles plan files without frontmatter", () => {
    writeFileSync(
      resolve(tmpDir, "docs", "plans", "Phase-BARE.md"),
      "# Phase BARE: No frontmatter\n\nJust content."
    );
    const result = search({ query: "frontmatter" }, { cwd: tmpDir });
    expect(result).toBeDefined();
  });
});

// ─── Ranker ───────────────────────────────────────────────────────────

describe("scoreRecord", () => {
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  it("recent records score higher than old ones", () => {
    const recent = { source: "run", text: "deploy failure", tags: [], correlationId: "", timestamp: now };
    const old = { source: "run", text: "deploy failure", tags: [], correlationId: "", timestamp: weekAgo };
    const scoreRecent = scoreRecord(recent, ["deploy", "failure"], null, null);
    const scoreOld = scoreRecord(old, ["deploy", "failure"], null, null);
    expect(scoreRecent).toBeGreaterThan(scoreOld);
  });

  it("tagged matches score higher than untagged", () => {
    const tagged = { source: "bug", text: "login bug", tags: ["auth"], correlationId: "", timestamp: now };
    const untagged = { source: "bug", text: "login bug", tags: [], correlationId: "", timestamp: now };
    const scoreTagged = scoreRecord(tagged, ["login"], ["auth"], null);
    const scoreUntagged = scoreRecord(untagged, ["login"], ["auth"], null);
    expect(scoreTagged).toBeGreaterThan(scoreUntagged);
  });

  it("incidents (weight 1.3) outrank hub-events (weight 0.7)", () => {
    const incident = { source: "incident", text: "outage detected", tags: [], correlationId: "", timestamp: now };
    const hubEvent = { source: "hub-event", text: "outage detected", tags: [], correlationId: "", timestamp: now };
    const scoreIncident = scoreRecord(incident, ["outage"], null, null);
    const scoreHub = scoreRecord(hubEvent, ["outage"], null, null);
    expect(scoreIncident).toBeGreaterThan(scoreHub);
  });

  it("correlationId exact match adds +10.0", () => {
    const withCorr = { source: "run", text: "deploy", tags: [], correlationId: "xyz-123", timestamp: now };
    const without = { source: "run", text: "deploy", tags: [], correlationId: "other", timestamp: now };
    const scoreWith = scoreRecord(withCorr, ["deploy"], null, "xyz-123");
    const scoreWithout = scoreRecord(without, ["deploy"], null, "xyz-123");
    expect(scoreWith - scoreWithout).toBeGreaterThanOrEqual(9.5);
  });

  it("correlation match dominates over high token overlap", () => {
    const corrMatch = { source: "run", text: "x", tags: [], correlationId: "abc", timestamp: now };
    const fullMatch = { source: "bug", text: "login auth deploy regression critical failure", tags: [], correlationId: "nope", timestamp: now };
    const scoreCorr = scoreRecord(corrMatch, ["login", "auth", "deploy", "regression", "critical", "failure"], null, "abc");
    const scoreFull = scoreRecord(fullMatch, ["login", "auth", "deploy", "regression", "critical", "failure"], null, "abc");
    expect(scoreCorr).toBeGreaterThan(scoreFull);
  });
});

// ─── Limit + truncation ──────────────────────────────────────────────

describe("limit and truncation", () => {
  it("limits results and sets truncated flag", () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(
        resolve(tmpDir, ".forge", "bugs", `BUG-${i}.json`),
        JSON.stringify({ title: `blocker bug ${i}`, timestamp: new Date().toISOString() })
      );
    }
    const result = search({ query: "blocker", limit: 5 }, { cwd: tmpDir });
    expect(result.hits.length).toBe(5);
    expect(result.total).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it("does not truncate when results fit within limit", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "bugs", "ONLY.json"),
      JSON.stringify({ title: "unique finding", timestamp: new Date().toISOString() })
    );
    const result = search({ query: "unique finding", limit: 50 }, { cwd: tmpDir });
    expect(result.truncated).toBe(false);
  });
});

// ─── Since filter ────────────────────────────────────────────────────

describe("since filter", () => {
  it("filters with ISO timestamp", () => {
    const old = new Date("2020-01-01T00:00:00Z").toISOString();
    const recent = new Date().toISOString();
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "OLD.json"), JSON.stringify({ title: "old bug", timestamp: old }));
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "NEW.json"), JSON.stringify({ title: "new bug", timestamp: recent }));
    const result = search({ query: "bug", since: "2024-01-01T00:00:00Z" }, { cwd: tmpDir });
    const refs = result.hits.map((h) => h.recordRef);
    expect(refs).toContain("NEW");
    expect(refs).not.toContain("OLD");
  });

  it("filters with relative 7d", () => {
    const old = new Date("2020-01-01T00:00:00Z").toISOString();
    const recent = new Date().toISOString();
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "ANCIENT.json"), JSON.stringify({ title: "ancient bug", timestamp: old }));
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "FRESH.json"), JSON.stringify({ title: "fresh bug", timestamp: recent }));
    const result = search({ query: "bug", since: "7d" }, { cwd: tmpDir });
    const refs = result.hits.map((h) => h.recordRef);
    expect(refs).toContain("FRESH");
    expect(refs).not.toContain("ANCIENT");
  });
});

// ─── Cache invalidation ─────────────────────────────────────────────

describe("cache", () => {
  it("invalidates on mtime change", async () => {
    const bugPath = resolve(tmpDir, ".forge", "bugs", "CACHE.json");
    writeFileSync(bugPath, JSON.stringify({ title: "version one", timestamp: new Date().toISOString() }));
    const r1 = search({ query: "version one" }, { cwd: tmpDir });
    expect(r1.hits.find((h) => h.recordRef === "CACHE")).toBeDefined();

    // Wait a bit to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(bugPath, JSON.stringify({ title: "version two", timestamp: new Date().toISOString() }));
    const r2 = search({ query: "version two" }, { cwd: tmpDir });
    expect(r2.hits.find((h) => h.recordRef === "CACHE")).toBeDefined();
  });
});

// ─── OpenBrain disabled → L2 only ───────────────────────────────────

describe("OpenBrain integration", () => {
  it("returns L2-only results when openBrainSearchFn is null", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "bugs", "B1.json"),
      JSON.stringify({ title: "test bug", timestamp: new Date().toISOString() })
    );
    const result = search({ query: "test bug" }, { cwd: tmpDir, openBrainSearchFn: null });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.every((h) => h.source !== "openbrain")).toBe(true);
  });

  it("merges and dedupes L3 hits from OpenBrain", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "bugs", "B2.json"),
      JSON.stringify({ title: "auth regression", correlationId: "corr-shared", timestamp: new Date().toISOString() })
    );
    const mockL3 = () => [
      { source: "openbrain", recordRef: "OB-1", text: "auth regression from openbrain", correlationId: "corr-shared", timestamp: new Date().toISOString() },
      { source: "openbrain", recordRef: "OB-2", text: "different result from openbrain", correlationId: "corr-unique", timestamp: new Date().toISOString() },
    ];
    const result = search({ query: "auth regression" }, { cwd: tmpDir, openBrainSearchFn: mockL3 });
    // corr-shared should be deduped (L2 bug wins)
    const obHits = result.hits.filter((h) => h.source === "openbrain");
    expect(obHits.length).toBe(1);
    expect(obHits[0].recordRef).toBe("OB-2");
  });
});

// ─── Sources filter ──────────────────────────────────────────────────

describe("sources filter", () => {
  it("limits search to specified sources", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "bugs", "SRC.json"),
      JSON.stringify({ title: "filtered target", timestamp: new Date().toISOString() })
    );
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { type: "filtered target", timestamp: new Date().toISOString() },
    ]);
    const result = search({ query: "filtered target", sources: ["bug"] }, { cwd: tmpDir });
    expect(result.hits.every((h) => h.source === "bug")).toBe(true);
  });

  it("returns empty for nonexistent source type", () => {
    const result = search({ query: "anything", sources: ["nonexistent"] }, { cwd: tmpDir });
    expect(result.hits.length).toBe(0);
  });
});

// ─── Empty project ──────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles missing .forge directory", () => {
    const emptyDir = resolve(tmpdir(), `pforge-empty-${randomUUID()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      const result = search({ query: "anything" }, { cwd: emptyDir });
      expect(result.hits).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.truncated).toBe(false);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("clamps limit to 1..200 range", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "bugs", "CL.json"),
      JSON.stringify({ title: "clamp test", timestamp: new Date().toISOString() })
    );
    const r0 = search({ query: "clamp", limit: 0 }, { cwd: tmpDir });
    expect(r0.hits.length).toBeLessThanOrEqual(1);
    const r999 = search({ query: "clamp", limit: 999 }, { cwd: tmpDir });
    expect(r999.hits.length).toBeLessThanOrEqual(200);
  });

  it("empty query returns results ranked by recency", () => {
    writeFileSync(
      resolve(tmpDir, ".forge", "bugs", "EQ.json"),
      JSON.stringify({ title: "some bug", timestamp: new Date().toISOString() })
    );
    const result = search({ query: "" }, { cwd: tmpDir });
    expect(result).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Performance guard ──────────────────────────────────────────────

describe("performance", () => {
  const skipPerf = process.env.CI_SKIP_PERF === "1";

  it.skipIf(skipPerf)("5k hub events + 500 runs + 100 bugs + 50 incidents < 250ms", () => {
    // Generate hub events
    const hubLines = [];
    for (let i = 0; i < 5000; i++) {
      hubLines.push(JSON.stringify({ type: `event-${i % 20}`, correlationId: `c-${i}`, timestamp: new Date(Date.now() - i * 60000).toISOString() }));
    }
    writeFileSync(resolve(tmpDir, ".forge", "hub-events.jsonl"), hubLines.join("\n") + "\n");

    // Generate runs
    for (let i = 0; i < 500; i++) {
      const runDir = resolve(tmpDir, ".forge", "runs", `perf-run-${i}`);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(resolve(runDir, "events.log"), JSON.stringify({ type: "slice-complete", sliceTitle: `slice ${i}`, timestamp: new Date(Date.now() - i * 300000).toISOString() }) + "\n");
    }

    // Generate bugs
    for (let i = 0; i < 100; i++) {
      writeFileSync(
        resolve(tmpDir, ".forge", "bugs", `PERF-${i}.json`),
        JSON.stringify({ title: `perf bug ${i}`, description: `desc ${i}`, tags: [`tag-${i % 5}`], timestamp: new Date(Date.now() - i * 600000).toISOString() })
      );
    }

    // Generate incidents
    for (let i = 0; i < 50; i++) {
      writeFileSync(
        resolve(tmpDir, ".forge", "incidents", `PERF-INC-${i}.json`),
        JSON.stringify({ title: `perf incident ${i}`, severity: "high", summary: `summary ${i}`, timestamp: new Date(Date.now() - i * 1200000).toISOString() })
      );
    }

    clearCache(); // cold query
    const result = search({ query: "perf bug" }, { cwd: tmpDir });
    expect(result.durationMs).toBeLessThan(250);
    expect(result.total).toBeGreaterThan(0);
  });
});
