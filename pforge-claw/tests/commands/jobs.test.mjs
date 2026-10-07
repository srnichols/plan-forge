import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentJobsText } from "../../src/commands/jobs.mjs";
import { createJob, JOBS_STREAM, transition } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-jobs-command-"));
  directories.push(directory);
  return createStore(directory);
}

function addJob(jobsStore, id, state, extra = {}) {
  const created = createJob({ id, type: "task", projectId: "p1" });
  let job = { ...created.job, callerId: extra.callerId ?? "u1", createdAt: extra.createdAt ?? id, description: id };
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
    expect(currentJobsText(jobsStore, { args: ["state=running", "project=p1"], caller: { userId: "u1", role: "viewer" } }).text)
      .toContain("visible");
    expect(currentJobsText(jobsStore, { caller: { userId: "u1", role: "viewer" } }).text).not.toContain("hidden");
    expect(currentJobsText(jobsStore, { args: ["state=cancelled"], caller: { userId: "u1", role: "viewer" } }).text)
      .toContain("No jobs match");
  });

  it("returns explicit service and storage error states", () => {
    expect(currentJobsText(null)).toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
    expect(currentJobsText({ fold() { throw new Error("bad store"); } }, { caller: { role: "owner" } }))
      .toMatchObject({ text: expect.stringContaining("JOBS_UNAVAILABLE") });
  });
});
