import { randomUUID } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";
import { captureErrorCode } from "../capture-policy.mjs";

export const MEMORY_ORIGINS = Object.freeze(["trusted", "untrusted"]);
export const MEMORY_TYPES = Object.freeze(["decision", "lesson", "convention", "pattern", "gotcha"]);
export const MEMORY_STREAMS = Object.freeze({
  local: "memory-local",
  pending: "memory-pending",
  captured: "memory-captured",
  confirm: "memory-confirm",
});
export const MAX_CONTENT = 3500;
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 40;

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?\d[\d(). -]{6,}\d)/g;
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const USER_ID_RE = /\b(?:user|from|chat)[ _-]?id[:= ]\d{5,}\b/gi;

function cleanSegment(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "-") || "unknown";
}

function registryProject(registry, projectId, config) {
  return registry?.byId?.(projectId)
    ?? (config?.projects ?? []).find((project) => String(project.id) === String(projectId));
}

/** @param {unknown} result @returns {Record<string, unknown>} */
export function normalizeToolResult(result) {
  const contentText = result?.content?.find((entry) => entry?.type === "text")?.text;
  let payload = result?.structuredContent ?? contentText ?? result;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return { text: payload };
    }
  }
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function latestById(state, record) {
  if (typeof record?.id !== "string") return state;
  state.set(record.id, record);
  return state;
}

function cleanHit(hit, config, secrets) {
  return {
    id: hit?.id ?? hit?.recordRef ?? null,
    project: hit?.project ?? null,
    content: sanitizeRecord({
      config,
      secrets,
      text: hit?.content ?? hit?.snippet ?? hit?.text ?? "",
    }),
    origin: MEMORY_ORIGINS.includes(hit?.origin) ? hit.origin : "untrusted",
    visibility: hit?.visibility === "restricted" ? "restricted" : "normal",
  };
}

function isAllowedHit(hit, allowedProjects) {
  const project = allowedProjects.get(String(hit?.project ?? ""));
  return Boolean(project)
    && isCrossProjectReadable(project)
    && hit?.visibility !== "restricted";
}

export function buildSource({ instanceId, lane, ref } = {}) {
  return `pforge-claw/${cleanSegment(instanceId)}/${cleanSegment(lane)}/${cleanSegment(ref)}`;
}

export function buildCreatedBy(config, { userId, role } = {}) {
  const callerId = String(userId ?? "");
  const alias = config?.allowlist?.find((entry) => String(entry.userId) === callerId)?.alias;
  if (typeof alias === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(alias) && alias !== callerId) {
    return `pforge-claw:${alias}`;
  }
  return `pforge-claw:${ROLES.includes(role) ? role : "unknown"}`;
}

export function isL3Off(project) {
  return project?.memory?.l3 === "off";
}

// D21: restricted projects never leave their own scope, and `memory.l3: "off"` opts a project
// out of shared memory, so neither is ever queried or surfaced by cross-project recall.
export function isCrossProjectReadable(project) {
  return Boolean(project) && project.visibility !== "restricted" && !isL3Off(project);
}

function redactIdentifiers(text, config) {
  let sanitized = text;
  for (const entry of config?.allowlist ?? []) {
    for (const field of ["userId", "username", "name", "displayName"]) {
      const identifier = String(entry?.[field] ?? "");
      if (identifier) sanitized = sanitized.split(identifier).join("«redacted:user-id»");
    }
  }
  return sanitized;
}

export function sanitizeRecord({ config, secrets, text } = {}) {
  let sanitized = typeof secrets?.redact === "function"
    ? secrets.redact(String(text ?? ""))
    : String(text ?? "");
  sanitized = sanitized
    .replace(EMAIL_RE, "«redacted:email»")
    .replace(PHONE_RE, "«redacted:phone»")
    .replace(IPV4_RE, "«redacted:ip»")
    .replace(USER_ID_RE, "«redacted:user-id»");
  return redactIdentifiers(sanitized, config).slice(0, MAX_CONTENT);
}

