import { createServer } from "node:http";
import { ClawError } from "./errors.mjs";

export function createHttpServer({ bind = "127.0.0.1", port = 3190, maxBodyBytes = 65_536 } = {}) {
  const routes = new Map();
  const upgrades = new Map();

  function respond(response, status, body) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }

  async function dispatch(request, response) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const handler = routes.get(`${request.method} ${pathname}`);
    if (!handler) {
      respond(response, 404, { error: "NOT_FOUND" });
      return;
    }
    const buffers = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBodyBytes) {
          respond(response, 413, { error: "BODY_TOO_LARGE" });
          request.destroy();
          return;
        }
        buffers.push(chunk);
      }
      await handler({ request, response, body: Buffer.concat(buffers).toString("utf8") });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof ClawError ? 400 : 500;
      respond(response, status, { error: error instanceof ClawError ? error.code : "HTTP_HANDLER_FAILED" });
    }
  }

  const server = createServer((request, response) => { void dispatch(request, response); });
  server.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    const handler = upgrades.get(pathname);
    if (!handler) {
      socket.destroy();
      return;
    }
    handler(request, socket, head);
  });

  function route(method, path, handler) {
    if (typeof handler !== "function" || typeof method !== "string" || typeof path !== "string") {
      throw new ClawError("HTTP_BAD_ROUTE");
    }
    routes.set(`${method.toUpperCase()} ${path}`, handler);
    return () => routes.delete(`${method.toUpperCase()} ${path}`);
  }

  function onUpgrade(path, handler) {
    if (typeof handler !== "function" || typeof path !== "string") throw new ClawError("HTTP_BAD_UPGRADE");
    upgrades.set(path, handler);
    return () => upgrades.delete(path);
  }

  async function listen() {
    if (server.listening) return { port: server.address().port };
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, bind);
    });
    return { port: server.address().port };
  }

  async function close() {
    if (!server.listening) return;
    server.closeIdleConnections?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  return { server, route, onUpgrade, listen, close };
}
