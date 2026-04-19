/**
 * Plan Forge — Webhook Notification Adapter
 *
 * Phase FORGE-SHOP-03 Slice 03.1
 *
 * Sends notifications via HTTP POST (webhook). Uses native fetch() — no deps.
 * Conforms to the adapter contract defined in adapter-contract.mjs.
 */

/**
 * Validate webhook adapter config.
 * @param {Object} config
 * @returns {{ ok: boolean, reason?: string }}
 */
function validate(config) {
  if (!config || typeof config !== "object") return { ok: false, reason: "config-missing" };
  if (config.url === null || config.url === undefined) return { ok: false, reason: "url-missing" };
  if (typeof config.url !== "string" || config.url.trim() === "") return { ok: false, reason: "url-missing" };
  return { ok: true };
}

/**
 * Mask sensitive segments in URLs for error logging.
 * @param {string} url
 * @returns {string}
 */
function maskUrl(url) {
  try {
    return url
      .replace(/\/bot[^/]+\//i, "/bot[REDACTED]/")
      .replace(/hooks\.slack\.com\/services\/[^\s]+/i, "hooks.slack.com/services/[REDACTED]")
      .replace(/discord(app)?\.com\/api\/webhooks\/[^\s]+/i, "discord.com/api/webhooks/[REDACTED]");
  } catch { return "[URL]"; }
}

/**
 * Send a notification via HTTP POST.
 * @param {import('./adapter-contract.mjs').AdapterSendArgs} args
 * @returns {Promise<import('./adapter-contract.mjs').AdapterSendResult>}
 */
async function send({ event, route, formattedMessage, correlationId, config }) {
  const url = config?.url;
  if (!url) return { ok: false, errorCode: "NO_URL", error: "No URL configured" };

  const body = {
    event: event?.type || "unknown",
    severity: event?.data?.severity || event?.severity || null,
    correlationId,
    message: formattedMessage || "",
    timestamp: event?.timestamp || new Date().toISOString(),
    data: event?.data || {},
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const statusCode = response.status;
    if (response.ok) {
      return { ok: true, statusCode, deliveryMs: 0 };
    }
    return { ok: false, statusCode, errorCode: `HTTP_${statusCode}`, error: `HTTP ${statusCode}` };
  } catch (err) {
    console.error(`[notifications/webhook] Send error (${maskUrl(url)}): ${err.message}`);
    return { ok: false, errorCode: "NETWORK_ERROR", error: err.message };
  }
}

/** @type {import('./adapter-contract.mjs').NotificationAdapter} */
export const webhookAdapter = Object.freeze({
  name: "webhook",
  send,
  validate,
});
