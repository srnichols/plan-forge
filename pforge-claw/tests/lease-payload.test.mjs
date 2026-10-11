import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeasePreparer, wrapPreparedLane } from "../src/jobs/lease-payload.mjs";
import { createStore } from "../src/state/store.mjs";
import { canonical, signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createApprovalService, issueApproval } from "../src/approvals.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { fanoutDeclarationDigest } from "../src/jobs/approval-proof.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
let root;
let ctx;
let job;

beforeEach(async () => {
  root = await mkdtemp(path.join(TEST_DIRECTORY, ".claw-lease-payload-"));
  const repoPath = path.join(root, "project");
  await mkdir(path.join(repoPath, ".forge"), { recursive: true });
  await writeFile(path.join(repoPath, ".forge.json"), '{"fixture":true}');
  await writeFile(path.join(repoPath, ".forge", "fm-prefs.json"), '{"fixture":true}');
  ctx = {
    store: createStore(path.join(root, "state"), { now: () => new Date(0) }),
    secrets: await createSecrets({ env: { APPROVED_OPENAI_KEY: "not-a-wire-value" } }),
    config: {
      allowlist: [
        { channel: "telegram", userId: "owner1", role: "owner" },
        { channel: "telegram", userId: "approver1", role: "approver" },
      ],
      policy: { ghcpRoles: ["owner"] },
      runtimes: {
        default: "copilot-sdk",
        byok: { openai: { endpoint: "https://approved.example", keySecret: "APPROVED_OPENAI_KEY" } },
      },
      bootstrap: { copy: [".forge.json", ".forge/fm-prefs.json"], env: ["APPROVED_OPENAI_KEY"], install: "link" },
      lanes: [{ id: "local", kind: "local" }],
      projects: [{
        id: "p1", homeLane: "local",
        repo: { path: repoPath, remote: "https://example.org/p1.git", baseBranch: "main" },
        models: { chat: "approved-chat-model", work: "approved-work-model" },
      }],
    },
  };
  job = {
    id: "1234abcd-job", projectId: "p1", type: "plan", mutating: true, callerId: "owner1",
    description: "docs/plans/fixture-PLAN.md", planPath: "docs/plans/fixture-PLAN.md",
    quorum: "speed", resumeFrom: 7, chatId: "private-chat", threadId: "private-topic", args: ["original"],
  };
  job = await approveStoredJob(job, "speed");
});

afterEach(async () => rm(root, { recursive: true, force: true }));

function prepare(laneConfig = { id: "remote1", kind: "remote" }) {
  return createLeasePreparer({ ctx, laneConfig, directory: null, now: () => 0 });
}

async function approveStoredJob(candidate, selectedQuorum) {
  const initial = {
    ...createJob({
      id: candidate.id, type: candidate.type, projectId: candidate.projectId, parentId: candidate.parentId,
    }).job,
    ...candidate,
    state: "queued",
  };
  ctx.store.append(JOBS_STREAM, { kind: "job.created", job: initial });
  ctx.store.append(JOBS_STREAM, transition(initial, "awaiting-approval").event);
  const approval = issueApproval({
    jobId: initial.id, requesterId: initial.callerId,
    chatId: initial.chatId, threadId: initial.threadId, now: () => 0,
  });
  ctx.store.append("approvals", approval.record);
  const service = createApprovalService({ store: ctx.store, config: ctx.config, now: () => 0 });
  const selected = selectedQuorum ? approval.quorum(selectedQuorum) : approval.approve;
  expect(await service.decide({
    payload: selected.slice(2), caller: ctx.config.allowlist.find((entry) => entry.userId === initial.callerId),
    chatId: initial.chatId, threadId: initial.threadId,
  })).toMatchObject({ ok: true });
  return currentJobs(ctx.store)[initial.id];
}

async function replaceApproval(candidate, selectedQuorum = "speed") {
  ctx.store = createStore(path.join(root, `state-${candidate.callerId}-${selectedQuorum}`), { now: () => new Date(0) });
  job = await approveStoredJob(candidate, selectedQuorum);
  return job;
}

