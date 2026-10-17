import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";
import workersFeature from "../../src/features/workers.mjs";
import { createEnrollment } from "../../src/protocol/enrollment.mjs";
import { L2_PACKET_KIND } from "../../src/protocol/messages.mjs";
import { L2_APPLY_READ } from "../../src/protocol/l2-receiver.mjs";
import { startE2EWorker } from "../helpers/e2e-worker.mjs";
import {
  createExecutionHome, createExecutionTimers, readPublishedFixture,
} from "../helpers/execution-evidence.mjs";
import { createFakeClock } from "../helpers/fake-clock.mjs";
import { cloneFixtureRepo } from "../helpers/fixture-repos.mjs";
import { createScriptedCopilot } from "../helpers/scripted-copilot.mjs";

const EXECUTION_LANE = "worker-a";
const HOME_LANE = "worker-home";
const PROJECT_ID = "fixture-1";
const PROOF_FILE = "execution-proof.json";
const HISTORY_FILE = "hub-events.jsonl";
const OWNER_ID = "701";
const APPROVER_ID = "702";
const MODEL = "fixture-execution-model";
const PROGRESS_EDIT_WINDOW_MS = 3_000;

let home;
let rig;
const workers = [];
const scripts = [];
const releases = [];
const listeners = [];

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const script of scripts.splice(0)) script.releaseAll();
  for (const [bus, listener] of listeners.splice(0)) bus.off("lane.event", listener);
  for (const worker of workers.splice(0).reverse()) await worker.stop();
  await rig?.teardown();
  rig = undefined;
  if (home) await rm(home, { recursive: true, force: true });
  home = undefined;
});

async function enableLane(laneId) {
  rig.send(`/lane ${laneId} on`, { user: OWNER_ID });
  await expect.poll(() => rig.handles.store.readJson("lanes.json", {}).lanes?.[laneId]?.on).toBe(true);
}

async function connectWorker({ id, laneId, copilot, beforeRead, clone = false, timers }) {
  const config = structuredClone(rig.config);
  if (clone) {
    const replica = await cloneFixtureRepo({
      project: rig.repos[0], directory: path.join(home, "worker repos", id),
    });
    config.projects.find((project) => project.id === PROJECT_ID).repo.path = replica.repoPath;
  }
  const registry = workersFeature.registry();
  expect(registry, JSON.stringify({
    lanes: rig.handles.lanes.snapshot(), feature: workersFeature.snapshot(), logs: rig.logs,
  })).not.toBeNull();
  const worker = await startE2EWorker({
    id, laneId, config, registry,
    enrollment: createEnrollment({ store: rig.handles.store, secretFile: path.join(home, "secrets.json") }),
    url: `ws://127.0.0.1:${rig.config.http.port}/claw/workers`,
    workerHome: path.join(home, "worker homes", id), ctx: rig.handles.ctx,
    capabilities: {
      os: process.platform, arch: process.arch, macos: process.platform === "darwin",
      toolchains: ["node", "git"], projects: [PROJECT_ID],
    },
    runtimeFactory: async ({ id: runtimeId }) => ({ ...copilot.runtime, id: runtimeId }),
    beforeRead, timers,
  });
  workers.push(worker);
  return worker;
}

async function writeAttempt(turn, attempt, ready) {
  expect(turn.model).toBe(MODEL);
  const jobId = path.basename(turn.cwd);
  const record = { id: `${jobId}:attempt-${attempt}`, jobId, kind: "execution.checkpoint", attempt };
  const proof = JSON.stringify({ jobId, attempt });
  const forgeDir = path.join(turn.cwd, ".forge");
  await mkdir(forgeDir, { recursive: true });
  for (const [fileName, bytes] of [
    [path.join(turn.cwd, PROOF_FILE), proof],
    [path.join(forgeDir, HISTORY_FILE), `${JSON.stringify(record)}\n`],
  ]) {
    expect(await turn.onPermissionRequest({ kind: "write", fileName })).toEqual({ kind: "approved" });
    await writeFile(fileName, bytes);
  }
  expect(await turn.onPermissionRequest({
    kind: "write", fileName: path.join(turn.cwd, "..", "escape.json"),
  })).toMatchObject({ kind: "denied-by-rules" });
  turn.emit("log", { message: `execution checkpoint attempt ${attempt}` });
  ready.resolve({ cwd: turn.cwd, record, proof });
}

