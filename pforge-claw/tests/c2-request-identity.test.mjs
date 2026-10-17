import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJob, currentJobs } from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";
import { c2Fixture, cleanupC2Fixtures } from "./c2-fixtures.mjs";
import {
  requestIdentity, requestKey, findRequestJob, withRequestIdentity, ensureRequestJob, normalizeRequestFields,
} from "../src/jobs/request-identity.mjs";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T15:00:00.000Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  await cleanupC2Fixtures();
});

function request(f, extra = {}) {
  return {
    adapter: "telegram", updateId: "original", type: "task", projectId: f.project.id,
    callerId: f.caller.userId, chatId: f.deps.chatId, threadId: f.deps.threadId, parentId: null, ...extra,
  };
}

describe("C2 durable request identity", () => {
  it("normalizes and validates scalar scope even for distinct identity-less direct calls", async () => {
    const f = await c2Fixture();
    expect(normalizeRequestFields({ ...request(f), updateId: undefined, chatId: 0, threadId: 12 }))
      .toEqual({ ...request(f), updateId: null, chatId: "0", threadId: "12" });
    for (const field of ["adapter", "updateId", "callerId", "chatId", "threadId", "parentId"]) {
      expect(() => normalizeRequestFields({ ...request(f), updateId: undefined, [field]: {} })).toThrow("REQUEST_BAD_IDENTITY");
    }
    expect(requestIdentity(normalizeRequestFields({ ...request(f), updateId: undefined }))).toBeNull();
  });
  it("normalizes only the full scoped identity, never content, and leaves direct calls distinct", async () => {
    const f = await c2Fixture();
    const identity = requestIdentity({ ...request(f), text: "private text", callerRole: "owner", runtime: "openai" });
    expect(identity).toEqual(request(f));
    expect(requestIdentity({ ...request(f), updateId: null })).toBeNull();
    expect(requestKey(identity)).not.toContain("private");
    for (const field of ["adapter", "updateId", "type", "projectId", "callerId", "chatId", "threadId", "parentId"]) {
      expect(requestKey({ ...identity, [field]: "different" })).not.toBe(requestKey(identity));
    }
  });

  it("serializes duplicate operations, removes failed chains and reloads full durable state", async () => {
    const f = await c2Fixture();
    const identity = requestIdentity(request(f));
    let active = 0;
    let peak = 0;
    const operation = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      const prepared = await ensureRequestJob({ store: f.store, request: identity, fields: { description: "fixture" } });
      active -= 1;
      return prepared.job.id;
    };
    const ids = await Promise.all([
      withRequestIdentity({ identity }, operation),
      withRequestIdentity({ identity }, operation),
    ]);
    expect(peak).toBe(1);
    expect(ids[0]).toBe(ids[1]);
    expect(findRequestJob(createStore(f.stateDirectory), identity).id).toBe(ids[0]);
    expect(findRequestJob(f.store, { ...identity, callerId: "other-caller" })).toBeNull();
    await expect(withRequestIdentity({ identity }, () => { throw new Error("fixture failure"); })).rejects.toThrow("fixture failure");
    expect(await withRequestIdentity({ identity }, () => "recovered")).toBe("recovered");
  });

  it("repairs committed queued mutations exactly once and retains declared fanout children", async () => {
    const f = await c2Fixture();
    const identity = request(f);
    const created = createJob({ id: "fixture-task", type: identity.type, projectId: identity.projectId });
    f.store.append("jobs", { kind: "job.created", job: { ...created.job, ...identity } });
    const repaired = await ensureRequestJob({ store: f.store, request: identity, fields: { description: "new text is irrelevant" } });
    expect(repaired).toMatchObject({ recovered: true, job: { id: "fixture-task", state: "awaiting-approval" } });
    await ensureRequestJob({ store: f.store, request: identity });
    expect([...f.store.read("jobs")].filter(({ record }) => record.kind === "job.transition")).toHaveLength(1);
    const familyIdentity = request(f, { type: "fanout", updateId: "family" });
    const family = createJob({ id: "family-parent", type: "fanout", projectId: identity.projectId });
    f.store.append("jobs", {
      kind: "job.created", job: { ...family.job, ...familyIdentity, children: ["declared-one", "declared-two"] },
    });
    expect(findRequestJob(createStore(f.stateDirectory), familyIdentity).children).toEqual(["declared-one", "declared-two"]);
    expect(Object.values(currentJobs(f.store))).toHaveLength(2);
  });
});
