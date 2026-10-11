import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../src/approvals.mjs";
import { ClawError } from "../src/errors.mjs";
import { currentJobs, JOBS_STREAM } from "../src/jobs/model.mjs";
import { createPlanProcessTree, PLAN_TREE_ERRORS } from "../src/jobs/plan-process-tree.mjs";
import { createRunners } from "../src/jobs/runners.mjs";
import { canReleaseWorkspace } from "../src/jobs/runner-lifecycle.mjs";
import { addWorktree, removeWorktree, run, sweepWorktrees } from "../src/jobs/worktree.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { L2_ACK_ERRORS } from "../src/protocol/messages.mjs";
import { createStore } from "../src/state/store.mjs";
import { approveJob, g1Directory, leaseJob } from "./g1-runner-fixture.mjs";

const PLAN = path.join("docs", "plans", "Phase-1-PLAN.md");
const RUN_ID = "native-review-run";
const END_TIME = "2026-10-10T18:30:00.000Z";
// +15000ms startup and +10000ms settlement tolerances cover real Windows/macOS CI scheduling.
const STARTUP_TOLERANCE_MS = 15_000;
const SETTLEMENT_TOLERANCE_MS = 10_000;
const RETENTION_HOUR_MS = 3_600_000;
// +60000ms covers the complete real Git/native proof sequence on Windows CI, never proof from elapsed time.
const NATIVE_PUBLICATION_TOLERANCE_MS = 60_000;
const fixtures = [];

const FAILURE_SCRIPT = `
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const runRoot = path.join(process.cwd(), ".forge", "runs", "${RUN_ID}");
await mkdir(runRoot, { recursive: true });
await writeFile(path.join(runRoot, "summary.json"), JSON.stringify({
  plan: path.resolve(process.argv[3]), endTime: "${END_TIME}", status: "failed",
}));
await writeFile(path.join(runRoot, "events.log"), "owned failed native execution\\n");
process.exitCode = 23;
`;

const ISOLATED_SCRIPT = `
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const native = await import(process.env.NATIVE_REVIEW_ISOLATION_MODULE);
const cwd = process.cwd();
const config = native.loadRunIsolationConfig(cwd);
const isolation = native.startRunIsolation({
  cwd, planPath: process.argv[3], config, now: new Date("${END_TIME}"),
});
if (!isolation.enabled) throw new Error("fixture native isolation unavailable");
await writeFile(path.join(cwd, "approved-change.txt"), "approved native plan change\\n");
async function git(args) {
  const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  return stdout.trim();
}
await git(["add", "--", "approved-change.txt"]);
await git(["commit", "-m", "approved inert native slice"]);
const executedHead = await git(["rev-parse", "HEAD"]);
const outcome = native.finishRunIsolation({ cwd, isolation, allPassed: true, config });
const runRoot = path.join(cwd, ".forge", "runs", "${RUN_ID}");
await mkdir(runRoot, { recursive: true });
await writeFile(path.join(runRoot, "summary.json"), JSON.stringify({
  plan: path.resolve(process.argv[3]), endTime: "${END_TIME}", status: "succeeded",
}));
await writeFile(path.join(runRoot, "native-outcome.json"), JSON.stringify({
  config, isolation, outcome, executedHead, argv: process.argv.slice(2),
  environment: process.env.NATIVE_REVIEW_JOB_VALUE,
}));
`;

async function checked(command, args, options = {}) {
  const completed = await run(command, args, { timeoutMs: STARTUP_TOLERANCE_MS, ...options });
  if (completed.code !== 0) {
    throw new Error(`Owned fixture ${command} exited ${completed.code}: ${completed.stderr || completed.error?.code}`);
  }
  return completed;
}

async function marker(fixture) {
  return JSON.parse(await readFile(path.join(fixture.worktree, ".claw-job.json"), "utf8"));
}