function approveJob(job) {
  const card = rig.cardFor(`Approval required for task job ${job.id}`);
  expect(card).not.toBeNull();
  const approval = card.args.reply_markup.inline_keyboard.flat()
    .find((button) => button.callback_data?.startsWith("a:"));
  rig.tapCallback(APPROVER_ID, approval.callback_data, {
    chat: card.args.chat_id, thread: card.args.message_thread_id, messageId: card.result.message_id,
  });
}

describe("scenario requeue worker execution recovery", () => {
  it("requeues an in-flight mutation onto an approved replacement and waits for canonical history application, not receipt ACK", async () => {
    home = await createExecutionHome("requeue");
    const clock = createFakeClock();
    rig = await createE2ERig({
      home, clock,
      remoteWorkers: [
        { id: EXECUTION_LANE, labels: ["execution"] }, { id: HOME_LANE, labels: ["home"] },
      ],
      projectOverrides: {
        [PROJECT_ID]: {
          homeLane: HOME_LANE, placement: { prefer: [EXECUTION_LANE], requires: ["execution"] },
          models: { work: MODEL }, bootstrap: { copy: [], env: [], install: "none" },
        },
      },
    });
    const originalReady = Promise.withResolvers();
    const replacementReady = Promise.withResolvers();
    const finalApply = Promise.withResolvers();
    const releaseApply = Promise.withResolvers();
    releases.push(releaseApply.resolve);
    const originalScript = createScriptedCopilot({
      beforeRun: (turn) => writeAttempt(turn, 1, originalReady),
    });
    const replacementScript = createScriptedCopilot({
      beforeRun: (turn) => writeAttempt(turn, 2, replacementReady),
    });
    scripts.push(originalScript, replacementScript);
    let applyCount = 0;
    const homeWorker = await connectWorker({
      id: "canonical-home", laneId: HOME_LANE, copilot: createScriptedCopilot(),
      beforeRead: async (request) => {
        if (request.tool !== L2_APPLY_READ || ++applyCount !== 2) return;
        finalApply.resolve(request);
        await releaseApply.promise;
      },
    });
    const original = await connectWorker({
      id: "original", laneId: EXECUTION_LANE, copilot: originalScript, clone: true,
      timers: createExecutionTimers(),
    });
    await enableLane(HOME_LANE);
    await enableLane(EXECUTION_LANE);
    const events = [];
    const observe = (event) => events.push(event);
    rig.handles.ctx.bus.on("lane.event", observe);
    listeners.push([rig.handles.ctx.bus, observe]);
    rig.send("/task preserve execution across worker replacement", { thread: "101" });
    const job = await rig.waitForJob((candidate) => candidate.type === "task");
    originalScript.hold(job.id);
    await rig.tickApprovals();
    expect(original.packets.some(({ packet }) => packet.t === "lease" && packet.kind === "job")).toBe(false);
    approveJob(job);
    const firstOutput = await originalReady.promise;
    const checkpointAck = await original.syncHistory(job.id);
    expect(checkpointAck, JSON.stringify(checkpointAck))
      .toMatchObject({ jobId: job.id, projectId: PROJECT_ID, ok: true, attempt: 1 });
    const canonical = path.join(rig.repos[0].repoPath, ".forge", HISTORY_FILE);
    expect(await readFile(canonical, "utf8")).toBe(`${JSON.stringify(firstOutput.record)}\n`);
    const priorEvents = events.filter((event) => event.jobId === job.id);
    expect(priorEvents.some((event) => event.type === "log")).toBe(true);
    const priorSeq = priorEvents.at(-1).seq;
    expect((await rig.jobs())[job.id].state).toBe("running");

    await original.crashWorker();
    const registry = workersFeature.registry();
    expect(registry.current(original.workerId)).toBeFalsy();
    expect(await readFile(path.join(firstOutput.cwd, PROOF_FILE), "utf8")).toBe(firstOutput.proof);
    expect(await rig.prCalls()).toEqual([]);
    const timers = createExecutionTimers();
    const replacement = await connectWorker({
      id: "replacement", laneId: EXECUTION_LANE, copilot: replacementScript, clone: true, timers,
    });
    expect(replacement.workerId).not.toBe(original.workerId);
    const lease = await replacement.waitForPacket(({ direction, packet }) => direction === "inbound"
      && packet.t === "lease" && packet.kind === "job" && packet.job.id === job.id);
    expect(lease.packet).toMatchObject({
      attempt: 2, seqBase: priorSeq, lastSeq: priorSeq, resume: false,
      grant: { subject: replacement.workerId, approval: { kind: "consumed" } },
    });
    expect(lease.packet.job.project.models.work).toBe(MODEL);
    const secondOutput = await replacementReady.promise;
    const application = await finalApply.promise;
    expect(application.args).toMatchObject({ jobId: job.id, projectId: PROJECT_ID, deltaId: job.id });
    const chunk = replacement.packets.findLast(({ direction, packet }) => direction === "outbound"
      && packet.t === "event" && packet.event.data?.kind === L2_PACKET_KIND);
    const ready = await replacement.waitForPacket(({ direction, packet }) => direction === "inbound" && packet.t === "ready");
    await timers.advance(ready.packet.heartbeatMs);
    await replacement.waitForPacket(({ direction, packet }) => direction === "inbound" && packet.t === "heartbeat"
      && packet.leases?.some((entry) => entry.leaseId === lease.packet.leaseId
        && entry.attempt === 2 && entry.lastSeq >= chunk.packet.event.seq));
    expect((await rig.jobs())[job.id].state).toBe("running");
    expect(registry.completion(job.id)).toBeNull();
    expect(replacement.packets.some(({ direction, packet }) => direction === "outbound"
      && packet.t === "event" && packet.event.type === "finished" && packet.event.data.status === "succeeded")).toBe(false);
    expect(await readFile(canonical, "utf8")).toBe(`${JSON.stringify(firstOutput.record)}\n`);
    expect(await readFile(path.join(secondOutput.cwd, PROOF_FILE), "utf8")).toBe(secondOutput.proof);

    clock.advance(PROGRESS_EDIT_WINDOW_MS);
    releaseApply.resolve();
    const completed = await rig.waitForJob(job.id, "succeeded");
    clock.advance(PROGRESS_EDIT_WINDOW_MS);
    const completion = registry.completion(job.id);
    expect(completion).toMatchObject({
      ok: true, attempt: 2, applicationAck: {
        jobId: job.id, projectId: PROJECT_ID, deltaId: job.id,
        sha256Total: chunk.packet.event.data.sha256Total, ok: true,
      },
    });
    const afterJob = await replacement.waitForAfterJob(job.id);
    expect(afterJob.applicationAck).toMatchObject(completion.applicationAck);
    await expect(readFile(path.join(secondOutput.cwd, PROOF_FILE), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(canonical, "utf8")).toBe(
      `${JSON.stringify(firstOutput.record)}\n${JSON.stringify(secondOutput.record)}\n`,
    );
    expect(homeWorker.appliedReads).toHaveLength(2);
    const retained = events.filter((event) => event.jobId === job.id);
    expect(retained.filter((event) => event.type === "log").map((event) => event.data.message))
      .toEqual(["execution checkpoint attempt 1", "execution checkpoint attempt 2"]);
    expect(retained.map((event) => event.seq)).toEqual(
      Array.from({ length: retained.length }, (_, index) => index + 1),
    );
    expect(retained.filter((event) => event.type === "finished" && event.data.status === "succeeded")).toHaveLength(1);
    expect(completed).toMatchObject({ branch: `claw/${job.id}`, prUrl: expect.stringContaining("https://example.test/pr/") });
    expect(await rig.prCalls()).toHaveLength(1);
    expect(await readPublishedFixture({ project: rig.repos[0], jobId: job.id, relativePath: PROOF_FILE })).toBe(secondOutput.proof);
    const approvals = [...rig.handles.store.read("approvals")].map(({ record }) => record)
      .filter((record) => record.kind === "approval.consumed" && record.jobId === job.id);
    expect(approvals).toHaveLength(1);
    expect([...rig.handles.store.read("jobs")].map(({ record }) => record)
      .filter((record) => record.jobId === job.id && record.to === "succeeded")).toHaveLength(1);
    const progressRefs = [...rig.handles.store.read("progress")].map(({ record }) => record)
      .filter((record) => record.kind === "progress.message" && record.jobId === job.id);
    expect(progressRefs).toHaveLength(1);
    const messageId = progressRefs[0].messageId;
    await rig.fakeTelegram.waitFor(({ method, args }) => method === "editMessageText"
      && String(args.message_id) === String(messageId) && String(args.text).includes("Run Summary"));
    const edits = rig.editsFor(messageId);
    expect(new Set(edits).size).toBe(edits.length);
    expect(edits.filter((text) => text.includes("Run Summary"))).toHaveLength(1);
    expect(original.secretAppearsInPackets()).toBe(false);
    expect(replacement.secretAppearsInPackets()).toBe(false);
    expect(await original.secretAppearsInArtifacts(rig.grepStateFor)).toBe(false);
    expect(await replacement.secretAppearsInArtifacts(rig.grepStateFor)).toBe(false);
  });
});
