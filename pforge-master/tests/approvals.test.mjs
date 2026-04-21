/**
 * Tests for forge-master approval gate (Phase-29).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApprovalGate } from "../src/approvals.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Use a real temp directory scoped per test run
let cwd;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "fm-approvals-"));
});

describe("createApprovalGate", () => {
  it("returns object with requestApproval, resolve, awaitDecision", () => {
    const gate = createApprovalGate({ cwd });
    expect(typeof gate.requestApproval).toBe("function");
    expect(typeof gate.resolve).toBe("function");
    expect(typeof gate.awaitDecision).toBe("function");
  });

  it("resolve returns false for unknown approvalId", () => {
    const gate = createApprovalGate({ cwd });
    expect(gate.resolve("no-such-id", { decision: "approve" })).toBe(false);
  });

  it("requestApproval resolves approve", async () => {
    const gate = createApprovalGate({ cwd });
    const tools = [{ name: "forge_bug_register", args: {}, severity: "write", requiresApproval: true }];
    const p = gate.requestApproval(tools);
    setTimeout(() => gate.resolve(/* approvalId */ null, { decision: "approve" }), 0);
    // We need the actual approvalId — use onApprovalRequired callback
    let capturedId;
    const gate2 = createApprovalGate({ cwd, onApprovalRequired: (e) => { capturedId = e.approvalId; } });
    const p2 = gate2.requestApproval(tools);
    await new Promise(r => setTimeout(r, 0));
    gate2.resolve(capturedId, { decision: "approve" });
    const result = await p2;
    expect(result.decision).toBe("approve");
  });

  it("requestApproval resolves deny", async () => {
    let capturedId;
    const gate = createApprovalGate({ cwd, onApprovalRequired: (e) => { capturedId = e.approvalId; } });
    const tools = [{ name: "forge_run_plan", args: {}, severity: "destructive", requiresApproval: true }];
    const p = gate.requestApproval(tools);
    await new Promise(r => setTimeout(r, 0));
    gate.resolve(capturedId, { decision: "deny" });
    const result = await p;
    expect(result.decision).toBe("deny");
  });

  it("requestApproval resolves edit with editedArgs", async () => {
    let capturedId;
    const gate = createApprovalGate({ cwd, onApprovalRequired: (e) => { capturedId = e.approvalId; } });
    const tools = [{ name: "forge_bug_update_status", args: { status: "open" }, severity: "write", requiresApproval: true }];
    const p = gate.requestApproval(tools);
    await new Promise(r => setTimeout(r, 0));
    gate.resolve(capturedId, { decision: "edit", editedArgs: { status: "closed" } });
    const result = await p;
    expect(result.decision).toBe("edit");
    expect(result.editedArgs).toEqual({ status: "closed" });
  });

  it("times out after timeoutSec", async () => {
    const gate = createApprovalGate({ cwd, timeoutSec: 0.01 });
    const tools = [{ name: "forge_run_plan", args: {}, severity: "destructive", requiresApproval: true }];
    const result = await gate.requestApproval(tools);
    expect(result.decision).toBe("timeout");
    expect(result.error).toBe("approval_timeout");
  });

  it("awaitDecision returns error for unknown id", async () => {
    const gate = createApprovalGate({ cwd });
    const result = await gate.awaitDecision("nonexistent");
    expect(result.error).toBe("approval_not_found");
  });

  it("calls onApprovalRequired callback with event", async () => {
    const cb = vi.fn();
    const gate = createApprovalGate({ cwd, timeoutSec: 0.01, onApprovalRequired: cb });
    const tools = [{ name: "forge_notify_send", args: {}, severity: "write", requiresApproval: true }];
    await gate.requestApproval(tools);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toHaveProperty("approvalId");
    expect(cb.mock.calls[0][0]).toHaveProperty("tools");
  });
});
