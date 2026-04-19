/**
 * Plan Forge — Slack Notification Adapter Stub
 *
 * Phase FORGE-SHOP-03 Slice 03.2
 *
 * Conforms to the adapter contract but is not yet implemented.
 * Install a Slack SDK or configure a Slack Incoming Webhook to activate.
 *
 * Config fields:
 *   webhookUrl: "${env:SLACK_WEBHOOK_URL}"
 */
import { ERR_NOT_IMPLEMENTED } from "../../pforge-mcp/notifications/adapter-contract.mjs";

export const adapter = {
  name: "slack",

  async send(_args) {
    const err = new Error(
      "Slack adapter not installed — install @slack/webhook or configure a Slack Incoming Webhook, then replace this stub."
    );
    err.code = ERR_NOT_IMPLEMENTED;
    throw err;
  },

  validate(_config) {
    return { ok: false, reason: "not-installed" };
  },
};
