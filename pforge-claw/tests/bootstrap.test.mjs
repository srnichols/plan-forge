import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyCopySet, bootstrapWorktree, collectCopySet } from "../src/jobs/bootstrap.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";
import { createSecrets } from "../src/secrets.mjs";

const dirs = [];
async function fixture() {
  const root = await g1Directory("g1-bootstrap-");
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
  const secrets = await createSecrets({ env: { TOKEN: "canary-secret" }, trackNames: ["TOKEN"] });
  return { root, homeRepo, worktree, calls, runner, secrets };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("worktree bootstrap", () => {
  it("collects copy-set defaults with a binary round-trip and preserves explicit []", async () => {
    const f = await fixture();
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    await writeFile(path.join(f.homeRepo, ".forge.json"), bytes);
    await writeFile(path.join(f.homeRepo, ".forge", "fm-prefs.json"), "{}");
    const files = await collectCopySet({ repoPath: f.homeRepo });
    expect(files.map((entry) => entry.path)).toEqual([".forge.json", ".forge/fm-prefs.json"]);
    await applyCopySet({ repoPath: f.worktree, files });
    expect(await readFile(path.join(f.worktree, ".forge.json"))).toEqual(bytes);
    expect(await collectCopySet({ repoPath: f.homeRepo, paths: [] })).toEqual([]);
  });
  it("refuses secrets, traversal, drive-relative paths, missing files and oversize sets", async () => {
    const f = await fixture();
    for (const entry of [".forge/secrets.json", ".forge/./SECRETS.JSON", "..\\outside", "C:secret", "\\\\server\\share\\file"]) {
      await expect(collectCopySet({ repoPath: f.homeRepo, paths: [entry] })).rejects.toBeDefined();
      await expect(applyCopySet({ repoPath: f.worktree, files: [{ path: entry, content: "" }] })).rejects.toBeDefined();
    }
    await expect(collectCopySet({ repoPath: f.homeRepo, paths: ["missing"] })).rejects.toMatchObject({ code: "CLAW_COPYSET_MISSING" });
    await writeFile(path.join(f.homeRepo, "large"), "1234");
    await expect(collectCopySet({ repoPath: f.homeRepo, paths: ["large"], maxBytes: 3 })).rejects.toMatchObject({ code: "CLAW_COPYSET_TOO_LARGE" });
    await expect(applyCopySet({ repoPath: f.worktree, files: [{ path: "large", content: Buffer.from("1234").toString("base64") }], maxBytes: 3 }))
      .rejects.toMatchObject({ code: "CLAW_COPYSET_TOO_LARGE" });
  });
  it("rejects escaping symlinks and preflights all writes before applying a partial set", async () => {
    const f = await fixture();
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "file"), "outside");
    await symlink(outside, path.join(f.homeRepo, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(collectCopySet({ repoPath: f.homeRepo, paths: ["escape/file"] })).rejects.toMatchObject({ code: "BOOTSTRAP_COPY_INVALID" });
    await symlink(outside, path.join(f.worktree, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(applyCopySet({ repoPath: f.worktree, files: [
      { path: "safe", content: Buffer.from("safe").toString("base64") },
      { path: "escape/file", content: Buffer.from("overwrite").toString("base64") },
    ] })).rejects.toMatchObject({ code: "BOOTSTRAP_COPY_INVALID" });
    await expect(readFile(path.join(f.worktree, "safe"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(outside, "file"), "utf8")).toBe("outside");
  });
  it("refuses secrets through a symlink alias inside the repository", async () => {
    const f = await fixture();
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(path.join(f.homeRepo, ".forge"), path.join(f.homeRepo, "alias"), type);
    await expect(collectCopySet({ repoPath: f.homeRepo, paths: ["alias/secrets.json"] }))
      .rejects.toMatchObject({ code: "BOOTSTRAP_SECRET_COPY_REFUSED" });
    await mkdir(path.join(f.worktree, ".forge"));
    await writeFile(path.join(f.worktree, ".forge", "secrets.json"), "private");
    await symlink(path.join(f.worktree, ".forge"), path.join(f.worktree, "alias"), type);
    await expect(applyCopySet({ repoPath: f.worktree, files: [{ path: "alias/secrets.json", content: "" }] }))
      .rejects.toMatchObject({ code: "BOOTSTRAP_SECRET_COPY_REFUSED" });
    expect(await readFile(path.join(f.worktree, ".forge", "secrets.json"), "utf8")).toBe("private");
  });
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

  it("uses per-project bootstrap copy, environment and install before root defaults", async () => {
    const f = await fixture();
    await writeFile(path.join(f.homeRepo, "project-config.json"), "{}");
    const result = await bootstrapWorktree({
      job: { id: "j1", projectId: "p1" }, worktree: f.worktree, homeRepo: f.homeRepo,
      config: {
        bootstrap: { copy: ["missing-root-file"], env: ["MISSING_ROOT_KEY"], install: "ci" },
        projects: [{ id: "p1", bootstrap: { copy: ["project-config.json"], env: ["TOKEN"], install: "none" } }],
        runtimes: { pforgeCommand: [process.execPath, "fake"] },
      },
      env: { PATH: process.env.PATH }, secrets: f.secrets, runner: f.runner,
    });
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(f.worktree, "project-config.json"), "utf8")).toBe("{}");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].options.env.TOKEN).toBe("canary-secret");
    expect(f.calls[0].args.at(-1)).toBe("smith");
  });

  it.each(["project", "lane", "default"])("resolves the configured %s BYOK alias before bootstrap", async (source) => {
    const f = await fixture();
    const config = {
      projects: [{ id: "p1", ...(source === "project" ? { runtime: "byok:openai" } : {}) }],
      lanes: [{ id: "execution-host", ...(source === "lane" ? { runtime: "byok:openai" } : {}) }],
      runtimes: {
        default: source === "default" ? "byok:openai" : "copilot-sdk",
        byok: { openai: { keySecret: "MISSING_PROVIDER_KEY", endpoint: "https://provider.example.test" } },
        pforgeCommand: [process.execPath, "fake"],
      },
      bootstrap: { copy: [], env: [], install: "none" },
    };
    const result = await bootstrapWorktree({
      job: { id: "j1", projectId: "p1", lane: "execution-host" },
      worktree: f.worktree, homeRepo: f.homeRepo, config, env: {}, secrets: f.secrets, runner: f.runner,
    });
    expect(result).toMatchObject({ ok: false, code: "BYOK_KEY_MISSING" });
    expect(f.calls).toEqual([]);
  });
});
