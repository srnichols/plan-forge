import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";
import { runAwayFromDesk } from "../helpers/e2e-scenarios.mjs";

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(stderr.trim() || `git exited with status ${code}`)));
  });
}

describe("scenario (a) away-from-desk approval and publishing", () => {
  it("keeps canonical runtime history out of Git without hiding project changes", async () => {
    rig = await createE2ERig();
    const project = rig.repos[0];
    const history = path.join(".forge", "runs", "runtime.json");
    await mkdir(path.dirname(path.join(project.repoPath, history)), { recursive: true });
    await writeFile(path.join(project.repoPath, history), "{}");
    expect(await git(["check-ignore", history], project.repoPath)).toContain("runtime.json");
    expect(await git(["status", "--porcelain"], project.repoPath)).toBe("");
    await writeFile(path.join(project.repoPath, "unexpected-project-change.mjs"), "export const changed = true;\n");
    expect(await git(["status", "--porcelain"], project.repoPath)).toContain("unexpected-project-change.mjs");
  });

  it("final PR notification is sent after successful publish", async () => {
    rig = await createE2ERig();
    const project = rig.repos[0];
    const initialHead = await git(["rev-parse", "HEAD"], project.repoPath);
    const result = await runAwayFromDesk(rig);
    expect(result.job.state).toBe("succeeded");
    expect(await git(["status", "--porcelain"], project.repoPath)).toBe("");
    expect(await git(["rev-parse", "HEAD"], project.repoPath)).toBe(initialHead);
    expect(await git(["--git-dir", project.originPath, "show-ref", "--verify", "refs/heads/claw/" + result.job.id],
      project.repoPath))
      .toContain("refs/heads/claw/");
    const branch = `refs/heads/claw/${result.job.id}`;
    const source = await git(["--git-dir", project.originPath, "show", `${branch}:fixture-plan-result.mjs`], project.repoPath);
    const prefix = "export const fixturePlan = ";
    expect(source.startsWith(prefix)).toBe(true);
    expect(source.endsWith(";")).toBe(true);
    expect(JSON.parse(source.slice(prefix.length, -1))).toEqual({
      runId: "fixture-run-1", plan: path.join("docs", "plans", "Phase-1-DEMO-PLAN.md"),
    });
    expect(await git(["--git-dir", project.originPath, "ls-tree", "-r", "--name-only", branch], project.repoPath))
      .not.toMatch(/^\.forge\/runs\//m);
    const progress = rig.fakeTelegram.edits("42")
      .map(({ args }) => Number(args.text.match(/(\d+)%/)?.[1]))
      .filter(Number.isFinite);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
    expect(await rig.prCalls()).toHaveLength(1);
    expect(result.finalMessage).not.toBeNull();
    expect(result.finalMessage.args.text).toContain("https://example.test/pr/1");
  });
});
