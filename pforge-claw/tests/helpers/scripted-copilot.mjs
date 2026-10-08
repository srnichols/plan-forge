import { assertAgentRuntime } from "../../src/runtime/agent-runtime.mjs";

/**
 * Create an agent-runtime-contract fixture that emits scripted lane events.
 * @param {{events?:Array<object>,result?:object}} options
 */
export function createScriptedCopilot({ events = [], result = {} } = {}) {
  const permissionRequests = [];
  const runtime = assertAgentRuntime({
    id: "copilot-sdk",
    async run(turn) {
      for (const event of events) turn.emit?.(event.type, event.data ?? {});
      if (typeof turn.onPermissionRequest === "function") {
        permissionRequests.push(await turn.onPermissionRequest({
          toolName: "fixture-tool",
          arguments: {},
        }));
      }
      return {
        ok: true,
        status: "succeeded",
        usage: { inputTokens: 10, outputTokens: 5, costUSD: 0 },
        ...result,
      };
    },
  });
  return { runtime, permissionRequests };
}
