import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateConfig } from "../src/config.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createRouter } from "../src/router.mjs";
import { createStore } from "../src/state/store.mjs";

/**
 * Meta-bug #333 — the inbound message rate limit (20 per user per minute) had no
 * config key, so an operator could not tune it. Found on the way: the injected
 * `rateLimit` option was spread into the limiter unchecked, so a partial object
 * such as `{ perMinute: 5 }` left the window undefined and the limiter admitted
 * every message — throttling silently off.
 */

const PROJECT = {
  id: "limit-project",
  name: "Limit project",
  channel: { adapter: "telegram", chatId: "project-chat", topicId: "project-topic" },
  repo: { path: "/repos/limit-project" },
  homeLane: "main",
};

const directories = [];
let previousHome;

beforeEach(() => { previousHome = process.env.PFORGE_CLAW_HOME; });
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.PFORGE_CLAW_HOME;
  else process.env.PFORGE_CLAW_HOME = previousHome;
});

const makeConfig = (policy = {}) => ({
  channels: {
    telegram: {
      botUsername: "clawbot",
      generalChat: { chatId: "general-chat", topicId: "general-topic" },
    },
  },
  allowlist: [{ channel: "telegram", userId: "owner-id", role: "owner" }],
  policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only", ...policy },
  lanes: [{ id: "main", kind: "local", enabled: true }],
  runtimes: { default: "copilot-sdk" },
  projects: [PROJECT],
});

function makeRouter({ config = makeConfig(), rateLimit, now = () => 0 } = {}) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "claw-rate-limit-"));
  directories.push(stateDir);
  process.env.PFORGE_CLAW_HOME = stateDir;
  const store = createStore(stateDir);
  const channel = {
    send: vi.fn(async () => {}),
    edit: vi.fn(async () => {}),
    typing: vi.fn(async () => {}),
    answerCallback: vi.fn(async () => {}),
    setMenu: vi.fn(async () => {}),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const router = createRouter({
    config, channel, store, registry: createRegistry(config), logger, now,
    ...(rateLimit === undefined ? {} : { rateLimit }),
  });
  return { router, store };
}

const update = (n) => ({
  v: 1,
  adapter: "telegram",
  updateId: `update-${n}`,
  kind: "message",
  chatId: "project-chat",
  threadId: "project-topic",
  userId: "owner-id",
  text: "/help",
  callbackId: null,
  data: null,
});

const THROTTLED = { dropped: true, throttled: true };

/** How many of `count` messages sent at `at` are admitted. */
async function admitted(router, count, start = 0) {
  let handled = 0;
  for (let n = start; n < start + count; n += 1) {
    const result = await router.route(update(n));
    if (!result.throttled) handled += 1;
  }
  return handled;
}

describe("policy.inboundRateLimit (#333)", () => {
  it("admits the configured number of messages and drops the rest", async () => {
    const { router } = makeRouter({ config: makeConfig({ inboundRateLimit: { perMinute: 2, windowMs: 60_000 } }) });
    await expect(router.route(update(1))).resolves.toMatchObject({ handled: true });
    await expect(router.route(update(2))).resolves.toMatchObject({ handled: true });
    await expect(router.route(update(3))).resolves.toEqual(THROTTLED);
  });

  it("uses the configured window", async () => {
    let now = 0;
    const { router } = makeRouter({
      config: makeConfig({ inboundRateLimit: { perMinute: 1, windowMs: 1_000 } }),
      now: () => now,
    });
    await expect(router.route(update(1))).resolves.toMatchObject({ handled: true });
    now = 999;
    await expect(router.route(update(2))).resolves.toEqual(THROTTLED);
    now = 1_000;
    await expect(router.route(update(3))).resolves.toMatchObject({ handled: true });
  });

  it("keeps 20 messages per minute when nothing is configured", async () => {
    const { router } = makeRouter();
    expect(await admitted(router, 25)).toBe(20);
  });

  it("fills in the default window when only perMinute is configured", async () => {
    let now = 0;
    const { router } = makeRouter({
      config: makeConfig({ inboundRateLimit: { perMinute: 2 } }),
      now: () => now,
    });
    expect(await admitted(router, 3)).toBe(2);
    now = 59_999;
    await expect(router.route(update(10))).resolves.toEqual(THROTTLED);
    now = 60_000;
    await expect(router.route(update(11))).resolves.toMatchObject({ handled: true });
  });

  it("fills in the default count when only windowMs is configured", async () => {
    const { router } = makeRouter({ config: makeConfig({ inboundRateLimit: { windowMs: 5_000 } }) });
    expect(await admitted(router, 25)).toBe(20);
  });

  it("lets the injected rateLimit option override the config", async () => {
    const { router } = makeRouter({
      config: makeConfig({ inboundRateLimit: { perMinute: 2, windowMs: 60_000 } }),
      rateLimit: { perMinute: 3, windowMs: 60_000 },
    });
    expect(await admitted(router, 5)).toBe(3);
  });
});

