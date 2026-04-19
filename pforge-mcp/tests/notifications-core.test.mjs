import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  createNotificationCore,
  matchRoutes,
  TokenBucket,
  DigestTracker,
  resolveEnvTemplate,
  loadNotificationsConfig,
} from "../notifications/core.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-notify-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt) };
}

function writeConfig(dir, config) {
  const configDir = resolve(dir, ".forge", "notifications");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(resolve(configDir, "config.json"), JSON.stringify(config));
}

function makeAdapter(overrides = {}) {
  return {
    name: overrides.name || "test-adapter",
    send: overrides.send || vi.fn().mockResolvedValue({ ok: true, statusCode: 200 }),
    validate: overrides.validate || vi.fn().mockReturnValue({ ok: true }),
  };
}

// ─── Route Matching ──────────────────────────────────────────────────

describe("matchRoutes", () => {
  it("matches exact event type", () => {
    const routes = [{ when: { event: "slice-failed" }, via: ["webhook"] }];
    expect(matchRoutes({ type: "slice-failed" }, routes)).toEqual(["webhook"]);
  });

  it("matches glob pattern (tempering-*)", () => {
    const routes = [{ when: { event: "tempering-*" }, via: ["webhook"] }];
    expect(matchRoutes({ type: "tempering-visual-regression-detected" }, routes)).toEqual(["webhook"]);
  });

  it("returns empty array when no match", () => {
    const routes = [{ when: { event: "run-aborted" }, via: ["webhook"] }];
    expect(matchRoutes({ type: "slice-started" }, routes)).toEqual([]);
  });

  it("deduplicates adapter names from multiple routes", () => {
    const routes = [
      { when: { event: "slice-failed" }, via: ["webhook"] },
      { when: { event: "slice-*" }, via: ["webhook"] },
    ];
    expect(matchRoutes({ type: "slice-failed" }, routes)).toEqual(["webhook"]);
  });

  it("filters by severity >=high", () => {
    const routes = [{ when: { event: "incident-*", severity: ">=high" }, via: ["webhook"] }];
    expect(matchRoutes({ type: "incident-opened", data: { severity: "high" } }, routes)).toEqual(["webhook"]);
    expect(matchRoutes({ type: "incident-opened", data: { severity: "medium" } }, routes)).toEqual([]);
    expect(matchRoutes({ type: "incident-opened", data: { severity: "blocker" } }, routes)).toEqual(["webhook"]);
  });

  it("filters by severity =blocker (exact)", () => {
    const routes = [{ when: { event: "*", severity: "=blocker" }, via: ["webhook"] }];
    expect(matchRoutes({ type: "test", data: { severity: "blocker" } }, routes)).toEqual(["webhook"]);
    expect(matchRoutes({ type: "test", data: { severity: "high" } }, routes)).toEqual([]);
  });

  it("passes when no severity filter and event has severity", () => {
    const routes = [{ when: { event: "test" }, via: ["webhook"] }];
    expect(matchRoutes({ type: "test", data: { severity: "high" } }, routes)).toEqual(["webhook"]);
  });
});

// ─── Env-var Resolution ──────────────────────────────────────────────

describe("resolveEnvTemplate", () => {
  it("resolves ${env:X} from process.env", () => {
    process.env.__PFORGE_TEST_URL = "https://test.example.com";
    try {
      expect(resolveEnvTemplate("${env:__PFORGE_TEST_URL}")).toBe("https://test.example.com");
    } finally {
      delete process.env.__PFORGE_TEST_URL;
    }
  });

  it("rejects literal URL with ERR_LITERAL_SECRET", () => {
    expect(() => resolveEnvTemplate("https://hooks.slack.com/services/T00/B00/xxx"))
      .toThrow(/ERR_LITERAL_SECRET|literal URL/i);
  });

  it("returns empty string for missing env var", () => {
    expect(resolveEnvTemplate("${env:__PFORGE_NONEXISTENT_VAR_12345}")).toBe("");
  });
});

// ─── Token Bucket Rate Limiter ───────────────────────────────────────

describe("TokenBucket", () => {
  it("allows up to perMinute tokens", () => {
    const bucket = new TokenBucket({ perMinute: 3 });
    expect(bucket.tryConsume("a").ok).toBe(true);
    expect(bucket.tryConsume("a").ok).toBe(true);
    expect(bucket.tryConsume("a").ok).toBe(true);
    expect(bucket.tryConsume("a").ok).toBe(false);
  });

  it("denies after budget exhausted with reason", () => {
    const bucket = new TokenBucket({ perMinute: 1 });
    bucket.tryConsume("a");
    const result = bucket.tryConsume("a");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token-bucket");
  });

  it("refills after 60 seconds", () => {
    let now = 1000;
    const bucket = new TokenBucket({ perMinute: 1 }, () => now);
    expect(bucket.tryConsume("a").ok).toBe(true);
    expect(bucket.tryConsume("a").ok).toBe(false);

    now += 60_001; // Advance past 60s
    expect(bucket.tryConsume("a").ok).toBe(true);
  });

  it("isolates per adapter", () => {
    const bucket = new TokenBucket({ perMinute: 1 });
    expect(bucket.tryConsume("a").ok).toBe(true);
    expect(bucket.tryConsume("b").ok).toBe(true);
    expect(bucket.tryConsume("a").ok).toBe(false);
    expect(bucket.tryConsume("b").ok).toBe(false);
  });
});

