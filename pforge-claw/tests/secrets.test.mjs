import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkSecretsFilePermissions, createSecrets } from "../src/secrets.mjs";

const tempDirs = [];
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = async () => {
  const dir = await mkdtemp(path.join(TEST_DIRECTORY, ".claw-secrets-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("secrets", () => {
  it("prefers env values and does not resurrect an empty env value", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    await writeFile(file, JSON.stringify({ SAMPLE: "file-value" }));
    expect((await createSecrets({ env: { SAMPLE: "env-value" }, file })).get("SAMPLE")).toBe("env-value");
    expect((await createSecrets({ env: { SAMPLE: "" }, file })).get("SAMPLE")).toBeNull();
  });

  it("uses a file value when the env value is absent and has returns a boolean", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    await writeFile(file, JSON.stringify({ SAMPLE: "file-value" }));
    const secrets = await createSecrets({ env: {}, file });
    expect(secrets.getSecret("SAMPLE")).toBe("file-value");
    expect(secrets.has("SAMPLE")).toBe(true);
    expect(secrets.has("MISSING")).toBe(false);
  });

  it("refreshes the same provider after enrollment without losing env precedence or redaction", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    const env = { ENV_KEY: "environment-canary", MASKED_KEY: "" };
    const secrets = await createSecrets({ env, file, trackNames: ["ENV_KEY", "MASKED_KEY"] });
    const get = secrets.get;
    const redact = secrets.redact;
    const workerName = "PFORGE_CLAW_WORKER_SECRET__new-worker";
    const workerSecret = "enrollment-canary-value";
    await writeFile(file, JSON.stringify({
      [workerName]: workerSecret, ENV_KEY: "file-canary", MASKED_KEY: "masked-file-canary",
    }));
    await secrets.refresh();
    expect(secrets.get).toBe(get);
    expect(secrets.redact).toBe(redact);
    expect(get(workerName)).toBe(workerSecret);
    expect(secrets.has(workerName)).toBe(true);
    expect(secrets.names).toContain(workerName);
    expect(get("ENV_KEY")).toBe(env.ENV_KEY);
    expect(get("MASKED_KEY")).toBeNull();
    expect(redact(workerSecret)).toBe(`«redacted:${workerName}»`);
    await writeFile(file, "{}");
    await secrets.refresh();
    expect(get(workerName)).toBeNull();
    expect(secrets.has(workerName)).toBe(false);
  });

  it("keeps its last validated values on a failed refresh and never exposes malformed contents", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    await writeFile(file, JSON.stringify({ VALID_KEY: "validated-canary" }));
    const secrets = await createSecrets({ env: {}, file });
    await writeFile(file, "malformed-enrollment-canary");
    await expect(secrets.refresh()).rejects.toMatchObject({ code: "SECRETS_PARSE" });
    expect(secrets.get("VALID_KEY")).toBe("validated-canary");
    expect(secrets.redact("validated-canary")).toBe("«redacted:VALID_KEY»");
  });

  it("retains redaction of in-flight revoked or rotated values while lookups use only current credentials", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    await writeFile(file, JSON.stringify({ WORKER_KEY: "old-worker-canary" }));
    const secrets = await createSecrets({ env: {}, file });
    await writeFile(file, JSON.stringify({ WORKER_KEY: "new-worker-canary" }));
    await secrets.refresh();
    expect(secrets.get("WORKER_KEY")).toBe("new-worker-canary");
    expect(secrets.redact("old-worker-canary new-worker-canary"))
      .toBe("«redacted:WORKER_KEY» «redacted:WORKER_KEY»");
    await writeFile(file, "{}");
    await secrets.refresh();
    expect(secrets.get("WORKER_KEY")).toBeNull();
    expect(secrets.redact("old-worker-canary new-worker-canary"))
      .toBe("«redacted:WORKER_KEY» «redacted:WORKER_KEY»");
  });

  it("redacts env and file canaries before lookup and longest overlapping values first", async () => {
    const canary = "canary-" + "s3cr3t-" + "x".repeat(8);
    const file = path.join(await tmpDir(), "secrets.json");
    await writeFile(file, JSON.stringify({ FILE_KEY: canary, SHORT_KEY: canary.slice(0, 12) }));
    const secrets = await createSecrets({
      env: { ENV_KEY: `${canary}-env` },
      file,
      trackNames: ["ENV_KEY"],
    });
    const redacted = secrets.redact(`${canary} ${canary.slice(0, 12)} ${canary}-env`);
    expect(redacted).not.toContain(canary);
    expect(redacted).toContain("«redacted:FILE_KEY»");
    expect(secrets.redact(redacted)).toBe(redacted);
  });

  it("uses literal replacement for regex characters and redacts token shapes", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    const githubToken = "ghp_" + "A".repeat(36);
    await writeFile(file, JSON.stringify({ REGEX_KEY: "a.$[b]", GITHUB: githubToken }));
    const secrets = await createSecrets({
      env: { TELEGRAM: "123456:" + "A".repeat(30), API: "sk-" + "B".repeat(20) },
      file,
      trackNames: [],
    });
    const output = secrets.redact(`a.$[b] ${githubToken} 123456:${"A".repeat(30)} sk-${"B".repeat(20)}`);
    expect(output).toContain("«redacted:REGEX_KEY»");
    expect(output).toContain("«redacted:GITHUB»");
    expect(output).toContain("«redacted:telegram-token»");
    expect(output).toContain("«redacted:api-key»");
    expect(output).not.toContain(githubToken);
  });

  it("does not echo malformed secret-file content in errors", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    const canary = "canary-" + "s3cr3t-" + "x".repeat(8);
    await writeFile(file, canary);
    await expect(createSecrets({ env: {}, file })).rejects.toMatchObject({ code: "SECRETS_PARSE" });
    await expect(createSecrets({ env: {}, file })).rejects.not.toThrow(canary);
  });

  it("rejects non-string secret values without echoing the value", async () => {
    const file = path.join(await tmpDir(), "secrets.json");
    await writeFile(file, JSON.stringify({ BAD_KEY: 12345 }));
    await expect(createSecrets({ env: {}, file })).rejects.toMatchObject({
      code: "SECRETS_INVALID_TYPE",
      details: { name: "BAD_KEY" },
    });
  });

  it("warns for broad POSIX permissions and accepts restrictive permissions", async () => {
    const stat = async (_file) => ({ mode: 0o100644 });
    expect((await checkSecretsFilePermissions("secrets", { platform: "linux", stat })).code)
      .toBe("SECRETS_WORLD_READABLE");
    expect(await checkSecretsFilePermissions("secrets", {
      platform: "linux",
      stat: async () => ({ mode: 0o100600 }),
    })).toMatchObject({ status: "ok" });
  });

  it("checks Windows ACLs and warns when access cannot be verified", async () => {
    const runIcacls = async () => "Everyone:(R)";
    expect(await checkSecretsFilePermissions("secrets", { platform: "win32", runIcacls }))
      .toMatchObject({ status: "warn" });
    expect(await checkSecretsFilePermissions("secrets", {
      platform: "win32",
      runIcacls: async () => "SYSTEM:(F)",
    })).toMatchObject({ status: "ok" });
    expect(await checkSecretsFilePermissions("secrets", {
      platform: "win32",
      runIcacls: async () => { throw new Error("unavailable"); },
    })).toMatchObject({ status: "warn", code: "SECRETS_ACL_UNVERIFIED" });
  });
});
