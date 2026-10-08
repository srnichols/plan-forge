import { spawn } from "node:child_process";
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
  it.fails("BUG_REF S27-BLOCKER-1: final PR notification is missing after successful publish", async () => {
    rig = await createE2ERig();
    const project = rig.repos[0];
    const initialHead = await git(["rev-parse", "HEAD"], project.repoPath);
    const result = await runAwayFromDesk(rig);
    expect(result.job.state).toBe("succeeded");
    expect(await git(["status", "--porcelain"], project.repoPath)).toBe("");
    expect(await git(["rev-parse", "HEAD"], project.repoPath)).toBe(initialHead);
    expect(await git(["show-ref", "--verify", "refs/heads/claw/" + result.job.id], project.originPath))
      .toContain("refs/heads/claw/");
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
