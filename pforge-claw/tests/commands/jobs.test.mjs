import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import jobsCommand, { currentJobsText } from "../../src/commands/jobs.mjs";
import { createJob, JOBS_STREAM, transition } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
const config = { projects: [
  { id: "p1", visibility: "normal" },
  { id: "private-fixture", visibility: "restricted" },
] };
async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-jobs-command-"));
  directories.push(directory);
  return createStore(directory);
}

function addJob(jobsStore, id, state, extra = {}) {
  const created = createJob({ id, type: "task", projectId: extra.projectId ?? "p1" });
  let job = { ...created.job, callerId: extra.callerId ?? "u1", createdAt: extra.createdAt ?? id, description: extra.description ?? id };
  jobsStore.append(JOBS_STREAM, { kind: "job.created", job });
  const states = ["awaiting-approval"];
  if (state !== "awaiting-approval") states.push("approved");
  if (["leased", "running", "failed", "succeeded"].includes(state)) states.push("leased");
  if (["running", "failed", "succeeded"].includes(state)) states.push("running");
  if (["failed", "succeeded"].includes(state)) states.push(state);
  for (const next of states) {
    const updated = transition(job, next);
    jobsStore.append(JOBS_STREAM, updated.event);
    job = updated.job;
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("/jobs", () => {
  it("filters by state and project, limits caller visibility, and reports empty results", async () => {
    const jobsStore = await store();
    addJob(jobsStore, "visible", "running", { callerId: "u1", createdAt: "2026-01-02" });
    addJob(jobsStore, "hidden", "failed", { callerId: "u2", createdAt: "2026-01-03" });
    expect(currentJobsText(jobsStore, { config, args: ["state=running", "project=p1"], caller: { userId: "u1", role: "viewer" } }).text)
      .toContain("visible");
    expect(currentJobsText(jobsStore, { config, caller: { userId: "u1", role: "viewer" } }).text).not.toContain("hidden");
    expect(currentJobsText(jobsStore, { config, args: ["state=cancelled"], caller: { userId: "u1", role: "viewer" } }).text)
      .toContain("No jobs match");
  });

  it.each(["owner", "approver"])("hides restricted jobs from general output for an %s", async (role) => {
    const jobsStore = await store();
    addJob(jobsStore, "normal-job", "running");
    addJob(jobsStore, "private-job", "running", {
      projectId: "private-fixture", description: "private-fixture-description",
    });
    const context = { services: { store: jobsStore, config } };
    const result = await jobsCommand.handle(context, { caller: { userId: "u1", role } });
    expect(result.text).toContain("normal-job");
    expect(result.text).not.toContain("private");
    const filtered = await jobsCommand.handle(context, {
      args: ["project=private-fixture"], caller: { userId: "u1", role },
    });
    expect(filtered.text).toContain("No jobs match");
    expect(filtered.text).not.toContain("private");
  });

  it("does not let a filter redirect a project topic to a different project", async () => {
    const jobsStore = await store();
    addJob(jobsStore, "private-job", "running", {
      projectId: "private-fixture", description: "private-fixture-description",
    });
    const result = await jobsCommand.handle({
      project: config.projects[0],
      services: { store: jobsStore, config },
    }, { args: ["project=private-fixture"], caller: { userId: "u1", role: "owner" } });
    expect(result.text).not.toContain("private");
    expect(result.text).toContain("JOBS_SCOPE_MISMATCH");
  });

  it("keeps a restricted project's own authorized topic readable", async () => {
    const jobsStore = await store();
    addJob(jobsStore, "normal-job", "running");
    addJob(jobsStore, "private-job", "running", {
      projectId: "private-fixture", description: "private-fixture-description",
    });
    const result = await jobsCommand.handle({
      project: config.projects[1],
      services: { store: jobsStore, registry: { all: () => config.projects } },
    }, { caller: { userId: "u1", role: "owner" } });
    expect(result.text).toContain("private-fixture-description");
    expect(result.text).not.toContain("normal-job");
  });

  it("returns explicit service and storage error states", () => {
    expect(currentJobsText(null)).toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
    expect(currentJobsText({ fold() { throw new Error("bad store"); } }, { caller: { role: "owner" } }))
      .toMatchObject({ text: expect.stringContaining("JOBS_UNAVAILABLE") });
  });

  it("refuses general output when project visibility metadata is unavailable", async () => {
    const jobsStore = await store();
    addJob(jobsStore, "unknown-project-job", "running");
    expect(currentJobsText(jobsStore, { caller: { role: "owner" } }).text)
      .toBe("SERVICE_UNAVAILABLE: Project visibility unavailable.");
  });
});
