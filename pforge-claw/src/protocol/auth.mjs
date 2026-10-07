import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { ClawError } from "../errors.mjs";

export const challenge = (randomBytesFn = randomBytes) => randomBytesFn(32).toString("hex");

export function mac(secret, nonce, workerId) {
  return createHmac("sha256", secret).update(`${nonce}:${workerId}`).digest("hex");
}

export function enrollmentMac(codeHash, ...parts) {
  return createHmac("sha256", codeHash).update(parts.join("|")).digest("hex");
}

export function verifyEnrollmentMac(codeHash, given, ...parts) {
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = Buffer.from(enrollmentMac(codeHash, ...parts), "hex");
  const actual = Buffer.from(given, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifyMac(secret, nonce, workerId, given) {
  if (typeof given !== "string" || !/^[0-9a-f]{64}$/.test(given)) return false;
  try {
    const expected = Buffer.from(mac(secret, nonce, workerId), "hex");
    const actual = Buffer.from(given, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) !== 4) return false;
  return Number(host.split(".")[0]) === 127;
}

export function assertTransport(url, { allowInsecureLan = false, warn = () => {} } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ClawError("INSECURE_TRANSPORT", { hint: "use a valid ws:// or wss:// URL" });
  }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ClawError("INSECURE_TRANSPORT", { hint: "use ws:// or wss:// without embedded credentials" });
  }
  if (parsed.protocol === "wss:" || isLoopback(parsed.hostname)) return parsed;
  if (allowInsecureLan) {
    warn("INSECURE_TRANSPORT_ALLOWED");
    return parsed;
  }
  throw new ClawError("INSECURE_TRANSPORT", {
    hint: "use wss:// (ingress TLS or a private overlay network)",
  });
}

export function backoffDelay(attempt, rand = Math.random) {
  return Math.min(30_000, 500 * 2 ** attempt) * (0.8 + rand() * 0.4);
}

export function connectForever({
  url,
  WebSocketImpl,
  onOpen = () => {},
  onPermanentClose = () => {},
  rand = Math.random,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onError = () => {},
  beforeConnect = () => {},
} = {}) {
  let stopped = false;
  let attempt = 0;
  let socket = null;
  let timer = null;
  const WebSocketClass = WebSocketImpl ?? globalThis.WebSocket;

  function connect() {
    if (stopped) return;
    try {
      beforeConnect();
      socket = new WebSocketClass(url);
    } catch (error) {
      if (error instanceof ClawError && error.code === "INSECURE_TRANSPORT") {
        stopped = true;
        onError(error.code);
        onPermanentClose(error.code);
        return;
      }
      schedule();
      return;
    }
    socket.on("open", () => onOpen(socket));
    socket.on("error", (error) => onError(error?.code ?? "WS_ERROR"));
    socket.on("close", (code) => {
      if (stopped) return;
      if ([4401, 4403, 4426].includes(code)) {
        stopped = true;
        onPermanentClose(code);
        return;
      }
      schedule();
    });
  }

  function schedule() {
    if (stopped || timer !== null) return;
    const delay = backoffDelay(attempt++, rand);
    timer = setTimeoutFn(() => {
      timer = null;
      connect();
    }, delay);
    timer?.unref?.();
  }

  connect();
  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      socket?.close();
    },
    resetBackoff() { attempt = 0; },
  };
}
