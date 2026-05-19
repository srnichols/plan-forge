/**
 * Plan Forge — Notification Adapter Contract
 *
 * Phase FORGE-SHOP-03 Slice 03.1
 *
 * Defines the shape every notification adapter must implement.
 * No runtime base class — just JSDoc + runtime validation.
 *
 * @typedef {Object} AdapterSendArgs
 * @property {Object} event        - Hub event (type, data, timestamp, etc.)
 * @property {string} route        - Adapter name that matched the route
 * @property {string} formattedMessage - Human-readable message text
 * @property {string} correlationId    - Trace ID for this delivery
 * @property {Object} config       - Resolved adapter config (env vars expanded)
 *
 * @typedef {Object} AdapterSendResult
 * @property {boolean} ok          - True if delivery succeeded
 * @property {number}  [statusCode] - HTTP status code (for HTTP-based adapters)
 * @property {number}  [deliveryMs] - Round-trip time in ms
 * @property {string}  [errorCode]  - Machine-readable error (TIMEOUT, HTTP_500, NETWORK_ERROR, etc.)
 * @property {string}  [error]      - Human-readable error message
 *
 * @typedef {Object} AdapterValidateResult
 * @property {boolean} ok
 * @property {string}  [reason] - Why validation failed
 *
 * @typedef {Object} NotificationAdapter
 * @property {string} name                        - Adapter identifier (e.g. "webhook")
 * @property {(args: AdapterSendArgs) => Promise<AdapterSendResult>} send
 * @property {(config: Object) => AdapterValidateResult} validate
 */

export const ERR_NOT_IMPLEMENTED = "ERR_NOT_IMPLEMENTED";

/**
 * Validate that an object conforms to the adapter contract.
 * @param {*} adapter
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateAdapterShape(adapter) {
  const missing = [];
  if (!adapter || typeof adapter !== "object") return { valid: false, missing: ["adapter object"] };
  if (typeof adapter.name !== "string") missing.push("name");
  if (typeof adapter.send !== "function") missing.push("send");
  if (typeof adapter.validate !== "function") missing.push("validate");
  return { valid: missing.length === 0, missing };
}