async function runnerFixture({ script = FAILURE_SCRIPT, quorum = "power", resumeFrom = 4, jobFields = {} } = {}) {
  const root = await g1Directory("native-runner-review-");
  const repo = path.join(root, "checkout");
  const home = path.join(root, "claw-home");
  const origin = path.join(root, "origin.git");
  await mkdir(path.join(repo, "docs", "plans"), { recursive: true });
  await mkdir(path.join(repo, ".github"), { recursive: true });
  await writeFile(path.join(repo, PLAN), "# Owned inert plan\n\n### Slice 1: Inert execution\n");
  await writeFile(path.join(repo, ".gitignore"), ".forge/\n.forge.json\n.claw-job.json\n");
  await writeFile(path.join(repo, ".github", "pull_request_template.md"), "## Summary\n\n## Validation\n");
  const configBytes = JSON.stringify({ runIsolation: "branch", runIntegration: "none" });
  await writeFile(path.join(repo, ".forge.json"), configBytes);
  await checked("git", ["init", "-b", "main", repo]);
  await checked("git", ["-C", repo, "config", "user.email", "test@example.test"]);
  await checked("git", ["-C", repo, "config", "user.name", "Native Review Fixture"]);
  await checked("git", ["-C", repo, "add", "-A"]);
  await checked("git", ["-C", repo, "commit", "-m", "owned fixture base"]);
  await checked("git", ["init", "--bare", origin]);
  await checked("git", ["-C", repo, "remote", "add", "origin", origin]);
  await checked("git", ["-C", repo, "push", "-u", "origin", "main"]);
  const scriptPath = path.join(root, "inert-native.mjs");
  await writeFile(scriptPath, script);
  const store = createStore(path.join(root, "state"));
  const unlock = store.lock();
  const bus = new EventEmitter();
  const config = {
    allowlist: [
      { channel: "telegram", userId: "requester-owner", role: "owner" },
      { channel: "telegram", userId: "owner", role: "owner" },
    ],
    lanes: [{ id: "execution-host", kind: "local", enabled: true }],
    projects: [{
      id: "project-1", homeLane: "execution-host",
      repo: { path: repo, baseBranch: "main" }, models: { work: "configured-work-model" },
    }],
    runtimes: { pforgeCommand: [process.execPath, scriptPath], ghCommand: ["fixture-gh"] },
    bootstrap: { env: ["NATIVE_REVIEW_JOB_VALUE"], install: "none" },
    jobs: { pushOnFailure: false },
  };
  const fixture = {
    root, repo, home, origin, store, unlock, bus, config, configBytes,
    calls: [], deliveries: [], releases: [], mcpCalls: [], ownedPids: [],
  };
  fixtures.push(fixture);
  fixture.approvals = createApprovalService({ store, bus, config });
  fixture.job = leaseJob(fixture, await approveJob(fixture, {
    type: "plan", fields: { planPath: PLAN, quorum, resumeFrom, ...jobFields }, approvalQuorum: quorum,
  }));
  fixture.worktree = path.join(home, "worktrees", fixture.job.projectId, fixture.job.id);
  const receiver = createL2Receiver({ config, currentLaneId: "execution-host" });
  const env = { ...process.env, NATIVE_REVIEW_ISOLATION_MODULE: pathToFileURL(
    path.resolve("..", "pforge-mcp", "orchestrator", "run-isolation.mjs"),
  ).href };
  delete env.PFORGE_RUN_ISOLATION;
  fixture.ctx = {
    home, config, store, bus, env, features: [],
    secrets: { get: (name) => name === "NATIVE_REVIEW_JOB_VALUE" ? "owned-fixture-canary" : null,
      redact: (text) => text },
    runner: async (command, args, options = {}) => {
      fixture.calls.push({ command, args: [...args] });
      if (command === "fixture-gh") {
        const branch = args[args.indexOf("--head") + 1];
        fixture.prHead = (await checked("git", ["--git-dir", origin, "rev-parse", `refs/heads/${branch}`])).stdout.trim();
        fixture.prChange = await run("git", ["--git-dir", origin, "show", `${branch}:approved-change.txt`]);
        fixture.prBody = args[args.indexOf("--body") + 1];
        const diff = await run("git", ["--git-dir", origin, "diff", "--quiet", `main..${branch}`]);
        return diff.code === 1 && fixture.prChange.code === 0
          ? { code: 0, stdout: "https://example.test/pr/native-review\n", stderr: "" }
          : { code: 1, stdout: "", stderr: "No approved changes on proposed PR head" };
      }
      return run(command, args, options);
    },
    mcpLaunch: { command: process.execPath, args: [], cwd: fixture.worktree, env: {} },
    mcp: async ({ cwd }) => ({
      async call(tool, input) {
        fixture.mcpCalls.push({ tool, input });
        if (tool === "forge_watch_live") return {
          ok: true, mode: "polling", eventProjection: "verbose", durationMs: 1000,
          events: [], capturedEvents: 0, droppedEvents: 0, maxCapturedEvents: 100,
        };
        if (tool !== "forge_cost_report") return { ok: true };
        const summary = JSON.parse(await readFile(path.join(cwd, ".forge", "runs", RUN_ID, "summary.json"), "utf8"));
        return { runs: 1, latest: {
          plan: summary.plan, date: summary.endTime, status: summary.status, total_cost_usd: 0,
        } };
      },
      async close() {},
    }),
    l2Receiver: {
      async receive(transfer, options) {
        fixture.deliveries.push(transfer);
        return receiver.receive(transfer, options);
      },
    },
    workspace: {
      async prepare(job, options) {
        const handle = await addWorktree({ home, project: config.projects[0], job, runner: run, ...options });
        await writeFile(path.join(handle.path, ".forge.json"), configBytes);
        return { handle: { ...handle, repoPath: repo }, env: {} };
      },
      async release(handle, options) {
        fixture.releases.push(options);
        if (!canReleaseWorkspace(options)) throw new ClawError("FIXTURE_UNCONFIRMED_REMOVAL");
        return removeWorktree({ repoPath: repo, path: handle.path, runner: run, ...options });
      },
    },
  };
  return fixture;
}

