import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_KINDS, ROLES, VISIBILITY } from "./enums.mjs";
import { ClawError } from "./errors.mjs";

export const CHANNEL_MODES = Object.freeze(["poll", "webhook"]);
export const INSTALL_MODES = Object.freeze(["link", "ci", "npm-ci", "none"]);
const SCHEMA_PATH = fileURLToPath(new URL("../config.schema.json", import.meta.url));
const SCHEMA_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "type", "properties", "required", "additionalProperties",
  "items", "enum", "const", "pattern", "minimum", "maximum", "minItems", "minLength",
  "oneOf", "default", "description", "x-known",
]);

function collectRuntimeSecretNames(config, add) {
  const runtimeConfig = config.runtimes ?? {};
  const runtimes = [
    runtimeConfig.default,
    runtimeConfig.nonOwnerRuntime ?? config.policy?.nonOwnerRuntime,
    ...(config.lanes ?? []).map((lane) => lane.runtime),
    ...(config.projects ?? []).map((project) => project.runtime),
  ];
  for (const runtime of runtimes) {
    if (typeof runtime !== "string" || !runtimeConfig.byok) continue;
    const entry = runtimeConfig.byok[runtime.replace(/^byok:/, "")];
    if (entry?.keySecret) add(entry.keySecret, `${runtime} runtime`);
  }
}

function addIssue({ target, path: pathName, code, message, hint = "" }) {
  target.push({ path: pathName, code, message, hint });
}

function typeMatches(value, type) {
  if (Array.isArray(type)) return type.some((member) => typeMatches(value, member));
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function resolveReference(schema, reference) {
  if (typeof reference !== "string" || !reference.startsWith("#/$defs/")) {
    throw new ClawError("SCHEMA_UNSUPPORTED_KEYWORD");
  }
  return schema.$defs?.[reference.slice("#/$defs/".length)];
}

function checkUnsupportedKeywords(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYWORDS.has(key)) throw new ClawError("SCHEMA_UNSUPPORTED_KEYWORD", { keyword: key });
    if (key === "additionalProperties" && typeof value !== "boolean") {
      throw new ClawError("SCHEMA_UNSUPPORTED_KEYWORD", { keyword: key });
    }
    if (key === "properties" || key === "$defs") {
      for (const child of Object.values(value)) checkUnsupportedKeywords(child);
    } else if (key === "items" || key === "oneOf") {
      for (const child of Array.isArray(value) ? value : [value]) checkUnsupportedKeywords(child);
    }
  }
}

function validateChoices({ value, schema, rootSchema, path: pathName, errors }) {
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      const candidateErrors = [];
      validateNode({ value, schema: candidate, rootSchema, path: pathName, errors: candidateErrors, warnings: [] });
      return candidateErrors.length === 0;
    }).length;
    if (matches !== 1) addIssue({ target: errors, path: pathName, code: "SCHEMA_ONE_OF", message: "Value does not match exactly one allowed shape." });
  }
  if (schema.const !== undefined && value !== schema.const) {
    addIssue({ target: errors, path: pathName, code: "SCHEMA_CONST", message: "Value does not match the required constant." });
  }
  if (schema.enum && !schema.enum.includes(value)) {
    addIssue({ target: errors, path: pathName, code: "SCHEMA_ENUM", message: "Value is not one of the permitted values." });
  }
}

function validateScalar({ value, schema, path: pathName, errors }) {
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      addIssue({ target: errors, path: pathName, code: "SCHEMA_PATTERN", message: "Value does not match the required format." });
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      addIssue({ target: errors, path: pathName, code: "SCHEMA_MIN_LENGTH", message: "Value is shorter than the minimum length." });
    }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    addIssue({ target: errors, path: pathName, code: "SCHEMA_MINIMUM", message: "Value is below the permitted minimum." });
  }
  if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) {
    addIssue({ target: errors, path: pathName, code: "SCHEMA_MAXIMUM", message: "Value exceeds the permitted maximum." });
  }
}

