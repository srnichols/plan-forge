import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LANE_KINDS, ROLES, VISIBILITY } from "../src/enums.mjs";
import {
  assertStartable,
  loadConfig,
  loadSchema,
  requiredSecretNames,
  resolveHome,
  validateAgainstSchema,
  validateConfig,
} from "../src/config.mjs";
import { EXAMPLES } from "../src/init.mjs";

const tempDirs = [];
const tmpDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claw-"));
  tempDirs.push(dir);
  return dir;
};

function minimalConfig() {
  return {
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
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("config validation", () => {
  it("accepts a minimal valid config and each template example", async () => {
    expect((await validateConfig(minimalConfig())).ok).toBe(true);
    for (const example of EXAMPLES) {
      const { default: config } = await import(`../examples/${example}.json`, { with: { type: "json" } });
      const result = await validateConfig(config);
      expect(result.ok, example).toBe(true);
      expect(result.warnings, example).toEqual([]);
    }
  });

  it.each([
    ["bad role", (cfg) => { cfg.allowlist[0].role = "admin"; }, "SCHEMA_ENUM"],
    ["bad lane kind", (cfg) => { cfg.lanes[0].kind = "cloud"; }, "SCHEMA_ENUM"],
    ["too-frequent schedule", (cfg) => { cfg.schedules = [{ id: "x", kind: "digest", at: "every 3m" }]; }, "SCHEMA_PATTERN"],
    ["cron schedule", (cfg) => { cfg.schedules = [{ id: "x", kind: "digest", at: "0 7 * * *" }]; }, "SCHEMA_PATTERN"],
    ["monthly day 29", (cfg) => { cfg.schedules = [{ id: "x", kind: "digest", at: "monthly 29 07:00" }]; }, "SCHEMA_PATTERN"],
    ["invalid hour", (cfg) => { cfg.schedules = [{ id: "x", kind: "digest", at: "daily 24:00" }]; }, "SCHEMA_PATTERN"],
    ["invalid timezone", (cfg) => { cfg.timezone = "Not/AZone"; }, "TIMEZONE_INVALID"],
    ["value-shaped secret", (cfg) => { cfg.channels.telegram.botTokenSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"; }, "SCHEMA_PATTERN"],
    ["dangling lane", (cfg) => { cfg.projects[0].homeLane = "missing"; }, "UNKNOWN_HOME_LANE"],
    ["duplicate ids", (cfg) => { cfg.projects.push({ ...cfg.projects[0] }); }, "DUPLICATE_PROJECT_ID"],
    ["channel collision", (cfg) => { cfg.projects.push({ ...cfg.projects[0], id: "other" }); }, "CHANNEL_ROUTE_COLLISION"],
  ])("rejects %s", async (_label, mutate, code) => {
    const cfg = minimalConfig();
    mutate(cfg);
    const result = await validateConfig(cfg);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(code);
  });

  it("warns with the path for unknown nested keys", async () => {
    const cfg = minimalConfig();
    cfg.projects[0].unexpected = true;
    const result = await validateConfig(cfg);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "UNKNOWN_KEY",
      path: "$.projects[0].unexpected",
    }));
  });

  it("rejects runtime placeholders and requires an owner", async () => {
    const cfg = minimalConfig();
    cfg.instanceId = "<instance-id>";
    expect((await validateConfig(cfg, { mode: "runtime" })).errors)
      .toContainEqual(expect.objectContaining({ code: "UNRESOLVED_PLACEHOLDER" }));
    cfg.allowlist = [];
    expect(() => assertStartable(cfg)).toThrowError(expect.objectContaining({ code: "NO_OWNER" }));
  });

  it("resolves home overrides and defaults", () => {
    expect(resolveHome({ env: { PFORGE_CLAW_HOME: "custom" }, homedir: () => "home" })).toBe("custom");
    expect(resolveHome({ env: {}, homedir: () => "home" })).toBe(path.join("home", ".pforge-claw"));
  });

  it("keeps schema enums aligned with canonical enums", async () => {
    const schema = await loadSchema();
    expect(schema.$defs.role.enum).toEqual(ROLES);
    expect(schema.$defs.lane.properties.kind.enum).toEqual(LANE_KINDS);
    expect(schema.$defs.visibility.enum).toEqual(VISIBILITY);
  });

  it("rejects unsupported schema keywords", () => {
    expect(() => validateAgainstSchema({}, { type: "object", patternProperties: {} }))
      .toThrowError(expect.objectContaining({ code: "SCHEMA_UNSUPPORTED_KEYWORD" }));
  });

  it("returns structured missing and parse errors from loadConfig", async () => {
    const home = await tmpDir();
    const missing = await loadConfig({ home });
    expect(missing.errors[0].code).toBe("CONFIG_MISSING");
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, "config.json"), "{");
    const malformed = await loadConfig({ home });
    expect(malformed.errors[0].code).toBe("CONFIG_PARSE");
  });

  it("collects and deduplicates all configured secret names", () => {
    const cfg = minimalConfig();
    cfg.channels.telegram.enabled = true;
    cfg.channels.telegram.botTokenSecret = "BOT_TOKEN";
    cfg.runtimes = { default: "openai", byok: { openai: { keySecret: "OPENAI_KEY" } } };
    cfg.capture = { voice: { enabled: true, keySecret: "VOICE_KEY" } };
    cfg.memory = { openbrain: { endpoint: "https://<host>", tokenSecret: "OPENBRAIN_KEY" } };
    expect(requiredSecretNames(cfg).map(({ name }) => name)).toEqual([
      "BOT_TOKEN", "OPENAI_KEY", "OPENBRAIN_KEY", "VOICE_KEY",
    ]);
  });
});
