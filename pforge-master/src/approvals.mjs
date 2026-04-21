/**
 * Forge-Master Approval Gate (Phase-29, Slice 6).
 *
 * Provides a human-in-the-loop approval mechanism for write tools.
 * Each approval request is assigned a UUID, written to an audit log,
 * and resolved (approve/deny/edit/timeout) by an external caller.
 *
 * @module forge-master/approvals
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_SEC = 300;

/**
 * Create an approval gate for write tool authorization.
 *
 * @param {{ timeoutSec?: number, onApprovalRequired?: Function|null, cwd?: string }} [opts]
 * @returns {{ requestApproval, awaitDecision, resolve }}
 */
export function createApprovalGate(opts = {}) {
  const {
    timeoutSec = DEFAULT_TIMEOUT_SEC,
    onApprovalRequired = null,
    cwd = process.cwd(),
  } = opts;

  const pending = new Map(); // approvalId -> { resolve, timer, tools }

  function writeAudit(entry) {
    try {
      const forgeDir = resolve(cwd, ".forge");
      if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });
      appendFileSync(resolve(forgeDir, "forge-master-approvals.jsonl"), JSON.stringify(entry) + "\n");
    } catch { /* non-fatal */ }
  }

  return {
    /**
     * Request approval for a set of tools.
     * Resolves when the user approves/denies/edits, or times out.
     *
     * @param {Array<{ name: string, args: object, severity: string, requiresApproval: boolean }>} tools
     * @returns {Promise<{ approvalId: string, decision: string, editedArgs?: object, error?: string }>}
     */
    async requestApproval(tools) {
      const approvalId = randomUUID();
      const event = { approvalId, tools, requestedAt: new Date().toISOString() };
      writeAudit({ ...event, action: "requested" });
      if (onApprovalRequired) onApprovalRequired(event);

      return new Promise((resolveP) => {
        const timer = setTimeout(() => {
          pending.delete(approvalId);
          writeAudit({ approvalId, action: "timeout", at: new Date().toISOString() });
          resolveP({ approvalId, decision: "timeout", error: "approval_timeout" });
        }, timeoutSec * 1000);

        pending.set(approvalId, { resolve: resolveP, timer, tools });
      });
    },

    /**
     * Wait for a specific approval decision.
     *
     * @param {string} approvalId
     * @returns {Promise<object>}
     */
    async awaitDecision(approvalId) {
      return new Promise((res) => {
        const p = pending.get(approvalId);
        if (!p) return res({ error: "approval_not_found" });
        const orig = p.resolve;
        p.resolve = (v) => { orig(v); res(v); };
      });
    },

    /**
     * Resolve a pending approval with a decision.
     *
     * @param {string} approvalId
     * @param {{ decision: "approve"|"deny"|"edit"|"timeout", editedArgs?: object }} decision
     * @returns {boolean} true if the approval was found and resolved
     */
    resolve(approvalId, decision) {
      const p = pending.get(approvalId);
      if (!p) return false;
      clearTimeout(p.timer);
      pending.delete(approvalId);
      const entry = {
        approvalId,
        decision: decision.decision,
        editedArgs: decision.editedArgs,
        at: new Date().toISOString(),
      };
      writeAudit(entry);
      p.resolve(decision);
      return true;
    },
  };
}
