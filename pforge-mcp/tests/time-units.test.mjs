import { describe, expect, it } from "vitest";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from "../time-units.mjs";

describe("time-units", () => {
  it("defines each unit in milliseconds", () => {
    expect(MS_PER_SECOND).toBe(1_000);
    expect(MS_PER_MINUTE).toBe(60_000);
    expect(MS_PER_HOUR).toBe(3_600_000);
    expect(MS_PER_DAY).toBe(86_400_000);
  });
});