function validateNode({ value, schema, rootSchema, path: pathName, errors, warnings }) {
  if (schema.$ref) {
    const target = resolveReference(rootSchema, schema.$ref);
    if (!target) throw new ClawError("SCHEMA_UNSUPPORTED_KEYWORD");
    validateNode({ value, schema: target, rootSchema, path: pathName, errors, warnings });
    return;
  }
  validateChoices({ value, schema, rootSchema, path: pathName, errors });
  if (schema.type && !typeMatches(value, schema.type)) {
    addIssue({ target: errors, path: pathName, code: "SCHEMA_TYPE", message: `Expected ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}.` });
    return;
  }
  validateScalar({ value, schema, path: pathName, errors });
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      addIssue({ target: errors, path: pathName, code: "SCHEMA_MIN_ITEMS", message: "Array has fewer than the required number of items." });
    }
    if (schema.items) value.forEach((item, index) => {
      validateNode({ value: item, schema: schema.items, rootSchema, path: `${pathName}[${index}]`, errors, warnings });
    });
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        addIssue({ target: errors, path: `${pathName}.${required}`, code: "SCHEMA_REQUIRED", message: "Required property is missing." });
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, member] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateNode({ value: member, schema: properties[key], rootSchema, path: `${pathName}.${key}`, errors, warnings });
      } else if (schema.additionalProperties === false) {
        addIssue({ target: errors, path: `${pathName}.${key}`, code: "SCHEMA_ADDITIONAL_PROPERTY", message: "Additional property is not allowed." });
      } else {
        warnings.push({ path: `${pathName}.${key}`, code: "UNKNOWN_KEY", message: "Property is not described by the config schema." });
      }
    }
  }
}

function findRequiredPlaceholders({ value, nodeSchema, rootSchema, path: pathName, errors, required = false }) {
  const schema = nodeSchema.$ref ? resolveReference(rootSchema, nodeSchema.$ref) : nodeSchema;
  if (typeof value === "string" && required && /^<[^>]+>$/.test(value)) {
    addIssue({ target: errors, path: pathName, code: "UNRESOLVED_PLACEHOLDER", message: "Required value still contains a placeholder." });
  } else if (Array.isArray(value)) {
    if (schema.items) value.forEach((member, index) => {
      findRequiredPlaceholders({ value: member, nodeSchema: schema.items, rootSchema, path: `${pathName}[${index}]`, errors });
    });
  } else if (value !== null && typeof value === "object") {
    for (const [key, member] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) {
        findRequiredPlaceholders({
          value: member,
          nodeSchema: childSchema,
          rootSchema,
          path: `${pathName}.${key}`,
          errors,
          required: (schema.required ?? []).includes(key),
        });
      }
    }
  }
}

function validateProjects({ config, laneIds, errors }) {
  const projectIds = new Set();
  const channelRoutes = new Set();
  for (const [index, project] of (config.projects ?? []).entries()) {
    const root = `$.projects[${index}]`;
    if (projectIds.has(project.id)) addIssue({ target: errors, path: `${root}.id`, code: "DUPLICATE_PROJECT_ID", message: "Project id is duplicated." });
    projectIds.add(project.id);
    if (project.homeLane && !laneIds.has(project.homeLane)) {
      addIssue({ target: errors, path: `${root}.homeLane`, code: "UNKNOWN_HOME_LANE", message: "Home lane does not exist." });
    }
    for (const laneId of project.placement?.prefer ?? []) {
      if (!laneIds.has(laneId)) addIssue({ target: errors, path: `${root}.placement.prefer`, code: "UNKNOWN_PLACEMENT_LANE", message: "Preferred lane does not exist." });
    }
    const chatId = project.channel?.chatId;
    const topicId = project.channel?.topicId;
    if (chatId !== undefined) {
      const route = JSON.stringify([String(chatId), topicId === undefined ? "__general__" : `id:${String(topicId)}`]);
      if (channelRoutes.has(route)) addIssue({ target: errors, path: `${root}.channel`, code: "CHANNEL_ROUTE_COLLISION", message: "Another project uses this channel route." });
      channelRoutes.add(route);
    }
  }
  return projectIds;
}

