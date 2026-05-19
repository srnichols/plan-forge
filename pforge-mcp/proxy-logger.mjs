/**
 * Plan Forge — Phase WORKER-GUARDRAILS Slice 4 (A5)
 * In-process HTTPS proxy that logs network egress to slice run logs.
 *
 * Behaviour:
 *   - Log-only (default): logs CONNECT tunnels and forwards transparently.
 *   - Enforce mode (network.enforce: true): blocks hosts not in allowlist with HTTP 403.
 *     No plan ships enforce: true this phase — log-only is the shipped default.
 *
 * Usage:
 *   const { proxyUrl, stop } = await startProxyLogger({ allowlist, networkLogPath, enforce });
 *   // set HTTPS_PROXY=proxyUrl, HTTP_PROXY=proxyUrl in worker env
 *   // after worker exits: stop()
 *
 * @module proxy-logger
 */

import { createServer, createConnection } from "node:net";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

function appendNetworkLog(networkLogPath, entry) {
  if (!networkLogPath) return;
  try {
    mkdirSync(dirname(networkLogPath), { recursive: true });
    appendFileSync(networkLogPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* best-effort — never fail the slice */ }
}

function isHostAllowed(hostname, allowlist) {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.some((pattern) => {
    if (pattern.startsWith("*.")) return hostname.endsWith(pattern.slice(1));
    return hostname === pattern;
  });
}

/**
 * Start an in-process HTTPS proxy on an ephemeral port on 127.0.0.1.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.allowlist=[]]       Hostnames / *.wildcard patterns.
 * @param {string|null} [opts.networkLogPath]  Absolute path for the NDJSON network log.
 * @param {boolean} [opts.enforce=false]       When true, block unlisted hosts (HTTP 403).
 * @returns {Promise<{ proxyUrl: string, port: number, stop: () => void }>}
 */
export function startProxyLogger({ allowlist = [], networkLogPath = null, enforce = false } = {}) {
  const logOnly = !enforce;

  const server = createServer((clientSocket) => {
    clientSocket.on("error", () => {});
    let headerBuf = Buffer.alloc(0);
    let headerParsed = false;

    clientSocket.on("data", function onData(chunk) {
      if (headerParsed) return;
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const headerEnd = headerBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      headerParsed = true;
      clientSocket.removeListener("data", onData);

      const headerText = headerBuf.slice(0, headerEnd).toString("ascii");
      const afterHeader = headerBuf.slice(headerEnd + 4);
      const firstLine = (headerText.split("\r\n")[0] || "");
      const parts = firstLine.split(" ");
      const method = parts[0] || "";
      const target = parts[1] || "";

      if (method !== "CONNECT") {
        clientSocket.write("HTTP/1.1 501 Not Implemented\r\nContent-Length: 0\r\n\r\n");
        clientSocket.destroy();
        return;
      }

      const colonIdx = target.lastIndexOf(":");
      const hostname = colonIdx !== -1 ? target.slice(0, colonIdx) : target;
      const port = colonIdx !== -1 ? (parseInt(target.slice(colonIdx + 1), 10) || 443) : 443;

      appendNetworkLog(networkLogPath, { host: target, method, timestamp: new Date().toISOString() });

      if (!logOnly && !isHostAllowed(hostname, allowlist)) {
        clientSocket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        clientSocket.destroy();
        return;
      }

      const targetConn = createConnection(port, hostname, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (afterHeader.length > 0) targetConn.write(afterHeader);
        targetConn.pipe(clientSocket);
        clientSocket.pipe(targetConn);
      });
      targetConn.on("error", () => { try { clientSocket.destroy(); } catch { /* ignore */ } });
      clientSocket.on("error", () => { try { targetConn.destroy(); } catch { /* ignore */ } });
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const proxyUrl = `http://127.0.0.1:${port}`;
      resolve({
        proxyUrl,
        port,
        stop() { try { server.close(); } catch { /* ignore */ } },
      });
    });
  });
}
