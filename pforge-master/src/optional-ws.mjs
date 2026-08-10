/**
 * Optional `ws` loader.
 *
 * The Forge-Master live hub overlay uses the `ws` WebSocket client, but the
 * prompt catalog, chat reasoning, and the rest of the HTTP API do not. A
 * static `import WebSocket from "ws"` made the *entire* http-routes import
 * chain fail to load when `ws` was not installed — which silently took down
 * `/api/forge-master/*` with a 404 ("Forge-Master Studio API unavailable").
 *
 * We load `ws` lazily and synchronously here. When it is absent the live hub
 * overlay degrades gracefully (connection attempts are caught and surfaced
 * via `lastError`) while the rest of the Forge-Master surface stays online.
 *
 * @module forge-master/optional-ws
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let WebSocketCtor = null;
try {
  // `ws` is a CommonJS package — require() resolves it synchronously and
  // preserves the existing `new WebSocket(url)` call sites unchanged.
  WebSocketCtor = require("ws");
} catch {
  // `ws` not installed — live hub features disabled, core API unaffected.
  WebSocketCtor = null;
}

export default WebSocketCtor;
