import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRegistry,
  isGitRepo,
  normalizeRepoPath,
  resolveMcpLaunch,
  samePath,
  validateProjects,
} from "../src/registry.mjs";

const execFileAsync = promisify(execFile);
const tempDirs = [];
const tmpDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claw-"));
  tempDirs.push(dir);
  return dir;
};

function config() {
  return {
    lanes: [{ id: "local", kind: "local" }, { id: "remote", kind: "remote" }],
    projects: [
      { id: "one", homeLane: "local", channel: { chatId: 42 }, repo: { path: "/a/repo" } },
      { id: "two", homeLane: "remote", channel: { chatId: "42", topicId: 7 }, repo: { path: "/remote/repo" } },
    ],
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("project registry", () => {
  it("looks up projects by id and normalized chat/topic identifiers", () => {
    const registry = createRegistry(config());
    expect(registry.byId("one").id).toBe("one");
    expect(registry.byChat("42").id).toBe("one");
    expect(registry.byChat(42, 7).id).toBe("two");
    expect(registry.byChat("42", undefined).id).toBe("one");
    expect(registry.byPath("/a/repo").id).toBe("one");
    expect(registry.all()).toHaveLength(2);
  });

  it("rejects duplicate ids and channel routes", () => {
    expect(() => createRegistry({ ...config(), projects: [config().projects[0], config().projects[0]] }))
      .toThrowError(expect.objectContaining({ code: "DUPLICATE_PROJECT_ID" }));
    const cfg = config();
    cfg.projects[1].channel = { chatId: 42 };
    expect(() => createRegistry(cfg)).toThrowError(expect.objectContaining({ code: "CHANNEL_ROUTE_COLLISION" }));
  });

  it("normalizes paths with explicit platform semantics", () => {
    expect(samePath("C:\\Repo\\X\\", "c:\\repo\\x", "win32")).toBe(true);
    expect(samePath("/a/B", "/a/b", "linux")).toBe(false);
    expect(normalizeRepoPath("/a/repo/", "linux")).toBe("/a/repo");
  });

  it("detects git repositories, including an ordinary initialized repository", async () => {
    const repo = await tmpDir();
    const plain = await tmpDir();
    await execFileAsync("git", ["init", "--quiet", repo]);
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(plain)).toBe(false);
  });

  it("skips remote-home verification and reports missing local paths", async () => {
    const cfg = config();
    const results = await validateProjects(cfg, {
      stat: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      isGitRepo: async () => false,
    });
    expect(results.find(({ projectId }) => projectId === "two"))
      .toMatchObject({ status: "skip", code: "REMOTE_HOME_UNVERIFIED" });
    expect(results.find(({ projectId }) => projectId === "one"))
      .toMatchObject({ status: "fail", code: "PROJECT_PATH_MISSING" });
  });

  it("reads either MCP config shape, expands variables, and reports missing configuration safely", async () => {
    const content = JSON.stringify({
      servers: {
        "plan-forge": { command: "node", args: ["${workspaceFolder}", "${env:ARG}"] },
      },
    });
    const options = {
      env: { ARG: "secret-value" },
      readFile: async () => content,
      which: async () => true,
    };
    expect(await resolveMcpLaunch("/repo", "plan-forge", options)).toMatchObject({
      ok: true, command: "node", args: ["/repo", "secret-value"], cwd: "/repo",
    });
    expect((await resolveMcpLaunch("/repo", "plan-forge", {
      ...options,
      readFile: async () => JSON.stringify({ mcpServers: { "plan-forge": { command: "node" } } }),
    })).ok).toBe(true);
    const unresolved = await resolveMcpLaunch("/repo", "plan-forge", {
      ...options,
      readFile: async () => JSON.stringify({ servers: { "plan-forge": { command: "${env:MISSING}" } } }),
    });
    expect(unresolved).toMatchObject({ ok: false, code: "MCP_UNRESOLVED_VAR" });
    expect(JSON.stringify(unresolved)).not.toContain("secret-value");
    expect(await resolveMcpLaunch("/repo", "missing", {
      ...options,
      readFile: async () => content,
    })).toMatchObject({ ok: false, code: "MCP_SERVER_MISSING" });
    expect(await resolveMcpLaunch("/repo", "plan-forge", {
      ...options,
      which: async () => false,
    })).toMatchObject({ ok: false, code: "MCP_COMMAND_NOT_FOUND" });
    expect(await resolveMcpLaunch("/repo", "plan-forge", {
      ...options,
      readFile: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    })).toMatchObject({ ok: false, code: "MCP_CONFIG_MISSING" });
  });
});
