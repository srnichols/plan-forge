import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { button, keyboard } from "./channels/telegram/format.mjs";
import { ClawError } from "./errors.mjs";
import { JOBS_STREAM, currentJobs, transition } from "./jobs/model.mjs";

export const DEFAULT_TTL_MS = 15 * 60_000;
export const APPROVER_ROLES = Object.freeze(["owner", "approver"]);
export const QUORUM_MODES = Object.freeze(["auto", "power", "speed", "false"]);
export const MAX_CALLBACK_BYTES = 64;
export const PAYLOAD_RE = /^([0-9a-f]{8}):([A-Za-z0-9_-]{22})(?::(x|auto|power|speed|false))?$/;

const hashNonce = (nonce) => createHash("sha256").update(nonce).digest("hex");

export function issueApproval({ jobId, chatId, threadId, requesterId, ttlMs = DEFAULT_TTL_MS, now = Date.now }) {
  const nonce = randomBytes(16).toString("base64url");
  const shortId = jobId.slice(0, 8);
  const record = {
    v: 1,
    kind: "approval.issued",
    jobId,
    shortId,
    chatId: String(chatId),
    threadId: threadId ?? null,
    requesterId: String(requesterId),
    nonceHash: hashNonce(nonce),
    expiresAt: now() + ttlMs,
    usedAt: null,
  };
  const makePayload = (suffix = "") => {
    const payload = `a:${shortId}:${nonce}${suffix}`;
    if (Buffer.byteLength(payload, "utf8") > MAX_CALLBACK_BYTES) {
      throw new ClawError("CALLBACK_DATA_TOO_LONG");
    }
    return payload;
  };
  return {
    record,
    approve: makePayload(),
    reject: makePayload(":x"),
    quorum(mode) {
      if (!QUORUM_MODES.includes(mode)) throw new ClawError("APPROVAL_QUORUM_INVALID");
      return makePayload(`:${mode}`);
    },
  };
}

