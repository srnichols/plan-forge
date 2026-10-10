import { createHash, randomBytes } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { normalizeUsage } from "../budget.mjs";
import { requestIdentity, requestKey } from "../jobs/request-identity.mjs";

const OUTCOME_STREAM = "ask-results";
const ID_BYTES = 12;
const REPLY_LIMIT = 16_000;
const UNTRUSTED_BYTES = 8192;
const CONTEXT_KINDS = Object.freeze(["forward", "link", "transcript", "file", "other"]);

function measurement(values) {
  const reported = values.filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return reported.length ? reported.reduce((sum, value) => sum + value, 0) : null;
}

function outcomeUsage(result) {
  const raw = Array.isArray(result?.usage) ? result.usage : [result?.usage];
  const records = raw.filter((record) => record && typeof record === "object" && !Array.isArray(record));
  const units = records.map(normalizeUsage);
  const costUSD = measurement(units.map((record) => record.costUSD));
  return {
    costUSD,
    costUsd: costUSD,
    premiumRequests: measurement(units.map((record) => record.premiumRequests)),
    tokensIn: measurement(records.map((record) => record.tokensIn ?? record.inputTokens)),
    tokensOut: measurement(records.map((record) => record.tokensOut ?? record.outputTokens)),
    model: records.find((record) => typeof record.model === "string")?.model ?? null,
  };
}

/** Validates third-party data in the upstream array contract, never as trusted instruction text. */
export function normalizeUntrustedContext(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ClawError("ASK_CONTEXT_INVALID");
  let bytes = 0;
  return value.map((entry) => {
    if (!entry || !CONTEXT_KINDS.includes(entry.kind) || typeof entry.text !== "string"
      || (entry.source !== undefined && typeof entry.source !== "string")) {
      throw new ClawError("ASK_CONTEXT_INVALID");
    }
    bytes += Buffer.byteLength(entry.text, "utf8");
    if (bytes > UNTRUSTED_BYTES) throw new ClawError("ASK_CONTEXT_INVALID");
    return { kind: entry.kind, text: entry.text, ...(entry.source !== undefined ? { source: entry.source } : {}) };
  });
}

/** Request scope also supplies the stable ledger identity used on response retry/restart. */
export function askRequest({ project, caller, chatId, threadId, adapter, updateId }) {
  return requestIdentity({
    type: "ask", projectId: project.id, callerId: caller.userId, adapter, updateId,
    chatId, threadId, parentId: null,
  });
}

/** Owns bounded durable ask outcomes and exactly one independent-units ledger row per outcome. */
export function createAskHistory(ctx) {
  function load(request) {
    const key = requestKey(request);
    if (key === null) return null;
    return ctx.store.fold(OUTCOME_STREAM, (latest, record) => requestKey(record.request) === key ? record : latest, null);
  }

  function save({ request, result, reply, actions, untrusted }) {
    const key = requestKey(request);
    const id = key === null
      ? randomBytes(ID_BYTES).toString("hex")
      : createHash("sha256").update(key).digest("hex").slice(0, ID_BYTES * 2);
    const safeReply = ctx.secrets?.redact ? ctx.secrets.redact(reply) : reply;
    const outcome = {
      v: 1, id: `ask-${id}`, request, reply: safeReply.slice(0, REPLY_LIMIT),
      usage: outcomeUsage(result), actions, untrusted,
      sessionId: typeof result?.sessionId === "string" ? result.sessionId : null,
    };
    ctx.store.append(OUTCOME_STREAM, outcome);
    return outcome;
  }

  function persistUsage(outcome, { project, chatId }) {
    const alreadyWritten = ctx.store.fold("budget", (found, record) => found || record.jobId === outcome.id, false);
    if (alreadyWritten) return false;
    try {
      ctx.store.append("budget", {
        v: 1, kind: "ask", source: "ask", project: project.id, chatId, jobId: outcome.id, usage: outcome.usage,
      });
      return false;
    } catch (error) {
      ctx.logger?.error?.("Forge-Master usage could not be recorded", { code: error?.code ?? "STORE_WRITE_FAILED" });
      return true;
    }
  }

  return { load, save, persistUsage };
}
