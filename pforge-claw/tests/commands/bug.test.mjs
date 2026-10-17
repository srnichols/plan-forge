import { afterEach, describe, expect, it, vi } from "vitest";
import command from "../../src/commands/bug.mjs";
import { bindCaptureService } from "../../src/handlers/capture-commands.mjs";

afterEach(() => bindCaptureService(null)());

describe("/bug command adapter", () => {
  it("is available, non-mutating and delegates through this.service", async () => {
    expect(command).toMatchObject({ available: true, mutating: false, sinceSlice: 7 });
    const bug = vi.fn(async () => [{ text: "BUG-1" }]);
    const context = { project: { id: "p1" } };
    const args = { argsText: "bug text", caller: { userId: "u1" }, chatId: "c1", threadId: "t1", updateId: "up1" };
    await expect(command.handle.call({ service: { bug } }, context, args)).resolves.toEqual([{ text: "BUG-1" }]);
    expect(bug).toHaveBeenCalledWith({
      project: context.project, caller: args.caller, chatId: "c1", threadId: "t1", updateId: "up1", text: "bug text",
    });
  });

  it("delegates through the bound service and fails explicitly when unavailable", async () => {
    const bug = vi.fn(async () => [{ text: "ok" }]);
    const unbind = bindCaptureService({ bug });
    await expect(command.handle({}, { argsText: "report" })).resolves.toEqual([{ text: "ok" }]);
    unbind();
    await expect(command.handle({}, {})).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
