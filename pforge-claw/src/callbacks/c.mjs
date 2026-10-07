import { createHash, timingSafeEqual } from "node:crypto";
import { ROLES } from "../enums.mjs";
import { getMemoryRuntime } from "../features/memory.mjs";
import { MEMORY_STREAMS } from "../memory/memory-client.mjs";

function latestConfirmation(store, id) {
  return store.fold(MEMORY_STREAMS.confirm, (latest, record) => (
    record.id === id ? { ...(latest ?? {}), ...record } : latest
  ), null);
}

function nonceMatches(id, nonceHash) {
  if (typeof nonceHash !== "string" || !/^[a-f0-9]{64}$/i.test(nonceHash)) return false;
  const expected = createHash("sha256").update(id).digest();
  const actual = Buffer.from(nonceHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function identityMatches(pending, { caller, chatId, threadId }) {
  return String(pending.userId ?? "") === String(caller?.userId ?? "")
    && String(pending.chatId ?? "") === String(chatId ?? "")
    && String(pending.topicId ?? "") === String(threadId ?? "");
}

function parsePayload(payload) {
  const match = /^([A-Za-z0-9._-]{1,48}):([yn])$/.exec(String(payload ?? ""));
  return match ? { id: match[1], answer: match[2] } : null;
}

function reject(code) {
  return { ok: false, code };
}

export default Object.freeze({
  prefix: "c",
  sinceSlice: 24,
  available: true,
  roles: [ROLES[0], ROLES[1], ROLES[2]],
  async handle(_callbackContext, { payload, caller, chatId, threadId } = {}) {
    const parsed = parsePayload(payload);
    const { client, context, direct } = getMemoryRuntime();
    const store = context?.store;
    if (!parsed || !store || !client) return reject("MEMORY_CONFIRM_INVALID");

    const pending = latestConfirmation(store, parsed.id);
    const now = context.now ?? Date.now;
    const time = typeof now === "function" ? now() : now;
    if (!pending
      || pending._status !== "pending"
      || !nonceMatches(parsed.id, pending.nonceHash)
      || !Number.isFinite(pending.expiresAt)
      || pending.expiresAt <= time
      || !identityMatches(pending, { caller, chatId, threadId })) {
      return reject("MEMORY_CONFIRM_REJECTED");
    }
    if (pending.purpose === "forget" && caller?.role !== ROLES[0]) return reject("FORBIDDEN");

    store.append(MEMORY_STREAMS.confirm, {
      id: parsed.id,
      _status: "consumed",
      decision: parsed.answer,
      consumedAt: time,
    });
    if (parsed.answer === "n") return { ok: true, canceled: true };

    if (pending.purpose === "forget") {
      const capability = await direct?.capabilities?.();
      if (capability?.canDelete !== true) return reject("NOT_SUPPORTED");
      return direct.remove(pending.memoryId);
    }
    return client.capture(pending.projectId, {
      content: pending.content,
      type: pending.type ?? "lesson",
      origin: "untrusted",
      tags: pending.tags,
      lane: pending.lane ?? "confirm",
      ref: pending.ref ?? parsed.id,
      caller: { userId: caller?.userId, role: caller?.role },
    });
  },
});