async function processRunning(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === "win32") return true;
    const status = await run("ps", ["-o", "stat=", "-p", String(pid)]);
    return status.code === 0 && status.stdout.trim() && !status.stdout.trim().startsWith("Z");
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function stopOwnedProbe(fixture) {
  const pids = [...new Set(fixture.ownedPids)].filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (process.platform === "win32" && pids.length) {
    await checked("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference = "Stop"
      foreach ($ownedProcessId in (ConvertFrom-Json $env:NATIVE_REVIEW_STOP_PIDS)) {
        $owned = Get-Process -Id $ownedProcessId -ErrorAction SilentlyContinue
        if ($null -ne $owned) {
          $null = $owned.Handle
          $identity = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$ownedProcessId)
          if ($null -eq $identity -or $null -eq $identity.CommandLine -or
            -not $identity.CommandLine.Contains($env:NATIVE_REVIEW_STOP_ROOT, [StringComparison]::OrdinalIgnoreCase)) { continue }
          Stop-Process -Id $ownedProcessId -Force -ErrorAction Stop
          if (-not $owned.WaitForExit(5000)) { throw "owned fixture did not stop" }
        }
      }
      exit 0
    `], { env: { ...process.env, NATIVE_REVIEW_STOP_PIDS: JSON.stringify(pids), NATIVE_REVIEW_STOP_ROOT: fixture.root } });
  } else {
    for (const pid of pids) {
      if (await ownsProbeProcess(fixture, pid)) process.kill(pid, "SIGKILL");
    }
  }
  for (const pid of pids) {
    await vi.waitFor(async () => expect(await ownsProbeProcess(fixture, pid)).toBeFalsy(), {
      timeout: SETTLEMENT_TOLERANCE_MS, interval: 50,
    });
  }
}

async function ownsProbeProcess(fixture, pid) {
  if (!(await processRunning(pid))) return false;
  if (process.platform === "win32") {
    const result = await checked("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $owned = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$env:NATIVE_REVIEW_CHECK_PID)
      if ($null -ne $owned -and $null -ne $owned.CommandLine -and
        $owned.CommandLine.Contains($env:NATIVE_REVIEW_STOP_ROOT, [StringComparison]::OrdinalIgnoreCase)) { "owned" }
      exit 0
    `], { env: { ...process.env, NATIVE_REVIEW_CHECK_PID: String(pid), NATIVE_REVIEW_STOP_ROOT: fixture.root } });
    return result.stdout.trim() === "owned";
  }
  const result = await run("ps", ["-o", "command=", "-p", String(pid)]);
  return result.code === 0 && result.stdout.includes(fixture.root);
}

async function settleWithin(pending) {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      pending.then((value) => ({ value }), (error) => ({ error })),
      delay(SETTLEMENT_TOLERANCE_MS, { timedOut: true }, { signal: timeout.signal }),
    ]);
  } finally {
    timeout.abort();
  }
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await stopOwnedProbe(fixture);
    fixture.unlock();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

