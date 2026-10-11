import { randomUUID } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { isCrossProjectReadable, MEMORY_ORIGINS } from "./memory-client.mjs";

export const QUEUE_STREAM = "memory-queue";
export const BASE_BACKOFF_MS = 30_000;
export const JITTER = 0.2;
export const MAX_ATTEMPTS = 5;
export const MAX_BATCH = 50;
const CLOSED_CODE = "OPENBRAIN_CLOSED";

function asTimestamp(value) {
  const timestamp = typeof value === "function" ? value() : value;
  return timestamp instanceof Date ? timestamp.getTime() : Number(timestamp ?? Date.now());
}

function foldQueue(store) {
  return store.fold(QUEUE_STREAM, (state, record) => {
    if (typeof record?.id === "string") {
      state.set(record.id, { ...(state.get(record.id) ?? {}), ...record });
    }
    return state;
  }, new Map());
}

function toolResult(result) {
  if (result?.structuredContent !== undefined) {
    const content = result.structuredContent;
    if (typeof content === "string") {
      try {
        return JSON.parse(content);
      } catch {
        return { text: content };
      }
    }
    return content;
  }
  const text = result?.content?.find((entry) => entry?.type === "text")?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return result && typeof result === "object" ? result : {};
}

function publicErrorCode(error, fallback) {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code ?? ""))
    ? error.code
    : fallback;
}

function registryProjects(registry, config) {
  return registry?.all?.() ?? config?.projects ?? [];
}

function allowedProjects(registry, config) {
  return new Map(registryProjects(registry, config)
    .filter(isCrossProjectReadable)
    .map((project) => [String(project.id), project]));
}

function validDeleteTool(tool) {
  const schema = tool?.inputSchema;
  return ["delete_thought", "forget_thought"].includes(tool?.name)
    && Array.isArray(schema?.required)
    && schema.required.includes("id")
    && schema?.properties?.id?.type === "string";
}

export function nextBackoffAt(attempts, now = Date.now, random = Math.random) {
  const jitter = (random() * 2 - 1) * JITTER;
  return asTimestamp(now) + BASE_BACKOFF_MS * (2 ** (attempts - 1)) * (1 + jitter);
}

function closedResult(fields = {}) {
  return { ...fields, ok: false, code: CLOSED_CODE };
}

async function releaseConnection({ active, pending }) {
  let acquired = active;
  if (!acquired && pending) {
    try {
      acquired = await pending;
    } catch (error) {
      if (error instanceof ClawError && [CLOSED_CODE, "OPENBRAIN_UNREACHABLE"].includes(error.code)) return;
      throw error;
    }
  }
  if (typeof acquired?.close !== "function") return;
  try {
    await acquired.close();
  } catch {
    throw new ClawError("OPENBRAIN_CLOSE_FAILED");
  }
}

async function connectWithSecret({ openbrain, secrets, connect }) {
  const tokenName = openbrain.tokenSecret ?? "OPENBRAIN_KEY";
  const token = secrets?.get?.(tokenName) ?? null;
  if (!token) throw new ClawError("OPENBRAIN_KEY_MISSING");
  const active = await connect({
    endpoint: openbrain.endpoint,
    headerName: openbrain.header ?? "x-brain-key",
    token,
  });
  if (!active || typeof active.callTool !== "function") {
    await releaseConnection({ active });
    throw new ClawError("OPENBRAIN_TRANSPORT_INVALID");
  }
  return active;
}

