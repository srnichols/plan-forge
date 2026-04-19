import { describe, it, expect } from "vitest";
import { adapter } from "../index.mjs";
import { validateAdapterShape, ERR_NOT_IMPLEMENTED } from "../../../pforge-mcp/notifications/adapter-contract.mjs";

describe("notify-teams stub", () => {
  it("conforms to the adapter contract shape", () => {
    const result = validateAdapterShape(adapter);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("validate() returns not-installed without throwing", () => {
    const result = adapter.validate({});
    expect(result).toEqual({ ok: false, reason: "not-installed" });
  });

  it("send() rejects with ERR_NOT_IMPLEMENTED", async () => {
    await expect(adapter.send({})).rejects.toThrow();
    try {
      await adapter.send({});
    } catch (err) {
      expect(err.code).toBe(ERR_NOT_IMPLEMENTED);
    }
  });
});
