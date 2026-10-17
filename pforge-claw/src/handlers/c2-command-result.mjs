import { ClawError } from "../errors.mjs";

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SERVICE_REPLY = /^SERVICE_UNAVAILABLE(?::\s*[\w .-]{0,64})?$/;

/** Formats safe command errors without exception details, paths or credentials. */
export function commandErrorText(commandName, error) {
  const code = error instanceof ClawError && ERROR_CODE_PATTERN.test(String(error.code)) ? error.code : "INTERNAL";
  if (code === "SERVICE_UNAVAILABLE") {
    return `/${commandName} can't run right now: a required service isn't running. Try again later or check \`pforge claw doctor\`.`;
  }
  return `/${commandName} couldn't be completed (${code}). Try again later or check \`pforge claw doctor\`.`;
}

/** Preserves command keyboards and leaves already-delivered empty/undefined callback results alone. */
export async function sendCommandResult({ channel, chatId, threadId, result, commandName, secrets }) {
  const messages = Array.isArray(result) ? result : [result];
  for (const message of messages) {
    if (!message || typeof message.text !== "string") continue;
    const raw = SERVICE_REPLY.test(message.text.trim())
      ? commandErrorText(commandName, new ClawError("SERVICE_UNAVAILABLE"))
      : message.text;
    const text = secrets?.redact ? secrets.redact(raw) : raw;
    const replyMarkup = message.replyMarkup ?? message.keyboard;
    await channel.send({
      chatId, threadId, text,
      ...(replyMarkup ? { replyMarkup } : {}),
      ...(message.messageId !== undefined ? { messageId: message.messageId } : {}),
    });
  }
}