// ─── Config Loading ──────────────────────────────────────────────────

describe("loadNotificationsConfig", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns defaults when config missing", () => {
    const config = loadNotificationsConfig(tmpDir);
    expect(config.enabled).toBe(false);
    expect(config.routes).toEqual([]);
  });

  it("loads valid config correctly", () => {
    writeConfig(tmpDir, { enabled: true, routes: [{ when: { event: "test" }, via: ["webhook"] }] });
    const config = loadNotificationsConfig(tmpDir);
    expect(config.enabled).toBe(true);
    expect(config.routes).toHaveLength(1);
  });

  it("returns defaults for corrupt JSON", () => {
    const configDir = resolve(tmpDir, ".forge", "notifications");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(resolve(configDir, "config.json"), "{{not valid json");
    const config = loadNotificationsConfig(tmpDir);
    expect(config.enabled).toBe(false);
  });
});

// ─── Core: NODE_ENV Guard ────────────────────────────────────────────

describe("createNotificationCore — NODE_ENV guard", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("ingest is no-op when NODE_ENV=test", () => {
    writeConfig(tmpDir, { enabled: true, routes: [{ when: { event: "*" }, via: ["test-adapter"] }], adapters: { "test-adapter": { enabled: true, url: "${env:__X}" } } });
    const adapter = makeAdapter();
    const core = createNotificationCore({ projectRoot: tmpDir, adapters: { "test-adapter": adapter } });
    // NODE_ENV is already "test" in vitest
    core.ingest({ type: "slice-failed" });
    expect(adapter.send).not.toHaveBeenCalled();
    core.shutdown();
  });
});

// ─── Core: Meta-event Filter ─────────────────────────────────────────

describe("createNotificationCore — meta-event filter", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("skips notification-sent event (cascade guard)", () => {
    writeConfig(tmpDir, { enabled: true, routes: [{ when: { event: "*" }, via: ["test-adapter"] }], adapters: { "test-adapter": { enabled: true, url: "${env:__X}" } } });
    const adapter = makeAdapter();
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const core = createNotificationCore({ projectRoot: tmpDir, adapters: { "test-adapter": adapter } });
      core.ingest({ type: "notification-sent" });
      core.ingest({ type: "notification-send-failed" });
      expect(adapter.send).not.toHaveBeenCalled();
      core.shutdown();
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

// ─── Core: Hub Events ────────────────────────────────────────────────

describe("createNotificationCore — hub events", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("emits notification-sent on successful dispatch", async () => {
    writeConfig(tmpDir, {
      enabled: true,
      routes: [{ when: { event: "slice-failed" }, via: ["test-adapter"] }],
      adapters: { "test-adapter": { enabled: true, url: "${env:__PFORGE_TEST_HUB_URL}" } },
    });
    process.env.__PFORGE_TEST_HUB_URL = "http://localhost:9999";
    const hub = makeHub();
    const adapter = makeAdapter();
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const core = createNotificationCore({ hub, projectRoot: tmpDir, adapters: { "test-adapter": adapter } });
      core.ingest({ type: "slice-failed" });
      // Wait for async dispatch
      await new Promise((r) => setTimeout(r, 50));
      const sent = hub.events.find((e) => e.type === "notification-sent");
      expect(sent).toBeDefined();
      expect(sent.adapter).toBe("test-adapter");
      core.shutdown();
    } finally {
      process.env.NODE_ENV = origEnv;
      delete process.env.__PFORGE_TEST_HUB_URL;
    }
  });

  it("emits notification-send-failed on adapter error", async () => {
    writeConfig(tmpDir, {
      enabled: true,
      routes: [{ when: { event: "slice-failed" }, via: ["test-adapter"] }],
      adapters: { "test-adapter": { enabled: true, url: "${env:__PFORGE_TEST_HUB_URL2}" } },
    });
    process.env.__PFORGE_TEST_HUB_URL2 = "http://localhost:9999";
    const hub = makeHub();
    const adapter = makeAdapter({ send: vi.fn().mockRejectedValue(new Error("connection refused")) });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const core = createNotificationCore({ hub, projectRoot: tmpDir, adapters: { "test-adapter": adapter } });
      core.ingest({ type: "slice-failed" });
      await new Promise((r) => setTimeout(r, 50));
      const failed = hub.events.find((e) => e.type === "notification-send-failed");
      expect(failed).toBeDefined();
      expect(failed.adapter).toBe("test-adapter");
      core.shutdown();
    } finally {
      process.env.NODE_ENV = origEnv;
      delete process.env.__PFORGE_TEST_HUB_URL2;
    }
  });
});

