import { randomBytes, createHash } from "node:crypto";
import { ROLES } from "../enums.mjs";
import { getMemoryRuntime } from "../features/memory.mjs";
import { MEMORY_STREAMS, sanitizeRecord } from "../memory/memory-client.mjs";
import { button, keyboard } from "../channels/telegram/format.mjs";

const OWNER_ROLE = ROLES[0];
const CONFIRM_TTL_MS = 15 * 60 * 1000;

export function forgetAvailability(capabilities) {
  return capabilities?.canDelete === true;
}

async function handleForget(_context, input = {}) {
  const { client: memoryClient, context, direct } = getMemoryRuntime();
  const fail = (code) => ({ text: `${code}: The memory was not removed.` });
  const capability = await direct?.capabilities?.();
  if (!forgetAvailability(capability)) return fail("NOT_SUPPORTED");
  if (input.caller?.role !== OWNER_ROLE) return fail("FORBIDDEN");
  const id = Array.isArray(input.args) && input.args.length === 1
    ? String(input.args[0])
    : String(input.argsText ?? "").trim();
  if (!id || /\s/.test(id) || id.toLowerCase() === "latest" || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) {
    return fail("NOT_FOUND");
  }
  if (!context?.store || !memoryClient) return fail("NOT_SUPPORTED");

  const confirmId = randomBytes(8).toString("hex");
  const now = context.now ?? Date.now;
  const content = sanitizeRecord({ config: context.config, secrets: context.secrets, text: "" });
  context.store.append(MEMORY_STREAMS.confirm, {
    v: 1,
    id: confirmId,
    nonceHash: createHash("sha256").update(confirmId).digest("hex"),
    userId: String(input.caller.userId ?? ""),
    chatId: String(input.chatId ?? ""),
    topicId: input.threadId ?? null,
    projectId: input.project?.id ?? null,
    content,
    expiresAt: (typeof now === "function" ? now() : now) + CONFIRM_TTL_MS,
    _status: "pending",
    purpose: "forget",
    memoryId: id,
  });
  const confirmData = `c:${confirmId}:y`;
  const cancelData = `c:${confirmId}:n`;
  return {
    text: `Confirm removal of memory ${id}?`,
    keyboard: keyboard([[
      button("Confirm", confirmData),
      button("Cancel", cancelData),
    ]]),
  };
}

const command = {
  name: "forget", aliases: [], args: "<memory-id>", summary: "Forget a saved memory",
  details: "Remove a saved memory after confirmation.", examples: ["/forget memory-123", "/forget memory-456"],
  roles: [OWNER_ROLE], scope: "project", mutating: true,
  available: false, sinceSlice: 24, group: "Ask & memory",
  handle: handleForget,
};

export function createForgetCommand(capabilities) {
  return Object.freeze({ ...command, available: forgetAvailability(capabilities) });
}

export default Object.freeze(command);
