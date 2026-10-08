import https from "node:https";
import { promises as fs } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { ClawError } from "../errors.mjs";

export const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

const DNS_1123 = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const STATUS_REASONS = Object.freeze({
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  410: "gone",
});
const MAX_WATCH_LINE_BYTES = 1024 * 1024;
const MAX_WATCH_FAILURES = 3;

function validateSegment(value, label) {
  if (typeof value !== "string" || !DNS_1123.test(value)) {
    throw new ClawError("K8S_BAD_INPUT", { field: label });
  }
  return encodeURIComponent(value);
}

function apiError(status, op, body) {
  let statusReason;
  try {
    const parsed = JSON.parse(body);
    statusReason = typeof parsed?.reason === "string" ? parsed.reason : undefined;
  } catch {
    statusReason = undefined;
  }
  throw new ClawError("K8S_API", {
    status,
    op,
    reason: statusReason ?? STATUS_REASONS[status] ?? "api-error",
  });
}

function requestOnce({
  request,
  options,
  body,
  op,
  timeoutMs,
  signal,
  stream = false,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let req;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error, value, keepOpen = false) => {
      if (settled) return;
      settled = true;
      if (!keepOpen) cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      req?.destroy();
      if (!settled) finish(null, null);
      else cleanup();
    };
    try {
      req = request(options, (res) => {
        if (stream && res.statusCode < 300) {
          clearTimeout(timer);
          res.once("close", cleanup);
          res.once("end", cleanup);
          finish(null, res, true);
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_WATCH_LINE_BYTES && stream) {
            req.destroy();
            finish(new ClawError("K8S_API", { status: res.statusCode, op, reason: "watch-line-too-large" }));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 300) {
            try {
              apiError(res.statusCode, op, text);
            } catch (error) {
              finish(error);
            }
            return;
          }
          try {
            finish(null, text ? JSON.parse(text) : null);
          } catch {
            finish(new ClawError("K8S_API", {
              status: res.statusCode,
              op,
              reason: "invalid-response",
            }));
          }
        });
        res.on("error", (error) => finish(new ClawError("K8S_NETWORK", {
          op,
          code: error.code ?? "SOCKET_ERROR",
        })));
      });
      req.on("error", (error) => {
        if (signal?.aborted) {
          finish(null, null);
          return;
        }
        finish(new ClawError("K8S_NETWORK", { op, code: error.code ?? "SOCKET_ERROR" }));
      });
      timer = setTimeout(() => {
        req.destroy();
        if (!settled) finish(new ClawError("K8S_TIMEOUT", { op }));
      }, timeoutMs);
      timer.unref?.();
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    } catch (error) {
      finish(new ClawError("K8S_NETWORK", { op, code: error.code ?? "REQUEST_FAILED" }));
    }
  });
}

