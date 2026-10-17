import { ROLES } from "./enums.mjs";

export const CAPTURE_WRITE_ROLES = Object.freeze(ROLES.slice(0, 2));
const CONFIRM_MINUTES = 15;
const MILLISECONDS_PER_MINUTE = 60_000;
export const CAPTURE_PENDING_TTL_MS = CONFIRM_MINUTES * MILLISECONDS_PER_MINUTE;
export const CAPTURE_REPLY_CHARS = 1900;
export const CAPTURE_ID_BYTES = 4;
export const CAPTURE_CALLBACK_BYTES = 64;
export const CAPTURE_WRITE_DENIED = "This action requires an owner or approver.";
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const PROVENANCE_FIELDS = Object.freeze(["origin", "untrustedContext", "adapter", "messageId"]);

/**
 * Select only declared capture provenance while preserving legacy absent-field shapes.
 * @param {{origin?:string,untrustedContext?:Array<{kind:string,source?:string,text:string}>,adapter?:string,messageId?:string|number}} input
 * @returns {{origin?:string,untrustedContext?:Array<{kind:string,source?:string,text:string}>,adapter?:string,messageId?:string|number}}
 */
export function captureProvenance(input = {}) {
  return Object.fromEntries(PROVENANCE_FIELDS
    .filter((field) => input[field] !== undefined)
    .map((field) => [field, input[field]]));
}

/**
 * @param {{config?: {allowlist?: Array<{userId: string|number, role: string, channel?: string}>},
 * caller?: {userId?: string|number, role?: string, channel?: string}, adapter?: string}} input
 * @returns {{userId?: string|number, role?: string, channel?: string}|null}
 */
export function captureWriteCaller({ config, caller, adapter } = {}) {
  if (!CAPTURE_WRITE_ROLES.includes(caller?.role)) return null;
  if (!Array.isArray(config?.allowlist)) return null;
  const surface = adapter ?? caller.channel;
  const current = config.allowlist.find((entry) => (
    String(entry.userId) === String(caller.userId)
    && (!surface || !entry.channel || entry.channel === surface)
  ));
  if (!CAPTURE_WRITE_ROLES.includes(current?.role)) return null;
  return { ...caller, role: current.role };
}

/**
 * @param {{code?: string}|undefined} error
 * @param {string|null} fallback
 * @returns {string|null}
 */
export function captureErrorCode(error, fallback) {
  return SAFE_CODE.test(String(error?.code ?? "")) ? error.code : fallback;
}

/**
 * @param {{origin?: string, untrustedContext?: Array<{kind: string, source?: string, text: string}>}} input
 * @returns {"trusted"|"untrusted"}
 */
export function captureOrigin(input = {}) {
  const hasUntrustedContext = Array.isArray(input.untrustedContext)
    ? input.untrustedContext.length > 0 : Boolean(input.untrustedContext);
  return (input.origin !== undefined && input.origin !== "trusted") || hasUntrustedContext
    ? "untrusted" : "trusted";
}
