import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { FIXTURE_HTTP_STATUS, FIXTURE_PREFIX } from "./k8s-fixture-common.mjs";

const PUBLIC_ROUTES = new Set(["/healthz", "/readyz", `${FIXTURE_PREFIX}/checkout`, `${FIXTURE_PREFIX}/receipt`]);

/** Fixture-only TLS transport edge; the real dispatcher still owns HTTP/protocol handling. */
export async function startFixtureTlsProxy({ cert, key, port, targetPort, bind = "0.0.0.0" }) {
  const sockets = new Set();
  const server = createServer({ cert, key }, (request, response) => {
    if (!PUBLIC_ROUTES.has(request.url)) {
      request.resume();
      response.writeHead(FIXTURE_HTTP_STATUS.NOT_FOUND);
      response.end();
      return;
    }
    const upstream = httpRequest({
      host: "127.0.0.1", port: targetPort, path: request.url,
      method: request.method, headers: request.headers,
    }, (incoming) => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    upstream.once("error", () => { response.writeHead(FIXTURE_HTTP_STATUS.BAD_GATEWAY); response.end(); });
    request.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/claw/workers") { socket.destroy(); return; }
    const upstream = httpRequest({
      host: "127.0.0.1", port: targetPort, path: request.url, headers: request.headers,
    });
    upstream.on("upgrade", (response, connection, remaining) => {
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
      for (const [header, value] of Object.entries(response.headers)) socket.write(`${header}: ${value}\r\n`);
      socket.write("\r\n");
      if (remaining.length) socket.write(remaining);
      if (head.length) connection.write(head);
      socket.pipe(connection).pipe(socket);
      socket.once("close", () => connection.destroy());
      connection.once("error", () => socket.destroy());
    });
    upstream.once("error", () => socket.destroy());
    upstream.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, resolve);
  });
  return {
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
