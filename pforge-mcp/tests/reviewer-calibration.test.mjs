/**
 * Plan Forge — Phase-26 Slice 6 (Reviewer calibration counter) tests
 *
 * Covers:
 *   brain.mjs — REVIEWER_DEFAULTS.calibrationThreshold (default 50),
 *   loadReviewerConfig parses runtime.reviewer.calibrationThreshold,
 *   getReviewerCalibration derives count at read-time from `.forge/reviews/`.
 *
 * Contract (Phase-26 MUST #C2 / D5):
 *   - Count is NEVER stored as a scalar; always derived by glob at read-time.
 *   - Default threshold is 50 advisory reviews.
 *   - `eligible` is true when `count >= threshold`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  REVIEWER_DEFAULTS,
  loadReviewerConfig,
  getReviewerCalibration,
} from "../brain.mjs";

function writeConfig(cwd, block) {
  writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(block, null, 2), "utf-8");
}

function seedReviews(cwd, count, { nonJson = 0 } = {}) {
  const dir = resolve(cwd, ".forge", "reviews");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(resolve(dir, `review-${i}.json`), JSON.stringify({ i, score: 80 }), "utf-8");
  }
  for (let i = 0; i < nonJson; i++) {
    writeFileSync(resolve(dir, `note-${i}.txt`), "not a review", "utf-8");
  }
}

describe("REVIEWER_DEFAULTS.calibrationThreshold (Phase-26 D5)", () => {
  it("defaults to 50 advisory reviews", () => {
    expect(REVIEWER_DEFAULTS.calibrationThreshold).toBe(50);
  });
});

describe("loadReviewerConfig parses calibrationThreshold", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-cal-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("uses default 50 when field is absent", () => {
    writeConfig(cwd, { runtime: { reviewer: { enabled: true } } });
    expect(loadReviewerConfig(cwd).calibrationThreshold).toBe(50);
  });

  it("accepts a positive integer override", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: 10 } } });
    expect(loadReviewerConfig(cwd).calibrationThreshold).toBe(10);
  });

  it("floors a non-integer numeric override", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: 25.8 } } });
    expect(loadReviewerConfig(cwd).calibrationThreshold).toBe(25);
  });

  it("rejects a non-positive value and keeps default", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: 0 } } });
    expect(loadReviewerConfig(cwd).calibrationThreshold).toBe(50);
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: -5 } } });
    expect(loadReviewerConfig(cwd).calibrationThreshold).toBe(50);
  });

  it("rejects a non-numeric value and keeps default", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: "many" } } });
    expect(loadReviewerConfig(cwd).calibrationThreshold).toBe(50);
  });
});

describe("getReviewerCalibration — read-time derivation (MUST #C2)", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-cal-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns zero count and ineligible when `.forge/reviews/` is missing", () => {
    const result = getReviewerCalibration(cwd);
    expect(result.count).toBe(0);
    expect(result.threshold).toBe(50);
    expect(result.eligible).toBe(false);
  });

  it("returns zero count and ineligible when `.forge/reviews/` is empty", () => {
    mkdirSync(resolve(cwd, ".forge", "reviews"), { recursive: true });
    const result = getReviewerCalibration(cwd);
    expect(result.count).toBe(0);
    expect(result.eligible).toBe(false);
  });

  it("counts only `.json` files, ignoring other extensions", () => {
    seedReviews(cwd, 7, { nonJson: 3 });
    const result = getReviewerCalibration(cwd);
    expect(result.count).toBe(7);
    expect(result.eligible).toBe(false); // below default 50
  });

  it("flips to eligible when count meets threshold", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: 5 } } });
    seedReviews(cwd, 5);
    const result = getReviewerCalibration(cwd);
    expect(result.count).toBe(5);
    expect(result.threshold).toBe(5);
    expect(result.eligible).toBe(true);
  });

  it("stays ineligible below threshold, flips at threshold", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: 3 } } });
    seedReviews(cwd, 2);
    expect(getReviewerCalibration(cwd).eligible).toBe(false);
    // Add a 3rd review with a distinct filename to avoid clobbering
    writeFileSync(resolve(cwd, ".forge", "reviews", "review-extra-1.json"), "{}", "utf-8");
    expect(getReviewerCalibration(cwd).eligible).toBe(true);
  });

  it("derives fresh on each call (no caching)", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: 3 } } });
    seedReviews(cwd, 2);
    expect(getReviewerCalibration(cwd).count).toBe(2);
    // Add one more file with a distinct name
    writeFileSync(resolve(cwd, ".forge", "reviews", "extra.json"), "{}", "utf-8");
    expect(getReviewerCalibration(cwd).count).toBe(3);
    expect(getReviewerCalibration(cwd).eligible).toBe(true);
  });

  it("honors config threshold override from `.forge.json`", () => {
    writeConfig(cwd, { runtime: { reviewer: { calibrationThreshold: 100 } } });
    seedReviews(cwd, 50);
    const result = getReviewerCalibration(cwd);
    expect(result.threshold).toBe(100);
    expect(result.count).toBe(50);
    expect(result.eligible).toBe(false);
  });
});
