import { afterEach, describe, expect, it, vi } from "vitest";
import command from "../../src/commands/idea.mjs";
import { bindCaptureService } from "../../src/handlers/capture-commands.mjs";

afterEach(() => bindCaptureService(null)());

describe("/idea command adapter", () => {
  it("is available, non-mutating and delegates through this.service", async () => {
    expect(command).toMatchObject({ available: true, mutating: false, sinceSlice: 7 });
    const idea = vi.fn(async () => [{ text: "smelt" }]);
    const context = { project: { id: "p1" } };
    const args = { argsText: "idea text", caller: { userId: "u1" }, chatId: "c1", threadId: "t1", updateId: "up1" };
    await expect(command.handle.call({ service: { idea } }, context, args)).resolves.toEqual([{ text: "smelt" }]);
    expect(idea).toHaveBeenCalledWith({
      project: context.project, caller: args.caller, chatId: "c1", threadId: "t1", updateId: "up1", text: "idea text",
    });
  });

  it("delegates through the bound service and fails explicitly when unavailable", async () => {
    const idea = vi.fn(async () => [{ text: "ok" }]);
    const unbind = bindCaptureService({ idea });
    await expect(command.handle({}, { argsText: "idea" })).resolves.toEqual([{ text: "ok" }]);
    unbind();
    await expect(command.handle({}, {})).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