describe("a partial rateLimit never turns throttling off (#333)", () => {
  it("keeps throttling when the injected option names only perMinute", async () => {
    const { router } = makeRouter({ rateLimit: { perMinute: 2 } });
    expect(await admitted(router, 60)).toBe(2);
  });

  it("keeps throttling when the injected option names only windowMs", async () => {
    const { router } = makeRouter({ rateLimit: { windowMs: 60_000 } });
    expect(await admitted(router, 60)).toBe(20);
  });

  it("treats an undefined member as not given", async () => {
    const { router } = makeRouter({ rateLimit: { perMinute: undefined, windowMs: undefined } });
    expect(await admitted(router, 25)).toBe(20);
  });
});

describe("an unusable rate limit is refused at start-up (#333)", () => {
  it.each([
    ["perMinute", 0],
    ["perMinute", -1],
    ["perMinute", 1.5],
    ["perMinute", "20"],
    ["perMinute", Number.NaN],
    ["perMinute", Number.POSITIVE_INFINITY],
    ["perMinute", null],
    ["windowMs", 0],
    ["windowMs", -5],
    ["windowMs", null],
  ])("rejects %s = %s from the injected option", (field, value) => {
    expect(() => makeRouter({ rateLimit: { [field]: value } }))
      .toThrowError(expect.objectContaining({
        code: "INVALID_RATE_LIMIT",
        details: { field, source: "rateLimit option" },
      }));
  });

  it("rejects a member that is not perMinute or windowMs, since a typo would otherwise fall back silently", () => {
    expect(() => makeRouter({ rateLimit: { perminute: 5 } }))
      .toThrowError(expect.objectContaining({ code: "INVALID_RATE_LIMIT", details: { field: "perminute", source: "rateLimit option" } }));
  });

  it("rejects a bad value from the config too, naming where it came from", () => {
    expect(() => makeRouter({ config: makeConfig({ inboundRateLimit: { perMinute: 0 } }) }))
      .toThrowError(expect.objectContaining({
        code: "INVALID_RATE_LIMIT",
        details: { field: "perMinute", source: "policy.inboundRateLimit" },
      }));
  });
});

describe("config schema (#333)", () => {
  const base = () => ({
    v: 1,
    instanceId: "instance",
    timezone: "Etc/UTC",
    channels: { telegram: { enabled: false, mode: "poll" } },
    allowlist: [{ channel: "telegram", userId: "<user-id>", role: "owner" }],
    lanes: [{ id: "local", kind: "local", enabled: true }],
    projects: [{
      id: "sample",
      homeLane: "local",
      repo: { path: "/path/to/project" },
      channel: { adapter: "telegram", chatId: "<chat-id>" },
    }],
  });
  const withLimit = (inboundRateLimit) => ({ ...base(), policy: { inboundRateLimit } });

  it("describes policy.inboundRateLimit, so a configured value draws no unknown-key warning", async () => {
    const result = await validateConfig(withLimit({ perMinute: 5, windowMs: 30_000 }));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts either member alone", async () => {
    expect((await validateConfig(withLimit({ perMinute: 5 }))).ok).toBe(true);
    expect((await validateConfig(withLimit({ windowMs: 1_000 }))).ok).toBe(true);
  });

  it.each([
    ["zero perMinute", { perMinute: 0 }, "SCHEMA_MINIMUM"],
    ["zero windowMs", { windowMs: 0 }, "SCHEMA_MINIMUM"],
    ["fractional perMinute", { perMinute: 1.5 }, "SCHEMA_TYPE"],
    ["string windowMs", { windowMs: "60000" }, "SCHEMA_TYPE"],
    ["unknown member", { perMinute: 5, burst: 10 }, "SCHEMA_ADDITIONAL_PROPERTY"],
  ])("rejects %s", async (_label, limit, code) => {
    const result = await validateConfig(withLimit(limit));
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code }));
  });
});
