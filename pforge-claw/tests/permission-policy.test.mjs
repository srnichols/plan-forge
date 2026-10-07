import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { policyFor } from "../src/jobs/permission-policy.mjs";

let root;
let worktree;
let outside;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "claw-policy-"));
  worktree = path.join(root, "worktree");
  outside = path.join(root, "outside");
  await mkdir(path.join(worktree, "inside"), { recursive: true });
  await mkdir(outside);
  symlinkSync(outside, path.join(worktree, "escape"), process.platform === "win32" ? "junction" : "dir");
});

afterEach(async () => rm(root, { recursive: true, force: true }));

const request = (kind, properties = {}) => ({ kind, ...properties });
const allowed = { kind: "approved" };
const denied = { kind: "denied-by-rules" };

describe("job permission policy", () => {
  it.each([
    ["ask", false, "read", true],
    ["ask", false, "write", false],
    ["ask", false, "shell", false],
    ["ask", false, "mcp", true],
    ["capture", false, "url", false],
    ["skill", true, "read", true],
    ["skill", true, "write", false],
    ["skill", false, "read", true],
    ["task", false, "read", true],
    ["plan", false, "read", false],
    ["fanout", false, "read", false],
    ["unknown", false, "read", false],
  ])("%s readOnly=%s permission %s is %s", async (type, readOnly, kind, isAllowed) => {
    const result = await policyFor({ type, readOnly }, { worktree, project: {} })(request(kind));
    expect(result.kind === "approved").toBe(isAllowed);
  });

  it.each([
    ["inside/file.txt", true],
    ["../outside/file.txt", false],
    ["<absolute-outside-file>", false],
    ["escape/file.txt", false],
    ["escape/new-file.txt", false],
    ["", false],
  ])("validates worktree write target %s", async (fileName, isAllowed) => {
    const result = await policyFor({ type: "task" }, { worktree, project: {} })(
      request("write", { fileName: fileName === "<absolute-outside-file>" ? path.join(outside, "file.txt") : fileName }),
    );
    expect(result.kind === "approved").toBe(isAllowed);
  });

  it.each([
    ["git status", true],
    ["git status; rm -rf x", false],
    ["./git status", false],
    ["curl", false],
    ["gh pr create", false],
    ["npm test", true],
    ["node -e '$(bad)'", false],
    ["Invoke-WebRequest", false],
  ])("checks shell command %s", async (command, isAllowed) => {
    const result = await policyFor({ type: "task" }, {
      worktree,
      project: { testCommands: [["npm", "test"]] },
    })(request("shell", { command }));
    expect(result.kind === "approved").toBe(isAllowed);
  });

  it("permits only the Plan Forge MCP server and denies remote access kinds", async () => {
    const policy = policyFor({ type: "task" }, { worktree, project: {} });
    await expect(policy(request("mcp", { serverName: "plan-forge" }))).resolves.toEqual(allowed);
    await expect(policy(request("mcp", { serverName: "other" }))).resolves.toMatchObject(denied);
    await expect(policy(request("url"))).resolves.toMatchObject(denied);
    await expect(policy(request("fetch"))).resolves.toMatchObject(denied);
    await expect(policy(request("unknown"))).resolves.toMatchObject(denied);
  });

  it("never approves every permission kind for any job type", async () => {
    for (const type of ["ask", "capture", "skill", "task", "plan", "fanout", "unknown"]) {
      const policy = policyFor({ type }, { worktree, project: {} });
      const outcomes = await Promise.all([
        "read", "write", "shell", "url", "fetch", "mcp", "unknown",
      ].map((kind) => policy(request(kind, { fileName: "inside/file", command: "git status", serverName: "plan-forge" }))));
      expect(outcomes.some((outcome) => outcome.kind === "denied-by-rules")).toBe(true);
    }
  });
});