function hashesMatch(expected, actual) {
  if (!/^[0-9a-f]{64}$/.test(expected) || !/^[0-9a-f]{64}$/.test(actual)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function verifyApproval(record, {
  nonce, chatId, threadId, approverRole, approverId, now = Date.now,
} = {}) {
  if (!record) return { ok: false, reason: "unknown" };
  if (record.usedAt !== null && record.usedAt !== undefined) return { ok: false, reason: "replay" };
  if (record.kind === "approval.expired" || now() > record.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (String(chatId) !== String(record.chatId)) return { ok: false, reason: "wrong-chat" };
  if (!APPROVER_ROLES.includes(approverRole)
    || String(approverId) === String(record.requesterId)) {
    return { ok: false, reason: "wrong-user" };
  }
  if (!hashesMatch(record.nonceHash, hashNonce(nonce))
    || (record.threadId !== null && record.threadId !== undefined
      && String(threadId) !== String(record.threadId))) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

export function parseApprovalPayload(payload) {
  if (typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > MAX_CALLBACK_BYTES) {
    return { ok: false, reason: "tampered" };
  }
  const match = PAYLOAD_RE.exec(payload);
  if (!match) return { ok: false, reason: "tampered" };
  const [, shortId, nonce, suffix] = match;
  return {
    ok: true,
    shortId,
    nonce,
    decision: suffix === "x" ? "reject" : "approve",
    ...(suffix && suffix !== "x" ? { quorum: suffix } : {}),
  };
}

function approvalsFold(records) {
  const byHash = new Map();
  const byShort = new Map();
  for (const record of records) {
    if (!record?.nonceHash) continue;
    if (record.kind === "approval.issued") {
      byHash.set(record.nonceHash, record);
      const candidates = byShort.get(record.shortId) ?? [];
      if (!candidates.includes(record.nonceHash)) candidates.push(record.nonceHash);
      byShort.set(record.shortId, candidates);
      continue;
    }
    if (!["approval.consumed", "approval.expired"].includes(record.kind)) continue;
    const issued = byHash.get(record.nonceHash);
    if (issued) byHash.set(record.nonceHash, { ...issued, ...record });
  }
  return { byHash, byShort };
}

function cleanMessageRef(messageRef) {
  if (!messageRef || typeof messageRef !== "object") return undefined;
  return {
    ...(messageRef.chatId !== undefined ? { chatId: String(messageRef.chatId) } : {}),
    ...(messageRef.messageId !== undefined ? { messageId: String(messageRef.messageId) } : {}),
    ...(messageRef.threadId !== undefined ? { threadId: messageRef.threadId === null ? null : String(messageRef.threadId) } : {}),
  };
}

function safeFailure(error) {
  return error instanceof ClawError ? error.code : "INTERNAL";
}

function validEstimateRow(row) {
  return row && typeof row.mode === "string"
    && typeof row.estimatedCostUSD === "number" && Number.isFinite(row.estimatedCostUSD)
    && Number.isFinite(row.totalSliceCount)
    && Number.isFinite(row.quorumSliceCount);
}

function formatPlanEstimate({ job, estimate, approval }) {
  if (estimate?.isError || estimate?.ok === false) return null;
  const recommended = estimate?.recommended;
  const selectedMode = QUORUM_MODES.includes(job.quorum) ? job.quorum : recommended;
  const selected = estimate?.[selectedMode];
  if (!QUORUM_MODES.includes(selectedMode) || !validEstimateRow(selected)
    || QUORUM_MODES.some((mode) => !validEstimateRow(estimate[mode]))) return null;
  const buttons = QUORUM_MODES.map((mode) => {
    const row = estimate[mode];
    return button(`${row.mode}: $${row.estimatedCostUSD}`, approval.quorum(mode));
  });
  const summary = [
    `Mode: ${selected.mode}`,
    `Estimated cost: $${selected.estimatedCostUSD}`,
    `Slices: ${selected.totalSliceCount}`,
    `Quorum slices: ${selected.quorumSliceCount}`,
  ];
  return { summary, quorumButtons: buttons };
}

export async function buildApprovalCard({ job, project, mcp, approval, now = Date.now, ttlMs } = {}) {
  if (!job) return { ok: false, error: "ESTIMATE_UNAVAILABLE" };
  let summary;
  let quorumButtons = [];
  if (job.type === "plan") {
    if (!mcp || typeof mcp.call !== "function") return { ok: false, error: "ESTIMATE_UNAVAILABLE" };
    let estimate;
    try {
      estimate = await mcp.call("forge_estimate_quorum", { planPath: job.planPath });
    } catch {
      return { ok: false, error: "ESTIMATE_UNAVAILABLE" };
    }
    const callbackApproval = approval ?? issueApproval({
      jobId: job.id,
      chatId: job.chatId,
      threadId: job.threadId,
      requesterId: job.callerId,
      ttlMs,
      now,
    });
    const formatted = formatPlanEstimate({ job, estimate, approval: callbackApproval });
    if (!formatted) return { ok: false, error: "ESTIMATE_UNAVAILABLE" };
    summary = formatted.summary;
    quorumButtons = formatted.quorumButtons;
    approval = callbackApproval;
  } else {
    approval ??= issueApproval({
      jobId: job.id,
      chatId: job.chatId,
      threadId: job.threadId,
      requesterId: job.callerId,
      ttlMs,
      now,
    });
    summary = [
      `Description: ${job.description ?? job.skill ?? "No description"}`,
      `Branch: ${job.targetBranch ?? `claw/${job.id}`}`,
      `Base branch: ${project?.repo?.baseBranch ?? "main"}`,
      `Lane: ${job.lane ?? project?.homeLane ?? "not assigned"}`,
    ];
  }

  const decisionButtons = [
    button("✅ Approve", approval.approve),
    button("❌ Reject", approval.reject),
  ];
  return {
    text: [`Approval required for ${job.type} job ${job.id}`, ...summary].join("\n"),
    keyboard: keyboard([
      decisionButtons,
      ...(quorumButtons.length ? [quorumButtons] : []),
    ]),
  };
}

export function createApprovalService({
  store, bus, mcp, channel, logger, now = Date.now, ttlMs = DEFAULT_TTL_MS,
} = {}) {
  function fold() {
    if (!store || typeof store.read !== "function") return approvalsFold([]);
    return approvalsFold([...store.read("approvals")].map(({ record }) => record));
  }

  function appendApproval(record) {
    if (!store || typeof store.append !== "function") throw new ClawError("SERVICE_UNAVAILABLE");
    return store.append("approvals", record);
  }

  function audit(record) {
    try {
      store?.append?.("audit", record);
    } catch {
      logger?.error?.("Claw audit write failed");
    }
  }

  function issue(job, { messageRef, approval } = {}) {
    const issued = approval ?? issueApproval({
      jobId: job.id,
      chatId: job.chatId,
      threadId: job.threadId,
      requesterId: job.callerId,
      ttlMs,
      now,
    });
    const source = issued.record ?? issued;
    const record = {
      v: 1,
      kind: "approval.issued",
      jobId: job.id,
      shortId: job.id.slice(0, 8),
      chatId: String(source.chatId),
      threadId: source.threadId ?? null,
      requesterId: String(source.requesterId),
      nonceHash: source.nonceHash,
      expiresAt: source.expiresAt,
      usedAt: null,
      ...(cleanMessageRef(messageRef) ? { messageRef: cleanMessageRef(messageRef) } : {}),
    };
    return appendApproval(record);
  }

  function transitionJob(job, to, reason) {
    const result = transition(job, to, { reason });
    store.append(JOBS_STREAM, result.event);
    bus?.emit("job.transition", result.event);
    return result;
  }

  async function decide({ payload, caller, chatId, threadId } = {}) {
    try {
      const parsed = parseApprovalPayload(payload);
      if (!parsed.ok) return parsed;
      const approvals = fold();
      const candidates = approvals.byShort.get(parsed.shortId) ?? [];
      const nonceHash = hashNonce(parsed.nonce);
      const matchedHash = candidates.find((candidate) => hashesMatch(candidate, nonceHash));
      const record = matchedHash ? approvals.byHash.get(matchedHash) : null;
      const verified = verifyApproval(record, {
        nonce: parsed.nonce,
        chatId,
        threadId,
        approverRole: caller?.role,
        approverId: caller?.userId,
        now,
      });
      if (!verified.ok) return verified;
      const jobs = currentJobs(store);
      const job = jobs[record.jobId];
      if (parsed.quorum && job?.type !== "plan") {
        return { ok: false, reason: "tampered" };
      }

      const usedAt = now();
      appendApproval({
        v: 1,
        kind: "approval.consumed",
        jobId: record.jobId,
        shortId: record.shortId,
        chatId: record.chatId,
        threadId: record.threadId,
        requesterId: record.requesterId,
        nonceHash: record.nonceHash,
        expiresAt: record.expiresAt,
        usedAt,
        approverId: String(caller.userId),
        decision: parsed.decision,
        ...(parsed.quorum ? { quorum: parsed.quorum } : {}),
      });

      if (job?.state !== "awaiting-approval") return { ok: false, reason: "stale" };
      const result = transitionJob(
        job,
        parsed.decision === "approve" ? "approved" : "rejected",
        `approval:${parsed.decision}`,
      );
      return {
        ok: true,
        jobId: job.id,
        decision: parsed.decision,
        ...(parsed.quorum ? { quorum: parsed.quorum } : {}),
        event: result.event,
      };
    } catch (error) {
      return { ok: false, reason: safeFailure(error) };
    }
  }

  function sweep() {
    if (!store) return [];
    try {
      const { byHash } = fold();
      const expired = [];
      for (const record of byHash.values()) {
        if (record.kind !== "approval.issued" || record.usedAt !== null || now() <= record.expiresAt) continue;
        appendApproval({
          v: 1,
          kind: "approval.expired",
          jobId: record.jobId,
          shortId: record.shortId,
          chatId: record.chatId,
          threadId: record.threadId,
          requesterId: record.requesterId,
          nonceHash: record.nonceHash,
          expiresAt: record.expiresAt,
        });
        const job = currentJobs(store)[record.jobId];
        if (job?.state === "awaiting-approval") transitionJob(job, "expired", "approval-ttl");
        expired.push(record);
      }
      return expired;
    } catch (error) {
      throw new ClawError(safeFailure(error));
    }
  }

  function pendingWithoutCard() {
    if (!store) return [];
    const issuedJobIds = new Set([...fold().byHash.values()].map((record) => record.jobId));
    return Object.values(currentJobs(store))
      .filter((job) => job.state === "awaiting-approval" && !issuedJobIds.has(job.id));
  }

  return {
    channel,
    audit,
    fold,
    issue,
    decide,
    sweep,
    pendingWithoutCard,
    buildApprovalCard: ({ job, project, approval: callbackApproval } = {}) => buildApprovalCard({
      job, project, mcp, approval: callbackApproval, now, ttlMs,
    }),
    createApproval: (job) => issueApproval({
      jobId: job.id,
      chatId: job.chatId,
      threadId: job.threadId,
      requesterId: job.callerId,
      ttlMs,
      now,
    }),
    snapshot() {
      return { pending: [...fold().byHash.values()].filter((record) => record.kind === "approval.issued" && record.usedAt === null).length };
    },
  };
}

export function bindApprovalService(service) {
  approvalService = service;
  auditTap = service?.audit ?? auditTap;
  return () => {
    if (approvalService === service) approvalService = null;
  };
}

export function writeApprovalAudit(record) {
  try {
    auditTap?.(record);
  } catch {
    // Audit failures must not break callback acknowledgement.
  }
}

let approvalService = null;
let auditTap = null;

export function getApprovalService() {
  return approvalService;
}
