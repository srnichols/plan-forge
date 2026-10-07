import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JOB_STATES } from "../src/enums.mjs";
import { ClawError } from "../src/errors.mjs";
import {
  createJob,
  currentJobs,
  JOBS_STREAM,
  reduceJobs,
  TERMINAL,
  TRANSITIONS,
  TRANSITION_STATES,
  transition,
} from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];
const makeDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "claw-jobs-"));
  directories.push(directory);
  return directory;
};
const makeJob = (id, type = "plan", options = {}) => createJob({
  id,
  type,
  projectId: "project-1",
  ...options,
}).job;
const walk = (job, states) => {
  let current = job;
  for (const state of states) current = transition(current, state).job;
  return current;
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("job model", () => {
  it("follows the complete mutating approval, budget, and execution path", () => {
    const job = walk(makeJob("mutating-1"), [
      "awaiting-approval",
      "approved",
      "held-budget",
      "approved",
      "leased",
      "running",
      "needs-input",
      "running",
      "succeeded",
    ]);
    expect(job.state).toBe("succeeded");
  });

  it("allows read jobs and read-only skills on the read path only", () => {
    expect(walk(makeJob("ask-1", "ask"), ["leased", "running", "succeeded"]).state)
      .toBe("succeeded");
    expect(walk(makeJob("skill-read", "skill", { readOnly: true }), ["leased"]).state)
      .toBe("leased");
    for (const job of [makeJob("skill-write", "skill"), makeJob("plan-1", "plan")]) {
      expect(() => transition(job, "leased")).toThrowError(expect.objectContaining({
        code: "JOB_TRANSITION_ILLEGAL",
      }));
    }
  });

  it("rejects every illegal state edge without mutating the job", () => {
    for (const [type, mutating] of [["ask", false], ["plan", true]]) {
      const table = TRANSITIONS[mutating ? "mutating" : "read"];
      for (const from of JOB_STATES) {
        for (const to of JOB_STATES) {
          if (table[from]?.includes(to)) continue;
          const job = { ...makeJob(`${type}-${from}`, type), state: from, mutating };
          const before = { ...job };
          expect(() => transition(job, to)).toThrowError(expect.objectContaining({
            code: "JOB_TRANSITION_ILLEGAL",
          }));
          expect(job).toEqual(before);
        }
      }
    }
    for (const state of TERMINAL) {
      const job = { ...makeJob(`terminal-${state}`), state };
      for (const to of JOB_STATES) {
        expect(() => transition(job, to)).toThrowError(expect.objectContaining({
          code: "JOB_TRANSITION_ILLEGAL",
        }));
      }
    }
  });

  it("validates job fields, destination states, and transition metadata", () => {
    expect(() => makeJob("bad-type", "unknown")).toThrowError(
      expect.objectContaining({ code: "JOB_BAD_FIELD", details: { field: "type" } }),
    );
    expect(() => makeJob("../bad")).toThrowError(
      expect.objectContaining({ code: "JOB_BAD_FIELD", details: { field: "id" } }),
    );
    expect(() => createJob({ id: "job", type: "ask", projectId: "bad/id" })).toThrowError(
      expect.objectContaining({ code: "JOB_BAD_FIELD", details: { field: "projectId" } }),
    );
    expect(() => transition(makeJob("valid"), "unknown")).toThrowError(
      expect.objectContaining({ code: "JOB_TRANSITION_ILLEGAL" }),
    );
    expect(() => transition(makeJob("valid"), "awaiting-approval", null)).toThrowError(
      expect.objectContaining({ code: "JOB_BAD_META" }),
    );
    const result = transition(makeJob("valid"), "awaiting-approval", {
      reason: "approved by operator",
      sensitive: "must not be copied",
    });
    expect(result.event).toEqual({
      kind: "job.transition",
      jobId: "valid",
      from: "queued",
      to: "awaiting-approval",
      reason: "approved by operator",
    });
    expect(result.event).not.toHaveProperty("sensitive");
  });

  it("folds current jobs consistently before and after reopening and snapshotting", () => {
    const directory = makeDirectory();
    const store = createStore(directory);
    const first = createJob({ id: "job-one", type: "plan", projectId: "project-1" });
    const second = createJob({ id: "job-two", type: "ask", projectId: "project-1" });
    store.append(JOBS_STREAM, first.event);
    store.append(JOBS_STREAM, second.event);
    store.append(JOBS_STREAM, transition(first.job, "awaiting-approval").event);
    store.append(JOBS_STREAM, transition(second.job, "leased").event);
    store.snapshot(JOBS_STREAM, reduceJobs, {});
    store.append(JOBS_STREAM, transition(
      transition(first.job, "awaiting-approval").job,
      "approved",
    ).event);
    store.append(JOBS_STREAM, transition(transition(second.job, "leased").job, "running").event);

    const expected = currentJobs(store);
    expect(currentJobs(createStore(directory))).toEqual(expected);
    unlinkSync(join(directory, `${JOBS_STREAM}.snapshot.json`));
    expect(createStore(directory).fold(JOBS_STREAM, reduceJobs, {})).toEqual(expected);
    expect(expected["job-one"].state).toBe("approved");
    expect(expected["job-two"].state).toBe("running");
  });

  it("rejects duplicate creates, unknown jobs, and replay mismatches", () => {
    const created = createJob({ id: "duplicate", type: "ask", projectId: "project-1" });
    const withCreated = reduceJobs({}, created.event);
    expect(() => reduceJobs(withCreated, created.event)).toThrowError(
      expect.objectContaining({ code: "JOB_DUPLICATE" }),
    );
    expect(() => reduceJobs({}, {
      kind: "job.transition",
      jobId: "missing",
      from: "queued",
      to: "leased",
    })).toThrowError(expect.objectContaining({ code: "JOB_UNKNOWN" }));
    expect(() => reduceJobs(withCreated, {
      kind: "job.transition",
      jobId: "duplicate",
      from: "running",
      to: "succeeded",
    })).toThrowError(expect.objectContaining({ code: "JOB_REPLAY_MISMATCH" }));
    expect(() => reduceJobs(withCreated, {
      kind: "job.transition",
      jobId: "duplicate",
      from: "queued",
      to: "succeeded",
    })).toThrowError(expect.objectContaining({ code: "JOB_TRANSITION_ILLEGAL" }));
    expect(() => reduceJobs({}, { kind: "unknown" })).toThrowError(ClawError);
  });

  it("keeps transition keys and destinations aligned with job states", () => {
    const covered = new Set(TRANSITION_STATES);
    expect([...covered].sort()).toEqual([...JOB_STATES].sort());
    for (const state of TERMINAL) {
      for (const table of Object.values(TRANSITIONS)) expect(table).not.toHaveProperty(state);
    }
  });
});