async function approvedFamily() {
  ctx.store = createStore(path.join(root, "family-state"), { now: () => new Date(0) });
  const parent = {
    ...createJob({ id: "beefabcd-parent", type: "fanout", projectId: "general" }).job,
    callerId: "owner1", callerRole: "owner", adapter: "telegram", updateId: "family-request",
    chatId: "private-chat", threadId: "private-topic", description: "Approved family",
    task: "Approved child task",
    targets: [{ childId: "7654abcd-child", projectId: "p1", branch: "claw/7654abcd-child" }],
  };
  parent.approvalDigest = fanoutDeclarationDigest(parent);
  await approveStoredJob(parent);
  const child = {
    ...createJob({ id: "7654abcd-child", type: "task", projectId: "p1", parentId: parent.id }).job,
    fanoutParentId: parent.id, targetBranch: "claw/7654abcd-child", description: parent.task,
    callerId: parent.callerId, callerRole: parent.callerRole, adapter: parent.adapter,
    updateId: parent.updateId, chatId: parent.chatId, threadId: parent.threadId,
  };
  ctx.store.append(JOBS_STREAM, { kind: "job.created", job: child });
  return { parent, child };
}

function signed(payload) {
  return {
    ...payload,
    leaseGrant: signGrant({ grant: payload.leaseGrant, subject: "worker1", key: "fixture-signing-key" }),
  };
}

function verify(payload) {
  return verifyGrant({
    grant: payload.leaseGrant, job: payload, subject: "worker1",
    laneId: payload.leaseGrant.laneId, key: "fixture-signing-key", now: () => 1,
  });
}