describe("FR-01 owned native foreground execution tree", () => {
  it("terminates and awaits PowerShell/Bash to Node to Node descendants, not an unrelated sibling", async () => {
    const fixture = await runnerFixture();
    const pids = ["wrapper", "node", "leaf"].map((name) => path.join(fixture.root, `${name}.pid`));
    const leafScript = path.join(fixture.root, "owned-leaf.mjs");
    const treeScript = path.join(fixture.root, "owned-tree.mjs");
    const controlScript = path.join(fixture.root, "unrelated-control.mjs");
    await writeFile(leafScript, `
      import { writeFileSync } from "node:fs";
      writeFileSync(process.env.NATIVE_REVIEW_LEAF_PID, String(process.pid));
      setInterval(() => {}, 1000);
    `);
    await writeFile(treeScript, `
      import { spawn } from "node:child_process";
      import { mkdirSync, writeFileSync } from "node:fs";
      import path from "node:path";
      writeFileSync(process.env.NATIVE_REVIEW_NODE_PID, String(process.pid));
      const history = path.join(process.cwd(), ".forge", "runs", "owned-tree");
      mkdirSync(history, { recursive: true });
      writeFileSync(path.join(history, "events.log"), "owned in-flight history\\n");
      writeFileSync(path.join(history, "run.json"), '{"id":"owned-tree","status":"running"}\\n');
      spawn(process.execPath, [process.env.NATIVE_REVIEW_LEAF_SCRIPT], { stdio: "inherit", shell: false });
      setInterval(() => {}, 1000);
    `);
    await writeFile(controlScript, "setInterval(() => {}, 1000);\n");
    const wrapper = path.join(fixture.root, process.platform === "win32" ? "owned-wrapper.ps1" : "owned-wrapper.sh");
    await writeFile(wrapper, process.platform === "win32" ? `
      $ErrorActionPreference = "Stop"
      [System.IO.File]::WriteAllText($env:NATIVE_REVIEW_WRAPPER_PID, [string]$PID)
      & $env:NATIVE_REVIEW_NODE $env:NATIVE_REVIEW_TREE_SCRIPT
      exit $LASTEXITCODE
    ` : `
      printf '%s' "$$" > "$NATIVE_REVIEW_WRAPPER_PID"
      "$NATIVE_REVIEW_NODE" "$NATIVE_REVIEW_TREE_SCRIPT"
    `);
    Object.assign(fixture.ctx.env, {
      NATIVE_REVIEW_WRAPPER_PID: pids[0], NATIVE_REVIEW_NODE_PID: pids[1], NATIVE_REVIEW_LEAF_PID: pids[2],
      NATIVE_REVIEW_NODE: process.execPath, NATIVE_REVIEW_TREE_SCRIPT: treeScript, NATIVE_REVIEW_LEAF_SCRIPT: leafScript,
    });
    fixture.config.runtimes.pforgeCommand = process.platform === "win32"
      ? ["pwsh", "-NoProfile", "-File", wrapper] : ["bash", wrapper];
    const control = spawn(process.execPath, [controlScript], { shell: false, stdio: "ignore" });
    control.on("error", (error) => { fixture.controlError = error; });
    if (control.pid) {
      fixture.ownedPids.push(control.pid);
      await writeFile(path.join(fixture.root, "control.pid"), String(control.pid));
    }
    const controller = new AbortController();
    const pending = createRunners(fixture.ctx).runJob(fixture.job, { signal: controller.signal });
    try {
      await vi.waitFor(async () => {
        for (const pidFile of pids) expect(Number(await readFile(pidFile, "utf8"))).toBeGreaterThan(0);
      }, { timeout: STARTUP_TOLERANCE_MS, interval: 50 });
      const executionPids = await Promise.all(pids.map(async (file) => Number(await readFile(file, "utf8"))));
      fixture.ownedPids.push(...executionPids);
      expect(fixture.controlError).toBeUndefined();
      expect(await processRunning(control.pid)).toBeTruthy();
      controller.abort();
      const settled = await settleWithin(pending);
      for (const pid of executionPids) expect(await processRunning(pid), `owned execution PID ${pid} survived cancellation`).toBeFalsy();
      expect(settled).toMatchObject({ value: { status: "cancelled", error: "JOB_CANCELLED" } });
      expect(await processRunning(control.pid)).toBeTruthy();
      expect(fixture.mcpCalls.find(({ tool }) => tool === "forge_abort")?.input).toEqual({ path: fixture.worktree });
      expect(fixture.calls.some(({ args }) => args.includes("push"))).toBe(false);
      expect(fixture.releases).toHaveLength(0);
      expect(fixture.deliveries).toHaveLength(1);
      expect(await marker(fixture)).toMatchObject({
        l2Pending: false, applicationAck: { jobId: fixture.job.id, projectId: fixture.job.projectId, ok: true },
      });
      expect(await readFile(path.join(fixture.repo, ".forge", "runs", "owned-tree", "run.json"), "utf8"))
        .toBe('{"id":"owned-tree","status":"running"}\n');
    } finally {
      controller.abort();
      for (const file of pids) {
        try { fixture.ownedPids.push(Number(await readFile(file, "utf8"))); } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      await stopOwnedProbe(fixture);
      expect((await settleWithin(pending)).timedOut).not.toBe(true);
    }
  }, 60_000);
});

describe("FR-07 actual failed runner canonical history", () => {
  it("applies failed native run history once, retains its primary failure, and ACK-gates disposal", async () => {
    const fixture = await runnerFixture();
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23 });
    expect(completed.planActuals).toEqual({
      jobId: fixture.job.id, projectId: fixture.job.projectId, runId: RUN_ID,
      plan: path.basename(PLAN), endedAt: END_TIME, usage: { costUSD: 0, premiumRequests: null },
    });
    expect(fixture.deliveries).toHaveLength(1);
    const source = path.join(fixture.worktree, ".forge", "runs", RUN_ID, "summary.json");
    const canonical = path.join(fixture.repo, ".forge", "runs", RUN_ID, "summary.json");
    const canonicalContents = await readFile(canonical, "utf8");
    expect(canonicalContents).toBe(await readFile(source, "utf8"));
    const { chunks, ...identity } = fixture.deliveries[0];
    expect(chunks.length).toBeGreaterThan(0);
    expect(await marker(fixture)).toMatchObject({ l2Pending: false, applicationAck: { ...identity, ok: true } });
    expect(completed.l2).toMatchObject({ jobId: fixture.job.id, projectId: fixture.job.projectId, ok: true });
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("failed");
    expect(fixture.releases).toHaveLength(0);
    expect(fixture.calls.some(({ args }) => args.includes("push"))).toBe(false);
    const terminal = [...fixture.store.read(JOBS_STREAM)].map(({ record }) => record)
      .findLast((record) => record.kind === "job.transition" && record.to === "failed");
    const sweepCalls = [];
    const options = {
      home: fixture.home, store: fixture.store, keepHours: 1,
      runner: async (command, args, commandOptions) => {
        const completed = await run(command, args, commandOptions);
        sweepCalls.push({ args, code: completed.code, stderr: completed.stderr });
        return completed;
      },
    };
    expect(await sweepWorktrees({ ...options, now: () => Date.parse(terminal.ts) })).toEqual([]);
    const removed = await sweepWorktrees({
      ...options, now: () => Date.parse(terminal.ts) + RETENTION_HOUR_MS + 1,
    });
    expect(removed, JSON.stringify(sweepCalls)).toContain(fixture.worktree);
    expect(await readFile(canonical, "utf8")).toBe(canonicalContents);
  });

  it.each([
    ["a typed negative application ACK", L2_ACK_ERRORS.HOME_UNAVAILABLE, (identity) => ({
      ...identity, ok: false, code: L2_ACK_ERRORS.HOME_UNAVAILABLE,
    })],
    ["a transport receipt only", L2_ACK_ERRORS.UNCONFIRMED, () => ({ lastSeq: 99 })],
    ["another transfer's positive ACK", L2_ACK_ERRORS.UNCONFIRMED, (identity) => ({
      ...identity, sha256Total: "0".repeat(64), ok: true,
    })],
  ])("retains failed source history and the primary failure after %s", async (_name, expectedCode, acknowledgement) => {
    const fixture = await runnerFixture();
    fixture.ctx.l2Receiver = {
      async receive(transfer) {
        fixture.deliveries.push(transfer);
        const { chunks, ...identity } = transfer;
        expect(chunks.length).toBeGreaterThan(0);
        return acknowledgement(identity);
      },
    };
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(fixture.deliveries).toHaveLength(1);
    expect(completed).toMatchObject({
      status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23, l2Error: expectedCode,
    });
    expect(completed.l2).toBeUndefined();
    expect(await marker(fixture)).toMatchObject({ l2Pending: true });
    expect((await marker(fixture)).applicationAck).toBeUndefined();
    expect(await readFile(path.join(fixture.worktree, ".forge", "runs", RUN_ID, "events.log"), "utf8"))
      .toBe("owned failed native execution\n");
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("failed");
    expect(fixture.releases).toHaveLength(0);
    expect(await sweepWorktrees({ home: fixture.home, store: fixture.store, runner: run,
      keepHours: 0, now: () => Number.MAX_SAFE_INTEGER })).toEqual([]);
  });

  it("bounds unknown canonical delivery without replacing the original native exit failure", async () => {
    const fixture = await runnerFixture();
    fixture.ctx.l2AckTimeoutMs = 1000;
    fixture.ctx.l2Receiver = {
      receive(transfer) {
        fixture.deliveries.push(transfer);
        return new Promise(() => {});
      },
    };
    const settled = await settleWithin(createRunners(fixture.ctx).runJob(fixture.job));
    expect(fixture.deliveries).toHaveLength(1);
    expect(settled).toMatchObject({
      value: { status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23, l2Error: L2_ACK_ERRORS.TIMEOUT },
    });
    expect(await marker(fixture)).toMatchObject({ l2Pending: true });
    expect(fixture.releases).toHaveLength(0);
  });

  it("preserves the actual native failure when canonical receiver acquisition throws synchronously", async () => {
    const fixture = await runnerFixture();
    fixture.ctx.l2Receiver = {
      receive(transfer) {
        fixture.deliveries.push(transfer);
        throw new ClawError(L2_ACK_ERRORS.HOME_UNAVAILABLE);
      },
    };
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({
      status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23, l2Error: L2_ACK_ERRORS.HOME_UNAVAILABLE,
    });
    expect(fixture.deliveries).toHaveLength(1);
    expect(await marker(fixture)).toMatchObject({ l2Pending: true });
    expect(fixture.releases).toHaveLength(0);
  });

  it("does not duplicate the trusted worker's external history finalization", async () => {
    const fixture = await runnerFixture();
    fixture.ctx.externalHistoryDelivery = true;
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23 });
    expect(fixture.deliveries).toHaveLength(0);
    expect(completed.l2).toBeUndefined();
    expect(completed.l2Error).toBeUndefined();
    expect(await marker(fixture)).toMatchObject({ l2Pending: true });
    expect(fixture.releases).toHaveLength(0);
  });

  it("does not let config or environment spoof trusted external history delivery", async () => {
    const fixture = await runnerFixture();
    fixture.config.externalHistoryDelivery = true;
    fixture.ctx.env.PFORGE_CLAW_EXTERNAL_HISTORY_DELIVERY = "true";
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23, l2: { ok: true } });
    expect(fixture.deliveries).toHaveLength(1);
    expect(await marker(fixture)).toMatchObject({ l2Pending: false });
  });
});