export function normalizeTags(tags, origin = "trusted") {
  const values = Array.isArray(tags) ? tags : [];
  const normalized = values
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9:-]/g, "").slice(0, MAX_TAG_LEN))
    .filter((tag) => tag && tag !== "pforge-claw" && tag !== "untrusted");
  const mandatory = origin === "untrusted" ? ["pforge-claw", "untrusted"] : ["pforge-claw"];
  return [...new Set(normalized)].slice(0, MAX_TAGS - mandatory.length).concat(mandatory);
}

function isToolFailure(raw, normalized) {
  return raw?.isError || raw?.error || normalized?.ok === false || normalized?.error;
}

function firstErrorCode(raw, normalized) {
  for (const code of [normalized?.code, raw?.code, normalized?.error, raw?.error]) {
    const safe = captureErrorCode({ code }, null);
    if (safe) return safe;
  }
  return "MCP_TOOL_ERROR";
}

/** @param {unknown} raw @param {Record<string, unknown>} normalized @returns {string|null} */
export function toolFailureCode(raw, normalized) {
  return isToolFailure(raw, normalized) ? firstErrorCode(raw, normalized) : null;
}

function capturePayload({ config, secrets, project, projectId, input }) {
  const sanitize = (text) => sanitizeRecord({ config, secrets, text });
  const origin = input.origin ?? MEMORY_ORIGINS[0];
  return {
    content: sanitize(input.content),
    type: input.type ?? "lesson",
    project: projectId,
    source: buildSource({
      instanceId: sanitize(config.instanceId ?? "unknown"),
      lane: sanitize(input.lane ?? "unknown"),
      ref: sanitize(input.ref ?? "unknown"),
    }),
    created_by: buildCreatedBy(config, input.caller),
    origin,
    tags: normalizeTags((Array.isArray(input.tags) ? input.tags : [])
      .filter((tag) => typeof tag === "string").map(sanitize), origin),
    visibility: project.visibility === "restricted" ? "restricted" : "normal",
  };
}

function isPendingCapture(saved) {
  return saved?.queued === true || saved?.pending === true
    || saved?.status === "queued" || saved?.status === "pending";
}

function sharedCaptureReceipt(saved) {
  const receipt = {};
  for (const key of ["id", "url", "text", "message"]) {
    if (typeof saved?.[key] === "string" && saved[key]) receipt[key] = saved[key];
  }
  if (isPendingCapture(saved)) {
    return { ok: false, code: "MEMORY_PENDING", stored: "project-mcp", ...receipt };
  }
  if (saved?.ok !== true && !receipt.id && !receipt.url) {
    return { ok: false, code: "MEMORY_CAPTURE_UNCONFIRMED", ...receipt };
  }
  return { ok: true, stored: "project-mcp", ...receipt };
}

