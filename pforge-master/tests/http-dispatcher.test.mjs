/**
 * Tests for http-dispatcher.mjs (Phase-36, Slice 3).
 *
 * Validates:
 *   (a) Non-allowlisted tools are rejected.
 *   (b) Destructive (WRITE_ALLOWLIST) tools are rejected over HTTP.
 *   (c) Read-only allowlisted tools are forwarded to the injected mcpCall.
 */

import { describe, it, expect, vi } from "vitest";
import { createHttpDispatcher } from "../src/http-dispatcher.mjs";
import { BASE_ALLOWLIST, WRITE_ALLOWLIST } from "../src/allowlist.mjs";

// Pick a known read-only tool from the allowlist
const READ_ONLY_TOOL = "forge_plan_status";

// Pick a known destructive tool that is in WRITE_ALLOWLIST
const WRITE_TOOL = WRITE_ALLOWLIST[0].name; // e.g. forge_run_plan

describe("createHttpDispatcher", () => {
  it("(a) rejects a tool not in the allowlist", async () => {
    const mcpCall = vi.fn();
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall,
    });

    const result = await dispatch("totally_unknown_tool", {});

    expect(result).toMatchObject({
      error: "tool not allowlisted",
      tool: "totally_unknown_tool",
    });
    expect(mcpCall).not.toHaveBeenCalled();
  });

  it("(b) rejects a destructive WRITE_ALLOWLIST tool with in-IDE confirmation error", async () => {
    const mcpCall = vi.fn();
    // Ensure the write tool is in the allowlist for this test
    const fullAllowlist = [
      ...BASE_ALLOWLIST,
      ...WRITE_ALLOWLIST.map((t) => t.name),
    ];
    const dispatch = createHttpDispatcher({
      allowlist: fullAllowlist,
      mcpCall,
    });

    const result = await dispatch(WRITE_TOOL, {});

    expect(result).toMatchObject({
      error: "destructive tool requires in-IDE confirmation",
      tool: WRITE_TOOL,
    });
    expect(mcpCall).not.toHaveBeenCalled();
  });

  it("(c) forwards a read-only allowlisted tool to mcpCall and returns its result", async () => {
    const mockResult = { slices: 5, passed: 4 };
    const mcpCall = vi.fn().mockResolvedValue(mockResult);
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall,
    });

    const args = { planId: "phase-36" };
    const result = await dispatch(READ_ONLY_TOOL, args);

    expect(mcpCall).toHaveBeenCalledOnce();
    expect(mcpCall).toHaveBeenCalledWith(READ_ONLY_TOOL, args);
    expect(result).toEqual(mockResult);
  });

  it("uses BASE_ALLOWLIST and invokeForgeTool defaults when called with no options", async () => {
    const dispatch = createHttpDispatcher();
    // A non-allowlisted tool still gets rejected with the defaults
    const result = await dispatch("not_in_list", {});
    expect(result.error).toBe("tool not allowlisted");
  });

  it("passes args correctly to mcpCall", async () => {
    const mcpCall = vi.fn().mockResolvedValue({ ok: true });
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall,
    });

    const args = { path: "/some/project", limit: 10 };
    await dispatch("forge_status", args);
    expect(mcpCall).toHaveBeenCalledWith("forge_status", args);
  });
});
