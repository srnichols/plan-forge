import { captureErrorCode } from "./capture-policy.mjs";

function callbackServices(context) {
  const services = context?.services ?? context ?? {};
  return {
    store: context?.store ?? services.store,
    logger: context?.logger ?? services.logger,
  };
}

/**
 * @param {{store?: {append: Function}, logger?: {error: Function},
 * services?: {store?: {append: Function}, logger?: {error: Function}}}} context
 * @param {string} prefix
 * @returns {void}
 */
export function auditUnboundCapture(context, prefix) {
  const { store, logger } = callbackServices(context);
  try {
    store?.append("audit", { kind: "callback-ignored", reason: "unbound", prefix });
  } catch (error) {
    logger?.error?.("Capture callback audit could not be recorded", {
      code: captureErrorCode(error, "STORE_WRITE_FAILED"),
    });
  }
}
