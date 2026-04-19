import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { webhookAdapter } from "../notifications/webhook-adapter.mjs";
import { validateAdapterShape } from "../notifications/adapter-contract.mjs";

// ─── Mock HTTP Server ────────────────────────────────────────────────

let server;
let serverPort;
let lastRequestBody;
let lastRequestHeaders;
let responseStatus;
let responseDelay;

function resetServer() {
  lastRequestBody = null;
  lastRequestHeaders = null;
  responseStatus = 200;
  responseDelay = 0;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      lastRequestBody = body ? JSON.parse(body) : null;
      lastRequestHeaders = req.headers;
      const respond = () => {
        res.writeHead(responseStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: responseStatus < 300 }));
      };
      if (responseDelay > 0) {
        setTimeout(respond, responseDelay);
      } else {
        respond();
      }
    });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      serverPort = server.address().port;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  resetServer();
});

// ─── Adapter Shape ───────────────────────────────────────────────────

describe("webhookAdapter — shape", () => {
  it("conforms to adapter contract", () => {
    const result = validateAdapterShape(webhookAdapter);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("has name 'webhook'", () => {
    expect(webhookAdapter.name).toBe("webhook");
  });
});

// ─── Validate ────────────────────────────────────────────────────────

describe("webhookAdapter.validate", () => {
  it("returns ok for valid URL", () => {
    expect(webhookAdapter.validate({ url: "http://example.com" })).toEqual({ ok: true });
  });

  it("returns error for missing URL", () => {
    const result = webhookAdapter.validate({ url: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("url-missing");
  });

  it("returns error for empty URL", () => {
    const result = webhookAdapter.validate({ url: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("url-missing");
  });

  it("returns error for undefined config", () => {
    const result = webhookAdapter.validate(undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("config-missing");
  });
});

// ─── Send: Success ───────────────────────────────────────────────────

describe("webhookAdapter.send — success", () => {
  it("returns ok:true with statusCode on 200", async () => {
    responseStatus = 200;
    const result = await webhookAdapter.send({
      event: { type: "slice-failed", data: { severity: "high" } },
      route: "webhook",
      formattedMessage: "Slice 3 failed",
      correlationId: "corr-123",
      config: { url: `http://127.0.0.1:${serverPort}` },
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it("sends correct payload shape", async () => {
    responseStatus = 200;
    await webhookAdapter.send({
      event: { type: "run-completed", data: { severity: "low" }, timestamp: "2026-01-01T00:00:00Z" },
      route: "webhook",
      formattedMessage: "Run done",
      correlationId: "corr-456",
      config: { url: `http://127.0.0.1:${serverPort}` },
    });
    expect(lastRequestBody.event).toBe("run-completed");
    expect(lastRequestBody.severity).toBe("low");
    expect(lastRequestBody.correlationId).toBe("corr-456");
    expect(lastRequestBody.message).toBe("Run done");
    expect(lastRequestBody.timestamp).toBe("2026-01-01T00:00:00Z");
  });

  it("sends Content-Type: application/json header", async () => {
    responseStatus = 200;
    await webhookAdapter.send({
      event: { type: "test" },
      route: "webhook",
      formattedMessage: "",
      correlationId: "c",
      config: { url: `http://127.0.0.1:${serverPort}` },
    });
    expect(lastRequestHeaders["content-type"]).toBe("application/json");
  });
});

// ─── Send: HTTP Errors ───────────────────────────────────────────────

describe("webhookAdapter.send — HTTP errors", () => {
  it("returns ok:false with errorCode for 500", async () => {
    responseStatus = 500;
    const result = await webhookAdapter.send({
      event: { type: "test" },
      route: "webhook",
      formattedMessage: "",
      correlationId: "c",
      config: { url: `http://127.0.0.1:${serverPort}` },
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.errorCode).toBe("HTTP_500");
  });

  it("returns ok:false for 404", async () => {
    responseStatus = 404;
    const result = await webhookAdapter.send({
      event: { type: "test" },
      route: "webhook",
      formattedMessage: "",
      correlationId: "c",
      config: { url: `http://127.0.0.1:${serverPort}` },
    });
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.errorCode).toBe("HTTP_404");
  });
});

// ─── Send: Network Error ─────────────────────────────────────────────

describe("webhookAdapter.send — network error", () => {
  it("returns NETWORK_ERROR for invalid host", async () => {
    const result = await webhookAdapter.send({
      event: { type: "test" },
      route: "webhook",
      formattedMessage: "",
      correlationId: "c",
      config: { url: "http://192.0.2.1:1" }, // RFC 5737 TEST-NET — unreachable
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("NETWORK_ERROR");
  });
});

// ─── Send: No URL ────────────────────────────────────────────────────

describe("webhookAdapter.send — no URL", () => {
  it("returns error when config has no URL", async () => {
    const result = await webhookAdapter.send({
      event: { type: "test" },
      route: "webhook",
      formattedMessage: "",
      correlationId: "c",
      config: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("NO_URL");
  });
});
