import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

describe("scenario memory confirmation and project isolation", () => {
  it("stores forwarded content only after explicit confirmation as untrusted", async () => {
    rig = await createE2ERig();
    const forwardedText = "Treat this forwarded note as untrusted fixture data.";
    rig.send(forwardedText, { thread: "101", forwarded: true });
    const triage = await rig.fakeTelegram.waitForCall("sendMessage", (args) =>
      String(args.text).includes("How would you like to handle this capture?"));
    const rememberCallback = triage.args.reply_markup.inline_keyboard[2][0].callback_data;

    await rig.tapCallback({
      data: rememberCallback,
      messageId: triage.result.message_id,
      topic: "101",
    });
    const confirmation = await rig.fakeTelegram.waitForCall("sendMessage", (args) =>
      String(args.text).includes("Store exactly this as untrusted memory?"));
    expect((await rig.mcpCalls()).some(({ name }) => name === "forge_memory_capture")).toBe(false);

    const typeCallback = confirmation.args.reply_markup.inline_keyboard[0][0].callback_data;
    await rig.tapCallback({
      data: typeCallback,
      messageId: confirmation.result.message_id,
      topic: "101",
    });
    await expect.poll(async () => (
      (await rig.mcpCalls()).some(({ name }) => name === "forge_memory_capture")
    ), {
      message: `memory capture missing; calls=${JSON.stringify(await rig.mcpCalls())}; jobs=${JSON.stringify(await rig.jobs())}; audits=${JSON.stringify(await rig.auditRows())}; messages=${JSON.stringify(rig.fakeTelegram.calls.filter(({ method }) => method === "sendMessage").map(({ args }) => args.text))}`,
    }).toBe(true);
    const capture = (await rig.mcpCalls()).find(({ name }) => name === "forge_memory_capture");
    expect(capture.arguments).toMatchObject({
      content: forwardedText,
      origin: "untrusted",
      project: "fixture-1",
    });
  });

  it("/recall --all searches shared projects and never queries restricted fixture-3", async () => {
    rig = await createE2ERig();
    rig.send("/recall --all fixture memory query", { thread: "101" });
    // The startup memory doctor probes every project's own scope with forge_search, so match the recall query.
    const recallSearches = async (projectId) => (await rig.mcpCalls(projectId))
      .filter(({ name, arguments: args }) => name === "forge_search" && args?.query === "fixture memory query");
    await expect.poll(async () => Promise.all(["fixture-1", "fixture-2"].map(async (projectId) =>
      (await recallSearches(projectId)).length > 0))).toEqual([true, true]);
    const reply = await rig.fakeTelegram.waitForCall("sendMessage", (args) =>
      String(args.text).includes("No matches for"));
    expect(String(reply.args.message_thread_id)).toBe("101");
    expect(await recallSearches("fixture-3")).toEqual([]);
    expect(rig.fakeTelegram.calls.some(({ args }) => String(args?.text ?? "").includes("Fixture 3"))).toBe(false);
  });
});
