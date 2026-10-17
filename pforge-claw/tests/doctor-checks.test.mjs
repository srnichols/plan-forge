import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runFeatureDoctorChecks } from "../src/doctor-checks.mjs";
import { createApp } from "../src/app.mjs";
import { runDoctor } from "../src/cli/doctor.mjs";
import memory from "../src/features/memory.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function feature(name, doctorChecks, overrides = {}) {
  return { name, available: true, start: vi.fn(async () => {}), stop: vi.fn(async () => {}), doctorChecks, ...overrides };
}

describe("feature doctor seam", () => {
  it("normalizes items to doctor checks and maps error to fail", async () => {
    const checks = await runFeatureDoctorChecks({
      features: [feature("alerts", async () => [
        { name: "alerts:p1", status: "ok", detail: "Observer running." },
        { name: "alerts:p2", status: "error", detail: "Observer unavailable.", code: "FORGE_MASTER_UNAVAILABLE" },
        { status: "skip", detail: "Live only." },
      ])],
    });
    expect(checks).toEqual([
      { id: "feature.alerts:p1", status: "ok", code: "FEATURE_CHECK_OK", message: "Observer running." },
      { id: "feature.alerts:p2", status: "fail", code: "FORGE_MASTER_UNAVAILABLE", message: "Observer unavailable." },
      { id: "feature.alerts", status: "skip", code: "FEATURE_CHECK_SKIP", message: "Live only." },
    ]);
  });

  it("skips unavailable features and features without the hook", async () => {
    const hook = vi.fn(async () => [{ status: "ok", detail: "x" }]);
    const checks = await runFeatureDoctorChecks({
      features: [feature("off", hook, { available: false }), { name: "plain", available: true }],
    });
    expect(checks).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
  });

  it("turns a throwing hook into a warning without leaking the error", async () => {
    const checks = await runFeatureDoctorChecks({
      features: [feature("memory", async () => { throw new Error("token=secret-value"); })],
    });
    expect(checks).toEqual([expect.objectContaining({ id: "feature.memory", status: "warn", code: "FEATURE_DOCTOR_FAILED" })]);
    expect(JSON.stringify(checks)).not.toContain("secret-value");
  });

  it("times out a hung hook", async () => {
    vi.useFakeTimers();
    try {
      const pending = runFeatureDoctorChecks({ features: [feature("alerts", () => new Promise(() => {}))], timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toEqual([expect.objectContaining({ status: "warn", code: "FEATURE_DOCTOR_TIMEOUT" })]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("app.doctor runs live checks against started features only", async () => {
    const live = vi.fn(async (ctx) => [{ status: "ok", detail: `live=${ctx.live} mcp=${Boolean(ctx.mcp)}` }]);
    const notStarted = vi.fn(async () => []);
    const app = createApp({ mcp: {} }, { features: [feature("alerts", live), feature("off", notStarted, { available: false })] });
    await app.start();
    expect(await app.doctor()).toEqual([expect.objectContaining({ message: "live=true mcp=true" })]);
    expect(notStarted).not.toHaveBeenCalled();
    await app.stop();
  });

  it("runDoctor appends offline feature checks with live=false once a config exists", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "claw-doctor-"));
    try {
      copyFileSync(path.join(PACKAGE_ROOT, "examples", "single-host.json"), path.join(home, "config.json"));
      const hook = vi.fn(async (ctx) => [{ name: "alerts:offline", status: "skip", detail: `live=${ctx.live}` }]);
      const report = await runDoctor({ home, env: {}, which: async () => null, features: [feature("alerts", hook)] });
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ live: false, config: expect.any(Object) }));
      expect(report.checks).toContainEqual(expect.objectContaining({ id: "feature.alerts:offline", status: "skip", message: "live=false" }));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("runDoctor skips feature checks when there is no config", async () => {
    const hook = vi.fn(async () => [{ status: "ok", detail: "x" }]);
    const home = mkdtempSync(path.join(os.tmpdir(), "claw-doctor-empty-"));
    try {
      const report = await runDoctor({ home, env: {}, which: async () => null, features: [feature("alerts", hook)] });
      expect(hook).not.toHaveBeenCalled();
      expect(report.checks.some((check) => check.id.startsWith("feature."))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("memory reports skip offline instead of a false unreachable warning", async () => {
    expect(await memory.doctorChecks({ live: false, config: { projects: [{ id: "p1" }] } })).toEqual([
      expect.objectContaining({ name: "memory", status: "skip" }),
    ]);
  });
});