describe("FR-08 actual native kept-on-branch publication", { timeout: NATIVE_PUBLICATION_TOLERANCE_MS }, () => {
  it("publishes the executed native HEAD on the approved Claw PR head without changing runIntegration none", async () => {
    const fixture = await runnerFixture({ script: ISOLATED_SCRIPT });
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed, JSON.stringify(completed)).toMatchObject({
      status: "succeeded", result: { publish: { pr: true, branch: `claw/${fixture.job.id}` } },
    });
    const outcome = JSON.parse(await readFile(
      path.join(fixture.repo, ".forge", "runs", RUN_ID, "native-outcome.json"), "utf8",
    ));
    expect(outcome.outcome.action).toBe("kept-on-branch");
    expect(outcome.config).toMatchObject({ isolation: "branch", integrate: "none" });
    expect(outcome.isolation.baseBranch).toBe(`claw/${fixture.job.id}`);
    expect(outcome.isolation.runBranch).toMatch(/^pforge\/run\//);
    expect(fixture.prHead).toBe(outcome.executedHead);
    expect(fixture.prChange).toMatchObject({ code: 0, stdout: "approved native plan change\n" });
    expect((await checked("git", ["--git-dir", fixture.origin, "diff", "--name-only",
      `main..claw/${fixture.job.id}`])).stdout.trim()).toBe("approved-change.txt");
    expect((await readFile(path.join(fixture.repo, ".forge.json"), "utf8"))).toBe(fixture.configBytes);
    expect((await checked("git", ["-C", fixture.repo, "rev-parse", `refs/heads/claw/${fixture.job.id}`])).stdout.trim())
      .toBe(outcome.executedHead);
    expect(fixture.prBody).toContain("## Summary");
    expect(fixture.prBody).toContain("## Validation");
    expect(outcome.argv).toEqual(["run-plan", PLAN, "--foreground", "--quorum=power", "--resume-from", "4"]);
    expect(outcome.environment).toBe("owned-fixture-canary");
    expect(fixture.releases).toHaveLength(1);
    expect(fixture.calls.some(({ args }) => args.includes("--force") && args.includes("push"))).toBe(false);
  });

  it("freezes the validated executed HEAD rather than publishing a concurrently changed unrelated HEAD", async () => {
    const fixture = await runnerFixture({ script: ISOLATED_SCRIPT });
    const protectedHead = await unrelatedBranch(fixture);
    const runner = fixture.ctx.runner;
    let moved = false;
    fixture.ctx.runner = async (command, args, options) => {
      const completed = await runner(command, args, options);
      if (!moved && command === "git" && args.includes("--is-ancestor") && completed.code === 0) {
        moved = true;
        await checked("git", ["-C", fixture.worktree, "update-ref", "HEAD", protectedHead]);
      }
      return completed;
    };
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed.status).toBe("succeeded");
    const outcome = JSON.parse(await readFile(
      path.join(fixture.repo, ".forge", "runs", RUN_ID, "native-outcome.json"), "utf8",
    ));
    expect(moved).toBe(true);
    expect(fixture.prHead).toBe(outcome.executedHead);
    expect(fixture.prChange).toMatchObject({ code: 0, stdout: "approved native plan change\n" });
    expect((await checked("git", ["-C", fixture.repo, "rev-parse", "refs/heads/protected-unrelated"])).stdout.trim())
      .toBe(protectedHead);
  });

  it("does not overwrite or push a Claw ref that changes after its ancestry check", async () => {
    const fixture = await runnerFixture({ script: ISOLATED_SCRIPT });
    const protectedHead = await unrelatedBranch(fixture);
    const runner = fixture.ctx.runner;
    let moved = false;
    fixture.ctx.runner = async (command, args, options) => {
      const completed = await runner(command, args, options);
      if (!moved && command === "git" && args.includes("--is-ancestor") && completed.code === 0) {
        moved = true;
        await checked("git", ["-C", fixture.repo, "update-ref", `refs/heads/claw/${fixture.job.id}`, protectedHead]);
      }
      return completed;
    };
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "failed", error: "PUBLISH_FAILED" });
    expect(moved).toBe(true);
    expect((await checked("git", ["-C", fixture.repo, "rev-parse", `refs/heads/claw/${fixture.job.id}`])).stdout.trim())
      .toBe(protectedHead);
    expect(fixture.calls.some(({ args }) => args.includes("push"))).toBe(false);
    expect(fixture.prHead).toBeUndefined();
    expect(fixture.deliveries).toHaveLength(1);
    expect(completed.l2?.ok).toBe(true);
  });
});