function createConnectionOwner({ enabled, openbrain, secrets, connect }) {
  const state = {
    closed: false, connection: null, connectPromise: null, closePromise: null, waiters: new Set(),
  };

  function assertOpen() {
    if (state.closed) throw new ClawError(CLOSED_CODE);
  }

  async function run(operation) {
    assertOpen();
    let cancel;
    const cancelled = new Promise((_, reject) => {
      cancel = () => reject(new ClawError(CLOSED_CODE));
      state.waiters.add(cancel);
    });
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => { assertOpen(); return operation(); }),
        cancelled,
      ]);
      assertOpen();
      return value;
    } finally {
      state.waiters.delete(cancel);
    }
  }

  async function getConnection() {
    assertOpen();
    if (!enabled) throw new ClawError("OPENBRAIN_NO_ENDPOINT");
    if (state.connection) return state.connection;
    if (!state.connectPromise) {
      state.connectPromise = Promise.resolve().then(async () => {
        assertOpen();
        const active = await connectWithSecret({ openbrain, secrets, connect });
        if (!state.closed) state.connection = active;
        return active;
      }).catch((error) => {
        state.connectPromise = null;
        if (error instanceof ClawError && [CLOSED_CODE, "OPENBRAIN_CLOSE_FAILED"].includes(error.code)) throw error;
        throw new ClawError("OPENBRAIN_UNREACHABLE");
      });
    }
    const pending = state.connectPromise;
    return run(() => pending);
  }

  async function callTool(name, args) {
    return run(async () => {
      const current = await getConnection();
      assertOpen();
      return current.callTool({ name, arguments: args });
    });
  }

  async function listTools() {
    return run(async () => {
      const current = await getConnection();
      assertOpen();
      return current.listTools();
    });
  }

  function close() {
    if (state.closePromise) return state.closePromise;
    const active = state.connection;
    const pending = state.connectPromise;
    state.closed = true;
    state.connection = null;
    for (const cancel of state.waiters) cancel();
    state.waiters.clear();
    state.closePromise = Promise.resolve().then(() => releaseConnection({ active, pending }));
    return state.closePromise;
  }

  return { get closed() { return state.closed; }, assertOpen, run, getConnection, callTool, listTools, close };
}

function recordDeliveryFailure({ store, item, maxAttempts, now, random, logger, error }) {
  const attempts = Number(item._attempts ?? 0) + 1;
  let outcome = "retried";
  if (attempts >= maxAttempts) {
    store.append(QUEUE_STREAM, {
      id: item.id,
      _status: "failed",
      _attempts: attempts,
      failedAt: asTimestamp(now),
    });
    outcome = "deadLettered";
  } else {
    store.append(QUEUE_STREAM, {
      id: item.id,
      _status: "pending",
      _attempts: attempts,
      _nextAttemptAt: nextBackoffAt(attempts, now, random),
    });
  }
  logger?.warn?.("OpenBrain delivery failed", {
    code: publicErrorCode(error, "OPENBRAIN_UNREACHABLE"),
  });
  return outcome;
}

