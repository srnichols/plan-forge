import { afterEach, describe, expect, it } from "vitest";
import forgetCommand, { createForgetCommand, forgetAvailability } from "../src/commands/forget.mjs";
import memoryFeature, { doctorChecks } from "../src/features/memory.mjs";

afterEach(async () => {
  await memoryFeature.stop();
});

describe("control extraction characterizations", () => {
  it("keeps forget unavailable without an explicit delete capability", async () => {
    expect(forgetCommand.available).toBe(false);
    for (const capability of [undefined, null, {}, { canDelete: false }, { canDelete: "true" }]) {
      expect(forgetAvailability(capability)).toBe(false);
      expect(createForgetCommand(capability).available).toBe(false);
    }
    expect(await forgetCommand.handle({}, {
      caller: { role: "owner", userId: "owner" }, args: ["memory-id"],
    })).toEqual({ text: "NOT_SUPPORTED: The memory was not removed." });
  });

  it("preserves the explicit capability gate without enabling the registered command", () => {
    expect(createForgetCommand({ canDelete: true }).available).toBe(true);
    expect(forgetCommand.available).toBe(false);
  });

  it("skips offline memory diagnostics without starting external clients", async () => {
    const checks = await doctorChecks({ live: false, config: { projects: [{ id: "p1" }] } });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: "memory", status: "skip" });
    expect(checks[0].detail).toContain("checked live");
  });

  it("reports project memory unavailable and optional direct memory absent when live clients are missing", async () => {
    expect(await doctorChecks({ live: true, config: { projects: [{ id: "p1" }] } })).toEqual([
      { name: "memory:p1", status: "warn", detail: "MEMORY_UNAVAILABLE" },
      { name: "memory:openbrain-direct", status: "ok", detail: "Direct OpenBrain is not configured." },
    ]);
  });
});
