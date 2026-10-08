import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";

const EXPECTED = Object.freeze({
  projectOwner: ["ask", "new", "remember", "recall", "idea", "bug", "run", "skill", "task", "abort", "retry", "status", "jobs", "budget", "help"],
  projectViewer: ["ask", "status", "help"],
  generalOwner: ["recall", "fanout", "status", "jobs", "budget", "help"],
  generalViewer: ["status", "help"],
});

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

async function sendAndCapture(options) {
  const prior = rig.fakeTelegram.calls.filter(({ method }) => method === "sendMessage").length;
  rig.send(options);
  const call = await rig.fakeTelegram.waitForCall("sendMessage", (_args, entry) =>
    rig.fakeTelegram.calls.indexOf(entry) >= 0
      && rig.fakeTelegram.calls.filter(({ method }) => method === "sendMessage").indexOf(entry) >= prior);
  return call.args.text;
}

function commandNames(text) {
  return [...text.matchAll(/^\/([a-z][a-z0-9-]*)\b[^—]*—/gm)].map((match) => match[1]);
}

describe("scenario (g) help command visibility", () => {
  it("compares project, general, viewer, and Telegram menu commands to independent expectations", async () => {
    rig = await createE2ERig();

    const projectOwner = await sendAndCapture({ text: "/help", threadId: "101", userId: "701" });
    expect(commandNames(projectOwner)).toEqual(EXPECTED.projectOwner);

    const projectViewer = await sendAndCapture({ text: "/help", threadId: "101", userId: "703" });
    expect(commandNames(projectViewer)).toEqual(EXPECTED.projectViewer);

    const generalOwner = await sendAndCapture({ text: "/help", userId: "701" });
    expect(commandNames(generalOwner)).toEqual(EXPECTED.generalOwner);

    const generalViewer = await sendAndCapture({ text: "/help", userId: "703" });
    expect(commandNames(generalViewer)).toEqual(EXPECTED.generalViewer);

    const expectedUnionForViewer = [...new Set([
      ...EXPECTED.projectViewer,
      ...EXPECTED.generalViewer,
    ])].sort();
    const registeredMenus = rig.fakeTelegram.menus().map(({ commands = [] }) =>
      commands.map(({ command }) => command).sort());
    expect(registeredMenus.at(-1)).toEqual(expectedUnionForViewer);
  });

  it("runs every command in the independently listed owner and viewer help sets", async () => {
    const inputs = {
      help: "/help",
      ask: "/ask describe this fixture",
      new: "/new",
      run: "/run docs/plans/Phase-1-DEMO-PLAN.md",
      skill: "/skill code-review",
      task: "/task inspect the fixture",
      status: "/status",
      jobs: "/jobs",
      budget: "/budget",
      remember: "/remember fixture fact",
      recall: "/recall fixture",
      idea: "/idea fixture idea",
      bug: "/bug fixture bug",
      abort: "/abort latest",
      retry: "/retry latest",
      fanout: "/fanout inspect fixtures",
    };
    const cases = [
      ["projectOwner", "101", "701"],
      ["projectViewer", "101", "703"],
      ["generalOwner", undefined, "701"],
      ["generalViewer", undefined, "703"],
    ];
    const unavailable = [];
    for (const [scope, threadId, userId] of cases) {
      rig = await createE2ERig();
      try {
        for (const command of EXPECTED[scope]) {
          const before = rig.fakeTelegram.calls.filter(({ method }) => method === "sendMessage").length;
          rig.send({ text: inputs[command], threadId, userId });
          try {
            const response = await rig.fakeTelegram.waitForCall("sendMessage", (_args, entry) =>
              rig.fakeTelegram.calls.indexOf(entry) >= 0
                && rig.fakeTelegram.calls.filter(({ method }) => method === "sendMessage").indexOf(entry) >= before,
            1000);
            if (/not permitted|isn't available|can't run right now|service unavailable/i.test(response.args.text)) {
              unavailable.push({ role: scope, command, response: response.args.text });
            }
          } catch (error) {
            unavailable.push({ role: scope, command, response: error.message });
          }
        }
      } finally {
        await rig.teardown();
        rig = null;
      }
    }
    expect(unavailable).toEqual([]);
  });
});
