import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { listFindings } from "../testbed/defect-log.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-findings-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureFindingsDir(tmpDir) {
  const dir = join(tmpDir, "docs", "plans", "testbed-findings");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFinding(dir, filename, data) {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2), "utf-8");
}

function makeFinding(overrides = {}) {
  return {
    findingId: `f-${randomUUID().slice(0, 8)}`,
    date: "2026-04-19",
    scenario: "happy-path-01",
    severity: "medium",
    surface: "cli",
    title: "Test finding",
    expected: "exit code 0",
    observed: "exit code 1",
    status: "open",
    ...overrides,
  };
}

describe("forge_testbed_findings tool logic", () => {
  let tmpDir;
  let findingsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    findingsDir = ensureFindingsDir(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no findings directory exists", () => {
    const emptyDir = resolve(tmpdir(), `pforge-empty-${randomUUID()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      const result = listFindings({}, { projectRoot: emptyDir });
      expect(result).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("returns all findings when no filters applied", () => {
    writeFinding(findingsDir, "2026-04-19-bug-a.json", makeFinding({ findingId: "a" }));
    writeFinding(findingsDir, "2026-04-18-bug-b.json", makeFinding({ findingId: "b", date: "2026-04-18" }));
    const result = listFindings({}, { projectRoot: tmpDir });
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2026-04-19");
    expect(result[1].date).toBe("2026-04-18");
  });

  it("filters by status", () => {
    writeFinding(findingsDir, "a.json", makeFinding({ findingId: "a", status: "open" }));
    writeFinding(findingsDir, "b.json", makeFinding({ findingId: "b", status: "fixed" }));
    const result = listFindings({ status: "open" }, { projectRoot: tmpDir });
    expect(result).toHaveLength(1);
    expect(result[0].findingId).toBe("a");
  });

  it("filters by severity", () => {
    writeFinding(findingsDir, "a.json", makeFinding({ findingId: "a", severity: "blocker" }));
    writeFinding(findingsDir, "b.json", makeFinding({ findingId: "b", severity: "low" }));
    const result = listFindings({ severity: "blocker" }, { projectRoot: tmpDir });
    expect(result).toHaveLength(1);
    expect(result[0].findingId).toBe("a");
  });

  it("filters by since date", () => {
    writeFinding(findingsDir, "a.json", makeFinding({ findingId: "a", date: "2026-04-19" }));
    writeFinding(findingsDir, "b.json", makeFinding({ findingId: "b", date: "2026-04-01" }));
    const result = listFindings({ since: "2026-04-10" }, { projectRoot: tmpDir });
    expect(result).toHaveLength(1);
    expect(result[0].findingId).toBe("a");
  });

  it("applies combined filters", () => {
    writeFinding(findingsDir, "a.json", makeFinding({ findingId: "a", status: "open", severity: "high", date: "2026-04-19" }));
    writeFinding(findingsDir, "b.json", makeFinding({ findingId: "b", status: "open", severity: "low", date: "2026-04-19" }));
    writeFinding(findingsDir, "c.json", makeFinding({ findingId: "c", status: "fixed", severity: "high", date: "2026-04-19" }));
    const result = listFindings({ status: "open", severity: "high" }, { projectRoot: tmpDir });
    expect(result).toHaveLength(1);
    expect(result[0].findingId).toBe("a");
  });

  it("sorts by date descending", () => {
    writeFinding(findingsDir, "a.json", makeFinding({ findingId: "a", date: "2026-04-15" }));
    writeFinding(findingsDir, "b.json", makeFinding({ findingId: "b", date: "2026-04-20" }));
    writeFinding(findingsDir, "c.json", makeFinding({ findingId: "c", date: "2026-04-17" }));
    const result = listFindings({}, { projectRoot: tmpDir });
    expect(result.map(f => f.findingId)).toEqual(["b", "c", "a"]);
  });

  it("skips malformed JSON files without crashing", () => {
    writeFinding(findingsDir, "good.json", makeFinding({ findingId: "good" }));
    writeFileSync(join(findingsDir, "bad.json"), "not json{{{", "utf-8");
    const result = listFindings({}, { projectRoot: tmpDir });
    expect(result).toHaveLength(1);
    expect(result[0].findingId).toBe("good");
  });

  it("ignores non-JSON files in findings directory", () => {
    writeFinding(findingsDir, "real.json", makeFinding({ findingId: "real" }));
    writeFileSync(join(findingsDir, ".placeholder"), "", "utf-8");
    writeFileSync(join(findingsDir, "readme.txt"), "not a finding", "utf-8");
    const result = listFindings({}, { projectRoot: tmpDir });
    expect(result).toHaveLength(1);
  });

  it("includes _filename in returned findings", () => {
    writeFinding(findingsDir, "2026-04-19-test.json", makeFinding({ findingId: "x" }));
    const result = listFindings({}, { projectRoot: tmpDir });
    expect(result[0]._filename).toBe("2026-04-19-test.json");
  });

  it("handles limit and truncation", () => {
    for (let i = 0; i < 5; i++) {
      writeFinding(findingsDir, `finding-${i}.json`, makeFinding({ findingId: `f-${i}`, date: `2026-04-${String(10 + i).padStart(2, "0")}` }));
    }
    const all = listFindings({}, { projectRoot: tmpDir });
    expect(all).toHaveLength(5);
    const limited = all.slice(0, 3);
    expect(limited).toHaveLength(3);
    expect(all.length > 3).toBe(true);
  });
});
