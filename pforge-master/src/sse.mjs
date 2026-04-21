/**
 * Forge-Master SSE Stream Helper (Phase-29, Slice 8).
 *
 * Wraps a Node.js http.ServerResponse in a thin SSE emitter.
 *
 * @module forge-master/sse
 */

/**
 * Create an SSE stream over a Node.js http.ServerResponse.
 *
 * @param {import("node:http").ServerResponse} res
 * @returns {{ send(event: string, data: any): void, close(): void }}
 */
export function createSseStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  if (typeof res.flushHeaders === "function") res.flushHeaders();

  return {
    send(event, data) {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
    },
    close() { res.end(); },
  };
}