async function defaultConnect({ endpoint, headerName, token }) {
  const [{ Client }, { SSEClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/sse.js"),
  ]);
  if (typeof SSEClientTransport !== "function") throw new Error("SSE_TRANSPORT_UNAVAILABLE");
  const transport = new SSEClientTransport(new URL(endpoint), {
    requestInit: { headers: { [headerName]: token } },
  });
  const client = new Client({ name: "pforge-claw-openbrain", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    // A failed handshake never transfers transport ownership to the direct client.
    await releaseConnection({ active: transport });
    throw error;
  }
  return {
    callTool: (request) => client.callTool(request),
    listTools: () => client.listTools(),
    close: () => client.close(),
  };
}

export function createDirectClient({
  config = {},
  secrets,
  store,
  connect = defaultConnect,
  sanitize = (text) => String(text ?? ""),
  registry,
  now = Date.now,
  random = Math.random,
  logger,
  idFactory = randomUUID,
} = {}) {
  const openbrain = config.memory?.openbrain;
  const enabled = typeof openbrain?.endpoint === "string" && openbrain.endpoint.length > 0;
  const owner = createConnectionOwner({ enabled, openbrain, secrets, connect });
  let drainPromise = null;
  let closePromise = null;

  async function invoke(name, args) {
    const result = await owner.callTool(name, args);
    owner.assertOpen();
    const normalized = toolResult(result);
    if (result?.isError || normalized?.ok === false || normalized?.error) {
      const error = new Error("OPENBRAIN_TOOL_FAILED");
      error.code = publicErrorCode(normalized, "OPENBRAIN_TOOL_FAILED");
      throw error;
    }
    return normalized;
  }

  function counts() {
    const records = foldQueue(store);
    let pending = 0;
    let deadLetters = 0;
    for (const record of records.values()) {
      if (record._status === "pending") pending += 1;
      if (record._status === "failed") deadLetters += 1;
    }
    return { pending, deadLetters };
  }

  async function writeBot(thought) {
    if (owner.closed) return closedResult();
    if (!enabled) return { ok: false, code: "OPENBRAIN_NO_ENDPOINT" };
    if (thought?.project !== `pforge-claw:${config.instanceId}`) {
      return { ok: false, code: "DIRECT_PROJECT_WRITE_FORBIDDEN" };
    }
    let record;
    try {
      const content = await owner.run(() => sanitize(thought.content));
      owner.assertOpen();
      record = {
        content,
        ...(typeof thought.type === "string" ? { type: thought.type } : {}),
        project: thought.project,
        ...(typeof thought.source === "string" ? { source: thought.source } : {}),
        ...(typeof thought.created_by === "string" ? { created_by: thought.created_by } : {}),
        ...(typeof thought.origin === "string" ? { origin: thought.origin } : {}),
        ...(Array.isArray(thought.tags) ? { tags: thought.tags } : {}),
        ...(typeof thought.visibility === "string" ? { visibility: thought.visibility } : {}),
      };
    } catch {
      return owner.closed ? closedResult() : { ok: false, code: "MEMORY_SANITIZE_FAILED" };
    }
    const id = String(idFactory());
    try {
      owner.assertOpen();
      store.append(QUEUE_STREAM, {
        v: 1,
        id,
        record,
        _status: "pending",
        _attempts: 0,
        _nextAttemptAt: 0,
        at: asTimestamp(now),
      });
      return { ok: true, queued: id };
    } catch (error) {
      if (owner.closed) return closedResult();
      logger?.warn?.("OpenBrain queue write failed", { code: publicErrorCode(error, "MEMORY_STATE_FAILED") });
      return { ok: false, code: "MEMORY_STATE_FAILED" };
    }
  }

  async function performDrain({ maxBatch = MAX_BATCH, maxAttempts = MAX_ATTEMPTS } = {}) {
    const empty = { delivered: 0, retried: 0, deadLettered: 0 };
    if (owner.closed) return closedResult(empty);
    if (!enabled) return { ...empty, ok: false, code: "OPENBRAIN_NO_ENDPOINT" };
    try {
      await owner.getConnection();
      owner.assertOpen();
    } catch {
      return owner.closed ? closedResult(empty) : { ...empty, ok: false, code: "OPENBRAIN_UNREACHABLE" };
    }
    const eligible = [...foldQueue(store).values()]
      .filter((record) => record._status === "pending" && Number(record._nextAttemptAt ?? 0) <= asTimestamp(now))
      .slice(0, Math.max(0, Math.min(MAX_BATCH, Number(maxBatch) || MAX_BATCH)));
    const totals = { ...empty };
    // A remote success can precede a failed local status append, so delivery is at-least-once.
    for (const item of eligible) {
      try {
        const result = await owner.callTool("capture_thought", item.record);
        owner.assertOpen();
        if (result?.isError || toolResult(result)?.ok === false) throw new Error("OPENBRAIN_DELIVERY_FAILED");
        store.append(QUEUE_STREAM, {
          id: item.id,
          _status: "delivered",
          _attempts: item._attempts ?? 0,
          deliveredAt: asTimestamp(now),
        });
        totals.delivered += 1;
      } catch (error) {
        if (owner.closed) return closedResult(totals);
        const outcome = recordDeliveryFailure({ store, item, maxAttempts, now, random, logger, error });
        totals[outcome] += 1;
      }
    }
    return totals;
  }

  function drain(options = {}) {
    if (owner.closed) return Promise.resolve(closedResult({ delivered: 0, retried: 0, deadLettered: 0 }));
    if (drainPromise) return drainPromise;
    const operation = performDrain(options);
    drainPromise = operation.finally(() => {
      drainPromise = null;
    });
    return drainPromise;
  }

  async function searchAcross(query, { limit = 5 } = {}) {
    if (owner.closed) return closedResult({ hits: [] });
    if (!enabled) return { ok: false, code: "OPENBRAIN_NO_ENDPOINT", hits: [] };
    const allowed = allowedProjects(registry, config);
    try {
      const normalized = await invoke("search_thoughts", {
        query: await owner.run(() => sanitize(query)),
        limit,
        projects: [...allowed.keys()],
      });
      const hits = Array.isArray(normalized.hits) ? normalized.hits : [];
      const visibleHits = hits.filter((hit) => {
        const project = allowed.get(String(hit?.project ?? ""));
        return isCrossProjectReadable(project) && hit?.visibility !== "restricted";
      });
      return {
        ok: true,
        hits: await owner.run(() => Promise.all(visibleHits.map(async (hit) => ({
          id: hit?.id ?? hit?.recordRef ?? null,
          project: hit?.project ?? null,
          content: await sanitize(hit?.content ?? hit?.snippet ?? hit?.text ?? ""),
          origin: MEMORY_ORIGINS.includes(hit?.origin) ? hit.origin : "untrusted",
          visibility: hit?.visibility ?? "normal",
        })))),
      };
    } catch (error) {
      if (owner.closed) return closedResult({ hits: [] });
      return { ok: false, code: publicErrorCode(error, "OPENBRAIN_UNREACHABLE"), hits: [] };
    }
  }

  async function capabilities() {
    if (owner.closed) return closedResult({ canDelete: false });
    if (!enabled) return { canDelete: false };
    try {
      const response = await owner.listTools();
      owner.assertOpen();
      return { canDelete: (response?.tools ?? []).some(validDeleteTool) };
    } catch {
      return owner.closed ? closedResult({ canDelete: false }) : { canDelete: false };
    }
  }

  async function remove(id) {
    if (owner.closed) return closedResult();
    if (!enabled) return { ok: false, code: "OPENBRAIN_NO_ENDPOINT" };
    if (typeof id !== "string" || !id) return { ok: false, code: "NOT_FOUND" };
    const available = await capabilities();
    if (owner.closed) return closedResult();
    if (!available.canDelete) return { ok: false, code: "NOT_SUPPORTED" };
    try {
      const response = await owner.listTools();
      const tool = (response?.tools ?? []).find(validDeleteTool);
      if (!tool) return { ok: false, code: "NOT_SUPPORTED" };
      const result = await owner.callTool(tool.name, { id });
      owner.assertOpen();
      const normalized = toolResult(result);
      if (result?.isError || normalized?.ok === false) {
        return { ok: false, code: normalized?.code === "NOT_FOUND" ? "NOT_FOUND" : "OPENBRAIN_DELETE_FAILED" };
      }
      return { ok: true };
    } catch (error) {
      if (owner.closed) return closedResult();
      return { ok: false, code: publicErrorCode(error, "OPENBRAIN_UNREACHABLE") };
    }
  }

  async function health() {
    let queueCounts = { pending: 0, deadLetters: 0 };
    try {
      queueCounts = counts();
    } catch (error) {
      logger?.warn?.("OpenBrain queue health could not be read", {
        code: publicErrorCode(error, "MEMORY_STATE_FAILED"),
      });
    }
    const inactive = { enabled, reachable: false, canDelete: false, ...queueCounts };
    if (owner.closed) return closedResult(inactive);
    if (!enabled) return inactive;
    let reachable = false;
    try {
      const current = await owner.getConnection();
      if (typeof current.listTools === "function") {
        await owner.run(() => current.listTools());
        reachable = true;
      }
    } catch {
      reachable = false;
    }
    let canDelete = false;
    try {
      canDelete = (await capabilities()).canDelete;
    } catch {
      canDelete = false;
    }
    if (owner.closed) return closedResult(inactive);
    return {
      enabled: true,
      reachable,
      canDelete,
      pending: queueCounts.pending,
      deadLetters: queueCounts.deadLetters,
    };
  }

  function close() {
    if (closePromise) return closePromise;
    const activeDrain = drainPromise;
    const releasing = owner.close();
    closePromise = Promise.allSettled([releasing, activeDrain]).then(([released]) => {
      if (released.status === "rejected") throw released.reason;
    });
    return closePromise;
  }

  return {
    enabled,
    writeBot,
    drain,
    searchAcross,
    capabilities,
    remove,
    health,
    close,
    queueCounts: counts,
  };
}
