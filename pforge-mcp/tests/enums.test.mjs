import { describe, it, expect } from "vitest";
import {
  COST_SOURCES,
  ERROR_CODES,
  FORGE_MASTER_MODES,
  HOOK_CATEGORY,
  HOOK_NAMES,
  HOOK_PASCAL,
  MODEL_TIERS,
  QUORUM_MODES,
  TOOL_NAMES,
  WATCHER_MODES,
  assertCostSource,
  assertForgeMasterMode,
  assertHookName,
  assertModelTier,
  assertQuorumMode,
  assertWatcherMode,
} from "../enums.mjs";

describe("enums.mjs", () => {
  it("freezes every exported stable set", () => {
    expect(Object.isFrozen(HOOK_NAMES)).toBe(true);
    expect(Object.isFrozen(HOOK_PASCAL)).toBe(true);
    expect(Object.isFrozen(HOOK_CATEGORY)).toBe(true);
    expect(Object.isFrozen(HOOK_CATEGORY.session)).toBe(true);
    expect(Object.isFrozen(HOOK_CATEGORY.liveGuard)).toBe(true);
    expect(Object.isFrozen(MODEL_TIERS)).toBe(true);
    expect(Object.isFrozen(QUORUM_MODES)).toBe(true);
    expect(Object.isFrozen(FORGE_MASTER_MODES)).toBe(true);
    expect(Object.isFrozen(WATCHER_MODES)).toBe(true);
    expect(Object.isFrozen(COST_SOURCES)).toBe(true);
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(TOOL_NAMES)).toBe(true);
    expect(() => { HOOK_NAMES.Stop = "changed"; }).toThrow();
    expect(() => { HOOK_PASCAL.push("Broken"); }).toThrow();
    expect(() => { HOOK_CATEGORY.session.push("Broken"); }).toThrow();
    expect(() => { MODEL_TIERS[0] = "slow"; }).toThrow();
    expect(() => { TOOL_NAMES[0] = "modified"; }).toThrow();
  });

  it("accepts valid enum values", () => {
    expect(assertHookName("PostRun")).toBe("PostRun");
    expect(assertModelTier("mid")).toBe("mid");
    expect(assertQuorumMode("speed")).toBe("speed");
    expect(assertWatcherMode("cross-run")).toBe("cross-run");
    expect(assertCostSource("observer")).toBe("observer");
    expect(assertForgeMasterMode("observe")).toBe("observe");
  });

  it("rejects invalid enum values with helpful valid-token lists", () => {
    expect(() => assertHookName("postRun")).toThrow(/SessionStart, PreToolUse, PostToolUse, Stop, PreDeploy, PostSlice, PreAgentHandoff, PostRun/);
    expect(() => assertModelTier("slow")).toThrow(/flagship, mid, fast/);
    expect(() => assertQuorumMode("true")).toThrow(/auto, power, speed, false/);
    expect(() => assertWatcherMode("live")).toThrow(/snapshot, analyze, cross-run/);
    expect(() => assertCostSource("router")).toThrow(/worker, forge-master, observer, auditor/);
    expect(() => assertForgeMasterMode("status")).toThrow(/ask, observe/);
  });

  it("assigns each hook to exactly one category", () => {
    const counts = new Map(HOOK_PASCAL.map((hook) => [hook, 0]));
    for (const hook of HOOK_CATEGORY.session) counts.set(hook, (counts.get(hook) ?? 0) + 1);
    for (const hook of HOOK_CATEGORY.liveGuard) counts.set(hook, (counts.get(hook) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual([...HOOK_PASCAL].sort());
    for (const [hook, count] of counts) {
      expect(count, `${hook} should appear in exactly one hook category`).toBe(1);
    }
  });

  it("TOOL_NAMES is sorted and has no duplicates", () => {
    const sorted = [...TOOL_NAMES].sort();
    expect([...TOOL_NAMES]).toEqual(sorted);
    const unique = new Set(TOOL_NAMES);
    expect(unique.size).toBe(TOOL_NAMES.length);
  });
});
