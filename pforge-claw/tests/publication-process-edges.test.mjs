import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addWorktree } from "../src/jobs/worktree.mjs";
import { g1Directory, runnerFixture } from "./g1-runner-fixture.mjs";
import { createK8sProcessEdge } from "./helpers/k8s-process-edge.mjs";
import { HELPER_ROOT } from "./helpers/k8s-fixture-common.mjs";

const cleanups = [];
const OID = /^[a-f0-9]{40}$/;
const CASES = [
  ["local", async () => {
    const fixture = await runnerFixture();
    cleanups.push(fixture.cleanup);
    const created = await addWorktree({
      home: fixture.home, project: fixture.config.projects[0], job: fixture.job, runner: fixture.ctx.runner,
    });
    return { runner: fixture.ctx.runner, cwd: created.path, jobId: fixture.job.id };
  }],
  ["kubernetes", async () => {
    const root = await g1Directory("publication-process-edges-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const cwd = path.join(root, "repo");
    await mkdir(cwd);
    const jobId = "f1111111";
    return {
      runner: createK8sProcessEdge({ env: { PFORGE_CLAW_JOB_ID: jobId }, workdir: root }), cwd, jobId,
    };
  }],
];

function git(fixture, args, options = {}) {
  return fixture.runner("git", ["-C", fixture.cwd, ...args], {
    cwd: fixture.cwd, requireSettlement: true, ...options,
  });
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe.each(CASES)("%s modeled publication Git process edge", (_lane, createFixture) => {
  it("verifies stable object IDs, ancestry and exact compare-and-swap of only the approved ref", async () => {
    const fixture = await createFixture();
    const ref = `refs/heads/claw/${fixture.jobId}`;
    const initial = await git(fixture, ["rev-parse", "--verify", ref]);
    const executed = await git(fixture, ["rev-parse", "--verify", "HEAD"]);
    expect(initial.stdout.trim()).toMatch(OID);
    expect(executed.stdout.trim()).toMatch(OID);
    expect(executed.stdout.trim()).not.toBe(initial.stdout.trim());
    expect(await git(fixture, ["merge-base", "--is-ancestor", initial.stdout.trim(), executed.stdout.trim()]))
      .toMatchObject({ code: 0, settlementConfirmed: true });
    expect(await git(fixture, ["update-ref", ref, executed.stdout.trim(), initial.stdout.trim()]))
      .toMatchObject({ code: 0, settlementConfirmed: true });
    expect((await git(fixture, ["rev-parse", "--verify", ref])).stdout).toBe(executed.stdout);
    expect((await git(fixture, ["update-ref", ref, executed.stdout.trim(), initial.stdout.trim()])).code)
      .not.toBe(0);
    expect((await git(fixture, ["rev-parse", "--verify", ref])).stdout).toBe(executed.stdout);
  });

  it("refuses unrelated reference queries or mutations instead of returning a generic success", async () => {
    const fixture = await createFixture();
    const executed = await git(fixture, ["rev-parse", "--verify", "HEAD"]);
    expect((await git(fixture, ["rev-parse", "--verify", "refs/heads/unapproved"])).code).not.toBe(0);
    expect((await git(fixture, ["update-ref", "refs/heads/unapproved", executed.stdout.trim(), executed.stdout.trim()])).code)
      .not.toBe(0);
  });

  it("marks only actually awaited synthetic Git work as completed when proof is requested", async () => {
    const fixture = await createFixture();
    expect(await git(fixture, ["status", "--porcelain"])).toMatchObject({ code: 0, settlementConfirmed: true });
    expect(await git(fixture, ["status", "--porcelain"], { requireSettlement: false }))
      .not.toHaveProperty("settlementConfirmed");
  });
});

it("does not stamp native process proof onto the Kubernetes Node helper result", async () => {
  const [, createFixture] = CASES[1];
  const fixture = await createFixture();
  const completed = await fixture.runner(process.execPath, [path.join(HELPER_ROOT, "k8s-command.mjs"), "invalid"], {
    cwd: fixture.cwd, requireSettlement: false,
  });
  expect(completed.code).not.toBe(0);
  expect(completed.stderr).toContain("K8S_E2E_EXTERNAL_COMMAND_REFUSED");
  expect(completed).not.toHaveProperty("settlementConfirmed");
});
