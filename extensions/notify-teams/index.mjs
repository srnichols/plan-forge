/**
 * Plan Forge — Microsoft Teams Notification Adapter Stub
 *
 * Phase FORGE-SHOP-03 Slice 03.2
 *
 * Conforms to the adapter contract but is not yet implemented.
 * Configure a Teams Incoming Webhook to activate.
 *
 * Config fields:
 *   webhookUrl: "${env:TEAMS_WEBHOOK_URL}"
 */
import { ERR_NOT_IMPLEMENTED } from "../../pforge-mcp/notifications/adapter-contract.mjs";

export const adapter = {
  name: "teams",

  async send(_args) {
    const err = new Error(
      "Teams adapter not installed — configure a Microsoft Teams Incoming Webhook, then replace this stub."
    );
    err.code = ERR_NOT_IMPLEMENTED;
    throw err;
  },

  validate(_config) {
    return { ok: false, reason: "not-installed" };
  },
};
