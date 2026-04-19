/**
 * Plan Forge — PagerDuty Notification Adapter Stub
 *
 * Phase FORGE-SHOP-03 Slice 03.2
 *
 * Conforms to the adapter contract but is not yet implemented.
 * Configure a PagerDuty Events API v2 integration key to activate.
 *
 * Config fields:
 *   integrationKey: "${env:PAGERDUTY_INTEGRATION_KEY}"
 */
import { ERR_NOT_IMPLEMENTED } from "../../pforge-mcp/notifications/adapter-contract.mjs";

export const adapter = {
  name: "pagerduty",

  async send(_args) {
    const err = new Error(
      "PagerDuty adapter not installed — configure a PagerDuty Events API v2 integration key, then replace this stub."
    );
    err.code = ERR_NOT_IMPLEMENTED;
    throw err;
  },

  validate(_config) {
    return { ok: false, reason: "not-installed" };
  },
};