// ─── Core: Null URL Warning ──────────────────────────────────────────

describe("createNotificationCore — null URL warning", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("warns once when adapter URL resolves to empty", async () => {
    writeConfig(tmpDir, {
      enabled: true,
      routes: [{ when: { event: "test" }, via: ["test-adapter"] }],
      adapters: { "test-adapter": { enabled: true, url: "${env:__PFORGE_NONEXISTENT_URL_XYZ}" } },
    });
    const hub = makeHub();
    const adapter = makeAdapter();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const core = createNotificationCore({ hub, projectRoot: tmpDir, adapters: { "test-adapter": adapter } });
      core.ingest({ type: "test" });
      core.ingest({ type: "test" });
      await new Promise((r) => setTimeout(r, 50));
      const warns = warnSpy.mock.calls.filter((c) => c[0]?.includes?.("[notifications]"));
      expect(warns.length).toBe(1); // Only warned once
      expect(adapter.send).not.toHaveBeenCalled();
      core.shutdown();
    } finally {
      process.env.NODE_ENV = origEnv;
      warnSpy.mockRestore();
    }
  });
});

// ─── Core: Disabled Config ───────────────────────────────────────────

describe("createNotificationCore — disabled", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns no-op core when config.enabled is false", () => {
    writeConfig(tmpDir, { enabled: false });
    const core = createNotificationCore({ projectRoot: tmpDir });
    expect(core.ingest({ type: "test" })).toBeUndefined();
    expect(core.directSend({ via: "webhook", payload: {} })).toEqual({ ok: false, error: "Notifications disabled" });
    core.shutdown();
  });
});

// ─── Core: directSend ────────────────────────────────────────────────

describe("createNotificationCore — directSend", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns error for unknown adapter", async () => {
    writeConfig(tmpDir, { enabled: true, adapters: {} });
    const core = createNotificationCore({ projectRoot: tmpDir });
    const result = await core.directSend({ via: "nonexistent", payload: { type: "test" } });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ERR_ADAPTER_NOT_FOUND");
    core.shutdown();
  });

  it("sends via adapter on directSend", async () => {
    writeConfig(tmpDir, { enabled: true, adapters: { webhook: { enabled: true, url: "${env:__PFORGE_DS_URL}" } } });
    process.env.__PFORGE_DS_URL = "http://localhost:9999";
    const adapter = makeAdapter();
    try {
      const core = createNotificationCore({ projectRoot: tmpDir, adapters: { webhook: adapter } });
      const result = await core.directSend({ via: "webhook", payload: { type: "test" } });
      expect(result.ok).toBe(true);
      expect(adapter.send).toHaveBeenCalled();
      core.shutdown();
    } finally {
      delete process.env.__PFORGE_DS_URL;
    }
  });
});

// ─── Core: testAdapter ───────────────────────────────────────────────

describe("createNotificationCore — testAdapter", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("validates all adapters when no adapter specified", () => {
    writeConfig(tmpDir, { enabled: true, adapters: { webhook: { enabled: true, url: "${env:__X}" } } });
    const adapter = makeAdapter({ name: "webhook" });
    const core = createNotificationCore({ projectRoot: tmpDir, adapters: { webhook: adapter } });
    const result = core.testAdapter({});
    expect(result.ok).toBe(true);
    expect(result.adapters).toHaveLength(1);
    expect(result.adapters[0].name).toBe("webhook");
    expect(result.adapters[0].configValid).toBe(true);
    core.shutdown();
  });

  it("reports unregistered adapter", () => {
    writeConfig(tmpDir, { enabled: true });
    const core = createNotificationCore({ projectRoot: tmpDir });
    const result = core.testAdapter({ adapter: "nonexistent" });
    expect(result.adapters[0].configValid).toBe(false);
    expect(result.adapters[0].reason).toContain("not-registered");
    core.shutdown();
  });
});

// ─── Digest Tracker ──────────────────────────────────────────────────

describe("DigestTracker", () => {
  it("sends individually under digestAfter threshold", () => {
    const tracker = new DigestTracker({ digestAfter: 3 });
    expect(tracker.track("key1", { type: "a" })).toBe(true);
    expect(tracker.track("key1", { type: "a" })).toBe(true);
    expect(tracker.track("key1", { type: "a" })).toBe(true);
    tracker.shutdown();
  });

  it("coalesces events above digestAfter threshold", () => {
    const tracker = new DigestTracker({ digestAfter: 2 });
    expect(tracker.track("key1", { type: "a" })).toBe(true);
    expect(tracker.track("key1", { type: "a" })).toBe(true);
    expect(tracker.track("key1", { type: "a" })).toBe(false); // coalesced
    tracker.shutdown();
  });
});