function validateTimezone({ config, mode, errors }) {
  if (typeof config.timezone === "string" && !(mode === "template" && /^<[^>]+>$/.test(config.timezone))) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: config.timezone });
    } catch {
      addIssue({ target: errors, path: "$.timezone", code: "TIMEZONE_INVALID", message: "Timezone is not a valid IANA time zone." });
    }
  }
}

function semanticChecks({ config, mode, errors, schema }) {
  validateTimezone({ config, mode, errors });
  const laneIds = new Set();
  for (const [index, lane] of (config.lanes ?? []).entries()) {
    if (laneIds.has(lane.id)) addIssue({ target: errors, path: `$.lanes[${index}].id`, code: "DUPLICATE_LANE_ID", message: "Lane id is duplicated." });
    laneIds.add(lane.id);
  }
  const projectIds = validateProjects({ config, laneIds, errors });
  for (const [index, schedule] of (config.schedules ?? []).entries()) {
    if (schedule.project && !projectIds.has(schedule.project)) {
      addIssue({ target: errors, path: `$.schedules[${index}].project`, code: "UNKNOWN_SCHEDULE_PROJECT", message: "Schedule project does not exist." });
    }
  }
  if (!(config.allowlist ?? []).some((entry) => entry.role === "owner")) {
    addIssue({ target: errors, path: "$.allowlist", code: "NO_OWNER", message: "At least one allowlist owner is required." });
  }
  if (mode === "runtime") findRequiredPlaceholders({ value: config, nodeSchema: schema, rootSchema: schema, path: "$", errors });
}

function flattenRequiredSecrets(config) {
  const required = [];
  const add = (name, reason) => {
    if (typeof name === "string" && !required.some((entry) => entry.name === name)) required.push({ name, reason });
  };
  const telegram = config.channels?.telegram;
  if (telegram?.enabled) {
    add(telegram.botTokenSecret, "Telegram bot token");
    if (telegram.mode === "webhook") add(telegram.webhook?.secretTokenSecret, "Telegram webhook secret");
  }
  if (config.worker) add(config.worker.secretName, "Worker authentication");
  collectRuntimeSecretNames(config, add);
  if (config.memory?.openbrain?.endpoint) add(config.memory.openbrain.tokenSecret, "OpenBrain access");
  if (config.capture?.voice?.enabled) add(config.capture.voice.keySecret, "Voice capture");
  return required;
}

export function resolveHome({ env = process.env, homedir = os.homedir } = {}) {
  return env.PFORGE_CLAW_HOME || path.join(homedir(), ".pforge-claw");
}

export async function loadSchema() {
  return JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
}

export function validateAgainstSchema(value, schema) {
  checkUnsupportedKeywords(schema);
  const errors = [];
  const warnings = [];
  validateNode({ value, schema, rootSchema: schema, path: "$", errors, warnings });
  return { errors, warnings };
}

export async function validateConfig(cfg, { mode = "template" } = {}) {
  const schema = await loadSchema();
  const { errors, warnings } = validateAgainstSchema(cfg, schema);
  if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) semanticChecks({ config: cfg, mode, errors, schema });
  return { ok: errors.length === 0, errors, warnings };
}

export async function loadConfig({ home = resolveHome() } = {}) {
  const configPath = path.join(home, "config.json");
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ok: false, config: null, path: configPath, errors: [{ path: "$", code: "CONFIG_MISSING", message: "Config file is missing.", hint: "Run pforge claw init." }], warnings: [] };
    }
    return { ok: false, config: null, path: configPath, errors: [{ path: "$", code: "CONFIG_READ", message: "Config file could not be read.", hint: "" }], warnings: [] };
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return { ok: false, config: null, path: configPath, errors: [{ path: "$", code: "CONFIG_PARSE", message: "Config file is not valid JSON.", hint: "Repair config.json or run init with --force." }], warnings: [] };
  }
  const result = await validateConfig(config);
  return { ...result, config, path: configPath };
}

export function assertStartable(config) {
  if (!(config.allowlist ?? []).some((entry) => entry.role === "owner")) throw new ClawError("NO_OWNER");
}

export function requiredSecretNames(config) {
  return flattenRequiredSecrets(config);
}

export { LANE_KINDS, ROLES, VISIBILITY };