async function unrelatedBranch(fixture) {
  await checked("git", ["-C", fixture.repo, "checkout", "--orphan", "protected-unrelated"]);
  await writeFile(path.join(fixture.repo, "unrelated.txt"), "unrelated protected ref\n");
  await checked("git", ["-C", fixture.repo, "add", "--", "unrelated.txt"]);
  await checked("git", ["-C", fixture.repo, "commit", "-m", "unrelated fixture ref"]);
  const head = (await checked("git", ["-C", fixture.repo, "rev-parse", "HEAD"])).stdout.trim();
  await checked("git", ["-C", fixture.repo, "checkout", "main"]);
  return head;
}

function publicationOwner(fixture) {
  let isReserved = false;
  const windows = [];
  const runner = fixture.ctx.runner;
  fixture.ctx.runner = async (command, args, options) => {
    expect(isReserved, `publication command ${command} ${args.join(" ")} escaped its owner`).toBe(true);
    // External-command contract fixture only; this does not certify the old generic run driver.
    const completed = await runner(command, args, options);
    return Object.hasOwn(completed, "settlementConfirmed") ? completed : { ...completed, settlementConfirmed: true };
  };
  fixture.ctx.withPublication = async ({ job, signal }, operation) => {
    expect(job.id).toBe(fixture.job.id);
    expect(signal?.aborted).not.toBe(true);
    const controller = new AbortController();
    isReserved = true;
    const window = { began: true, ended: false, confirmed: false, signal: controller.signal };
    windows.push(window);
    try {
      return await operation({ signal: controller.signal, confirmSettled: () => { window.confirmed = true; } });
    } finally {
      isReserved = false;
      window.ended = true;
    }
  };
  return windows;
}

