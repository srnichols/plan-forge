import { describe, expect, it } from "vitest";
import { createBudgetService } from "../../src/budget.mjs";
import { ClawError } from "../../src/errors.mjs";
import statusCommand from "../../src/commands/status.mjs";
import { createJob, JOBS_STREAM } from "../../src/jobs/model.mjs";
import { renderStatusRollup } from "../../src/crossproject.mjs";

const config = {
  projects: [
    { id: "alpha", name: "Alpha", budget: { dailyUSD: 5 } },
    { id: "beta", name: "Beta" },
    { id: "secret-canary-x", name: "Restricted Canary", visibility: "restricted" },
  ],
};

function makeStore({ fail = false } = {}) {
  const events = [];
  return {
    append(stream, record) {
      events.push({ stream, record });
    },
    fold(stream, reducer, initial) {
      if (fail) throw new ClawError("STORE_TEST_FAILURE");
      return events.filter((entry) => entry.stream === stream)
        .reduce((state, entry) => reducer(state, entry.record), initial);
    },
  };
}

describe("/status", () => {
  it("exposes the registry metadata required by command discovery", () => {
    expect(statusCommand).toMatchObject({
      name: "status",
      args: "",
      scope: "both",
      mutating: false,
      available: true,
    });
    expect(statusCommand.roles.length).toBeGreaterThan(0);
    expect(statusCommand.summary).toContain("visible project");
    expect(statusCommand.details).toContain("#general");
    expect(statusCommand.examples).toEqual(["/status", "/status jobs"]);
  });

  it("dispatches rollups to the current topic scope", async () => {
    const store = makeStore();
    const alpha = createJob({ id: "alpha-job", type: "task", projectId: "alpha" });
    store.append(JOBS_STREAM, { kind: "job.created", job: alpha.job });
    const services = {
      store,
      config,
      registry: { all: () => config.projects },
      budget: createBudgetService({ store, config }),
    };
    const general = await statusCommand.handle({ services }, { args: [] });
    const project = await statusCommand.handle(
      { services, project: { id: "secret-canary-x" } },
      { args: ["jobs"] },
    );
    expect(general.text).toContain("Alpha");
    expect(general.text).not.toContain("secret-canary-x");
    expect(project.text).toContain("Restricted Canary");
    expect(project.text).not.toContain("Alpha");
    expect(project.text).toBe(renderStatusRollup({
      projects: [{
        name: "Restricted Canary",
        counts: { queued: 0, "awaiting-approval": 0, "held-budget": 0, running: 0 },
        activeJobIds: [],
        spend: { costUSD: null, premiumRequests: null },
        caps: { costUSD: null, premiumRequests: null },
      }],
      total: {
        counts: { queued: 0, "awaiting-approval": 0, "held-budget": 0, running: 0 },
        spend: { costUSD: null, premiumRequests: null },
      },
      message: null,
    }));
  });

  it("wraps invalid arguments and store failures without exposing details", async () => {
    expect((await statusCommand.handle({}, { args: ["secret-canary-x"] })).text)
      .toBe("STATUS_USAGE: Usage: /status [jobs]");
    const result = await statusCommand.handle(
      { services: { store: makeStore({ fail: true }), config } },
      { args: [] },
    );
    expect(result.text).toBe("STORE_TEST_FAILURE: Status unavailable.");
    expect(result.text).not.toContain("secret-canary-x");
  });
});
