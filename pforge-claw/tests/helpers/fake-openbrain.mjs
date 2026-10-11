import { createServer } from "node:http";

export async function startFakeOpenBrain() {
  const items = [];
  const requests = [];
  const idempotency = new Map();
  let online = true;
  let nextId = 1;
  const server = createServer(async (request, response) => {
    if (!online) {
      request.socket.destroy();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      response.writeHead(400).end(JSON.stringify({ error: "INVALID_JSON" }));
      return;
    }
    const entry = {
      method: request.method,
      path: new URL(request.url, "http://127.0.0.1").pathname,
      headers: request.headers,
      body,
    };
    requests.push(entry);
    const key = request.headers["idempotency-key"] ?? body.idempotencyKey;
    let result = key ? idempotency.get(String(key)) : undefined;
    if (!result) {
      result = { id: `fixture-memory-${nextId++}`, ...body };
      items.push(result);
      if (key) idempotency.set(String(key), result);
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, item: result, items }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    items,
    requests,
    setOnline(value) {
      if (typeof value !== "boolean") throw new TypeError("online must be boolean");
      online = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
