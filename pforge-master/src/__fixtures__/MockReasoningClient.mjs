/**
 * Plan Forge — MockReasoningClient (Phase-28, Slice 5).
 *
 * Scripted response fixture for testing the reasoning loop without
 * making real API calls. Each call to `sendTurn()` returns the next
 * response from the script; when the script is exhausted, returns a
 * default final reply.
 *
 * Usage:
 *   const client = new MockReasoningClient([
 *     { type: "tool_calls", toolCalls: [{ id: "1", name: "forge_status", args: {} }] },
 *     { type: "reply", content: "Here is your status." },
 *   ]);
 *   const r1 = await client.sendTurn({ messages, tools, model, apiKey });
 *   // r1 → tool_calls
 *   const r2 = await client.sendTurn({ messages, tools, model, apiKey });
 *   // r2 → reply
 *
 * @module forge-master/__fixtures__/MockReasoningClient
 */

export class MockReasoningClient {
  /**
   * @param {Array<{
   *   type: "reply"|"tool_calls",
   *   content?: string,
   *   toolCalls?: Array<{id: string, name: string, args?: object}>,
   *   tokensIn?: number,
   *   tokensOut?: number,
   *   error?: Error,
   * }>} script — ordered list of responses
   */
  constructor(script = []) {
    this._script = [...script];
    this._callIndex = 0;
    this.calls = []; // records every sendTurn invocation for assertions
  }

  /**
   * Simulate a provider sendTurn call.
   * Records the invocation and returns the next scripted response.
   */
  async sendTurn(opts) {
    this.calls.push({
      index: this._callIndex,
      messages: opts.messages,
      tools: opts.tools,
      model: opts.model,
    });

    const entry = this._script[this._callIndex];
    this._callIndex++;

    if (!entry) {
      // Script exhausted — return a default final reply
      return {
        type: "reply",
        content: "[MockReasoningClient] Script exhausted — default reply.",
        tokensIn: 10,
        tokensOut: 20,
      };
    }

    // Simulate an error if the entry requests it
    if (entry.error) {
      throw entry.error;
    }

    return {
      type: entry.type || "reply",
      content: entry.content,
      toolCalls: entry.toolCalls,
      tokensIn: entry.tokensIn ?? 100,
      tokensOut: entry.tokensOut ?? 50,
    };
  }

  /** Number of sendTurn calls recorded. */
  get callCount() {
    return this.calls.length;
  }

  /** Reset call history and script index. */
  reset(newScript) {
    this._script = newScript ? [...newScript] : [...this._script];
    this._callIndex = 0;
    this.calls = [];
  }
}
