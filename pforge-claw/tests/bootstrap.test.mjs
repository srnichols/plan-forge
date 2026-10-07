import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapWorktree } from "../src/jobs/bootstrap.mjs";

const dirs = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "claw-bootstrap-"));
  dirs.push(root);
  const homeRepo = path.join(root, "home-repo");
  const worktree = path.join(root, "worktree");
  await mkdir(homeRepo, { recursive: true });
  await mkdir(worktree, { recursive: true });
  await mkdir(path.join(homeRepo, ".forge"), { recursive: true });
  await writeFile(path.join(homeRepo, ".forge", "secrets.json"), '{"TOKEN":"canary-secret"}');
  await mkdir(path.join(homeRepo, "node_modules"), { recursive: true });
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: "ready", stderr: "" };
  };
  const secrets = { get: (name) => name === "TOKEN" ? "canary-secret" : null, redact: (value) => value.replaceAll("canary-secret", "«redacted:TOKEN»") };
  return { root, homeRepo, worktree, calls, runner, secrets };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("worktree bootstrap", () => {
  it.each([".forge/secrets.json", ".forge/SECRETS.JSON", ".forge"])(
    "never copies secrets via %s",
    async (entry) => {
      const f = await fixture();
      if (entry === ".forge/SECRETS.JSON") {
        await writeFile(path.join(f.homeRepo, ".forge", "SECRETS.JSON"), "case secret");
      }
      const result = await bootstrapWorktree({
        job: { id: "j1" }, worktree: { path: f.worktree }, forgeHome: f.root,
        homeRepo: f.homeRepo, config: { bootstrap: { copy: [entry], install: "none" } },
        secrets: f.secrets, runner: f.runner,
      });
      if (entry.toLowerCase() === ".forge") {
        expect(result.ok).toBe(true);
        await expect(readFile(path.join(f.worktree, ".forge", "secrets.json"))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(path.join(f.worktree, ".forge", "SECRETS.JSON"))).rejects.toMatchObject({ code: "ENOENT" });
      } else if (entry.endsWith("JSON")) {
        expect(result).toMatchObject({ ok: false, code: "BOOTSTRAP_SECRET_COPY_REFUSED" });
      } else {
        expect(result).toMatchObject({ ok: false, code: "BOOTSTRAP_SECRET_COPY_REFUSED" });
      }
    },
  );

  it("rejects traversal, reports missing secret names only through the stable error code", async () => {
    const f = await fixture();
    const traversal = await bootstrapWorktree({
      job: {}, worktree: f.worktree, homeRepo: f.homeRepo,
      config: { bootstrap: { copy: ["../outside"] } }, secrets: f.secrets, runner: f.runner,
    });
    expect(traversal).toMatchObject({ ok: false, reason: "bootstrap", step: "copy", code: "BOOTSTRAP_COPY_INVALID" });
    const missing = await bootstrapWorktree({
      job: {}, worktree: f.worktree, homeRepo: f.homeRepo,
      config: { bootstrap: { env: ["ABSENT"], install: "none" } },
      secrets: f.secrets, runner: f.runner,
    });
    expect(missing).toMatchObject({ ok: false, code: "BOOTSTRAP_SECRET_MISSING" });
    expect(JSON.stringify(missing)).not.toContain("canary-secret");
  });

  it.each(["none", "npm-ci", "ci"])("supports install mode %s", async (install) => {
    const f = await fixture();
    const result = await bootstrapWorktree({
      job: { id: "j1" }, worktree: f.worktree, forgeHome: f.root, homeRepo: f.homeRepo,
      config: {
        bootstrap: { install },
        runtimes: { pforgeCommand: [process.execPath, "fake-pforge.mjs"] },
      },
      secrets: f.secrets, runner: f.runner,
    });
    expect(result.ok).toBe(true);
    expect(f.calls.some(({ args }) => args.at(-1) === "smith")).toBe(true);
    expect(f.calls.some(({ args }) => args.includes("ci"))).toBe(install !== "none");
  });

  it("links node_modules using the platform's directory-link type", async () => {
    const f = await fixture();
    const result = await bootstrapWorktree({
      job: {}, worktree: f.worktree, homeRepo: f.homeRepo,
      config: { bootstrap: { install: "link" }, runtimes: { pforgeCommand: [process.execPath, "fake"] } },
      secrets: f.secrets, runner: f.runner,
    });
    expect(result.ok).toBe(true);
    expect((await lstat(path.join(f.worktree, "node_modules"))).isSymbolicLink()).toBe(true);
  });

  it("fails closed for unknown install mode and failed smith, without leaking secret output", async () => {
    const f = await fixture();
    const invalid = await bootstrapWorktree({
      job: {}, worktree: f.worktree, homeRepo: f.homeRepo,
      config: { bootstrap: { install: "other" } }, secrets: f.secrets, runner: f.runner,
    });
    expect(invalid).toMatchObject({ ok: false, step: "install", code: "BOOTSTRAP_INSTALL_MODE" });
    const failed = await bootstrapWorktree({
      job: {}, worktree: f.worktree, homeRepo: f.homeRepo,
      config: { bootstrap: { install: "none" }, runtimes: { pforgeCommand: [process.execPath, "fake"] } },
      secrets: f.secrets,
      runner: async () => ({ code: 1, stdout: "canary-secret", stderr: "canary-secret" }),
    });
    expect(failed).toMatchObject({ ok: false, reason: "bootstrap", code: "BOOTSTRAP_SMITH_FAILED" });
    expect(JSON.stringify(failed)).not.toContain("canary-secret");
  });
});
