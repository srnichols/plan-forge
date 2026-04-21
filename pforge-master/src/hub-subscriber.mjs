/**
 * Forge-Master Hub Subscriber (Phase-29, Slice 4).
 *
 * Subscribes to the Plan Forge hub WebSocket and maintains a ring buffer
 * of recent operational events. Used by retrieval.mjs to surface live
 * context into the reasoning loop.
 *
 * @module forge-master/hub-subscriber
 */

import WebSocket from "ws";

const DEFAULT_WS_PORT = 3101;
const RING_BUFFER_SIZE = 50;
const SUBSCRIBED_EVENTS = [
  "slice-started",
  "slice-completed",
  "slice-failed",
  "run-started",
  "run-completed",
  "run-aborted",
  "cost-accrued",
];

/**
 * Create a hub subscriber that connects to the Plan Forge WebSocket hub.
 *
 * @param {{ wsPort?: number, onEvent?: Function|null }} [opts]
 * @returns {{ subscribe, getRecentEvents, close, isConnected }}
 */
export function createHubSubscriber(opts = {}) {
  const { wsPort = DEFAULT_WS_PORT, onEvent = null } = opts;
  let ws = null;
  let connected = false;
  let warned = false;
  const ringBuffer = [];

  function subscribe() {
    const url = `ws://127.0.0.1:${wsPort}`;
    try {
      ws = new WebSocket(url);
      ws.on("open", () => { connected = true; });
      ws.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString());
          if (SUBSCRIBED_EVENTS.includes(event.type)) {
            ringBuffer.push(event);
            if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
            if (onEvent) onEvent(event);
          }
        } catch { /* ignore malformed messages */ }
      });
      ws.on("error", () => {
        connected = false;
        if (!warned) {
          warned = true;
          console.error(`hub unreachable (port ${wsPort}) — live overlay disabled`);
        }
      });
      ws.on("close", () => { connected = false; });
    } catch {
      if (!warned) {
        warned = true;
        console.error(`hub unreachable (port ${wsPort}) — live overlay disabled`);
      }
    }
  }

  return {
    subscribe,
    getRecentEvents(n = 10) { return ringBuffer.slice(-n); },
    close() { if (ws) ws.close(); },
    isConnected() { return connected; },
  };
}
