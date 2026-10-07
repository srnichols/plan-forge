import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindBudgetService, createBudgetService } from "../../src/budget.mjs";
import budgetCommand from "../../src/commands/budget.mjs";
import { createJob, JOBS_STREAM, transition } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
const NOW = Date.parse("2026-10-07T12:00:00Z");
let unbind = null;

function makeStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "claw-budget-command-"));
  directories.push(directory);
  return createStore(directory);
}

function addHeldJob(store, id, projectId) {
  const created = createJob({ id, type: "task", projectId });
  store.append(JOBS_STREAM, { kind: "job.created", job: created.job });
  const waiting = transition(created.job, "awaiting-approval");
  store.append(JOBS_STREAM, waiting.event);
  const approved = transition(waiting.job, "approved");
  store.append(JOBS_STREAM, approved.event);
  const held = transition(approved.job, "held-budget", { reason: "budget:cap-usd" });
  store.append(JOBS_STREAM, held.event);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  unbind?.();
  unbind = null;
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("/budget", () => {
  it("renders only the project in a project topic and all visible projects in general", async () => {
    const store = makeStore();
    const service = createBudgetService({
      store,
      now: () => NOW,
      config: {
        timezone: "Etc/UTC",
        budget: { dailyUSD: 20 },
        projects: [
          { id: "p1", budget: { dailyUSD: 5 } },
          { id: "p2", budget: { dailyUSD: 8 } },
          { id: "secret", visibility: "restricted" },
        ],
      },
    });
    service.recordUsage({ source: "session", projectId: "p1", usage: { costUSD: 1 } });
    service.recordUsage({ source: "session", projectId: "p2", usage: { costUSD: 2 } });
    service.recordUsage({ source: "session", projectId: "secret", usage: { costUSD: 3 } });
    unbind = bindBudgetService(service);

    const projectResult = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } },
      { args: [], caller: { role: "approver" } },
    );
    expect(projectResult.text).toContain("p1");
    expect(projectResult.text).not.toContain("p2");

    const generalResult = await budgetCommand.handle(
      { scope: "general" },
      { args: ["today"], caller: { role: "approver" } },
    );
    expect(generalResult.text).toContain("p1");
    expect(generalResult.text).toContain("p2");
    expect(generalResult.text).not.toContain("secret");
    expect(generalResult.text).toContain("global");
  });

  it("renders the empty day, unreported usage, missing caps, and held jobs", async () => {
    const store = makeStore();
    const service = createBudgetService({
      store,
      now: () => NOW,
      config: { timezone: "Etc/UTC", projects: [{ id: "p1" }] },
    });
    unbind = bindBudgetService(service);
    expect((await budgetCommand.handle({ scope: "project", project: { id: "p1" } }, {})).text)
      .toContain("No budget activity recorded today (2026-10-07, Etc/UTC).");

    service.recordUsage({ source: "session", projectId: "p1", jobId: "unknown-job", usage: {} });
    addHeldJob(store, "held-budget-job", "p1");
    const rendered = (await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, { args: ["today"] },
    )).text;
    expect(rendered).toContain("unreported / no cap");
    expect(rendered).toContain("unknown 1");
    expect(rendered).toContain("held-budget-job  budget:cap-usd");
  });

  it("returns an unavailable message and usage hint for invalid arguments", async () => {
    expect((await budgetCommand.handle({}, {})).text).toBe("SERVICE_UNAVAILABLE: budget");
    const service = createBudgetService({ store: makeStore(), now: () => NOW });
    unbind = bindBudgetService(service);
    expect((await budgetCommand.handle({ scope: "general" }, { args: ["yesterday"] })).text)
      .toBe("Usage: /budget [today]");
  });
});
