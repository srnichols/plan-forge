import { describe, expect, it } from "vitest";
import fanoutCommand from "../../src/commands/fanout.mjs";
import { currentJobs } from "../../src/jobs/model.mjs";

const config = {
  projects: [
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
    { id: "secret-canary-x", visibility: "restricted" },
  ],
};

function makeStore() {
  const events = [];
  return {
    append(stream, record) {
      events.push({ stream, record });
    },
    fold(stream, reducer, initial) {
      return events.filter((entry) => entry.stream === stream)
        .reduce((state, entry) => reducer(state, entry.record), initial);
    },
  };
}

describe("/fanout", () => {
  it("exposes the registry metadata required by command discovery", () => {
    expect(fanoutCommand).toMatchObject({
      name: "fanout",
      args: "<task> [-- projects…]",
      scope: "general",
      mutating: true,
      available: true,
    });
    expect(fanoutCommand.roles).toEqual(["owner", "approver"]);
    expect(fanoutCommand.summary).toContain("across projects");
    expect(fanoutCommand.details).toContain("One approval covers all targets");
    expect(fanoutCommand.examples[1]).toContain("-- alpha beta");
  });

  it("creates jobs through injected services and returns safe errors", async () => {
    const store = makeStore();
    const services = { store, config, registry: { all: () => config.projects } };
    const result = await fanoutCommand.handle({ services }, {
      argsText: "check dependencies -- alpha beta",
      caller: { userId: "requester" },
      chatId: "general-chat",
      threadId: "general-topic",
    });
    expect(result.text).toContain("awaiting approval for 2 projects");
    expect(Object.values(currentJobs(store)).filter((job) => job.type === "task")).toHaveLength(2);

    const restricted = await fanoutCommand.handle({ services }, {
      argsText: "check dependencies -- secret-canary-x",
      caller: { userId: "requester" },
      chatId: "general-chat",
    });
    const unknown = await fanoutCommand.handle({ services }, {
      argsText: "check dependencies -- unknown-project",
      caller: { userId: "requester" },
      chatId: "general-chat",
    });
    expect(restricted.text).toBe("FANOUT_UNKNOWN_PROJECT: Fan-out was not created.");
    expect(unknown.text).toBe(restricted.text);
    expect(restricted.text).not.toContain("secret-canary-x");
  });
});