describe("runner trusted publication owner contract", { timeout: NATIVE_PUBLICATION_TOLERANCE_MS }, () => {
  it("reserves the whole native publication region and awaits its callback before release", async () => {
    const fixture = await runnerFixture({ script: ISOLATED_SCRIPT });
    const windows = publicationOwner(fixture);
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed.status).toBe("succeeded");
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ began: true, ended: true, confirmed: true });
    expect(fixture.prChange).toMatchObject({ code: 0, stdout: "approved native plan change\n" });
  });

  it("requires a trusted owner before a lease-scoped job can publish", async () => {
    const fixture = await runnerFixture({
      script: ISOLATED_SCRIPT, jobFields: { leaseGrant: { leaseId: "fixture-lease", attempt: 1 } },
    });
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "failed", error: "LEASE_PUBLICATION_DENIED" });
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.prHead).toBeUndefined();
  });

  it("uses the owner's cancellation signal before any publication side effect", async () => {
    const fixture = await runnerFixture({ script: ISOLATED_SCRIPT });
    fixture.ctx.withPublication = async (_identity, operation) => {
      const controller = new AbortController();
      controller.abort();
      return operation({ signal: controller.signal });
    };
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "cancelled", error: "JOB_CANCELLED" });
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.prHead).toBeUndefined();
  });

  it("reserves and reconciles optional failure push without replacing the failed run outcome", async () => {
    const script = ISOLATED_SCRIPT.replace("allPassed: true", "allPassed: false")
      .replace('status: "succeeded"', 'status: "failed"') + "\nprocess.exitCode = 23;\n";
    const fixture = await runnerFixture({ script });
    fixture.config.jobs.pushOnFailure = true;
    const windows = publicationOwner(fixture);
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23 });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ began: true, ended: true, confirmed: true });
    expect((await checked("git", ["--git-dir", fixture.origin, "show",
      `claw/${fixture.job.id}:approved-change.txt`])).stdout).toBe("approved native plan change\n");
    expect(fixture.prHead).toBeUndefined();
    expect(fixture.releases).toHaveLength(0);
  });

  it("refuses missing command settlement proof before a trusted publication can mutate or push", async () => {
    const fixture = await runnerFixture({ script: ISOLATED_SCRIPT });
    const confirmSettled = vi.fn();
    const runner = fixture.ctx.runner;
    fixture.ctx.runner = async (...args) => {
      const { settlementConfirmed, settlement, ...completed } = await runner(...args);
      void settlementConfirmed;
      void settlement;
      return completed;
    };
    fixture.ctx.withPublication = async (_identity, operation) => operation({
      signal: new AbortController().signal, confirmSettled,
    });
    const completed = await createRunners(fixture.ctx).runJob(fixture.job);
    expect(completed).toMatchObject({ status: "failed", error: "LEASE_PUBLICATION_DENIED" });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0].args).toContain("status");
    expect(fixture.prHead).toBeUndefined();
    expect(confirmSettled).not.toHaveBeenCalled();
  });

  it.each([
    [true, 0, true],
    [false, 0, false],
    [true, -1, false],
  ])("awaits interrupted command physical proof %s, outcome %s, and confirms only unambiguous success", async (
    proof, code, shouldConfirm,
  ) => {
    const fixture = await runnerFixture({ script: ISOLATED_SCRIPT });
    const started = Promise.withResolvers();
    const completion = Promise.withResolvers();
    const controller = new AbortController();
    const confirmSettled = vi.fn();
    fixture.ctx.withPublication = async (_identity, operation) => operation({
      signal: controller.signal, confirmSettled,
    });
    fixture.ctx.runner = async (_command, args) => {
      expect(args).toContain("status");
      started.resolve();
      return completion.promise;
    };
    let settled = false;
    const pending = createRunners(fixture.ctx).runJob(fixture.job, { signal: controller.signal })
      .then((completed) => { settled = true; return completed; });
    await started.promise;
    controller.abort();
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(settled).toBe(false);
    expect(confirmSettled).not.toHaveBeenCalled();
    completion.resolve({ code, stdout: "", stderr: "", settlementConfirmed: proof });
    expect(await pending).toMatchObject({ status: "cancelled", error: "JOB_CANCELLED" });
    expect(confirmSettled).toHaveBeenCalledTimes(shouldConfirm ? 1 : 0);
    expect(fixture.prHead).toBeUndefined();
  });
});

function linuxProcessPorts() {
  const rows = [
    { pid: 7000, parentPid: 6000, start: "10", state: "R" },
    { pid: 7001, parentPid: 7000, start: "20", state: "R" },
    { pid: 7002, parentPid: 7001, start: "30", state: "R" },
    { pid: 7999, parentPid: 6000, start: "90", state: "R" },
  ];
  const ports = {
    run: vi.fn(async () => ({
      code: 0, stdout: rows.map((row) =>
        `${row.pid} ${row.parentPid} Sat Oct 10 18:30:00 2026 ${row.state}`).join("\n"), stderr: "",
    })),
    readFile: vi.fn(async (file) => {
      const pid = Number(path.basename(path.dirname(file)));
      const row = rows.find((entry) => entry.pid === pid);
      const fields = Array(20).fill("0");
      fields[0] = row.state;
      fields[1] = String(row.parentPid);
      fields[19] = row.start;
      return `${pid} (owned fixture (node)) ${fields.join(" ")}`;
    }),
    kill: vi.fn((pid, signal) => {
      const row = rows.find((entry) => entry.pid === pid);
      row.state = signal === "SIGSTOP" ? "T" : signal === "SIGKILL" ? "Z" : "R";
    }),
  };
  return { ports, rows };
}

