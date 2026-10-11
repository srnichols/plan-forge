import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LANE_KINDS, ROLES, VISIBILITY } from "../src/enums.mjs";
import { RUNTIME_IDS } from "../src/runtime/agent-runtime.mjs";
import { BYOK_PROVIDERS } from "../src/runtime/byok.mjs";
import {
  assertStartable,
  INSTALL_MODES,
  loadConfig,
  loadSchema,
  requiredSecretNames,
  resolveHome,
  validateAgainstSchema,
  validateConfig,
} from "../src/config.mjs";
import { EXAMPLES } from "../src/init.mjs";

const directories = [];
const configurationFixture = async () => {
  const directory = path.join(fileURLToPath(new URL("./.lane-contract-review-fixtures/", import.meta.url)), `config-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  directories.push(directory);
  return directory;
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
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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
    ["invalid ghCommand", (cfg) => { cfg.runtimes = { ghCommand: [] }; }, "SCHEMA_ONE_OF"],
    ["value-shaped secret", (cfg) => { cfg.channels.telegram.botTokenSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"; }, "SCHEMA_PATTERN"],
    ["invalid k8s lane secret name", (cfg) => {
      cfg.lanes[0].kind = "k8s";
      cfg.lanes[0].k8s = { laneSecret: "not-a-secret-name" };
    }, "SCHEMA_PATTERN"],
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

  it("documents configured lane/project runtime, provider endpoint and project bootstrap without unknown keys", async () => {
    const cfg = minimalConfig();
    cfg.lanes[0].runtime = "byok:openai";
    cfg.projects[0].runtime = "anthropic";
    cfg.projects[0].bootstrap = { copy: [".forge.json"], env: ["CUSTOM_PROVIDER_KEY"], install: "none" };
    cfg.runtimes = {
      default: "copilot-sdk",
      byok: {
        openai: { endpoint: "https://provider.example", keySecret: "CUSTOM_PROVIDER_KEY" },
        anthropic: { endpoint: "https://provider.example", keySecret: "CUSTOM_PROVIDER_KEY" },
      },
    };
    const validated = await validateConfig(cfg);
    expect(validated.ok).toBe(true);
    expect(validated.warnings).toEqual([]);
  });

  it("reports secret names selected by lane and project runtimes without resolving values", () => {
    const cfg = minimalConfig();
    cfg.runtimes = { default: "copilot-sdk", byok: {
      openai: { endpoint: "https://provider.example", keySecret: "LANE_PROVIDER_KEY" },
      anthropic: { endpoint: "https://provider.example", keySecret: "PROJECT_PROVIDER_KEY" },
    } };
    cfg.lanes[0].runtime = "byok:openai";
    cfg.projects[0].runtime = "anthropic";
    expect(requiredSecretNames(cfg).map(({ name }) => name).sort())
      .toEqual(["LANE_PROVIDER_KEY", "PROJECT_PROVIDER_KEY"]);
  });

  it("validates both shipped Kubernetes overlay configs without undocumented fields", async () => {
    for (const overlay of ["example", "dev"]) {
      const file = new URL(`../deploy/k8s/overlays/${overlay}/config.json`, import.meta.url);
      const cfg = JSON.parse(await readFile(file, "utf8"));
      const result = await validateConfig(cfg);
      expect(result.ok, overlay).toBe(true);
      expect(result.warnings, overlay).toEqual([]);
    }
  });

  it("describes the existing configurable voice endpoint and model", async () => {
    const cfg = minimalConfig();
    cfg.capture = { voice: {
      enabled: true, provider: "openai", keySecret: "VOICE_KEY",
      endpoint: "https://transcription.example", model: "configured-transcription-model",
    } };
    const validated = await validateConfig(cfg);
    expect(validated.ok).toBe(true);
    expect(validated.warnings).toEqual([]);
  });

  it.each(["link", "ci", "npm-ci", "none"])("accepts the supported bootstrap install mode %s", async (install) => {
    const cfg = minimalConfig();
    cfg.bootstrap = { copy: [".forge.json"], env: [], install };
    expect((await validateConfig(cfg)).ok).toBe(true);
  });

  it.each(["unknown", "byok:other"])("rejects an unsupported configured runtime %s", async (runtime) => {
    const cfg = minimalConfig();
    cfg.projects[0].runtime = runtime;
    const validated = await validateConfig(cfg);
    expect(validated.ok).toBe(false);
    expect(validated.errors).toContainEqual(expect.objectContaining({ code: "SCHEMA_ENUM" }));
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
    expect(schema.$defs.bootstrap.properties.install.enum).toEqual(INSTALL_MODES);
    expect(schema.$defs.runtime.enum).toEqual([
      ...RUNTIME_IDS, ...BYOK_PROVIDERS.map((provider) => `byok:${provider}`),
    ]);
  });

  it("validates ghCommand, k8s laneSecret, and every deployment example", async () => {
    const config = minimalConfig();
    config.runtimes = { ghCommand: "auto" };
    config.lanes[0].kind = "k8s";
    config.lanes[0].k8s = { laneSecret: "PFORGE_CLAW_K8S_LANE_SECRET" };
    expect((await validateConfig(config)).ok).toBe(true);
    config.runtimes.ghCommand = [process.execPath, "gh-entry.mjs"];
    expect((await validateConfig(config)).ok).toBe(true);
    for (const example of ["single-host", "multi-host", "k8s"]) {
      const { default: exampleConfig } = await import(`../examples/${example}.json`, { with: { type: "json" } });
      expect(exampleConfig.runtimes.ghCommand, example).toBe("auto");
      const result = await validateConfig(exampleConfig);
      expect(result.ok, example).toBe(true);
      expect(result.warnings, example).toEqual([]);
    }
    const k8s = await import("../examples/k8s.json", { with: { type: "json" } });
    expect(k8s.default.lanes[0].k8s.laneSecret).toBe("PFORGE_CLAW_K8S_LANE_SECRET");
  });

  it("rejects unsupported schema keywords", () => {
    expect(() => validateAgainstSchema({}, { type: "object", patternProperties: {} }))
      .toThrowError(expect.objectContaining({ code: "SCHEMA_UNSUPPORTED_KEYWORD" }));
  });

  it("returns structured missing and parse errors from loadConfig", async () => {
    const home = await configurationFixture();
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

describe("config validation extraction characterizations", () => {
  it("preserves choice errors before the type guard and does not inspect invalid children", () => {
    expect(validateAgainstSchema(7, {
      oneOf: [{ const: 1 }, { const: 2 }],
      const: 3,
      enum: [4],
      type: "object",
      required: ["child"],
    })).toEqual({
      errors: [
        { path: "$", code: "SCHEMA_ONE_OF", message: "Value does not match exactly one allowed shape.", hint: "" },
        { path: "$", code: "SCHEMA_CONST", message: "Value does not match the required constant.", hint: "" },
        { path: "$", code: "SCHEMA_ENUM", message: "Value is not one of the permitted values.", hint: "" },
        { path: "$", code: "SCHEMA_TYPE", message: "Expected object.", hint: "" },
      ],
      warnings: [],
    });
  });

  it("preserves scalar constraint order and array child paths", () => {
    const schema = {
      type: "object",
      required: ["missing"],
      properties: {
        text: { type: "string", pattern: "^z", minLength: 3 },
        number: { type: "number", minimum: 2, maximum: 0 },
        items: { type: "array", minItems: 2, items: { type: "integer" } },
      },
      additionalProperties: false,
    };
    const result = validateAgainstSchema({ text: "a", number: 1, items: ["bad"], extra: true }, schema);
    expect(result.errors.map(({ path: issuePath, code }) => [issuePath, code])).toEqual([
      ["$.missing", "SCHEMA_REQUIRED"],
      ["$.text", "SCHEMA_PATTERN"],
      ["$.text", "SCHEMA_MIN_LENGTH"],
      ["$.number", "SCHEMA_MINIMUM"],
      ["$.number", "SCHEMA_MAXIMUM"],
      ["$.items", "SCHEMA_MIN_ITEMS"],
      ["$.items[0]", "SCHEMA_TYPE"],
      ["$.extra", "SCHEMA_ADDITIONAL_PROPERTY"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("resolves references exclusively and rejects missing or non-local references", () => {
    expect(validateAgainstSchema("value", {
      $defs: { value: { type: "string" } },
      $ref: "#/$defs/value",
      const: "ignored sibling",
    })).toEqual({ errors: [], warnings: [] });
    for (const reference of ["#/$defs/missing", "https://example.test/schema"]) {
      expect(() => validateAgainstSchema("value", { $ref: reference }))
        .toThrowError(expect.objectContaining({ code: "SCHEMA_UNSUPPORTED_KEYWORD" }));
    }
  });

  it("discards candidate warnings while enforcing exactly one matching shape", () => {
    const result = validateAgainstSchema({ extra: true }, {
      oneOf: [{ type: "object" }, { const: null }],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{
      path: "$.extra",
      code: "UNKNOWN_KEY",
      message: "Property is not described by the config schema.",
    }]);
    expect(validateAgainstSchema({}, {
      oneOf: [{ type: "object" }, { type: "object" }],
    }).errors).toEqual([{
      path: "$",
      code: "SCHEMA_ONE_OF",
      message: "Value does not match exactly one allowed shape.",
      hint: "",
    }]);
  });

  it("keeps semantic validation errors in their original traversal order", async () => {
    const config = minimalConfig();
    config.timezone = "Not/AZone";
    config.lanes.push({ ...config.lanes[0] });
    config.projects[0].homeLane = "missing";
    config.projects[0].placement = { prefer: ["missing"] };
    config.projects.push({ ...config.projects[0] });
    config.schedules = [{ id: "audit", kind: "skill", project: "missing", skill: "audit", at: "daily 07:00" }];
    config.allowlist[0].role = "viewer";
    const result = await validateConfig(config);
    expect(result.errors.map(({ path: issuePath, code }) => [issuePath, code])).toEqual([
      ["$.timezone", "TIMEZONE_INVALID"],
      ["$.lanes[1].id", "DUPLICATE_LANE_ID"],
      ["$.projects[0].homeLane", "UNKNOWN_HOME_LANE"],
      ["$.projects[0].placement.prefer", "UNKNOWN_PLACEMENT_LANE"],
      ["$.projects[1].id", "DUPLICATE_PROJECT_ID"],
      ["$.projects[1].homeLane", "UNKNOWN_HOME_LANE"],
      ["$.projects[1].placement.prefer", "UNKNOWN_PLACEMENT_LANE"],
      ["$.projects[1].channel", "CHANNEL_ROUTE_COLLISION"],
      ["$.schedules[0].project", "UNKNOWN_SCHEDULE_PROJECT"],
      ["$.allowlist", "NO_OWNER"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("distinguishes a general chat from topic zero but normalizes topic identifiers", async () => {
    const config = minimalConfig();
    config.projects.push({
      ...config.projects[0],
      id: "topic-zero",
      channel: { ...config.projects[0].channel, topicId: 0 },
    });
    expect((await validateConfig(config)).ok).toBe(true);
    config.projects.push({
      ...config.projects[1],
      id: "same-topic",
      channel: { ...config.projects[1].channel, topicId: "0" },
    });
    expect((await validateConfig(config)).errors).toContainEqual(expect.objectContaining({
      path: "$.projects[2].channel",
      code: "CHANNEL_ROUTE_COLLISION",
    }));
  });
});