describe("signed dispatch execution choices", () => {
  it("preserves the approved quorum, resume position, project models, and bootstrap names", async () => {
    const payload = await prepare()(job);
    expect(payload).toMatchObject({
      quorum: "speed", resumeFrom: 7, runtime: "copilot-sdk",
      project: {
        id: "p1",
        models: { work: "approved-work-model", chat: "approved-chat-model" },
        bootstrap: { copy: ctx.config.bootstrap.copy, env: ["APPROVED_OPENAI_KEY"], install: "link" },
      },
    });
    expect(payload.prompt).toBe(job.description);
    expect(payload.plan).toBe(job.planPath);
    expect(verify(signed(payload))).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/private-chat|private-topic|owner1|not-a-wire-value/);
  });

  it("resolves the selected lane's BYOK runtime at dispatch, including for an approver", async () => {
    await replaceApproval({ ...job, callerId: "approver1" });
    const payload = await prepare({ id: "remote1", kind: "remote", runtime: "byok:openai" })(job);
    expect(payload.runtime).toBe("openai");
    expect(payload.provider).toEqual({
      type: "openai", endpoint: "https://approved.example", keySecret: "APPROVED_OPENAI_KEY",
    });
    expect(JSON.stringify(payload)).not.toContain("not-a-wire-value");
    expect(verify(signed(payload))).toBe(true);
  });

  it("preserves project precedence over the selected lane and enforces the GHCP role gate", async () => {
    ctx.config.projects[0].runtime = "copilot-sdk";
    await replaceApproval({ ...job, callerId: "approver1" });
    await expect(prepare({ id: "remote1", kind: "remote", runtime: "openai" })(job))
      .rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
  });

  it("uses the actual project's models and a pod-safe bootstrap contract in K8s leases", async () => {
    const payload = await prepare({ id: "pods", kind: "k8s", runtime: "openai" })(job);
    expect(payload.project).toMatchObject({
      models: { work: "approved-work-model", chat: "approved-chat-model" },
      bootstrap: { copy: ctx.config.bootstrap.copy, env: ["APPROVED_OPENAI_KEY"], install: "ci" },
      repo: { url: "https://example.org/p1.git", defaultBranch: "main" },
    });
    expect(payload.bootstrapFiles.map((file) => file.path)).toEqual([".forge.json", ".forge/fm-prefs.json"]);
    expect(verify(signed(payload))).toBe(true);
  });

  it("collects pod bootstrap from any configured local home ID without a remote read", async () => {
    ctx.config.lanes = [{ id: "workstation-home", kind: "local" }];
    ctx.config.projects[0].homeLane = "workstation-home";
    const payload = await prepare({ id: "pods", kind: "k8s", runtime: "openai" })(job);
    expect(payload.bootstrapFiles.map((file) => file.path)).toEqual([".forge.json", ".forge/fm-prefs.json"]);
    expect(verify(signed(payload))).toBe(true);
  });

  it("routes a remote home even if its configured ID is local", async () => {
    ctx.config.lanes = [{ id: "local", kind: "remote" }];
    const reads = [];
    const bootstrapFiles = [{ path: ".forge.json", content: Buffer.from('{"remote":true}').toString("base64") }];
    const preparer = createLeasePreparer({
      ctx, laneConfig: { id: "pods", kind: "k8s", runtime: "openai" }, now: () => 0,
      directory: { get(id) { return { async read(request) { reads.push({ id, request }); return bootstrapFiles; } }; } },
    });
    const payload = await preparer(job);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ id: "local", request: { projectId: "p1", tool: "claw.bootstrap.copySet" } });
    expect(payload.bootstrapFiles).toEqual(bootstrapFiles);
    expect(verify(signed(payload))).toBe(true);
  });

  it("refuses bootstrap when the canonical home lane is not configured", async () => {
    ctx.config.lanes = [];
    await expect(prepare({ id: "pods", kind: "k8s", runtime: "openai" })(job))
      .rejects.toMatchObject({ code: "BOOTSTRAP_HOME_UNAVAILABLE" });
  });

  it("takes an immutable detached snapshot without changing approval, job, or config records", async () => {
    job.args = ["original"];
    const jobBefore = canonical(job);
    const configBefore = canonical(ctx.config);
    const approvalsBefore = canonical(ctx.store.read("approvals"));
    const payload = await prepare()(job);
    const digestBefore = payload.leaseGrant.jobDigest;
    expect(canonical(job)).toBe(jobBefore);
    expect(canonical(ctx.config)).toBe(configBefore);
    expect(canonical(ctx.store.read("approvals"))).toBe(approvalsBefore);
    job.args.push("later");
    ctx.config.projects[0].models.work = "later-model";
    ctx.config.bootstrap.env.push("LATER_KEY");
    expect(payload.args).toEqual(["original"]);
    expect(payload.project.models.work).toBe("approved-work-model");
    expect(payload.project.bootstrap.env).toEqual(["APPROVED_OPENAI_KEY"]);
    expect(payload.leaseGrant.jobDigest).toBe(digestBefore);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.project.models)).toBe(true);
    expect(Object.isFrozen(payload.leaseGrant.approval)).toBe(true);
  });

  it("pins the selected lane before asynchronous lease preparation", async () => {
    const lane = { id: "remote1", kind: "remote", runtime: "openai" };
    const pending = prepare(lane)(job);
    lane.id = "changed";
    lane.kind = "k8s";
    lane.runtime = "copilot-sdk";
    const payload = await pending;
    expect(payload.leaseGrant.laneId).toBe("remote1");
    expect(payload.runtime).toBe("openai");
    expect(payload.bootstrapFiles).toBeUndefined();
  });

  it("binds every preserved choice to the signed digest and rejects post-approval tampering", async () => {
    const payload = signed(await prepare({ id: "remote1", kind: "remote", runtime: "openai" })(job));
    for (const change of [
      { quorum: "power" }, { resumeFrom: 8 },
      { project: { ...payload.project, models: { work: "tampered" } } },
      { project: { ...payload.project, bootstrap: { env: ["OTHER_KEY"] } } },
      { provider: { ...payload.provider, endpoint: "https://other.example" } },
      { provider: { ...payload.provider, keySecret: "OTHER_KEY" } },
    ]) {
      expect(() => verify({ ...payload, ...change })).toThrowError(
        expect.objectContaining({ code: "LEASE_GRANT_INVALID", details: { reason: "DIGEST" } }),
      );
    }
  });

  it.each([null, "all", true, 1])("refuses an unvalidated quorum %s", async (quorum) => {
    await expect(prepare()({ ...job, quorum })).rejects.toMatchObject({ code: "APPROVAL_QUORUM_INVALID" });
  });

  it.each([null, 0, -1, 1.5, "7", Number.MAX_SAFE_INTEGER + 1])(
    "refuses an unvalidated resume position %s",
    async (resumeFrom) => {
      await expect(prepare()({ ...job, resumeFrom })).rejects.toMatchObject({ code: "PLAN_RESUME_INVALID" });
    },
  );

  it("never accepts a caller-provided runtime or provider override at dispatch", async () => {
    await expect(prepare()({ ...job, runtime: "openai" }))
      .rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
    await expect(prepare()({ ...job, provider: { type: "openai", apiKey: "injected-canary" } }))
      .rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
  });

  it("refuses leases without consumed approval and preserves the read-only skill exception", async () => {
    await expect(prepare()({ ...job, id: "unapproved" })).rejects.toMatchObject({ code: "LEASE_PROOF_MISSING" });
    const readOnlyJob = {
      ...createJob({ id: "readonly", projectId: "p1", type: "skill", readOnly: true }).job,
      callerId: "owner1", skill: "inspect",
    };
    ctx.store.append(JOBS_STREAM, { kind: "job.created", job: readOnlyJob });
    const payload = await prepare()(readOnlyJob);
    expect(payload.leaseGrant.approval).toEqual({ kind: "read-only", ref: null, decidedAt: null });
  });

  it("consumes a prepared immutable payload once, rather than using a later mutable job", async () => {
    const submissions = [];
    const lane = wrapPreparedLane({
      submit: (payload) => { submissions.push(payload); return payload; },
      cancel: () => {},
    }, prepare());
    const payload = await lane.prepareLease(job);
    job.quorum = "power";
    expect(lane.submit(job)).toBe(payload);
    expect(submissions[0].quorum).toBe("speed");
    expect(() => lane.submit(job)).toThrow("LEASE_NOT_PREPARED");
  });

  it("signs consumed quorum selection and durable resume rather than submitted copies", async () => {
    await replaceApproval(job, "power");
    const submitted = { ...job, quorum: "false", resumeFrom: 12, args: ["tampered"] };
    const before = canonical(submitted);
    const payload = await prepare()(submitted);
    expect(payload).toMatchObject({ quorum: "power", resumeFrom: 7, args: ["original"] });
    expect(canonical(submitted)).toBe(before);
    expect(verify(signed(payload))).toBe(true);
  });

  it("refuses inherited approval for a stored job outside the declared family", async () => {
    const { child } = await approvedFamily();
    const rogue = { ...child, id: "8765abcd-rogue", targetBranch: "claw/8765abcd-rogue" };
    ctx.store.append(JOBS_STREAM, { kind: "job.created", job: rogue });
    await expect(prepare()(rogue)).rejects.toMatchObject({ code: "LEASE_PROOF_MISSING" });
  });

  it("refuses altered child task or provenance while preserving valid inherited proof", async () => {
    const { child } = await approvedFamily();
    const payload = await prepare()(child);
    expect(payload.leaseGrant.approval.kind).toBe("parent-consumed");
    expect(verify(signed(payload))).toBe(true);
    for (const changed of [
      { description: "Different task" }, { chatId: "different-chat" }, { callerId: "approver1" },
    ]) {
      await expect(prepare()({ ...child, ...changed })).rejects.toMatchObject({ code: "LEASE_PROOF_MISSING" });
    }
  });

  it("does not upgrade a durable mutating plan to read-only from input flags", async () => {
    await expect(prepare()({ ...job, type: "skill", mutating: false, readOnly: true }))
      .rejects.toMatchObject({ code: "LEASE_PROOF_MISSING" });
  });

  it("refuses historical approval after the caller is demoted even for BYOK", async () => {
    ctx.config.allowlist[0].role = "viewer";
    await expect(prepare({ id: "remote1", kind: "remote", runtime: "openai" })(job))
      .rejects.toMatchObject({ code: "LEASE_PROOF_MISSING" });
  });

  it("does not grant a demoted viewer a durable read-only skill on a BYOK lane", async () => {
    const readonly = {
      ...createJob({ id: "readonly-demoted", type: "skill", projectId: "p1", readOnly: true }).job,
      callerId: "owner1", skill: "inspect",
    };
    ctx.store.append(JOBS_STREAM, { kind: "job.created", job: readonly });
    ctx.config.allowlist[0].role = "viewer";
    await expect(prepare({ id: "remote1", kind: "remote", runtime: "openai" })(readonly))
      .rejects.toMatchObject({ code: "LEASE_PROOF_MISSING" });
  });

  it("accepts a real scheduled owner approval while retaining scheduler source provenance", async () => {
    await replaceApproval({
      ...createJob({ id: "cafeabcd-scheduled", type: "skill", projectId: "p1" }).job,
      callerId: "owner1", callerRole: "owner", adapter: "scheduler", updateId: "schedule:audit:slot-1",
      chatId: "private-chat", threadId: "private-topic", skill: "audit",
    }, null);
    const payload = await prepare()(job);
    expect(payload.leaseGrant.approval.kind).toBe("consumed");
    expect(verify(signed(payload))).toBe(true);
  });
});