async function delay(ms, signal) {
  if (signal?.aborted) return;
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export function createK8sClient({
  saDir = SA_DIR,
  host = process.env.KUBERNETES_SERVICE_HOST,
  port = process.env.KUBERNETES_SERVICE_PORT ?? 443,
  request = https.request,
  readFile = fs.readFile,
  timeoutMs = 30_000,
  pollIntervalMs = 2_000,
} = {}) {
  if (typeof timeoutMs !== "number" || timeoutMs <= 0
    || typeof pollIntervalMs !== "number" || pollIntervalMs <= 0) {
    throw new ClawError("K8S_BAD_CONFIG");
  }

  async function credentials() {
    if (typeof host !== "string" || !host) {
      throw new ClawError("K8S_UNAVAILABLE", { code: "SERVICE_HOST_MISSING" });
    }
    let token;
    let ca;
    try {
      [token, ca] = await Promise.all([
        readFile(`${saDir}/token`, "utf8"),
        readFile(`${saDir}/ca.crt`),
      ]);
    } catch (error) {
      throw new ClawError("K8S_UNAVAILABLE", { code: error.code ?? "SERVICE_ACCOUNT_MISSING" });
    }
    if (typeof token !== "string" || !token.trim() || !ca?.length) {
      throw new ClawError("K8S_UNAVAILABLE", { code: "SERVICE_ACCOUNT_EMPTY" });
    }
    return { token: token.trim(), ca };
  }

  async function call(method, path, op, body, { signal, stream = false } = {}) {
    const { token, ca } = await credentials();
    // https.request is required because built-in fetch cannot accept this mounted CA,
    // and D3 excludes adding a transport dependency.
    return requestOnce({
      request,
      options: {
        host,
        port,
        path,
        method,
        ca,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
      },
      body,
      op,
      timeoutMs,
      signal,
      stream,
    });
  }

  function jobsPath(namespace) {
    return `/apis/batch/v1/namespaces/${validateSegment(namespace, "namespace")}/jobs`;
  }

  function namedJobPath(namespace, name) {
    return `${jobsPath(namespace)}/${validateSegment(name, "name")}`;
  }

  async function createJob(namespace, spec) {
    return call("POST", jobsPath(namespace), "create", spec);
  }

  async function getJob(namespace, name) {
    return call("GET", namedJobPath(namespace, name), "get");
  }

  async function deleteJob(namespace, name) {
    return call("DELETE", `${namedJobPath(namespace, name)}?propagationPolicy=Background`, "delete");
  }

  async function* watchConnection(namespace, name, { signal, resourceVersion } = {}) {
    const base = jobsPath(namespace);
    const query = new URLSearchParams({
      watch: "true",
      fieldSelector: `metadata.name=${name}`,
      ...(resourceVersion ? { resourceVersion } : {}),
    });
    const response = await call("GET", `${base}?${query}`, "watch", undefined, { signal, stream: true });
    if (!response || signal?.aborted) return;

    let pending = "";
    const decoder = new StringDecoder("utf8");
    for await (const chunk of response) {
      if (signal?.aborted) return;
      const parts = `${pending}${decoder.write(Buffer.from(chunk))}`.split("\n");
      pending = parts.pop();
      if (Buffer.byteLength(pending) > MAX_WATCH_LINE_BYTES) {
        throw new ClawError("K8S_API", { status: 200, op: "watch", reason: "watch-line-too-large" });
      }
      for (const part of parts) {
        if (Buffer.byteLength(part) > MAX_WATCH_LINE_BYTES) {
          throw new ClawError("K8S_API", { status: 200, op: "watch", reason: "watch-line-too-large" });
        }
        const line = part.trim();
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          throw new ClawError("K8S_API", { status: 200, op: "watch", reason: "invalid-watch-event" });
        }
        yield event;
      }
    }
    const finalText = decoder.end();
    pending += finalText;
    if (Buffer.byteLength(pending) > MAX_WATCH_LINE_BYTES) {
      throw new ClawError("K8S_API", { status: 200, op: "watch", reason: "watch-line-too-large" });
    }
    if (pending.trim()) {
      try {
        yield JSON.parse(pending);
      } catch {
        throw new ClawError("K8S_API", { status: 200, op: "watch", reason: "invalid-watch-event" });
      }
    }
  }

  async function* watchJob(namespace, name, { signal, resourceVersion } = {}) {
    validateSegment(namespace, "namespace");
    validateSegment(name, "name");
    let version = resourceVersion;
    let failures = 0;
    let polling = false;

    while (!signal?.aborted) {
      if (polling) {
        await delay(pollIntervalMs, signal);
        if (signal?.aborted) return;
        const object = await getJob(namespace, name);
        if (object?.metadata?.resourceVersion) version = object.metadata.resourceVersion;
        yield { type: "MODIFIED", object };
        continue;
      }
      try {
        let eventCount = 0;
        for await (const event of watchConnection(namespace, name, { signal, resourceVersion: version })) {
          if (signal?.aborted) return;
          eventCount += 1;
          const nextVersion = event?.object?.metadata?.resourceVersion;
          if (nextVersion) version = nextVersion;
          if (event?.type === "ERROR" && (event.object?.code === 410 || event.object?.reason === "Expired")) {
            const object = await getJob(namespace, name);
            version = object?.metadata?.resourceVersion ?? version;
            yield { type: "MODIFIED", object };
            continue;
          }
          yield { type: event.type, object: event.object };
        }
        if (signal?.aborted) return;
        failures = eventCount === 0 ? failures + 1 : 0;
        if (failures >= MAX_WATCH_FAILURES) polling = true;
        await delay(pollIntervalMs, signal);
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ClawError && error.code === "K8S_API"
          && (error.details.status === 410 || error.details.reason === "gone")) {
          const object = await getJob(namespace, name);
          version = object?.metadata?.resourceVersion ?? version;
          yield { type: "MODIFIED", object };
          continue;
        }
        failures += 1;
        if (failures >= MAX_WATCH_FAILURES) polling = true;
        else await delay(pollIntervalMs, signal);
      }
    }
  }

  return { createJob, getJob, deleteJob, watchJob };
}
