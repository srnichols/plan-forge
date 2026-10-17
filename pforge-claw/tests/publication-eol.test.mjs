import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createRunners } from "../src/jobs/runners.mjs";
import { run } from "../src/jobs/worktree.mjs";
import { createFakeGh } from "./helpers/fake-pforge.mjs";
import { runnerFixture } from "./g1-runner-fixture.mjs";

const fixtures = [];
const TEST_TIMEOUT_MS = 30_000;

async function git(cwd, args) {
  const completed = await run("git", args, { cwd });
  if (completed.code !== 0) throw new Error(completed.stderr);
  return completed.stdout;
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup();
});

describe("publication stages normalized Git content before deciding to commit", () => {
  it("publishes already-committed native work despite copy-induced EOL-only dirty bootstrap files", async () => {
    const fixture = await runnerFixture();
    fixtures.push(fixture);
    await mkdir(path.join(fixture.repo, ".forge"), { recursive: true });
    await writeFile(path.join(fixture.repo, ".gitignore"), ".forge/*\n!.forge/fm-prefs.json\n");
    await writeFile(path.join(fixture.repo, ".forge.json"), '{"v":1}\n');
    await writeFile(path.join(fixture.repo, ".forge", "fm-prefs.json"), '{"v":1}\n');
    await writeFile(path.join(fixture.repo, "entry.mjs"), "export {};\n");
    await git(fixture.repo, ["init", "-b", "main"]);
    await git(fixture.repo, ["config", "core.autocrlf", "true"]);
    await git(fixture.repo, ["config", "user.name", "Fixture"]);
    await git(fixture.repo, ["config", "user.email", "fixture@local"]);
    await git(fixture.repo, ["add", "-A"]);
    await git(fixture.repo, ["commit", "-m", "base"]);
    const origin = path.join(fixture.root, "origin.git");
    await git(fixture.root, ["init", "--bare", origin]);
    await git(fixture.repo, ["remote", "add", "origin", origin]);
    await git(fixture.repo, ["push", "-u", "origin", "main"]);
    const gh = await createFakeGh({ directory: path.join(fixture.root, "fake-gh") });
    fixture.config.bootstrap = { copy: [".forge.json", ".forge/fm-prefs.json"], env: ["G1_JOB_VALUE"], install: "none" };
    fixture.config.runtimes.pforgeCommand = [
      process.execPath, fileURLToPath(new URL("./helpers/fake-pforge.mjs", import.meta.url)),
    ];
    fixture.config.runtimes.ghCommand = gh.command;
    let publicationCommits = 0;
    fixture.ctx.runner = async (command, args, options) => {
      if (command === "git" && args.includes("commit")) publicationCommits += 1;
      return run(command, args, options);
    };
    fixture.ctx.runtime.run = async ({ cwd }) => {
      await writeFile(path.join(cwd, "native-approved.txt"), "approved native content\n");
      await git(cwd, ["add", "native-approved.txt"]);
      await git(cwd, ["commit", "-m", "native approved work"]);
      await mkdir(path.join(cwd, ".forge", "runs", "eol"), { recursive: true });
      await writeFile(path.join(cwd, ".forge", "runs", "eol", "run.json"), '{"id":"eol"}\n');
      return { status: "succeeded" };
    };
    const outcome = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(outcome, outcome.error).toMatchObject({
      status: "succeeded", result: { publish: { prUrl: "https://example.test/pr/1" } },
    });
    expect(publicationCommits).toBe(0);
    expect(await readFile(path.join(fixture.repo, ".forge", "runs", "eol", "run.json"), "utf8")).toBe('{"id":"eol"}\n');
    expect((await git(fixture.root, [
      "--git-dir", origin, "show", `refs/heads/claw/${fixture.job.id}:native-approved.txt`,
    ])).trim()).toBe("approved native content");
  }, TEST_TIMEOUT_MS);
});
