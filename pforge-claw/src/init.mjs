import { randomUUID as defaultRandomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { requiredSecretNames, validateConfig } from "./config.mjs";

export const EXAMPLES = Object.freeze(["single-host", "multi-host", "k8s"]);

async function readExample(example) {
  const filePath = fileURLToPath(new URL(`../examples/${example}.json`, import.meta.url));
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeConfig({ config, outDir, force }) {
  const configPath = path.join(outDir, "config.json");
  try {
    await access(configPath);
    if (!force) return { ok: false, configPath, errors: [{ code: "INIT_EXISTS", message: "Config already exists.", hint: "Use --force to replace it." }] };
  } catch (error) {
    if (error.code !== "ENOENT") {
      return { ok: false, configPath, errors: [{ code: "INIT_WRITE", message: "Existing config could not be checked.", hint: "" }] };
    }
  }
  const temporaryPath = `${configPath}.tmp`;
  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, configPath);
    return { ok: true, configPath };
  } catch {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      return { ok: false, configPath, errors: [{ code: "INIT_CLEANUP", message: "Config write failed and its temporary file could not be removed.", hint: "Remove the temporary config file after checking the destination directory." }] };
    }
    return { ok: false, configPath, errors: [{ code: "INIT_WRITE", message: "Config could not be written.", hint: "Check the destination directory permissions." }] };
  }
}

async function preserveInstanceId(config, configPath, force) {
  if (!force) return { instanceId: config.instanceId, preservedInstanceId: false };
  try {
    const previous = JSON.parse(await readFile(configPath, "utf8"));
    if (typeof previous.instanceId === "string" && previous.instanceId.length > 0) {
      return { instanceId: previous.instanceId, preservedInstanceId: true };
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return { instanceId: config.instanceId, preservedInstanceId: false };
}

export async function initFromExample({ example, outDir, force = false, randomUUID = defaultRandomUUID }) {
  if (!EXAMPLES.includes(example)) {
    return { ok: false, configPath: path.join(outDir, "config.json"), instanceId: null, preservedInstanceId: false, requiredSecrets: [], errors: [{ code: "INIT_UNKNOWN_EXAMPLE", message: "Unknown example name.", hint: `Choose one of: ${EXAMPLES.join(", ")}.` }] };
  }
  let config;
  try {
    config = await readExample(example);
  } catch {
    return { ok: false, configPath: path.join(outDir, "config.json"), instanceId: null, preservedInstanceId: false, requiredSecrets: [], errors: [{ code: "INIT_EXAMPLE_READ", message: "Example configuration could not be loaded.", hint: "" }] };
  }
  config.instanceId = randomUUID();
  const configPath = path.join(outDir, "config.json");
  let preservedInstanceId = false;
  try {
    const previous = await preserveInstanceId(config, configPath, force);
    config.instanceId = previous.instanceId;
    preservedInstanceId = previous.preservedInstanceId;
  } catch {
    return { ok: false, configPath, instanceId: null, preservedInstanceId: false, requiredSecrets: [], errors: [{ code: "INIT_CONFIG_READ", message: "Existing config could not be read.", hint: "" }] };
  }
  const validation = await validateConfig(config, { mode: "template" });
  if (!validation.ok) {
    return { ok: false, configPath, instanceId: null, preservedInstanceId, requiredSecrets: [], errors: validation.errors };
  }
  const written = await writeConfig({ config, outDir, force });
  return {
    ...written,
    instanceId: written.ok ? config.instanceId : null,
    preservedInstanceId,
    requiredSecrets: written.ok ? requiredSecretNames(config) : [],
    errors: written.errors ?? [],
  };
}

export async function initInteractive({ input = stdin, output = stdout, outDir, force = false, randomUUID = defaultRandomUUID } = {}) {
  const prompt = createInterface({ input, output });
  try {
    const timezone = await prompt.question("Timezone [Etc/UTC]: ") || "Etc/UTC";
    const ownerUserId = await prompt.question("Owner user ID: ");
    const chatId = await prompt.question("General chat ID: ");
    const topicId = await prompt.question("General topic ID (optional): ");
    const projectPath = await prompt.question("Project path: ");
    const projectId = await prompt.question("Project ID: ");
    const config = {
      v: 1,
      instanceId: randomUUID(),
      timezone,
      channels: { telegram: { enabled: true, botTokenSecret: "PFORGE_CLAW_TELEGRAM_TOKEN", mode: "poll" } },
      allowlist: [{ channel: "telegram", userId: ownerUserId, role: "owner" }],
      lanes: [{ id: "local", kind: "local", enabled: true }],
      projects: [{
        id: projectId,
        homeLane: "local",
        repo: { path: projectPath },
        channel: { adapter: "telegram", chatId, ...(topicId ? { topicId } : {}) },
        placement: { prefer: ["local"], requires: [] },
      }],
      schedules: [],
    };
    const validation = await validateConfig(config);
    if (!validation.ok) {
      return { ok: false, configPath: path.join(outDir, "config.json"), instanceId: null, preservedInstanceId: false, requiredSecrets: [], errors: validation.errors };
    }
    const written = await writeConfig({ config, outDir, force });
    return {
      ...written,
      instanceId: written.ok ? config.instanceId : null,
      preservedInstanceId: false,
      requiredSecrets: written.ok ? requiredSecretNames(config) : [],
      errors: written.errors ?? [],
    };
  } finally {
    prompt.close();
  }
}
