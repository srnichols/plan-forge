/**
 * Issue #197 — writeSilentExitRecord unit tests.
 *
 * Covers:
 *  - Returns false when sliceId is falsy (null, undefined, "")
 *  - Returns true and writes a slice-failed event when sliceId is provided
 *  - Writes to events.log with correct fields (reason, status, error prefix)
 *  - Handles null runDir without throwing (no log file written)
 *  - title defaults to "" when not provided / falsy
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeSilentExitRecord } from "../orchestrator.mjs";

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-silent-exit-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Falsy sliceId ────────────────────────────────────────────────────

describe("writeSilentExitRecord — falsy sliceId", () => {
  it("returns false for null sliceId", () => {
    expect(writeSilentExitRecord(null, "Slice 1", tempDir)).toBe(false);
  });

  it("returns false for undefined sliceId", () => {
    expect(writeSilentExitRecord(undefined, "Slice 1", tempDir)).toBe(false);
  });

  it("returns false for empty-string sliceId", () => {
    expect(writeSilentExitRecord("", "Slice 1", tempDir)).toBe(false);
  });

  it("does not write events.log when sliceId is falsy", () => {
    writeSilentExitRecord(null, "Slice 1", tempDir);
    expect(existsSync(join(tempDir, "events.log"))).toBe(false);
  });
});

// ─── Valid sliceId — return value ─────────────────────────────────────

describe("writeSilentExitRecord — valid sliceId return value", () => {
  it("returns true when sliceId is a non-empty string", () => {
    expect(writeSilentExitRecord("1", "Slice 1", null)).toBe(true);
  });
});

// ─── events.log content ───────────────────────────────────────────────

describe("writeSilentExitRecord — events.log content", () => {
  it("writes a slice-failed line to events.log", () => {
    writeSilentExitRecord("2", "Build artifacts", tempDir);
    const eventsLog = join(tempDir, "events.log");
    expect(existsSync(eventsLog)).toBe(true);
    const content = readFileSync(eventsLog, "utf8");
    expect(content).toContain("slice-failed");
  });

  it("records sliceId in the log line", () => {
    writeSilentExitRecord("42", "Deploy", tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain('"sliceId":"42"');
  });

  it("records title in the log line", () => {
    writeSilentExitRecord("3", "Run migrations", tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain('"title":"Run migrations"');
  });

  it("records status=error in the log line", () => {
    writeSilentExitRecord("5", "Test gate", tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain('"status":"error"');
  });

  it("records reason=worker-exited-without-output", () => {
    writeSilentExitRecord("7", "Finalize", tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain('"reason":"worker-exited-without-output"');
  });

  it("error field references Issue #197", () => {
    writeSilentExitRecord("8", "Deploy", tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain("Issue #197");
  });

  it("error field contains orchestrator-silent-exit prefix", () => {
    writeSilentExitRecord("9", "Ship", tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain("orchestrator-silent-exit");
  });
});

// ─── null runDir (no file I/O) ─────────────────────────────────────────

describe("writeSilentExitRecord — null runDir", () => {
  it("does not throw when runDir is null", () => {
    expect(() => writeSilentExitRecord("10", "Any slice", null)).not.toThrow();
  });

  it("returns true even when runDir is null", () => {
    expect(writeSilentExitRecord("11", "Any slice", null)).toBe(true);
  });
});

// ─── falsy title ──────────────────────────────────────────────────────

describe("writeSilentExitRecord — falsy title", () => {
  it("defaults title to empty string when null", () => {
    writeSilentExitRecord("12", null, tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain('"title":""');
  });

  it("defaults title to empty string when undefined", () => {
    writeSilentExitRecord("13", undefined, tempDir);
    const content = readFileSync(join(tempDir, "events.log"), "utf8");
    expect(content).toContain('"title":""');
  });
});
