import { afterEach, describe, expect, it, vi } from "vitest";
import command from "../../src/commands/remember.mjs";
import { bindCaptureService } from "../../src/handlers/capture-commands.mjs";
import { ClawError } from "../../src/errors.mjs";

afterEach(() => bindCaptureService(null)());

describe("/remember command adapter", () => {
  it("is available, non-mutating and delegates through this.service", async () => {
    expect(command).toMatchObject({ available: true, mutating: false, sinceSlice: 7 });
    const startRemember = vi.fn(async () => []);
    const context = { project: { id: "p1" } };
    const args = { argsText: "fact", caller: { userId: "u1" }, chatId: "c1", threadId: "t1", updateId: "up1" };
    await expect(command.handle.call({ service: { startRemember } }, context, args)).resolves.toEqual([]);
    expect(startRemember).toHaveBeenCalledWith({
      project: context.project, caller: args.caller, chatId: "c1", threadId: "t1", updateId: "up1", text: "fact",
    });
  });

  it("delegates through the bound service and fails explicitly when unavailable", async () => {
    const startRemember = vi.fn(async () => [{ text: "ok" }]);
    const unbind = bindCaptureService({ startRemember });
    await expect(command.handle({}, { argsText: "fact" })).resolves.toEqual([{ text: "ok" }]);
    unbind();
    await expect(command.handle({}, {})).rejects.toMatchObject(new ClawError("SERVICE_UNAVAILABLE"));
  });
});