describe("Guard: owned process birth identities and honest settlement proof", () => {
  it("does not couple process-tree inspection back to the generic runner it may safeguard", async () => {
    const source = await readFile(path.resolve("src", "jobs", "plan-process-tree.mjs"), "utf8");
    const driver = await readFile(path.resolve("src", "jobs", "worktree.mjs"), "utf8");
    expect(source).not.toContain('from "./worktree.mjs"');
    expect(driver).toContain("export function run(");
  });

  it("uses Linux proc birth ticks consistently for every owned descendant, not ps timestamp strings", async () => {
    const { ports, rows } = linuxProcessPorts();
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = vi.fn();
    const tree = createPlanProcessTree({ child, platform: "linux", env: {}, processes: ports });
    try {
      expect((await tree.terminate()).sort()).toEqual([7000, 7001, 7002]);
      expect(rows.find(({ pid }) => pid === 7999).state).toBe("R");
      expect(ports.kill.mock.calls.some(([pid]) => pid === 7999)).toBe(false);
      expect(tree.settlement()).toMatchObject({ settlementConfirmed: true, ownedPids: [7000, 7001, 7002] });
    } finally {
      await tree.close();
    }
  });

  it("does not turn an unobserved fast-exit root and an empty stop list into physical settlement proof", async () => {
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = vi.fn();
    const processes = {
      run: vi.fn(async () => ({ code: 0, stdout: "[]", stderr: "" })),
      readFile: vi.fn(), kill: vi.fn(),
    };
    const tree = createPlanProcessTree({ child, platform: "win32", env: {}, processes });
    child.emit("exit", 0);
    try {
      expect(await tree.terminate()).toEqual([]);
      expect(tree.settlement()).toEqual({
        settlementConfirmed: false, ownedPids: [], code: PLAN_TREE_ERRORS.UNAVAILABLE,
      });
      expect(processes.kill).not.toHaveBeenCalled();
    } finally {
      await tree.close();
    }
  });

  it("never signals a reused Linux PID, while stopping the previously observed reparented owned leaf", async () => {
    const { ports, rows } = linuxProcessPorts();
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = vi.fn();
    const tree = createPlanProcessTree({ child, platform: "linux", env: {}, processes: ports });
    try {
      await vi.waitFor(() => expect(ports.readFile.mock.calls.length).toBeGreaterThanOrEqual(3));
      Object.assign(rows.find(({ pid }) => pid === 7001), { parentPid: 6000, start: "200" });
      rows.find(({ pid }) => pid === 7002).parentPid = 1;
      expect((await tree.terminate()).sort()).toEqual([7000, 7002]);
      expect(ports.kill.mock.calls.some(([pid]) => pid === 7001 || pid === 7999)).toBe(false);
      expect(rows.find(({ pid }) => pid === 7001).state).toBe("R");
    } finally {
      await tree.close();
    }
  });

  it("fails closed on an ambiguous reparented macOS birth timestamp rather than signaling another PID", async () => {
    const { ports, rows } = linuxProcessPorts();
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = vi.fn();
    const tree = createPlanProcessTree({ child, platform: "darwin", env: {}, processes: ports });
    try {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
      rows.find(({ pid }) => pid === 7001).parentPid = 6000;
      await expect(tree.terminate()).rejects.toMatchObject({ code: PLAN_TREE_ERRORS.UNAVAILABLE });
      expect(ports.kill).not.toHaveBeenCalled();
      expect(tree.settlement().settlementConfirmed).toBe(false);
    } finally {
      await tree.close();
    }
  });

  it("does not signal an exited macOS root PID reused during the same ps birth-time second", async () => {
    const { ports, rows } = linuxProcessPorts();
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = vi.fn();
    const tree = createPlanProcessTree({ child, platform: "darwin", env: {}, processes: ports });
    try {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
      child.emit("exit", 0);
      rows.splice(1, 2);
      expect(await tree.terminate()).toEqual([]);
      expect(ports.kill).not.toHaveBeenCalled();
      expect(tree.settlement().settlementConfirmed).toBe(false);
    } finally {
      await tree.close();
    }
  });

  it("awaits an acknowledged POSIX stop before claiming a fixed descendant set", async () => {
    const { ports, rows } = linuxProcessPorts();
    rows.splice(1, 2);
    let stopReads = 0;
    const read = ports.run.getMockImplementation();
    ports.run.mockImplementation(async (...args) => {
      if (stopReads > 0 && --stopReads === 0) rows.find(({ pid }) => pid === 7000).state = "T";
      return read(...args);
    });
    const kill = ports.kill.getMockImplementation();
    ports.kill.mockImplementation((pid, signal) => {
      if (pid === 7000 && signal === "SIGSTOP") { stopReads = 5; return; }
      if (pid === 7000 && signal === "SIGKILL" && rows.find((row) => row.pid === pid).state === "R") {
        rows.push({ pid: 7003, parentPid: 1, start: "50", state: "R" });
      }
      kill(pid, signal);
    });
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = vi.fn();
    const tree = createPlanProcessTree({ child, platform: "linux", env: {}, processes: ports });
    try {
      await tree.terminate();
      expect(rows.filter(({ pid }) => pid !== 7999).every(({ state }) => state === "Z")).toBe(true);
      expect(rows.find(({ pid }) => pid === 7999).state).toBe("R");
    } finally {
      await tree.close();
    }
  });
});
