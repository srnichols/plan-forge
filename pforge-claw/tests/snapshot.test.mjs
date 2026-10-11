import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildClawSnapshot } from "../src/snapshot.mjs";
import { JOBS_STREAM } from "../src/jobs/model.mjs";

const PROJECT = {
  id: "project-1",
  displayName: "Project _one_",
  visibility: "restricted",
  channel: { chatId: "home-chat", topicId: 7 },
};

function createSnapshotStore(streams = {}) {
  return {
    *read(stream) {
      for (const record of streams[stream] ?? []) yield { record };
    },
  };
}

function jobRecord(id, state, projectId = PROJECT.id) {
  return { kind: "job.created", job: { id, state, projectId } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-02T12:00:00.000Z"));
});

afterEach(() => vi.useRealTimers());

describe("Claw snapshot extraction characterizations", () => {
  it("retains the exact missing-context payload and unavailable fields", () => {
    expect(buildClawSnapshot()).toEqual({
      kind: "pforge-claw-state",
      v: 1,
      project: null,
      data: {
        sessions: { available: false },
        queue: { available: false },
        approvals: { available: false },
        spendToday: null,
        features: {},
      },
      truncated: false,
    });
  });

  it("folds project and channel sessions, scoped jobs and today's spend without substituting unknown values", () => {
    const store = createSnapshotStore({
      sessions: [
        { projectId: PROJECT.id, chatId: "a", topicId: 0, sessionId: "closed" },
        { project: { id: PROJECT.id }, chatId: "a", topicId: 0, sessionId: null },
        { project: PROJECT.id, chatId: "b", topicId: 1, sessionId: "active" },
        { job: { projectId: PROJECT.id }, chatId: "c", sessionId: "active" },
        { chatId: "home-chat", topicId: "7", sessionId: "routed" },
        { projectId: "other", chatId: "other-chat", sessionId: "excluded" },
        { projectId: PROJECT.id, chatId: 123, sessionId: "not-counted" },
      ],
      [JOBS_STREAM]: [
        jobRecord("queued", "queued"),
        jobRecord("held", "held-budget"),
        jobRecord("approval", "awaiting-approval"),
        jobRecord("completed", "succeeded"),
        jobRecord("other-job", "queued", "other"),
      ],
      budget: [
        { projectId: PROJECT.id, ts: "2030-01-02T00:00:00Z", usage: { costUsd: 0, usd: 99 } },
        { project: PROJECT.id, ts: "2030-01-02", usage: { usd: 2 } },
        { project: { id: PROJECT.id }, ts: "2030-01-02T08:00:00Z", usage: { cost: 3 } },
        { projectId: PROJECT.id, ts: "2030-01-02", usage: { costUsd: Number.POSITIVE_INFINITY, usd: 99 } },
        { projectId: PROJECT.id, ts: "2030-01-01", usage: { costUsd: 99 } },
        { projectId: "other", ts: "2030-01-02", usage: { costUsd: 99 } },
      ],
    });
    expect(buildClawSnapshot({ store }, { project: PROJECT })).toEqual({
      kind: "pforge-claw-state",
      v: 1,
      project: { id: PROJECT.id, name: PROJECT.displayName, visibility: "restricted" },
      data: {
        sessions: { available: true, count: 3 },
        queue: { available: true, queued: 1, held: 1 },
        approvals: { available: true, pending: 1 },
        spendToday: 5,
        features: {},
      },
      truncated: false,
    });
  });

  it("uses explicit approval records before job-based approval counts", () => {
    const store = createSnapshotStore({
      [JOBS_STREAM]: [jobRecord("approval", "awaiting-approval")],
      approvals: [
        { projectId: PROJECT.id, state: "pending" },
        { projectId: PROJECT.id, status: "pending" },
        { projectId: PROJECT.id, state: "consumed" },
        { projectId: "other", state: "pending" },
      ],
    });
    expect(buildClawSnapshot({ store }, { project: PROJECT }).data.approvals)
      .toEqual({ available: true, pending: 2 });
  });

  it("retains available zero counts when only other projects have job history", () => {
    const store = createSnapshotStore({ [JOBS_STREAM]: [jobRecord("other-job", "queued", "other")] });
    const snapshot = buildClawSnapshot({ store }, { project: PROJECT });
    expect(snapshot.data.queue).toEqual({ available: true, queued: 0, held: 0 });
    expect(snapshot.data.approvals).toEqual({ available: true, pending: 0 });
    expect(snapshot.data.sessions).toEqual({ available: false });
  });

  it.each([
    [[{ projectId: PROJECT.id, ts: "2030-01-01", usage: { costUsd: 1 } }], null],
    [[{ projectId: PROJECT.id, ts: "2030-01-02", usage: { costUsd: "1" } }], null],
    [[{ projectId: PROJECT.id, ts: "2030-01-02", usage: { costUsd: 0 } }], 0],
  ])("preserves null versus zero spend for %s", (budget, expected) => {
    const store = createSnapshotStore({ budget });
    expect(buildClawSnapshot({ store }, { project: PROJECT }).data.spendToday).toBe(expected);
  });

  it("redacts strings, strips sensitive keys and preserves cycle/shared-reference normalization", () => {
    const shared = { label: "sensitive-canary _label_" };
    const value = {
      label: "sensitive-canary",
      tokenCount: 5,
      api_key: "sensitive-canary",
      nested: {
        content: "sensitive-canary",
        count: Number.NaN,
        enabled: true,
        missing: undefined,
      },
      first: shared,
      second: shared,
      array: [Number.POSITIVE_INFINITY, false, () => undefined],
    };
    value.self = value;
    const secrets = { redact: (text) => text.replaceAll("sensitive-canary", "[redacted]") };
    const snapshot = buildClawSnapshot({
      secrets,
      features: [{ name: "sample", available: true, snapshot: () => value }],
    }, { project: { id: "sensitive-canary", name: "_name_" } });
    expect(snapshot.project).toEqual({ id: "[redacted]", name: "_name_", visibility: "normal" });
    expect(snapshot.data.features.sample).toEqual({
      label: "[redacted]",
      nested: { count: null, enabled: true, missing: null },
      first: { label: "[redacted] _label_" },
      second: null,
      array: [null, false, null],
      self: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain("sensitive-canary");
  });

  it("omits disabled/null features and preserves explicit feature exceptions", () => {
    const disabled = vi.fn();
    const snapshot = buildClawSnapshot({
      features: [
        { name: "disabled", available: false, snapshot: disabled },
        { name: "missing", available: true },
        { name: "null", available: true, snapshot: () => null },
        { name: "undefined", available: true, snapshot: () => undefined },
        { name: "failed", available: true, snapshot: () => { throw new Error("private detail"); } },
        { name: "zero", available: true, snapshot: () => 0 },
      ],
    });
    expect(snapshot.data.features).toEqual({ failed: { available: false }, zero: 0 });
    expect(disabled).not.toHaveBeenCalled();
  });

  it("removes the largest feature first and enforces the byte cap for multibyte strings", () => {
    const snapshot = buildClawSnapshot({
      features: [
        { name: "large", available: true, snapshot: () => "é".repeat(2200) },
        { name: "small", available: true, snapshot: () => ({ count: 1 }) },
      ],
    }, { project: PROJECT });
    expect(snapshot.data.features).toEqual({ small: { count: 1 } });
    expect(snapshot.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(snapshot), "utf8")).toBeLessThanOrEqual(4096);
  });

  it("preserves the minimal fallback payload when project metadata alone exceeds the cap", () => {
    expect(buildClawSnapshot({}, { project: { ...PROJECT, displayName: "x".repeat(5000) } })).toEqual({
      kind: "pforge-claw-state",
      v: 1,
      project: { id: PROJECT.id },
      data: {
        sessions: { available: false },
        queue: { available: false },
        approvals: { available: false },
        spendToday: null,
      },
      truncated: true,
    });
  });

  it("does not silently replace store read failures with unavailable counts", () => {
    const error = new Error("store read failed");
    const store = { read: () => { throw error; } };
    expect(() => buildClawSnapshot({ store }, { project: PROJECT })).toThrow(error);
  });
});
