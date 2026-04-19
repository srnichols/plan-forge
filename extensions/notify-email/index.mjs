/**
 * Plan Forge — Email (SMTP) Notification Adapter Stub
 *
 * Phase FORGE-SHOP-03 Slice 03.2
 *
 * Conforms to the adapter contract but is not yet implemented.
 * Install nodemailer or a similar SMTP library to activate.
 *
 * Config fields:
 *   smtpHost: "smtp.example.com"
 *   smtpPort: 587
 *   smtpUser: "user@example.com"
 *   smtpPass: "${env:SMTP_PASSWORD}"
 *   from: "forge@example.com"
 *   to: "team@example.com"
 */
import { ERR_NOT_IMPLEMENTED } from "../../pforge-mcp/notifications/adapter-contract.mjs";

export const adapter = {
  name: "email",

  async send(_args) {
    const err = new Error(
      "Email adapter not installed — install nodemailer or a compatible SMTP library, then replace this stub."
    );
    err.code = ERR_NOT_IMPLEMENTED;
    throw err;
  },

  validate(_config) {
    return { ok: false, reason: "not-installed" };
  },
};