export function createMemoryClient({
  config = {},
  mcp,
  store,
  secrets,
  registry,
  logger,
  now = Date.now,
  idFactory = randomUUID,
} = {}) {
  function projectFor(projectId) {
    return registryProject(registry, projectId, config);
  }

  async function callProject(projectId, toolName, args) {
    if (!mcp || typeof mcp.call !== "function") throw new ClawError("MCP_UNAVAILABLE");
    const result = await mcp.call(projectId, toolName, args);
    const normalized = normalizeToolResult(result);
    const code = toolFailureCode(result, normalized);
    if (code) throw new ClawError(code);
    return normalized;
  }

  function appendMemory({ projectId, payload, stream, status, localOnly = false }) {
    store.append(stream, {
      v: 1, id: String(idFactory()), projectId, payload,
      ...(localOnly ? { localOnly: true } : {}),
      _status: status, at: now(),
    });
  }

  function localCapture(projectId, payload) {
    try {
      appendMemory({ projectId, payload, stream: MEMORY_STREAMS.local, status: "local", localOnly: true });
      return { ok: true, stored: "claw-state", l3: false };
    } catch (error) {
      logger?.warn?.("Local memory could not be stored", { code: captureErrorCode(error, "MEMORY_STATE_FAILED") });
      return { ok: false, code: "MEMORY_STATE_FAILED" };
    }
  }

  function queueCapture(projectId, payload, error) {
    try {
      appendMemory({ projectId, payload, stream: MEMORY_STREAMS.pending, status: "pending" });
      const errorCode = captureErrorCode(error, null);
      return { ok: false, code: "MEMORY_PENDING", ...(errorCode ? { errorCode } : {}) };
    } catch (storeError) {
      logger?.warn?.("Pending memory could not be stored", {
        code: captureErrorCode(storeError, "MEMORY_STATE_FAILED"),
      });
      return { ok: false, code: "MEMORY_STATE_FAILED" };
    }
  }

  async function capture(projectId, input = {}) {
    const project = projectFor(projectId);
    if (!project) return { ok: false, code: "MEMORY_PROJECT_UNAVAILABLE" };
    if (!MEMORY_ORIGINS.includes(input.origin ?? MEMORY_ORIGINS[0])) {
      return { ok: false, code: "MEMORY_ORIGIN_INVALID" };
    }
    if (!MEMORY_TYPES.includes(input.type ?? "lesson") || typeof input.content !== "string") {
      return { ok: false, code: "MEMORY_CONTENT_INVALID" };
    }
    const payload = capturePayload({ config, secrets, project, projectId, input });
    if (!payload.content.trim()) return { ok: false, code: "MEMORY_CONTENT_INVALID" };
    if (isL3Off(project)) return localCapture(projectId, payload);
    try {
      return sharedCaptureReceipt(await callProject(projectId, "forge_memory_capture", payload));
    } catch (error) {
      return queueCapture(projectId, payload, error);
    }
  }

  async function search(projectId, query, { limit = 5 } = {}) {
    try {
      const normalized = await callProject(projectId, "forge_search", {
        query: sanitizeRecord({ config, secrets, text: query }),
        limit,
      });
      return {
        ok: true,
        hits: (Array.isArray(normalized.hits) ? normalized.hits : [])
          .map((hit) => cleanHit(hit, config, secrets)),
      };
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code ?? ""))
        ? error.code
        : "MEMORY_SEARCH_FAILED";
      return { ok: false, code, hits: [] };
    }
  }

  async function fanoutSearch(query, { limit = 5 } = {}) {
    const projects = (registry?.all?.() ?? config.projects ?? []).filter(isCrossProjectReadable);
    const allowedProjects = new Map(projects.map((project) => [String(project.id), project]));
    const results = await Promise.allSettled(projects.map((project) => search(project.id, query, { limit })));
    const hits = [];
    const errors = [];
    results.forEach((result, index) => {
      const projectId = projects[index].id;
      if (result.status === "rejected") {
        errors.push({ projectId, code: "MEMORY_SEARCH_FAILED" });
        return;
      }
      if (!result.value.ok) {
        errors.push({ projectId, code: result.value.code });
        return;
      }
      for (const hit of result.value.hits) {
        // Project-scoped forge_search hits usually carry no project; attribute them to the searched project.
        const attributed = { ...hit, project: hit.project ?? projectId };
        if (isAllowedHit(attributed, allowedProjects)) hits.push(attributed);
      }
    });
    return { hits, errors };
  }

  function pendingCounts() {
    const counts = store.fold(MEMORY_STREAMS.pending, latestById, new Map());
    const byProject = {};
    for (const record of counts.values()) {
      if (record._status !== "pending") continue;
      const projectId = String(record.projectId ?? "");
      byProject[projectId] = (byProject[projectId] ?? 0) + 1;
    }
    const local = store.fold(MEMORY_STREAMS.local, (count, record) => (
      record.localOnly === true ? count + 1 : count
    ), 0);
    return { ...byProject, local };
  }

  return { capture, search, fanoutSearch, pendingCounts };
}
