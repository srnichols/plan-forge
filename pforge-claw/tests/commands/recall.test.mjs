import { afterEach, describe, expect, it, vi } from "vitest";
import command from "../../src/commands/recall.mjs";
import { bindCaptureService } from "../../src/handlers/capture-commands.mjs";

afterEach(() => bindCaptureService(null)());

describe("/recall command adapter", () => {
  it("is available, non-mutating and delegates through this.service", async () => {
    expect(command).toMatchObject({ available: true, mutating: false, sinceSlice: 7, scope: "both" });
    const recall = vi.fn(async () => [{ text: "memory" }]);
    const context = { project: { id: "p1" } };
    const args = { argsText: "query", caller: { userId: "u1" }, chatId: "c1", threadId: "t1", updateId: "up1" };
    await expect(command.handle.call({ service: { recall } }, context, args)).resolves.toEqual([{ text: "memory" }]);
    expect(recall).toHaveBeenCalledWith({
      project: context.project, caller: args.caller, chatId: "c1", threadId: "t1", updateId: "up1", text: "query",
    });
  });

  it("delegates through the bound service and fails explicitly when unavailable", async () => {
    const recall = vi.fn(async () => [{ text: "ok" }]);
    const unbind = bindCaptureService({ recall });
    await expect(command.handle({}, { argsText: "query" })).resolves.toEqual([{ text: "ok" }]);
    unbind();
    await expect(command.handle({}, {})).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
