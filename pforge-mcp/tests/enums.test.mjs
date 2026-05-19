import { describe, it, expect } from "vitest";
import { HOOK_NAMES } from "../enums.mjs";

describe("enums baseline", () => {
  it("loads enums module", () => {
    expect(HOOK_NAMES).toBeDefined();
  });
});
