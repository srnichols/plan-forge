/**
 * SSE stream client for the Forge-Master hammer harness.
 *
 * openStream(url, opts) — opens an SSE endpoint, collects all events until
 * `done`, `error`, or timeout, and returns a structured result.
 *
 * Parses standard SSE frames (event: / data: fields, \n\n separator) and
 * handles arbitrary chunk boundaries from real HTTP streams.
 *
 * @module hammer-fm/sse-client
 */

export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Open an SSE stream and collect all events.
 *
 * @param {string} url - Full SSE endpoint URL
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=60000] - Abort after this many ms
 * @param {object} [opts.headers={}] - Additional request headers
 * @param {Function} [opts.fetchFn] - Injected fetch function (default: global fetch)
 * @returns {Promise<{events: Array<{event: string, data: any}>, closedReason: string}>}
 *   closedReason: 'done' | 'error' | 'timeout' | 'connection-error'
 */
export async function openStream(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, fetchFn } = {}) {
  const doFetch = fetchFn ?? globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const events = [];
  let closedReason = "timeout";

  try {
    let resp;
    try {
      resp = await doFetch(url, { headers, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") return { events, closedReason: "timeout" };
      return { events, closedReason: "connection-error" };
    }

    if (!resp.ok || !resp.body) {
      clearTimeout(timer);
      return { events, closedReason: "connection-error" };
    }

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    outer: while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (err) {
        closedReason = err.name === "AbortError" ? "timeout" : "connection-error";
        break;
      }

      const { value, done } = readResult;
      if (done) {
        closedReason = "done";
        break;
      }
      buf += dec.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evt = _parseSseFrame(frame);
        if (!evt) continue;
        events.push(evt);
        if (evt.event === "done") {
          closedReason = "done";
          break outer;
        }
        if (evt.event === "error") {
          closedReason = "error";
          break outer;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return { events, closedReason };
}

/**
 * Parse a single SSE frame (text between double-newlines).
 * Handles CRLF and LF line endings, and multi-line data fields.
 *
 * @param {string} frame
 * @returns {{ event: string, data: any } | null}
 */
export function _parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { event, data };
}
