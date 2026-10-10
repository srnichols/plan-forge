import { createHash, randomBytes } from "node:crypto";
import { writeSecret, deleteSecret } from "./secret-file.mjs";
import { ClawError } from "../errors.mjs";

const ENROLLMENT_TTL_MS = 15 * 60_000;
const SECRET_PREFIX = "PFORGE_CLAW_WORKER_SECRET__";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(bytes) {
  let bits = 0;
  let buffer = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += CROCKFORD[(buffer << (5 - bits)) & 31];
  return output;
}

function records(store) {
  return store.fold("enrollment", (state, entry) => [...state, entry], []);
}

function workerState(entries, workerId) {
  let found = false;
  let state = "unknown";
  for (const entry of entries) {
    if (entry.workerId !== workerId) continue;
    if (entry.op === "registered") {
      found = true;
      state = "active";
    } else if (entry.op === "revoked") state = "revoked";
  }
  return found ? state : "unknown";
}

export function createEnrollment({
  store, secretFile, secrets, onRevoke = () => {}, now = Date.now, randomBytesFn = randomBytes,
} = {}) {
  if (!store || typeof store.append !== "function" || typeof store.fold !== "function") {
    throw new ClawError("ENROLL_STORE_BAD_CONTRACT");
  }

  async function refreshSecrets() {
    if (!secrets) return;
    if (typeof secrets.refresh !== "function") throw new ClawError("WORKER_SECRET_REFRESH_UNAVAILABLE");
    await secrets.refresh();
  }

  function issue(laneId) {
    if (typeof laneId !== "string" || !laneId) throw new ClawError("ENROLL_LANE_REQUIRED");
    const code = base32(randomBytesFn(20));
    const codeHash = createHash("sha256").update(code).digest("hex");
    store.append("enrollment", {
      v: 1, op: "issued", codeHash, codeId: codeHash.slice(0, 8), laneId,
      expiresAt: now() + ENROLLMENT_TTL_MS,
    });
    return code;
  }

  function consume({ codeId, laneId, verify } = {}) {
    const entries = records(store);
    const issued = entries.find((entry) => entry.op === "issued" && entry.codeId === codeId);
    if (!issued) throw new ClawError("ENROLL_CODE_UNKNOWN");
    if (issued.laneId !== laneId) throw new ClawError("ENROLL_LANE_MISMATCH");
    if (now() >= issued.expiresAt) throw new ClawError("ENROLL_CODE_EXPIRED");
    if (entries.some((entry) => entry.op === "consumed" && entry.codeId === codeId)) {
      throw new ClawError("ENROLL_CODE_USED");
    }
    if (typeof verify !== "function" || verify(issued.codeHash) !== true) {
      throw new ClawError("ENROLL_BAD_PROOF");
    }
    store.append("enrollment", { v: 1, op: "consumed", codeId, laneId });
    return { codeHash: issued.codeHash, laneId: issued.laneId };
  }

  async function register({ workerId, laneId, secret } = {}) {
    if (typeof workerId !== "string" || !workerId || typeof laneId !== "string" || !laneId) {
      throw new ClawError("WORKER_BAD_REGISTRATION");
    }
    const name = `${SECRET_PREFIX}${workerId}`;
    try {
      await writeSecret({ file: secretFile, name, value: secret });
    } catch {
      store.append("enrollment", { v: 1, op: "register-failed", workerId, laneId });
      throw new ClawError("SECRET_WRITE_FAILED", { name });
    }
    store.append("enrollment", { v: 1, op: "registered", workerId, laneId });
    await refreshSecrets();
    return { workerId, laneId };
  }

  async function revoke(workerId) {
    if (workerState(records(store), workerId) === "unknown") throw new ClawError("WORKER_UNKNOWN");
    const name = `${SECRET_PREFIX}${workerId}`;
    store.append("enrollment", { v: 1, op: "revoked", workerId });
    try {
      await deleteSecret({ file: secretFile, name });
      await refreshSecrets();
    } finally {
      await onRevoke(workerId);
    }
    return { revoked: true };
  }

  function status(workerId) {
    return workerState(records(store), workerId);
  }

  function worker(workerId) {
    let result = null;
    for (const entry of records(store)) {
      if (entry.workerId !== workerId) continue;
      if (entry.op === "registered") result = { workerId, laneId: entry.laneId, status: "active" };
      if (entry.op === "revoked") result = { ...result, status: "revoked" };
    }
    return result;
  }

  return { issue, consume, register, revoke, status, worker };
}

export { SECRET_PREFIX };
