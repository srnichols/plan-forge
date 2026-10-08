import { createServer } from "node:http";
import { ClawError } from "./errors.mjs";

const sharedServers = new Map();

function createServerEntry({ bind, port, maxBodyBytes }) {
  const routes = new Map();
  const upgrades = new Map();
  const server = createServer((request, response) => { void dispatch(request, response); });
  const entry = { server, routes, upgrades, refs: 0, listenPromise: null };

  function respond(response, status, body) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }

  async function dispatch(request, response) {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      respond(response, 400, { error: "HTTP_BAD_URL" });
      request.resume();
      return;
    }
    const registration = routes.get(`${request.method} ${pathname}`);
    if (!registration) {
      respond(response, 404, { error: "NOT_FOUND" });
      request.resume();
      return;
    }
    try {
      if (registration.authorize && !(await registration.authorize(request))) {
        respond(response, 401, { error: "UNAUTHORIZED" });
        request.resume();
        return;
      }
      const buffers = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBodyBytes) {
          respond(response, 413, { error: "BODY_TOO_LARGE" });
          request.destroy();
          return;
        }
        buffers.push(chunk);
      }
      await registration.handler({
        request,
        response,
        body: Buffer.concat(buffers).toString("utf8"),
      });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof ClawError ? 400 : 500;
      respond(response, status, { error: error instanceof ClawError ? error.code : "HTTP_HANDLER_FAILED" });
    }
  }

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
    handler.handler(request, socket, head);
  });
  return entry;
}

export function createHttpServer({ bind = "127.0.0.1", port = 3190, maxBodyBytes = 65_536 } = {}) {
  const shared = port !== 0;
  const key = `${bind}:${port}`;
  let entry = shared ? sharedServers.get(key) : null;
  if (!entry) {
    entry = createServerEntry({ bind, port, maxBodyBytes });
    if (shared) sharedServers.set(key, entry);
  }
  entry.refs += 1;

  const registeredRoutes = new Map();
  const registeredUpgrades = new Map();
  let closed = false;

  function route(method, path, handler, { authorize } = {}) {
    if (typeof handler !== "function" || typeof method !== "string" || typeof path !== "string"
      || (authorize !== undefined && typeof authorize !== "function")) {
      throw new ClawError("HTTP_BAD_ROUTE");
    }
    const keyName = `${method.toUpperCase()} ${path}`;
    const registration = { handler, authorize };
    entry.routes.set(keyName, registration);
    registeredRoutes.set(keyName, registration);
    return () => {
      if (entry.routes.get(keyName) === registration) entry.routes.delete(keyName);
      if (registeredRoutes.get(keyName) === registration) registeredRoutes.delete(keyName);
    };
  }

  function onUpgrade(path, handler) {
    if (typeof handler !== "function" || typeof path !== "string") throw new ClawError("HTTP_BAD_UPGRADE");
    const registration = { handler };
    entry.upgrades.set(path, registration);
    registeredUpgrades.set(path, registration);
    return () => {
      if (entry.upgrades.get(path) === registration) entry.upgrades.delete(path);
      if (registeredUpgrades.get(path) === registration) registeredUpgrades.delete(path);
    };
  }

  async function listen() {
    if (entry.server.listening) return { port: entry.server.address().port };
    if (!entry.listenPromise) {
      entry.listenPromise = new Promise((resolve, reject) => {
        const onError = (error) => {
          entry.server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          entry.server.off("error", onError);
          resolve();
        };
        entry.server.once("error", onError);
        entry.server.once("listening", onListening);
        entry.server.listen(port, bind);
      }).finally(() => { entry.listenPromise = null; });
    }
    await entry.listenPromise;
    return { port: entry.server.address().port };
  }

  async function close() {
    if (closed) return;
    closed = true;
    for (const [routeKey, registration] of registeredRoutes) {
      if (entry.routes.get(routeKey) === registration) entry.routes.delete(routeKey);
    }
    for (const [path, registration] of registeredUpgrades) {
      if (entry.upgrades.get(path) === registration) entry.upgrades.delete(path);
    }
    entry.refs -= 1;
    if (entry.refs > 0) return;
    if (shared && sharedServers.get(key) === entry) sharedServers.delete(key);
    if (!entry.server.listening) return;
    entry.server.closeIdleConnections?.();
    await new Promise((resolve, reject) => entry.server.close((error) => error ? reject(error) : resolve()));
  }

  return { server: entry.server, route, onUpgrade, listen, close };
}

export function registerHealthRoutes(http, { probes = {}, timeoutMs = 2000, cacheMs = 15_000 } = {}) {
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;

  async function checkProbe(probe) {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(probe),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("HEALTH_PROBE_TIMEOUT")), timeoutMs);
          timer.unref?.();
        }),
      ]);
      return "ok";
    } catch {
      return "fail";
    } finally {
      clearTimeout(timer);
    }
  }

  async function readiness() {
    if (cached && Date.now() - cachedAt < cacheMs) return cached;
    if (!inFlight) {
      inFlight = Promise.all(Object.entries(probes).map(async ([name, probe]) => [
        name, await checkProbe(probe),
      ])).then((entries) => Object.fromEntries(entries)).then((checks) => {
        cached = checks;
        cachedAt = Date.now();
        return checks;
      }).finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  const unregisterHealth = http.route("GET", "/healthz", ({ response }) => {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
  });
  const unregisterReady = http.route("GET", "/readyz", async ({ response }) => {
    const checks = await readiness();
    const ready = Object.values(checks).every((status) => status === "ok");
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: ready ? "ready" : "not_ready", checks }));
  });
  return () => {
    unregisterHealth();
    unregisterReady();
  };
}
