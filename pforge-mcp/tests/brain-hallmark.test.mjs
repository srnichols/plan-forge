/**
 * brain-hallmark.test.mjs — Tests for the hallmark writer in brain.mjs
 *
 * Covers: writeHallmark, readHallmark, listHallmarks, HallmarkError,
 * validateHallmarkId, path-traversal guards, idempotence, payload types.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  writeHallmark,
  readHallmark,
  listHallmarks,
  HallmarkError,
  validateHallmarkId,
} from "../brain.mjs";

function makeTempDir() {
  const dir = resolve(tmpdir(), `brain-hallmark-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("brain.hallmark", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  // ── validateHallmarkId ──

  it("validateHallmarkId accepts alphanumeric ids", () => {
    expect(() => validateHallmarkId("slice-3")).not.toThrow();
    expect(() => validateHallmarkId("Phase25.build")).not.toThrow();
    expect(() => validateHallmarkId("deploy_v2")).not.toThrow();
    expect(() => validateHallmarkId("abc123")).not.toThrow();
  });

  it("validateHallmarkId rejects empty / non-string", () => {
    expect(() => validateHallmarkId("")).toThrow(HallmarkError);
    expect(() => validateHallmarkId(null)).toThrow(HallmarkError);
    expect(() => validateHallmarkId(undefined)).toThrow(HallmarkError);
    expect(() => validateHallmarkId(42)).toThrow(HallmarkError);
  });

  it("validateHallmarkId rejects path traversal (..)", () => {
    expect(() => validateHallmarkId("slice..3")).toThrow(HallmarkError);
    expect(() => validateHallmarkId("../etc/passwd")).toThrow(HallmarkError);
  });

  it("validateHallmarkId rejects spaces and special chars", () => {
    expect(() => validateHallmarkId("slice 3")).toThrow(HallmarkError);
    expect(() => validateHallmarkId("slice/3")).toThrow(HallmarkError);
    expect(() => validateHallmarkId("slice*")).toThrow(HallmarkError);
  });

  // ── writeHallmark ──

  it("writeHallmark returns { ok: true, ref } and creates the file", () => {
    const result = writeHallmark("slice-3", { status: "done" }, {}, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(typeof result.ref).toBe("string");
    expect(existsSync(result.ref)).toBe(true);
  });

  it("writeHallmark file contains id, payload, writtenAt", () => {
    writeHallmark("deploy-gate", { env: "staging" }, {}, { cwd: tmpDir });
    const record = readHallmark("deploy-gate", { cwd: tmpDir });
    expect(record.id).toBe("deploy-gate");
    expect(record.payload).toEqual({ env: "staging" });
    expect(typeof record.writtenAt).toBe("string");
  });

  it("writeHallmark accepts opts.source and opts.tags", () => {
    writeHallmark(
      "review-pass",
      { score: 95 },
      { source: "slice-3-executor", tags: ["review", "passing"] },
      { cwd: tmpDir }
    );
    const record = readHallmark("review-pass", { cwd: tmpDir });
    expect(record.source).toBe("slice-3-executor");
    expect(record.tags).toEqual(["review", "passing"]);
  });

  it("writeHallmark uses injected now() for writtenAt", () => {
    const fixedTime = "2026-01-01T00:00:00.000Z";
    writeHallmark("ts-test", { v: 1 }, {}, { cwd: tmpDir, now: () => fixedTime });
    const record = readHallmark("ts-test", { cwd: tmpDir });
    expect(record.writtenAt).toBe(fixedTime);
  });

  it("writeHallmark is idempotent — last write wins", () => {
    writeHallmark("my-marker", { v: 1 }, {}, { cwd: tmpDir });
    writeHallmark("my-marker", { v: 2 }, {}, { cwd: tmpDir });
    const record = readHallmark("my-marker", { cwd: tmpDir });
    expect(record.payload.v).toBe(2);
  });

  it("writeHallmark throws HallmarkError for invalid id", () => {
    expect(() => writeHallmark("bad id", {}, {}, { cwd: tmpDir })).toThrow(HallmarkError);
    expect(() => writeHallmark("../traversal", {}, {}, { cwd: tmpDir })).toThrow(HallmarkError);
  });

  it("writeHallmark throws HallmarkError when payload is undefined", () => {
    expect(() => writeHallmark("ok-id", undefined, {}, { cwd: tmpDir })).toThrow(HallmarkError);
  });

  it("writeHallmark accepts null payload (explicit clear marker)", () => {
    const result = writeHallmark("nullable", null, {}, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    const record = readHallmark("nullable", { cwd: tmpDir });
    expect(record.payload).toBeNull();
  });

  it("writeHallmark accepts string, number, and array payloads", () => {
    writeHallmark("str", "hello", {}, { cwd: tmpDir });
    writeHallmark("num", 42, {}, { cwd: tmpDir });
    writeHallmark("arr", [1, 2, 3], {}, { cwd: tmpDir });
    expect(readHallmark("str", { cwd: tmpDir }).payload).toBe("hello");
    expect(readHallmark("num", { cwd: tmpDir }).payload).toBe(42);
    expect(readHallmark("arr", { cwd: tmpDir }).payload).toEqual([1, 2, 3]);
  });

  // ── readHallmark ──

  it("readHallmark returns null for missing hallmark", () => {
    expect(readHallmark("does-not-exist", { cwd: tmpDir })).toBeNull();
  });

  it("readHallmark returns null for invalid id without throwing", () => {
    // validateHallmarkId throws HallmarkError; make sure it propagates
    expect(() => readHallmark("bad id", { cwd: tmpDir })).toThrow(HallmarkError);
  });

  it("readHallmark returns full record with all fields", () => {
    writeHallmark("full-record", { x: 1 }, { source: "test", tags: ["a"] }, { cwd: tmpDir });
    const record = readHallmark("full-record", { cwd: tmpDir });
    expect(record).toMatchObject({ id: "full-record", payload: { x: 1 }, source: "test", tags: ["a"] });
  });

  // ── listHallmarks ──

  it("listHallmarks returns empty array when no hallmarks dir exists", () => {
    expect(listHallmarks({}, { cwd: tmpDir })).toEqual([]);
  });

  it("listHallmarks returns all written hallmarks", () => {
    writeHallmark("alpha", { n: 1 }, {}, { cwd: tmpDir });
    writeHallmark("beta", { n: 2 }, {}, { cwd: tmpDir });
    writeHallmark("gamma", { n: 3 }, {}, { cwd: tmpDir });
    const list = listHallmarks({}, { cwd: tmpDir });
    expect(list.length).toBe(3);
    const ids = list.map(h => h.id).sort();
    expect(ids).toEqual(["alpha", "beta", "gamma"]);
  });

  it("listHallmarks sorts by writtenAt ascending by default", () => {
    const times = ["2026-01-03T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"];
    const ids = ["c", "a", "b"];
    ids.forEach((id, i) => writeHallmark(id, {}, {}, { cwd: tmpDir, now: () => times[i] }));
    const list = listHallmarks({}, { cwd: tmpDir });
    expect(list.map(h => h.id)).toEqual(["a", "b", "c"]);
  });

  it("listHallmarks with sort: false preserves filesystem order", () => {
    writeHallmark("x1", {}, {}, { cwd: tmpDir });
    writeHallmark("x2", {}, {}, { cwd: tmpDir });
    const list = listHallmarks({ sort: false }, { cwd: tmpDir });
    expect(list.length).toBe(2);
  });

  it("listHallmarks skips malformed JSON files silently", () => {
    writeHallmark("good", { v: 1 }, {}, { cwd: tmpDir });
    // Inject a malformed file into the hallmarks directory
    const hallmarksDir = resolve(tmpDir, ".forge", "hallmarks");
    writeFileSync(resolve(hallmarksDir, "bad.json"), "{ not valid json {{{{");
    // Should not throw and should still return the good hallmark
    const list = listHallmarks({}, { cwd: tmpDir });
    expect(list.some(h => h.id === "good")).toBe(true);
  });
});
